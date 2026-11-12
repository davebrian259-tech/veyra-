import type { Db } from "../db.js";
import { json, now, parse } from "../db.js";
import { canonicalJson, randomId, sha256Hex } from "../lib/crypto.js";
import { notFound } from "../lib/errors.js";
import { planPriceAtomic, type MarketCatalog } from "../market/catalog.js";
import type { MarketAgent, PricingPlan, TreasuryRecipient, X402Challenge } from "../market/types.js";
import type { X402Caller } from "../market/x402.js";
import type { ContractorGuard } from "../contractor/guard.js";
import { leafHash, merkleProof, merkleRoot, verifyProof, type ReceiptService } from "../contractor/receipts.js";

/**
 * WATCHTOWER — integrity surveillance for the whole Agent Market.
 *
 * For every listed agent it reads the published pricing plan and asks for an x402 quote (a 402
 * challenge is free and creates no task), then checks the challenge against what the market
 * itself publishes: the settlement recipient at /.well-known/x402 and the agent's price.
 * Violations become signed evidence, anchored with Veyra's receipts and filed as threat
 * reports in the `veyra-ledger` contract, where any agent can read them before paying.
 */

export type Verdict = "ok" | "warn" | "flagged" | "offline";

export interface Finding {
  check: string;
  severity: "info" | "warn" | "flag";
  message: string;
}

export interface AgentResult {
  handle: string;
  agentId: string | null;
  name: string | null;
  category: string | null;
  verdict: Verdict;
  quotedAtomic: string | null;
  listedAtomic: string | null;
  payTo: string | null;
  network: string | null;
  deliveredJobs: number | null;
  trust: number | null;
  findings: Finding[];
  evidenceHash: string | null;
}

/** The bytes that stand for one verdict in the scan's Merkle tree. */
export const rowHash = (scanId: string, r: AgentResult, at: string) =>
  sha256Hex(canonicalJson({ scanId, at, handle: r.handle, agentId: r.agentId, verdict: r.verdict, quotedAtomic: r.quotedAtomic, listedAtomic: r.listedAtomic, payTo: r.payTo, network: r.network, findings: r.findings, evidenceHash: r.evidenceHash }));

export interface ThreatReporter {
  readonly target: string;
  report(subject: string, kind: string, evidenceHash: string): Promise<string>;
}

const PROBE = "Price check\nVeyra Watchtower integrity probe. No work is requested; this call carries no payment.";
const fmt = (a: string | null) => (a === null ? "—" : (Number(BigInt(a)) / 1e6).toFixed(Number(BigInt(a)) < 10_000 ? 6 : 2));

