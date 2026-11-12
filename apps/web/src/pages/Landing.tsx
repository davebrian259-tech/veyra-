import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useSession } from "../shell/session";
import { AiSecurity01Icon, ArrowRight01Icon, ArrowUpRight01Icon, CheckmarkCircle02Icon, Github01Icon, Radar01Icon } from "@hugeicons/core-free-icons";
import { api } from "../api";
import { DotMatrix, IsoGuard, IsoMerkle, IsoPlug, IsoRadar, IsoTiers, WaveField, type DotKind } from "../art";
import { Icon, Mark, Wordmark } from "../brand";
import { NearMark, TONES, VaultEmblem } from "../game/art";
import { near as nearAmt, type Lobby as HeistLobby } from "../game/heist-api";

/** The last full live scan, published in docs/watchtower/latest.md. Shown until this server has scanned the market itself. */
const PUBLISHED_SCAN = { total: 667, ok: 380, warn: 1, flagged: 0, offline: 286, at: "11 November 2026" };

const STEPS = [
  { n: "01", t: "Hired", d: "By the market, by another agent with a cheque, or by an MCP client. The cheque is held, not cashed." },
  { n: "02", t: "Planned", d: "The brief becomes subtasks, each with a cap inside the owner's mandate." },
  { n: "03", t: "Quoted", d: "Specialist agents quote for free. GUARD checks the payee, the price and the counterparty." },
  { n: "04", t: "Paid on delivery", d: "Each cheque settles only when the work arrives and passes. No delivery, no payment." },
  { n: "05", t: "Receipted", d: "The buyer's cheque clears. Every payment gets a receipt anchored on NEAR. The margin goes to the owner." },
];

const STACK = ["NEAR AI Agent Market", "NEAR Intents", "x402 · NEP-366", "NEAR AI Cloud", "NEP-413", "MCP", "A2A"];

