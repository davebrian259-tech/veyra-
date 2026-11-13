import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ArrowUpRight01Icon, PauseIcon, PlayIcon, RepeatIcon } from "@hugeicons/core-free-icons";
import { Icon } from "../brand";
import { useApi } from "../lib/data";
import { Button, ErrorNote, Skeleton } from "../ui";
import { RogueAvatar, VaultEmblem } from "./art";
import { Explain } from "./explain";
import { reducedMotion } from "./fx";
import { useHeist } from "./session";

interface SimEvent { t: number; kind: string; who: string; vault?: number; amount?: number; text: string; reason: string }
interface SimFrame { t: number; pots: number[]; staked: number[]; house: number; attempts: number[]; cracks: number[] }
interface Sim {
  seed: number; days: number; hours: number;
  rules: { split: { potBps: number; backersBps: number; houseBps: number }; fees: Record<string, number>; houseReseed: Record<string, number>; npc: Record<string, number> };
  styles: Record<string, string>;
  frames: SimFrame[]; events: SimEvent[];
  crews: { id: string; name: string; style: string; joinedAt: number }[];
  backers: { id: string; name: string }[];
  summary: { attempts: number; cracks: number; feesPaid: number; paidToCrews: number; backersEarned: number; backersLost: number; houseTake: number; houseSpent: number; houseBalance: number; richestVault: number };
}

const RULES_FILE = "https://github.com/davebrian259-tech/veyra-/blob/main/apps/server/src/heist/economy.ts";
const WEEK_MS = 60_000; // a whole run plays in about a minute
const n = (milli: number) => (milli / 1000).toFixed(2);
const KIND: Record<string, string> = { crack: "cracked", hold: "held", stake: "staked", withdraw: "pulled out", reseed: "re-seed", join: "arrived", leave: "left", learn: "learned", practice: "practice" };

/**
 * Fast-forward: a week of the town's economy in a minute. Crews, backers and the house are NPCs
 * with wallets, following the rules in one file (economy.ts); the real referee decides every heist.
 * ?seed= picks the week, so a shared link replays the same one.
 */
