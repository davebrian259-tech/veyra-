import { useEffect, useState } from "react";
import { api, post } from "../api";
import { Json, Section } from "../ui";

const usd = (atomic: string | null | undefined) => (atomic ? (Number(atomic) / 1e6).toFixed(2) : "—");
const tone = (kind: string) => (/attack|block|no_show|failed|abandoned/.test(kind) ? "bad" : /done|verified|delivered/.test(kind) ? "good" : /pay|award|negotiate|funding|warn/.test(kind) ? "warn" : "");

/** One contract: live timeline, subtasks, quotes, payments, receipts and the deliverable. */
export function ContractPage({ id, back }: { id: string; back: () => void }) {
  const [c, setC] = useState<any>(null);
  const [receipts, setReceipts] = useState<any[]>([]);
  const [proof, setProof] = useState<any>(undefined);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      const x = await api(`/contracts/${id}`);
      if (stop) return;
      setC(x);
      setReceipts((await api(`/receipts?contract=${id}`)).receipts);
    };
    void load();
    const t = setInterval(() => void load(), 1500);
    return () => { stop = true; clearInterval(t); };
  }, [id]);

  if (!c) return <p className="note">Loading…</p>;
  const m = c.money;
  return (
    <>
      <button onClick={back}>← All contracts</button>
      <h2 className="title">{c.title}</h2>
      <div className="row">
        <span className={`pill ${c.status === "delivered" ? "good" : c.status === "failed" ? "bad" : ""}`}>{c.status}{c.status === "active" ? ` · ${c.step}` : ""}</span>
        <span className="pill">buyer {c.buyer}</span>
        <span className="pill">{c.source === "market" ? "hired on the Agent Market" : "direct"}</span>
        {c.planSource && <span className="pill">plan: {c.planSource.kind === "ai" ? `${c.planSource.provider}${c.planSource.verified ? " (TEE-verified)" : ""}` : "deterministic"}</span>}
        {c.status === "active" && <button onClick={() => void post(`/contracts/${id}/advance`)}>Advance now</button>}
      </div>
      <div className="stats">
        <div className="stat"><div className="stat-label">Budget</div><div className="stat-value">{m.budgetUsd.toFixed(2)}</div></div>
        <div className="stat"><div className="stat-label">Subcontract envelope</div><div className="stat-value">{m.envelopeUsd.toFixed(2)}</div></div>
        <div className="stat"><div className="stat-label">Spent</div><div className="stat-value">{m.costUsd.toFixed(2)}</div></div>
        <div className="stat accent"><div className="stat-label">Margin</div><div className="stat-value">{m.marginUsd === null ? "—" : m.marginUsd.toFixed(2)}</div></div>
      </div>

      <Section title="Timeline">
        <ol className="timeline">
          {c.events.map((e: any) => (
            <li key={e.id} className={tone(e.kind)}>
              <span className="mono kind">{e.kind}</span> {e.message}
            </li>
          ))}
        </ol>
      </Section>

      <Section title="Subtasks">
        {c.subtasks.map((s: any) => (
          <details key={s.id} className="subtask">
            <summary>
              <span className={`pill ${s.status === "passed" ? "good" : s.status === "abandoned" ? "bad" : ""}`}>{s.status}</span> {s.title}
              <span className="note"> · cap {usd(s.cap_atomic)} · {s.agent_handle ? `${s.agent_handle} at ${usd(s.price_atomic)}` : "unassigned"} · rail {s.mode}</span>
            </summary>
            <h4>Quotes &amp; decisions</h4>
            <table>
              <thead><tr><th>Agent</th><th>Quoted</th><th>Listed</th><th>Trust</th><th>Decision</th><th>Why</th></tr></thead>
              <tbody>
                {s.quotes.map((q: any) => (
                  <tr key={q.id} className={q.decision.startsWith("blocked") ? "bad" : q.decision === "accepted" ? "good" : ""}>
                    <td className="mono">{q.agent_handle}</td><td>{usd(q.amount_atomic)}</td><td>{usd(q.plan_atomic)}</td><td>{q.score ?? "—"}</td><td>{q.decision}</td><td>{q.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {s.verification && <><h4>Verification</h4><Json value={{ pass: s.verification.pass, score: s.verification.score, reasons: s.verification.reasons, checks: s.verification.checks, judge: s.verification.judge }} /></>}
            <h4>Brief sent to the agent</h4>
            <pre className="json">{s.spec}</pre>
          </details>
        ))}
      </Section>

      <Section title="Payments" note="x402 cheques settle only when the agent delivers; a no-show's cheque is never settled.">
        <table>
          <thead><tr><th>Agent</th><th>Rail</th><th>Amount</th><th>Payee</th><th>Status</th><th>Cheque</th></tr></thead>
          <tbody>
            {c.payments.map((p: any) => (
              <tr key={p.id}><td className="mono">{p.agent_handle}</td><td>{p.rail}</td><td>{usd(p.amount_atomic)}</td><td className="mono">{p.payee}</td><td>{p.status}{p.error ? ` (${p.error})` : ""}</td><td className="mono">{p.cheque_hash?.slice(0, 16) ?? "—"}</td></tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Receipts" note="Signed by Veyra and anchored as a Merkle root on NEAR. Verify any one of them.">
        <table>
          <tbody>
            {receipts.map((r: any) => (
              <tr key={r.id}><td className="mono">{r.id}</td><td>{r.kind}</td><td>{r.anchor_id ? "anchored" : "pending"}</td><td><button onClick={async () => setProof(await api(`/receipts/${r.id}/proof`))}>Verify</button></td></tr>
            ))}
          </tbody>
        </table>
        {proof !== undefined && <Json value={{ checks: proof.checks, merkleProofValid: proof.proof?.valid ?? null, anchor: proof.anchor, receipt: proof.receipt }} />}
      </Section>

      {c.deliverable_md && <Section title="Deliverable"><pre className="deliverable">{c.deliverable_md}</pre></Section>}
    </>
  );
}
