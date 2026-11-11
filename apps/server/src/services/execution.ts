import { EventEmitter } from "node:events";
import { AgentApiError, AgentApiRequestError, createIdempotencyKey, type QuoteResponse, type StatusResponse } from "@near-intents-agent-api/sdk";
import type { Db } from "../db.js";
import { json, now, parse } from "../db.js";
import { hashObject, randomId } from "../lib/crypto.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import type { AgentService } from "./agents.js";
import { toHttp } from "./agents.js";
import type { AuditLog } from "./audit.js";
import type { AuthService, SignedChallenge, User } from "./auth.js";
import type { AgentAction, Bodyguard, Preview, Verdict } from "./bodyguard/engine.js";
import type { Notifier } from "./notifications.js";
import type { TokenCatalog } from "./tokens.js";
import { fromAtomic, YOCTO } from "../lib/amounts.js";

/**
 * Operation lifecycle (Veyra statuses):
 *   blocked | pending_approval → (approved) → dispatching → submitted → confirmed → settled
 *   plus: rejected (owner said no), rejected_by_api (Agent API refused), cancelled,
 *         pending_owner_approval (Agent API owner vote), failed, refunded, uncertain, needs_review
 *
 * "submitted"  = accepted by the Agent API / provider, not yet on-chain
 * "confirmed"  = a settlement transaction hash exists but the operation is not final
 * "settled"    = the Agent API reports SUCCESS, backed by reconciled evidence
 */
export type OpStatus =
  | "blocked" | "pending_approval" | "rejected" | "cancelled" | "dispatching" | "pending_owner_approval"
  | "submitted" | "confirmed" | "settled" | "failed" | "refunded" | "uncertain" | "needs_review" | "rejected_by_api";

export const TERMINAL_OPS: OpStatus[] = ["blocked", "rejected", "cancelled", "settled", "failed", "refunded", "rejected_by_api"];

export interface OperationRow {
  id: string;
  user_id: string;
  agent_id: string | null;
  kind: string;
  origin: string;
  request_json: string;
  request_hash: string;
  idempotency_key: string;
  correlation_id: string | null;
  status: OpStatus;
  provider_status: string | null;
  usd_value: number | null;
  asset: string | null;
  amount: string | null;
  destination: string | null;
  tx_hash: string | null;
  settlement_json: string | null;
  bodyguard_json: string | null;
  approval_id: string | null;
  goal_id: string | null;
  job_id: string | null;
  reason: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExecuteMeta {
  origin: "ai" | "user" | "goal" | "system";
  reason?: string;
  goalId?: string;
  jobId?: string;
  /** Reuse to retry the same logical request safely. */
  idempotencyKey?: string;
}

/** For escrow funding the execution service also needs the call to make. */
export type ExecutableAction =
  | Exclude<AgentAction, { kind: "escrow_fund" }>
  | (Extract<AgentAction, { kind: "escrow_fund" }> & { methodName: string; args: Record<string, unknown>; gas: string });

export function mapApiStatus(s: StatusResponse): OpStatus {
  switch (s.status) {
    case "SUCCESS": return "settled";
    case "FAILED": return "failed";
    case "REFUNDED": return "refunded";
    case "UNCERTAIN": return "uncertain";
    case "NEEDS_REVIEW": return "needs_review";
    case "PENDING_APPROVAL": return "pending_owner_approval";
    case "PROCESSING": {
      const d = (s.details ?? {}) as { tx_hash?: string | null; intent_hash?: string | null };
      return d.tx_hash || d.intent_hash ? "confirmed" : "submitted";
    }
    default: return "submitted";
  }
}

export class ExecutionService {
  readonly events = new EventEmitter();

  constructor(
    private readonly db: Db,
    private readonly agents: AgentService,
    private readonly bodyguard: Bodyguard,
    private readonly tokens: TokenCatalog,
    private readonly auth: AuthService,
    private readonly audit: AuditLog,
    private readonly notifier: Notifier,
  ) {}

  get(id: string) {
    return this.db.get<OperationRow>("SELECT * FROM operations WHERE id = ?", [id]);
  }

  view(op: OperationRow) {
    return {
      ...op,
      request: parse(op.request_json),
      bodyguard: op.bodyguard_json ? parse(op.bodyguard_json) : null,
      settlement: op.settlement_json ? parse(op.settlement_json) : null,
      request_json: undefined,
      bodyguard_json: undefined,
      settlement_json: undefined,
    };
  }

