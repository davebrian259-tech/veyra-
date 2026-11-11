import type { Db } from "../db.js";
import { json, now, parse } from "../db.js";
import { usdToAtomic } from "../lib/amounts.js";
import { randomId } from "../lib/crypto.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import type { AgentService } from "./agents.js";
import type { Planner, Plan } from "./ai/planner.js";
import type { AuditLog } from "./audit.js";
import type { User } from "./auth.js";
import type { ExecutionService, ExecutableAction } from "./execution.js";
import type { Notifier } from "./notifications.js";
import type { TokenCatalog, TokenInfo } from "./tokens.js";
import type { WantedService } from "./wanted.js";

/**
 * GOAL WALLET — users state objectives; Veyra plans and (when authorised) executes them through
 * the same execution service, BODYGUARD and Agent API policy as every other agent action.
 * Veyra never promises returns and never makes unrestricted investment decisions: it only
 * executes allocations, conversions and rebalances the user described, inside their policy.
 */

export interface Holding { assetId: string; symbol: string; amountRaw: string; amount: number; usd: number | null; price: number | null }

const STABLES = ["USDC", "USDT"];
const DISCLAIMER = "Veyra executes the plan you describe within your policy. It does not predict prices or guarantee any return.";

export class GoalService {
  constructor(
    private readonly db: Db,
    private readonly planner: Planner,
    private readonly agents: AgentService,
    private readonly execution: ExecutionService,
    private readonly wanted: WantedService,
    private readonly tokens: TokenCatalog,
    private readonly audit: AuditLog,
    private readonly notifier: Notifier,
  ) {}

  async portfolio(agentId: string): Promise<{ holdings: Holding[]; totalUsd: number }> {
    const b = await this.agents.api().getBalances(agentId);
    const holdings = b.balances
      .filter((x) => x.available_raw !== "0")
      .map((x) => {
        const amount = x.available != null ? Number(x.available) : 0;
        return { assetId: x.asset_id, symbol: x.symbol ?? x.asset_id, amountRaw: x.available_raw, amount, price: x.price, usd: x.price != null ? amount * x.price : null };
      });
    return { holdings, totalUsd: holdings.reduce((n, h) => n + (h.usd ?? 0), 0) };
  }

  /** Picks the NEAR-chain asset for a symbol from the live Agent API catalogue. */
  async assetFor(symbol: string): Promise<TokenInfo> {
    const list = await this.tokens.agentTokens();
    const s = symbol.toUpperCase() === "NEAR" ? "WNEAR" : symbol.toUpperCase();
    const hit = list.find((t) => t.symbol.toUpperCase() === s && t.blockchain === "near") ?? list.find((t) => t.symbol.toUpperCase() === s);
    if (!hit) throw badRequest("unsupported_asset", `${symbol} is not supported by NEAR Intents right now`);
    return hit;
  }

  async create(user: User, input: { prompt: string; agentId?: string | null; autoExecute?: boolean }) {
    let balancesSummary: string | undefined;
    let weekly: number | null = null;
    if (input.agentId) {
      this.agents.assertOwner(user, input.agentId);
      weekly = this.agents.activePolicy(input.agentId)?.policy.budget.weeklyUsd ?? null;
      const p = await this.portfolio(input.agentId).catch(() => null);
      // Only symbols and rounded USD values reach the model; never keys, tokens or addresses.
      if (p) balancesSummary = `agent holdings ≈ $${p.totalUsd.toFixed(0)}: ${p.holdings.map((h) => `${h.symbol} $${(h.usd ?? 0).toFixed(0)}`).join(", ")}`;
    }
    const result = await this.planner.interpret(user.id, input.prompt, { balancesSummary, policyWeeklyUsd: weekly });
    const id = randomId("goal_");
    this.db.run(
      "INSERT INTO goals (id, user_id, agent_id, kind, title, prompt, params_json, plan_json, status, auto_execute, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      [id, user.id, input.agentId ?? null, result.plan.intent, result.plan.summary.slice(0, 200), input.prompt, json({}), json(result), "planned", input.autoExecute ? 1 : 0, now(), now()],
    );
    this.audit.record({ userId: user.id, actor: "ai", action: "goal.planned", subject: id, data: { plan: result.plan, source: result.source, adjustments: result.adjustments } });
    return { id, ...result, disclaimer: DISCLAIMER, next: this.nextSteps(result.plan) };
  }

