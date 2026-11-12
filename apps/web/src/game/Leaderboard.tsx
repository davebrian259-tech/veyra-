import { Link } from "react-router";
import { motion } from "motion/react";
import { useApi, when } from "../lib/data";
import { Empty, ErrorNote, Skeleton } from "../ui";
import { RogueAvatar } from "./art";
import { usdc } from "./heist-api";

interface Row { rank: number; player: string; account: string | null; bestVault: number; lootAtomic: string; runs: number; cracks: number; rankedRuns: number; firstCrackAt: string | null }

/** Ranked by the highest vault cracked, then loot, then who got there first. */
export default function Leaderboard() {
  const b = useApi<{ players: Row[] }>("/heist/leaderboard", { every: 15_000 });
  if (b.error) return <ErrorNote message={b.error} retry={b.reload} />;
  if (!b.data) return <Skeleton lines={8} height={28} />;
  const rows = b.data.players;
  if (!rows.length) return <section className="panel"><Empty title="Nobody on the board yet" action={<Link className="btn primary" to="/play/vault/1">Crack vault 1</Link>}>Your first crack puts you at the top.</Empty></section>;
  const [first, second, third] = rows;
  return (
    <div className="stack-lg">
      <div className="podium">
        {[second, first, third].map((p, i) => p ? (
          <motion.div key={p.player} className={`step ${i === 1 ? "first" : ""}`} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 * i }}>
            <span className="place">#{p.rank}</span>
            <div style={{ display: "grid", placeItems: "center", marginTop: "var(--s-2)" }}><RogueAvatar seed={p.player} size={i === 1 ? 96 : 72} /></div>
            <b>{p.player}</b>
            <span className="best">{p.bestVault ? `vault ${p.bestVault} cracked` : "no cracks yet"}</span>
          </motion.div>
        ) : <div key={i} />)}
      </div>
      <section className="panel">
        <div className="panel-head"><h2>Leaderboard</h2><span className="link">Best vault, then loot, then first to get there</span></div>
        <div className="table-wrap">
          <table className="history">
            <thead><tr><th>#</th><th>Player</th><th className="num">Best vault</th><th className="num">Loot</th><th className="num">Cracks</th><th className="num hide-sm">Runs</th><th className="hide-sm">First crack</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.player}>
                  <td className="mono">{r.rank}</td>
                  <td><span className="who"><RogueAvatar seed={r.player} size={26} /><span>{r.player}</span>{r.rankedRuns ? <span className="chip gold">ranked</span> : null}</span></td>
                  <td className="num mono">{r.bestVault || "—"}</td>
                  <td className="num mono">{usdc(r.lootAtomic)}</td>
                  <td className="num">{r.cracks}</td>
                  <td className="num hide-sm">{r.runs}</td>
                  <td className="small hide-sm" style={{ whiteSpace: "nowrap" }}>{r.firstCrackAt ? when(r.firstCrackAt) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
