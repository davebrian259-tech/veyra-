import { useState } from "react";
import { Link, useParams } from "react-router";
import { api, post } from "../api";
import { invalidate, usd, useApi, when } from "../lib/data";
import { Button, Card, Empty, ErrorNote, Json, Pill, Skeleton, Stat, statusTone, useAction, useConfirm } from "../ui";

/** One market agent: a fresh integrity check, its history, Veyra's record of it, and an anchored proof. */
export default function AgentPage() {
  const { handle = "" } = useParams();
  const look = useApi<any>(`/watchtower/agents/${encodeURIComponent(handle)}`);
  const [proof, setProof] = useState<any>(undefined);
  const [evidence, setEvidence] = useState<any>(undefined);
  const { run, busy } = useAction();
  const confirm = useConfirm();

  if (look.error) return <ErrorNote message={look.error.includes("not found") ? `No agent called "${handle}" is listed on this market. Check the handle and try again.` : look.error} retry={look.reload} />;
  if (!look.data) return <Skeleton lines={8} height={22} />;
  const d = look.data;
  const f = d.fresh;
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1 className="mono">{handle}</h1>
          <div className="btn-row" style={{ marginTop: "var(--s-2)" }}>
            <Pill tone={statusTone(f.verdict)}>{f.verdict}</Pill>
            <Pill tone={d.safeToPay ? "good" : "bad"}>{d.safeToPay ? "Veyra would pay this agent" : "Veyra will not pay this agent"}</Pill>
            {d.counterparty.blocked ? <Pill tone="bad">blocked</Pill> : null}
            {f.category && <Pill>{f.category}</Pill>}
          </div>
        </div>
        <div className="btn-row">
          <Button loading={busy === "recheck"} onClick={() => run("recheck", async () => { invalidate(`/watchtower/agents/${encodeURIComponent(handle)}`); await look.reload(); }, { success: "Checked again." })}>Check again</Button>
          <Button variant={d.counterparty.blocked ? "default" : "danger"} loading={busy === "block"} onClick={async () => {
            if (!d.counterparty.blocked && !(await confirm({ title: `Block ${handle}?`, body: <p>Veyra will refuse every quote from this agent until you unblock it.</p>, confirmLabel: "Block agent", danger: true }))) return;
            await run("block", async () => { await post(`/guard/counterparties/${encodeURIComponent(handle)}/block`, { blocked: !d.counterparty.blocked }); invalidate("/"); await look.reload(); });
          }}>{d.counterparty.blocked ? "Unblock" : "Block"}</Button>
        </div>
      </div>

      <div className="stats">
        <Stat label="Quoted now" value={f.quotedAtomic === null ? "offline" : usd(f.quotedAtomic, Number(f.quotedAtomic) < 10_000 ? 6 : 2)} />
        <Stat label="Listed price" value={f.listedAtomic === null ? "none" : usd(f.listedAtomic, Number(f.listedAtomic) < 10_000 ? 6 : 2)} />
        <Stat label="Delivered jobs" value={f.deliveredJobs ?? 0} />
        <Stat label="Trust" value={f.trust ?? "—"} tone={f.trust !== null && f.trust < 25 ? "danger" : undefined} />
      </div>

      <Card title="Fresh check" note="Compared just now: the live 402 against the published plan and the market's own treasury.">
        {f.findings.length ? <ul className="stack" style={{ margin: 0, paddingLeft: "1.2em" }}>{f.findings.map((x: any, i: number) => <li key={i} className={x.severity === "flag" ? "small" : "small muted"} style={x.severity === "flag" ? { color: "var(--bad)" } : undefined}><strong>{x.check}</strong>: {x.message}</li>)}</ul> : <p className="small muted">No findings. The quote matches the listing and pays the market treasury.</p>}
        {f.payTo && <dl className="kv" style={{ marginTop: "var(--s-3)" }}><dt>Pays to</dt><dd className="mono">{f.payTo}</dd><dt>Network</dt><dd className="mono">{f.network}</dd></dl>}
      </Card>

      <div className="grid-2">
        <Card title="Veyra's own record" note="What happened when Veyra actually dealt with this agent.">
          <dl className="kv">
            <dt>Hires</dt><dd>{d.counterparty.hires}</dd>
            <dt>Passed</dt><dd>{d.counterparty.passes}</dd>
            <dt>Failed</dt><dd>{d.counterparty.failures}</dd>
            <dt>Attacks</dt><dd>{d.counterparty.attacks}</dd>
            {d.counterparty.note && <><dt>Note</dt><dd>{d.counterparty.note}</dd></>}
          </dl>
        </Card>
        <Card title="Prove a verdict" note="The agent's latest verdict as a leaf in the scan's Merkle tree, with the root anchored on NEAR." actions={<Button size="sm" loading={busy === "proof"} onClick={() => run("proof", async () => setProof(await api(`/watchtower/agents/${encodeURIComponent(handle)}/proof`)))}>Get proof</Button>}>
          {proof === undefined ? <p className="small muted">Available once the agent has appeared in a completed scan.</p> : (
            <div className="stack">
              <div className={`alert ${proof.valid ? "good" : "bad"}`}>Inclusion proof {proof.valid ? "valid" : "invalid"} against root {proof.root?.slice(0, 16)}… from the scan of {when(proof.scannedAt)}.{proof.receipt?.anchor?.tx_hash ? ` Anchored in ${proof.receipt.anchor.tx_hash}.` : " Waiting for the next anchor."}</div>
              <Json value={{ rowHash: proof.rowHash, index: proof.index, path: proof.path, root: proof.root }} />
            </div>
          )}
        </Card>
      </div>

      <Card title="History" note="Every scan this agent appeared in.">
        {d.history.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>When</th><th>Verdict</th><th className="num">Quoted</th><th className="num">Listed</th><th>Report</th><th /></tr></thead>
              <tbody>{d.history.map((h: any, i: number) => (
                <tr key={i}><td className="small">{when(h.created_at)}</td><td><Pill tone={statusTone(h.verdict)}>{h.verdict}</Pill></td><td className="num mono">{usd(h.quoted_atomic)}</td><td className="num mono">{usd(h.listed_atomic)}</td><td className="mono small">{h.report_ref ?? ""}</td><td>{h.evidence_hash && <Button size="sm" onClick={() => run("evidence", async () => setEvidence(await api(`/watchtower/evidence/${h.evidence_hash}`)))}>Evidence</Button>}</td></tr>
              ))}</tbody>
            </table>
          </div>
        ) : <Empty title="Not scanned yet">This agent has not appeared in a completed scan on this server.</Empty>}
        {evidence !== undefined && <div style={{ marginTop: "var(--s-3)" }}><Json value={evidence} /></div>}
      </Card>
      <p className="small muted"><Link to="/app/watchtower">All results</Link> · <Link to="/app/market">Market</Link></p>
    </div>
  );
}