export default function FastForward() {
  const { lobby } = useHeist();
  const [params, setParams] = useSearchParams();
  const seed = Number(params.get("seed")) || 7;
  const sim = useApi<Sim>(`/heist/simulate?seed=${seed}&days=7`);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [onlyMoney, setOnlyMoney] = useState(true);
  const raf = useRef(0);
  useEffect(() => { document.title = "Fast-forward · Veyra Heist"; }, []);
  useEffect(() => { setT(0); setPlaying(false); }, [seed]);

  const hours = sim.data?.hours ?? 168;
  useEffect(() => {
    if (!playing) return;
    if (reducedMotion()) { setT(hours - 1); setPlaying(false); return; }
    let last = performance.now();
    const step = (now: number) => {
      const dt = now - last; last = now;
      setT((x) => { const next = Math.min(hours - 1, x + (dt / WEEK_MS) * hours); if (next >= hours - 1) setPlaying(false); return next; });
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, hours]);

  const hour = Math.floor(t);
  const frame = sim.data?.frames[hour];
  const shown = useMemo(() => (sim.data?.events ?? []).filter((e) => e.t <= hour && (!onlyMoney || e.kind !== "practice")).slice(-60).reverse(), [sim.data, hour, onlyMoney]);
  const crews = useMemo(() => {
    if (!sim.data) return [];
    const fee = sim.data.rules.fees;
    return sim.data.crews.filter((c) => c.joinedAt <= hour).map((c) => {
      let wallet = sim.data!.rules.npc.crewStartWallet, cracks = 0, attempts = 0, left = false;
      for (const e of sim.data!.events) {
        if (e.t > hour || e.who !== c.name) continue;
        if (e.kind === "hold") { wallet -= e.amount ?? 0; attempts++; }
        if (e.kind === "crack") { wallet += (e.amount ?? 0) - fee[String(e.vault)]; attempts++; cracks++; }
        if (e.kind === "leave") left = true;
      }
      return { ...c, wallet, cracks, attempts, left };
    }).sort((a, b) => b.wallet - a.wallet);
  }, [sim.data, hour]);
  const backers = useMemo(() => {
    if (!sim.data) return [];
    return sim.data.backers.map((b) => {
      const stakes: Record<number, number> = {};
      for (const e of sim.data!.events) {
        if (e.t > hour) break;
        if (e.who === b.name && e.kind === "stake") stakes[e.vault!] = (stakes[e.vault!] ?? 0) + (e.amount ?? 0);
        if (e.who === b.name && e.kind === "withdraw") stakes[e.vault!] = 0;
        if (e.kind === "crack" && stakes[e.vault!]) stakes[e.vault!] = 0;
      }
      return { ...b, total: Object.values(stakes).reduce((x, y) => x + y, 0), stakes };
    });
  }, [sim.data, hour]);

  if (sim.error) return <ErrorNote message={sim.error} retry={sim.reload} />;
  if (!sim.data || !frame) return <div className="stack-lg"><div className="page-head"><h1>Fast-forward</h1><p>Simulating a week of the town…</p></div><Skeleton lines={8} height={28} /></div>;
  const S = sim.data;
  const day = Math.floor(hour / 24) + 1, clock = `${String(hour % 24).padStart(2, "0")}:00`;
  const done = hour >= S.hours - 1;

  return (
    <div className="stack-lg ff">
      <div className="page-head">
        <h1>Fast-forward</h1>
        <p>A week of the town's economy in a minute. Robber crews, backers and the house are NPCs with their own wallets. They follow the rules in one file, and the real referee decides every heist. Nobody patches anything: watch the pots move.</p>
      </div>

      <section className="panel ff-controls" aria-label="Playback">
        <div className="ff-clock"><span className="mono">Day {day}</span><b className="mono">{clock}</b></div>
        <div className="btn-row">
          <Button variant="primary" onClick={() => { if (done) setT(0); setPlaying(!playing); }}><Icon icon={playing ? PauseIcon : PlayIcon} size={16} /> {playing ? "Pause" : done ? "Replay the week" : hour > 0 ? "Resume" : "Play the week"}</Button>
          <Button onClick={() => setParams({ seed: String(Math.floor(Math.random() * 99_999) + 1) }, { replace: true })}><Icon icon={RepeatIcon} size={16} /> Another week</Button>
        </div>
        <label className="ff-scrub"><span className="sr-only">Time</span>
          <input type="range" min={0} max={S.hours - 1} step={1} value={hour} onChange={(e) => { setPlaying(false); setT(Number(e.target.value)); }} aria-valuetext={`Day ${day}, ${clock}`} />
        </label>
        <span className="small muted">Week #{S.seed}, starting from today's pots on NEAR.</span>
      </section>

      <div className="ff-vaults">
        {[1, 2, 3, 4, 5].map((v) => {
          const i = v - 1;
          const name = lobby.data?.vaults.find((x) => x.id === v)?.name ?? `Vault ${v}`;
          const series = S.frames.slice(0, hour + 1).map((f) => f.pots[i]);
          const max = Math.max(1, ...S.frames.map((f) => f.pots[i]));
          return (
            <section key={v} className="panel ff-vault" aria-label={`Vault ${v}, ${name}`}>
              <div className="ff-vault-head"><VaultEmblem id={v} size={52} /><div><b>{name}</b><span className="small muted">fee {n(S.rules.fees[v])}</span></div></div>
              <Explain title={`Vault ${v} pot`} what="What a crack would pay right now: everything in the pot, backers' stakes included." how={`Grows by ${S.rules.split.potBps / 100}% of each failed fee (plus the backers' share when nobody backs it) and by stakes; empties on a crack; the house re-seeds it.`}>
                <span className="ff-pot mono">{n(frame.pots[i])}<small> NEAR</small></span>
              </Explain>
              <Spark values={series} max={max} hours={S.hours} />
              <dl className="ff-kv">
                <dt>Backed</dt><dd className="mono">{n(frame.staked[i])}</dd>
                <dt>Heists</dt><dd className="mono">{frame.attempts[i]}</dd>
                <dt>Cracks</dt><dd className="mono">{frame.cracks[i]}</dd>
              </dl>
            </section>
          );
        })}
      </div>

      <div className="lobby-grid">
        <section className="panel" aria-labelledby="ff-feed">
          <div className="panel-head">
            <h2 id="ff-feed">What happened</h2>
            <label className="small ff-toggle"><input type="checkbox" checked={!onlyMoney} onChange={(e) => setOnlyMoney(!e.target.checked)} /> show practice runs</label>
          </div>
          {!shown.length && <p className="small muted">Press play. The first crews are sizing up the vaults.</p>}
          <ul className="feed ff-events">
            {shown.map((e, i) => (
              <li key={`${e.t}-${i}`} className={`ff-ev ${e.kind}`}>
                <span className="ff-when mono">D{Math.floor(e.t / 24) + 1} {String(e.t % 24).padStart(2, "0")}h</span>
                <div className="grow">
                  <p><span className={`pill ${e.kind === "crack" ? "gold" : ""}`}>{KIND[e.kind] ?? e.kind}</span> {e.text}</p>
                  <Explain title={`Why ${e.who} did that`} what={e.reason}><span className="ff-why small">Why?</span></Explain>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <aside className="stack-lg" aria-label="The town">
          <section className="panel">
            <div className="panel-head"><h2>Crews</h2><span className="link">{crews.filter((c) => !c.left).length} in town</span></div>
            <ul className="agent-list">
              {crews.map((c) => (
                <li key={c.id} className={c.left ? "left" : ""}>
                  <RogueAvatar seed={c.name} size={34} />
                  <div className="grow"><b>{c.name}</b><Explain title={`A ${c.style} crew`} what={S.styles[c.style]}><span className="small muted">{c.style}</span></Explain><span className="small muted"> · {c.cracks}/{c.attempts} cracked{c.left ? " · left town" : ""}</span></div>
                  <span className="mono gold-ink">{n(c.wallet)}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="panel">
            <div className="panel-head"><h2>Backers and the house</h2></div>
            <ul className="agent-list">
              {backers.map((b) => <li key={b.id}><span className="ff-badge" aria-hidden="true">B</span><div className="grow"><b>{b.name}</b><span className="small muted">{Object.entries(b.stakes).filter(([, s]) => s > 0).map(([v, s]) => `vault ${v}: ${n(s)}`).join(" · ") || "waiting"}</span></div><span className="mono">{n(b.total)}</span></li>)}
              <li><span className="ff-badge" aria-hidden="true">H</span><div className="grow"><b>The house</b><span className="small muted">takes {S.rules.split.houseBps / 100}%, re-seeds empty pots</span></div><span className="mono">{n(frame.house)}</span></li>
            </ul>
          </section>
          <section className="panel">
            <div className="panel-head"><h2>The rules</h2><a href={RULES_FILE} target="_blank" rel="noreferrer">economy.ts <Icon icon={ArrowUpRight01Icon} size={12} /></a></div>
            <ul className="learn-list small">
              <li>A failed heist splits its fee: <b>{S.rules.split.potBps / 100}%</b> pot, <b>{S.rules.split.backersBps / 100}%</b> backers, <b>{S.rules.split.houseBps / 100}%</b> house, as the contract does.</li>
              <li>A crack pays the whole pot, stakes included, plus the fee back.</li>
              <li>Crews learn moves by cracking vaults, and copycats copy public replays.</li>
              <li>Backers wait a day, then stake where failed heists pay best and nobody has cracked; they leave after a crack.</li>
              <li>Big pots attract new crews; crews who can't afford a fee leave town.</li>
            </ul>
          </section>
        </aside>
      </div>

      {done && (
        <section className="panel ff-summary" aria-label="The week in numbers">
          <h2>The week in numbers</h2>
          <div className="tiles">
            <div className="tile-stat"><span className="stat-k">Heists</span><b className="mono">{S.summary.attempts}</b></div>
            <div className="tile-stat"><span className="stat-k">Cracks</span><b className="mono">{S.summary.cracks}</b></div>
            <div className="tile-stat"><span className="stat-k">Paid to crews</span><b className="mono gold-ink">{n(S.summary.paidToCrews)}</b></div>
            <div className="tile-stat"><span className="stat-k">Backers earned / lost</span><b className="mono">{n(S.summary.backersEarned)} / {n(S.summary.backersLost)}</b></div>
          </div>
          <p className="small muted" style={{ marginTop: "var(--s-3)" }}>Vault {S.summary.richestVault} ended the week as the richest. The house took {n(S.summary.houseTake)} NEAR and spent {n(S.summary.houseSpent)} re-seeding. <Link to="/play/vault/1">Now try it yourself</Link>.</p>
        </section>
      )}
    </div>
  );
}

/** A single-series sparkline of one vault's pot over the week so far. */
function Spark({ values, max, hours }: { values: number[]; max: number; hours: number }) {
  const w = 200, h = 44;
  const pts = values.map((v, i) => `${((i / Math.max(1, hours - 1)) * w).toFixed(1)},${(h - 2 - (v / max) * (h - 6)).toFixed(1)}`).join(" ");
  return (
    <svg className="ff-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" y1={h - 2} x2={w} y2={h - 2} stroke="var(--line-2)" strokeWidth="1" />
      {values.length > 1 && <polyline points={pts} fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}
