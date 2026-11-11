import { useEffect, useState } from "react";
import { Copy01Icon, IdentityCardIcon } from "@hugeicons/core-free-icons";
import { api, post } from "../api";
import { Icon } from "../brand";
import { signMessage } from "../wallet";
import { Field, Json, Section, useRunner } from "../ui";

/** Who Veyra is (KYA), how other agents reach it (MCP, A2A), and a free job estimate. */
export function IdentityPage({ mode }: { mode: "sim" | "live" }) {
  const r = useRunner();
  const [kya, setKya] = useState<any>(null);
  const [job, setJob] = useState({ title: "Competitor scan", brief: "Research competitors to NEAR Intents agent wallets and write a short report with a pricing table.", budget: "4" });
  const [est, setEst] = useState<any>(null);
  const [copied, setCopied] = useState(false);

  const load = async () => setKya(await api("/kya"));
  useEffect(() => void load(), []);

  const mcpUrl = kya?.credential.agent.endpoints.mcp ?? "http://localhost:8787/mcp";
  const cmd = `claude mcp add --transport http veyra ${mcpUrl}`;
  const c = kya?.credential;

  return (
    <>
      <div className="split even">
        <Section title="Know-your-agent credential" note="Signed with Veyra's receipt key. Anyone can recompute the hash and check the signature. The owner can countersign it with their NEAR wallet (NEP-413).">
          {c && (
            <dl className="kv">
              <dt>Principal</dt><dd className="mono">{c.principal?.nearAccount ?? "—"}</dd>
              <dt>Spend account</dt><dd className="mono">{c.controls.spendAccount}</dd>
              <dt>Max float</dt><dd>{c.controls.maxFloatUsdc} USDC</dd>
              <dt>Margin</dt><dd>{(c.controls.marginBps / 100).toFixed(1)}%</dd>
              <dt>Pays only to</dt><dd>{c.controls.paysOnlyTo}</dd>
              <dt>Ledger</dt><dd className="mono">{c.accountability.ledger.contractId ?? "not deployed"}</dd>
              <dt>Credential hash</dt><dd className="mono small">{kya.hash}</dd>
              <dt>Owner countersign</dt><dd>{kya.ownerAttestation ? <span className="pill good">signed by {kya.ownerAttestation.owner}</span> : <span className="pill">not yet</span>}</dd>
            </dl>
          )}
          <div className="row">
            <button onClick={() => r.run("Verifying", () => post("/kya/verify", { credential: kya.credential, hash: kya.hash, signature: kya.signature }))}><Icon icon={IdentityCardIcon} size={16} /> Verify signature</button>
            {mode === "live" && <button className="btn-dark" onClick={() => r.run("Countersigning", async () => {
              const ch = await post("/kya/challenge");
              const signed = await signMessage(ch.message, ch.recipient, ch.nonce);
              const x = await post("/kya/attest", { hash: ch.hash, signed });
              await load();
              return x;
            })}>Countersign with wallet</button>}
            <a className="btn-light" href="/api/.well-known/agent-card.json" target="_blank" rel="noreferrer">A2A agent card</a>
          </div>
        </Section>

        <Section title="Hire Veyra from any agent" note="Veyra serves MCP over streamable HTTP. Anyone can use the read tools. Hiring needs the owner's session (Authorization: Bearer), except in the simulator.">
          <div className="codeline">
            <code>{cmd}</code>
            <button aria-label="Copy" onClick={async () => { await navigator.clipboard.writeText(cmd).catch(() => undefined); setCopied(true); setTimeout(() => setCopied(false), 1500); }}><Icon icon={Copy01Icon} size={15} />{copied ? "Copied" : ""}</button>
          </div>
          <ul className="toollist">
            {[["veyra_estimate", "price a job with live quotes, free"], ["veyra_hire", "create a contract"], ["veyra_contract", "follow it and read the deliverable"], ["watchtower_check", "vet any market agent before paying"], ["verify_receipt", "audit a payment against its anchor"], ["veyra_identity", "this credential"], ["veyra_ledger", "the public P&L"]].map(([n, d]) => <li key={n}><code>{n}</code><span>{d}</span></li>)}
          </ul>
        </Section>
      </div>

      <Section title="Estimate a job" note="Plans the job and asks each candidate agent for a live x402 quote, then runs GUARD on each quote. Nothing is signed or paid.">
        <div className="row">
          <Field label="Title" value={job.title} onChange={(v) => setJob({ ...job, title: v })} />
          <Field label="Budget (USDC)" value={job.budget} onChange={(v) => setJob({ ...job, budget: v })} />
        </div>
        <Field label="Brief" value={job.brief} onChange={(v) => setJob({ ...job, brief: v })} textarea />
        <button className="btn-dark" disabled={r.busy !== null} onClick={async () => { const x = await r.run("Collecting quotes", () => post("/estimate", { title: job.title, brief: job.brief, budgetUsd: Number(job.budget) })); if (x) { setEst(x); r.setResult(undefined); } }}>Get estimate</button>
        {est && (
          <>
            <div className="stats">
              <div className="stat"><div className="stat-label">Budget</div><div className="stat-value">{est.budgetUsd.toFixed(2)}</div></div>
              <div className="stat"><div className="stat-label">Subcontract envelope</div><div className="stat-value">{est.envelopeUsd.toFixed(2)}</div></div>
              <div className="stat"><div className="stat-label">Estimated cost</div><div className="stat-value">{est.estimatedCostUsd.toFixed(2)}</div></div>
              <div className="stat accent"><div className="stat-label">Estimated margin</div><div className="stat-value">{est.estimatedMarginUsd.toFixed(2)}</div></div>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Subtask</th><th className="num">Cap</th><th>Chosen</th><th>Candidates</th></tr></thead>
                <tbody>
                  {est.lines.map((l: any) => (
                    <tr key={l.subtask}>
                      <td>{l.subtask}</td>
                      <td className="num mono">{l.capUsd.toFixed(2)}</td>
                      <td>{l.chosen ? <><span className="mono">{l.chosen.handle}</span> <span className="note">{l.chosen.priceUsd.toFixed(2)}</span></> : <span className="pill warn">none in cap</span>}</td>
                      <td className="small">{l.candidates.map((x: any) => `${x.handle} ${x.quotedUsd === null ? "offline" : x.quotedUsd.toFixed(2)} → ${x.decision}`).join(" · ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Section>
      {r.view}
      <details className="raw"><summary>Raw credential</summary><Json value={kya} /></details>
    </>
  );
}
