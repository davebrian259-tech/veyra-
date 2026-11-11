import type { Policy } from "@near-intents-agent-api/sdk";
import { z } from "zod";
import { hashObject } from "../lib/crypto.js";

/**
 * Veyra's owner-facing agent policy. Part of it maps 1:1 onto the Agent API policy, which the
 * Agent API enforces itself (actions, assets, destinations, USD budgets, timelock, schedule,
 * hourly action cap, owner approval, native NEAR calls). The rest has no Agent API equivalent
 * and is enforced by BODYGUARD before anything is dispatched:
 *
 *   - perTransactionUsd    (the API's per-transaction limits are per asset, in atomic units)
 *   - approvalThresholdUsd (the API's owner_approval is all-or-nothing)
 *   - maxSlippageBps
 *   - escrow funding budgets (native NEAR calls skip the API's budget and timelock)
 *
 * The AI never edits this. Changes need the owner's wallet signature: the Agent API part
 * through a signed `policy_update` intent, the Veyra part through a NEP-413 signature over
 * the policy hash.
 */
const usd = z.number().positive().nullable().default(null);

export const destinationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("transfer"), address: z.string().min(2), confidential: z.boolean().default(false), label: z.string().optional() }),
  z.object({
    action: z.literal("withdraw"),
    chain: z.string().min(2),
    address: z.string().min(2),
    memo: z.string().nullable().default(null),
    label: z.string().optional(),
  }),
]);

export const veyraPolicySchema = z.object({
  actions: z.array(z.enum(["swap", "transfer", "withdraw", "limit_order"])).default(["swap", "transfer"]),
  assets: z.union([z.literal("any"), z.array(z.string().min(3)).min(1)]).default("any"),
  budget: z
    .object({ dailyUsd: usd, weeklyUsd: usd, monthlyUsd: usd })
    .default({ dailyUsd: null, weeklyUsd: null, monthlyUsd: null }),
  perTransactionUsd: usd,
  approvalThresholdUsd: z.number().nonnegative().nullable().default(null),
  /** Every outgoing action waits for the owner's vote at the Agent API. */
  ownerApprovalForAll: z.boolean().default(false),
  destinationMode: z.enum(["only", "any", "except"]).default("only"),
  destinations: z.array(destinationSchema).max(100).default([]),
  maxSlippageBps: z.number().int().min(0).max(1000).default(100),
  timelockMs: z.number().int().min(0).max(30 * 86_400_000).default(0),
  maxActionsPerHour: z.number().int().positive().nullable().default(null),
  /** Optional per-asset atomic caps passed through to the Agent API. */
  assetLimits: z
    .object({
      per_transaction: z.record(z.string(), z.string()).optional(),
      hourly: z.record(z.string(), z.string()).optional(),
      daily: z.record(z.string(), z.string()).optional(),
      monthly: z.record(z.string(), z.string()).optional(),
    })
    .default({}),
  schedule: z
    .object({
      mode: z.enum(["only", "except"]),
      time_zone: z.string(),
      windows: z.array(
        z.object({
          days: z.array(z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])).min(1),
          start: z.string().regex(/^\d{2}:\d{2}$/),
          end: z.string().regex(/^\d{2}:\d{2}$/),
        }),
      ),
    })
    .optional(),
  /** Escrow contracts the agent may fund through a native NEAR call. */
  escrowContracts: z.array(z.string().min(2)).max(5).default([]),
});

export type VeyraPolicy = z.infer<typeof veyraPolicySchema>;

/** The $200 / $100 per week / $30 approval example from the brief. */
export function examplePolicy(): VeyraPolicy {
  return veyraPolicySchema.parse({
    actions: ["swap", "transfer", "withdraw"],
    assets: ["nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", "nep141:wrap.near", "nep141:usdt.tether-token.near"],
    budget: { weeklyUsd: 100 },
    perTransactionUsd: 100,
    approvalThresholdUsd: 30,
    maxSlippageBps: 100,
    timelockMs: 0,
    maxActionsPerHour: 20,
  });
}

export function policyHash(p: VeyraPolicy) {
  return hashObject(p);
}

const s = (n: number | null) => (n == null ? null : n.toFixed(2));

