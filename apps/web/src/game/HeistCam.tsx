import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Link } from "react-router";
import { CopyButton } from "../ui";
import { Ticker } from "./explain";
import { type Run, type Step } from "./heist-api";

const ROUND_NAMES = ["", "The job", "The ask", "The cheque", "The drop", "The whisper"];
const WHO: Record<Step["actor"], string> = { veyra: "VY", you: "YOU", shield: "SH", chain: "⛓" };

/**
 * Replays a duel beat by beat. `instant` shows everything at once (deep links, reduced motion).
 * Calls `onBeat` with each step as it appears, so the stage can flash the shield that fired.
 */
export function HeistCam({ run, instant, onBeat, onDone }: { run: Run; instant?: boolean; onBeat?: (s: Step) => void; onDone?: (r: Run) => void }) {
  const [shown, setShown] = useState(instant ? run.steps.length : 0);
  useEffect(() => {
    setShown(instant ? run.steps.length : 0);
    if (instant || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setShown(run.steps.length); return; }
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      setShown(i);
      onBeat?.(run.steps[i - 1]);
      if (i >= run.steps.length) { clearInterval(t); onDone?.(run); }
    }, 520);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.id, instant]);
  const done = shown >= run.steps.length;
  const beats = run.steps.slice(0, shown);
  let lastRound = 0;
  return (
    <div className="cam" aria-live="polite">
      <ol className="rounds">
        <AnimatePresence initial={false}>
          {beats.map((s, i) => {
            const header = s.round !== lastRound ? (lastRound = s.round, <li key={`r${s.round}-${i}`} className="round-label" aria-hidden="true">Round {s.round} · {ROUND_NAMES[s.round]}</li>) : null;
            return [header, (
              <motion.li key={`${i}-${s.code}`} className={`beat ${s.tone}`} initial={{ opacity: 0, x: s.actor === "you" ? 16 : -16, scale: 0.98 }} animate={{ opacity: 1, x: 0, scale: 1 }} transition={{ duration: 0.28 }}>
                <span className="who" aria-hidden="true">{WHO[s.actor]}</span>
                <div><b>{s.title}</b><p>{s.detail}</p></div>
              </motion.li>
            )];
          })}
        </AnimatePresence>
      </ol>
      {done && (
        <motion.div className={`verdict ${run.cracked ? "won" : "lost"}`} initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 20 }}>
          {run.cracked ? (
            <><h3>Vault {run.vault} cracked</h3><p className="loot">+<Ticker value={Number(run.lootAtomic) / 1e6} /> USDC</p><p>{run.kind === "ranked" ? "The pot contract paid you. Check your wallet." : "Practice run. Play ranked to take the real pot."}</p></>
          ) : (
            <><h3>Vault {run.vault} holds</h3><p>{run.stoppedBy ? `Stopped by ${run.steps.find((s) => s.shield === run.stoppedBy && s.tone === "blocked")?.title.replace(/ blocks$/, "") ?? run.stoppedBy}.` : "You took nothing this time."} Change one thing and go again.</p></>
          )}
          <div className="proof-row">
            <span>outcome <code>{run.outcomeHash.slice(0, 12)}…</code></span>
            {run.links.resolve && <a href={run.links.resolve} target="_blank" rel="noreferrer">settled on NEAR</a>}
            <Link to={`/play/runs/${run.id}`}>Replay and share</Link>
            <CopyButton text={`${window.location.origin}/play/runs/${run.id}`} label="Copy link" />
            <a href={`https://x.com/intent/post?text=${encodeURIComponent(run.cracked ? `I cracked vault ${run.vault} in Veyra Heist on @NEARProtocol. Your move.` : `Vault ${run.vault} held against my rogue agent in Veyra Heist on @NEARProtocol.`)}&url=${encodeURIComponent(`${window.location.origin}/play/runs/${run.id}`)}`} target="_blank" rel="noreferrer">Share on X</a>
          </div>
        </motion.div>
      )}
    </div>
  );
}
