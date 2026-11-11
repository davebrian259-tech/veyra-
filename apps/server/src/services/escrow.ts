import type { Db } from "../db.js";
import { json, now, parse } from "../db.js";
import { fromAtomic, toAtomic, YOCTO } from "../lib/amounts.js";
import { hashObject, randomId } from "../lib/crypto.js";
import { badRequest, conflict, forbidden, notConfigured, notFound } from "../lib/errors.js";
import { extractEvents } from "../lib/near-rpc.js";
import type { AgentService } from "./agents.js";
import type { AuditLog } from "./audit.js";
import type { User } from "./auth.js";
import type { ExecutionService } from "./execution.js";
import type { NearTxTracker, Network } from "./near-tx.js";
import type { Notifier } from "./notifications.js";
import type { TokenCatalog } from "./tokens.js";

/**
 * UNDO — protected payments through the `veyra-escrow` NEAR contract.
 *
 * Veyra prepares agreements and the exact contract calls; every state-changing call is signed
 * by a party's own wallet (or, for agent funding, by the agent's account through the Agent API
 * under its policy). The backend holds no key that could release funds, and the contract
 * refuses releases from anyone but the approver (the human owner), a reviewer or the arbiter.
 */

export type EscrowAsset = { kind: "native" } | { kind: "ft"; contract_id: string };

export interface PrepareEscrowInput {
  provider: string;
  amountUsd?: number;
  /** Atomic amount; takes precedence over amountUsd. */
  totalAtomic?: string;
  asset?: EscrowAsset;
  milestones: { title: string; sharePct: number }[];
  deadlineDays: number;
  reviewPeriodDays?: number;
  reviewer?: string | null;
  arbiter?: string | null;
  completionConditions: string[];
  evidenceRequirements: string[];
  description: string;
  jobId?: string | null;
  fundingMode: "wallet" | "agent";
  agentId?: string;
}

const GAS_CREATE = "100000000000000";
const GAS_CALL = "100000000000000";
const STORAGE_BUFFER = toAtomic("0.05", YOCTO); // excess is refunded by the contract

export interface WalletTx {
  receiverId: string;
  actions: { type: "FunctionCall"; params: { methodName: string; args: Record<string, unknown>; gas: string; deposit: string } }[];
}

const call = (receiverId: string, methodName: string, args: Record<string, unknown>, deposit = "0", gas = GAS_CALL): WalletTx => ({
  receiverId,
  actions: [{ type: "FunctionCall", params: { methodName, args, gas, deposit } }],
});

export class EscrowService {
  constructor(
    private readonly db: Db,
    private readonly tracker: NearTxTracker,
    private readonly tokens: TokenCatalog,
    private readonly agents: AgentService,
    private readonly execution: ExecutionService,
    private readonly audit: AuditLog,
    private readonly notifier: Notifier,
    private readonly opts: { network: Network; contractId?: string; agentContractId?: string },
  ) {
    tracker.onOutcome(async ({ kind, meta }) => {
      if (kind.startsWith("escrow_") && typeof meta.escrowLocalId === "string") await this.sync(meta.escrowLocalId).catch(() => undefined);
    });
    execution.events.on("status", (op: { kind: string; status: string; id: string }) => {
      if (op.kind === "escrow_fund" && op.status === "settled") {
        const row = this.db.get<{ id: string }>("SELECT id FROM escrows WHERE operation_id = ?", [op.id]);
        if (row) void this.sync(row.id).catch(() => undefined);
      }
    });
  }

  private target(mode: "wallet" | "agent"): { network: Network; contractId: string } {
    if (mode === "agent") {
      if (!this.opts.agentContractId) throw notConfigured("agent escrow contract (AGENT_ESCROW_CONTRACT_ID, mainnet — the Agent API is mainnet-only)");
      return { network: "mainnet", contractId: this.opts.agentContractId };
    }
    if (!this.opts.contractId) throw notConfigured("escrow contract (ESCROW_CONTRACT_ID)");
    return { network: this.opts.network, contractId: this.opts.contractId };
  }

  row(id: string) {
    return this.db.get<Record<string, string>>("SELECT * FROM escrows WHERE id = ?", [id]);
  }

  view(r: Record<string, string>) {
    return { ...r, asset: parse(r.asset_json), terms: parse(r.terms_json), onchain: r.onchain_json ? parse(r.onchain_json) : null, asset_json: undefined, terms_json: undefined, onchain_json: undefined };
  }

  list(user: User) {
    return this.db.all<Record<string, string>>("SELECT * FROM escrows WHERE user_id = ? OR provider_account = ? ORDER BY created_at DESC", [user.id, user.accountId]).map((r) => this.view(r));
  }

