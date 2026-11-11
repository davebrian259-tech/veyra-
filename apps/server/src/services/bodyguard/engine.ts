import type { Db } from "../../db.js";
import { now } from "../../db.js";
import type { NearRpc } from "../../lib/near-rpc.js";
import type { VeyraPolicy } from "../policy.js";
import { classifyAddress, findLookalike, validateForChain, WELL_KNOWN_NEAR } from "./address.js";

/**
 * BODYGUARD — deterministic security checks, independent of any AI model.
 *
 * Every autonomous action is evaluated here before it may leave the backend. The result is a
 * pure function of the request, the owner's policy, the account's history and chain state.
 * There is no parameter through which an AI recommendation can relax a failed rule; the AI's
 * stated reason is only ever *scanned* for manipulation markers, which can add findings but
 * never remove them.
 */

export type Severity = "info" | "warn" | "high" | "block";
export interface Finding {
  rule: string;
  severity: Severity;
  message: string;
  /** Rule wants the owner to confirm (escalation) rather than block outright. */
  escalate?: boolean;
  data?: Record<string, unknown>;
}
export interface Verdict {
  decision: "allow" | "require_approval" | "block";
  riskScore: number;
  findings: Finding[];
  evaluatedAt: string;
}

export type AgentAction =
  | { kind: "swap"; originAsset: string; destinationAsset: string; amount: string }
  | { kind: "transfer"; asset: string; amount: string; recipient: string }
  | { kind: "withdraw"; asset: string; amount: string; chain: string; recipient: string; memo?: string }
  | {
      kind: "escrow_fund";
      contractId: string;
      escrowLocalId: string;
      provider: string;
      approver: string;
      deposit: string;
      expectedDeposit: string;
    };

export interface Preview {
  /** Agent API dry-run warnings (`quote.warnings[].code`). */
  warnings?: { code: string; detail: string }[];
  expectedOut?: string | null;
  minOut?: string | null;
  feePercent?: number | null;
  ownerApproval?: boolean;
}

export interface AgentContext {
  userId: string;
  ownerAccountId: string;
  agentId: string;
  frozen: boolean;
  policy: VeyraPolicy | null;
  action: AgentAction;
  usdValue: number | null;
  requestHash: string;
  idempotencyKey?: string;
  preview?: Preview;
  origin: "ai" | "user" | "goal" | "system";
  aiReason?: string;
  /** Set once the owner has signed an approval for exactly this request. */
  ownerApproved?: boolean;
}

const SPENDING_STATUSES = ["dispatching", "submitted", "confirmed", "settled", "pending_owner_approval", "uncertain", "needs_review"];
const INJECTION_MARKERS = [
  /ignore (all |any )?(previous|prior|above) (instructions|rules)/i,
  /override (the )?(policy|limit|rules|bodyguard)/i,
  /bypass/i,
  /disable (the )?(security|bodyguard|limits?)/i,
  /system prompt/i,
  /you are now/i,
  /developer mode/i,
  /urgent(ly)?[, ]+send/i,
];

export class Bodyguard {
  constructor(private readonly db: Db, private readonly rpc: NearRpc | null) {}

  // ------------------------------------------------------------------ lists

  list(userId: string, kind?: string) {
    return this.db.all(`SELECT * FROM bodyguard_lists WHERE user_id = ? ${kind ? "AND kind = ?" : ""} ORDER BY created_at DESC`, kind ? [userId, kind] : [userId]);
  }

  addToList(userId: string, kind: "block_destination" | "trusted_destination", value: string, label?: string) {
    this.db.run("INSERT OR REPLACE INTO bodyguard_lists (user_id, kind, value, label, created_at) VALUES (?,?,?,?,?)", [userId, kind, value.trim(), label ?? null, now()]);
  }

  removeFromList(userId: string, id: number) {
    this.db.run("DELETE FROM bodyguard_lists WHERE user_id = ? AND id = ?", [userId, id]);
  }

  blockGlobal(value: string, reason: string, source: string) {
    this.db.run("INSERT OR REPLACE INTO global_blocklist (value, reason, source, created_at) VALUES (?,?,?,?)", [value.toLowerCase(), reason, source, now()]);
  }