  list(userId: string, filter: { agentId?: string; kind?: string; limit?: number } = {}) {
    const where = ["user_id = ?"];
    const params: string[] = [userId];
    if (filter.agentId) { where.push("agent_id = ?"); params.push(filter.agentId); }
    if (filter.kind) { where.push("kind = ?"); params.push(filter.kind); }
    return this.db
      .all<OperationRow>(`SELECT * FROM operations WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT ${Math.min(filter.limit ?? 100, 500)}`, params)
      .map((o) => this.view(o));
  }

  private async valueUsd(action: ExecutableAction, quote?: QuoteResponse | null): Promise<number | null> {
    if (quote?.spend.amount_usd) return Number(quote.spend.amount_usd);
    switch (action.kind) {
      case "swap": return this.tokens.usdValue(action.originAsset, action.amount);
      case "transfer":
      case "withdraw": return this.tokens.usdValue(action.asset, action.amount);
      case "escrow_fund": {
        const p = await this.tokens.nearUsd();
        return p == null ? null : Number(fromAtomic(action.deposit, YOCTO)) * p;
      }
    }
  }

  private async preview(agentId: string, action: ExecutableAction): Promise<{ preview: Preview; quote: QuoteResponse | null; minOut?: string }> {
    let grant;
    try {
      grant = this.agents.grantClient(agentId);
    } catch {
      return { preview: {}, quote: null };
    }
    try {
      if (action.kind === "swap") {
        const q = await grant.swap(agentId, { origin_asset: action.originAsset, destination_asset: action.destinationAsset, amount: action.amount, dry: true });
        const quote = q.quote as Record<string, unknown>;
        const expectedOut = String(quote.amount_out ?? quote.amountOut ?? quote.expected_amount_out ?? "") || null;
        const minOut = String(quote.min_amount_out ?? quote.minAmountOut ?? "") || null;
        return { quote: q, preview: { warnings: q.warnings, expectedOut, minOut, feePercent: q.fee ? Number(q.fee.percent) : null, ownerApproval: q.owner_approval } };
      }
      if (action.kind === "withdraw") {
        const q = await grant.withdraw(agentId, { asset: action.asset, amount: action.amount, chain: action.chain, recipient: action.recipient, memo: action.memo, dry: true });
        return { quote: q, preview: { warnings: q.warnings, feePercent: q.fee ? Number(q.fee.percent) : null, ownerApproval: q.owner_approval } };
      }
    } catch (e) {
      if (e instanceof AgentApiError) return { quote: null, preview: { warnings: [{ code: e.code, detail: e.message }] } };
      throw e;
    }
    return { preview: {}, quote: null };
  }

