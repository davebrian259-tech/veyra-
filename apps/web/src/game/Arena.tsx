import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useOutletContext, useParams } from "react-router";
import { motion } from "motion/react";
import { ArrowLeft01Icon, LockKeyIcon, PlayIcon } from "@hugeicons/core-free-icons";
import { Icon } from "../brand";
import type { useApi } from "../lib/data";
import { invalidate } from "../lib/data";
import { Button, ErrorNote, Field, Skeleton, useAction } from "../ui";
import { RogueAvatar, ShieldToken, TONES, VaultEmblem } from "./art";
import { HeistCam } from "./HeistCam";
import { ALL_SHIELDS, enterRanked, loadProgress, MOVE_UNLOCK, near, pendingFromRedirect, practice, recordRun, saveProgress, submitRanked, type Lobby, type Run, type ShieldId, type Spec } from "./heist-api";

type LobbyCtx = ReturnType<typeof useApi<Lobby>>;

/** One vault: build your rogue agent on the left, watch the duel on the right. */
export default function Arena() {
  const { id = "1" } = useParams();
  const lobby = useOutletContext<LobbyCtx>();
  const navigate = useNavigate();
  const [progress, setProgress] = useState(loadProgress);
  const [spec, setSpec] = useState<Spec>(() => ({ callsign: progress.callsign, agentName: "Straight Arrow", quoteUsd: 0.4, payTo: "treasury", deliverable: "## Findings\nThree competitors, their pricing, and a recommendation.\n\n## Sources\nPublic pricing pages.", ...(progress.lastSpec ?? {}) }));
  const [move, setMove] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [flash, setFlash] = useState<ShieldId | null>(null);
  const { run: act, busy } = useAction();

  const vault = lobby.data?.vaults.find((v) => v.id === Number(id));
  const ranked = lobby.data?.ranked;

  // Coming back from a redirect wallet with ?transactionHashes=…: finish the ranked entry.
  useEffect(() => {
    const p = pendingFromRedirect();
    if (!p) return;
    window.history.replaceState(null, "", window.location.pathname);
    void act("ranked", async () => { const r = await submitRanked(p.txHash, p.accountId, p.spec); show(r); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { setRun(null); setFlash(null); }, [id]);

  const errors = useMemo(() => ({
    callsign: spec.callsign.trim().length < 2 ? "At least 2 characters." : null,
    agentName: spec.agentName.trim().length < 2 ? "At least 2 characters." : null,
    deliverable: spec.deliverable.length > 4000 ? "At most 4,000 characters." : null,
  }), [spec]);
  const invalid = Object.values(errors).some(Boolean);

  if (lobby.error) return <ErrorNote message={lobby.error} retry={lobby.reload} />;
  if (!lobby.data) return <Skeleton lines={8} height={28} />;
  if (!vault) return <ErrorNote message={`There is no vault ${id}. Pick one from the lobby.`} />;
  const t = TONES[vault.tone];
  const on = new Set(vault.shields.map((s) => s.id));

  function show(r: Run) {
    setRun(r);
    setProgress(recordRun({ ...progress, lastSpec: spec }, r));
    invalidate("/heist");
    void lobby.reload();
  }
  const go = () => act("practice", async () => { saveProgress({ ...progress, callsign: spec.callsign.trim(), lastSpec: spec }); show(await practice(vault.id, spec)); });
  const goRanked = () => act("ranked", async () => { if (!ranked?.contractId) return; show(await enterRanked(ranked.network, ranked.contractId, vault, spec)); });

  return (
    <div className="stack-lg" style={{ ["--glow" as string]: t.glow, ["--tone-a" as string]: t.a }}>
      <div className="btn-row" style={{ justifyContent: "space-between" }}>
        <Link className="btn ghost sm" to="/play"><Icon icon={ArrowLeft01Icon} size={16} /> All vaults</Link>
        <div className="btn-row">
          {[1, 2, 3, 4, 5].map((n) => <button key={n} className={`btn sm ${n === vault.id ? "primary" : ""}`} onClick={() => navigate(`/play/vault/${n}`)} aria-label={`Vault ${n}`} aria-current={n === vault.id ? "page" : undefined}>{n}</button>)}
        </div>
      </div>

      <div className="arena-grid">
        {/* the stage */}
        <section className="panel stage" aria-labelledby="vault-title">
          <div className="faceoff">
            <div className="fighter">
              <motion.div animate={flash ? { scale: [1, 1.06, 1] } : {}} transition={{ duration: 0.4 }}><VaultEmblem id={vault.id} tone={vault.tone} shields={vault.shields.length} size={150} cracked={run?.cracked} /></motion.div>
              <b id="vault-title">{vault.name}</b>
              <small>{ranked?.enabled && vault.chain ? `${near(vault.chain.potYocto)} NEAR pot` : `Vault ${vault.id}`}</small>
            </div>
            <span className="vs" aria-hidden="true">VS</span>
            <div className="fighter">
              <motion.div animate={run?.cracked ? { y: [0, -8, 0] } : {}} transition={{ duration: 0.5, repeat: run?.cracked ? 2 : 0 }}><RogueAvatar seed={spec.agentName} size={150} /></motion.div>
              <b>{spec.agentName || "Your agent"}</b>
              <small>{spec.callsign}</small>
            </div>
          </div>
          <p className="small muted" style={{ position: "relative", textAlign: "center", marginTop: "var(--s-4)" }}>{vault.tagline}</p>
          <div className="shield-row" role="list" aria-label="Shields">
            {ALL_SHIELDS.map((s) => <span role="listitem" key={s.id}><ShieldToken id={s.id} on={on.has(s.id)} label={s.short} hit={flash === s.id} /></span>)}
          </div>
          <div className="stage-actions">
            <Button variant="primary" className="big" loading={busy === "practice"} disabled={invalid || busy !== null} onClick={go}><Icon icon={PlayIcon} size={18} /> Run the heist</Button>
            {ranked?.enabled && <Button className="big gold" loading={busy === "ranked"} disabled={invalid || busy !== null} onClick={goRanked}>Ranked · {vault.feeNear} NEAR</Button>}
          </div>
          <p className="small muted" style={{ position: "relative", marginTop: "var(--s-3)" }}>
            Practice is free and uses play money. {ranked?.enabled ? "Ranked charges the entry fee in testnet NEAR from your wallet; a crack pays you the whole pot." : "Ranked play is off on this server."}
          </p>
          {run && <div style={{ position: "relative", marginTop: "var(--s-5)" }}><HeistCam run={run} onBeat={(s) => { if (s?.shield) { setFlash(s.shield); setTimeout(() => setFlash(null), 1200); } }} /></div>}
        </section>

        {/* the workshop */}
        <section className="panel" aria-labelledby="workshop-title">
          <div className="panel-head"><h2 id="workshop-title">Build your rogue agent</h2><span className="link">Hint: {vault.hint}</span></div>
          <p className="field-label" style={{ marginBottom: "var(--s-2)" }}>Moves</p>
          <div className="moves">
            {lobby.data.templates.map((m) => {
              const need = MOVE_UNLOCK[m.id] ?? 0;
              const locked = need > 0 && !progress.cracked.includes(need);
              return (
                <button key={m.id} type="button" className="move" aria-pressed={move === m.id} disabled={locked} onClick={() => { setMove(m.id); setSpec({ ...m.spec, callsign: spec.callsign }); }}>
                  <b>{locked && <Icon icon={LockKeyIcon} size={12} />} {m.name}</b>
                  <span>{locked ? `Crack vault ${need} to unlock` : m.move}</span>
                </button>
              );
            })}
          </div>
          <div className="stack">
            <div className="form-grid">
              <Field label="Your callsign" value={spec.callsign} onChange={(v) => setSpec({ ...spec, callsign: v })} error={errors.callsign} hint="Shown on the leaderboard." />
              <Field label="Agent name" value={spec.agentName} onChange={(v) => setSpec({ ...spec, agentName: v })} error={errors.agentName} />
            </div>
            <div className="field">
              <label htmlFor="quote">Your 402 quote (listed at 0.40 USDC)</label>
              <div className="range-row">
                <input id="quote" type="range" min={0.01} max={5} step={0.01} value={spec.quoteUsd} onChange={(e) => setSpec({ ...spec, quoteUsd: Number(e.target.value) })} />
                <output htmlFor="quote">{spec.quoteUsd.toFixed(2)} USDC</output>
              </div>
            </div>
            <div className="field">
              <span className="field-label" id="payee-label">Pay to</span>
              <div className="payee-toggle" role="group" aria-labelledby="payee-label">
                <button type="button" aria-pressed={spec.payTo === "treasury"} onClick={() => setSpec({ ...spec, payTo: "treasury" })}>Market treasury</button>
                <button type="button" aria-pressed={spec.payTo === "me"} onClick={() => setSpec({ ...spec, payTo: "me" })}>Your wallet (you.sim)</button>
              </div>
            </div>
            <Field label="What you deliver" value={spec.deliverable} onChange={(v) => setSpec({ ...spec, deliverable: v })} textarea rows={7} error={errors.deliverable} hint="Veyra's model reads this. Leave it empty to never deliver." />
          </div>
        </section>
      </div>
    </div>
  );
}
