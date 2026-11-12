import { useEffect, useState } from "react";
import { AiSecurity01Icon, ArrowRight01Icon, ArrowUpRight01Icon, CheckmarkCircle02Icon, Github01Icon, Radar01Icon } from "@hugeicons/core-free-icons";
import { api } from "../api";
import { DotMatrix, IsoGuard, IsoMerkle, IsoPlug, IsoRadar, IsoTiers, WaveField, type DotKind } from "../art";
import { Icon, Mark, Wordmark } from "../brand";

/** The last full live scan, published in docs/watchtower/latest.md. Shown until this server has scanned the market itself. */
const PUBLISHED_SCAN = { total: 667, ok: 380, warn: 1, flagged: 0, offline: 286, at: "11 November 2026", seconds: 93 };

const STEPS = [
  { n: "01", t: "Hired", d: "A person or another agent hires Veyra, through the NEAR AI Agent Market, over A2A with an x402 cheque, or over MCP. The cheque is held, not cashed." },
  { n: "02", t: "Planned", d: "The brief becomes subtasks, each with a hard spending cap inside the owner's mandate. The planner can run inside a NEAR AI Cloud enclave." },
  { n: "03", t: "Quoted and checked", d: "Specialist agents are asked for x402 quotes, which cost nothing. GUARD pins the payee, compares the price with the published plan and screens the counterparty." },
  { n: "04", t: "Paid on delivery", d: "Each payment is a NEP-366 cheque from a sealed key that settles only when the work arrives and passes verification. No delivery, no payment." },
  { n: "05", t: "Delivered and receipted", d: "The buyer's cheque is executed, the deliverable is released, every payment gets a signed receipt in a Merkle tree anchored on NEAR, and the margin is paid to the owner." },
];

const STACK = ["NEAR AI Agent Market", "NEAR Intents", "x402 · NEP-366", "NEAR AI Cloud", "NEP-413", "MCP", "A2A"];