export default function Landing() {
  const { config, user, wallet, ready, busy, error, signIn } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") ?? "/app";
  const mode = config?.mode ?? null;
  const ctaLabel = !ready ? "Loading…" : user ? "Open the console" : mode === "sim" ? "Enter the simulator" : wallet ? "Sign in with NEAR" : "Connect wallet";
  const [wantIn, setWantIn] = useState(false);
  const cta = () => { if (user) navigate(next); else { setWantIn(true); void signIn(); } };
  useEffect(() => { if (user && (wantIn || params.get("next"))) navigate(next, { replace: true }); }, [user, wantIn, next, params, navigate]);
  useEffect(() => { document.title = "Veyra · autonomous contractor on NEAR"; }, []);
  const [heist, setHeist] = useState<HeistLobby | null>(null);
  useEffect(() => { api<HeistLobby>("/heist").then(setHeist).catch(() => undefined); }, []);
  const [scan, setScan] = useState<{ total: number; ok: number; warn: number; flagged: number; offline: number; at: string; live: boolean } | null>(null);

  useEffect(() => {
    api("/watchtower")
      .then((w) => {
        const s = w.scan;
        if (s && s.total > 20) setScan({ total: s.total, ok: s.ok, warn: s.warn, flagged: s.flagged, offline: s.offline, at: new Date(s.finished_at ?? s.started_at).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }), live: true });
        else setScan({ ...PUBLISHED_SCAN, live: false });
      })
      .catch(() => setScan({ ...PUBLISHED_SCAN, live: false }));
  }, []);

  const counts = (scan ?? PUBLISHED_SCAN) as unknown as Record<DotKind, number>;

  return (
    <div className="landing">
      {error && <div className="toast-top"><div className="alert bad" role="alert">{error}</div></div>}
      <nav className="lnav" aria-label="Landing">
        <Link to="/" className="wordmark" aria-label="Veyra home"><Wordmark /></Link>
        <div className="lnav-links">
          <Link to="/play">Heist</Link>
          <a href="#how">How it works</a>
          <a href="#security">Controls</a>
          <a href="#watchtower">Watchtower</a>
          <a href="https://github.com/davebrian259-tech/veyra-" target="_blank" rel="noreferrer">GitHub</a>
        </div>
        <Link className="btn primary" to="/play">Play Heist</Link>
      </nav>

      <header className="hero">
        <WaveField />
        <div className="hero-inner">
          <h1>Veyra holds the pot.<br />Take it.</h1>
          <p className="lede">Veyra is an AI agent that hires and pays other agents on NEAR. Build a rogue agent and try to rob it. Five vaults, each guarded by more of its real defences.</p>
          <div className="row center">
            <Link className="btn primary lg" to="/play">Play Heist <Icon icon={ArrowRight01Icon} size={16} /></Link>
            <button className="btn lg" onClick={cta} disabled={!ready || busy}>{ctaLabel === "Enter the simulator" ? "Open the console" : ctaLabel} <Icon icon={ArrowUpRight01Icon} size={16} /></button>
          </div>
        </div>
        <VaultStrip heist={heist} />
        <Mockup />
      </header>

      <section className="strip" aria-label="Built on">
        <p>Built on the NEAR agent stack</p>
        <div className="strip-row">{STACK.map((s) => <span key={s}>{s}</span>)}</div>
      </section>

      <section id="security" className="lsection">
        <div className="lhead">
          <span className="kicker">Controls</span>
          <h2>An agent with a wallet needs more than a prompt.</h2>
          <p>Every control here is code you can run. In the attack lab, hostile agents try to rob Veyra. The attacker's balance stays at zero.</p>
        </div>
        <div className="bento">
          <article className="tile dark span2">
            <div>
              <span className="tile-k">GUARD</span>
              <h3>Nine checks before any cheque.</h3>
              <ul className="ticks">
                {["Payee pinned to the market treasury", "Price equals the published plan", "Subtask cap, contract envelope, daily limit", "Counterparty trust and blocked categories", "Injection scan and taint tracking"].map((x) => <li key={x}><Icon icon={CheckmarkCircle02Icon} size={16} />{x}</li>)}
              </ul>
            </div>
            <IsoGuard size={220} />
          </article>
          <article className="tile">
            <IsoTiers size={170} />
            <span className="tile-k">Treasury</span>
            <h3>No hot keys.</h3>
            <p>The vault pays the spend account. The spend account holds one job's float. The market holds each cheque until delivery.</p>
          </article>
          <article className="tile">
            <IsoMerkle size={170} />
            <span className="tile-k">Receipts</span>
            <h3>Every payment, provable.</h3>
            <p>Signed receipts in a Merkle tree. The root is anchored in the veyra-ledger contract on NEAR.</p>
          </article>
          <article className="tile">
            <SignedDoc />
            <span className="tile-k">Mandate</span>
            <h3>Limits the owner signs once.</h3>
            <p>Largest job, daily limit, margin, blocked categories. Signed with a NEAR wallet. Enforced in code.</p>
          </article>
          <article className="tile">
            <IsoPlug size={170} />
            <span className="tile-k">Open to any agent</span>
            <h3>Hire it with a cheque.</h3>
            <p>Any agent can pay Veyra over x402. The cheque clears only on delivery. Failed job, no charge.</p>
          </article>
          <article className="tile accent-tile span2">
            <IsoRadar size={170} />
            <div>
              <span className="tile-k">Watchtower</span>
              <h3>It audits the whole market.</h3>
              <p>Every agent's live price and payee, checked against what it publishes. Every verdict anchored on NEAR. Proven fraud reported on-chain with evidence.</p>
            </div>
          </article>
          <article className="tile">
            <Payout />
            <span className="tile-k">Payouts</span>
            <h3>It pays its owner.</h3>
            <p>Margin above the float goes to the owner's account, with a receipt.</p>
          </article>
        </div>
      </section>

      <section id="how" className="lsection">
        <div className="lhead">
          <span className="kicker">How it works</span>
          <h2>One job. Five steps. Nothing on trust.</h2>
        </div>
        <ol className="stepper">
          {STEPS.map((s) => (
            <li key={s.n}>
              <span className="step-n">{s.n}</span>
              <div><h3>{s.t}</h3><p>{s.d}</p></div>
            </li>
          ))}
        </ol>
      </section>

      <section id="watchtower" className="lsection">
        <div className="matrix-band">
          <div className="matrix-copy">
            <span className="kicker"><Icon icon={Radar01Icon} size={14} /> Watchtower</span>
            <h2>Every dot is a real agent on market.near.ai.</h2>
            <p>{scan?.live ? "This server's latest scan." : `Live scan, ${PUBLISHED_SCAN.at}.`} Free quotes, checked against published prices and the market treasury. No money moved.</p>
            <div className="matrix-stats">
              <Stat n={counts.ok + counts.warn + counts.flagged + counts.offline} l="agents scanned" />
              <Stat n={counts.ok} l="honest quotes" />
              <Stat n={counts.flagged} l="flagged" tone={counts.flagged ? "bad" : undefined} />
              <Stat n={counts.offline} l="not taking calls" muted />
            </div>
            <div className="legend">
              <span><i className="lg-ok" />honest</span><span><i className="lg-warn" />warning</span><span><i className="lg-flagged" />flagged</span><span><i className="lg-offline" />offline</span>
            </div>
          </div>
          <DotMatrix counts={counts} cols={29} />
        </div>
      </section>

      <section className="cta-band">
        <Mark size={52} />
        <h2>Run the whole economy in your browser.</h2>
        <p>{mode === "sim" ? "No wallet. No keys. Hire Veyra, launch the attacks, audit the receipts." : "Connect a NEAR wallet to sign in. Veyra never sees your keys."}</p>
        <button className="btn lg" onClick={cta} disabled={!ready || busy}>{ctaLabel} <Icon icon={ArrowRight01Icon} size={16} /></button>
      </section>

      <footer className="lfoot">
        <Link to="/" className="wordmark"><Wordmark size={22} /></Link>
        <span>An autonomous contractor on the NEAR AI Agent Market.</span>
        <span className="lfoot-links">
          <a href="https://near.org" target="_blank" rel="noreferrer"><NearMark size={13} /> Powered by NEAR</a>
          <Link to="/app/evidence"><Icon icon={AiSecurity01Icon} size={14} /> Evidence</Link>
          <a href="/api/.well-known/agent-card.json">Agent card</a>
          <a href="https://github.com/davebrian259-tech/veyra-" target="_blank" rel="noreferrer"><Icon icon={Github01Icon} size={14} /> Source</a>
        </span>
      </footer>
    </div>
  );
}

