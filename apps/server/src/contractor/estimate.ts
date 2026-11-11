import { planPriceAtomic, type MarketCatalog } from "../market/catalog.js";
import type { X402Caller } from "../market/x402.js";
import type { ContractorBrain } from "./brain.js";
import type { ContractorGuard } from "./guard.js";
import { rank, relevance, type Candidate } from "./rank.js";

/**
 * A priced plan for a job without spending anything: plan the work, shortlist market agents,
 * ask each for its x402 price (free) and run GUARD on every quote. Used by `live:dry-run`, the
 * MCP `veyra_estimate` tool and the console's quote button.
 */
export interface EstimateLine {
  subtask: string;
  capUsd: number;
  chosen: { handle: string; priceUsd: number; trust: number } | null;
  candidates: { handle: string; quotedUsd: number | null; listedUsd: number | null; trust: number; fit: number; decision: string; reasons: string[] }[];
}

export async function estimate(
  deps: { catalog: MarketCatalog; x402: X402Caller; guard: ContractorGuard; brain: ContractorBrain },
  input: { title: string; brief: string; budgetUsd: number; marginBps: number; perSubtask?: number },
) {
  const usd = (a: bigint | string | null) => (a === null ? null : Number(BigInt(a)) / 1e6);
  const { plan, source } = await deps.brain.plan(null, input.title, input.brief);
  const envelope = (BigInt(Math.round(input.budgetUsd * 1e6)) * BigInt(10_000 - input.marginBps)) / 10_000n;
  const treasury = await deps.catalog.treasury();
  const lines: EstimateLine[] = [];
  let total = 0n;
  for (const st of plan.subtasks) {
    const cap = (envelope * BigInt(Math.round(st.budgetShare * 10_000))) / 9_000n;
    let agents = await deps.catalog.search({ text: st.search.text, category: st.search.category ?? undefined, limit: 10 });
    if (!agents.length) agents = await deps.catalog.search({ text: st.search.text, limit: 10 });
    const cands: Candidate[] = [];
    for (const a of agents.filter((x) => x.available_now !== false).slice(0, input.perSubtask ?? 6)) {
      const p = await deps.catalog.defaultPlan(a.agent_id).catch(() => null);
      const sc = deps.guard.score(a, a.handle);
      cands.push({ agent: a, plan: p ? BigInt(planPriceAtomic(p)) : null, score: sc.score, reasons: sc.reasons });
    }
    const line: EstimateLine = { subtask: st.title, capUsd: usd(cap)!, chosen: null, candidates: [] };
    for (const c of rank(cands, st.search.text, st.search.category, cap)) {
      const q = await deps.x402.quote(c.agent.handle, st.spec).catch((e) => ({ kind: "unavailable" as const, code: 0, message: String(e) }));
      if (q.kind !== "quote" || !q.challenge.accepts[0]) {
        line.candidates.push({ handle: c.agent.handle, quotedUsd: null, listedUsd: usd(c.plan), trust: c.score, fit: relevance(c.agent, st.search.text, st.search.category), decision: "unavailable", reasons: [q.kind === "unavailable" ? q.message : "no payment route"] });
        continue;
      }
      const row = q.challenge.accepts[0];
      const v = deps.guard.checkChallenge({ contractId: "estimate", subtaskId: st.title, handle: c.agent.handle, row, treasury, planAtomic: c.plan?.toString() ?? null, subtaskCapAtomic: cap, envelopeRemainingAtomic: envelope - total, agent: c.agent, frozen: false });
      line.candidates.push({ handle: c.agent.handle, quotedUsd: usd(row.amount), listedUsd: usd(c.plan), trust: c.score, fit: relevance(c.agent, st.search.text, st.search.category), decision: v.decision, reasons: [...v.findings.map((f) => `${f.rule}: ${f.message}`), ...c.reasons] });
      if (!line.chosen && v.decision !== "block") {
        line.chosen = { handle: c.agent.handle, priceUsd: usd(row.amount)!, trust: c.score };
        total += BigInt(row.amount);
      }
    }
    lines.push(line);
  }
  return {
    plan: { summary: plan.summary, source },
    budgetUsd: input.budgetUsd,
    envelopeUsd: usd(envelope)!,
    estimatedCostUsd: usd(total)!,
    estimatedMarginUsd: input.budgetUsd - usd(total)!,
    lines,
    note: "Estimate only: prices are live x402 quotes; nothing was signed or paid.",
  };
}
