import type { Db } from "../db.js";
import { now } from "../db.js";
import { conflict } from "../lib/errors.js";
import type { AgentService } from "../services/agents.js";
import type { AuditLog } from "../services/audit.js";
import type { User } from "../services/auth.js";
import type { ExecutionService } from "../services/execution.js";
import type { SimChain } from "../sim/chain.js";
import type { SpendAccount } from "./spend-account.js";

/**
 * Three-tier treasury.
 *   Vault (policy-bound, owner-signed)  →  spend account (bounded float, signs x402)  →  market
 * The vault only ever pays the spend account, and only what the next payment needs.
 */
export interface FundResult {
  status: "settled" | "pending" | "blocked" | "failed";
  ref: string | null;
  detail: string;
}

export interface Vault {
  readonly kind: "sim" | "agent-api";
  balance(): Promise<bigint | null>;
  fund(recipient: string, amountAtomic: bigint, reason: string): Promise<FundResult>;
  describe(): Record<string, unknown>;
}

/** Simulated policy vault with the same rules a signed Agent API policy would impose. */
export class SimVault implements Vault {
  readonly kind = "sim" as const;
  private spentToday = 0n;
  private day = new Date().toISOString().slice(0, 10);
  frozen = false;

  constructor(private readonly chain: SimChain, private readonly token: string, readonly accountId: string, private readonly policy: { destinations: string[]; dailyCapAtomic: bigint; perTxAtomic: bigint }) {}

  balance() {
    return this.chain.ftBalance(this.token, this.accountId);
  }

  describe() {
    return { kind: this.kind, accountId: this.accountId, destinations: this.policy.destinations, dailyCapUsdc: Number(this.policy.dailyCapAtomic) / 1e6, perTxUsdc: Number(this.policy.perTxAtomic) / 1e6, spentTodayUsdc: Number(this.spentToday) / 1e6, frozen: this.frozen };
  }

  async fund(recipient: string, amount: bigint, _reason: string): Promise<FundResult> {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.day) { this.day = today; this.spentToday = 0n; }
    if (this.frozen) return { status: "blocked", ref: null, detail: "vault frozen by owner" };
    if (!this.policy.destinations.includes(recipient)) return { status: "blocked", ref: null, detail: `policy_destination_denied: ${recipient}` };
    if (amount > this.policy.perTxAtomic) return { status: "blocked", ref: null, detail: "policy_limit_exceeded (per transaction)" };
    if (this.spentToday + amount > this.policy.dailyCapAtomic) return { status: "blocked", ref: null, detail: "spend_budget_exceeded (daily)" };
    if ((await this.balance()) < amount) return { status: "failed", ref: null, detail: "insufficient_balance" };
    this.spentToday += amount;
    return { status: "settled", ref: this.chain.custodyTransfer(this.token, this.accountId, recipient, amount), detail: "withdrawn to spend account" };
  }
}

/**
 * The real vault: a NEAR Intents Agent API wallet. Refills go through Veyra's execution service
 * (BODYGUARD + idempotency + status tracking) and the owner-signed Agent API policy.
 */
export class AgentApiVault implements Vault {
  readonly kind = "agent-api" as const;
  constructor(
    private readonly agents: AgentService,
    private readonly execution: ExecutionService,
    private readonly owner: () => { user: User; agentId: string } | null,
    private readonly assetId: string,
  ) {}

  describe() {
    const o = this.owner();
    return { kind: this.kind, agentId: o?.agentId ?? null, configured: Boolean(o) && this.agents.configured };
  }

  async balance() {
    const o = this.owner();
    if (!o) return null;
    const b = await this.agents.api().getBalances(o.agentId).catch(() => null);
    const row = b?.balances.find((x) => x.asset_id === this.assetId);
    return row ? BigInt(row.available_raw) : 0n;
  }

  async fund(recipient: string, amount: bigint, reason: string): Promise<FundResult> {
    const o = this.owner();
    if (!o) return { status: "blocked", ref: null, detail: "no vault agent configured" };
    const op = await this.execution.execute(o.user, o.agentId, { kind: "withdraw", asset: this.assetId, amount: amount.toString(), chain: "near", recipient }, { origin: "system", reason });
    if (op.status === "blocked" || op.status === "rejected_by_api") return { status: "blocked", ref: op.id, detail: op.error ?? "blocked by BODYGUARD or the Agent API policy" };
    if (op.status === "pending_approval") return { status: "pending", ref: op.id, detail: "waiting for the owner's approval" };
    // Follow the withdrawal to settlement (the Agent API long-polls up to 30 s per call).
    for (let i = 0; i < 6 && op.correlation_id; i++) {
      const s = await this.agents.api().getStatus(op.correlation_id, { waitMs: 20_000 });
      this.execution.applyStatus(op.id, s);
      if (s.status === "SUCCESS") return { status: "settled", ref: op.id, detail: "withdrawn to spend account" };
      if (["FAILED", "REFUNDED", "NEEDS_REVIEW"].includes(s.status)) return { status: "failed", ref: op.id, detail: s.failure_code ?? s.status };
    }
    return { status: "pending", ref: op.id, detail: "withdrawal still processing" };
  }
}

export class Treasury {
  constructor(
    private readonly db: Db,
    readonly spend: SpendAccount,
    readonly vault: Vault,
    private readonly asset: string,
    private readonly audit: AuditLog,
    /** Never keep more than this in the spend account. */
    private readonly maxFloatAtomic: bigint,
  ) {}

  /** Makes sure the spend account holds at least `amount`, refilling only the shortfall. */
  async ensureFloat(amount: bigint, reason: string): Promise<FundResult> {
    if (amount > this.maxFloatAtomic) throw conflict("over_float_cap", "a single payment may not exceed the spend-account float cap");
    const bal = await this.spend.usdcBalance(this.asset);
    if (bal >= amount) return { status: "settled", ref: null, detail: "float sufficient" };
    const need = amount - bal;
    const r = await this.vault.fund(this.spend.accountId, need, reason);
    this.audit.record({ actor: "system", action: `treasury.refill.${r.status}`, subject: this.spend.accountId, data: { amount: need.toString(), reason, detail: r.detail, ref: r.ref } });
    this.db.run("INSERT OR REPLACE INTO kv (key, value_json, updated_at) VALUES (?,?,?)", ["treasury.last_refill", JSON.stringify({ amount: need.toString(), ...r, at: now() }), now()]);
    return r;
  }

  async status() {
    const [spend, vaultBal] = await Promise.all([this.spend.status(this.asset), this.vault.balance().catch(() => null)]);
    return { asset: this.asset, maxFloatAtomic: this.maxFloatAtomic.toString(), vault: { ...this.vault.describe(), balanceAtomic: vaultBal?.toString() ?? null }, spend };
  }
}