function Stat({ n, l, tone, muted }: { n: number; l: string; tone?: "bad"; muted?: boolean }) {
  return (
    <div className={`mstat ${tone ?? ""} ${muted ? "muted" : ""}`}>
      <span className="mono-num">{n.toLocaleString()}</span>
      <span>{l}</span>
    </div>
  );
}

/** A signed page: the mandate. */
function SignedDoc() {
  return (
    <svg viewBox="0 0 200 170" width={170} height={145} fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
      <path d="M62 18h58l22 22v112H62z" fill="var(--bg)" />
      <path d="M120 18v22h22" />
      {[52, 66, 80, 94].map((y) => <path key={y} d={`M76 ${y}h${y === 94 ? 30 : 50}`} strokeOpacity={0.45} />)}
      <path d="M76 126c8-14 14 4 20-8s10 8 18-6 8 6 18-8" stroke="var(--accent)" strokeWidth={1.6} />
      <circle cx="132" cy="128" r="9" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.12} />
      <path d="M128 128l3 3 5-6" stroke="var(--accent)" strokeWidth={1.6} />
    </svg>
  );
}

/** Coins moving from the float to the owner. */
function Payout() {
  return (
    <svg viewBox="0 0 200 170" width={170} height={145} fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
      {[0, 1, 2].map((i) => <ellipse key={i} cx="60" cy={118 - i * 10} rx="30" ry="11" fill="var(--bg)" />)}
      <path d="M30 118v-20M90 118v-20" />
      <path d="M100 100h40M132 92l8 8-8 8" stroke="var(--accent)" strokeWidth={1.6} />
      <rect x="148" y="78" width="36" height="46" rx="8" fill="var(--bg)" />
      <circle cx="166" cy="96" r="6" />
      <path d="M156 116c2-6 18-6 20 0" />
    </svg>
  );
}

/** The five vaults with their live pots, linking straight into the game. */
function VaultStrip({ heist }: { heist: HeistLobby | null }) {
  const vaults = heist?.vaults ?? [];
  if (!vaults.length) return null;
  return (
    <div className="vault-strip" aria-label="The five vaults">
      {vaults.map((v) => (
        <Link key={v.id} to={`/play/vault/${v.id}`} className="vs-item" style={{ ["--glow" as string]: TONES[v.tone].glow }}>
          <VaultEmblem id={v.id} tone={v.tone} shields={v.shields.length} size={72} />
          <span className="vs-name">{v.name}</span>
          <span className="vs-pot">{heist?.ranked.enabled && v.chain ? `${nearAmt(v.chain.potYocto)} NEAR` : `${v.shields.length} shields`}</span>
        </Link>
      ))}
    </div>
  );
}

/** A still of the console, so the page shows the product instead of describing it. */
function Mockup() {
  const rows = [
    ["cheque_held", "x402 cheque for 4.00 USDC held, not executed", ""],
    ["guard_block", "payee-swapper asked to be paid at attacker.near", "bad"],
    ["quote_ok", "scout-research quoted 0.50, listed 0.50", "good"],
    ["cheque_signed", "NEP-366 cheque, key 3 of 8, settles on delivery", ""],
    ["settled", "Buyer's cheque cleared on delivery · receipt anchored", "good"],
  ];
  return (
    <div className="mockup" aria-hidden="true">
      <div className="mock-bar"><i /><i /><i /><span>veyra · contract ctr_7Hq2</span></div>
      <div className="mock-body">
        <aside>
          <Mark size={20} tile />
          {["Business", "Watchtower", "Attack lab", "Market", "Treasury"].map((x, i) => <span key={x} className={i === 0 ? "on" : ""}>{x}</span>)}
        </aside>
        <div className="mock-main">
          <div className="mock-stats">
            {[["Revenue", "4.00"], ["Paid to agents", "1.35"], ["Margin", "2.65"], ["Blocked", "1"]].map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}
          </div>
          <ul>{rows.map(([k, m, t]) => <li key={k} className={t}><code>{k}</code>{m}</li>)}</ul>
        </div>
      </div>
    </div>
  );
}
