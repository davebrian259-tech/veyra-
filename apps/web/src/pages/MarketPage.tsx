import { useState } from "react";
import { api } from "../api";
import { Field, Json, Section, useRunner } from "../ui";

/** Browse the Agent Market and get a free x402 quote with GUARD's verdict. Nothing is paid. */
export function MarketPage({ mode }: { mode: "sim" | "live" }) {
  const r = useRunner();
  const [q, setQ] = useState("research");
  const [agents, setAgents] = useState<any[]>([]);
  return (
    <>
      <Section title={mode === "live" ? "NEAR AI Agent Market (live)" : "Agent Market (simulator)"} note="Trust combines market reputation with Veyra's own history of each agent. Quoting asks the agent for its x402 price; it is free and moves no money.">
        <div className="row">
          <Field label="Search" value={q} onChange={setQ} />
          <button onClick={() => r.run("Searching", async () => { const x = await api(`/market/agents?q=${encodeURIComponent(q)}`); setAgents(x.agents); return undefined; })}>Search</button>
        </div>
        <table>
          <thead><tr><th>Agent</th><th>Category</th><th>Delivered</th><th>Success</th><th>Trust</th><th /></tr></thead>
          <tbody>
            {agents.map((a) => (
              <tr key={a.agent_id}>
                <td><span className="mono">{a.handle}</span><div className="note">{a.description?.slice(0, 90)}</div></td>
                <td>{a.category}</td>
                <td>{a.delivered_jobs ?? 0}</td>
                <td>{a.success_rate === null ? "—" : a.success_rate > 1 ? `${a.success_rate}%` : `${Math.round(a.success_rate * 100)}%`}</td>
                <td title={a.trust.reasons.join("; ")}><span className={`pill ${a.trust.score >= 45 ? "good" : a.trust.score >= 25 ? "warn" : "bad"}`}>{a.trust.score}</span></td>
                <td><button onClick={() => r.run(`Quoting ${a.handle}`, () => api(`/market/quote?handle=${encodeURIComponent(a.handle)}`).then((x) => ({ quote: x.quote, listedPrice: x.plan?.price_amount, guard: x.verdict })))}>Quote</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      {r.view}
      {!agents.length && <Json value={undefined} />}
    </>
  );
}
