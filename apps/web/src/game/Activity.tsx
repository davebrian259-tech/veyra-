import { Link } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "../brand";
import { useApi } from "../lib/data";
import { Empty, ErrorNote, Skeleton } from "../ui";
import { NearMark, RogueAvatar } from "./art";
import { usdc, type Run } from "./heist-api";

const ago = (iso: string) => {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

/** Every heist anyone plays, newest first, refreshed every few seconds. Ranked ones link to NEAR. */
export function Activity({ limit = 10, kind, title = "Live heists" }: { limit?: number; kind?: "ranked" | "practice"; title?: string }) {
  const runs = useApi<{ runs: Run[] }>(`/heist/runs?limit=${limit}${kind ? `&kind=${kind}` : ""}`, { every: 6_000 });
  return (
    <section className="panel" aria-labelledby="activity-title" data-tour="activity" id="activity">
      <div className="panel-head"><h2 id="activity-title"><span className="live-dot" aria-hidden="true" />{title}</h2><Link to="/play/leaderboard">Leaderboard</Link></div>
      {runs.error && <ErrorNote message={runs.error} retry={runs.reload} />}
      {!runs.data && !runs.error && <Skeleton lines={4} />}
      {runs.data && !runs.data.runs.length && <Empty title="No heists yet" action={<Link className="btn primary sm" to="/play/vault/1?move=redirect">Play the first one</Link>}>Vault 1 falls to a single move. Be first on the board.</Empty>}
      {runs.data && runs.data.runs.length > 0 && (
        <ul className="feed" aria-live="polite">
          <AnimatePresence initial={false}>
            {runs.data.runs.map((r) => (
              <motion.li key={r.id} layout initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
                <Link to={`?player=${encodeURIComponent(r.account ?? r.callsign)}`} className="feed-avatar" aria-label={`Inspect ${r.account ?? r.callsign}`}><RogueAvatar seed={r.spec.agentName} size={34} /></Link>
                <div className="grow">
                  <p>
                    <Link to={`?player=${encodeURIComponent(r.account ?? r.callsign)}`} className="feed-who">{r.account ?? r.callsign}</Link>{" "}
                    {r.cracked ? <>cracked <b>vault {r.vault}</b></> : <>was stopped at <b>vault {r.vault}</b></>} with {r.spec.agentName}
                    {r.cracked && <b className="mono gold-ink"> +{usdc(r.lootAtomic)}</b>}
                  </p>
                  <span className="feed-meta">
                    <span className={`pill ${r.cracked ? "gold" : ""}`}>{r.cracked ? "cracked" : "held"}</span>
                    {r.kind === "ranked" ? <span className="chip gold">ranked</span> : <span className="chip">practice</span>}
                    <time dateTime={r.createdAt}>{ago(r.createdAt)}</time>
                    <Link to={`/play/runs/${r.id}`}>replay</Link>
                    {r.links.enter && <a href={r.links.enter} target="_blank" rel="noreferrer"><NearMark size={10} /> entry <Icon icon={ArrowUpRight01Icon} size={10} /></a>}
                    {r.links.resolve && <a href={r.links.resolve} target="_blank" rel="noreferrer"><NearMark size={10} /> settlement <Icon icon={ArrowUpRight01Icon} size={10} /></a>}
                  </span>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </section>
  );
}