  private nextSteps(plan: Plan): string[] {
    switch (plan.intent) {
      case "hire": return ["Review the job brief", "POST /goals/:id/start to post the job to WANTED and request offers", "Pick an offer, then fund UNDO escrow"];
      case "allocate":
      case "convert":
      case "rebalance": return ["POST /goals/:id/proposal to see the exact swaps", "POST /goals/:id/execute to run them through BODYGUARD and the Agent API"];
      default: return ["Veyra will track this goal and notify you"];
    }
  }

  get(user: User, id: string) {
    const g = this.db.get<Record<string, unknown>>("SELECT * FROM goals WHERE id = ? AND user_id = ?", [id, user.id]);
    if (!g) throw notFound("goal");
    const ops = this.db.all("SELECT id, kind, status, usd_value, created_at FROM operations WHERE goal_id = ? ORDER BY created_at", [id]);
    return { ...g, plan: parse(g.plan_json as string), progress: g.progress_json ? parse(g.progress_json as string) : null, operations: ops, plan_json: undefined, progress_json: undefined, params_json: undefined };
  }

  list(user: User) {
    return this.db.all("SELECT id, kind, title, status, agent_id, created_at FROM goals WHERE user_id = ? ORDER BY created_at DESC", [user.id]);
  }

  private plan(user: User, id: string): { plan: Plan; agentId: string | null; row: Record<string, unknown> } {
    const g = this.db.get<Record<string, unknown>>("SELECT * FROM goals WHERE id = ? AND user_id = ?", [id, user.id]);
    if (!g) throw notFound("goal");
    return { plan: parse<{ plan: Plan }>(g.plan_json as string).plan, agentId: (g.agent_id as string) ?? null, row: g };
  }

  /** Hire goals: post the job to WANTED and request competing offers. */
  async start(user: User, id: string) {
    const { plan } = this.plan(user, id);
    if (plan.intent !== "hire" || !plan.hire) throw badRequest("not_a_hire_goal", "only hire goals can be started");
    const budget = plan.maxSpendUsd ?? plan.budgetUsd;
    if (!budget) throw badRequest("budget_required", "the goal has no budget; edit it to include one");
    const job = this.wanted.createJob(user, {
      title: plan.hire.title,
      description: plan.hire.description,
      skills: plan.hire.skills,
      budgetMaxUsd: budget,
      deadlineDays: plan.hire.deadlineDays,
      completionConditions: plan.hire.completionConditions,
      goalId: id,
    });
    const jobId = (job as unknown as { id: string }).id;
    const offers = await this.wanted.requestOffers(user, jobId);
    this.db.run("UPDATE goals SET status = 'in_progress', progress_json = ?, updated_at = ? WHERE id = ?", [json({ jobId }), now(), id]);
    return { jobId, ...offers };
  }