  /**
   * Single entry point for every autonomous financial action. The caller may be the user, a
   * goal or the AI orchestrator; all of them get the same checks.
   */
  async execute(user: User, agentId: string, action: ExecutableAction, meta: ExecuteMeta) {
    const agent = this.agents.assertOwner(user, agentId);
    const requestHash = hashObject({ agentId, action });

    if (meta.idempotencyKey) {
      const existing = this.db.get<OperationRow>("SELECT * FROM operations WHERE idempotency_key = ?", [meta.idempotencyKey]);
      if (existing) {
        if (existing.request_hash !== requestHash) throw conflict("idempotency_conflict", "this idempotency key was used for a different request");
        return this.view(existing);
      }
    }

    const local = this.agents.activePolicy(agentId);
    const { preview, quote } = await this.preview(agentId, action);
    const usdValue = await this.valueUsd(action, quote);
    const idempotencyKey = meta.idempotencyKey ?? createIdempotencyKey();
    const verdict = await this.bodyguard.evaluateAgentAction({
      userId: user.id,
      ownerAccountId: agent.owner_account_id,
      agentId,
      frozen: Boolean(agent.local_frozen),
      policy: local?.policy ?? null,
      action,
      usdValue,
      requestHash,
      idempotencyKey,
      preview,
      origin: meta.origin,
      aiReason: meta.reason,
    });

    // Slippage protection is enforced on the live request too, not only in the check.
    let dispatchAction = action;
    if (action.kind === "swap" && preview.expectedOut && local) {
      const minOut = (BigInt(preview.expectedOut) * BigInt(10_000 - local.policy.maxSlippageBps)) / 10_000n;
      dispatchAction = { ...action, minAmountOut: minOut.toString() } as ExecutableAction;
    }

    const status: OpStatus = verdict.decision === "block" ? "blocked" : verdict.decision === "require_approval" ? "pending_approval" : "dispatching";
    const id = randomId("op_");
    const destination = action.kind === "transfer" || action.kind === "withdraw" ? action.recipient : action.kind === "escrow_fund" ? action.contractId : null;
    const asset = action.kind === "swap" ? action.originAsset : action.kind === "escrow_fund" ? "NEAR" : action.asset;
    const amount = action.kind === "escrow_fund" ? action.deposit : action.amount;
    // Persist the idempotency key BEFORE anything is sent, so a crash can be reconciled.
    this.db.run(
      `INSERT INTO operations (id, user_id, agent_id, kind, origin, request_json, request_hash, idempotency_key, status, usd_value, asset, amount, destination, bodyguard_json, goal_id, job_id, reason, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, user.id, agentId, action.kind, meta.origin, json(dispatchAction), requestHash, idempotencyKey, status, usdValue, asset, amount, destination, json(verdict), meta.goalId ?? null, meta.jobId ?? null, meta.reason ?? null, now(), now()],
    );
    this.audit.record({
      userId: user.id,
      actor: meta.origin === "ai" ? "ai" : meta.origin === "goal" ? "agent" : "user",
      action: "operation.requested",
      subject: id,
      data: { agentId, action, usdValue, reason: meta.reason, origin: meta.origin },
    });
    this.audit.record({ userId: user.id, actor: "bodyguard", action: `bodyguard.${verdict.decision}`, subject: id, data: verdict });

    if (status === "blocked") {
      this.notifier.notify(user.id, "bodyguard.blocked", "BODYGUARD blocked an action", verdict.findings.filter((x) => x.severity === "block").map((x) => x.message).join(" "), { operationId: id });
      return this.view(this.get(id)!);
    }
    if (status === "pending_approval") {
      const approvalId = randomId("apr_");
      this.db.run(
        "INSERT INTO approvals (id, user_id, operation_id, request_hash, status, reason, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?)",
        [approvalId, user.id, id, requestHash, "pending", verdict.findings.filter((x) => x.escalate).map((x) => x.message).join(" "), now(), new Date(Date.now() + 24 * 3600_000).toISOString()],
      );
      this.db.run("UPDATE operations SET approval_id = ? WHERE id = ?", [approvalId, id]);
      this.notifier.notify(user.id, "approval.requested", "Approval needed", `The agent wants to ${describeAction(action)} (≈ $${usdValue?.toFixed(2)}). Review and sign to approve.`, { operationId: id, approvalId });
      return this.view(this.get(id)!);
    }
    return this.dispatch(id);
  }

  approvalMessage(approvalId: string, requestHash: string, verdict: "approve" | "reject") {
    return `Veyra approval\nApproval: ${approvalId}\nRequest: ${requestHash}\nDecision: ${verdict}`;
  }

  /** Issues the NEP-413 challenge the owner signs to approve or reject. */
  approvalChallenge(user: User, approvalId: string, verdict: "approve" | "reject") {
    const a = this.db.get<{ user_id: string; request_hash: string; status: string }>("SELECT * FROM approvals WHERE id = ?", [approvalId]);
    if (!a || a.user_id !== user.id) throw notFound("approval");
    if (a.status !== "pending") throw conflict("approval_closed", `approval is ${a.status}`);
    return this.auth.createChallenge(user.accountId, "approval", this.approvalMessage(approvalId, a.request_hash, verdict));
  }

  async decide(user: User, approvalId: string, verdict: "approve" | "reject", signed: SignedChallenge) {
    const a = this.db.get<{ user_id: string; operation_id: string; request_hash: string; status: string; expires_at: string }>("SELECT * FROM approvals WHERE id = ?", [approvalId]);
    if (!a || a.user_id !== user.id) throw notFound("approval");
    if (a.status !== "pending") throw conflict("approval_closed", `approval is ${a.status}`);
    if (Date.parse(a.expires_at) < Date.now()) {
      this.db.run("UPDATE approvals SET status = 'expired' WHERE id = ?", [approvalId]);
      throw conflict("approval_expired", "approval expired");
    }
    const sig = await this.auth.verifyOwnerAction(user, "approval", signed, this.approvalMessage(approvalId, a.request_hash, verdict));
    this.db.run("UPDATE approvals SET status = ?, signature_json = ?, decided_at = ? WHERE id = ?", [verdict === "approve" ? "approved" : "rejected", json(sig), now(), approvalId]);
    this.audit.record({ userId: user.id, actor: "user", action: `approval.${verdict}`, subject: a.operation_id, data: { approvalId, publicKey: sig.publicKey } });
    if (verdict === "reject") {
      this.db.run("UPDATE operations SET status = 'rejected', updated_at = ? WHERE id = ?", [now(), a.operation_id]);
      return this.view(this.get(a.operation_id)!);
    }
    // Approval satisfies only the escalation; every other rule is re-checked now.
    const op = this.get(a.operation_id)!;
    const agent = this.agents.assertOwner(user, op.agent_id!);
    const action = parse<ExecutableAction>(op.request_json);
    const verdict2 = await this.bodyguard.evaluateAgentAction({
      userId: user.id,
      ownerAccountId: agent.owner_account_id,
      agentId: op.agent_id!,
      frozen: Boolean(agent.local_frozen),
      policy: this.agents.activePolicy(op.agent_id!)?.policy ?? null,
      action,
      usdValue: op.usd_value,
      requestHash: op.request_hash,
      idempotencyKey: op.idempotency_key,
      origin: op.origin as ExecuteMeta["origin"],
      aiReason: op.reason ?? undefined,
      ownerApproved: true,
    });
    if (verdict2.decision !== "allow") {
      this.db.run("UPDATE operations SET status = 'blocked', bodyguard_json = ?, updated_at = ? WHERE id = ?", [json(verdict2), now(), op.id]);
      this.audit.record({ userId: user.id, actor: "bodyguard", action: "bodyguard.block_after_approval", subject: op.id, data: verdict2 });
      return this.view(this.get(op.id)!);
    }
    this.db.run("UPDATE operations SET status = 'dispatching', updated_at = ? WHERE id = ?", [now(), op.id]);
    return this.dispatch(op.id);
  }

  private async dispatch(id: string) {
    const op = this.get(id)!;
    const agentId = op.agent_id!;
    if (this.agents.isFrozen(agentId)) {
      this.db.run("UPDATE operations SET status = 'blocked', error = 'agent frozen', updated_at = ? WHERE id = ?", [now(), id]);
      return this.view(this.get(id)!);
    }
    const action = parse<ExecutableAction & { minAmountOut?: string }>(op.request_json);
    const opts = { idempotencyKey: op.idempotency_key };
    try {
      const grant = this.agents.grantClient(agentId);
      let res: StatusResponse;
      switch (action.kind) {
        case "swap":
          res = (await grant.swap(agentId, { origin_asset: action.originAsset, destination_asset: action.destinationAsset, amount: action.amount, min_amount_out: action.minAmountOut }, opts)) as StatusResponse;
          break;
        case "transfer":
          res = (await grant.transfer(agentId, { asset: action.asset, amount: action.amount, recipient: action.recipient }, opts)) as StatusResponse;
          break;
        case "withdraw":
          res = (await grant.withdraw(agentId, { asset: action.asset, amount: action.amount, chain: action.chain, recipient: action.recipient, memo: action.memo }, opts)) as StatusResponse;
          break;
        case "escrow_fund":
          res = (await grant.nativeNearCall(agentId, { receiver_id: action.contractId, method_name: action.methodName, args: action.args, gas: action.gas, deposit: action.deposit }, opts)) as StatusResponse;
          break;
      }
      this.applyStatus(id, res);
    } catch (e) {
      if (e instanceof AgentApiError) {
        const refused = ["policy", "budget", "balance", "grant", "request", "auth"].includes(e.layer ?? "");
        this.db.run("UPDATE operations SET status = ?, error = ?, updated_at = ? WHERE id = ?", [refused && !e.retryable ? "rejected_by_api" : "uncertain", `${e.code}: ${e.message}`, now(), id]);
        this.audit.record({ userId: op.user_id, actor: "system", action: "operation.api_error", subject: id, data: { code: e.code, layer: e.layer, retryable: e.retryable } });
        if (refused) this.notifier.notify(op.user_id, "operation.refused", "The Agent API refused the action", `${e.code} (${e.layer})`, { operationId: id });
      } else if (e instanceof AgentApiRequestError) {
        // The request may have reached the API. Keep the key and reconcile; never resend under a new key.
        this.db.run("UPDATE operations SET status = 'uncertain', error = ?, updated_at = ? WHERE id = ?", [e.message, now(), id]);
      } else {
        const err = toHttp(e);
        this.db.run("UPDATE operations SET status = 'failed', error = ?, updated_at = ? WHERE id = ?", [err.message, now(), id]);
      }
    }
    return this.view(this.get(id)!);
  }

  /** Same body + same key: safe to repeat after a transport failure. */
  async retryUncertain(user: User, id: string) {
    const op = this.get(id);
    if (!op || op.user_id !== user.id) throw notFound("operation");
    if (op.status !== "uncertain" || op.correlation_id) throw badRequest("not_retryable", "only uncertain operations without a correlation id can be replayed");
    return this.dispatch(id);
  }

  applyStatus(id: string, s: StatusResponse) {
    const op = this.get(id);
    if (!op) return;
    const next = mapApiStatus(s);
    const d = (s.details ?? {}) as Record<string, unknown>;
    const txHash = (d.tx_hash as string | undefined) ?? (d.destination_tx_hash as string | undefined) ?? op.tx_hash;
    const ts = now();
    this.db.run(
      `UPDATE operations SET status = ?, provider_status = ?, correlation_id = COALESCE(correlation_id, ?), tx_hash = ?, settlement_json = ?, error = ?, updated_at = ?,
        submitted_at = COALESCE(submitted_at, ?), confirmed_at = CASE WHEN ? IN ('confirmed','settled') THEN COALESCE(confirmed_at, ?) ELSE confirmed_at END,
        settled_at = CASE WHEN ? = 'settled' THEN COALESCE(settled_at, ?) ELSE settled_at END WHERE id = ?`,
      [next, s.status, s.correlation_id, txHash ?? null, json({ details: d, failure_code: s.failure_code }), s.failure_code, ts, ts, next, ts, next, ts, id],
    );
    if (next !== op.status) {
      this.audit.record({ userId: op.user_id, actor: "system", action: `operation.${next}`, subject: id, data: { providerStatus: s.status, txHash, failure: s.failure_code, amountOut: d.amount_out } });
      this.notifier.emit(op.user_id, "operation.status", { operationId: id, status: next });
      if (next === "settled") this.notifier.notify(op.user_id, "operation.settled", "Agent action settled", `${op.kind} completed${txHash ? ` (tx ${txHash})` : ""}.`, { operationId: id });
      if (["failed", "refunded", "needs_review"].includes(next)) this.notifier.notify(op.user_id, "operation.failed", `Agent action ${next}`, s.failure_code ?? next, { operationId: id });
      this.events.emit("status", { ...op, status: next });
    }
  }

  /** Non-terminal agent operations that the monitor should poll. */
  pendingAgentOps() {
    return this.db.all<OperationRow>(
      "SELECT * FROM operations WHERE agent_id IS NOT NULL AND correlation_id IS NOT NULL AND status IN ('submitted','confirmed','pending_owner_approval','uncertain','needs_review')",
    );
  }

  /** Owner cancels a Veyra-held approval request. */
  cancel(user: User, id: string) {
    const op = this.get(id);
    if (!op || op.user_id !== user.id) throw notFound("operation");
    if (op.status !== "pending_approval") throw forbidden("only operations waiting for Veyra approval can be cancelled here; use execution_cancel for timelocked ones");
    this.db.run("UPDATE operations SET status = 'cancelled', updated_at = ? WHERE id = ?", [now(), id]);
    this.db.run("UPDATE approvals SET status = 'expired', decided_at = ? WHERE operation_id = ?", [now(), id]);
    return this.view(this.get(id)!);
  }

  listApprovals(userId: string) {
    return this.db.all("SELECT a.*, o.kind, o.usd_value, o.request_json, o.agent_id FROM approvals a JOIN operations o ON o.id = a.operation_id WHERE a.user_id = ? ORDER BY a.created_at DESC LIMIT 100", [userId]).map((r) => ({ ...r, request: parse((r as { request_json: string }).request_json), request_json: undefined }));
  }

  /** For verdict display without execution (dry run of the BODYGUARD + API preview). */
  async simulate(user: User, agentId: string, action: ExecutableAction, origin: ExecuteMeta["origin"] = "user"): Promise<{ verdict: Verdict; usdValue: number | null; preview: Preview }> {
    const agent = this.agents.assertOwner(user, agentId);
    const { preview, quote } = await this.preview(agentId, action);
    const usdValue = await this.valueUsd(action, quote);
    const verdict = await this.bodyguard.evaluateAgentAction({
      userId: user.id, ownerAccountId: agent.owner_account_id, agentId, frozen: Boolean(agent.local_frozen),
      policy: this.agents.activePolicy(agentId)?.policy ?? null, action, usdValue, requestHash: hashObject({ agentId, action, simulate: Date.now() }), preview, origin,
    });
    return { verdict, usdValue, preview };
  }
}

export function describeAction(a: ExecutableAction | AgentAction): string {
  switch (a.kind) {
    case "swap": return `swap ${a.amount} of ${a.originAsset} for ${a.destinationAsset}`;
    case "transfer": return `transfer ${a.amount} of ${a.asset} to ${a.recipient}`;
    case "withdraw": return `withdraw ${a.amount} of ${a.asset} to ${a.recipient} on ${a.chain}`;
    case "escrow_fund": return `fund escrow at ${a.contractId} for provider ${a.provider}`;
  }
}
