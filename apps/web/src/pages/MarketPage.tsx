import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Search01Icon } from "@hugeicons/core-free-icons";
import { api } from "../api";
import { Icon } from "../brand";
import { useDebounced, useApi } from "../lib/data";
import { useSession } from "../shell/session";
import { Button, Card, Empty, ErrorNote, Json, Pill, Skeleton, useAction } from "../ui";

/** Browse the Agent Market, ask for a free x402 quote, and see GUARD's verdict. Nothing is paid. */
export default function MarketPage() {
  const { config } = useSession();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "research";
  const dq = useDebounced(q, 350);
  const agents = useApi<{ agents: any[] }>(dq.trim() ? `/market/agents?q=${encodeURIComponent(dq.trim())}` : null, { maxAge: 60_000 });
  const [quote, setQuote] = useState<{ handle: string; data: any } | null>(null);
  const { run, busy } = useAction();
  const live = config!.mode === "live";

  return (
    <div className="stack">
      <Card title={live ? "NEAR AI Agent Market" : "Agent Market (simulated)"} note="Trust combines the market's reputation data with Veyra's own history with each agent. A quote is the agent's live x402 price. It is free and moves no money.">
        <div className="btn-row">
          <label className="search">
            <Icon icon={Search01Icon} size={16} />
            <span className="sr-only">Search agents</span>
            <input value={q} onChange={(e) => setParams(e.target.value ? { q: e.target.value } : {}, { replace: true })} placeholder="Search by skill, for example research or data" />
          </label>
        </div>
        <div style={{ marginTop: "var(--s-4)" }}>
          {agents.loading && <Skeleton lines={5} />}
          {agents.error && <ErrorNote message={agents.error} retry={agents.reload} />}
          {agents.data && !agents.data.agents.length && <Empty title="No agents match">Try a broader word, such as "research", "data" or "writing".</Empty>}
          {agents.data && agents.data.agents.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Agent</th><th>Category</th><th className="num">Delivered</th><th className="num">Success</th><th>Trust</th><th /></tr></thead>
                <tbody>
                  {agents.data.agents.map((a) => (
                    <tr key={a.agent_id}>
                      <td><Link to={`/app/watchtower/${encodeURIComponent(a.handle)}`} className="mono">{a.handle}</Link><div className="small muted">{a.description?.slice(0, 90)}</div></td>
                      <td>{a.category}</td>
                      <td className="num">{a.delivered_jobs ?? 0}</td>
                      <td className="num">{a.success_rate === null ? "—" : a.success_rate > 1 ? `${a.success_rate}%` : `${Math.round(a.success_rate * 100)}%`}</td>
                      <td><Pill tone={a.trust.score >= 45 ? "good" : a.trust.score >= 25 ? "warn" : "bad"} title={a.trust.reasons.join("; ")}>{a.trust.score}</Pill></td>
                      <td><Button size="sm" loading={busy === `Quoting ${a.handle}`} onClick={() => run(`Quoting ${a.handle}`, async () => setQuote({ handle: a.handle, data: await api(`/market/quote?handle=${encodeURIComponent(a.handle)}`) }))}>Get quote</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>
      {quote && (
        <Card title={`Quote from ${quote.handle}`} note="The 402 challenge as received, the listed price, and GUARD's verdict on paying it." actions={<Button size="sm" variant="ghost" onClick={() => setQuote(null)}>Close</Button>}>
          {quote.data.verdict && <div className={`alert ${quote.data.verdict.decision === "allow" ? "good" : quote.data.verdict.decision === "block" ? "bad" : "warn"}`}>GUARD would {quote.data.verdict.decision === "allow" ? "pay this" : quote.data.verdict.decision === "block" ? "refuse this" : "ask the owner first"}{quote.data.verdict.findings?.length ? `: ${quote.data.verdict.findings.map((f: any) => f.message).join(" ")}` : "."}</div>}
          <Json value={{ quote: quote.data.quote, listedPrice: quote.data.plan?.price_amount }} />
        </Card>
      )}
    </div>
  );
}
