import type { Db } from "../db.js";
import { now } from "../db.js";
import { randomId } from "../lib/crypto.js";
import { badRequest, notFound } from "../lib/errors.js";
import { chequeMatches, decodeCheque } from "../market/cheque.js";
import type { X402Requirement } from "../market/types.js";
import type { Chain } from "../treasury/chain.js";
import type { SpendAccount } from "../treasury/spend-account.js";
import type { ContractorEngine } from "./engine.js";
import type { MandateService } from "./mandate.js";

/**
 * Veyra as an x402 seller. Any agent can hire Veyra the way Veyra hires others: send the job
 * over A2A, receive a 402 with the price, and resend it with a signed cheque (a NEP-366
 * delegate `ft_transfer` to Veyra's spend account). Veyra holds the cheque while it works and
 * relays it only when the job is delivered. A job that fails costs the buyer nothing, because
 * the cheque is never executed.
 */
export interface SaleRow {
  id: string;
  contract_id: string;
  buyer_account: string;
  buyer_key: string;
  amount_atomic: string;
  asset: string;
  cheque_b64: string;
  cheque_hash: string;
  status: "held" | "settled" | "void" | "failed";
  settlement_tx: string | null;
  error: string | null;
  created_at: string;
  settled_at: string | null;
}

export interface SellerDeps {
  db: Db;
  chain: Chain;
  spend: SpendAccount;
  engine: ContractorEngine;
  mandate: MandateService;
  ownerUserId: () => string | null;
  network: string;
  asset: string;
  /** Seconds a buyer's cheque must stay valid: Veyra's SLA plus a settlement margin. */
  windowSeconds: number;
  minPriceAtomic: bigint;
}

const parseHeader = (xPayment: string) => {
  try {
    const h = JSON.parse(Buffer.from(xPayment, "base64").toString("utf8")) as { accepted?: X402Requirement; payload?: { signedDelegateAction?: string } };
    if (!h.payload?.signedDelegateAction) throw new Error("missing signedDelegateAction");
    return h as { accepted: X402Requirement; payload: { signedDelegateAction: string } };
  } catch (e) {
    throw badRequest("malformed_payment", `X-PAYMENT header: ${e instanceof Error ? e.message : "not base64 JSON"}`);
  }
};

export class X402Seller {
  constructor(private readonly d: SellerDeps) {}

  /** The payment Veyra asks for. The buyer states the budget; Veyra asks for exactly that. */
  challenge(amountAtomic: bigint): X402Requirement {
    return { scheme: "exact", network: this.d.network, asset: this.d.asset, amount: amountAtomic.toString(), payTo: this.d.spend.accountId, maxTimeoutSeconds: this.d.windowSeconds };
  }

  /** Veyra's own `/.well-known/x402`: where it may be paid, so buyers can pin the payee. */
  recipients() {
    return { x402Version: 2, recipients: [{ network: this.d.network, asset: this.d.asset, payTo: this.d.spend.accountId }] };
  }

  /** Price for a job: the stated budget, within the mandate. Nothing is signed or stored. */
  price(budgetAtomic: bigint) {
    const max = BigInt(Math.round(this.d.mandate.current().mandate.maxJobUsd * 1e6));
    if (budgetAtomic < this.d.minPriceAtomic) throw badRequest("budget_too_small", `Veyra takes jobs from ${Number(this.d.minPriceAtomic) / 1e6} USDC`);
    if (budgetAtomic > max) throw badRequest("over_mandate", `the owner's mandate caps a single job at ${Number(max) / 1e6} USDC`);
    return this.challenge(budgetAtomic);
  }

  /** Verifies a cheque without executing it: signature, exact row, key, nonce, expiry, balance. */
  async precheck(chequeB64: string, row: X402Requirement) {
    const c = decodeCheque(chequeB64);
    const m = chequeMatches(c, row);
    if (!m.ok) return { ok: false as const, error: m.problems[0], cheque: c };
    const nonce = await this.d.chain.accessKeyNonce(c.senderId, c.publicKey);
    if (nonce === null) return { ok: false as const, error: "access_key_not_found", cheque: c };
    if (c.nonce <= nonce) return { ok: false as const, error: "delegate_nonce_too_low", cheque: c };
    const height = await this.d.chain.blockHeight();
    if (c.maxBlockHeight < height) return { ok: false as const, error: "delegate_expired", cheque: c };
    if (c.maxBlockHeight > height + BigInt(this.d.windowSeconds + 3600)) return { ok: false as const, error: "validity_window_too_long", cheque: c };
    if ((await this.d.chain.ftBalance(row.asset, c.senderId)) < BigInt(row.amount)) return { ok: false as const, error: "insufficient_funds", cheque: c };
    return { ok: true as const, cheque: c };
  }

