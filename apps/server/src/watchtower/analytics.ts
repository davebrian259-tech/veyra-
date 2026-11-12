import type { Db } from "../db.js";
import { parse } from "../db.js";
import type { ContractorGuard } from "../contractor/guard.js";
import type { TreasuryRecipient, X402Requirement } from "../market/types.js";

/**
 * The state of the agent economy, measured. Everything here is computed from one Watchtower
 * scan: real agents, real published prices, real 402 quotes. No model, no estimate, no sample.
 */
interface Row {
  handle: string;
  category: string | null;
  verdict: "ok" | "warn" | "flagged" | "offline";
  quoted_atomic: string | null;
  listed_atomic: string | null;
  pay_to: string | null;
  network: string | null;
  delivered_jobs: number | null;
  trust: number | null;
  findings_json: string;
}

const usd = (a: string | null) => (a === null ? null : Number(BigInt(a)) / 1e6);
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);
const quantile = (xs: number[], q: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo);
};
/** Gini coefficient of a non-negative distribution: 0 is equal, 1 is one agent has it all. */
const gini = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  const total = s.reduce((a, b) => a + b, 0);
  if (!n || !total) return 0;
  let acc = 0;
  s.forEach((x, i) => { acc += (2 * (i + 1) - n - 1) * x; });
  return Math.round((acc / (n * total)) * 1000) / 1000;
};

export function marketAnalytics(db: Db, guard: ContractorGuard, scanId?: string) {
  const scan = db.get<{ id: string; origin: string; finished_at: string; total: number; treasury_json: string | null }>(
    scanId ? "SELECT * FROM watch_scans WHERE id = ? AND status = 'done'" : "SELECT * FROM watch_scans WHERE status = 'done' ORDER BY started_at DESC LIMIT 1",
    scanId ? [scanId] : [],
  );
  if (!scan) return null;
  const rows = db.all<Row>("SELECT handle, category, verdict, quoted_atomic, listed_atomic, pay_to, network, delivered_jobs, trust, findings_json FROM watch_results WHERE scan_id = ?", [scan.id]);
  const treasury: TreasuryRecipient[] = scan.treasury_json ? parse(scan.treasury_json) : [];
  const online = rows.filter((r) => r.verdict !== "offline");
  const priced = rows.filter((r) => r.listed_atomic !== null).map((r) => usd(r.listed_atomic)!);
  const quoted = online.filter((r) => r.quoted_atomic !== null).map((r) => usd(r.quoted_atomic)!);
  const jobs = rows.map((r) => r.delivered_jobs ?? 0);
  const totalJobs = jobs.reduce((a, b) => a + b, 0);
  const top = [...rows].sort((a, b) => (b.delivered_jobs ?? 0) - (a.delivered_jobs ?? 0));
  const top10Jobs = top.slice(0, 10).reduce((a, r) => a + (r.delivered_jobs ?? 0), 0);

  // By category: how many, how many answer, what they charge, how much work they have done.
  const byCategory = new Map<string, Row[]>();
  for (const r of rows) {
    const k = r.category ?? "uncategorised";
    byCategory.set(k, [...(byCategory.get(k) ?? []), r]);
  }
  const categories = [...byCategory.entries()]
    .map(([category, rs]) => {
      const prices = rs.filter((r) => r.listed_atomic !== null).map((r) => usd(r.listed_atomic)!);
      return {
        category,
        agents: rs.length,
        online: rs.filter((r) => r.verdict !== "offline").length,
        onlinePct: pct(rs.filter((r) => r.verdict !== "offline").length, rs.length),
        medianPriceUsd: quantile(prices, 0.5),
        deliveredJobs: rs.reduce((a, r) => a + (r.delivered_jobs ?? 0), 0),
        flagged: rs.filter((r) => r.verdict === "flagged").length,
      };
    })
    .sort((a, b) => b.agents - a.agents);

  // What GUARD would do with every live quote, at a generous cap: the market through Veyra's eyes.
  const decisions = { allow: 0, require_approval: 0, block: 0 };
  const reasons = new Map<string, number>();
  for (const r of online) {
    if (!r.quoted_atomic || !r.pay_to || !r.network) continue;
    const row: X402Requirement = { scheme: "exact", network: r.network, asset: treasury.find((t) => t.network === r.network)?.asset ?? "", amount: r.quoted_atomic, payTo: r.pay_to, maxTimeoutSeconds: 0 };
    const v = guard.checkChallenge({
      contractId: "analytics", subtaskId: r.handle, handle: r.handle, row, treasury, planAtomic: r.listed_atomic, subtaskCapAtomic: 50_000_000n, envelopeRemainingAtomic: 1_000_000_000n,
      agent: { agent_id: r.handle, handle: r.handle, name: r.handle, description: null, category: r.category, tags: null, delivered_jobs: r.delivered_jobs, success_rate: null, sla_seconds: null, available_now: true },
      frozen: false,
    });
    decisions[v.decision]++;
    for (const f of v.findings.filter((x) => x.severity === "block")) reasons.set(f.rule, (reasons.get(f.rule) ?? 0) + 1);
  }

  // Trust: how the market distributes across Veyra's score.
  const trust = rows.map((r) => r.trust).filter((t): t is number => t !== null);
  const buckets = [0, 25, 45, 65, 85, 101];
  const trustHistogram = buckets.slice(0, -1).map((lo, i) => ({ from: lo, to: buckets[i + 1] - 1, agents: trust.filter((t) => t >= lo && t < buckets[i + 1]).length }));

  const findingCounts = new Map<string, number>();
  for (const r of rows) for (const f of parse<{ check: string }[]>(r.findings_json)) findingCounts.set(f.check, (findingCounts.get(f.check) ?? 0) + 1);

  return {
    scan: { id: scan.id, origin: scan.origin, finishedAt: scan.finished_at },
    headline: {
      agents: rows.length,
      answering: online.length,
      answeringPct: pct(online.length, rows.length),
      withPublishedPrice: priced.length,
      withPublishedPricePct: pct(priced.length, rows.length),
      honestQuotesPct: pct(rows.filter((r) => r.verdict === "ok").length, online.length),
      flagged: rows.filter((r) => r.verdict === "flagged").length,
      deliveredJobsTotal: totalJobs,
      agentsWithAnyDelivery: jobs.filter((j) => j > 0).length,
      top10ShareOfJobsPct: pct(top10Jobs, totalJobs),
      jobsGini: gini(jobs),
      categories: byCategory.size,
    },
    prices: {
      listed: { p10: quantile(priced, 0.1), p50: quantile(priced, 0.5), p90: quantile(priced, 0.9), min: priced.length ? Math.min(...priced) : null, max: priced.length ? Math.max(...priced) : null },
      quoted: { p10: quantile(quoted, 0.1), p50: quantile(quoted, 0.5), p90: quantile(quoted, 0.9) },
      underOneCent: priced.filter((p) => p < 0.01).length,
      overTenDollars: priced.filter((p) => p > 10).length,
    },
    categories,
    guard: { decisions, blockReasons: [...reasons.entries()].map(([rule, n]) => ({ rule, agents: n })).sort((a, b) => b.agents - a.agents), quotesChecked: decisions.allow + decisions.require_approval + decisions.block },
    trustHistogram,
    findings: [...findingCounts.entries()].map(([check, n]) => ({ check, agents: n })).sort((a, b) => b.agents - a.agents),
    topAgents: top.slice(0, 10).map((r) => ({ handle: r.handle, category: r.category, deliveredJobs: r.delivered_jobs ?? 0, listedUsd: usd(r.listed_atomic), verdict: r.verdict, trust: r.trust })),
  };
}

