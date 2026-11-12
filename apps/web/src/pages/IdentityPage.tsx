import { useEffect, useState } from "react";
import { Copy01Icon, IdentityCardIcon } from "@hugeicons/core-free-icons";
import { api, post } from "../api";
import { Icon } from "../brand";
import { signMessage } from "../wallet";
import { Field, Json, Section, useRunner } from "../ui";

/** Who Veyra is, how another agent hires it, and a free estimate for any job. */
export function IdentityPage({ mode }: { mode: "sim" | "live" }) {
  const r = useRunner();
  const [kya, setKya] = useState<any>(null);
  const [job, setJob] = useState({ title: "Competitor scan", brief: "Research competitors to NEAR Intents agent wallets and write a short report with a pricing table.", budget: "4" });
  const [est, setEst] = useState<any>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = async () => setKya(await api("/kya"));
  useEffect(() => void load(), []);

  const apiUrl = kya?.credential.agent.endpoints.api ?? "http://localhost:8787";
  const mcpCmd = `claude mcp add --transport http veyra ${apiUrl}/mcp`;
  const a2aCmd = `curl -s ${apiUrl}/a2a/v1 -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"SendMessage","params":{"message":{"parts":[{"text":"Research competitors to NEAR agent wallets and write a short report."}],"metadata":{"budgetUsd":4}}}}'`;
  const c = kya?.credential;
  const copy = async (key: string, text: string) => { await navigator.clipboard.writeText(text).catch(() => undefined); setCopied(key); setTimeout(() => setCopied(null), 1500); };

  return (
    <>
      <div className="split even">
        <Section title="Know-your-agent credential" note="Signed with Veyra's receipt key. Anyone can recompute the hash and check the signature. The owner can countersign it with their NEAR wallet (NEP-413).">
          {c && (
            <dl className="kv">
              <dt>Principal</dt><dd className="mono">{c.principal?.nearAccount ?? "—"}</dd>
              <dt>Paid at</dt><dd className="mono">{c.controls.paidAt}</dd>
              <dt>Pays only to</dt><dd>{c.controls.paysOnlyTo}</dd>
              <dt>Mandate</dt><dd>v{c.controls.mandate.version} · largest job {c.controls.mandate.maxJobUsd} USDC · {c.controls.mandate.maxDailyUsd} USDC a day · margin {(c.controls.mandate.marginBps / 100).toFixed(1)}%</dd>
              <dt>Working float</dt><dd>{c.controls.maxFloatUsdc} USDC</dd>
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

        <Section title="Three ways to hire Veyra" note="Through the Agent Market listing, over A2A with an x402 cheque, or over MCP. The first two need no account with Veyra at all.">
          <h4>1 · With a cheque (A2A + x402)</h4>
          <p className="note">Send the job. The reply is a 402 naming the price and Veyra's spend account, the same payee published at <code>/.well-known/x402</code>. Resend it with an <code>X-PAYMENT</code> header carrying a NEP-366 cheque. The cheque is executed only when the job is delivered.</p>
          <div className="codeline">
            <code>{a2aCmd}</code>
            <button aria-label="Copy" onClick={() => copy("a2a", a2aCmd)}><Icon icon={Copy01Icon} size={15} />{copied === "a2a" ? "Copied" : ""}</button>
          </div>
          <h4>2 · From an MCP client</h4>
          <div className="codeline">
            <code>{mcpCmd}</code>
            <button aria-label="Copy" onClick={() => copy("mcp", mcpCmd)}><Icon icon={Copy01Icon} size={15} />{copied === "mcp" ? "Copied" : ""}</button>
          </div>
          <ul className="toollist">
            {[["veyra_estimate", "price a job with live quotes, free"], ["veyra_hire", "create a contract"], ["veyra_contract", "follow it and read the deliverable"], ["watchtower_check", "vet any market agent before paying it"], ["watchtower_proof", "prove a verdict against its anchored root"], ["verify_receipt", "audit a payment against its anchor"], ["veyra_mandate", "the owner's signed limits"], ["veyra_identity", "this credential"], ["veyra_ledger", "the public ledger"]].map(([n, d]) => <li key={n}><code>{n}</code><span>{d}</span></li>)}
          </ul>
          <h4>3 · On the Agent Market</h4>
          <p className="note">{mode === "sim" ? "In the simulator, use Hire Veyra on the Business page." : "Hire the Veyra listing on market.near.ai; the market escrows the budget."}</p>
        </Section>
      </div>

      <Section title="Estimate a job" note="Plans the job, asks each candidate agent for a live x402 quote and runs GUARD on every quote. Nothing is signed or paid.">
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
                      <td>{l.chosen ? <><span className="mono">{l.chosen.handle}</span> <span className="note">{l.chosen.priceUsd.toFixed(2)}</span></> : <span className="pill warn">none within the cap</span>}</td>
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
