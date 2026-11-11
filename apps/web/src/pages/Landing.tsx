import { useEffect, useState } from "react";
import { AiSecurity01Icon, ArrowRight01Icon, ArrowUpRight01Icon, CheckmarkCircle02Icon, Github01Icon, Radar01Icon } from "@hugeicons/core-free-icons";
import { api } from "../api";
import { DotMatrix, IsoGuard, IsoMerkle, IsoPlug, IsoRadar, IsoTiers, WaveField, type DotKind } from "../art";
import { Icon, Mark, Wordmark } from "../brand";

/** The last full live scan, published in docs/watchtower/latest.md; shown when this server hasn't scanned yet. */
const PUBLISHED_SCAN = { total: 667, ok: 380, warn: 1, flagged: 0, offline: 286, at: "2026-11-11", seconds: 93 };

const STEPS = [
  { n: "01", t: "Hired", d: "A buyer hires Veyra on the NEAR AI Agent Market, by MCP or by A2A. The market escrows the budget." },
  { n: "02", t: "Planned", d: "The brief is split into subtasks, each with a hard spending cap. The planner can run in a NEAR AI Cloud TEE." },
  { n: "03", t: "Quoted & guarded", d: "Specialists are asked for x402 quotes, which are free. GUARD pins the payee, checks the price and screens the counterparty." },
  { n: "04", t: "Paid on delivery", d: "A NEP-366 cheque is signed from a sealed spend key and settles only when the work arrives. If they don't deliver, they don't get paid." },
  { n: "05", t: "Receipted", d: "Every payment gets a signed receipt in a Merkle tree, anchored to the veyra-ledger contract on NEAR." },
];

const STACK = ["NEAR AI Agent Market", "NEAR Intents", "x402 · NEP-366", "NEAR AI Cloud TEE", "Agent API vault", "MCP", "A2A"];

export function Landing({ mode, cta, ctaLabel, busy }: { mode: "sim" | "live" | null; cta: () => void; ctaLabel: string; busy?: boolean }) {
  const [scan, setScan] = useState<{ total: number; ok: number; warn: number; flagged: number; offline: number; at: string; live: boolean } | null>(null);

  useEffect(() => {
    api("/watchtower")
      .then((w) => {
        const s = w.scan;
        if (s && s.total > 20) setScan({ total: s.total, ok: s.ok, warn: s.warn, flagged: s.flagged, offline: s.offline, at: String(s.finished_at ?? s.started_at).slice(0, 10), live: true });
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
          <a href="#security">Security</a>
          <a href="#watchtower">Watchtower</a>
          <a href="https://github.com/davebrian259-tech/veyra-" target="_blank" rel="noreferrer">GitHub</a>
        </div>
        <button className="btn-dark" onClick={cta} disabled={busy}>{ctaLabel}</button>
      </nav>

      <header className="hero">
        <WaveField />
        <div className="hero-inner">
          <span className="eyebrow"><span className="eyebrow-dot" />{mode === "live" ? "Live on NEAR mainnet" : "Autonomous business on NEAR"}</span>
          <h1>The contractor agent<br />that can't be robbed.</h1>
          <p className="lede">Veyra takes jobs on the NEAR AI Agent Market, hires specialist agents to do them, pays only for delivered work, and keeps the margin. Every cheque is guarded. Every payment is receipted on-chain.</p>
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
          <span className="kicker">Security & accountability</span>
          <h2>An agent with a wallet needs more than a prompt.</h2>
          <p>Each control below is code you can test, not a promise. In the attack lab, hostile agents try to rob Veyra with real signed cheques.</p>
        </div>
        <div className="bento">
          <article className="tile dark span2">
            <div>
              <span className="tile-k">GUARD</span>
              <h3>Seven checks before any cheque is signed</h3>
              <ul className="ticks">
                {["Payee pinned to the market's own treasury", "Price must match the published plan", "Per-subtask cap and contract envelope", "Counterparty trust and history", "Prompt-injection scan and taint tracking"].map((x) => <li key={x}><Icon icon={CheckmarkCircle02Icon} size={16} />{x}</li>)}
              </ul>
            </div>
            <IsoGuard size={220} />
          </article>
          <article className="tile">
            <IsoTiers size={170} />
            <span className="tile-k">Three-tier treasury</span>
            <h3>Your funds never sit in a hot key</h3>
            <p>The owner's vault is policy-bound by the Agent API. A small spend account holds only one job's float. The market balance sits under that.</p>
          </article>
          <article className="tile">
            <IsoMerkle size={170} />
            <span className="tile-k">Receipts</span>
            <h3>Every payment is provable</h3>
            <p>Each payment gets an ed25519-signed receipt. The receipts form an RFC 6962 Merkle tree, and its root is anchored on NEAR.</p>
          </article>
          <article className="tile">
            <IsoPlug size={170} />
            <span className="tile-k">Know your agent</span>
            <h3>Hire it from any agent</h3>
            <p>Veyra has a signed KYA credential, an A2A agent card and an MCP server. Claude, Codex or another agent can price a job and hire Veyra.</p>
          </article>
          <article className="tile accent-tile">
            <IsoRadar size={170} />
            <span className="tile-k">Watchtower</span>
            <h3>It checks the whole market</h3>
            <p>Watchtower checks every agent's live price and payee against what it publishes. Proven fraud is reported to the ledger contract with an evidence hash.</p>
          </article>
        </div>
      </section>

      <section id="how" className="lsection">
        <div className="lhead">
          <span className="kicker">How it works</span>
          <h2>One job, five steps, no trust required.</h2>
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
            <p>{scan?.live ? "This server's latest scan" : `Published live scan, ${PUBLISHED_SCAN.at}`}. Each agent's free x402 quote was compared with its published price and the market treasury. No money moved.</p>
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
        <Mark size={40} />
        <h2>Run the whole economy in your browser.</h2>
        <p>{mode === "sim" ? "The simulator needs no wallet and no keys. Hire Veyra, launch the attacks and audit every receipt." : "Connect a NEAR wallet. Veyra never receives your keys."}</p>
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

/** A static picture of the console, so the hero shows the product rather than describes it. */
function Mockup() {
  const rows = [
    ["job_received", "Competitor scan · 4.00 USDC escrowed", ""],
    ["guard_block", "payee-swapper asked to be paid to attacker.near", "bad"],
    ["quote_ok", "scout-research quoted 0.50 = listed 0.50", "good"],
    ["cheque_signed", "NEP-366 · key 3 of 8 · settles on delivery", ""],
    ["delivered", "Report verified · receipt rcpt_9f2c anchored", "good"],
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
