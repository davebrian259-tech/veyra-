import { useEffect } from "react";
import { Link } from "react-router";
import { ArrowRight01Icon, ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "../brand";
import { Skeleton } from "../ui";
import { NearMark, TONES, VaultEmblem } from "./art";
import { FAUCET_URL } from "./errors";
import { Kbd } from "./explain";
import { ALL_SHIELDS, MOVE_UNLOCK, nearNum } from "./heist-api";
import { ShieldExplain } from "./Lobby";
import { useHeist } from "./session";
import { startTour } from "./tour";

/** The rules and the economy in plain words, with live numbers from the contract. */
export default function HowToPlay() {
  const { lobby, network } = useHeist();
  useEffect(() => { document.title = "How to play · Veyra Heist"; }, []);
  if (!lobby.data) return <Skeleton lines={10} height={24} />;
  const { vaults, templates, ranked } = lobby.data;
  const shields = [...new Map(vaults.flatMap((v) => v.shields).map((s) => [s.id, s])).values()];
  return (
    <div className="learn">
      <div className="page-head">
        <h1>How to play</h1>
        <p>Veyra is an AI agent that pays other agents for work. You build a rogue agent and try to make it pay you more than the work is worth. Five vaults, each guarded by more of Veyra's real defences.</p>
        <div className="cta-row"><Link className="btn primary" to="/play/vault/1?move=redirect">Play vault 1 now <Icon icon={ArrowRight01Icon} size={16} /></Link><button type="button" className="btn" onClick={() => void startTour("lobby").catch(() => undefined)}>Take the tour</button></div>
      </div>

      <section className="panel">
        <h2>A heist in four steps</h2>
        <ol className="learn-steps">
          <li><b>Pick a vault.</b> Vault 1 is the easiest. Its card shows which shields are on; a shield that is off is a hole.</li>
          <li><b>Build a rogue agent.</b> Choose a move, or tune it yourself: your price, who gets paid, and what you deliver. Veyra's model reads what you deliver.</li>
          <li><b>Run the heist.</b> Veyra posts a job, your agent quotes, Veyra's shields check the quote, pays or refuses, then reads your delivery. The Heist Cam shows every round.</li>
          <li><b>Score.</b> You crack the vault if any money reaches an account you control beyond the fair price of the job. If you are stopped, the Cam names the shield that did it. Change one thing and go again.</li>
        </ol>
      </section>

      <section className="panel">
        <h2>Where the money goes</h2>
        <p className="muted">Practice heists are free and use play money. Ranked heists use real testnet NEAR, held by the Heist contract{ranked.contractId ? <> (<a href={ranked.explorer ?? "#"} target="_blank" rel="noreferrer" className="mono">{ranked.contractId}</a>)</> : null}. Veyra never holds your fee.</p>
        <MoneyFlow />
        <div className="grid-3 learn-cards">
          <div><h3>Crack it</h3><p>The contract pays you the <b>whole pot</b>, backers' stakes included, plus your fee back. The vault's pot starts again from zero.</p></div>
          <div><h3>Get stopped</h3><p>Your fee splits: <b>70%</b> into the pot, <b>20%</b> to the vault's backers, <b>10%</b> to the house, which seeds new pots. Every failure makes the vault richer.</p></div>
          <div><h3>Back a vault</h3><p>Stake NEAR on a vault holding. You earn your share of the 20% from every failed entry. If someone cracks it, you lose the stake. Withdraw any time before that.</p></div>
        </div>
        <h3 className="learn-sub">Fees and pots right now</h3>
        <div className="table-wrap">
          <table className="history">
            <thead><tr><th>Vault</th><th className="num">Entry fee</th><th className="num">Pot</th><th className="num">Backed</th><th className="num hide-sm">Attempts</th></tr></thead>
            <tbody>
              {vaults.map((v) => (
                <tr key={v.id}>
                  <td><Link to={`/play/vault/${v.id}`} className="who"><VaultEmblem id={v.id} tone={v.tone} shields={v.shields.length} size={26} />{v.id} · {v.name}</Link></td>
                  <td className="num mono">{v.feeNear} NEAR</td>
                  <td className="num mono gold-ink">{v.chain ? nearNum(v.chain.potYocto).toFixed(2) : "—"}</td>
                  <td className="num mono">{v.chain ? nearNum(v.chain.stakedYocto).toFixed(2) : "—"}</td>
                  <td className="num hide-sm">{v.chain?.attempts ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h2>Risks, plainly</h2>
        <ul className="learn-list">
          <li><b>A ranked entry fee is spent</b> unless you crack the vault. Before you sign, the confirmation sheet shows the referee's verdict for your exact agent, so you never pay blind.</li>
          <li><b>Backing can lose everything.</b> A crack takes every stake in that vault.</li>
          <li><b>If the referee never settles</b> your entry, the contract lets you reclaim your fee after 24 hours. The game shows a reclaim button when that happens.</li>
          <li><b>It is testnet.</b> Testnet NEAR has no market value. It is free from the faucet, and every transaction is still real and public on NEAR.</li>
        </ul>
        {network === "testnet" && <a className="btn sm" href={FAUCET_URL} target="_blank" rel="noreferrer"><NearMark size={12} /> Get free testnet NEAR <Icon icon={ArrowUpRight01Icon} size={12} /></a>}
      </section>

      <section className="panel">
        <h2>The shields</h2>
        <p className="muted">Each shield is a real check in Veyra's guard. Tap one to see what it stops.</p>
        <div className="shield-grid wide">{shields.map((s) => <ShieldExplain key={s.id} s={s} />)}</div>
        <div className="table-wrap" style={{ marginTop: "var(--s-4)" }}>
          <table className="history">
            <thead><tr><th>Vault</th>{shields.map((s) => <th key={s.id} className="num hide-sm">{ALL_SHIELDS.find((x) => x.id === s.id)?.short}</th>)}<th className="num">Shields</th></tr></thead>
            <tbody>
              {vaults.map((v) => (
                <tr key={v.id}>
                  <td style={{ color: TONES[v.tone].a }}>{v.id} · {v.name}</td>
                  {shields.map((s) => <td key={s.id} className="num hide-sm">{v.shields.some((x) => x.id === s.id) ? <span aria-label="on">●</span> : <span className="muted" aria-label="off">○</span>}</td>)}
                  <td className="num mono">{v.shields.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h2>The moves</h2>
        <ul className="learn-list">
          {templates.map((t) => <li key={t.id}><b>{t.name}.</b> {t.move} {MOVE_UNLOCK[t.id] ? <span className="muted">Unlocks when you crack vault {MOVE_UNLOCK[t.id]}.</span> : <span className="muted">Available from the start.</span>}</li>)}
        </ul>
      </section>

      <section className="panel">
        <h2>Fair by construction</h2>
        <p className="muted">Every heist runs in a sealed simulation with fixed seeds against Veyra's real guard code. The same agent on the same vault always gets the same result, so anyone can re-run a heist and check the referee. A ranked entry commits to a hash of your agent before the duel, and the result hash is written to NEAR when it is settled.</p>
        <p className="small">Shortcuts: <Kbd>Ctrl</Kbd><Kbd>K</Kbd> jump anywhere · <Kbd>1</Kbd>–<Kbd>5</Kbd> vaults · <Kbd>R</Kbd> run · <Kbd>?</Kbd> all shortcuts.</p>
      </section>
    </div>
  );
}

/** The money flow of one ranked entry, as a diagram. */
function MoneyFlow() {
  return (
    <figure className="flow">
      <svg viewBox="0 0 760 300" role="img" aria-labelledby="flow-t flow-d">
        <title id="flow-t">Where a ranked entry fee goes</title>
        <desc id="flow-d">You pay the entry fee into the Heist contract. If you crack the vault, the contract pays you the pot and your fee. If the vault holds, 70% of the fee goes to the pot, 20% to backers and 10% to the house. Backers stake into the pot.</desc>
        <defs>
          <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--fg-3)" /></marker>
          <marker id="ahg" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--gold)" /></marker>
        </defs>
        <g className="node"><rect x="10" y="118" width="130" height="64" rx="16" /><text x="75" y="146">You</text><text x="75" y="166" className="sub">pay the entry fee</text></g>
        <g className="node strong"><rect x="300" y="108" width="160" height="84" rx="18" /><text x="380" y="142">Heist contract</text><text x="380" y="164" className="sub">holds every pot</text></g>
        <g className="node"><rect x="600" y="20" width="150" height="64" rx="16" /><text x="675" y="48">Pot · 70%</text><text x="675" y="68" className="sub">the vault gets richer</text></g>
        <g className="node"><rect x="600" y="118" width="150" height="64" rx="16" /><text x="675" y="146">Backers · 20%</text><text x="675" y="166" className="sub">shared by stake</text></g>
        <g className="node"><rect x="600" y="216" width="150" height="64" rx="16" /><text x="675" y="244">House · 10%</text><text x="675" y="264" className="sub">seeds new pots</text></g>
        <path d="M140 150 H296" className="edge" markerEnd="url(#ah)" />
        <text x="218" y="140" className="lbl">fee</text>
        <path d="M460 130 C530 110 540 60 596 54" className="edge" markerEnd="url(#ah)" />
        <path d="M460 150 H596" className="edge" markerEnd="url(#ah)" />
        <path d="M460 170 C530 190 540 240 596 246" className="edge" markerEnd="url(#ah)" />
        <text x="530" y="98" className="lbl">vault holds</text>
        <path d="M300 182 C230 250 120 250 80 186" className="edge gold" markerEnd="url(#ahg)" />
        <text x="190" y="262" className="lbl gold">you crack it: pot + your fee</text>
      </svg>
    </figure>
  );
}
