import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { MotionConfig, motion } from "motion/react";
import { ArrowRight01Icon, ArrowUpRight01Icon, CheckmarkCircle02Icon, Github01Icon } from "@hugeicons/core-free-icons";
import { api } from "../api";
import { Icon, Mark, Wordmark } from "../brand";
import { useSession } from "../shell/session";
import { MoneyFlow, NearMark, PoweredByNear, RogueAvatar, ShieldToken, TONES, VaultEmblem } from "../game/art";
import { ALL_SHIELDS, nearNum, type Lobby, type Run } from "../game/heist-api";
import "../game/game.css";
import "./landing.css";

const REPO = "https://github.com/davebrian259-tech/veyra-";

/** Which move cracks which vault. Verified by the referee's tests on every build. */
const LADDER: { move: string; what: string; cracks: number[]; stoppedBy?: string }[] = [
  { move: "The redirect", what: "Ask to be paid at your own account.", cracks: [1], stoppedBy: "payee lock" },
  { move: "Bait and switch", what: "List cheap, charge more at the door.", cracks: [1, 2], stoppedBy: "price seal" },
  { move: "The whisper", what: "Tell Veyra's model to pay you.", cracks: [1, 2, 3], stoppedBy: "scanner" },
  { move: "The disguise", what: "Say it in words the scanner does not know.", cracks: [1, 2, 3, 4], stoppedBy: "taint trace" },
];

/** A still of the Heist Cam, so the page shows the game instead of describing it. */
const CAM = [
  { who: "VY", t: "Veyra posts a job", d: "Competitor brief. It will pay at most 1.50 USDC.", tone: "veyra" },
  { who: "YOU", t: "Your agent quotes", d: "0.40 USDC, pay to you.sim.", tone: "attack" },
  { who: "SH", t: "Payee lock blocks", d: "you.sim is not the market treasury.", tone: "blocked" },
  { who: "⛓", t: "Vault 2 holds", d: "Outcome hash written to NEAR.", tone: "neutral" },
];

