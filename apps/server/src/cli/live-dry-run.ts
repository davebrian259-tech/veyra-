/**
 * `pnpm live:dry-run "<task>"` — Veyra against the REAL NEAR AI Agent Market, without paying.
 *
 * Plans the task, searches the live catalog, reads published pricing plans and reputation,
 * asks each candidate for a real x402 quote (a 402 is free), and runs GUARD — payee pinning
 * against market.near.ai/.well-known/x402, price integrity, budget caps, counterparty trust.
 * It never signs a cheque and never sends money.
 */
import { ContractorBrain } from "../contractor/brain.js";
import { ContractorGuard } from "../contractor/guard.js";
import { Db } from "../db.js";
import { LIVE_MARKET, MarketCatalog, planPriceAtomic } from "../market/catalog.js";
import { X402Caller } from "../market/x402.js";
import { rank, relevance } from "../contractor/rank.js";
import type { Candidate } from "../contractor/rank.js";
import { NearAiCloud } from "../services/ai/near-ai.js";
import { AiRouter } from "../services/ai/router.js";

const task = process.argv.slice(2).join(" ") || "Research the main competitors to NEAR Intents agent wallets and write a short report for a founder.";
const budgetUsd = Number(process.env.BUDGET_USD ?? 5);
const db = new Db(":memory:");
const nearAi = process.env.NEAR_AI_API_KEY
  ? new NearAiCloud({ apiKey: process.env.NEAR_AI_API_KEY, baseUrl: "https://cloud-api.near.ai", model: process.env.NEAR_AI_MODEL ?? "z-ai/glm-5.3-flash", requireSignature: false })
  : null;
const brain = new ContractorBrain(new AiRouter(db, nearAi, null));
const guard = new ContractorGuard(db);
const catalog = new MarketCatalog(LIVE_MARKET);
const x402 = new X402Caller(LIVE_MARKET);
const fmt = (a: string | bigint) => (Number(BigInt(a)) / 1e6).toFixed(2);

console.log(`\nLIVE DRY RUN against ${LIVE_MARKET.origin} — budget ${budgetUsd.toFixed(2)} USDC, no payments.\n`);
const treasury = await catalog.treasury();
console.log(`Market treasury (pinned, from /.well-known/x402): ${treasury.map((t) => `${t.payTo.slice(0, 12)}… on ${t.network}, asset ${t.asset.slice(0, 12)}…`).join("; ")}`);
const { plan, source } = await brain.plan(null, task.split(/[.\n]/)[0].slice(0, 100), task);
console.log(`Plan (${source.kind === "ai" ? `${source.provider}${source.verified ? ", TEE-verified" : ""}` : "deterministic planner"}): ${plan.summary}\n`);
const envelope = BigInt(Math.round(budgetUsd * 0.8 * 1e6));
let total = 0n;
for (const st of plan.subtasks) {
  const cap = (envelope * BigInt(Math.round(st.budgetShare * 10_000))) / 9_000n;
  console.log(`▸ ${st.title}  (cap ${fmt(cap)} USDC)`);
  let agents = await catalog.search({ text: st.search.text, category: st.search.category ?? undefined, limit: 10 });
  if (!agents.length) agents = await catalog.search({ text: st.search.text, limit: 10 });
  const cands: Candidate[] = [];
  for (const a of agents.filter((x) => x.available_now !== false).slice(0, 8)) {
    const p = await catalog.defaultPlan(a.agent_id).catch(() => null);
    const { score, reasons } = guard.score(a, a.handle);
    cands.push({ agent: a, plan: p ? BigInt(planPriceAtomic(p)) : null, score, reasons });
  }
  let chosen: string | null = null;
  for (const cand of rank(cands, st.search.text, st.search.category, cap)) {
    const a = cand.agent;
    const q = await x402.quote(a.handle, st.spec).catch((e) => ({ kind: "unavailable" as const, code: 0, message: String(e) }));
    if (q.kind !== "quote") {
      console.log(`   · ${a.handle.padEnd(28)} not taking calls (${q.kind === "unavailable" ? q.message : "free"})`);
      continue;
    }
    const row = q.challenge.accepts[0];
    const v = guard.checkChallenge({ contractId: "dry", subtaskId: st.title, handle: a.handle, row, treasury, planAtomic: cand.plan?.toString() ?? null, subtaskCapAtomic: cap, envelopeRemainingAtomic: envelope - total, agent: a, frozen: false });
    const tag = v.decision === "allow" ? "ALLOW" : v.decision === "require_approval" ? "ASK  " : "BLOCK";
    console.log(`   · ${a.handle.padEnd(28)} quote ${fmt(row.amount)} (listed ${cand.plan !== null ? fmt(cand.plan) : "—"}) trust ${cand.score}/100 fit ${(relevance(a, st.search.text, st.search.category) * 100).toFixed(0)}% → ${tag} ${v.findings.map((f) => f.rule).join(", ")}${cand.reasons.length ? ` [${cand.reasons.join("; ")}]` : ""}`);
    if (!chosen && v.decision !== "block") {
      chosen = a.handle;
      total += BigInt(row.amount);
    }
  }
  console.log(`   ⇒ ${chosen ? `would hire ${chosen}` : "no agent passes GUARD within the cap — would walk away"}\n`);
}
console.log(`Would spend ${fmt(total)} of ${budgetUsd.toFixed(2)} USDC. Nothing was signed or paid.\n`);
