import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { IdentityCardIcon } from "@hugeicons/core-free-icons";
import { post } from "../api";
import { Icon } from "../brand";
import { invalidate, money, useApi } from "../lib/data";
import { loadWallet, useSession } from "../shell/session";
import { Button, Card, CopyButton, ErrorNote, Field, Json, Pill, Skeleton, Stat, useAction } from "../ui";

/** Who Veyra is, how another agent hires it, and a free estimate for any job. */
export default function IdentityPage() {
  const { config } = useSession();
  const mode = config!.mode;
  const kya = useApi<any>("/kya");
  const { run, busy } = useAction();
  const [verify, setVerify] = useState<any>(undefined);
  const location = useLocation();
  useEffect(() => { if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: "smooth" }); }, [location.hash]);

  if (kya.error) return <ErrorNote message={kya.error} retry={kya.reload} />;
  if (!kya.data) return <Skeleton lines={8} height={22} />;
  const c = kya.data.credential;
  const apiUrl: string = c.agent.endpoints.api;
  const mcpCmd = `claude mcp add --transport http veyra ${apiUrl}/mcp`;
  const a2aCmd = `curl -s ${apiUrl}/a2a/v1 -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"SendMessage","params":{"message":{"parts":[{"text":"Research competitors to NEAR agent wallets and write a short report."}],"metadata":{"budgetUsd":4}}}}'`;

  return (
    <div className="stack">
      <div className="grid-2">
        <Card title="Know-your-agent credential" note="Signed with Veyra's receipt key. Anyone can recompute the hash and check the signature. In live mode the owner countersigns it with their wallet.">
          <dl className="kv">
            <dt>Principal</dt><dd className="mono">{c.principal?.nearAccount ?? "—"}</dd>
            <dt>Paid at</dt><dd className="mono">{c.controls.paidAt}</dd>
            <dt>Pays only to</dt><dd>{c.controls.paysOnlyTo}</dd>
            <dt>Mandate</dt><dd>v{c.controls.mandate.version} · largest job {c.controls.mandate.maxJobUsd} USDC · {c.controls.mandate.maxDailyUsd} USDC a day · margin {(c.controls.mandate.marginBps / 100).toFixed(1)}%</dd>
            <dt>Working float</dt><dd>{c.controls.maxFloatUsdc} USDC</dd>
            <dt>Ledger</dt><dd className="mono">{c.accountability.ledger.contractId ?? "not deployed"}</dd>
            <dt>Credential hash</dt><dd className="mono small">{kya.data.hash}</dd>
            <dt>Owner countersign</dt><dd>{kya.data.ownerAttestation ? <Pill tone="good">signed by {kya.data.ownerAttestation.owner}</Pill> : <Pill>not yet</Pill>}</dd>
          </dl>
          <div className="btn-row" style={{ marginTop: "var(--s-4)" }}>
            <Button loading={busy === "verify"} onClick={() => run("verify", async () => setVerify(await post("/kya/verify", { credential: kya.data.credential, hash: kya.data.hash, signature: kya.data.signature })))}><Icon icon={IdentityCardIcon} size={16} /> Verify signature</Button>
            {mode === "live" && <Button variant="primary" loading={busy === "sign"} onClick={() => run("sign", async () => {
              const ch = await post("/kya/challenge");
              const w = await loadWallet();
              const signed = await w.signMessage(ch.message, ch.recipient, ch.nonce);
              await post("/kya/attest", { hash: ch.hash, signed });
              invalidate("/kya"); await kya.reload();
            }, { success: "Credential countersigned." })}>Countersign with wallet</Button>}
            <a className="btn" href="/api/.well-known/agent-card.json" target="_blank" rel="noreferrer">A2A agent card</a>
          </div>
          {verify !== undefined && <div className={`alert ${verify.hashMatches && verify.signatureValid ? "good" : "bad"}`} style={{ marginTop: "var(--s-3)" }}>Hash {verify.hashMatches ? "matches" : "does not match"} · signature {verify.signatureValid ? "valid" : "invalid"}</div>}
        </Card>

        <Card title="Three ways to hire Veyra" note="Through the Agent Market listing, over A2A with an x402 cheque, or from an MCP client. The first two need no account with Veyra.">
          <div id="hire" className="stack">
            <div>
              <h3 style={{ fontSize: "var(--fs-md)" }}>1 · With a cheque (A2A + x402)</h3>
              <p className="small muted" style={{ margin: "var(--s-1) 0 var(--s-2)" }}>Send the job. The reply is a 402 naming the price and Veyra's spend account, the same payee published at <code>/.well-known/x402</code>. Resend it with an <code>X-PAYMENT</code> header carrying a NEP-366 cheque. The cheque is executed only when the job is delivered.</p>
              <div className="codeline"><code>{a2aCmd}</code><CopyButton text={a2aCmd} label="" /></div>
            </div>
            <div>
              <h3 style={{ fontSize: "var(--fs-md)" }}>2 · From an MCP client</h3>
              <div className="codeline" style={{ margin: "var(--s-2) 0" }}><code>{mcpCmd}</code><CopyButton text={mcpCmd} label="" /></div>
              <ul className="small" style={{ margin: 0, paddingLeft: "1.2em", color: "var(--fg-2)" }}>
                {[["veyra_estimate", "price a job with live quotes, free"], ["veyra_hire", "create a contract"], ["veyra_contract", "follow it and read the deliverable"], ["watchtower_check", "vet any market agent before paying it"], ["watchtower_proof", "prove a verdict against its anchored root"], ["market_analytics", "the market, measured"], ["verify_receipt", "audit a payment against its anchor"], ["veyra_mandate", "the owner's signed limits"], ["veyra_identity", "this credential"], ["veyra_ledger", "the public ledger"]].map(([n, d]) => <li key={n}><code>{n}</code> · {d}</li>)}
              </ul>
            </div>
            <div>
              <h3 style={{ fontSize: "var(--fs-md)" }}>3 · On the Agent Market</h3>
              <p className="small muted" style={{ marginTop: "var(--s-1)" }}>{mode === "sim" ? "In the simulator, use Hire Veyra on the Business page." : "Hire the Veyra listing on market.near.ai; the market escrows the budget."}</p>
            </div>
          </div>
        </Card>
      </div>

      <Estimate />
      <details className="disclosure"><summary>Raw credential</summary><Json value={kya.data} /></details>
    </div>
  );
}