/** Pure: judges one agent's published data and its 402 challenge. */
export function judge(agent: MarketAgent, plan: PricingPlan | null, challenge: X402Challenge | null, treasury: TreasuryRecipient[], unavailable: string | null): Omit<AgentResult, "trust" | "evidenceHash"> {
  const findings: Finding[] = [];
  const listed = plan ? planPriceAtomic(plan) : null;
  const base = { handle: agent.handle, agentId: agent.agent_id ?? null, name: agent.name ?? null, category: agent.category ?? null, deliveredJobs: agent.delivered_jobs ?? null };
  if (unavailable) return { ...base, verdict: "offline", quotedAtomic: null, listedAtomic: listed, payTo: null, network: null, findings: [{ check: "reachable", severity: "info", message: unavailable }] };
  if (!plan) findings.push({ check: "published_price", severity: "warn", message: "No default pricing plan is published, so a quote cannot be checked." });
  const row = challenge?.accepts?.[0];
  if (!row) {
    findings.push({ check: "payable", severity: "warn", message: "The 402 challenge lists no payment route." });
    return { ...base, verdict: "warn", quotedAtomic: null, listedAtomic: listed, payTo: null, network: null, findings };
  }
  const pinned = treasury.find((t) => t.network === row.network);
  if (!pinned) findings.push({ check: "network", severity: "flag", message: `Asks for payment on ${row.network}, a network the market does not settle on.` });
  else {
    if (pinned.asset !== row.asset) findings.push({ check: "asset", severity: "flag", message: `Asks for asset ${row.asset} instead of the market's ${pinned.asset}.` });
    if (pinned.payTo !== row.payTo) findings.push({ check: "payee", severity: "flag", message: `Asks to be paid to ${row.payTo} instead of the market treasury ${pinned.payTo}.` });
  }
  if (listed !== null && BigInt(row.amount) > BigInt(listed)) findings.push({ check: "price", severity: "flag", message: `Quotes ${fmt(row.amount)} USDC against a listed ${fmt(listed)} USDC (charges more than advertised).` });
  else if (listed !== null && BigInt(row.amount) < BigInt(listed)) findings.push({ check: "price", severity: "info", message: `Quotes ${row.amount} atomic units, below the listed ${listed}; no buyer is harmed.` });
  if (row.scheme !== "exact") findings.push({ check: "scheme", severity: "warn", message: `Uses x402 scheme "${row.scheme}".` });
  const sla = plan?.sla_seconds ?? agent.sla_seconds ?? null;
  if (sla !== null && Math.abs(row.maxTimeoutSeconds - (sla + 600)) > 60) findings.push({ check: "validity_window", severity: "warn", message: `Payment window ${row.maxTimeoutSeconds}s does not match the SLA ${sla}s + 600s.` });
  // Long windows follow from long SLAs and are allowed by the spec; buyers should still know.
  if (row.maxTimeoutSeconds > 7 * 86_400) findings.push({ check: "long_validity", severity: "warn", message: `Asks for a cheque valid for ${Math.round(row.maxTimeoutSeconds / 86_400)} days (SLA-driven); Veyra will not sign one that long.` });
  const verdict: Verdict = findings.some((f) => f.severity === "flag") ? "flagged" : findings.some((f) => f.severity === "warn") ? "warn" : "ok";
  return { ...base, verdict, quotedAtomic: row.amount, listedAtomic: listed, payTo: row.payTo, network: row.network, findings };
}

async function pool<T, R>(items: T[], concurrency: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }));
  return out;
}

export class Watchtower {
  private running: Promise<unknown> | null = null;

  constructor(
    private readonly db: Db,
    private readonly catalog: MarketCatalog,
    private readonly x402: X402Caller,
    private readonly guard: ContractorGuard,
    private readonly receipts: ReceiptService,
    private readonly reporter: ThreatReporter | null,
    private readonly origin: string,
  ) {}

  /** Every listed agent, paging through the public catalog (50 per page). */
  async listAll(max = 2000): Promise<MarketAgent[]> {
    const all: MarketAgent[] = [];
    for (let offset = 0; offset < max; offset += 50) {
      const page = await this.catalog.page(offset, 50);
      all.push(...page);
      if (page.length < 50) break;
    }
    const seen = new Set<string>();
    return all.filter((a) => (seen.has(a.handle) ? false : (seen.add(a.handle), true)));
  }

  async check(agent: MarketAgent, treasury: TreasuryRecipient[]): Promise<AgentResult> {
    const [plan, q] = await Promise.all([
      this.catalog.defaultPlan(agent.agent_id).catch(() => null),
      this.x402.quote(agent.handle, PROBE).catch((e) => ({ kind: "unavailable" as const, code: 0, message: e instanceof Error ? e.message : String(e) })),
    ]);
    const unavailable = q.kind === "unavailable" ? q.message : q.kind === "free" ? "answered without asking for payment" : null;
    const r = judge(agent, plan, q.kind === "quote" ? q.challenge : null, treasury, unavailable);
    const trust = this.guard.score(agent, agent.handle).score;
    let evidenceHash: string | null = null;
    if (r.verdict === "flagged") {
      const evidence = { standard: "veyra-watchtower-evidence/1", subject: agent.handle, agentId: agent.agent_id, observedAt: now(), marketOrigin: this.origin, publishedTreasury: treasury, publishedPlan: plan, challenge: q.kind === "quote" ? q.challenge : null, findings: r.findings };
      evidenceHash = sha256Hex(canonicalJson(evidence));
      this.db.run("INSERT OR REPLACE INTO kv (key, value_json, updated_at) VALUES (?,?,?)", [`watch.evidence.${evidenceHash}`, json(evidence), now()]);
    }
    return { ...r, trust, evidenceHash };
  }