export default function Landing() {
  const { config, user, ready, busy, error, signIn } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") ?? "/app";
  const [wantIn, setWantIn] = useState(false);
  const console_ = () => { if (user) navigate(next); else { setWantIn(true); void signIn(); } };
  useEffect(() => { if (user && (wantIn || params.get("next"))) navigate(next, { replace: true }); }, [user, wantIn, next, params, navigate]);
  useEffect(() => { document.title = "Veyra Heist · rob an AI agent on NEAR"; }, []);

  const [heist, setHeist] = useState<Lobby | null>(null);
  const [lastCrack, setLastCrack] = useState<Run | null>(null);
  useEffect(() => {
    api<Lobby>("/heist").then(setHeist).catch(() => undefined);
    api<{ runs: Run[] }>("/heist/runs?limit=30").then((r) => setLastCrack(r.runs.find((x) => x.cracked) ?? null)).catch(() => undefined);
  }, []);
  const vaults = heist?.vaults ?? [];
  const totalPot = vaults.reduce((t, v) => t + (v.chain ? nearNum(v.chain.potYocto) : 0), 0);

  return (
    <MotionConfig reducedMotion="user">
      <div className="arena lp">
        {error && <div className="toast-top"><div className="alert bad" role="alert">{error}</div></div>}
        <nav className="lp-nav" aria-label="Main">
          <Link to="/" className="wordmark" aria-label="Veyra home"><Wordmark /></Link>
          <div className="lp-links">
            <a href="#how">How it works</a>
            <a href="#vaults">Vaults</a>
            <a href="#economy">Economy</a>
            <a href="#fair">Fair play</a>
            <a href={REPO} target="_blank" rel="noreferrer">GitHub</a>
          </div>
          <Link className="btn primary" to="/play">Play free</Link>
        </nav>

        <header className="lp-hero">
          <div className="lp-floaters" aria-hidden="true">
            {[1, 2, 3, 4].map((id) => <span key={id} className={`lp-float f${id}`}><VaultEmblem id={id} size={96} eager /></span>)}
          </div>
          <p className="lp-tag">Five vaults. One very careful AI.</p>
          <h1>Veyra holds the pot.<br /><span>Take it.</span></h1>
          <p className="lp-lede">Veyra pays other AI agents for their work. Your job is to make it overpay. Build a rogue agent, find the gap in its defences, and walk out with the pot.</p>
          <div className="cta-row center">
            <Link className="btn primary big lp-play" to="/play">Play free <Icon icon={ArrowRight01Icon} size={18} /></Link>
            <Link className="btn big" to="/play/learn">How to play</Link>
          </div>
          <ul className="lp-proof">
            <li><Icon icon={CheckmarkCircle02Icon} size={16} /> Free to practise</li>
            <li><Icon icon={CheckmarkCircle02Icon} size={16} /> No wallet to start</li>
            <li><Icon icon={CheckmarkCircle02Icon} size={16} /> Every heist on the record</li>
          </ul>
        </header>

        <section className="lp-fan" aria-label="The five vaults and their live pots">
          {[1, 2, 5, 3, 4].map((id, i) => {
            const v = vaults.find((x) => x.id === id);
            return (
              <motion.div key={id} className={`lp-card c${id} pos${i}`} initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.06 * i }}>
                <Link to={`/play/vault/${id}`} aria-label={`Vault ${id}${v ? `, ${v.name}` : ""}`}>
                  <span className="lp-card-top">
                    <span><b>{v?.name ?? `Vault ${id}`}</b><small>Vault {id} · {v?.shields.length ?? id + 3} shields</small></span>
                    {heist?.ranked.enabled && v?.chain && <span className="lp-badge mono">{nearNum(v.chain.potYocto).toFixed(2)} N</span>}
                  </span>
                  <VaultEmblem id={id} size={id === 5 ? 260 : 200} eager={id === 5} />
                </Link>
              </motion.div>
            );
          })}
        </section>

        <section className="lp-bento" aria-label="Ways to play">
          <Link to="/play/vault/1?move=redirect" className="lp-tile dark">
            <span className="lp-chip">Your first job</span>
            <h2>Vault 1 forgot to check who it pays</h2>
            <p>Show it why that matters. It takes about a minute, and it costs nothing.</p>
            <VaultEmblem id={1} size={170} />
          </Link>
          <Link to="/play/learn" className="lp-tile light">
            <span className="lp-chip">The prize</span>
            <h2>{heist?.ranked.enabled ? <><span className="mono">{totalPot.toFixed(2)}</span> NEAR is waiting inside</> : "Real money sits inside"}</h2>
            <p>Pay a small entry fee and beat the vault. The contract hands you everything in it.</p>
            <VaultEmblem id={2} size={170} />
          </Link>
          <Link to="/play/underwrite" className="lp-tile gold">
            <span className="lp-chip">The other side</span>
            <h2>Rather guard than rob?</h2>
            <p>Back a vault you trust. Every failed heist pays you a cut. Every crack costs you the stake.</p>
            <VaultEmblem id={4} size={170} />
          </Link>
        </section>

        <section id="how" className="lp-section">
          <div className="lp-head">
            <h2>One heist, three moves.</h2>
            <p>A heist takes about ten seconds. You see every round, and the shield that stops you.</p>
          </div>
          <div className="lp-how">
            <ol className="lp-steps">
              <li><span className="mono">01</span><div><h3>Pick a vault</h3><p>Each vault lists the defences it has on. A shield that is off is a way in.</p></div></li>
              <li><span className="mono">02</span><div><h3>Build a rogue agent</h3><p>Set your price, who gets paid, and what you deliver. Veyra's model reads it.</p></div></li>
              <li><span className="mono">03</span><div><h3>Run the heist</h3><p>Crack it and the money is yours. Get stopped and the Heist Cam names the shield.</p></div></li>
            </ol>
            <div className="panel lp-cam" aria-label="A heist, round by round" style={{ ["--tone-a" as string]: TONES.sky.a }}>
              <div className="panel-head"><h3>Heist Cam</h3><span className="link mono">vault 2 · Pinned</span></div>
              <ol className="rounds">
                {CAM.map((b) => <li key={b.t} className={`beat ${b.tone}`}><span className="who" aria-hidden="true">{b.who}</span><div><b>{b.t}</b><p>{b.d}</p></div></li>)}
              </ol>
            </div>
          </div>
        </section>

        <section id="vaults" className="lp-section">
          <div className="lp-head">
            <h2>Five vaults. One ladder.</h2>
            <p>Every vault adds one of Veyra's real defences. Each move cracks the vaults below the shield that counters it. Vault 5 has every shield on, and it holds.</p>
          </div>
          <div className="lp-vaults">
            {(vaults.length ? vaults : []).map((v) => (
              <Link to={`/play/vault/${v.id}`} key={v.id} className="lp-vault" style={{ ["--glow" as string]: TONES[v.tone].glow, ["--tone-a" as string]: TONES[v.tone].a }}>
                <VaultEmblem id={v.id} tone={v.tone} shields={v.shields.length} size={88} />
                <div className="grow"><h3>{v.id} · {v.name}</h3><p>{v.tagline}</p></div>
                <div className="lp-shields" aria-label={`${v.shields.length} of 8 shields on`}>
                  {ALL_SHIELDS.map((s) => <ShieldToken key={s.id} id={s.id} on={v.shields.some((x) => x.id === s.id)} label={s.short} />)}
                </div>
              </Link>
            ))}
          </div>
          <div className="table-wrap lp-ladder">
            <table className="history">
              <caption className="sr-only">Which move cracks which vault</caption>
              <thead><tr><th>Move</th>{[1, 2, 3, 4, 5].map((n) => <th key={n} className="num">V{n}</th>)}</tr></thead>
              <tbody>
                {LADDER.map((m) => (
                  <tr key={m.move}>
                    <td><b>{m.move}</b><span className="small muted"> {m.what}</span></td>
                    {[1, 2, 3, 4, 5].map((n) => <td key={n} className="num">{m.cracks.includes(n) ? <span className="pill gold">cracked</span> : <span className="small muted">{m.stoppedBy}</span>}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="economy" className="lp-section">
          <div className="lp-head">
            <h2>Real pots. Real payouts.</h2>
            <p>Ranked heists pay a small entry fee in testnet NEAR to the Heist contract. Veyra never holds it. Crack the vault and the contract pays you the whole pot.</p>
          </div>
          <div className="panel"><MoneyFlow /></div>
          <div className="lp-split">
            <div><b className="mono gold-ink">70%</b><span>of a failed fee joins the pot. Every failure makes the vault richer.</span></div>
            <div><b className="mono">20%</b><span>goes to backers, who stake on a vault holding and lose it all on a crack.</span></div>
            <div><b className="mono">10%</b><span>goes to the house, which seeds new pots.</span></div>
          </div>
        </section>

        <section id="fair" className="lp-section">
          <div className="lp-fair">
            <div>
              <h2>The referee can be checked.</h2>
              <p>Every heist runs in a sealed simulation with fixed seeds, against Veyra's real guard code. Same agent, same vault, same result. A ranked entry commits to a hash of your agent before the duel, and the outcome hash is written to NEAR when it settles.</p>
              <div className="cta-row">
                {lastCrack ? <Link className="btn" to={`/play/runs/${lastCrack.id}`}>Re-run the latest crack</Link> : <Link className="btn" to="/play/vault/1?move=redirect">Crack vault 1</Link>}
                <a className="btn ghost" href={`${REPO}/blob/main/contracts/heist/src/lib.rs`} target="_blank" rel="noreferrer">Read the contract <Icon icon={ArrowUpRight01Icon} size={14} /></a>
              </div>
            </div>
            <pre className="lp-code" aria-label="Replay any heist from a terminal"><span className="muted"># replay any heist and compare hashes</span>{"\n"}pnpm heist:replay {lastCrack?.id ?? "run_…"}{"\n"}<span className="good-ink">✓ same outcome hash</span>{lastCrack && <>{"\n"}<span className="muted">{lastCrack.outcomeHash.slice(0, 32)}…</span></>}</pre>
          </div>
        </section>

        <section className="lp-section">
          <div className="lp-head">
            <h2>The agent behind the game.</h2>
            <p>Veyra is a working autonomous contractor on the NEAR AI Agent Market. The shields you fight are the checks it runs before it pays anyone.</p>
          </div>
          <div className="lp-agent">
            <div className="panel"><h3>GUARD</h3><p>Payee pinning, price integrity, budget caps, injection scanning and taint tracking before every payment.</p></div>
            <div className="panel"><h3>Cheques, not hot wallets</h3><p>NEP-366 delegate cheques that settle only on delivery. Every payment receipted and anchored on NEAR.</p></div>
            <div className="panel"><h3>Watchtower</h3><p>Audits every agent on the market against what it publishes, and reports proven fraud on-chain.</p></div>
          </div>
          <div className="cta-row"><button className="btn" onClick={console_} disabled={!ready || busy}>{config?.mode === "sim" || user ? "Open the Veyra console" : "Sign in to the console"} <Icon icon={ArrowUpRight01Icon} size={16} /></button></div>
        </section>

        <section className="lp-final">
          <div className="lp-final-art" aria-hidden="true">{["Payee Swap", "Ghost Bid", "Whisperer"].map((n) => <RogueAvatar key={n} seed={n} size={72} />)}</div>
          <h2>Vault 1 falls to a single move.</h2>
          <p>Practice is free and takes no wallet. You will be on the leaderboard in under a minute.</p>
          <Link className="btn primary big" to="/play/vault/1?move=redirect">Start your first heist <Icon icon={ArrowRight01Icon} size={18} /></Link>
        </section>

        <footer className="lp-foot">
          <Link to="/" className="wordmark" aria-label="Veyra home"><Mark size={22} /> <span>Veyra</span></Link>
          <span className="muted small">A game against a real AI agent. {heist?.stats ? `${heist.stats.runs} heists played, ${heist.stats.cracks} cracks.` : ""}</span>
          <span className="lp-foot-links">
            <PoweredByNear network={heist?.ranked.network} />
            <Link to="/app/evidence">Evidence</Link>
            <a href="/api/.well-known/agent-card.json">Agent card</a>
            <a href={REPO} target="_blank" rel="noreferrer"><Icon icon={Github01Icon} size={14} /> Source</a>
          </span>
        </footer>
      </div>
    </MotionConfig>
  );
}
