import { Link, useOutletContext } from "react-router";
import { motion } from "motion/react";
import { ArrowRight01Icon, CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { Icon } from "../brand";
import type { useApi } from "../lib/data";
import { useApi as useData, when } from "../lib/data";
import { Empty, ErrorNote, Skeleton } from "../ui";
import { RogueAvatar, ShieldToken, TONES, VaultEmblem } from "./art";
import { ALL_SHIELDS, loadProgress, near, usdc, type Lobby as LobbyData, type Run, type Vault } from "./heist-api";

type LobbyCtx = ReturnType<typeof useApi<LobbyData>>;

/** The lobby: the richest vault up front, all five in a row, your progress, and the latest runs. */
export default function Lobby() {
  const lobby = useOutletContext<LobbyCtx>();
  const runs = useData<{ runs: Run[] }>("/heist/runs?limit=8", { every: 10_000 });
  const progress = loadProgress();
  if (lobby.error) return <ErrorNote message={lobby.error} retry={lobby.reload} />;
  if (!lobby.data) return <Skeleton lines={8} height={28} />;
  const { vaults, stats, ranked } = lobby.data;
  const pot = (v: Vault) => (v.chain ? BigInt(v.chain.potYocto) : 0n);
  const featured = [...vaults].sort((a, b) => (pot(b) > pot(a) ? 1 : pot(b) < pot(a) ? -1 : b.id - a.id))[0];
  const t = TONES[featured.tone];

  return (
    <div className="lobby-grid">
      <div className="stack-lg">
        <motion.section className="panel feature" style={{ ["--glow" as string]: t.glow }} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} aria-labelledby="feature-title">
          <div style={{ position: "relative" }}>
            <div className="chip-row">
              <span className="chip">Vault {featured.id}</span>
              <span className="chip">{featured.shields.length} shields up</span>
              {ranked.enabled && <span className="chip gold">Biggest pot</span>}
            </div>
            <h2 id="feature-title">{featured.name}</h2>
            <p>{featured.tagline} Build a rogue agent, get past its shields, and take what it holds.</p>
            <div className="cta-row">
              {ranked.enabled && featured.chain && <span className="pot"><b>{near(featured.chain.potYocto)}</b><span>NEAR in the pot</span></span>}
            </div>
            <div className="cta-row">
              <Link className="btn primary big" to={`/play/vault/${featured.id}`}>Break in <Icon icon={ArrowRight01Icon} size={18} /></Link>
              <Link className="btn big" to="/play/vault/1">Start at vault 1</Link>
            </div>
          </div>
          <VaultEmblem id={featured.id} tone={featured.tone} shields={featured.shields.length} size={220} />
        </motion.section>

        <section aria-labelledby="vaults-title">
          <div className="panel-head"><h2 id="vaults-title" style={{ fontSize: "var(--fs-lg)" }}>The five vaults</h2><span className="link">Each one switches on more of Veyra's defences</span></div>
          <div className="vault-row">
            {vaults.map((v, i) => <VaultCard key={v.id} v={v} cracked={progress.cracked.includes(v.id)} index={i} ranked={ranked.enabled} />)}
          </div>
        </section>

        <section className="panel" aria-labelledby="history-title">
          <div className="panel-head"><h2 id="history-title">Latest heists</h2><Link to="/play/leaderboard">Leaderboard</Link></div>
          {runs.loading && !runs.data && <Skeleton lines={4} />}
          {runs.data && !runs.data.runs.length && <Empty title="No heists yet">Be the first. Vault 1 falls to a single move.</Empty>}
          {runs.data && runs.data.runs.length > 0 && (
            <div className="table-wrap">
              <table className="history">
                <thead><tr><th>Player</th><th>Vault</th><th>Result</th><th className="num">Loot</th><th className="hide-sm">When</th></tr></thead>
                <tbody>
                  {runs.data.runs.map((r) => (
                    <tr key={r.id}>
                      <td><Link to={`/play/runs/${r.id}`} className="who"><RogueAvatar seed={r.spec.agentName} size={28} /><span>{r.account ?? r.callsign}</span></Link></td>
                      <td>{r.vault}{r.kind === "ranked" ? <span className="chip gold" style={{ marginLeft: 6 }}>ranked</span> : null}</td>
                      <td><span className={`pill ${r.cracked ? "warn" : ""}`}>{r.cracked ? "cracked" : "held"}</span></td>
                      <td className="num mono">{r.cracked ? usdc(r.lootAtomic) : "—"}</td>
                      <td className="small hide-sm" style={{ whiteSpace: "nowrap" }}>{when(r.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <aside className="stack-lg" aria-label="Your progress">
        <section className="panel ring-card">
          <div className="panel-head"><h2>Your climb</h2><span className="link">{progress.cracked.length} of 5</span></div>
          <ProgressRing cracked={progress.cracked} vaults={vaults} />
          <div className="mini-stats">
            <div><b>{stats.runs}</b><span>heists</span></div>
            <div><b>{stats.cracks}</b><span>cracks</span></div>
            <div><b>{stats.players}</b><span>players</span></div>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>The shields</h2></div>
          <p className="small muted" style={{ marginBottom: "var(--s-3)" }}>Every vault shows which of Veyra's defences are on. A shield that is off is a way in.</p>
          <div className="shield-row" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 0, ["--tone-a" as string]: "var(--fg-2)" }}>
            {ALL_SHIELDS.map((s) => <ShieldToken key={s.id} id={s.id} on label={s.short} />)}
          </div>
        </section>
        {ranked.enabled && ranked.explorer && (
          <section className="panel">
            <div className="panel-head"><h2>Real pots</h2></div>
            <p className="small muted">Ranked runs pay a small fee in testnet NEAR into the vault's pot. Crack it and the contract pays the whole pot to your wallet.</p>
            <div className="cta-row" style={{ marginTop: "var(--s-3)" }}><a className="btn sm" href={ranked.explorer} target="_blank" rel="noreferrer">See the pot contract</a><Link className="btn sm" to="/play/underwrite">Back a vault</Link></div>
          </section>
        )}
      </aside>
    </div>
  );
}

function VaultCard({ v, cracked, index, ranked }: { v: Vault; cracked: boolean; index: number; ranked: boolean }) {
  const t = TONES[v.tone];
  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: 0.05 * index }} style={{ display: "flex" }}>
      <Link to={`/play/vault/${v.id}`} className="vault-card" style={{ ["--glow" as string]: t.glow, width: "100%" }} aria-label={`Vault ${v.id}, ${v.name}${cracked ? ", cracked by you" : ""}`}>
        <span className="badge-num">0{v.id}</span>
        {cracked && <span className="badge-cracked chip gold"><Icon icon={CheckmarkCircle02Icon} size={14} /> Cracked</span>}
        <div className="art"><VaultEmblem id={v.id} tone={v.tone} shields={v.shields.length} size={130} cracked={cracked} /></div>
        <h3>{v.name}</h3>
        <p className="tag">{v.tagline}</p>
        <div className="meta">
          {ranked && v.chain ? <span><b>{near(v.chain.potYocto)}</b> NEAR in the pot</span> : <span>{v.shields.length} shields up</span>}
          <span>{v.feeNear} NEAR to enter ranked</span>
        </div>
      </Link>
    </motion.div>
  );
}

function ProgressRing({ cracked, vaults }: { cracked: number[]; vaults: Vault[] }) {
  const r = 84;
  const c = 2 * Math.PI * r;
  const seg = c / 5;
  return (
    <>
      <div className="ring" role="img" aria-label={`${cracked.length} of 5 vaults cracked`}>
        <svg viewBox="0 0 200 200" width="200" height="200">
          {vaults.map((v, i) => (
            <circle key={v.id} cx="100" cy="100" r={r} fill="none" strokeWidth="14" strokeLinecap="round"
              stroke={cracked.includes(v.id) ? TONES[v.tone].a : "var(--line-2)"}
              strokeDasharray={`${seg - 10} ${c - seg + 10}`} strokeDashoffset={-i * seg} transform="rotate(-90 100 100)" />
          ))}
        </svg>
        <div className="ring-label"><small>vaults cracked</small><b>{cracked.length}/5</b></div>
      </div>
      <div className="tone-dots">{vaults.map((v) => <i key={v.id} className={cracked.includes(v.id) ? "on" : ""} style={cracked.includes(v.id) ? { background: TONES[v.tone].a } : undefined} />)}</div>
    </>
  );
}
