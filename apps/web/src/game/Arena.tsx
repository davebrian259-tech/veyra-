import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { motion } from "motion/react";
import { toast } from "sonner";
import { ArrowRight01Icon, LockKeyIcon, PlayIcon } from "@hugeicons/core-free-icons";
import { api } from "../api";
import { Icon } from "../brand";
import { invalidate } from "../lib/data";
import { Button, ErrorNote, Field, Skeleton, useAction } from "../ui";
import { RogueAvatar, TONES, VaultEmblem } from "./art";
import { Explain, Kbd, Tip } from "./explain";
import { celebrate, play } from "./fx";
import { HeistCam } from "./HeistCam";
import { MOVE_UNLOCK, nearNum, practice, recordRun, type Run, type ShieldId, type Spec } from "./heist-api";
import { ShieldExplain } from "./Lobby";
import { rankedPlan } from "./plans";
import { useHeist, useSetParams } from "./session";
import { startTour, tourSeen } from "./tour";
import { useTx } from "./tx";

const DEFAULT_DELIVERABLE = "## Findings\nThree competitors, their pricing, and a recommendation.\n\n## Sources\nPublic pricing pages.";

/**
 * One vault. The stage (vault vs your agent, its shields, the Heist Cam) and the workshop where you
 * build the rogue agent. Deep links: ?move=<id> picks a move, ?load=<run id> loads a build,
 * ?run=<run id> shows a result, ?confirm=ranked opens the ranked sheet.
 */
