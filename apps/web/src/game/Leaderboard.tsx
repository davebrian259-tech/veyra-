import { useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { motion } from "motion/react";
import { useApi, when } from "../lib/data";
import { Empty, ErrorNote, Segmented, Skeleton } from "../ui";
import { RogueAvatar } from "./art";
import { Explain } from "./explain";
import { usdc } from "./heist-api";
import { useHeist } from "./session";

interface Row { rank: number; player: string; account: string | null; bestVault: number; lootAtomic: string; runs: number; cracks: number; rankedRuns: number; firstCrackAt: string | null }
type Filter = "all" | "ranked" | "cracked";

/** Ranked by the highest vault cracked, then loot, then who got there first. Filters live in the URL. */
export default function Leaderboard() {
  const h = useHeist();
  const b = useApi<{ players: Row[] }>("/heist/leaderboard?limit=200", { every: 15_000 });
  const [params, setParams] = useSearchParams();
  const filter = (params.get("show") as Filter) ?? "all";
  const q = params.get("q") ?? "";
  const set = (k: string, v: string) => setParams((p) => { const n = new URLSearchParams(p); if (!v || v === "all") n.delete(k); else n.set(k, v); return n; }, { replace: true });
  useEffect(() => { document.title = "Leaderboard · Veyra Heist"; }, []);
  const rows = useMemo(() => (b.data?.players ?? []).filter((r) => (filter === "ranked" ? r.rankedRuns > 0 : filter === "cracked" ? r.cracks > 0 : true) && (!q || r.player.toLowerCase().includes(q.toLowerCase()))), [b.data, filter, q]);
  const meRow = b.data?.players.find((r) => r.player === h.account || r.player === h.progress.callsign);

  if (b.error) return <ErrorNote message={b.error} retry={b.reload} />;
  if (!b.data) return <Skeleton lines={8} height={28} />;
  const inspect = (p: string) => `?${new URLSearchParams({ ...Object.fromEntries(params), player: p })}`;
  const [first, second, third] = b.data.players;

  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1>Leaderboard</h1>
        <p>Ranked by the highest vault cracked, then loot, then who got there first. Select a player to inspect their agents.</p>
      </div>

      <div className={`me-rank ${meRow ? "" : "empty"}`} role="status">
        <RogueAvatar seed={h.account ?? h.progress.callsign} size={40} />
        {meRow ? (
          <>
            <div className="grow"><b>You are #{meRow.rank}</b><span className="small muted"> of {b.data.players.length} · {meRow.player}</span></div>
            <div className="me-stats"><span><b className="mono">{meRow.bestVault || "—"}</b> best vault</span><span><b className="mono gold-ink">{usdc(meRow.lootAtomic)}</b> loot</span></div>
            <Link className="btn sm" to={inspect(meRow.player)}>Your agents</Link>
          </>
        ) : (
          <>
            <div className="grow"><b>You are not on the board yet.</b><span className="small muted"> One crack puts you on it.</span></div>
            <Link className="btn primary sm" to="/play/vault/1?move=redirect">Crack vault 1</Link>
          </>
        )}
      </div>

      {b.data.players.length >= 3 && (
        <div className="podium">
          {[second, first, third].map((p, i) => (
            <motion.div key={p.player} className={`step ${i === 1 ? "first" : ""}`} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 * i }}>
              <Link to={inspect(p.player)} className="podium-link">
                <span className="place">#{p.rank}</span>
                <div style={{ display: "grid", placeItems: "center", marginTop: "var(--s-2)" }}><RogueAvatar seed={p.player} size={i === 1 ? 96 : 72} /></div>
                <b>{p.player}</b>
                <span className="best">{p.bestVault ? `vault ${p.bestVault} cracked` : "no cracks yet"}</span>
              </Link>
            </motion.div>
          ))}
        </div>
      )}

      <section className="panel">
        <div className="filters">
          <Segmented label="Show" value={filter} onChange={(v) => set("show", v)} options={[{ value: "all", label: "Everyone" }, { value: "ranked", label: "Ranked players" }, { value: "cracked", label: "Has a crack" }]} />
          <div className="field search"><label htmlFor="lb-q" className="sr-only">Find a player</label><input id="lb-q" type="search" placeholder="Find a player" value={q} onChange={(e) => set("q", e.target.value)} /></div>
        </div>
        {!rows.length ? (
          <Empty title={b.data.players.length ? "No players match" : "Nobody on the board yet"} action={b.data.players.length ? <button className="btn sm" onClick={() => setParams({}, { replace: true })}>Clear filters</button> : <Link className="btn primary sm" to="/play/vault/1?move=redirect">Crack vault 1</Link>}>
            {b.data.players.length ? "Try another name or filter." : "Your first crack puts you at the top."}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="history">
              <thead><tr><th>#</th><th>Player</th><th className="num">Best vault</th><th className="num"><Explain title="Loot" what="Money a player's agents took from vaults: play money in practice, scored USDC in ranked heists." how="Sum over every crack.">Loot</Explain></th><th className="num">Cracks</th><th className="num hide-sm">Heists</th><th className="hide-sm">First crack</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.player} className={r === meRow ? "is-me" : ""}>
                    <td className="mono">{r.rank}</td>
                    <td><Link to={inspect(r.player)} className="who"><RogueAvatar seed={r.player} size={26} /><span>{r.player}</span>{r === meRow && <span className="chip next">you</span>}{r.rankedRuns ? <span className="chip gold">ranked</span> : null}</Link></td>
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
        )}
      </section>
    </div>
  );
}