/** Maps the Veyra policy to the Agent API's schema. Only fields the API supports are sent. */
export function toApiPolicy(p: VeyraPolicy, frozen = false): Policy {
  const destinations = [...p.destinations.map(stripLabel)];
  for (const c of p.escrowContracts) {
    // A native NEAR call's deposit must land where `destinations` allows (judged as a withdraw
    // on chain "near"), so each allowed escrow contract is also an allowed destination.
    if (p.destinationMode === "only" && !destinations.some((d) => d.action === "withdraw" && d.chain === "near" && d.address === c)) {
      destinations.push({ action: "withdraw", chain: "near", address: c, memo: null });
    }
  }
  const policy: Policy = {
    frozen,
    actions: p.actions,
    confidential: false,
    owner_approval: p.ownerApprovalForAll,
    assets: p.assets,
    limits: p.assetLimits,
    max_actions_per_hour: p.maxActionsPerHour,
    destinations: { mode: p.destinationMode, list: destinations },
    budget: { daily_usd: s(p.budget.dailyUsd), weekly_usd: s(p.budget.weeklyUsd), monthly_usd: s(p.budget.monthlyUsd) },
    timelock_ms: p.timelockMs,
  };
  if (p.schedule) policy.schedule = p.schedule;
  if (p.escrowContracts.length) {
    policy.native = {
      near: { sign_message: [], transfer: false, call: p.escrowContracts },
      evm: { sign_typed_data: [], sign_message: false, sign_transaction: false },
      solana: { sign_message: false, sign_transaction: false },
    };
  }
  return policy;
}

function stripLabel(d: z.infer<typeof destinationSchema>): Policy["destinations"]["list"][number] {
  if (d.action === "transfer") return { action: "transfer", address: d.address, confidential: d.confidential };
  return { action: "withdraw", chain: d.chain, address: d.address, memo: d.memo };
}

/** Human-readable summary shown before the owner signs. */
export function describePolicy(p: VeyraPolicy): string[] {
  const lines: string[] = [];
  lines.push(`Allowed actions: ${p.actions.join(", ")}`);
  lines.push(`Assets: ${p.assets === "any" ? "any supported asset" : p.assets.join(", ")}`);
  const b = p.budget;
  if (b.dailyUsd) lines.push(`Spend at most $${b.dailyUsd} per day`);
  if (b.weeklyUsd) lines.push(`Spend at most $${b.weeklyUsd} per week`);
  if (b.monthlyUsd) lines.push(`Spend at most $${b.monthlyUsd} per month`);
  if (p.perTransactionUsd) lines.push(`No single action above $${p.perTransactionUsd}`);
  if (p.approvalThresholdUsd != null) lines.push(`Your approval is required above $${p.approvalThresholdUsd}`);
  if (p.ownerApprovalForAll) lines.push("Every outgoing action waits for your approval");
  lines.push(
    p.destinationMode === "only"
      ? `Funds may only go to ${p.destinations.length + p.escrowContracts.length} approved destination(s)`
      : p.destinationMode === "except"
        ? `Funds may go anywhere except ${p.destinations.length} blocked destination(s)`
        : "Funds may go to any destination",
  );
  lines.push(`Maximum swap slippage: ${(p.maxSlippageBps / 100).toFixed(2)}%`);
  if (p.timelockMs) lines.push(`Every money action is delayed by ${Math.round(p.timelockMs / 1000)}s (cancellable)`);
  if (p.maxActionsPerHour) lines.push(`At most ${p.maxActionsPerHour} actions per hour`);
  if (p.escrowContracts.length) lines.push(`May fund UNDO escrow at: ${p.escrowContracts.join(", ")}`);
  lines.push("You can freeze the agent at any time.");
  return lines;
}

/** Fields the Agent API enforces vs. fields Veyra enforces — shown in the UI for honesty. */
export function enforcementMap() {
  return {
    agentApi: ["actions", "assets", "destinations", "budget", "assetLimits", "timelockMs", "schedule", "maxActionsPerHour", "ownerApprovalForAll", "escrowContracts (native.near.call)", "frozen"],
    bodyguard: ["perTransactionUsd", "approvalThresholdUsd", "maxSlippageBps", "budget for escrow funding (native calls skip API budgets)", "destination risk analysis", "duplicate/velocity checks", "anomaly detection"],
  };
}