  private blocked(userId: string, address: string): string | null {
    const a = address.toLowerCase();
    const g = this.db.get<{ reason: string }>("SELECT reason FROM global_blocklist WHERE value = ?", [a]);
    if (g) return g.reason;
    const u = this.db.get<{ label: string | null }>("SELECT label FROM bodyguard_lists WHERE user_id = ? AND kind = 'block_destination' AND lower(value) = ?", [userId, a]);
    return u ? (u.label ?? "on your block list") : null;
  }

  private trusted(userId: string, policy: VeyraPolicy | null): string[] {
    const own = this.db.all<{ value: string }>("SELECT value FROM bodyguard_lists WHERE user_id = ? AND kind = 'trusted_destination'", [userId]).map((r) => r.value);
    const fromPolicy = policy?.destinations.map((d) => d.address) ?? [];
    const history = this.db
      .all<{ destination: string }>("SELECT DISTINCT destination FROM operations WHERE user_id = ? AND status = 'settled' AND destination IS NOT NULL LIMIT 200", [userId])
      .map((r) => r.destination);
    return [...new Set([...WELL_KNOWN_NEAR, ...own, ...fromPolicy, ...(policy?.escrowContracts ?? []), ...history])];
  }

  /** USD spent by the agent since `sinceIso` (anything dispatched or awaiting dispatch counts). */
  spentSince(agentId: string, sinceIso: string, excludeHash?: string): number {
    const r = this.db.get<{ s: number | null }>(
      `SELECT SUM(usd_value) AS s FROM operations WHERE agent_id = ? AND created_at >= ? AND status IN (${SPENDING_STATUSES.map(() => "?").join(",")}) ${excludeHash ? "AND request_hash != ?" : ""}`,
      [agentId, sinceIso, ...SPENDING_STATUSES, ...(excludeHash ? [excludeHash] : [])],
    );
    return r?.s ?? 0;
  }

  // ------------------------------------------------------------------ autonomous actions

