/**
 * `pnpm watchtower` — scan the REAL NEAR AI Agent Market for payment-integrity problems.
 *
 * Read-only: for each listed agent it reads the published pricing plan and asks for an unpaid
 * x402 quote (a 402 challenge is free and creates no task), then checks the challenge against
 * the market's published treasury and price. Writes docs/watchtower/latest.{json,md}.
 * Options: LIMIT=<n> to scan fewer agents, CONCURRENCY=<n> (default 3).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ContractorGuard } from "../contractor/guard.js";
import { ReceiptService } from "../contractor/receipts.js";
import { Db } from "../db.js";
import { SecretBox } from "../lib/crypto.js";
import { LIVE_MARKET, MarketCatalog } from "../market/catalog.js";
import { X402Caller } from "../market/x402.js";
import { Watchtower } from "../watchtower/scanner.js";
import { analyticsMarkdown, marketAnalytics } from "../watchtower/analytics.js";

const db = new Db(":memory:");
const catalog = new MarketCatalog(LIVE_MARKET);
const guard = new ContractorGuard(db);
const wt = new Watchtower(db, catalog, new X402Caller(LIVE_MARKET), guard, new ReceiptService(db, SecretBox.fromConfig({ production: false, devKeyPath: ":memory:" }), null), null, LIVE_MARKET.origin);

const started = Date.now();
console.log(`WATCHTOWER scanning ${LIVE_MARKET.origin} (read-only, no payments)…`);
const res = await wt.scan({
  limit: process.env.LIMIT ? Number(process.env.LIMIT) : undefined,
  concurrency: Number(process.env.CONCURRENCY ?? 3),
  onProgress: (d, t) => { if (d % 50 === 0 || d === t) process.stdout.write(`  ${d}/${t}\n`); },
});
const latest = wt.latest();
const s = latest.scan as unknown as Record<string, number | string>;
const rows = latest.results as unknown as { handle: string; verdict: string; quoted_atomic: string | null; listed_atomic: string | null; pay_to: string | null; delivered_jobs: number | null; trust: number | null; category: string | null; findings: { check: string; severity: string; message: string }[] }[];
const fmt = (a: string | null) => (a === null ? "—" : (Number(BigInt(a)) / 1e6).toFixed(2));
const byCheck = new Map<string, number>();
for (const r of rows) for (const f of r.findings) if (f.severity !== "info") byCheck.set(f.check, (byCheck.get(f.check) ?? 0) + 1);

console.log(`\nScanned ${s.total} agents in ${Math.round((Date.now() - started) / 1000)}s: ${s.ok} ok · ${s.warn} warn · ${s.flagged} flagged · ${s.offline} offline`);
console.log(`Findings by check: ${[...byCheck].map(([k, v]) => `${k} ${v}`).join(" · ") || "none"}`);
for (const r of rows.filter((x) => x.verdict === "flagged")) console.log(`  FLAGGED ${r.handle}: ${r.findings.filter((f) => f.severity === "flag").map((f) => f.message).join(" ")}`);

const outDir = join(dirname(fileURLToPath(import.meta.url)), "../../../../docs/watchtower");
mkdirSync(outDir, { recursive: true });
const generatedAt = new Date().toISOString();
const analytics = marketAnalytics(db, guard);
if (analytics) writeFileSync(join(outDir, "analytics.md"), analyticsMarkdown(analytics));
writeFileSync(join(outDir, "latest.json"), JSON.stringify({ generatedAt, origin: LIVE_MARKET.origin, summary: { total: s.total, ok: s.ok, warn: s.warn, flagged: s.flagged, offline: s.offline }, treasury: (latest.scan as { treasury: unknown }).treasury, findingsByCheck: Object.fromEntries(byCheck), agents: rows }, null, 2));
const md = [
  "# Watchtower report: NEAR AI Agent Market",
  "",
  `Generated ${generatedAt} by \`pnpm watchtower\` against ${LIVE_MARKET.origin}. Read-only: unpaid x402 quotes (free 402 challenges) checked against each agent's published pricing plan and the market's published treasury.`,
  "",
  `| Agents scanned | OK | Warnings | Flagged | Offline |`,
  `|---|---|---|---|---|`,
  `| ${s.total} | ${s.ok} | ${s.warn} | ${s.flagged} | ${s.offline} |`,
  "",
  `Findings by check: ${[...byCheck].map(([k, v]) => `\`${k}\` ${v}`).join(", ") || "none"}.`,
  "",
  "## Flagged and warned agents",
  "",
  "| Agent | Category | Verdict | Quoted | Listed | Jobs | Finding |",
  "|---|---|---|---|---|---|---|",
  ...rows.filter((r) => r.verdict === "flagged" || r.verdict === "warn").map((r) => `| \`${r.handle}\` | ${r.category ?? ""} | ${r.verdict} | ${fmt(r.quoted_atomic)} | ${fmt(r.listed_atomic)} | ${r.delivered_jobs ?? 0} | ${r.findings.filter((f) => f.severity !== "info").map((f) => f.message).join(" ").replace(/\|/g, "/")} |`),
  "",
].join("\n");
writeFileSync(join(outDir, "latest.md"), md);
console.log(`\nWrote docs/watchtower/latest.md and latest.json (scan ${res && "id" in res ? res.id : ""}).`);
