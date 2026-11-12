import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { api } from "../api";
import { useApi, when } from "../lib/data";
import { Button, Card, CopyButton, Empty, ErrorNote, Field, Json, Pill, Skeleton, Stat, statusTone, useAction } from "../ui";

/** What is on NEAR and how to check it yourself: the ledger contract, anchors, reports, scan roots, and any receipt. */
export default function EvidencePage() {
  const ev = useApi<any>("/evidence", { every: 20_000 });
  const [receiptId, setReceiptId] = useState("");
  const [proof, setProof] = useState<any>(undefined);
  const { run, busy } = useAction();
  const location = useLocation();
  useEffect(() => { if (location.hash === "#verify") document.getElementById("verify")?.scrollIntoView({ behavior: "smooth" }); }, [location.hash]);

  if (ev.error) return <ErrorNote message={ev.error} retry={ev.reload} />;
  if (!ev.data) return <Skeleton lines={8} height={22} />;
  const d = ev.data;
  const L = d.ledger;
  const real = L && L.network !== "sim";
  return (
    <div className="stack">
      <Card title="The ledger contract" note={real ? `veyra-ledger on NEAR ${L.network}. Anchors are Merkle roots of signed receipts; reports are evidence-hashed findings about market agents.` : "The simulator keeps an in-memory ledger. Configure LEDGER_CONTRACT_ID to write to NEAR testnet, even from the simulator."}>
        {L ? (
          <div className="stack">
            <dl className="kv">
              <dt>Contract</dt><dd className="mono">{L.contractId}{L.explorer && <> · <a href={L.explorer} target="_blank" rel="noreferrer">open in explorer</a></>}</dd>
              <dt>Network</dt><dd>{L.network}</dd>
              <dt>Receipt issuer</dt><dd className="mono small">{d.receiptIssuer}</dd>
            </dl>
            {L.onChain ? (
              <div className="stats">
                <Stat label="Anchors on-chain" value={L.onChain.anchors} />
                <Stat label="Reports on-chain" value={L.onChain.reports} />
                <Stat label="Latest root" value={<span className="mono small">{L.onChain.latest?.root ? `${L.onChain.latest.root.slice(0, 14)}…` : "—"}</span>} />
              </div>
            ) : real ? <p className="small muted">Could not read the contract right now; the explorer link still works.</p> : null}
          </div>
        ) : <Empty title="No ledger configured">Set LEDGER_CONTRACT_ID on the server to anchor receipts on NEAR.</Empty>}
      </Card>

      <div className="grid-2">
        <Card title="Anchors" note="Each anchor commits a batch of receipts. Any receipt in the batch has a Merkle proof against the root.">
          {d.anchors.length ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Root</th><th>Receipts</th><th>Status</th><th>Transaction</th></tr></thead>
                <tbody>{d.anchors.map((a: any) => <tr key={a.id}><td className="mono small" title={a.root}>{a.root.slice(0, 14)}…</td><td>{a.from_seq}–{a.to_seq}</td><td><Pill tone={statusTone(a.status)}>{a.status}</Pill></td><td className="mono small">{a.link ? <a href={a.link} target="_blank" rel="noreferrer">{a.tx_hash.slice(0, 12)}…</a> : a.tx_hash ?? "—"}</td></tr>)}</tbody>
              </table>
            </div>
          ) : <Empty title="No anchors yet">The first anchor is written after the first delivery or scan.</Empty>}
        </Card>
        <Card title="Threat reports" note="Filed on-chain only for flagged agents, each with the hash of the stored evidence.">
          {d.reports.length ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Agent</th><th>Evidence</th><th>Transaction</th></tr></thead>
                <tbody>{d.reports.map((r: any, i: number) => <tr key={i}><td><Link to={`/app/watchtower/${encodeURIComponent(r.handle)}`} className="mono">{r.handle}</Link></td><td className="mono small" title={r.evidence_hash}>{r.evidence_hash?.slice(0, 12)}…</td><td className="mono small">{r.link ? <a href={r.link} target="_blank" rel="noreferrer">{r.report_ref.slice(0, 12)}…</a> : r.report_ref}</td></tr>)}</tbody>
              </table>
            </div>
          ) : <Empty title="No reports filed">Watchtower files a report only when an agent lies about its price or payee.</Empty>}
        </Card>
      </div>

      <Card title="Scan roots" note="Every Watchtower scan is a Merkle tree over its verdicts. The root goes into a receipt, which the next anchor commits.">
        {d.scans.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>When</th><th>Market</th><th className="num">Agents</th><th className="num">Flagged</th><th>Root</th></tr></thead>
              <tbody>{d.scans.map((s: any) => <tr key={s.id}><td className="small">{when(s.finished_at)}</td><td className="small">{s.origin}</td><td className="num">{s.total}</td><td className="num">{s.flagged}</td><td className="mono small" title={s.root}>{s.root ? `${s.root.slice(0, 14)}…` : "—"}</td></tr>)}</tbody>
            </table>
          </div>
        ) : <Empty title="No scans yet" action={<Link className="btn sm" to="/app/watchtower">Run a scan</Link>} />}
      </Card>

      <Card title="Verify any receipt" note="Paste a receipt id. You get the signed body, the hash check, the signature check, and the Merkle proof against the anchored root.">
        <form id="verify" className="btn-row" onSubmit={(e) => { e.preventDefault(); void run("verify", async () => setProof(await api(`/receipts/${encodeURIComponent(receiptId.trim())}/proof`))); }}>
          <Field label="Receipt id" value={receiptId} onChange={setReceiptId} placeholder="rcp_…" />
          <div style={{ alignSelf: "flex-end" }}><Button type="submit" variant="primary" disabled={!receiptId.trim()} loading={busy === "verify"}>Verify</Button></div>
        </form>
        {proof !== undefined && (
          <div className="stack" style={{ marginTop: "var(--s-3)" }}>
            <div className={`alert ${proof.checks.hashMatchesBody && proof.checks.signatureValid && proof.proof?.valid !== false ? "good" : "bad"}`}>
              Hash {proof.checks.hashMatchesBody ? "matches" : "does not match"} · signature {proof.checks.signatureValid ? "valid" : "invalid"} · Merkle proof {proof.proof ? (proof.proof.valid ? "valid" : "invalid") : "not anchored yet"}
            </div>
            <div className="btn-row"><CopyButton text={JSON.stringify(proof, null, 2)} label="Copy proof" /></div>
            <Json value={proof} />
          </div>
        )}
      </Card>
      <p className="small muted">Public endpoints: <code>/api/evidence</code>, <code>/api/ledger</code>, <code>/api/receipts/:id/proof</code>, <code>/api/watchtower/agents/:handle/proof</code>.</p>
    </div>
  );
}