export type MarketAnalytics = NonNullable<ReturnType<typeof marketAnalytics>>;

/** The same numbers as a Markdown report (docs/watchtower/analytics.md). */
export function analyticsMarkdown(a: MarketAnalytics) {
  const money = (v: number | null) => (v === null ? "—" : v < 0.01 ? `${v.toFixed(6)}` : `${v.toFixed(2)}`);
  const h = a.headline;
  return [
    `# The NEAR agent economy, measured`,
    ``,
    `From one Watchtower scan of ${a.scan.origin} finished ${a.scan.finishedAt}. Every number comes from a real agent listing, a real published pricing plan or a real x402 quote. Nothing was paid.`,
    ``,
    `## Headline`,
    ``,
    `| Measure | Value |`,
    `|---|---|`,
    `| Agents listed | ${h.agents} |`,
    `| Answering a free 402 quote | ${h.answering} (${h.answeringPct}%) |`,
    `| With a published price | ${h.withPublishedPrice} (${h.withPublishedPricePct}%) |`,
    `| Honest quotes among those answering | ${h.honestQuotesPct}% |`,
    `| Flagged for a price or payee mismatch | ${h.flagged} |`,
    `| Delivered jobs, all agents | ${h.deliveredJobsTotal} |`,
    `| Agents with at least one delivery | ${h.agentsWithAnyDelivery} of ${h.agents} |`,
    `| Share of all jobs done by the top 10 agents | ${h.top10ShareOfJobsPct}% |`,
    `| Gini coefficient of delivered jobs | ${h.jobsGini} |`,
    ``,
    `## Prices (USDC per call)`,
    ``,
    `| | p10 | median | p90 | min | max |`,
    `|---|---|---|---|---|---|`,
    `| Listed | ${money(a.prices.listed.p10)} | ${money(a.prices.listed.p50)} | ${money(a.prices.listed.p90)} | ${money(a.prices.listed.min)} | ${money(a.prices.listed.max)} |`,
    `| Quoted live | ${money(a.prices.quoted.p10)} | ${money(a.prices.quoted.p50)} | ${money(a.prices.quoted.p90)} | | |`,
    ``,
    `${a.prices.underOneCent} agents list under one cent; ${a.prices.overTenDollars} list over ten dollars.`,
    ``,
    `## By category`,
    ``,
    `| Category | Agents | Online | Median price | Delivered jobs | Flagged |`,
    `|---|---|---|---|---|---|`,
    ...a.categories.map((c) => `| ${c.category} | ${c.agents} | ${c.online} (${c.onlinePct}%) | ${money(c.medianPriceUsd)} | ${c.deliveredJobs} | ${c.flagged} |`),
    ``,
    `## The market through GUARD`,
    ``,
    `Every live quote run through Veyra's payment rules at a generous cap: ${a.guard.quotesChecked} quotes, ${a.guard.decisions.allow} would be paid, ${a.guard.decisions.require_approval} would need the owner's approval, ${a.guard.decisions.block} would be refused.`,
    ``,
    `| Block reason | Agents |`,
    `|---|---|`,
    ...a.guard.blockReasons.map((r) => `| \`${r.rule}\` | ${r.agents} |`),
    ``,
    `## Trust score distribution`,
    ``,
    `| Score | Agents |`,
    `|---|---|`,
    ...a.trustHistogram.map((b) => `| ${b.from}–${b.to} | ${b.agents} |`),
    ``,
    `## Most active agents`,
    ``,
    `| Agent | Category | Delivered | Listed | Verdict | Trust |`,
    `|---|---|---|---|---|---|`,
    ...a.topAgents.map((t) => `| \`${t.handle}\` | ${t.category ?? ""} | ${t.deliveredJobs} | ${money(t.listedUsd)} | ${t.verdict} | ${t.trust ?? "—"} |`),
    ``,
  ].join("\n");
}
