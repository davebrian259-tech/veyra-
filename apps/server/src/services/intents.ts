import type { Db } from "../db.js";
import { json, now, parse } from "../db.js";
import { fromAtomic } from "../lib/amounts.js";
import { hashObject, randomId } from "../lib/crypto.js";
import { badRequest, HttpError, notFound } from "../lib/errors.js";
import type { AuditLog } from "./audit.js";
import type { User } from "./auth.js";
import type { Bodyguard } from "./bodyguard/engine.js";
import type { Notifier } from "./notifications.js";
import type { TokenCatalog } from "./tokens.js";

/**
 * NEAR Intents via the 1Click API — the execution layer for swaps signed by the user's own
 * wallet (manual mode). Agent swaps go through the Agent API, which uses the same NEAR Intents
 * infrastructure under the agent's policy. Veyra does not run its own bridge or swap engine.
 */

export interface QuoteInput {
  originAsset: string;
  destinationAsset: string;
  /** Atomic units of the origin asset (EXACT_INPUT). */
  amount: string;
  slippageBps: number;
  recipient: string;
  refundTo: string;
  recipientType?: "DESTINATION_CHAIN" | "INTENTS";
  depositType?: "ORIGIN_CHAIN" | "INTENTS";
  dry: boolean;
}

export interface OneClickQuote {
  quote: {
    amountIn: string;
    amountInFormatted: string;
    amountInUsd?: string;
    minAmountIn?: string;
    amountOut: string;
    amountOutFormatted: string;
    amountOutUsd?: string;
    minAmountOut: string;
    timeEstimate?: number;
    depositAddress?: string;
    depositMemo?: string;
    deadline?: string;
    timeWhenInactive?: string;
    refundFee?: string;
    withdrawFee?: string;
  };
  quoteRequest: Record<string, unknown>;
  signature: string;
  timestamp: string;
  correlationId: string;
}

const STORAGE_DEPOSIT = "1250000000000000000000"; // 0.00125 NEAR, NEP-145 registration

export function mapOneClickStatus(s: string): string {
  switch (s) {
    case "PENDING_DEPOSIT": return "awaiting_deposit";
    case "KNOWN_DEPOSIT_TX": return "submitted";
    case "INCOMPLETE_DEPOSIT": return "incomplete_deposit";
    case "PROCESSING": return "confirmed";
    case "SUCCESS": return "settled";
    case "REFUNDED": return "refunded";
    case "FAILED": return "failed";
    default: return "submitted";
  }
}

export class IntentsService {
  constructor(
    private readonly db: Db,
    private readonly tokens: TokenCatalog,
    private readonly bodyguard: Bodyguard,
    private readonly audit: AuditLog,
    private readonly notifier: Notifier,
    private readonly opts: { baseUrl: string; jwt?: string; fetch?: typeof fetch },
  ) {}