function Estimate() {
  const { run, busy } = useAction();
  const [job, setJob] = useState({ title: "Competitor scan", brief: "Research competitors to NEAR Intents agent wallets and write a short report with a pricing table.", budget: "4" });
  const [est, setEst] = useState<any>(null);
  const budgetErr = job.budget && !(Number(job.budget) > 0) ? "Enter an amount above 0." : null;
  return (
    <Card title="Estimate a job" note="Plans the job, asks each candidate agent for a live x402 quote, and runs GUARD on every quote. Nothing is signed or paid.">
      <div id="estimate" className="stack">
        <div className="form-grid">
          <Field label="Title" value={job.title} onChange={(v) => setJob({ ...job, title: v })} />
          <Field label="Budget (USDC)" value={job.budget} onChange={(v) => setJob({ ...job, budget: v })} inputMode="decimal" error={budgetErr} />
        </div>
        <Field label="Brief" value={job.brief} onChange={(v) => setJob({ ...job, brief: v })} textarea rows={3} />
        <div className="btn-row"><Button variant="primary" loading={busy === "est"} disabled={Boolean(budgetErr) || !job.budget || job.brief.trim().length < 10} onClick={() => run("est", async () => setEst(await post("/estimate", { title: job.title, brief: job.brief, budgetUsd: Number(job.budget) })))}>Get estimate</Button></div>
        {est && (
          <>
            <div className="stats">
              <Stat label="Budget" value={money(est.budgetUsd)} />
              <Stat label="Subcontract envelope" value={money(est.envelopeUsd)} />
              <Stat label="Estimated cost" value={money(est.estimatedCostUsd)} />
              <Stat label="Estimated margin" value={money(est.estimatedMarginUsd)} tone="accent" />
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Subtask</th><th className="num">Cap</th><th>Chosen</th><th>Candidates</th></tr></thead>
                <tbody>
                  {est.lines.map((l: any) => <tr key={l.subtask}><td>{l.subtask}</td><td className="num mono">{money(l.capUsd)}</td><td>{l.chosen ? <><span className="mono">{l.chosen.handle}</span> <span className="small muted">{money(l.chosen.priceUsd)}</span></> : <Pill tone="warn">none within the cap</Pill>}</td><td className="small">{l.candidates.map((x: any) => `${x.handle} ${x.quotedUsd === null ? "offline" : money(x.quotedUsd)} → ${x.decision}`).join(" · ")}</td></tr>)}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
