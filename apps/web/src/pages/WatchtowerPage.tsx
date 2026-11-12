import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Radar01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { post } from "../api";
import { DotMatrix, type DotKind } from "../art";
import { Icon } from "../brand";
import { invalidate, money, usd, useApi, when } from "../lib/data";
import { useSession } from "../shell/session";
import { Bars, Button, Card, Empty, ErrorNote, Pill, Segmented, Skeleton, Stat, statusTone, useAction } from "../ui";

const FILTERS = ["all", "flagged", "warn", "ok", "offline"] as const;
type Filter = (typeof FILTERS)[number];

/** Market integrity: every agent's live quote against its own published price and the market treasury. */
export default function WatchtowerPage() {
  const { config } = useSession();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "analytics" ? "analytics" : "results";
  const filter = (FILTERS.includes(params.get("show") as Filter) ? params.get("show") : "all") as Filter;
  const data = useApi<any>("/watchtower", { every: 5000 });
  const analytics = useApi<any>(tab === "analytics" ? "/watchtower/analytics" : null);
  const navigate = useNavigate();
  const { run, busy } = useAction();
  const [handle, setHandle] = useState("");

  const scan = data.data?.scan;
  const results: any[] = data.data?.results ?? [];
  const shown = useMemo(() => (filter === "all" ? results : results.filter((x) => x.verdict === filter)), [results, filter]);
  const counts = { ok: scan?.ok ?? 0, warn: scan?.warn ?? 0, flagged: scan?.flagged ?? 0, offline: scan?.offline ?? 0 } as Record<DotKind, number>;
  const liveMarket = scan?.origin?.includes("market.near.ai");
  const setQ = (k: string, v: string | null) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };

  return (
    <div className="stack">
      {data.error && <ErrorNote message={data.error} retry={data.reload} />}
      <div className="grid-2" style={{ gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)" }}>
        <Card title="Latest scan" note={scan ? `${scan.total} agents on ${scan.origin}, finished ${when(scan.finished_at)}. Read-only: a quote is a free 402 challenge.` : data.loading ? "Loading…" : "This server has not scanned the market yet."}>
          <div className="stats">
            <Stat label="Honest" value={counts.ok} tone="good" />
            <Stat label="Warnings" value={counts.warn} />
            <Stat label="Flagged" value={counts.flagged} tone={counts.flagged ? "danger" : undefined} />
            <Stat label="Offline" value={counts.offline} />
          </div>
          <div className="btn-row" style={{ marginTop: "var(--s-4)" }}>
            <Button variant="primary" disabled={Boolean(data.data?.running)} loading={busy === "scan"} onClick={() => run("scan", async () => { await post("/watchtower/scan", {}); invalidate("/watchtower"); await data.reload(); }, { success: "Scan finished." })}>
              <Icon icon={Radar01Icon} size={16} /> {data.data?.running ? "Scan running…" : liveMarket ? "Scan the live market" : "Run full scan"}
            </Button>
            {data.data?.reporter && <Pill title="Where flagged agents are reported">reports go to {data.data.reporter}</Pill>}
            {scan?.root && <Link className="btn sm" to="/app/evidence">Scan root is anchored</Link>}
          </div>
        </Card>
        <div className="matrix-card" aria-hidden={!scan}>{scan ? <DotMatrix counts={counts} cols={config!.mode === "sim" && !liveMarket ? 8 : 29} /> : <Skeleton lines={3} height={28} />}</div>
      </div>

      <Card title="Check an agent before paying it" note="A fresh quote compared with the agent's published plan and the market treasury, with its Watchtower history and Veyra's own record of it.">
        <form className="btn-row" onSubmit={(e) => { e.preventDefault(); if (handle.trim()) navigate(`/app/watchtower/${encodeURIComponent(handle.trim())}`); }}>
          <label className="search"><Icon icon={Search01Icon} size={16} /><span className="sr-only">Agent handle</span><input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder={config!.mode === "sim" && !liveMarket ? "payee-swapper" : "agent handle, for example scout-research"} /></label>
          <Button type="submit" variant="primary" disabled={!handle.trim()}>Check agent</Button>
        </form>
      </Card>

      <div className="tabs" role="tablist" aria-label="Watchtower views">
        <button role="tab" aria-selected={tab === "results"} onClick={() => setQ("tab", null)}>Results</button>
        <button role="tab" aria-selected={tab === "analytics"} onClick={() => setQ("tab", "analytics")}>The market, measured</button>
      </div>

      {tab === "results" ? (
        <Card title="Results" note="Flagged means a payee, asset or network swap, or a quote above the listed price. Warnings are unusual but not dishonest.">
          <Segmented label="Filter results" value={filter} onChange={(v) => setQ("show", v === "all" ? null : v)} options={FILTERS.map((f) => ({ value: f, label: f === "all" ? `All · ${results.length}` : `${f} · ${counts[f as DotKind]}` }))} />
          <div style={{ marginTop: "var(--s-3)" }}>
            {data.loading && !scan && <Skeleton lines={6} />}
            {scan && !shown.length && <Empty title="Nothing in this filter">{filter === "flagged" ? "No agent was caught lying about its price or payee in this scan." : "Try another filter."}</Empty>}
            {shown.length > 0 && (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Agent</th><th>Verdict</th><th className="num">Quoted</th><th className="num">Listed</th><th>Findings</th></tr></thead>
                  <tbody>
                    {shown.slice(0, 300).map((x) => (
                      <tr key={x.handle} className="clickable" onClick={() => navigate(`/app/watchtower/${encodeURIComponent(x.handle)}`)}>
                        <td><Link to={`/app/watchtower/${encodeURIComponent(x.handle)}`} className="mono" onClick={(e) => e.stopPropagation()}>{x.handle}</Link><div className="small muted">{x.category ?? ""}{x.delivered_jobs ? ` · ${x.delivered_jobs} jobs` : ""}</div></td>
                        <td><Pill tone={statusTone(x.verdict)}>{x.verdict}</Pill></td>
                        <td className="num mono">{usd(x.quoted_atomic, x.quoted_atomic && Number(x.quoted_atomic) < 10_000 ? 6 : 2)}</td>
                        <td className="num mono">{usd(x.listed_atomic, x.listed_atomic && Number(x.listed_atomic) < 10_000 ? 6 : 2)}</td>
                        <td className="small">{x.findings.map((f: any) => f.message).join(" ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {shown.length > 300 && <p className="small muted" style={{ marginTop: "var(--s-2)" }}>Showing 300 of {shown.length}. Use the filters or check an agent by handle.</p>}
          </div>
        </Card>
      ) : <Analytics a={analytics.data} loading={analytics.loading} error={analytics.error} retry={analytics.reload} />}
    </div>
  );
}

function Analytics({ a, loading, error, retry }: { a: any; loading: boolean; error: string | null; retry: () => void }) {
  if (error) return <ErrorNote message={error} retry={retry} />;
  if (loading || !a) return <Skeleton lines={8} />;
  if (!a.scan) return <Empty title="No scan to measure">Run a scan first. The numbers here come from real listings, prices and quotes.</Empty>;
  const h = a.headline;
  const fmt = (v: number | null) => (v === null ? "—" : v < 0.01 ? v.toFixed(6) : v.toFixed(2));
  return (
    <div className="stack">
      <Card title="Headline" note={`One scan of ${a.scan.origin}, ${when(a.scan.finishedAt)}. Every number is a real listing, a real published price or a real quote. Nothing was paid.`}>
        <div className="stats">
          <Stat label="Agents listed" value={h.agents} />
          <Stat label="Answer a free quote" value={`${h.answeringPct}%`} />
          <Stat label="Publish a price" value={`${h.withPublishedPricePct}%`} />
          <Stat label="Honest quotes" value={`${h.honestQuotesPct}%`} tone="good" />
          <Stat label="Flagged" value={h.flagged} tone={h.flagged ? "danger" : undefined} />
          <Stat label="Delivered jobs, total" value={h.deliveredJobsTotal} />
          <Stat label="Top 10 agents' share of jobs" value={`${h.top10ShareOfJobsPct}%`} />
          <Stat label="Gini of delivered jobs" value={h.jobsGini} />
        </div>
      </Card>
      <div className="grid-2">
        <Card title="Prices per call (USDC)" note={`${a.prices.underOneCent} agents list under one cent; ${a.prices.overTenDollars} list over ten dollars.`}>
          <div className="table-wrap">
            <table>
              <thead><tr><th /><th className="num">p10</th><th className="num">median</th><th className="num">p90</th><th className="num">min</th><th className="num">max</th></tr></thead>
              <tbody>
                <tr><td>Listed</td><td className="num mono">{fmt(a.prices.listed.p10)}</td><td className="num mono">{fmt(a.prices.listed.p50)}</td><td className="num mono">{fmt(a.prices.listed.p90)}</td><td className="num mono">{fmt(a.prices.listed.min)}</td><td className="num mono">{fmt(a.prices.listed.max)}</td></tr>
                <tr><td>Quoted live</td><td className="num mono">{fmt(a.prices.quoted.p10)}</td><td className="num mono">{fmt(a.prices.quoted.p50)}</td><td className="num mono">{fmt(a.prices.quoted.p90)}</td><td className="num mono">—</td><td className="num mono">—</td></tr>
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="The market through GUARD" note={`Every live quote run through Veyra's payment rules at a generous cap: ${a.guard.quotesChecked} quotes.`}>
          <Bars rows={[
            { label: "Would pay", value: a.guard.decisions.allow, tone: "accent" },
            { label: "Would ask the owner", value: a.guard.decisions.require_approval },
            { label: "Would refuse", value: a.guard.decisions.block, tone: "bad" },
          ]} />
          {a.guard.blockReasons.length > 0 && <div style={{ marginTop: "var(--s-4)" }}><p className="small muted" style={{ marginBottom: "var(--s-2)" }}>Why it would refuse</p><Bars tone="bad" rows={a.guard.blockReasons.map((r: any) => ({ label: r.rule.replace(/_/g, " "), value: r.agents }))} /></div>}
        </Card>
      </div>
      <Card title="By category" note="How many agents, how many answer, what they charge, and how much work they have done.">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Category</th><th className="num">Agents</th><th className="num">Online</th><th className="num">Median price</th><th className="num">Delivered jobs</th><th className="num">Flagged</th></tr></thead>
            <tbody>{a.categories.map((c: any) => <tr key={c.category}><td>{c.category}</td><td className="num">{c.agents}</td><td className="num">{c.online} ({c.onlinePct}%)</td><td className="num mono">{fmt(c.medianPriceUsd)}</td><td className="num">{c.deliveredJobs}</td><td className="num">{c.flagged}</td></tr>)}</tbody>
          </table>
        </div>
      </Card>
      <div className="grid-2">
        <Card title="Trust score distribution" note="Veyra's own score: delivery history, success rate, age, verification, and its experience with the agent.">
          <Bars rows={a.trustHistogram.map((b: any) => ({ label: `${b.from}–${b.to}`, value: b.agents }))} />
        </Card>
        <Card title="Most active agents">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Agent</th><th className="num">Delivered</th><th className="num">Listed</th><th>Verdict</th></tr></thead>
              <tbody>{a.topAgents.map((t: any) => <tr key={t.handle}><td><Link to={`/app/watchtower/${encodeURIComponent(t.handle)}`} className="mono">{t.handle}</Link><div className="small muted">{t.category}</div></td><td className="num">{t.deliveredJobs}</td><td className="num mono">{t.listedUsd === null ? "—" : money(t.listedUsd)}</td><td><Pill tone={statusTone(t.verdict)}>{t.verdict}</Pill></td></tr>)}</tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