  /** Deterministic swap list for allocate / convert / rebalance goals. */
  async proposal(user: User, id: string): Promise<{ actions: ExecutableAction[]; portfolio: { holdings: Holding[]; totalUsd: number }; notes: string[] }> {
    const { plan, agentId } = this.plan(user, id);
    if (!agentId) throw badRequest("agent_required", "attach an agent to this goal to execute it");
    this.agents.assertOwner(user, agentId);
    const pf = await this.portfolio(agentId);
    const notes: string[] = [];
    const actions: ExecutableAction[] = [];
    const source = pf.holdings.filter((h) => STABLES.includes(h.symbol.toUpperCase())).sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0))[0] ?? pf.holdings.sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0))[0];
    if (!source || !source.price) throw conflict("no_funds", "the agent holds no priced assets to work with");

    if (plan.intent === "convert" && plan.convert) {
      const dest = await this.assetFor(plan.convert.toSymbol);
      if (dest.assetId === source.assetId) notes.push("Funds are already in the target asset.");
      else actions.push({ kind: "swap", originAsset: source.assetId, destinationAsset: dest.assetId, amount: usdToAtomic(Math.min(plan.convert.amountUsd, source.usd ?? 0), (await this.assetFor(source.symbol)).decimals, source.price) });
    }

    if ((plan.intent === "allocate" || plan.intent === "rebalance") && plan.allocation) {
      const budget = plan.intent === "allocate" ? Math.min(plan.budgetUsd ?? pf.totalUsd, pf.totalUsd) : pf.totalUsd;
      const drift = plan.rebalance?.driftPct ?? 0;
      for (const t of plan.allocation.targets) {
        const asset = await this.assetFor(t.symbol);
        const wantUsd = (budget * t.pct) / 100;
        const haveUsd = pf.holdings.find((h) => h.assetId === asset.assetId)?.usd ?? 0;
        const gap = wantUsd - haveUsd;
        if (plan.intent === "rebalance" && Math.abs(gap) / Math.max(budget, 1) * 100 < drift) { notes.push(`${t.symbol} within ${drift}% drift`); continue; }
        if (gap < 1 || asset.assetId === source.assetId) continue;
        const srcToken = await this.assetFor(source.symbol);
        actions.push({ kind: "swap", originAsset: source.assetId, destinationAsset: asset.assetId, amount: usdToAtomic(Math.min(gap, source.usd ?? 0), srcToken.decimals, source.price) });
      }
      if (plan.intent === "rebalance") notes.push("Only buys toward targets are proposed; sells require an explicit goal.");
    }
    if (!actions.length) notes.push("No swaps are needed.");
    return { actions, portfolio: pf, notes: [...notes, DISCLAIMER] };
  }

  /** Runs the proposal; each swap is independently checked by BODYGUARD and the Agent API. */
  async execute(user: User, id: string) {
    const { agentId, plan } = this.plan(user, id);
    const prop = await this.proposal(user, id);
    const results = [];
    for (const a of prop.actions) results.push(await this.execution.execute(user, agentId!, a, { origin: "goal", goalId: id, reason: plan.summary }));
    const status = results.every((r) => r.status === "blocked") && results.length ? "blocked" : "in_progress";
    this.db.run("UPDATE goals SET status = ?, updated_at = ? WHERE id = ?", [status, now(), id]);
    return { results, notes: prop.notes };
  }

  /** Periodic evaluation: savings progress, rebalance drift, simple monitors. */
  async evaluateAll() {
    const goals = this.db.all<{ id: string; user_id: string; agent_id: string | null; kind: string; plan_json: string; auto_execute: number; status: string; progress_json: string | null }>(
      "SELECT * FROM goals WHERE status IN ('planned','in_progress') AND agent_id IS NOT NULL AND kind IN ('save','monitor','rebalance')",
    );
    for (const g of goals) {
      try {
        const pf = await this.portfolio(g.agent_id!);
        const plan = parse<{ plan: Plan }>(g.plan_json).plan;
        const prev = g.progress_json ? parse<{ totalUsd?: number }>(g.progress_json) : {};
        const progress: Record<string, unknown> = { totalUsd: pf.totalUsd, at: now() };
        if (g.kind === "save" && plan.target) {
          progress.pct = Math.min(100, (pf.totalUsd / plan.target.amountUsd) * 100);
          if ((progress.pct as number) >= 100 && g.status !== "completed") { this.db.run("UPDATE goals SET status = 'completed' WHERE id = ?", [g.id]); this.notifier.notify(g.user_id, "goal.completed", "Goal reached", `You reached $${plan.target.amountUsd}.`, { goalId: g.id }); }
        }
        if (g.kind === "monitor" && prev.totalUsd && pf.totalUsd < prev.totalUsd * 0.9) this.notifier.notify(g.user_id, "goal.monitor", "Portfolio dropped", `Agent holdings fell from $${prev.totalUsd.toFixed(2)} to $${pf.totalUsd.toFixed(2)}.`, { goalId: g.id });
        if (g.kind === "rebalance" && g.auto_execute) {
          const user = this.db.get<{ id: string; account_id: string }>("SELECT id, account_id FROM users WHERE id = ?", [g.user_id])!;
          const agent = this.agents.getAgentRow(g.agent_id!)!;
          const u = { id: user.id, accountId: user.account_id, publicKey: agent.owner_public_key };
          const prop = await this.proposal(u, g.id);
          if (prop.actions.length) for (const a of prop.actions) await this.execution.execute(u, g.agent_id!, a, { origin: "goal", goalId: g.id, reason: "Scheduled rebalance" });
        }
        this.db.run("UPDATE goals SET progress_json = ?, updated_at = ? WHERE id = ?", [json(progress), now(), g.id]);
      } catch {
        /* agent API unavailable; try next cycle */
      }
    }
  }
}