  /**
   * Accepts a paid job: the cheque is checked, held, and a contract is created. Returns the
   * contract id (the A2A task id). Idempotent on the cheque hash.
   */
  async accept(input: { title: string; brief: string; xPayment: string }) {
    const header = parseHeader(input.xPayment);
    const amount = BigInt(header.accepted?.amount ?? "0");
    const row = this.price(amount);
    // The same cheque twice is the same sale, whatever state it is in now.
    const existing = this.d.db.get<SaleRow>("SELECT * FROM sales WHERE cheque_hash = ?", [decodeCheque(header.payload.signedDelegateAction).hash]);
    if (existing) return { contractId: existing.contract_id, sale: existing, duplicate: true };
    const pre = await this.precheck(header.payload.signedDelegateAction, row);
    if (!pre.ok) throw badRequest("invalid_payment", pre.error);
    const userId = this.d.ownerUserId();
    if (!userId) throw badRequest("no_owner", "Veyra has no owner yet");
    const c = this.d.engine.create({
      userId, title: input.title, brief: input.brief, budgetUsd: Number(amount) / 1e6,
      buyer: `x402:${pre.cheque.senderId}`, source: "direct", externalRef: `cheque:${pre.cheque.hash}`,
      marginBps: this.d.mandate.current().mandate.marginBps,
    });
    const sale: SaleRow = {
      id: randomId("sale_"), contract_id: c.id, buyer_account: pre.cheque.senderId, buyer_key: pre.cheque.publicKey, amount_atomic: amount.toString(), asset: row.asset,
      cheque_b64: header.payload.signedDelegateAction, cheque_hash: pre.cheque.hash, status: "held", settlement_tx: null, error: null, created_at: now(), settled_at: null,
    };
    this.d.db.run("INSERT INTO sales (id, contract_id, buyer_account, buyer_key, amount_atomic, asset, cheque_b64, cheque_hash, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)", [
      sale.id, sale.contract_id, sale.buyer_account, sale.buyer_key, sale.amount_atomic, sale.asset, sale.cheque_b64, sale.cheque_hash, sale.status, sale.created_at,
    ]);
    return { contractId: c.id, sale, duplicate: false };
  }

  forContract(contractId: string) {
    return this.d.db.get<SaleRow>("SELECT * FROM sales WHERE contract_id = ?", [contractId]) ?? null;
  }

  /**
   * Called by the engine at delivery time. Relays the held cheque; the buyer pays now and
   * only now. Returns null when the contract was not an x402 sale.
   */
  async settle(contractId: string) {
    const sale = this.forContract(contractId);
    if (!sale) return null;
    if (sale.status === "settled") return { ok: true as const, hash: sale.settlement_tx ?? "" };
    if (sale.status !== "held") return { ok: false as const, error: `cheque is ${sale.status}` };
    const r = await this.d.chain.relay(sale.cheque_b64, this.d.spend.housekeepingSigner());
    if (r.ok) this.d.db.run("UPDATE sales SET status = 'settled', settlement_tx = ?, settled_at = ? WHERE id = ?", [r.hash, now(), sale.id]);
    else this.d.db.run("UPDATE sales SET status = 'failed', error = ? WHERE id = ?", [r.error, sale.id]);
    return r;
  }

  /** A failed job: the cheque is marked void and will never be relayed. */
  void(contractId: string, reason: string) {
    this.d.db.run("UPDATE sales SET status = 'void', error = ? WHERE contract_id = ? AND status = 'held'", [reason, contractId]);
  }

  /** The A2A view of a sale, in the market's task shape. */
  task(contractId: string) {
    const sale = this.forContract(contractId);
    if (!sale) throw notFound("task");
    const c = this.d.engine.view(contractId);
    const state = c.status === "delivered" ? "TASK_STATE_COMPLETED" : c.status === "failed" ? "TASK_STATE_FAILED" : c.status === "active" ? "TASK_STATE_WORKING" : "TASK_STATE_CANCELED";
    return {
      id: contractId,
      contextId: `veyra-${sale.buyer_account}`,
      status: { state, timestamp: c.updated_at, message: c.status === "active" ? `${c.step}` : c.error ?? undefined },
      ...(c.status === "delivered" && sale.status === "settled" ? { artifacts: [{ artifactId: `${contractId}-deliverable`, name: "deliverable", parts: [{ text: c.deliverable_md ?? "" }] }] } : {}),
      payment: { status: sale.status, amount: sale.amount_atomic, asset: sale.asset, settlement: sale.settlement_tx, chequeHash: sale.cheque_hash },
    };
  }

  list() {
    return this.d.db.all<SaleRow>("SELECT id, contract_id, buyer_account, amount_atomic, asset, cheque_hash, status, settlement_tx, error, created_at, settled_at FROM sales ORDER BY created_at DESC LIMIT 200");
  }
}