  /** Scans the market. `limit` caps how many agents are probed (all by default). */
  async scan(opts: { limit?: number; concurrency?: number; onProgress?: (done: number, total: number) => void } = {}) {
    if (this.running) return { alreadyRunning: true };
    const id = randomId("scan_");
    this.db.run("INSERT INTO watch_scans (id, origin, started_at, status) VALUES (?,?,?,?)", [id, this.origin, now(), "running"]);
    const job = (async () => {
      const treasury = await this.catalog.treasury();
      const agents = (await this.listAll()).slice(0, opts.limit ?? 5000);
      let done = 0;
      const results = await pool(agents, opts.concurrency ?? 4, async (a) => {
        const r = await this.check(a, treasury);
        done++;
        opts.onProgress?.(done, agents.length);
        return r;
      });
      const counts = { ok: 0, warn: 0, flagged: 0, offline: 0 };
      const at = now();
      results.sort((a, b) => a.handle.localeCompare(b.handle)); // leaf order is the handle order
      for (const r of results) {
        counts[r.verdict]++;
        this.db.run(
          `INSERT INTO watch_results (scan_id, handle, agent_id, name, category, verdict, quoted_atomic, listed_atomic, pay_to, network, delivered_jobs, trust, findings_json, evidence_hash, row_hash, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [id, r.handle, r.agentId, r.name, r.category, r.verdict, r.quotedAtomic, r.listedAtomic, r.payTo, r.network, r.deliveredJobs, r.trust, json(r.findings), r.evidenceHash, rowHash(id, r, at), at],
        );
        if (r.verdict === "flagged") await this.fileReport(id, r);
      }
      // One Merkle root over every verdict; its receipt is anchored on NEAR with the others.
      const root = results.length ? merkleRoot(results.map((r) => leafHash(rowHash(id, r, at)))) : null;
      const receipt = root ? this.receipts.issue("watchtower_scan", "watchtower", null, { scanId: id, origin: this.origin, root, total: results.length, ...counts, treasury }) : null;
      this.db.run("UPDATE watch_scans SET finished_at = ?, total = ?, ok = ?, warn = ?, flagged = ?, offline = ?, treasury_json = ?, root = ?, receipt_id = ?, status = 'done' WHERE id = ?", [
        now(), results.length, counts.ok, counts.warn, counts.flagged, counts.offline, json(treasury), root, receipt?.id ?? null, id,
      ]);
      await this.receipts.anchorPending().catch(() => undefined);
      return { id, total: results.length, ...counts };
    })();
    this.running = job.catch(() => undefined).finally(() => { this.running = null; });
    return job.catch((e) => {
      this.db.run("UPDATE watch_scans SET status = 'failed', finished_at = ? WHERE id = ?", [now(), id]);
      throw e;
    });
  }

  /** Signed receipt + on-chain threat report; and Veyra itself will never pay this agent. */
  private async fileReport(scanId: string, r: AgentResult) {
    const kind = r.findings.find((f) => f.severity === "flag")?.check ?? "integrity";
    const slug = ({ payee: "payee_swap", price: "price_mismatch", asset: "asset_swap", network: "wrong_network", validity_window: "excessive_validity" } as Record<string, string>)[kind] ?? "integrity";
    this.receipts.issue("watchtower_report", "watchtower", null, { scanId, subject: r.handle, kind: slug, evidenceHash: r.evidenceHash, findings: r.findings });
    this.guard.record(r.handle, "attacks", `watchtower: ${slug}`);
    if (!this.reporter || !r.evidenceHash) return;
    try {
      const ref = await this.reporter.report(r.handle, slug, r.evidenceHash);
      this.db.run("UPDATE watch_results SET report_ref = ? WHERE scan_id = ? AND handle = ?", [ref, scanId, r.handle]);
    } catch {
      /* the report stays in the signed receipts; on-chain filing is retried on the next scan */
    }
  }

  latest() {
    const scan = this.db.get<Record<string, unknown>>("SELECT * FROM watch_scans WHERE status = 'done' ORDER BY started_at DESC LIMIT 1");
    const running = this.db.get<Record<string, unknown>>("SELECT * FROM watch_scans WHERE status = 'running' ORDER BY started_at DESC LIMIT 1");
    if (!scan) return { scan: null, running: running ?? null, results: [], reporter: this.reporter?.target ?? null };
    const results = this.db.all<Record<string, unknown>>("SELECT * FROM watch_results WHERE scan_id = ? ORDER BY CASE verdict WHEN 'flagged' THEN 0 WHEN 'warn' THEN 1 WHEN 'ok' THEN 2 ELSE 3 END, handle", [scan.id as string]);
    return {
      scan: { ...scan, treasury: scan.treasury_json ? parse(scan.treasury_json as string) : null, treasury_json: undefined },
      running: running ?? null,
      reporter: this.reporter?.target ?? null,
      results: results.map((r) => ({ ...r, findings: parse(r.findings_json as string), findings_json: undefined })),
    };
  }

  /** Everything known about one agent: a fresh check, history and evidence. */
  async lookup(handle: string) {
    const agent = await this.catalog.agent(handle).catch(() => null);
    if (!agent) throw notFound("agent");
    const fresh = await this.check(agent, await this.catalog.treasury());
    const history = this.db.all<Record<string, unknown>>("SELECT scan_id, verdict, quoted_atomic, listed_atomic, pay_to, findings_json, evidence_hash, report_ref, created_at FROM watch_results WHERE handle = ? ORDER BY created_at DESC LIMIT 20", [handle]);
    return {
      handle,
      fresh,
      counterparty: this.guard.counterparty(handle),
      history: history.map((h) => ({ ...h, findings: parse(h.findings_json as string), findings_json: undefined })),
      safeToPay: fresh.verdict !== "flagged" && !this.guard.counterparty(handle).blocked,
    };
  }

  /**
   * Proof that an agent's verdict is part of an anchored scan: the row, its hash, the Merkle
   * path to the scan root, and the receipt that carries the root to the ledger contract.
   */
  proof(handle: string, scanId?: string) {
    const row = this.db.get<Record<string, unknown>>(
      scanId ? "SELECT * FROM watch_results WHERE handle = ? AND scan_id = ?" : "SELECT * FROM watch_results WHERE handle = ? AND row_hash IS NOT NULL ORDER BY created_at DESC LIMIT 1",
      scanId ? [handle, scanId] : [handle],
    );
    if (!row?.row_hash) throw notFound("anchored verdict");
    const scan = this.db.get<{ id: string; root: string | null; receipt_id: string | null; finished_at: string }>("SELECT id, root, receipt_id, finished_at FROM watch_scans WHERE id = ?", [row.scan_id as string]);
    const leaves = this.db.all<{ handle: string; row_hash: string }>("SELECT handle, row_hash FROM watch_results WHERE scan_id = ? ORDER BY handle", [row.scan_id as string]).map((l) => leafHash(l.row_hash));
    const index = this.db.all<{ handle: string }>("SELECT handle FROM watch_results WHERE scan_id = ? ORDER BY handle", [row.scan_id as string]).findIndex((l) => l.handle === handle);
    const path = merkleProof(leaves, index);
    const valid = Boolean(scan?.root) && verifyProof(leaves[index], path, scan!.root!);
    return {
      handle, scanId: row.scan_id, scannedAt: scan?.finished_at ?? null,
      verdict: { ...row, findings: parse(row.findings_json as string), findings_json: undefined },
      rowHash: row.row_hash, index, path, root: scan?.root ?? null, valid,
      receipt: scan?.receipt_id ? this.receipts.proof(scan.receipt_id) : null,
    };
  }

  evidence(hash: string) {
    const row = this.db.get<{ value_json: string }>("SELECT value_json FROM kv WHERE key = ?", [`watch.evidence.${hash}`]);
    if (!row) throw notFound("evidence");
    const evidence = parse(row.value_json);
    return { evidence, hash, hashMatches: sha256Hex(canonicalJson(evidence)) === hash };
  }
}