  get(user: User, id: string) {
    const r = this.row(id);
    if (!r) throw notFound("escrow");
    if (r.user_id !== user.id && r.provider_account !== user.accountId && r.approver !== user.accountId) throw forbidden("not a party to this escrow");
    return this.view(r);
  }

  /** Builds the agreement, its hash and the funding transaction (or agent execution). */
  async prepare(user: User, input: PrepareEscrowInput) {
    const { network, contractId } = this.target(input.fundingMode);
    if (input.provider === user.accountId) throw badRequest("invalid_provider", "you cannot hire yourself");
    const asset: EscrowAsset = input.asset ?? { kind: "native" };
    let total = input.totalAtomic;
    let priceNote: string | null = null;
    if (!total) {
      if (input.amountUsd == null) throw badRequest("amount_required", "amountUsd or totalAtomic is required");
      if (asset.kind !== "native") throw badRequest("amount_required", "give totalAtomic for token escrows");
      const price = await this.tokens.nearUsd();
      if (!price) throw conflict("price_unavailable", "NEAR price unavailable; give totalAtomic");
      total = toAtomic((input.amountUsd / price).toFixed(6), YOCTO);
      priceNote = `Converted at $${price}/NEAR (NEAR Intents price feed${network === "testnet" ? "; testnet NEAR has no market value" : ""}).`;
    }
    const totalBig = BigInt(total);
    if (totalBig <= 0n) throw badRequest("invalid_amount", "amount must be positive");
    // Split by milestone share; the last milestone absorbs rounding.
    const shares = input.milestones;
    const sum = shares.reduce((n, m) => n + m.sharePct, 0);
    if (Math.abs(sum - 100) > 0.01) throw badRequest("invalid_milestones", "milestone shares must sum to 100");
    let allocated = 0n;
    const milestones = shares.map((m, i) => {
      const amount = i === shares.length - 1 ? totalBig - allocated : (totalBig * BigInt(Math.round(m.sharePct * 100))) / 10_000n;
      allocated += amount;
      return { title: m.title.slice(0, 120), amount: amount.toString() };
    });

    let payer = user.accountId;
    let refundTo = user.accountId;
    if (input.fundingMode === "agent") {
      if (!input.agentId) throw badRequest("agent_required", "agentId is required for agent funding");
      const agent = this.agents.assertOwner(user, input.agentId);
      if (!agent.near_account_id) throw conflict("agent_wallet_missing", "the agent's NEAR account is not known yet");
      payer = agent.near_account_id;
      refundTo = agent.near_account_id; // unearned funds return inside the agent's policy
    }
    const deadline = Date.now() + input.deadlineDays * 86_400_000;
    const terms = {
      standard: "veyra-undo-agreement/1",
      network,
      contractId,
      payer,
      approver: user.accountId,
      provider: input.provider,
      reviewer: input.reviewer ?? null,
      arbiter: input.arbiter ?? null,
      refundTo,
      asset,
      total,
      totalFormatted: asset.kind === "native" ? `${fromAtomic(total, YOCTO)} NEAR` : total,
      amountUsd: input.amountUsd ?? null,
      milestones,
      description: input.description.slice(0, 2000),
      completionConditions: input.completionConditions,
      evidenceRequirements: input.evidenceRequirements,
      deadline: new Date(deadline).toISOString(),
      reviewPeriodDays: input.reviewPeriodDays ?? 3,
      acceptanceRules: "Each milestone is paid only when the approver or reviewer accepts submitted evidence, or when the review period lapses after a submission without a response.",
      disputeRules: "Any party may open a dispute, which freezes releases. The arbiter (or the contract owner if none) splits outstanding funds.",
      refundRules: "After the deadline, milestones never submitted (or rejected) are refunded to refundTo. Completed transfers cannot be reversed.",
      createdAt: now(),
    };
    const termsHash = hashObject(terms);
    const args = {
      provider: input.provider,
      asset: asset.kind === "native" ? { kind: "native" } : { kind: "ft", contract_id: asset.contract_id },
      milestones: milestones.map((m) => ({ title: m.title, amount: m.amount })),
      deadline_ns: (BigInt(deadline) * 1_000_000n).toString(),
      terms_hash: termsHash,
      review_period_ns: (BigInt(Math.round(terms.reviewPeriodDays * 86_400_000)) * 1_000_000n).toString(),
      approver: user.accountId,
      reviewer: input.reviewer ?? null,
      arbiter: input.arbiter ?? null,
      refund_to: refundTo,
    };
    const id = randomId("esc_");
    this.db.run(
      `INSERT INTO escrows (id, user_id, job_id, network, contract_id, payer, approver, provider_account, asset_json, total, terms_json, terms_hash, funding_mode, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, user.id, input.jobId ?? null, network, contractId, payer, user.accountId, input.provider, json(asset), total, json(terms), termsHash, input.fundingMode, "draft", now(), now()],
    );
    this.audit.record({ userId: user.id, actor: "user", action: "escrow.prepared", subject: id, data: { termsHash, provider: input.provider, total, fundingMode: input.fundingMode } });

    const deposit = asset.kind === "native" ? (totalBig + BigInt(STORAGE_BUFFER)).toString() : STORAGE_BUFFER;
    const createTx = call(contractId, "create_escrow", args, deposit, GAS_CREATE);
    const result: Record<string, unknown> = { escrowId: id, terms, termsHash, priceNote, network, contractId };

    if (input.fundingMode === "wallet") {
      result.walletTransactions = [createTx];
      if (asset.kind === "ft") result.fundingNote = "After creation, fund it with ft_transfer_call on the token contract (msg {\"escrow_id\":\"<id>\"}).";
      return result;
    }
    // Agent funding: a native NEAR call from the agent's account, gated by BODYGUARD and the
    // Agent API policy (native.near.call must list this contract).
    if (asset.kind !== "native") throw badRequest("unsupported", "agent funding supports native NEAR escrows");
    const op = await this.execution.execute(
      user,
      input.agentId!,
      {
        kind: "escrow_fund",
        contractId,
        escrowLocalId: id,
        provider: input.provider,
        approver: user.accountId,
        deposit,
        expectedDeposit: deposit,
        methodName: "create_escrow",
        args,
        gas: GAS_CREATE,
      },
      { origin: "user", reason: `Fund UNDO escrow for ${input.provider}`, jobId: input.jobId ?? undefined },
    );
    this.db.run("UPDATE escrows SET operation_id = ?, status = ?, updated_at = ? WHERE id = ?", [op.id, op.status === "blocked" ? "blocked" : "funding", now(), id]);
    result.operation = op;
    return result;
  }

  /** The wallet returns the tx hash; we read the chain to learn the on-chain escrow id. */
  async confirmCreate(user: User, id: string, txHash: string) {
    const r = this.row(id);
    if (!r || r.user_id !== user.id) throw notFound("escrow");
    const network = r.network as Network;
    const outcome = await this.tracker.rpc(network).txStatus(txHash, user.accountId, "EXECUTED_OPTIMISTIC");
    const created = extractEvents(outcome, r.contract_id).find((e) => e.standard === "veyra_escrow" && e.event === "escrow_created");
    if (!created) throw badRequest("no_escrow_event", "the transaction did not create an escrow on the expected contract");
    const ev = created.data[0] as { escrow_id: string; provider: string; total: string; payer: string };
    if (ev.provider !== r.provider_account || ev.total !== r.total || ev.payer !== user.accountId) throw badRequest("terms_mismatch", "on-chain escrow does not match the prepared agreement");
    this.db.run("UPDATE escrows SET onchain_id = ?, create_tx_hash = ?, status = 'created', updated_at = ? WHERE id = ?", [String(ev.escrow_id), txHash, now(), id]);
    this.tracker.track(user.id, { kind: "escrow_create", txHash, signerId: user.accountId, network, destination: r.contract_id, amount: r.total, asset: "NEAR", meta: { escrowLocalId: id } });
    this.tracker.storeEvents(network, txHash, outcome);
    return this.sync(id);
  }

  /** Reads the authoritative state from the contract. */
  async sync(id: string) {
    const r = this.row(id);
    if (!r) throw notFound("escrow");
    const rpc = this.tracker.rpc(r.network as Network);
    let onchainId: string | null = r.onchain_id ?? null;
    if (!onchainId) {
      // Agent-funded escrows: find it by its terms hash.
      const list = await rpc.view<{ id: string; terms_hash: string }[]>(r.contract_id, "get_escrows_for", { account_id: r.approver }).catch(() => []);
      onchainId = list.find((e) => e.terms_hash === r.terms_hash)?.id ?? null;
      if (!onchainId) return this.view(r);
      this.db.run("UPDATE escrows SET onchain_id = ? WHERE id = ?", [onchainId, id]);
    }
    const state = await rpc.view<{ status: string; terms_hash: string }>(r.contract_id, "get_escrow", { escrow_id: onchainId });
    if (!state) return this.view(r);
    if (state.terms_hash !== r.terms_hash) throw conflict("terms_mismatch", "on-chain terms hash differs from the agreement");
    if (state.status !== r.status) {
      this.audit.record({ userId: r.user_id, actor: "contract", action: `escrow.${state.status}`, subject: id, data: { onchainId } });
      this.notifier.notify(r.user_id, "escrow.status", "Escrow updated", `Escrow ${onchainId} is now ${state.status.replace(/_/g, " ")}.`, { escrowId: id });
      if (r.job_id && ["completed"].includes(state.status)) this.db.run("UPDATE jobs SET status = 'completed', updated_at = ? WHERE id = ?", [now(), r.job_id]);
    }
    this.db.run("UPDATE escrows SET status = ?, onchain_json = ?, updated_at = ? WHERE id = ?", [state.status, json(state), now(), id]);
    return this.view(this.row(id)!);
  }

  activeEscrows() {
    return this.db.all<{ id: string }>("SELECT id FROM escrows WHERE status IN ('created','awaiting_funding','active','disputed','funding')");
  }

  /**
   * Builds the contract call for a party's wallet. Role checks here are a convenience; the
   * contract enforces them independently.
   */
  action(user: User, id: string, action: string, params: { milestoneIndex?: number; reason?: string; evidenceHash?: string; evidenceUri?: string | null; providerAmount?: string; note?: string }) {
    const r = this.row(id);
    if (!r) throw notFound("escrow");
    if (!r.onchain_id) throw conflict("not_on_chain", "the escrow is not on-chain yet");
    const eid = r.onchain_id;
    const isApprover = r.approver === user.accountId;
    const isProvider = r.provider_account === user.accountId;
    const terms = parse<{ reviewer: string | null; arbiter: string | null }>(r.terms_json);
    const isReviewer = terms.reviewer === user.accountId;
    const idx = params.milestoneIndex ?? 0;
    const need = (ok: boolean, who: string) => { if (!ok) throw forbidden(`only the ${who} can do this`); };
    let tx: WalletTx;
    switch (action) {
      case "accept": need(isApprover || isReviewer, "approver or reviewer"); tx = call(r.contract_id, "accept_milestone", { escrow_id: eid, milestone_index: idx }); break;
      case "reject": need(isApprover || isReviewer, "approver or reviewer"); tx = call(r.contract_id, "reject_milestone", { escrow_id: eid, milestone_index: idx, reason: params.reason ?? "Does not meet the agreed conditions" }); break;
      case "dispute": need(isApprover || isReviewer || isProvider, "a party"); tx = call(r.contract_id, "open_dispute", { escrow_id: eid, milestone_index: params.milestoneIndex ?? null, reason: params.reason ?? "Disagreement about completion" }); break;
      case "refund_expired": tx = call(r.contract_id, "refund_expired", { escrow_id: eid }); break;
      case "cancel": need(isApprover, "approver"); tx = call(r.contract_id, "cancel_escrow", { escrow_id: eid }); break;
      case "submit_evidence":
        need(isProvider, "provider");
        if (!params.evidenceHash) throw badRequest("evidence_required", "evidenceHash is required");
        tx = call(r.contract_id, "submit_evidence", { escrow_id: eid, milestone_index: idx, evidence_hash: params.evidenceHash, evidence_uri: params.evidenceUri ?? null }, toAtomic("0.01", YOCTO));
        break;
      case "claim": need(isProvider, "provider"); tx = call(r.contract_id, "claim_after_review_period", { escrow_id: eid, milestone_index: idx }); break;
      case "provider_withdraw": need(isProvider, "provider"); tx = call(r.contract_id, "provider_withdraw", { escrow_id: eid }); break;
      case "resolve":
        need(terms.arbiter === user.accountId, "arbiter");
        tx = call(r.contract_id, "resolve_dispute", { escrow_id: eid, provider_amount: params.providerAmount ?? "0", note: params.note ?? "Resolved by arbiter" });
        break;
      default: throw badRequest("unknown_action", action);
    }
    this.audit.record({ userId: user.id, actor: "user", action: `escrow.action_prepared.${action}`, subject: id, data: { milestoneIndex: idx } });
    return { walletTransactions: [tx], network: r.network };
  }

  /** Records a wallet-signed escrow action and follows it to finality. */
  recordTx(user: User, id: string, action: string, txHash: string) {
    const r = this.row(id);
    if (!r) throw notFound("escrow");
    const opId = this.tracker.track(user.id, { kind: `escrow_${action}`, txHash, signerId: user.accountId, network: r.network as Network, destination: r.contract_id, meta: { escrowLocalId: id } });
    return { operationId: opId };
  }

  events(id: string) {
    const r = this.row(id);
    if (!r) throw notFound("escrow");
    return this.db
      .all<Record<string, string>>("SELECT * FROM chain_events WHERE contract_id = ? AND standard = 'veyra_escrow' AND json_extract(data_json, '$[0].escrow_id') = ? ORDER BY id", [r.contract_id, r.onchain_id ?? "-"])
      .map((e) => ({ ...e, data: parse(e.data_json), data_json: undefined }));
  }
}
