import { useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "../brand";
import { useApi, when } from "../lib/data";
import { Button, CopyButton, ErrorNote, Json, Skeleton, useAction } from "../ui";
import { NearMark, RogueAvatar, TONES, VaultEmblem } from "./art";
import { HeistCam } from "./HeistCam";
import { replay, type Lobby, type Run } from "./heist-api";

/** A shared run: the duel, its proof, and a button to re-run it and check the referee. */
export default function RunPage() {
  const { id = "" } = useParams();
  const run = useApi<Run>(`/heist/runs/${id}`);
  const lobby = useApi<Lobby>("/heist");
  const [check, setCheck] = useState<{ matches: boolean; replayed: string } | null>(null);
  const { run: act, busy } = useAction();
  if (run.error) return <ErrorNote message={run.error.includes("not found") ? "This heist does not exist on this server." : run.error} retry={run.reload} />;
  if (!run.data) return <Skeleton lines={8} height={28} />;
  const r = run.data;
  const v = lobby.data?.vaults.find((x) => x.id === r.vault);
  const t = TONES[v?.tone ?? "violet"];
  return (
    <div className="arena-grid" style={{ ["--glow" as string]: t.glow, ["--tone-a" as string]: t.a }}>
      <section className="panel stage">
        <div className="btn-row" style={{ position: "relative", justifyContent: "space-between", marginBottom: "var(--s-4)" }}>
          <Link className="btn ghost sm" to="/play"><Icon icon={ArrowLeft01Icon} size={16} /> Vaults</Link>
          <Link className="btn sm" to={`/play/vault/${r.vault}`}>Try vault {r.vault} yourself</Link>
        </div>
        <div className="faceoff">
          <div className="fighter"><VaultEmblem id={r.vault} tone={v?.tone ?? "violet"} shields={v?.shields.length ?? 5} size={130} cracked={r.cracked} /><b>{v?.name ?? `Vault ${r.vault}`}</b></div>
          <span className="vs" aria-hidden="true">VS</span>
          <div className="fighter"><RogueAvatar seed={r.spec.agentName} size={130} /><b>{r.spec.agentName}</b><small>{r.account ?? r.callsign}</small></div>
        </div>
        <div style={{ position: "relative", marginTop: "var(--s-5)" }}><HeistCam run={r} /></div>
      </section>
      <section className="panel">
        <div className="panel-head"><h2>Proof</h2><span className="link">{when(r.createdAt)}</span></div>
        <dl className="kv">
          <dt>Kind</dt><dd>{r.kind === "ranked" ? "Ranked, settled on NEAR" : "Practice"}</dd>
          <dt>Engine</dt><dd className="mono">{r.engine}</dd>
          <dt>Spec hash</dt><dd className="mono small">{r.specHash}</dd>
          <dt>Outcome hash</dt><dd className="mono small">{r.outcomeHash}</dd>
          {r.entryId && <><dt>Entry</dt><dd className="mono">#{r.entryId}</dd></>}
          {r.links.enter && <><dt>Entry tx</dt><dd><a href={r.links.enter} target="_blank" rel="noreferrer" className="mono small">{r.enterTx?.slice(0, 16)}…</a></dd></>}
          {r.links.resolve && <><dt>Settlement</dt><dd><a href={r.links.resolve} target="_blank" rel="noreferrer" className="mono small"><NearMark size={11} /> {r.resolveTx?.slice(0, 16)}…</a></dd></>}
          {r.receiptId && <><dt>Receipt</dt><dd className="mono small">{r.receiptId}</dd></>}
        </dl>
        <div className="btn-row" style={{ marginTop: "var(--s-4)" }}>
          <Button variant="primary" loading={busy === "replay"} onClick={() => act("replay", async () => setCheck(await replay(r.id)))}>Re-run and check the referee</Button>
          <CopyButton text={`pnpm --filter @veyra/server heist:replay ${r.id} ${window.location.origin}/api`} label="Copy replay command" />
        </div>
        {check && <div className={`alert ${check.matches ? "good" : "bad"}`} style={{ marginTop: "var(--s-3)" }}>{check.matches ? "Same outcome hash. The referee reported this heist honestly." : `Mismatch: replay gave ${check.replayed.slice(0, 12)}…`}</div>}
        <details className="disclosure" style={{ marginTop: "var(--s-4)" }}><summary>The rogue agent</summary><Json value={r.spec} /></details>
      </section>
    </div>
  );
}