  private async call<T>(path: string, init?: { method?: string; body?: unknown; query?: Record<string, string> }): Promise<T> {
    const url = new URL(path, this.opts.baseUrl);
    for (const [k, v] of Object.entries(init?.query ?? {})) url.searchParams.set(k, v);
    const res = await (this.opts.fetch ?? fetch)(url, {
      method: init?.method ?? "GET",
      headers: { "content-type": "application/json", ...(this.opts.jwt ? { authorization: `Bearer ${this.opts.jwt}` } : {}) },
      body: init?.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    if (!res.ok) throw new HttpError(res.status >= 500 ? 502 : 400, "oneclick_error", body?.message ?? `1Click HTTP ${res.status}`, body);
    return body as T;
  }

  /** Never offer an operation for an asset 1Click does not currently list. */
  async assertSupported(...assetIds: string[]) {
    const list = await this.tokens.oneClickTokens();
    for (const a of assetIds) if (!list.some((t) => t.assetId === a)) throw badRequest("unsupported_asset", `${a} is not currently supported by NEAR Intents`);
  }

  async quote(input: QuoteInput): Promise<OneClickQuote> {
    await this.assertSupported(input.originAsset, input.destinationAsset);
    if (!/^\d+$/.test(input.amount) || input.amount === "0") throw badRequest("invalid_amount", "amount must be a positive integer in atomic units");
    return this.call<OneClickQuote>("/v0/quote", {
      method: "POST",
      body: {
        dry: input.dry,
        swapType: "EXACT_INPUT",
        slippageTolerance: input.slippageBps,
        originAsset: input.originAsset,
        depositType: input.depositType ?? "ORIGIN_CHAIN",
        destinationAsset: input.destinationAsset,
        amount: input.amount,
        refundTo: input.refundTo,
        refundType: input.depositType === "INTENTS" ? "INTENTS" : "ORIGIN_CHAIN",
        recipient: input.recipient,
        recipientType: input.recipientType ?? "DESTINATION_CHAIN",
        deadline: new Date(Date.now() + 3600_000).toISOString(),
        referral: "veyra",
      },
    });
  }

  /** Real quotes for alternative delivery routes, ranked by USD received. */
  async compare(input: Omit<QuoteInput, "dry" | "recipientType">) {
    const variants: { route: string; recipientType: "DESTINATION_CHAIN" | "INTENTS" }[] = [
      { route: "Deliver to your wallet on the destination chain", recipientType: "DESTINATION_CHAIN" },
      { route: "Deliver into your NEAR Intents balance", recipientType: "INTENTS" },
    ];
    const [origin, dest] = await Promise.all([this.tokens.find(input.originAsset, "oneclick"), this.tokens.find(input.destinationAsset, "oneclick")]);
    const results = await Promise.all(
      variants.map(async (v) => {
        try {
          const q = await this.quote({ ...input, recipientType: v.recipientType, dry: true });
          return { ...v, ok: true as const, ...summarise(q, origin?.price ?? null) };
        } catch (e) {
          return { ...v, ok: false as const, error: e instanceof Error ? e.message : String(e) };
        }
      }),
    );
    const ranked = results.sort((a, b) => (b.ok ? Number(b.amountOutUsd ?? 0) : -1) - (a.ok ? Number(a.amountOutUsd ?? 0) : -1));
    return { origin, destination: dest, quotes: ranked, source: "NEAR Intents 1Click API (live)" };
  }

  /**
   * Creates a live (non-dry) quote with a deposit address, runs BODYGUARD on the recipient and
   * returns the wallet actions that fund it. The user's wallet signs; nothing goes via the agent.
   */
  async createManualSwap(user: User, input: Omit<QuoteInput, "dry">) {
    const q = await this.quote({ ...input, dry: false });
    const depositAddress = q.quote.depositAddress;
    if (!depositAddress) throw new HttpError(502, "no_deposit_address", "1Click returned no deposit address");
    const origin = await this.tokens.find(input.originAsset, "oneclick");
    const findings = input.recipient === user.accountId ? [] : await this.bodyguard.addressFindings(user.id, input.recipient, "near", null, "manual");
    const id = randomId("op_");
    const request = { ...input, depositAddress, depositMemo: q.quote.depositMemo ?? null, quote: q };
    const usd = q.quote.amountInUsd ? Number(q.quote.amountInUsd) : null;
    this.db.run(
      `INSERT INTO operations (id, user_id, agent_id, kind, origin, request_json, request_hash, idempotency_key, status, usd_value, asset, amount, destination, bodyguard_json, created_at, updated_at)
       VALUES (?,?,NULL,'manual_swap','manual',?,?,?,?,?,?,?,?,?,?,?)`,
      [id, user.id, json(request), hashObject(request), `1click:${depositAddress}`, "awaiting_deposit", usd, input.originAsset, input.amount, input.recipient, json({ findings }), now(), now()],
    );
    this.audit.record({ userId: user.id, actor: "user", action: "manual_swap.quoted", subject: id, data: { depositAddress, amountIn: q.quote.amountIn, minAmountOut: q.quote.minAmountOut, correlationId: q.correlationId } });
    return {
      operationId: id,
      depositAddress,
      depositMemo: q.quote.depositMemo ?? null,
      deadline: q.quote.deadline,
      summary: summarise(q, origin?.price ?? null),
      findings,
      walletTransactions: origin?.blockchain === "near" ? this.depositTransactions(origin.contractAddress ?? input.originAsset.replace(/^nep141:/, ""), depositAddress, input.amount, input.originAsset === "nep141:wrap.near") : null,
      instructions: origin?.blockchain === "near" ? "Sign the deposit with your NEAR wallet." : `Send exactly ${q.quote.amountInFormatted} ${origin?.symbol ?? ""} on ${origin?.blockchain} to ${depositAddress}${q.quote.depositMemo ? ` with memo ${q.quote.depositMemo}` : ""} before ${q.quote.deadline}.`,
    };
  }

  /** NEAR wallet actions that pay a 1Click deposit address in a NEP-141 token. */
  depositTransactions(tokenContract: string, depositAddress: string, amount: string, wrapNative: boolean) {
    const actions = [
      { type: "FunctionCall", params: { methodName: "storage_deposit", args: { account_id: depositAddress, registration_only: true }, gas: "30000000000000", deposit: STORAGE_DEPOSIT } },
      ...(wrapNative ? [{ type: "FunctionCall", params: { methodName: "near_deposit", args: {}, gas: "10000000000000", deposit: amount } }] : []),
      { type: "FunctionCall", params: { methodName: "ft_transfer", args: { receiver_id: depositAddress, amount }, gas: "30000000000000", deposit: "1" } },
    ];
    return [{ receiverId: tokenContract, actions }];
  }

  /** Tell 1Click about the deposit transaction to speed up processing. */
  async submitDeposit(user: User, operationId: string, txHash: string) {
    const op = this.db.get<{ user_id: string; request_json: string }>("SELECT * FROM operations WHERE id = ? AND kind = 'manual_swap'", [operationId]);
    if (!op || op.user_id !== user.id) throw notFound("swap");
    const req = parse<{ depositAddress: string }>(op.request_json);
    await this.call("/v0/deposit/submit", { method: "POST", body: { txHash, depositAddress: req.depositAddress } }).catch(() => undefined);
    this.db.run("UPDATE operations SET tx_hash = ?, status = 'submitted', submitted_at = ?, updated_at = ? WHERE id = ?", [txHash, now(), now(), operationId]);
    this.audit.record({ userId: user.id, actor: "user", action: "manual_swap.deposited", subject: operationId, data: { txHash } });
    return this.refresh(operationId);
  }

  async status(depositAddress: string, memo?: string | null) {
    return this.call<{ status: string; updatedAt?: string; swapDetails?: Record<string, unknown> }>("/v0/status", { query: { depositAddress, ...(memo ? { depositMemo: memo } : {}) } });
  }

  async refresh(operationId: string) {
    const op = this.db.get<{ user_id: string; request_json: string; status: string }>("SELECT * FROM operations WHERE id = ?", [operationId]);
    if (!op) throw notFound("swap");
    const req = parse<{ depositAddress: string; depositMemo?: string | null }>(op.request_json);
    const st = await this.status(req.depositAddress, req.depositMemo);
    const next = mapOneClickStatus(st.status);
    const details = st.swapDetails ?? {};
    const destTx = ((details.destinationChainTxHashes as { hash: string }[] | undefined) ?? [])[0]?.hash ?? null;
    this.db.run(
      "UPDATE operations SET status = ?, provider_status = ?, settlement_json = ?, settled_at = CASE WHEN ? = 'settled' THEN COALESCE(settled_at, ?) ELSE settled_at END, updated_at = ? WHERE id = ?",
      [next, st.status, json({ swapDetails: details, destinationTxHash: destTx }), next, now(), now(), operationId],
    );
    if (next !== op.status) {
      this.audit.record({ userId: op.user_id, actor: "system", action: `manual_swap.${next}`, subject: operationId, data: { providerStatus: st.status, destTx } });
      if (["settled", "refunded", "failed"].includes(next)) this.notifier.notify(op.user_id, `swap.${next}`, `Swap ${next}`, `Your NEAR Intents swap is ${next}.`, { operationId });
    }
    return { operationId, status: next, providerStatus: st.status, details };
  }

  pendingManualSwaps() {
    return this.db.all<{ id: string; created_at: string }>("SELECT id, created_at FROM operations WHERE kind = 'manual_swap' AND status IN ('awaiting_deposit','submitted','confirmed','incomplete_deposit')");
  }
}

function summarise(q: OneClickQuote, originPrice: number | null) {
  const inUsd = q.quote.amountInUsd ? Number(q.quote.amountInUsd) : null;
  const outUsd = q.quote.amountOutUsd ? Number(q.quote.amountOutUsd) : null;
  return {
    amountIn: q.quote.amountIn,
    amountInFormatted: q.quote.amountInFormatted,
    amountInUsd: inUsd,
    amountOut: q.quote.amountOut,
    amountOutFormatted: q.quote.amountOutFormatted,
    amountOutUsd: outUsd,
    minAmountOut: q.quote.minAmountOut,
    costUsd: inUsd != null && outUsd != null ? Number((inUsd - outUsd).toFixed(4)) : null,
    costPercent: inUsd && outUsd != null ? Number((((inUsd - outUsd) / inUsd) * 100).toFixed(3)) : null,
    timeEstimateSeconds: q.quote.timeEstimate ?? null,
    appFees: (q.quoteRequest.appFees as unknown) ?? null,
    originPrice,
    correlationId: q.correlationId,
    signedQuote: { signature: q.signature, timestamp: q.timestamp },
  };
}

export const formatAmount = fromAtomic;