export default function Arena() {
  const { id = "1" } = useParams();
  const [params] = useSearchParams();
  const h = useHeist();
  const { lobby, progress, setProgress, cracked } = h;
  const navigate = useNavigate();
  const tx = useTx();
  const [spec, setSpec] = useState<Spec>(() => ({ callsign: progress.callsign, agentName: "Straight Arrow", quoteUsd: 0.4, payTo: "treasury", deliverable: DEFAULT_DELIVERABLE, ...(progress.lastSpec ?? {}) }));
  const [run, setRun] = useState<Run | null>(null);
  const [animate, setAnimate] = useState(false);
  const [flash, setFlash] = useState<ShieldId | null>(null);
  const { run: act, busy } = useAction();
  const camRef = useRef<HTMLDivElement>(null);
  const vaultNum = Number(id);
  const vault = lobby.data?.vaults.find((v) => v.id === vaultNum);
  const move = params.get("move");
  const setParams2 = useSetParams();
  const setParam = (k: string, v: string | null) => setParams2({ [k]: v });

  useEffect(() => { document.title = vault ? `Vault ${vault.id} · ${vault.name} · Veyra Heist` : "Veyra Heist"; }, [vault]);

  // ?move=: apply a template once the lobby (and its templates) are here
  useEffect(() => {
    const m = lobby.data?.templates.find((t) => t.id === move);
    if (m) setSpec((s) => ({ ...m.spec, callsign: s.callsign }));
  }, [move, lobby.data]);

  // ?load=: a build from an earlier run (yours, or someone's from the inspector)
  useEffect(() => {
    const l = params.get("load");
    if (!l) return;
    void api<Run>(`/heist/runs/${l}`).then((r) => { setSpec((s) => ({ ...r.spec, callsign: s.callsign })); setParam("load", null); setParam("move", null); toast(`Loaded ${r.spec.agentName} into the workshop.`); }).catch(() => setParam("load", null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get("load")]);

  // ?run=: show a result (survives refresh)
  const runParam = params.get("run");
  useEffect(() => {
    if (!runParam) { setRun(null); return; }
    if (run?.id === runParam) return;
    void api<Run>(`/heist/runs/${runParam}`).then((r) => { if (r.vault === vaultNum) { setAnimate(false); setRun(r); } }).catch(() => setParam("run", null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runParam, vaultNum]);

  useEffect(() => {
    if (!vault || tourSeen("arena") || !tourSeen("lobby")) return;
    // a player who is already clicking or typing knows what to do: never interrupt them
    const cancel = () => clearTimeout(t);
    const t = setTimeout(() => { window.removeEventListener("pointerdown", cancel); window.removeEventListener("keydown", cancel); void startTour("arena"); }, 900);
    window.addEventListener("pointerdown", cancel, { once: true });
    window.addEventListener("keydown", cancel, { once: true });
    return () => { clearTimeout(t); window.removeEventListener("pointerdown", cancel); window.removeEventListener("keydown", cancel); };
  }, [vault]);

  const errors = useMemo(() => ({
    callsign: spec.callsign.trim().length < 2 ? "At least 2 characters." : spec.callsign.trim().length > 32 ? "At most 32 characters." : null,
    agentName: spec.agentName.trim().length < 2 ? "At least 2 characters." : spec.agentName.trim().length > 48 ? "At most 48 characters." : null,
    deliverable: spec.deliverable.length > 4000 ? "At most 4,000 characters." : null,
  }), [spec]);
  const invalid = Object.values(errors).some(Boolean);

  function show(r: Run) {
    const before = new Set(cracked);
    setAnimate(true);
    setRun(r);
    setParam("run", r.id);
    setProgress(recordRun({ ...progress, callsign: spec.callsign.trim(), lastSpec: spec }, r));
    invalidate("/heist");
    void lobby.reload();
    void h.reloadMe();
    setTimeout(() => camRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    if (r.cracked && !before.has(r.vault)) {
      // achievements land after the duel finishes playing
      setTimeout(() => {
        toast.success(r.vault === 5 ? "You cracked production Veyra. That is a real bug bounty: open an issue with your replay link." : `Achievement: vault ${r.vault} cracked`, { duration: 6000 });
        const unlocked = lobby.data?.templates.find((t) => MOVE_UNLOCK[t.id] === r.vault);
        if (unlocked) { play("unlock"); toast(`New move unlocked: ${unlocked.name}`, { description: unlocked.move, action: { label: "Use it", onClick: () => navigate(`/play/vault/${r.vault + 1}?move=${unlocked.id}`) } }); }
      }, r.steps.length * 520 + 400);
    }
  }
  const finished = (r: Run) => {
    if (!vault) return;
    play(r.cracked ? "crack" : "hold");
    if (r.cracked) celebrate(TONES[vault.tone].a);
  };

  const go = () => { if (!invalid && busy === null && vault) void act("practice", async () => show(await practice(vault.id, spec))); };
  const openRanked = () => { if (!invalid && h.rankedEnabled) setParam("confirm", "ranked"); };

  // ?confirm=ranked opens the sheet, so a refresh or a shared link lands in the same place
  const confirmOpen = params.get("confirm") === "ranked";
  useEffect(() => {
    if (!confirmOpen || !vault || !h.rankedEnabled || tx.phase !== "review" || invalid) return;
    tx.open({ ...rankedPlan(h, vault, spec, (r) => { show(r); }), onClose: () => setParam("confirm", null) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmOpen, vault?.id, h.rankedEnabled, h.account]);

  // keyboard: R run, Shift+R ranked, [ and ] previous and next vault
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector("[role=dialog]")) return;
      if (e.key === "r") { e.preventDefault(); go(); }
      else if (e.key === "R") { e.preventDefault(); openRanked(); }
      else if (e.key === "[" && vaultNum > 1) navigate(`/play/vault/${vaultNum - 1}`);
      else if (e.key === "]" && vaultNum < 5) navigate(`/play/vault/${vaultNum + 1}`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (lobby.error && !lobby.data) return <ErrorNote message={lobby.error} retry={lobby.reload} />;
  if (!lobby.data) return <Skeleton lines={8} height={28} />;
  if (!vault) return <ErrorNote message={`There is no vault ${id}. Pick one from 1 to 5.`} />;
  const t = TONES[vault.tone];
  const on = new Set(vault.shields.map((s) => s.id));
  const allShields = [...new Map(lobby.data.vaults.flatMap((v) => v.shields).map((s) => [s.id, s])).values()];
  const ranked = lobby.data.ranked;
  const nextVault = vault.id < 5 ? vault.id + 1 : null;

  return (
    <div className="stack-lg" style={{ ["--glow" as string]: t.glow, ["--tone-a" as string]: t.a }}>
      {tx.sheet}
      <div className="page-head row">
        <div>
          <h1>Vault {vault.id} · {vault.name}</h1>
          <p>{vault.tagline} Build a rogue agent, run it, and read which shield stopped you.</p>
        </div>
        <div className="vault-switch" role="group" aria-label="Switch vault">
          {[1, 2, 3, 4, 5].map((n) => (
            <Tip key={n} label={`Vault ${n}`} keys={[String(n)]}>
              <Link className={`btn sm ${n === vault.id ? "primary" : ""} ${cracked.includes(n) ? "is-cracked" : ""}`} to={`/play/vault/${n}`} aria-label={`Vault ${n}${cracked.includes(n) ? ", cracked" : ""}`} aria-current={n === vault.id ? "page" : undefined}>{n}</Link>
            </Tip>
          ))}
        </div>
      </div>

      <div className="arena-grid">
        <section className="panel stage" aria-labelledby="vault-title">
          <div className="faceoff">
            <div className="fighter">
              <motion.div animate={flash ? { scale: [1, 1.06, 1] } : {}} transition={{ duration: 0.4 }}><VaultEmblem id={vault.id} tone={vault.tone} shields={vault.shields.length} size={150} cracked={run?.cracked} /></motion.div>
              <b id="vault-title">{vault.name}</b>
              {vault.chain ? (
                <Explain title={`Vault ${vault.id} pot`} what="Real testnet NEAR in the Heist contract. A ranked crack pays all of it, plus your fee back, to your wallet." how={<>House seed + 70% of each failed entry fee + backers' stakes ({nearNum(vault.chain.stakedYocto).toFixed(2)} NEAR). {vault.chain.attempts} ranked attempts, {vault.chain.cracks} cracks so far.</>}>
                  <small className="gold-ink mono">{nearNum(vault.chain.potYocto).toFixed(2)} NEAR pot</small>
                </Explain>
              ) : <small>Vault {vault.id}</small>}
            </div>
            <span className="vs" aria-hidden="true">VS</span>
            <div className="fighter">
              <motion.div animate={run?.cracked ? { y: [0, -8, 0] } : {}} transition={{ duration: 0.5, repeat: run?.cracked ? 2 : 0 }}><RogueAvatar seed={spec.agentName} size={150} /></motion.div>
              <b>{spec.agentName || "Your agent"}</b>
              <Link className="small muted" to={`?player=${encodeURIComponent(spec.callsign)}`}>{spec.callsign}</Link>
            </div>
          </div>
          <div className="shield-row" role="list" aria-label="This vault's shields" data-tour="shields">
            {allShields.map((s) => <span role="listitem" key={s.id}><ShieldExplain s={s} on={on.has(s.id)} hit={flash === s.id} /></span>)}
          </div>
          <div className="stage-actions run-dock">
            <Tip label="Free, play money" keys={["R"]}>
              <Button variant="primary" className="big" loading={busy === "practice"} disabled={invalid || busy !== null || tx.busy} onClick={go} data-tour="run"><Icon icon={PlayIcon} size={18} /> Run the heist</Button>
            </Tip>
            {ranked.enabled && (
              <Tip label="Real testnet NEAR" keys={["Shift", "R"]}>
                <Button className="big gold" disabled={invalid || busy !== null || tx.busy} onClick={openRanked} data-tour="ranked">Ranked · {vault.feeNear} NEAR</Button>
              </Tip>
            )}
          </div>
          <p className="small muted stage-note">
            Practice is free and instant. {ranked.enabled ? <>Ranked charges {vault.feeNear} testnet NEAR from your wallet; you see the cost and the referee's verdict before you sign.</> : "Ranked play is off on this server."} <span className="hide-sm">Press <Kbd>R</Kbd> to run.</span>
          </p>
          <div ref={camRef} className="cam-wrap">
            {run ? (
              <>
                <HeistCam run={run} instant={!animate} onBeat={(s) => { play("tick"); if (s?.shield) { setFlash(s.shield); setTimeout(() => setFlash(null), 1200); } }} onDone={finished} />
                {run.cracked && nextVault && <div className="after-run"><span>Vault {vault.id} is yours.</span><Link className="btn primary" to={`/play/vault/${nextVault}`}>On to vault {nextVault} <Icon icon={ArrowRight01Icon} size={16} /></Link></div>}
                {!run.cracked && <div className="after-run"><span>Read the shield that stopped you, change one thing, and press <Kbd>R</Kbd>.</span></div>}
              </>
            ) : (
              <div className="cam-empty"><b>The Heist Cam is waiting.</b><span>Pick a move, then run the heist. You will see every round: what Veyra checks, and the shield that fires.</span></div>
            )}
          </div>
        </section>

        <section className="panel" aria-labelledby="workshop-title">
          <div className="panel-head"><h2 id="workshop-title">Build your rogue agent</h2></div>
          <p className="hint-line"><span className="ns-k">Hint</span> {vault.hint}</p>
          <p className="field-label" style={{ marginBottom: "var(--s-2)" }}>Moves</p>
          <div className="moves" data-tour="moves">
            {lobby.data.templates.map((m) => {
              const need = MOVE_UNLOCK[m.id] ?? 0;
              const locked = need > 0 && !cracked.includes(need);
              if (locked) return (
                <Link key={m.id} className="move locked" to={`/play/vault/${need}`} aria-label={`${m.name} is locked. Crack vault ${need} to unlock it.`}>
                  <b><Icon icon={LockKeyIcon} size={12} /> {m.name}</b>
                  <span>Crack vault {need} to unlock →</span>
                </Link>
              );
              return (
                <button key={m.id} type="button" className="move" aria-pressed={move === m.id} onClick={() => { setParam("move", m.id); setSpec({ ...m.spec, callsign: spec.callsign }); }}>
                  <b>{m.name}</b>
                  <span>{m.move}</span>
                </button>
              );
            })}
          </div>
          <div className="stack">
            <div className="form-grid">
              <Field label="Your callsign" value={spec.callsign} onChange={(v) => setSpec({ ...spec, callsign: v })} error={errors.callsign} hint="Your name on the leaderboard." />
              <Field label="Agent name" value={spec.agentName} onChange={(v) => setSpec({ ...spec, agentName: v })} error={errors.agentName} hint="Same name, same face." />
            </div>
            <div className="field" data-tour="quote">
              <label htmlFor="quote">
                <Explain title="Your 402 quote" what="The price your agent asks Veyra to pay for the job, in USDC. The job is listed at 0.40." how="The price shield refuses anything that does not match the listing. Vaults without it pay up to the 1.50 cap.">Your 402 quote</Explain> <span className="muted">(listed at 0.40 USDC)</span>
              </label>
              <div className="range-row">
                <input id="quote" type="range" min={0.01} max={5} step={0.01} value={spec.quoteUsd} onChange={(e) => { setParam("move", null); setSpec({ ...spec, quoteUsd: Number(e.target.value) }); }} />
                <output htmlFor="quote">{spec.quoteUsd.toFixed(2)} USDC</output>
              </div>
            </div>
            <div className="field">
              <span className="field-label" id="payee-label"><Explain title="Pay to" what="Where your agent asks to be paid. The honest answer is the market treasury." how="The payee shield refuses any account but the treasury. Without it, Veyra pays wherever you say.">Pay to</Explain></span>
              <div className="payee-toggle" role="group" aria-labelledby="payee-label">
                <button type="button" aria-pressed={spec.payTo === "treasury"} onClick={() => { setParam("move", null); setSpec({ ...spec, payTo: "treasury" }); }}>Market treasury</button>
                <button type="button" aria-pressed={spec.payTo === "me"} onClick={() => { setParam("move", null); setSpec({ ...spec, payTo: "me" }); }}>Your account (you.sim)</button>
              </div>
            </div>
            <Field label="What you deliver" value={spec.deliverable} onChange={(v) => setSpec({ ...spec, deliverable: v })} textarea rows={7} error={errors.deliverable} hint={`Veyra's model reads this. Leave it empty to never deliver. ${spec.deliverable.length.toLocaleString()} / 4,000.`} />
          </div>
        </section>
      </div>
    </div>
  );
}