  async evaluateAgentAction(ctx: AgentContext): Promise<Verdict> {
    const f: Finding[] = [];
    const p = ctx.policy;
    const a = ctx.action;

    // 1. Kill switch and policy presence.
    if (ctx.frozen) f.push({ rule: "agent_frozen", severity: "block", message: "The agent is frozen. Nothing can be executed until the owner unfreezes it." });
    if (!p) f.push({ rule: "policy_missing", severity: "block", message: "The agent has no active owner-approved policy." });

    if (p) {
      // 2. Action type.
      const needed = a.kind === "escrow_fund" ? null : a.kind;
      if (needed && !p.actions.includes(needed)) f.push({ rule: "action_not_permitted", severity: "block", message: `The policy does not allow "${needed}".` });

      // 3. Assets.
      const spent = a.kind === "swap" ? a.originAsset : a.kind === "escrow_fund" ? null : a.asset;
      const assets = a.kind === "swap" ? [a.originAsset, a.destinationAsset] : spent ? [spent] : [];
      if (p.assets !== "any") for (const asset of assets) if (!p.assets.includes(asset)) f.push({ rule: "asset_not_permitted", severity: "block", message: `${asset} is not an approved asset.` });

      // 4. Destinations.
      if (a.kind === "transfer" || a.kind === "withdraw") {
        const chain = a.kind === "withdraw" ? a.chain : "near_intents";
        const listed = p.destinations.some((d) => d.address.toLowerCase() === a.recipient.toLowerCase() && d.action === a.kind && (d.action === "transfer" || d.chain === (a as { chain: string }).chain));
        if (p.destinationMode === "only" && !listed) f.push({ rule: "destination_not_approved", severity: "block", message: `${a.recipient} is not on the approved destination list.` });
        if (p.destinationMode === "except" && listed) f.push({ rule: "destination_excluded", severity: "block", message: `${a.recipient} is excluded by the policy.` });
        if (a.kind === "withdraw") {
          const invalid = validateForChain(a.chain, a.recipient);
          if (invalid) f.push({ rule: "invalid_destination", severity: "block", message: `${a.recipient}: ${invalid} on ${a.chain}.` });
        }
        f.push(...(await this.addressFindings(ctx.userId, a.recipient, chain, p, "agent")));
      }

      // 5. Escrow funding: the agent may fund escrow, but never be the party that releases it.
      if (a.kind === "escrow_fund") {
        if (!p.escrowContracts.includes(a.contractId)) f.push({ rule: "escrow_contract_not_approved", severity: "block", message: `${a.contractId} is not an approved escrow contract.` });
        if (a.approver !== ctx.ownerAccountId) f.push({ rule: "escrow_approver_not_owner", severity: "block", message: "Escrow release must be controlled by the owner's own account." });
        if (a.deposit !== a.expectedDeposit) f.push({ rule: "escrow_amount_mismatch", severity: "block", message: "The deposit does not match the agreed escrow amount." });
        const b = this.blocked(ctx.userId, a.provider);
        if (b) f.push({ rule: "provider_blocked", severity: "block", message: `Provider ${a.provider} is blocked: ${b}.` });
      }

      // 6. Value-based limits (USD).
      if (ctx.usdValue == null) {
        f.push({ rule: "value_unknown", severity: "block", message: "The USD value could not be determined, so budget limits cannot be verified." });
      } else {
        const v = ctx.usdValue;
        if (p.perTransactionUsd != null && v > p.perTransactionUsd) f.push({ rule: "per_transaction_limit", severity: "block", message: `$${v.toFixed(2)} exceeds the $${p.perTransactionUsd} per-action limit.`, data: { usd: v } });
        const windows: [keyof VeyraPolicy["budget"], number, string][] = [
          ["dailyUsd", 86_400_000, "daily"],
          ["weeklyUsd", 7 * 86_400_000, "weekly"],
          ["monthlyUsd", 30 * 86_400_000, "monthly"],
        ];
        for (const [key, ms, label] of windows) {
          const limit = p.budget[key];
          if (limit == null) continue;
          const spentUsd = this.spentSince(ctx.agentId, new Date(Date.now() - ms).toISOString(), ctx.requestHash);
          if (spentUsd + v > limit) f.push({ rule: `${label}_budget`, severity: "block", message: `This would bring ${label} spending to $${(spentUsd + v).toFixed(2)}, above the $${limit} budget.`, data: { spentUsd, usd: v, limit } });
        }
        if (p.approvalThresholdUsd != null && v > p.approvalThresholdUsd && !ctx.ownerApproved) {
          f.push({ rule: "approval_threshold", severity: "high", escalate: true, message: `$${v.toFixed(2)} is above the $${p.approvalThresholdUsd} approval threshold; the owner must approve.` });
        }
        const anomaly = this.anomaly(ctx.agentId, v);
        if (anomaly && !ctx.ownerApproved) f.push({ rule: "unusual_size", severity: "high", escalate: true, message: anomaly });
      }

      // 7. Velocity and duplicate detection.
      const hourAgo = new Date(Date.now() - 3600_000).toISOString();
      const lastHour = this.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM operations WHERE agent_id = ? AND created_at >= ? AND status IN (${SPENDING_STATUSES.map(() => "?").join(",")})`, [ctx.agentId, hourAgo, ...SPENDING_STATUSES])?.n ?? 0;
      if (p.maxActionsPerHour != null && lastHour >= p.maxActionsPerHour) f.push({ rule: "velocity_limit", severity: "block", message: `${lastHour} actions in the last hour reaches the limit of ${p.maxActionsPerHour}.` });
      const dup = this.db.get<{ id: string; idempotency_key: string }>(
        `SELECT id, idempotency_key FROM operations WHERE agent_id = ? AND request_hash = ? AND created_at >= ? AND status NOT IN ('blocked','failed','refunded','cancelled','rejected')`,
        [ctx.agentId, ctx.requestHash, new Date(Date.now() - 10 * 60_000).toISOString()],
      );
      if (dup && dup.idempotency_key !== ctx.idempotencyKey) f.push({ rule: "duplicate_request", severity: "block", message: "An identical request was made in the last 10 minutes. Possible duplicate payment.", data: { operationId: dup.id } });

      // 8. Preview (Agent API dry-run) and slippage.
      for (const w of ctx.preview?.warnings ?? []) {
        const sev: Severity = w.code === "high_fee" || w.code === "asset_delivered_as_is" ? "warn" : "block";
        f.push({ rule: `preview_${w.code}`, severity: sev, message: w.detail || w.code });
      }
      if (a.kind === "swap" && ctx.preview?.expectedOut && ctx.preview.minOut) {
        const exp = BigInt(ctx.preview.expectedOut);
        const min = BigInt(ctx.preview.minOut);
        if (exp > 0n) {
          const bps = Number(((exp - min) * 10_000n) / exp);
          if (bps > p.maxSlippageBps) f.push({ rule: "slippage_limit", severity: "block", message: `Worst-case slippage ${(bps / 100).toFixed(2)}% exceeds the ${(p.maxSlippageBps / 100).toFixed(2)}% limit.` });
        }
      }
      if (ctx.preview?.feePercent != null && ctx.preview.feePercent > 3) f.push({ rule: "high_fee", severity: "warn", message: `Fees are ${ctx.preview.feePercent.toFixed(2)}% of the amount.` });
    }

    // 9. Manipulation markers in AI-provided reasoning: escalate, never relax.
    if (ctx.origin === "ai" && ctx.aiReason) {
      const hit = INJECTION_MARKERS.find((r) => r.test(ctx.aiReason!));
      if (hit) f.push({ rule: "possible_prompt_injection", severity: "high", escalate: !ctx.ownerApproved, message: "The AI's justification contains instruction-override language. The owner must review this action." });
    }

    return decide(f);
  }

  private anomaly(agentId: string, usd: number): string | null {
    const rows = this.db.all<{ usd_value: number }>("SELECT usd_value FROM operations WHERE agent_id = ? AND status = 'settled' AND usd_value IS NOT NULL ORDER BY created_at DESC LIMIT 20", [agentId]);
    if (rows.length < 5) return null;
    const vals = rows.map((r) => r.usd_value).sort((x, y) => x - y);
    const median = vals[Math.floor(vals.length / 2)];
    if (median > 0 && usd > Math.max(5 * median, median + 50)) return `$${usd.toFixed(2)} is far above this agent's typical $${median.toFixed(2)} action.`;
    return null;
  }

  /** Address-level risk signals shared by autonomous and manual flows. */
  async addressFindings(userId: string, address: string, chain: string, policy: VeyraPolicy | null, mode: "agent" | "manual"): Promise<Finding[]> {
    const f: Finding[] = [];
    const blockedReason = this.blocked(userId, address);
    if (blockedReason) f.push({ rule: "blocked_address", severity: "block", message: `${address} is blocked: ${blockedReason}.` });
    const look = findLookalike(address, this.trusted(userId, policy));
    if (look) f.push({ rule: "lookalike_address", severity: mode === "agent" ? "block" : "high", message: `${address} looks like ${look} but is a different account. This is a common scam pattern.`, data: { imitates: look } });
    const kind = classifyAddress(address);
    if ((chain === "near" || chain === "near_intents") && this.rpc && (kind === "near_named")) {
      try {
        const exists = await this.rpc.accountExists(address);
        if (!exists) f.push({ rule: "account_not_found", severity: mode === "agent" ? "block" : "high", message: `${address} does not exist on NEAR. Funds sent there may be lost.` });
      } catch {
        f.push({ rule: "account_check_unavailable", severity: "info", message: "Could not reach NEAR RPC to check the destination account." });
      }
    }
    const prior = this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM operations WHERE user_id = ? AND lower(destination) = lower(?) AND status = 'settled'", [userId, address])?.n ?? 0;
    if (prior === 0 && !policy?.destinations.some((d) => d.address === address)) f.push({ rule: "first_time_destination", severity: "warn", message: `You have never sent funds to ${address} before.` });
    return f;
  }
}

export function decide(findings: Finding[]): Verdict {
  const weights: Record<Severity, number> = { info: 0, warn: 10, high: 30, block: 60 };
  const riskScore = Math.min(100, findings.reduce((n, x) => n + weights[x.severity], 0));
  const decision = findings.some((x) => x.severity === "block") ? "block" : findings.some((x) => x.escalate) ? "require_approval" : "allow";
  return { decision, riskScore, findings, evaluatedAt: now() };
}
