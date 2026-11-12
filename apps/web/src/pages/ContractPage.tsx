import { useState } from "react";
import { Link, useParams } from "react-router";
import { api, post } from "../api";
import { invalidate, money, usd, useApi } from "../lib/data";
import { Button, Card, Empty, ErrorNote, Json, Pill, Skeleton, Stat, statusTone, useAction } from "../ui";

const tone = (kind: string) => (/attack|block|no_show|failed|abandoned|settlement_failed/.test(kind) ? "bad" : /done|verified|delivered|settled/.test(kind) ? "good" : /pay|award|negotiate|funding|warn|cheque/.test(kind) ? "warn" : "");

/** One contract: live timeline, subtasks, quotes, payments, receipts, and the deliverable. */
export default function ContractPage() {
  const { id = "" } = useParams();
  const c = useApi<any>(`/contracts/${id}`, { every: 1500 });
  const receipts = useApi<{ receipts: any[] }>(`/receipts?contract=${id}`, { every: 4000 });
  const [proof, setProof] = useState<any>(undefined);
  const { run, busy } = useAction();

  if (c.error) return <ErrorNote message={c.error.includes("not found") ? "This contract does not exist, or belongs to another owner." : c.error} retry={c.reload} />;
  if (!c.data) return <Skeleton lines={8} height={22} />;
  const k = c.data;
  const m = k.money;
  const isX402 = k.buyer.startsWith("x402:");
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>{k.title}</h1>
          <div className="btn-row" style={{ marginTop: "var(--s-2)" }}>
            <Pill tone={statusTone(k.status)}>{k.status}{k.status === "active" ? ` · ${k.step}` : ""}</Pill>
            <Pill>buyer {k.buyer}</Pill>
            <Pill>{k.source === "market" ? "hired on the Agent Market" : isX402 ? "hired over A2A with an x402 cheque" : "direct"}</Pill>
            {k.planSource && <Pill>plan: {k.planSource.kind === "ai" ? `${k.planSource.provider}${k.planSource.verified ? " (TEE-verified)" : ""}` : "deterministic"}</Pill>}
          </div>
        </div>
        {k.status === "active" && <Button loading={busy !== null} onClick={() => run("Advancing", () => post(`/contracts/${id}/advance`))}>Advance now</Button>}
      </div>

      <div className="stats">
        <Stat label="Budget" value={money(m.budgetUsd)} />
        <Stat label="Subcontract envelope" value={money(m.envelopeUsd)} />
        <Stat label="Spent" value={money(m.costUsd)} />
        <Stat label="Margin" value={m.marginUsd === null ? "—" : money(m.marginUsd)} tone="accent" />
      </div>

      {k.status === "failed" && <div className="alert bad" role="alert">This job failed: {k.error}. {isX402 ? "The buyer's cheque was never executed." : "Nothing further will be paid."}</div>}

      <Card title="Timeline" note="Every step as it happened. Red lines are attacks or failures GUARD handled.">
        <ol className="timeline" aria-live="polite">
          {k.events.map((e: any) => <li key={e.id} className={tone(e.kind)}><span className="kind">{e.kind}</span><span>{e.message}</span></li>)}
        </ol>
      </Card>

      <Card title="Subtasks" note="How the brief was split, who was hired for each part, and what GUARD decided on every quote.">
        {k.subtasks.length === 0 && <Empty title="Not planned yet">The plan appears here a moment after intake.</Empty>}
        <div className="stack">
          {k.subtasks.map((s: any) => (
            <details key={s.id} className="disclosure">
              <summary>
                <Pill tone={statusTone(s.status)}>{s.status}</Pill> {s.title}
                <span className="small muted"> · cap {usd(s.cap_atomic)} · {s.agent_handle ? `${s.agent_handle} at ${usd(s.price_atomic)}` : "unassigned"} · {s.mode}</span>
              </summary>
              <h3 className="small" style={{ margin: "var(--s-3) 0 var(--s-2)", fontSize: "var(--fs-sm)" }}>Quotes and decisions</h3>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Agent</th><th className="num">Quoted</th><th className="num">Listed</th><th className="num">Trust</th><th>Decision</th><th>Why</th></tr></thead>
                  <tbody>
                    {s.quotes.map((q: any) => (
                      <tr key={q.id} className={q.decision.startsWith("blocked") ? "bad" : q.decision === "accepted" ? "good" : ""}>
                        <td><Link to={`/app/watchtower/${encodeURIComponent(q.agent_handle)}`} className="mono">{q.agent_handle}</Link></td><td className="num mono">{usd(q.amount_atomic)}</td><td className="num mono">{usd(q.plan_atomic)}</td><td className="num">{q.score ?? "—"}</td><td>{q.decision}</td><td className="small">{q.reason}</td>
                      </tr>
                    ))}
                    {!s.quotes.length && <tr><td colSpan={6} className="muted small">No quotes yet.</td></tr>}
                  </tbody>
                </table>
              </div>
              {s.verification && <><h3 className="small" style={{ margin: "var(--s-3) 0 var(--s-2)", fontSize: "var(--fs-sm)" }}>Verification</h3><Json value={{ pass: s.verification.pass, score: s.verification.score, reasons: s.verification.reasons, checks: s.verification.checks, judge: s.verification.judge }} /></>}
              <h3 className="small" style={{ margin: "var(--s-3) 0 var(--s-2)", fontSize: "var(--fs-sm)" }}>Brief sent to the agent</h3>
              <pre className="json">{s.spec}</pre>
            </details>
          ))}
        </div>
      </Card>

      <Card title="Payments" note="x402 cheques settle only when the agent delivers. A no-show's cheque is never settled.">
        {k.payments.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Agent</th><th>Rail</th><th className="num">Amount</th><th>Payee</th><th>Status</th><th>Cheque</th></tr></thead>
              <tbody>
                {k.payments.map((p: any) => <tr key={p.id}><td className="mono">{p.agent_handle}</td><td>{p.rail}</td><td className="num mono">{usd(p.amount_atomic)}</td><td className="mono small">{p.payee}</td><td><Pill tone={statusTone(p.status)}>{p.status}</Pill>{p.error ? <span className="small muted"> {p.error}</span> : ""}</td><td className="mono small">{p.cheque_hash?.slice(0, 16) ?? "—"}</td></tr>)}
              </tbody>
            </table>
          </div>
        ) : <Empty title="No payments yet">Payments appear once a quote passes GUARD.</Empty>}
      </Card>

      <Card title="Receipts" note="Signed by Veyra and anchored as a Merkle root on NEAR. Verify any one of them here.">
        {receipts.data?.receipts.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Receipt</th><th>Kind</th><th>Anchor</th><th /></tr></thead>
              <tbody>
                {receipts.data.receipts.map((r: any) => (
                  <tr key={r.id}><td className="mono small">{r.id}</td><td>{r.kind}</td><td><Pill tone={r.anchor_id ? "good" : "warn"}>{r.anchor_id ? "anchored" : "waiting for anchor"}</Pill></td><td><Button size="sm" onClick={() => run("Verifying", async () => setProof(await api(`/receipts/${r.id}/proof`)))}>Verify</Button></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty title="No receipts yet">A receipt is issued for every payment and for the delivery.</Empty>}
        {proof !== undefined && (
          <div className="stack" style={{ marginTop: "var(--s-3)" }}>
            <div className={`alert ${proof.checks.hashMatchesBody && proof.checks.signatureValid && proof.proof?.valid !== false ? "good" : "bad"}`}>
              Hash {proof.checks.hashMatchesBody ? "matches" : "does not match"} · signature {proof.checks.signatureValid ? "valid" : "invalid"} · Merkle proof {proof.proof ? (proof.proof.valid ? "valid" : "invalid") : "not anchored yet"}{proof.anchor?.tx_hash ? ` · anchored in ${proof.anchor.tx_hash}` : ""}
            </div>
            <Json value={{ receipt: proof.receipt, anchor: proof.anchor }} />
          </div>
        )}
      </Card>

      {k.deliverable_md && <Card title="Deliverable" note="What the buyer received, assembled from the verified parts."><pre className="deliverable">{k.deliverable_md}</pre></Card>}
      <p className="small muted">Changed something elsewhere? <button className="btn ghost sm" onClick={() => { invalidate(`/contracts/${id}`); void c.reload(); }}>Refresh now</button></p>
    </div>
  );
}
