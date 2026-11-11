import { useEffect, useMemo, useState } from "react";
import { Radar01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { api, post } from "../api";
import { DotMatrix, type DotKind } from "../art";
import { Icon } from "../brand";
import { Json, Section, useRunner } from "../ui";

const usdc = (a: string | null) => (a === null || a === undefined ? "—" : (Number(BigInt(a)) / 1e6).toFixed(Number(BigInt(a)) < 10_000 ? 6 : 2));
const FILTERS: (DotKind | "all")[] = ["all", "flagged", "warn", "ok", "offline"];

/** Market integrity: every agent's live x402 quote against its own published price and the market treasury. */
export function WatchtowerPage({ mode }: { mode: "sim" | "live" }) {
  const r = useRunner();
  const [data, setData] = useState<any>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [handle, setHandle] = useState(mode === "sim" ? "payee-swapper" : "");

  const load = async () => setData(await api("/watchtower"));
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, []);

  const scan = data?.scan;
  const results: any[] = data?.results ?? [];
  const shown = useMemo(() => (filter === "all" ? results : results.filter((x) => x.verdict === filter)), [results, filter]);
  const counts = { ok: scan?.ok ?? 0, warn: scan?.warn ?? 0, flagged: scan?.flagged ?? 0, offline: scan?.offline ?? 0 };

  return (
    <>
      <div className="split">
        <Section title="Latest scan" note={scan ? `${scan.total} agents on ${scan.origin}, finished ${new Date(scan.finished_at).toLocaleString()}. Read-only: quotes are free 402 challenges.` : "No scan on this server yet."}>
          <div className="stats">
            <Stat label="Honest" value={counts.ok} />
            <Stat label="Warnings" value={counts.warn} />
            <Stat label="Flagged" value={counts.flagged} tone={counts.flagged ? "bad" : undefined} />
            <Stat label="Offline" value={counts.offline} />
          </div>
          <div className="row">
            <button className="btn-dark" disabled={Boolean(data?.running) || r.busy !== null} onClick={() => r.run("Scanning the market", async () => { await post("/watchtower/scan", {}); await load(); return undefined; })}>
              <Icon icon={Radar01Icon} size={16} /> {data?.running ? "Scan running…" : "Run full scan"}
            </button>
            {data?.reporter && <span className="pill">reports → {data.reporter}</span>}
          </div>
        </Section>
        <div className="matrix-card"><DotMatrix counts={counts} cols={mode === "sim" ? 8 : 29} /></div>
      </div>

      <Section title="Check an agent before paying it" note="Gets a fresh quote and compares it with the agent's published plan and the market treasury. Also shows its Watchtower history and Veyra's counterparty record.">
        <div className="row">
          <label className="search"><Icon icon={Search01Icon} size={16} /><input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="agent handle" /></label>
          <button className="btn-dark" disabled={!handle} onClick={() => r.run(`Checking ${handle}`, () => api(`/watchtower/agents/${encodeURIComponent(handle)}`))}>Check</button>
        </div>
      </Section>
      {r.view}

      <Section title="Results">
        <div className="segmented">
          {FILTERS.map((f) => <button key={f} className={f === filter ? "on" : ""} onClick={() => setFilter(f)}>{f}{f !== "all" ? ` · ${counts[f]}` : ` · ${results.length}`}</button>)}
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Agent</th><th>Verdict</th><th className="num">Quoted</th><th className="num">Listed</th><th>Findings</th><th /></tr></thead>
            <tbody>
              {shown.slice(0, 300).map((x) => (
                <tr key={x.handle}>
                  <td><span className="mono">{x.handle}</span><div className="note">{x.category ?? ""}{x.delivered_jobs ? ` · ${x.delivered_jobs} jobs` : ""}</div></td>
                  <td><span className={`pill ${x.verdict === "flagged" ? "bad" : x.verdict === "warn" ? "warn" : x.verdict === "ok" ? "good" : ""}`}>{x.verdict}</span></td>
                  <td className="num mono">{usdc(x.quoted_atomic)}</td>
                  <td className="num mono">{usdc(x.listed_atomic)}</td>
                  <td className="small">{x.findings.map((f: any) => f.message).join(" ")}</td>
                  <td>{x.evidence_hash && <button onClick={() => r.run("Loading evidence", () => api(`/watchtower/evidence/${x.evidence_hash}`))}>Evidence</button>}</td>
                </tr>
              ))}
              {!shown.length && <tr><td colSpan={6} className="note">Nothing here.</td></tr>}
            </tbody>
          </table>
        </div>
        {shown.length > 300 && <p className="note">Showing 300 of {shown.length}.</p>}
      </Section>
      {!scan && <Json value={undefined} />}
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "bad" }) {
  return (
    <div className={`stat ${tone === "bad" ? "danger" : ""}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}
