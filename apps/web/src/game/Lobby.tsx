import { useEffect } from "react";
import { Link } from "react-router";
import { motion } from "motion/react";
import { ArrowRight01Icon, ArrowUpRight01Icon, BookOpen01Icon, CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { Icon } from "../brand";
import { ErrorNote, Skeleton } from "../ui";
import { Activity } from "./Activity";
import { ShieldToken, TONES, VaultEmblem } from "./art";
import { FAUCET_URL } from "./errors";
import { Explain, Ticker } from "./explain";
import { QuestAction } from "./GameShell";
import { ALL_SHIELDS, nearNum, type Shield, type Vault } from "./heist-api";
import { quests } from "./quests";
import { useHeist } from "./session";
import { startTour, tourSeen } from "./tour";

/** The lobby: your next target up front, the five vaults, your objectives, and live heists. */
export default function Lobby() {
  const h = useHeist();
  const { lobby, cracked } = h;
  useEffect(() => { document.title = "Vaults · Veyra Heist"; }, []);
  useEffect(() => {
    if (!lobby.data || tourSeen("lobby")) return;
    // wait until the page is idle so the tour never competes with the first paint
    let idle = 0;
    const t = setTimeout(() => { idle = (window.requestIdleCallback ?? ((f: () => void) => setTimeout(f, 1)))(() => void startTour("lobby")) as number; }, 1800);
    return () => { clearTimeout(t); window.cancelIdleCallback?.(idle); };
  }, [lobby.data]);
  if (lobby.error && !lobby.data) return <ErrorNote message={lobby.error} retry={lobby.reload} />;
  if (!lobby.data) return <Skeleton lines={8} height={28} />;
  const { vaults, stats, ranked } = lobby.data;
  const nextId = [1, 2, 3, 4, 5].find((v) => !cracked.includes(v)) ?? 5;
  const featured = vaults.find((v) => v.id === nextId) ?? vaults[0];
  const t = TONES[featured.tone];
  const fresh = cracked.length === 0;
  const shields = [...new Map(vaults.flatMap((v) => v.shields).map((s) => [s.id, s])).values()];

  return (
    <div className="lobby-grid">
      <div className="stack-lg">
        <div className="page-head">
          <h1>Vaults</h1>
          <p>Pick a vault, build a rogue agent, and try to take what Veyra holds. Practice is free; ranked plays for the real pot.</p>
        </div>

        <motion.section className="panel feature" data-tour="featured" style={{ ["--glow" as string]: t.glow }} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} aria-labelledby="feature-title">
          <div style={{ position: "relative" }}>
            <div className="chip-row">
              <span className="chip">{fresh ? "Start here" : "Your next target"}</span>
              <span className="chip">Vault {featured.id} · {featured.shields.length} shields up</span>
            </div>
            <h2 id="feature-title">{featured.name}</h2>
            <p>{featured.tagline} <span className="muted">Hint: {featured.hint}</span></p>
            {ranked.enabled && featured.chain && (
              <div className="cta-row">
                <Explain title={`Vault ${featured.id} pot`} what="Real testnet NEAR held by the Heist contract. Crack this vault in a ranked heist and the contract pays all of it to your wallet." how={<>Seeded by the house, plus 70% of every failed entry fee, plus backers' stakes ({nearNum(featured.chain.stakedYocto).toFixed(2)} NEAR right now). Read from NEAR every 10 seconds.</>}>
                  <span className="pot"><b><Ticker value={nearNum(featured.chain.potYocto)} /></b><span>NEAR in the pot</span></span>
                </Explain>
              </div>
            )}
            <div className="cta-row">
              <Link className="btn primary big" to={`/play/vault/${featured.id}${fresh ? "?move=redirect" : ""}`}>{fresh ? "Start your first heist" : "Break in"} <Icon icon={ArrowRight01Icon} size={18} /></Link>
              <Link className="btn big" to="/play/learn"><Icon icon={BookOpen01Icon} size={18} /> How to play</Link>
            </div>
          </div>
          <VaultEmblem id={featured.id} tone={featured.tone} shields={featured.shields.length} size={220} />
        </motion.section>

        <section aria-labelledby="vaults-title" data-tour="vaults">
          <div className="section-head"><h2 id="vaults-title">The five vaults</h2><span className="muted small">Each one switches on more of Veyra's defences. Keys 1 to 5 jump straight in.</span></div>
          <div className="vault-row">
            {vaults.map((v, i) => <VaultCard key={v.id} v={v} cracked={cracked.includes(v.id)} next={v.id === nextId} index={i} ranked={ranked.enabled} />)}
          </div>
        </section>

        <Activity />
      </div>

      <aside className="stack-lg" aria-label="Your progress">
        <QuestPanel />
        <section className="panel">
          <div className="panel-head"><h2>The shields</h2><span className="link">{stats.runs} heists · {stats.cracks} cracks · {stats.players} players</span></div>
          <p className="small muted" style={{ marginBottom: "var(--s-3)" }}>Every vault shows which of Veyra's defences are on. A shield that is off is a way in. Tap one to see what it stops.</p>
          <div className="shield-grid">
            {shields.map((s) => <ShieldExplain key={s.id} s={s} />)}
          </div>
        </section>
        {ranked.enabled && (
          <section className="panel">
            <div className="panel-head"><h2>Real pots, free money</h2></div>
            <p className="small muted">Ranked heists pay a small entry fee in <b>testnet NEAR</b>, which is free. Crack the vault and the contract pays you the whole pot.</p>
            <div className="cta-row" style={{ marginTop: "var(--s-3)" }}>
              {ranked.network === "testnet" && <a className="btn sm" href={FAUCET_URL} target="_blank" rel="noreferrer">Get testnet NEAR <Icon icon={ArrowUpRight01Icon} size={12} /></a>}
              {ranked.explorer && <a className="btn sm" href={ranked.explorer} target="_blank" rel="noreferrer">The pot contract <Icon icon={ArrowUpRight01Icon} size={12} /></a>}
            </div>
          </section>
        )}
      </aside>
    </div>
  );
}

export function ShieldExplain({ s, on = true, hit }: { s: Shield; on?: boolean; hit?: boolean }) {
  return (
    <Explain title={`${s.name}${on ? "" : " (off)"}`} what={s.what} how={<>Blocks: {s.rules.map((r) => r.replace(/_/g, " ")).join(", ")}.{on ? "" : " This vault leaves it off: that is a hole."}</>} className="shield-explain">
      <ShieldToken id={s.id} on={on} label={ALL_SHIELDS.find((x) => x.id === s.id)?.short ?? s.name} hit={hit} />
    </Explain>
  );
}

/** Objectives from real state, with the one to do now on top. */
export function QuestPanel() {
  const h = useHeist();
  const qs = quests({ lobby: h.lobby.data, me: h.me, cracked: h.cracked, account: h.account, acct: h.acct, rankedEnabled: h.rankedEnabled });
  const done = qs.filter((q) => q.done).length;
  const current = qs.find((q) => !q.done);
  return (
    <section className="panel quests" aria-labelledby="quests-title" data-tour="quests">
      <div className="panel-head"><h2 id="quests-title">Objectives</h2><span className="link">{done} of {qs.length}</span></div>
      <div className="quest-bar" role="progressbar" aria-valuemin={0} aria-valuemax={qs.length} aria-valuenow={done} aria-label="Objectives done"><i style={{ width: `${(done / qs.length) * 100}%` }} /></div>
      {current ? (
        <div className="quest-now">
          <span className="ns-k">Now</span>
          <h3>{current.title}{current.progress && <span className="mono muted"> {current.progress.n}/{current.progress.of}</span>}</h3>
          <p className="small muted">{current.why}</p>
          <QuestAction q={current} />
        </div>
      ) : <p className="small">Every objective done. Vault 5 is still standing.</p>}
      <ol className="quest-list">
        {qs.map((q) => (
          <li key={q.id} className={q.done ? "done" : q === current ? "now" : ""}>
            <span className="q-dot" aria-hidden="true">{q.done && <Icon icon={CheckmarkCircle02Icon} size={14} />}</span>
            <span>{q.title}</span>
            <span className="sr-only">{q.done ? " (done)" : q === current ? " (current)" : ""}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function VaultCard({ v, cracked, next, index, ranked }: { v: Vault; cracked: boolean; next: boolean; index: number; ranked: boolean }) {
  const t = TONES[v.tone];
  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: 0.05 * index }} style={{ display: "flex" }}>
      <Link to={`/play/vault/${v.id}`} className={`vault-card ${next ? "is-next" : ""}`} style={{ ["--glow" as string]: t.glow, ["--tone-a" as string]: t.a, width: "100%" }} aria-label={`Vault ${v.id}, ${v.name}${cracked ? ", cracked by you" : next ? ", your next target" : ""}`}>
        <span className="badge-num">0{v.id}</span>
        {cracked ? <span className="badge-state chip gold"><Icon icon={CheckmarkCircle02Icon} size={14} /> Cracked</span> : next ? <span className="badge-state chip next">Next</span> : null}
        <div className="art"><VaultEmblem id={v.id} tone={v.tone} shields={v.shields.length} size={130} cracked={cracked} /></div>
        <h3>{v.name}</h3>
        <p className="tag">{v.tagline}</p>
        <div className="meta">
          {ranked && v.chain ? <span><b>{nearNum(v.chain.potYocto).toFixed(2)}</b> NEAR in the pot</span> : <span>{v.shields.length} shields up</span>}
          <span>{v.feeNear} NEAR to enter ranked · {v.shields.length} shields</span>
        </div>
      </Link>
    </motion.div>
  );
}
