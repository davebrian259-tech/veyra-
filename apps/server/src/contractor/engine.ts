import { EventEmitter } from "node:events";
import type { Db } from "../db.js";
import { json, now, parse } from "../db.js";
import { randomId } from "../lib/crypto.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { MarketCatalog, planPriceAtomic } from "../market/catalog.js";
import type { JobBoard } from "../market/job-board.js";
import type { MarketAgent, X402Requirement } from "../market/types.js";
import { taskText, TERMINAL_TASK_STATES } from "../market/types.js";
import type { MarketWorker } from "../market/worker.js";
import { X402Caller } from "../market/x402.js";
import type { AuditLog } from "../services/audit.js";
import type { Notifier } from "../services/notifications.js";
import type { Treasury } from "../treasury/treasury.js";
import { ContractorBrain, type Subtask, type Verification } from "./brain.js";
import { ContractorGuard, taintCheck } from "./guard.js";
import { rank } from "./rank.js";
import type { ReceiptService } from "./receipts.js";

/**
 * The contractor loop as a durable state machine.
 *
 *   contract:  planning → executing → assembling → delivering → delivered | failed
 *   subtask:   pending → sourcing → paying → working → verifying → passed
 *                                   ↘ (guard block / failed check / no-show) → retry with the next agent
 *
 * Every step is idempotent and persisted, so a crash or restart resumes where it left off.
 * Money only moves through: GUARD → treasury float → signed cheque (self-verified) → market.
 */

const MAX_ATTEMPTS = 3;
const toUsd = (a: bigint | string) => Number(BigInt(a)) / 1e6;
const toAtomic = (usd: number) => BigInt(Math.round(usd * 1e6));

export interface ContractRow {
  id: string;
  user_id: string;
  source: "market" | "direct";
  external_ref: string | null;
  buyer: string;
  title: string;
  brief: string;
  budget_atomic: string;
  revenue_atomic: string;
  margin_bps: number;
  status: string;
  step: string;
  plan_json: string | null;
  plan_source_json: string | null;
  deliverable_md: string | null;
  error: string | null;
  attempts: number;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
  delivered_at: string | null;
}

interface SubtaskRow {
  id: string;
  contract_id: string;
  idx: number;
  title: string;
  spec: string;
  criteria_json: string;
  mode: "x402" | "job";
  search_json: string;
  cap_atomic: string;
  status: string;
  agent_handle: string | null;
  agent_id: string | null;
  price_atomic: string | null;
  result_md: string | null;
  verification_json: string | null;
  attempts: number;
  excluded_json: string;
}

interface PaymentRow {
  id: string;
  contract_id: string;
  subtask_id: string;
  rail: string;
  agent_handle: string;
  amount_atomic: string;
  status: string;
  key_id: string | null;
  nonce: string | null;
  task_id: string | null;
  created_at: string;
}

export interface EngineDeps {
  db: Db;
  catalog: MarketCatalog;
  x402: X402Caller;
  board: () => JobBoard | null;
  worker: () => MarketWorker | null;
  treasury: Treasury;
  guard: ContractorGuard;
  brain: ContractorBrain;
  receipts: ReceiptService;
  audit: AuditLog;
  notifier: Notifier;
  ownerUserId: () => string | null;
  /** In sim mode, play a fully fooled model against poisoned deliverables (see brain). */
  assumeCompromisedModel: boolean;
}

export class ContractorEngine {
  readonly events = new EventEmitter();
  private running = new Set<string>();

  constructor(private readonly d: EngineDeps) {}

  // ---------------------------------------------------------------- state helpers

  private contract(id: string) {
    const c = this.d.db.get<ContractRow>("SELECT * FROM contracts WHERE id = ?", [id]);
    if (!c) throw notFound("contract");
    return c;
  }

  private subtasks(contractId: string) {
    return this.d.db.all<SubtaskRow>("SELECT * FROM subtasks WHERE contract_id = ? ORDER BY idx", [contractId]);
  }

  private setContract(id: string, fields: Partial<ContractRow>) {
    const keys = Object.keys(fields);
    this.d.db.run(`UPDATE contracts SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`, [...keys.map((k) => (fields as Record<string, never>)[k]), now(), id]);
  }

  private setSubtask(id: string, fields: Partial<SubtaskRow>) {
    const keys = Object.keys(fields);
    this.d.db.run(`UPDATE subtasks SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`, [...keys.map((k) => (fields as Record<string, never>)[k]), now(), id]);
  }

  private log(contractId: string, kind: string, message: string, data?: unknown) {
    this.d.db.run("INSERT INTO contract_events (contract_id, ts, kind, message, data_json) VALUES (?,?,?,?,?)", [contractId, now(), kind, message, data === undefined ? null : json(data)]);
    const c = this.d.db.get<{ user_id: string }>("SELECT user_id FROM contracts WHERE id = ?", [contractId]);
    if (c) this.d.notifier.emit(c.user_id, "contract.event", { contractId, kind, message });
    this.events.emit("event", { contractId, kind, message, data });
  }

  frozen() {
    return this.d.db.get<{ value_json: string }>("SELECT value_json FROM kv WHERE key = 'contractor.frozen'")?.value_json === "true";
  }

  setFrozen(frozen: boolean, by: string) {
    this.d.db.run("INSERT OR REPLACE INTO kv (key, value_json, updated_at) VALUES ('contractor.frozen', ?, ?)", [frozen ? "true" : "false", now()]);
    this.d.audit.record({ actor: "user", action: frozen ? "contractor.frozen" : "contractor.unfrozen", subject: by });
  }