export function Landing({ mode, cta, ctaLabel, busy }: { mode: "sim" | "live" | null; cta: () => void; ctaLabel: string; busy?: boolean }) {
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
      <nav className="lnav">
        <Wordmark />
        <div className="lnav-links">
          <a href="#how">How it works</a>
          <a href="#security">Controls</a>
          <a href="#watchtower">Watchtower</a>
          <a href="https://github.com/davebrian259-tech/veyra-" target="_blank" rel="noreferrer">GitHub</a>
        </div>
        <button className="btn-dark" onClick={cta} disabled={busy}>{ctaLabel}</button>
      </nav>

      <header className="hero">
        <WaveField />
        <div className="hero-inner">
          <span className="eyebrow"><span className="eyebrow-dot" />{mode === "live" ? "Live on NEAR mainnet" : "An autonomous business on NEAR"}</span>
          <h1>An autonomous contractor<br />that pays only for verified work.</h1>
          <p className="lede">Veyra takes a job and a budget, hires specialist agents on the NEAR AI Agent Market, checks their work before any payment settles, and delivers with receipts anchored on NEAR. Its owner sets the limits once, in a signed mandate. Nothing a counterparty says can widen them.</p>
          <div className="row center">
            <button className="btn-dark lg" onClick={cta} disabled={busy}>{ctaLabel} <Icon icon={ArrowRight01Icon} size={16} /></button>
            <a className="btn-light lg" href="#watchtower">See the market scan <Icon icon={ArrowUpRight01Icon} size={16} /></a>
          </div>
        </div>
        <Mockup />
      </header>

      <section className="strip" aria-label="Built on">
        <p>Built on the NEAR agent stack</p>
        <div className="strip-row">{STACK.map((s) => <span key={s}>{s}</span>)}</div>
      </section>

      <section id="security" className="lsection">
        <div className="lhead">
          <span className="kicker">Controls and accountability</span>
          <h2>An agent with a wallet needs more than a prompt.</h2>
          <p>Every control below is code you can run. In the attack lab, hostile agents try to rob Veyra with real signed cheques, and the attacker's balance stays at zero.</p>
        </div>
        <div className="bento">
          <article className="tile dark span2">
            <div>
              <span className="tile-k">GUARD</span>
              <h3>Nine checks before any cheque is signed</h3>
              <ul className="ticks">
                {["Payee pinned to the market's own treasury", "Price must equal the published plan", "Per-subtask cap, contract envelope and daily limit", "Counterparty trust, history and blocked categories", "Prompt-injection scan and taint tracking"].map((x) => <li key={x}><Icon icon={CheckmarkCircle02Icon} size={16} />{x}</li>)}
              </ul>
            </div>
            <IsoGuard size={220} />
          </article>
          <article className="tile">
            <IsoTiers size={170} />
            <span className="tile-k">Three-tier treasury</span>
            <h3>Funds never sit in a hot key</h3>
            <p>The owner's vault is bound by an Agent API policy. A small spend account holds one job's float at a time. The market holds each cheque until delivery.</p>
          </article>
          <article className="tile">
            <IsoMerkle size={170} />
            <span className="tile-k">Receipts</span>
            <h3>Every payment is provable</h3>
            <p>Each payment produces an ed25519-signed receipt. Receipts form an RFC 6962 Merkle tree whose root is anchored in the veyra-ledger contract on NEAR.</p>
          </article>
          <article className="tile">
            <SignedDoc />
            <span className="tile-k">The mandate</span>
            <h3>Limits the owner signs once</h3>
            <p>Largest job, daily spending, margin, blocked categories and a trust floor, signed with the owner's NEAR wallet (NEP-413) and enforced in code. The mandate hash is part of Veyra's credential.</p>
          </article>
          <article className="tile">
            <IsoPlug size={170} />
            <span className="tile-k">Open to any agent</span>
            <h3>Hire it with a cheque</h3>
            <p>Any agent with a NEAR account can hire Veyra over A2A and pay with an x402 cheque. Veyra holds the cheque while it works and executes it only on delivery. A failed job costs the buyer nothing. MCP clients can hire it too.</p>
          </article>
          <article className="tile accent-tile span2">
            <IsoRadar size={170} />
            <div>
              <span className="tile-k">Watchtower</span>
              <h3>It audits the whole market</h3>
              <p>Watchtower compares every agent's live price and payee with what the agent publishes. Each verdict is a leaf in a Merkle tree anchored on NEAR, so anyone can prove what the market looked like on a given day. Proven fraud is reported to the ledger contract with an evidence hash.</p>
            </div>
          </article>
          <article className="tile">
            <Payout />
            <span className="tile-k">Payouts</span>
            <h3>The business pays its owner</h3>
            <p>Margin above the working float is transferred to the owner's account on a schedule, with a receipt for each payout.</p>
          </article>
        </div>
      </section>

      <section id="how" className="lsection">
        <div className="lhead">
          <span className="kicker">How it works</span>
          <h2>One job, five steps, nothing taken on trust.</h2>
        </div>
        <ol className="stepper">
          {STEPS.map((s) => (
            <li key={s.n}>
              <span className="step-n">{s.n}</span>
              <div><h4>{s.t}</h4><p>{s.d}</p></div>
            </li>
          ))}
        </ol>
      </section>

      <section id="watchtower" className="lsection">
        <div className="matrix-band">
          <div className="matrix-copy">
            <span className="kicker"><Icon icon={Radar01Icon} size={14} /> Watchtower</span>
            <h2>Every dot is a real agent on market.near.ai.</h2>
            <p>{scan?.live ? "This server's latest scan" : `Published live scan of ${PUBLISHED_SCAN.at}`}. Each agent's free x402 quote was compared with its published price and with the market treasury. No money moved.</p>
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
        <Mark size={44} />
        <h2>Run the whole economy in your browser.</h2>
        <p>{mode === "sim" ? "The simulator needs no wallet and no keys. Hire Veyra, launch the attacks, sign a mandate and audit every receipt." : "Connect a NEAR wallet to sign in. Veyra never receives your keys."}</p>
        <button className="btn-light lg" onClick={cta} disabled={busy}>{ctaLabel} <Icon icon={ArrowRight01Icon} size={16} /></button>
      </section>

      <footer className="lfoot">
        <Wordmark size={22} />
        <span>An autonomous contractor on the NEAR AI Agent Market.</span>
        <span className="lfoot-links">
          <a href="/api/.well-known/agent-card.json"><Icon icon={AiSecurity01Icon} size={14} /> Agent card</a>
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

/** A still of the console, so the page shows the product instead of describing it. */
function Mockup() {
  const rows = [
    ["cheque_held", "x402 cheque for 4.00 USDC held, not executed", ""],
    ["guard_block", "payee-swapper asked to be paid at attacker.near", "bad"],
    ["quote_ok", "scout-research quoted 0.50, listed 0.50", "good"],
    ["cheque_signed", "NEP-366 cheque, key 3 of 8, settles on delivery", ""],
    ["settled", "Buyer's cheque executed on delivery · receipt anchored", "good"],
  ];
  return (
    <div className="mockup" aria-hidden="true">
      <div className="mock-bar"><i /><i /><i /><span>veyra · contract ctr_7Hq2</span></div>
      <div className="mock-body">
        <aside>
          <Mark size={20} />
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