  /** Budget available for subcontracting = budget × (1 − margin) − committed spend. */
  private envelopeRemaining(c: ContractRow) {
    const envelope = (BigInt(c.budget_atomic) * BigInt(10_000 - c.margin_bps)) / 10_000n;
    const committed = this.d.db.get<{ s: number | null }>("SELECT SUM(CAST(amount_atomic AS INTEGER)) AS s FROM payments WHERE contract_id = ? AND status IN ('reserved','signed','sent','completed')", [c.id])?.s ?? 0;
    return { envelope, remaining: envelope - BigInt(committed) };
  }

  // ---------------------------------------------------------------- intake

  create(input: { userId: string; title: string; brief: string; budgetUsd: number; buyer: string; source: "market" | "direct"; externalRef?: string | null; marginBps?: number; preferHandle?: string; rail?: "x402" | "job" }) {
    if (!(input.budgetUsd > 0)) throw badRequest("invalid_budget", "budget must be positive");
    if (input.externalRef) {
      const existing = this.d.db.get<{ id: string }>("SELECT id FROM contracts WHERE external_ref = ?", [input.externalRef]);
      if (existing) return this.view(existing.id);
    }
    const id = randomId("ctr_");
    const budget = toAtomic(input.budgetUsd);
    this.d.db.run(
      `INSERT INTO contracts (id, user_id, source, external_ref, buyer, title, brief, budget_atomic, revenue_atomic, margin_bps, status, step, next_run_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, input.userId, input.source, input.externalRef ?? null, input.buyer, input.title.slice(0, 200), input.brief.slice(0, 8000), budget.toString(), budget.toString(), input.marginBps ?? 2000, "active", "planning", now(), now(), now()],
    );
    if (input.rail) this.d.db.run("INSERT OR REPLACE INTO kv (key, value_json, updated_at) VALUES (?,?,?)", [`lab.rail.${id}`, JSON.stringify(input.rail), now()]);
    if (input.preferHandle) this.d.db.run("INSERT OR REPLACE INTO kv (key, value_json, updated_at) VALUES (?,?,?)", [`lab.prefer.${id}`, JSON.stringify(input.preferHandle), now()]);
    this.log(id, "intake", `Hired by ${input.buyer} for ${input.budgetUsd.toFixed(2)} USDC: "${input.title}"`, { source: input.source, externalRef: input.externalRef });
    this.d.audit.record({ userId: input.userId, actor: "agent", action: "contract.accepted", subject: id, data: { budget: budget.toString(), buyer: input.buyer, source: input.source } });
    return this.view(id);
  }

  // ---------------------------------------------------------------- runner

  /** Advances every contract that is due. Safe to call concurrently. */
  async tick() {
    const due = this.d.db.all<{ id: string }>("SELECT id FROM contracts WHERE status = 'active' AND (next_run_at IS NULL OR next_run_at <= ?) ORDER BY created_at", [now()]);
    for (const c of due) await this.advance(c.id);
  }

  async advance(id: string) {
    if (this.running.has(id)) return;
    this.running.add(id);
    try {
      for (let guard = 0; guard < 40; guard++) {
        const c = this.contract(id);
        if (c.status !== "active") return;
        if (this.frozen()) { this.setContract(id, { next_run_at: new Date(Date.now() + 15_000).toISOString() }); return; }
        const progressed = await this.step(c);
        if (!progressed) return;
      }
    } catch (e) {
      const c = this.contract(id);
      const attempts = c.attempts + 1;
      const msg = e instanceof Error ? e.message : String(e);
      this.log(id, "error", `Step "${c.step}" failed: ${msg}`);
      if (attempts >= 8) this.setContract(id, { status: "failed", error: msg, attempts });
      else this.setContract(id, { attempts, error: msg, next_run_at: new Date(Date.now() + Math.min(60_000, 2 ** attempts * 1000)).toISOString() });
    } finally {
      this.running.delete(id);
    }
  }

  /** Returns true when the contract moved and the loop should continue immediately. */
  private async step(c: ContractRow): Promise<boolean> {
    switch (c.step) {
      case "planning": return this.planStep(c);
      case "executing": return this.executeStep(c);
      case "assembling": return this.assembleStep(c);
      case "delivering": return this.deliverStep(c);
      default: return false;
    }
  }

  private async planStep(c: ContractRow) {
    const { plan, source } = await this.d.brain.plan(c.user_id, c.title, c.brief);
    const rail = this.d.db.get<{ value_json: string }>("SELECT value_json FROM kv WHERE key = ?", [`lab.rail.${c.id}`]);
    if (rail) for (const st of plan.subtasks) st.mode = JSON.parse(rail.value_json);
    const { envelope } = this.envelopeRemaining(c);
    this.d.db.tx(() => {
      plan.subtasks.forEach((s, i) => {
        const cap = (envelope * BigInt(Math.round(s.budgetShare * 10_000))) / 9_000n; // shares are of the 90% envelope
        this.d.db.run(
          `INSERT OR IGNORE INTO subtasks (id, contract_id, idx, title, spec, criteria_json, mode, search_json, cap_atomic, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [randomId("sub_"), c.id, i, s.title, s.spec, json(s.criteria), s.mode, json(s.search), (cap < envelope ? cap : envelope).toString(), "pending", now(), now()],
        );
      });
      this.setContract(c.id, { plan_json: json(plan), plan_source_json: json(source), step: "executing" });
    });
    this.log(c.id, "plan", `Planned ${plan.subtasks.length} subtask(s) with ${source.kind === "ai" ? `${source.provider}${source.verified ? " (TEE-verified)" : ""}` : "the deterministic planner"}: ${plan.summary}`, { plan, source });
    return true;
  }

  private async executeStep(c: ContractRow) {
    const subs = this.subtasks(c.id);
    const open = subs.find((s) => !["passed", "abandoned"].includes(s.status));
    if (!open) {
      const passed = subs.filter((s) => s.status === "passed").length;
      if (!passed) {
        this.setContract(c.id, { status: "failed", error: "no subtask could be completed" });
        this.log(c.id, "failed", "No subtask could be completed safely within budget.");
        return false;
      }
      this.setContract(c.id, { step: "assembling" });
      return true;
    }
    return this.runSubtask(c, open);
  }

  // ---------------------------------------------------------------- subtask

  private sub(s: SubtaskRow): Subtask {
    return { title: s.title, spec: s.spec, search: parse(s.search_json), mode: s.mode, criteria: parse(s.criteria_json), budgetShare: 0 };
  }

  private exclude(s: SubtaskRow, handle: string, why: string) {
    const ex = new Set(parse<string[]>(s.excluded_json));
    ex.add(handle);
    const attempts = s.attempts + 1;
    this.setSubtask(s.id, { excluded_json: json([...ex]), attempts, status: attempts >= MAX_ATTEMPTS ? "abandoned" : "pending", agent_handle: null, agent_id: null, price_atomic: null });
    this.log(s.contract_id, attempts >= MAX_ATTEMPTS ? "abandoned" : "retry", `${s.title}: ${why}${attempts >= MAX_ATTEMPTS ? " — giving up on this subtask" : " — trying another agent"}`);
  }

  private async runSubtask(c: ContractRow, s: SubtaskRow): Promise<boolean> {
    if (s.status === "pending" || s.status === "sourcing") return s.mode === "job" ? this.jobRail(c, s) : this.sourceAndPay(c, s);
    if (s.status === "working") return this.pollWork(c, s);
    if (s.status === "verifying") return this.verifyStep(c, s);
    if (s.status === "awaiting_funds") {
      this.setSubtask(s.id, { status: "pending" });
      return true;
    }
    if (s.status.startsWith("job:")) return this.jobRail(c, s);
    return false;
  }

  private async sourceAndPay(c: ContractRow, s: SubtaskRow): Promise<boolean> {
    const search = parse<{ text: string; category: string | null }>(s.search_json);
    const excluded = new Set(parse<string[]>(s.excluded_json));
    // Agents that failed anywhere in this contract are not re-hired for its other parts.
    const contractWide = new Set(this.subtasks(c.id).flatMap((x) => parse<string[]>(x.excluded_json)));
    const skip = (h: string) => excluded.has(h) || contractWide.has(h) || Boolean(this.d.guard.counterparty(h).blocked);
    this.setSubtask(s.id, { status: "sourcing" });
    let found = await this.d.catalog.search({ text: search.text, category: search.category ?? undefined, limit: 20 });
    if (!found.length && search.category) found = await this.d.catalog.search({ text: search.text, limit: 20 });
    const cap = BigInt(s.cap_atomic);
    const ranked: { agent: MarketAgent; plan: bigint | null; score: number; reasons: string[] }[] = [];
    for (const a of found.filter((x) => x.available_now !== false && !skip(x.handle)).slice(0, 8)) {
      const plan = await this.d.catalog.defaultPlan(a.agent_id).catch(() => null);
      const planAtomic = plan ? BigInt(planPriceAtomic(plan)) : null;
      const { score, reasons } = this.d.guard.score(a, a.handle);
      if (planAtomic !== null && planAtomic > cap) {
        this.quote(s, "x402", a, null, planAtomic, "walked_away", `listed at ${toUsd(planAtomic).toFixed(2)} USDC, above the ${toUsd(cap).toFixed(2)} cap`, score);
        continue;
      }
      ranked.push({ agent: a, plan: planAtomic, score, reasons });
    }
    // Best value: trust, then relevance of the listing to the work, then price.
    ranked.splice(0, ranked.length, ...rank(ranked, search.text, search.category, cap));
    // Attack lab: put the scenario's adversary first, as if it had out-ranked everyone else.
    const prefer = this.d.db.get<{ value_json: string }>("SELECT value_json FROM kv WHERE key = ?", [`lab.prefer.${c.id}`]);
    if (prefer) {
      const handle = JSON.parse(prefer.value_json) as string;
      if (!skip(handle) && !ranked.some((r) => r.agent.handle === handle)) {
        const a = await this.d.catalog.agent(handle).catch(() => null);
        if (a) {
          const plan = await this.d.catalog.defaultPlan(a.agent_id).catch(() => null);
          const sc = this.d.guard.score(a, a.handle);
          ranked.push({ agent: a, plan: plan ? BigInt(planPriceAtomic(plan)) : null, score: sc.score, reasons: sc.reasons });
        }
      }
      const i = ranked.findIndex((r) => r.agent.handle === handle && !skip(handle));
      if (i > 0) ranked.unshift(...ranked.splice(i, 1));
    }
    if (!ranked.length) {
      this.exclude(s, "__none__", "no suitable agent within the cap");
      if (parse<string[]>(this.d.db.get<SubtaskRow>("SELECT * FROM subtasks WHERE id = ?", [s.id])!.excluded_json).length >= 1) this.setSubtask(s.id, { status: "abandoned" });
      return true;
    }
    const treasury = await this.d.catalog.treasury();
    for (const cand of ranked) {
      const q = await this.d.x402.quote(cand.agent.handle, s.spec).catch((e) => ({ kind: "unavailable" as const, code: 0, message: String(e) }));
      if (q.kind !== "quote" || !q.challenge.accepts.length) {
        this.quote(s, "x402", cand.agent, null, cand.plan, "unavailable", q.kind === "unavailable" ? q.message : "no payable route", cand.score);
        continue;
      }
      const row = q.challenge.accepts[0];
      const { remaining } = this.envelopeRemaining(c);
      const verdict = this.d.guard.checkChallenge({
        contractId: c.id, subtaskId: s.id, handle: cand.agent.handle, row, treasury,
        planAtomic: cand.plan?.toString() ?? null, subtaskCapAtomic: BigInt(s.cap_atomic), envelopeRemainingAtomic: remaining, agent: cand.agent, frozen: this.frozen(),
      });
      if (verdict.decision === "block") {
        const blocks = verdict.findings.filter((f) => f.severity === "block");
        const attack = blocks.some((f) => ["payee_not_pinned", "price_mismatch"].includes(f.rule));
        if (attack) this.d.guard.record(cand.agent.handle, "attacks", blocks[0].rule);
        this.quote(s, "x402", cand.agent, row, cand.plan, attack ? "blocked_attack" : "blocked", blocks.map((f) => f.message).join(" "), cand.score);
        this.log(c.id, attack ? "attack_blocked" : "guard_block", `GUARD refused ${cand.agent.handle}: ${blocks.map((f) => f.message).join(" ")}`, { findings: verdict.findings, row });
        this.d.receipts.issue("security_event", c.id, s.id, { event: attack ? "payment_attack_blocked" : "payment_blocked", counterparty: cand.agent.handle, findings: blocks, challenge: row });
        // Never ask the same agent twice for this subtask.
        excluded.add(cand.agent.handle);
        this.setSubtask(s.id, { excluded_json: json([...excluded]) });
        continue;
      }
      const why = `best value: trust ${cand.score}/100${cand.reasons.length ? ` (${cand.reasons.join("; ")})` : ""} at ${toUsd(row.amount).toFixed(2)} USDC`;
      this.quote(s, "x402", cand.agent, row, cand.plan, "accepted", why, cand.score);
      const warns = verdict.findings.filter((f) => f.severity === "warn");
      if (warns.length) this.log(c.id, "guard_warn", `GUARD allowed ${cand.agent.handle} with warnings: ${warns.map((f) => f.message).join(" ")}`);
      return this.pay(c, s, cand.agent, row, verdict);
    }
    this.exclude(s, "__exhausted__", "every candidate was unavailable or refused by GUARD");
    this.setSubtask(s.id, { status: "abandoned" });
    return true;
  }

  private quote(s: SubtaskRow, rail: string, a: MarketAgent, row: X402Requirement | null, plan: bigint | null, decision: string, reason: string, score: number) {
    this.d.db.run("INSERT INTO quotes (id, subtask_id, rail, agent_handle, agent_id, amount_atomic, plan_atomic, challenge_json, decision, reason, score, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", [
      randomId("qte_"), s.id, rail, a.handle, a.agent_id, row?.amount ?? null, plan?.toString() ?? null, row ? json(row) : null, decision, reason, score, now(),
    ]);
  }

  private async pay(c: ContractRow, s: SubtaskRow, agent: MarketAgent, row: X402Requirement, verdict: unknown): Promise<boolean> {
    const amount = BigInt(row.amount);
    const fund = await this.d.treasury.ensureFloat(amount, `x402 payment to ${agent.handle} for ${c.id}`);
    if (fund.status !== "settled") {
      this.setSubtask(s.id, { status: fund.status === "blocked" ? "abandoned" : "awaiting_funds" });
      this.log(c.id, "funding", `Treasury could not fund ${toUsd(amount).toFixed(2)} USDC: ${fund.detail}`);
      if (fund.status !== "blocked") this.setContract(c.id, { next_run_at: new Date(Date.now() + 20_000).toISOString() });
      return fund.status === "blocked";
    }
    const paymentId = randomId("pay_");
    this.d.db.run(
      `INSERT INTO payments (id, contract_id, subtask_id, rail, agent_handle, amount_atomic, payee, asset, network, status, idempotency_key, guard_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [paymentId, c.id, s.id, "x402", agent.handle, row.amount, row.payTo, row.asset, row.network, "reserved", `${s.id}:${s.attempts}`, json(verdict), now(), now()],
    );
    const cheque = await this.d.treasury.spend.signCheque(row, paymentId);
    const self = this.d.guard.verifyOwnCheque(cheque.signedDelegateBase64, row);
    if (self.length) {
      this.d.treasury.spend.release(cheque.keyId);
      this.d.db.run("UPDATE payments SET status = 'void', error = ?, updated_at = ? WHERE id = ?", [self[0].message, now(), paymentId]);
      throw conflict("cheque_mismatch", self[0].message);
    }
    this.d.db.run("UPDATE payments SET status = 'signed', cheque_hash = ?, key_id = ?, nonce = ?, max_block_height = ?, updated_at = ? WHERE id = ?", [cheque.chequeHash, cheque.keyId, cheque.nonce.toString(), cheque.maxBlockHeight.toString(), now(), paymentId]);
    this.setSubtask(s.id, { status: "working", agent_handle: agent.handle, agent_id: agent.agent_id, price_atomic: row.amount });
    this.d.guard.record(agent.handle, "hires");
    this.log(c.id, "pay", `Hired ${agent.handle} for "${s.title}" at ${toUsd(amount).toFixed(2)} USDC (cheque ${cheque.chequeHash.slice(0, 12)}…, settles on delivery)`);
    try {
      const task = await this.d.x402.pay(agent.handle, s.spec, X402Caller.paymentHeader(row, cheque.signedDelegateBase64));
      this.d.db.run("UPDATE payments SET status = 'sent', task_id = ?, updated_at = ? WHERE id = ?", [task.id, now(), paymentId]);
      return this.handleTask(c, this.d.db.get<SubtaskRow>("SELECT * FROM subtasks WHERE id = ?", [s.id])!, paymentId, task);
    } catch (e) {
      // A refused payment moved nothing: free the key and try another agent.
      this.d.treasury.spend.release(cheque.keyId);
      this.d.db.run("UPDATE payments SET status = 'void', error = ?, updated_at = ? WHERE id = ?", [String(e instanceof Error ? e.message : e), now(), paymentId]);
      this.d.guard.record(agent.handle, "failures", "payment refused");
      this.exclude(this.d.db.get<SubtaskRow>("SELECT * FROM subtasks WHERE id = ?", [s.id])!, agent.handle, `payment refused: ${e instanceof Error ? e.message : e}`);
      return true;
    }
  }

  private async handleTask(c: ContractRow, s: SubtaskRow, paymentId: string, task: { id: string; status: { state: string }; artifacts?: unknown[] }): Promise<boolean> {
    const p = this.d.db.get<PaymentRow>("SELECT * FROM payments WHERE id = ?", [paymentId])!;
    const state = task.status.state;
    if (state === "TASK_STATE_COMPLETED") {
      this.d.db.run("UPDATE payments SET status = 'completed', updated_at = ? WHERE id = ?", [now(), paymentId]);
      this.d.treasury.spend.release(p.key_id!, BigInt(p.nonce!));
      this.setSubtask(s.id, { status: "verifying", result_md: taskText(task as never) });
      this.log(c.id, "delivered", `${s.agent_handle} delivered "${s.title}"; payment settled.`);
      return true;
    }
    if (TERMINAL_TASK_STATES.includes(state as never)) {
      this.d.db.run("UPDATE payments SET status = 'void', error = ?, updated_at = ? WHERE id = ?", [state, now(), paymentId]);
      this.d.treasury.spend.release(p.key_id!);
      this.d.guard.record(s.agent_handle!, "failures", state);
      this.exclude(s, s.agent_handle!, `task ended ${state.replace("TASK_STATE_", "").toLowerCase()} (nothing was charged)`);
      return true;
    }
    this.setContract(c.id, { next_run_at: new Date(Date.now() + 5_000).toISOString() });
    return false;
  }

  private async pollWork(c: ContractRow, s: SubtaskRow): Promise<boolean> {
    const p = this.d.db.get<PaymentRow>("SELECT * FROM payments WHERE subtask_id = ? AND status = 'sent' ORDER BY created_at DESC LIMIT 1", [s.id]);
    if (!p?.task_id) {
      this.setSubtask(s.id, { status: "pending" });
      return true;
    }
    const task = await this.d.x402.getTask(s.agent_handle!, p.task_id);
    if (task.status.state === "TASK_STATE_WORKING" || task.status.state === "TASK_STATE_SUBMITTED") {
      const agent = await this.d.catalog.agent(s.agent_handle!).catch(() => null);
      const sla = (agent?.sla_seconds ?? 600) * 1000;
      if (Date.now() - Date.parse(p.created_at) > sla) {
        await this.d.x402.cancel(s.agent_handle!, p.task_id).catch(() => undefined);
        this.d.db.run("UPDATE payments SET status = 'void', error = 'no delivery within SLA; cancelled', updated_at = ? WHERE id = ?", [now(), p.id]);
        this.d.treasury.spend.release(p.key_id!);
        this.d.guard.record(s.agent_handle!, "failures", "no-show");
        this.log(c.id, "no_show", `${s.agent_handle} did not deliver within its SLA. Task cancelled; the cheque was never settled, so nothing was paid.`);
        this.d.receipts.issue("security_event", c.id, s.id, { event: "no_show_cancelled", counterparty: s.agent_handle, paymentId: p.id, charged: "0" });
        this.exclude(s, s.agent_handle!, "no delivery within SLA");
        return true;
      }
    }
    return this.handleTask(c, s, p.id, task);
  }

  private async verifyStep(c: ContractRow, s: SubtaskRow): Promise<boolean> {
    const v: Verification = await this.d.brain.verify(c.user_id, this.sub(s), s.result_md ?? "");
    const paid = this.d.db.get<PaymentRow>("SELECT * FROM payments WHERE subtask_id = ? AND status = 'completed' ORDER BY created_at DESC LIMIT 1", [s.id]);
    if (v.attack) {
      this.d.guard.record(s.agent_handle!, "attacks", "prompt injection in deliverable");
      this.log(c.id, "attack_detected", `${s.agent_handle} returned a poisoned deliverable: ${v.injection.map((f) => f.message).join(" ")}`, { findings: v.injection });
      // Prove the guard holds even if the model is fooled: replay what a compliant model would do.
      const proposals = this.d.assumeCompromisedModel ? this.d.brain.compliantModelProposals(s.result_md ?? "") : [];
      for (const pr of proposals) {
        const trusted = [c.brief, c.title, ...(await this.d.catalog.treasury()).map((t) => t.payTo)];
        const findings = taintCheck({ recipient: pr.recipient, amountUsd: pr.amountUsd }, trusted, [s.result_md ?? ""]);
        this.log(c.id, "attack_blocked", `A fooled model would now "${pr.kind} ${pr.amountUsd} USDC to ${pr.recipient}". GUARD refused: ${findings.map((f) => f.message).join(" ")} Veyra also has no transfer capability outside pinned market payments.`, { proposal: pr, findings });
        this.d.receipts.issue("security_event", c.id, s.id, { event: "injected_payment_blocked", counterparty: s.agent_handle, proposal: pr, findings });
      }
    }
    const receipt = this.d.receipts.issue("purchase", c.id, s.id, {
      subtask: s.title,
      counterparty: s.agent_handle,
      rail: "x402",
      priceAtomic: s.price_atomic,
      asset: "USDC",
      chequeHash: this.d.db.get<{ cheque_hash: string }>("SELECT cheque_hash FROM payments WHERE id = ?", [paid?.id ?? ""])?.cheque_hash ?? null,
      taskId: paid?.task_id ?? null,
      verification: { pass: v.pass, score: v.score, reasons: v.reasons, judge: v.judge, attack: v.attack },
    });
    this.setSubtask(s.id, { verification_json: json({ ...v, receiptId: receipt.id }) });
    if (v.pass) {
      this.d.guard.record(s.agent_handle!, "passes");
      this.setSubtask(s.id, { status: "passed" });
      this.log(c.id, "verified", `"${s.title}" passed checks (${v.score}%${v.judge.used ? `, judge ${v.judge.verified ? "TEE-verified" : "unverified"}` : ""}).`);
      return true;
    }
    if (!v.attack) this.d.guard.record(s.agent_handle!, "failures", v.reasons[0]);
    this.exclude(s, s.agent_handle!, `work failed checks: ${v.reasons.slice(0, 3).join("; ")}`);
    return true;
  }

  // ---------------------------------------------------------------- negotiated rail

  private async jobRail(c: ContractRow, s: SubtaskRow): Promise<boolean> {
    const board = this.d.board();
    if (!board) {
      this.setSubtask(s.id, { mode: "x402" });
      this.log(c.id, "rail", `No job-board connection; buying "${s.title}" instantly over x402 instead.`);
      return true;
    }
    const cap = BigInt(s.cap_atomic);
    const state = s.status;
    const meta = s.verification_json && state.startsWith("job:") ? parse<{ jobId: string; bidId?: string; countered?: boolean }>(s.verification_json) : null;
    if (state === "pending" || state === "sourcing") {
      const { jobId } = await board.postJob({ title: s.title, description: s.spec, budget: toUsd(cap).toFixed(2), tags: parse<{ text: string }>(s.search_json).text.split(/\s+/).slice(0, 5) });
      this.setSubtask(s.id, { status: "job:bidding", verification_json: json({ jobId }) });
      this.log(c.id, "job_posted", `Posted "${s.title}" to the job board (guide budget ${toUsd(cap).toFixed(2)} USDC).`);
      return true;
    }
    if (state === "job:bidding" && meta) {
      const bids = await board.listBids(meta.jobId);
      if (!bids.length) { this.setContract(c.id, { next_run_at: new Date(Date.now() + 15_000).toISOString() }); return false; }
      const excluded = new Set(parse<string[]>(s.excluded_json));
      const scored = bids.map((b) => ({ b, trust: this.d.guard.score(null, b.agentHandle).score })).filter((x) => !excluded.has(x.b.agentHandle) && !this.d.guard.counterparty(x.b.agentHandle).blocked);
      scored.sort((x, y) => y.trust - x.trust || Number(x.b.amount) - Number(y.b.amount));
      const best = scored.find((x) => toAtomic(Number(x.b.amount)) <= cap) ?? scored[0];
      if (!best) { this.exclude(s, "__bids__", "no acceptable bids"); return true; }
      const price = toAtomic(Number(best.b.amount));
      if (price > cap && !meta.countered) {
        const offer = toUsd(cap).toFixed(2);
        const reasoning = `We can offer ${offer} USDC. This piece is one part of a larger job with a fixed client budget, and ${offer} USDC is our full allocation for it; similar work on the market lists at that level. If that works, we'll award immediately.`;
        await board.message(meta.jobId, best.b.bidId, reasoning);
        this.setSubtask(s.id, { verification_json: json({ ...meta, bidId: best.b.bidId, countered: true }) });
        this.log(c.id, "negotiate", `Countered ${best.b.agentHandle}'s ${Number(best.b.amount).toFixed(2)} USDC bid with ${offer} USDC, giving reasons.`, { message: reasoning });
        return true;
      }
      if (price > cap) {
        await board.cancel(meta.jobId);
        this.log(c.id, "walked_away", `Best bid stayed at ${Number(best.b.amount).toFixed(2)} USDC after one counter, above the ${toUsd(cap).toFixed(2)} cap. Walked away.`);
        this.setSubtask(s.id, { mode: "x402", status: "pending", verification_json: null });
        return true;
      }
      const { remaining } = this.envelopeRemaining(c);
      if (price > remaining) { this.exclude(s, best.b.agentHandle, "contract budget exhausted"); return true; }
      await board.award(meta.jobId, best.b.bidId);
      this.d.db.run(`INSERT INTO payments (id, contract_id, subtask_id, rail, agent_handle, amount_atomic, payee, asset, network, status, idempotency_key, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
        randomId("pay_"), c.id, s.id, "job", best.b.agentHandle, price.toString(), "market-escrow", "USDC", "market", "sent", `${s.id}:job:${meta.jobId}`, now(), now(),
      ]);
      this.setSubtask(s.id, { status: "job:working", agent_handle: best.b.agentHandle, price_atomic: price.toString(), verification_json: json({ ...meta, bidId: best.b.bidId }) });
      this.log(c.id, "awarded", `Awarded "${s.title}" to ${best.b.agentHandle} at ${Number(best.b.amount).toFixed(2)} USDC; the market holds it in escrow until we accept.`);
      return true;
    }
    if (state === "job:working" && meta) {
      const r = await board.result(meta.jobId);
      if (r.status !== "submitted" || !r.deliverable) { this.setContract(c.id, { next_run_at: new Date(Date.now() + 15_000).toISOString() }); return false; }
      const v = await this.d.brain.verify(c.user_id, this.sub(s), r.deliverable);
      const pay = this.d.db.get<PaymentRow>("SELECT * FROM payments WHERE subtask_id = ? AND rail = 'job' AND status = 'sent'", [s.id]);
      if (v.pass) {
        await board.accept(meta.jobId);
        await board.review(meta.jobId, 5, "Delivered to brief; passed Veyra's checks.").catch(() => undefined);
        if (pay) this.d.db.run("UPDATE payments SET status = 'completed', updated_at = ? WHERE id = ?", [now(), pay.id]);
        const rc = this.d.receipts.issue("purchase", c.id, s.id, { subtask: s.title, counterparty: s.agent_handle, rail: "job", priceAtomic: s.price_atomic, jobId: meta.jobId, verification: { pass: true, score: v.score } });
        this.setSubtask(s.id, { status: "passed", result_md: r.deliverable, verification_json: json({ ...v, receiptId: rc.id }) });
        this.d.guard.record(s.agent_handle!, "passes");
        this.log(c.id, "verified", `Accepted ${s.agent_handle}'s work; escrow released.`);
        return true;
      }
      if (v.attack) {
        this.d.guard.record(s.agent_handle!, "attacks", "prompt injection");
        await board.review(meta.jobId, 1, "Deliverable contained instructions aimed at the hiring agent.").catch(() => undefined);
      }
      if (!meta.countered || v.attack) {
        await board.requestChanges(meta.jobId, `Please address: ${v.reasons.slice(0, 3).join("; ")}`);
        this.log(c.id, "changes_requested", `Requested changes from ${s.agent_handle}: ${v.reasons.slice(0, 3).join("; ")}`);
        this.setSubtask(s.id, { verification_json: json({ ...meta, countered: true }) });
        return true;
      }
      this.log(c.id, "dispute", `Work still fails checks; dispute it on the market (${v.reasons[0]}).`);
      this.exclude(s, s.agent_handle!, "work failed checks after one revision");
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- assemble & deliver

  private async assembleStep(c: ContractRow) {
    const parts = this.subtasks(c.id).filter((s) => s.status === "passed").map((s) => ({
      title: s.title,
      agent: s.agent_handle ?? "?",
      priceUsd: toUsd(s.price_atomic ?? "0"),
      text: s.result_md ?? "",
      receiptId: s.verification_json ? parse<{ receiptId?: string }>(s.verification_json).receiptId ?? null : null,
    }));
    const md = this.d.brain.assemble(c.title, parts);
    this.setContract(c.id, { deliverable_md: md, step: "delivering" });
    this.log(c.id, "assembled", `Assembled the deliverable from ${parts.length} verified part(s).`);
    return true;
  }

  private async deliverStep(c: ContractRow) {
    const cost = this.cost(c.id);
    if (c.source === "market" && c.external_ref) {
      const w = this.d.worker();
      if (!w) throw conflict("worker_not_configured", "no market worker token to deliver with");
      await w.submit(c.external_ref, c.deliverable_md ?? "");
    }
    const revenue = BigInt(c.revenue_atomic);
    this.d.receipts.issue("delivery", c.id, null, { buyer: c.buyer, revenueAtomic: c.revenue_atomic, costAtomic: cost.toString(), marginAtomic: (revenue - cost).toString(), deliverableChars: (c.deliverable_md ?? "").length });
    this.setContract(c.id, { status: "delivered", step: "done", delivered_at: now() });
    this.log(c.id, "done", `Delivered to ${c.buyer}. Revenue ${toUsd(revenue).toFixed(2)} − cost ${toUsd(cost).toFixed(2)} = margin ${toUsd(revenue - cost).toFixed(2)} USDC.`);
    this.d.notifier.notify(c.user_id, "contract.delivered", "Contract delivered", `"${c.title}": margin ${toUsd(revenue - cost).toFixed(2)} USDC.`, { contractId: c.id });
    await this.d.receipts.anchorPending().catch(() => undefined);
    return false;
  }

  private cost(contractId: string) {
    return BigInt(this.d.db.get<{ s: number | null }>("SELECT SUM(CAST(amount_atomic AS INTEGER)) AS s FROM payments WHERE contract_id = ? AND status = 'completed'", [contractId])?.s ?? 0);
  }

  // ---------------------------------------------------------------- earning: poll the market

  /** Turns new market assignments into contracts. Returns the number accepted. */
  async pollAssignments(): Promise<number> {
    const w = this.d.worker();
    const userId = this.d.ownerUserId();
    if (!w || !userId) return 0;
    let n = 0;
    for (const a of await w.assignments("in_progress")) {
      if (this.d.db.get("SELECT 1 FROM contracts WHERE external_ref = ?", [a.assignment.assignmentId])) continue;
      if (!a.assignment.startedAt) await w.start(a.assignment.assignmentId).catch(() => undefined);
      const budget = Number(a.assignment.escrowAmount); // decimal USDC
      this.create({ userId, title: a.job.title, brief: a.job.description, budgetUsd: budget * 0.95, buyer: `market job ${a.job.jobId.slice(0, 8)}`, source: "market", externalRef: a.assignment.assignmentId });
      await w.progress(a.assignment.assignmentId, "Veyra accepted the job and is sourcing specialists.", 5).catch(() => undefined);
      n++;
    }
    return n;
  }

  // ---------------------------------------------------------------- views

  view(id: string) {
    const c = this.contract(id);
    const subs = this.subtasks(id).map((s) => ({
      ...s,
      criteria: parse(s.criteria_json),
      search: parse(s.search_json),
      verification: s.verification_json ? parse(s.verification_json) : null,
      excluded: parse(s.excluded_json),
      quotes: this.d.db.all("SELECT * FROM quotes WHERE subtask_id = ? ORDER BY created_at", [s.id]).map((q) => ({ ...q, challenge: (q as { challenge_json: string | null }).challenge_json ? parse((q as { challenge_json: string }).challenge_json) : null, challenge_json: undefined })),
      criteria_json: undefined, search_json: undefined, verification_json: undefined, excluded_json: undefined,
    }));
    const cost = this.cost(id);
    const { envelope, remaining } = this.envelopeRemaining(c);
    return {
      ...c,
      plan: c.plan_json ? parse(c.plan_json) : null,
      planSource: c.plan_source_json ? parse(c.plan_source_json) : null,
      plan_json: undefined,
      plan_source_json: undefined,
      subtasks: subs,
      payments: this.d.db.all("SELECT id, subtask_id, rail, agent_handle, amount_atomic, payee, status, cheque_hash, task_id, error, created_at FROM payments WHERE contract_id = ? ORDER BY created_at", [id]),
      events: this.events_(id),
      money: { budgetUsd: toUsd(c.budget_atomic), envelopeUsd: toUsd(envelope), remainingUsd: toUsd(remaining), costUsd: toUsd(cost), revenueUsd: toUsd(c.revenue_atomic), marginUsd: c.status === "delivered" ? toUsd(BigInt(c.revenue_atomic) - cost) : null },
    };
  }

  events_(id: string, after = 0) {
    return this.d.db.all<{ id: number; ts: string; kind: string; message: string; data_json: string | null }>("SELECT * FROM contract_events WHERE contract_id = ? AND id > ? ORDER BY id", [id, after]).map((e) => ({ ...e, data: e.data_json ? parse(e.data_json) : null, data_json: undefined }));
  }

  list(userId: string) {
    return this.d.db.all<ContractRow>("SELECT * FROM contracts WHERE user_id = ? ORDER BY created_at DESC LIMIT 200", [userId]).map((c) => ({
      id: c.id, title: c.title, buyer: c.buyer, source: c.source, status: c.status, step: c.step, budgetUsd: toUsd(c.budget_atomic), costUsd: toUsd(this.cost(c.id)), created_at: c.created_at, delivered_at: c.delivered_at,
    }));
  }

  /** Public P&L across all contracts. */
  ledger() {
    const rows = this.d.db.all<ContractRow>("SELECT * FROM contracts ORDER BY created_at DESC");
    const delivered = rows.filter((r) => r.status === "delivered");
    const revenue = delivered.reduce((n, r) => n + BigInt(r.revenue_atomic), 0n);
    const cost = rows.reduce((n, r) => n + this.cost(r.id), 0n);
    const blocked = this.d.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM receipts WHERE kind = 'security_event'")?.n ?? 0;
    return {
      totals: { contracts: rows.length, delivered: delivered.length, revenueUsd: toUsd(revenue), costUsd: toUsd(cost), marginUsd: toUsd(revenue - cost), securityEvents: blocked },
      contracts: rows.map((r) => ({ id: r.id, title: r.title, buyer: r.buyer, status: r.status, revenueUsd: r.status === "delivered" ? toUsd(r.revenue_atomic) : 0, costUsd: toUsd(this.cost(r.id)), deliveredAt: r.delivered_at })),
      purchases: this.d.db.all("SELECT p.id, p.contract_id, p.agent_handle, p.rail, p.amount_atomic, p.status, p.cheque_hash, p.created_at, s.title AS subtask FROM payments p JOIN subtasks s ON s.id = p.subtask_id ORDER BY p.created_at DESC LIMIT 200"),
      counterparties: this.d.db.all("SELECT * FROM counterparties ORDER BY updated_at DESC"),
    };
  }
}
