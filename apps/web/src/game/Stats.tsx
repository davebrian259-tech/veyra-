import { useEffect, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useApi } from "../lib/data";
import { Empty, ErrorNote, Skeleton } from "../ui";
import { Activity } from "./Activity";
import { Explain } from "./explain";
import { nearNum, usdc, type Series } from "./heist-api";
import { useHeist } from "./session";

/*
 * Chart colours, validated with the dataviz palette checker against the panel surface #14141b
 * (lightness band, CVD separation, normal-vision floor and 3:1 contrast all pass).
 * Gold is money and cracks; graphite is everything else. Single-series charts use one colour.
 */
const GOLD = "#b8891a";
const BLUE = "#7a7a85"; // graphite: "held" and everything that is not money
const axis = { stroke: "var(--fg-3)", fontSize: 12, tickLine: false, axisLine: false } as const;

/** The game's economy and play over time: pots, heists per day, crack rates, what stops players, your loot. */
export default function Stats() {
  const { lobby, me } = useHeist();
  const s = useApi<Series>("/heist/series", { every: 20_000 });
  useEffect(() => { document.title = "Stats · Veyra Heist"; }, []);
  if (s.error) return <ErrorNote message={s.error} retry={s.reload} />;
  if (!s.data || !lobby.data) return <Skeleton lines={10} height={24} />;
  const vaults = lobby.data.vaults;
  const pots = vaults.map((v) => {
    const pot = v.chain ? nearNum(v.chain.potYocto) : 0, backed = v.chain ? nearNum(v.chain.stakedYocto) : 0;
    return { name: `${v.id} · ${v.name}`, short: `V${v.id}`, fees: +(pot - backed).toFixed(3), backed: +backed.toFixed(3), total: +pot.toFixed(2) };
  });
  const totalPot = pots.reduce((t, p) => t + p.total, 0);
  const rate = s.data.vaults.map((v) => ({ short: `V${v.vault}`, name: `${v.vault} · ${v.name}`, rate: v.runs ? Math.round((v.cracks / v.runs) * 100) : 0, runs: v.runs, cracks: v.cracks }));
  const mine = [...(me?.recent ?? [])].reverse();
  let acc = 0;
  const loot = mine.map((r, i) => { acc += r.cracked ? Number(r.lootAtomic) / 1e6 : 0; return { n: i + 1, loot: +acc.toFixed(2), label: `Heist ${i + 1}: vault ${r.vault}, ${r.cracked ? "cracked" : "held"}` }; });
  const totals = s.data.days.reduce((t, d) => ({ runs: t.runs + d.runs, cracks: t.cracks + d.cracks }), { runs: 0, cracks: 0 });

  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1>Stats</h1>
        <p>Where the money sits, how the vaults are holding, and how you are doing. Pots are read from the contract on NEAR; heists from this server.</p>
      </div>

      <div className="tiles">
        <Tile label="In all pots" value={`${totalPot.toFixed(2)} NEAR`} explain={{ what: "Testnet NEAR held by the Heist contract across all five vaults.", how: "Sum of each vault's pot, read from the contract's get_vaults view." }} gold />
        <Tile label="Heists, last 14 days" value={String(totals.runs)} explain={{ what: "Practice and ranked heists played on this server." }} />
        <Tile label="Crack rate" value={totals.runs ? `${Math.round((totals.cracks / totals.runs) * 100)}%` : "—"} explain={{ what: "Share of heists that took money from the vault.", how: "Cracks divided by heists, last 14 days." }} />
        <Tile label="Your loot" value={`${usdc(me?.lootAtomic ?? 0)} USDC`} explain={{ what: "Play money your agents have taken in practice, plus USDC scored in ranked heists." }} gold />
      </div>

      <div className="grid-2">
        <ChartPanel title="Pots by vault" note="NEAR, from the contract" legend={[["Fees and seed", GOLD], ["Backed by stakers", BLUE]]}
          table={<Table head={["Vault", "Fees and seed", "Backed", "Pot"]} rows={pots.map((p) => [p.name, p.fees.toFixed(3), p.backed.toFixed(3), p.total.toFixed(2)])} />}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart maxBarSize={64} data={pots} margin={{ top: 20, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--line)" />
              <XAxis dataKey="short" {...axis} />
              <YAxis {...axis} width={44} />
              <Tooltip content={<Tip unit="NEAR" />} cursor={{ fill: "rgb(255 255 255 / 0.04)" }} />
              <Bar dataKey="fees" name="Fees and seed" stackId="p" fill={GOLD} stroke="var(--bg-2)" strokeWidth={2} />
              <Bar dataKey="backed" name="Backed" stackId="p" fill={BLUE} stroke="var(--bg-2)" strokeWidth={2} radius={[4, 4, 0, 0]}>
                <LabelList dataKey="total" position="top" fill="var(--fg-2)" fontSize={12} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel title="Heists per day" note="Last 14 days" legend={[["Cracked", GOLD], ["Held", BLUE]]}
          table={<Table head={["Day", "Cracked", "Held", "Ranked"]} rows={s.data.days.map((d) => [d.day, String(d.cracks), String(d.held), String(d.ranked)])} />}>
          {s.data.days.length ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart maxBarSize={48} data={s.data.days.map((d) => ({ ...d, short: d.day.slice(5) }))} margin={{ top: 12, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--line)" />
                <XAxis dataKey="short" {...axis} />
                <YAxis {...axis} width={44} allowDecimals={false} />
                <Tooltip content={<Tip unit="heists" />} cursor={{ fill: "rgb(255 255 255 / 0.04)" }} />
                <Bar dataKey="cracks" name="Cracked" stackId="d" fill={GOLD} stroke="var(--bg-2)" strokeWidth={2} />
                <Bar dataKey="held" name="Held" stackId="d" fill={BLUE} stroke="var(--bg-2)" strokeWidth={2} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <Empty title="No heists in the last 14 days" />}
        </ChartPanel>

        <ChartPanel title="Crack rate by vault" note="Share of heists that took money" table={<Table head={["Vault", "Heists", "Cracks", "Rate"]} rows={rate.map((r) => [r.name, String(r.runs), String(r.cracks), `${r.rate}%`])} />}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart maxBarSize={64} data={rate} margin={{ top: 20, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--line)" />
              <XAxis dataKey="short" {...axis} />
              <YAxis {...axis} width={48} domain={[0, 100]} unit="%" />
              <Tooltip content={<Tip unit="%" />} cursor={{ fill: "rgb(255 255 255 / 0.04)" }} />
              <Bar dataKey="rate" name="Crack rate" fill={BLUE} radius={[4, 4, 0, 0]}>
                <LabelList dataKey="rate" position="top" fill="var(--fg-2)" fontSize={12} formatter={(v: unknown) => `${v}%`} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel title="What stops heists" note="The shield that held, across every failed heist" table={<Table head={["Shield", "Heists stopped"]} rows={s.data.stoppers.map((x) => [x.name, String(x.held)])} />}>
          {s.data.stoppers.length ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={s.data.stoppers} layout="vertical" margin={{ top: 4, right: 28, left: 8, bottom: 0 }}>
                <XAxis type="number" {...axis} allowDecimals={false} hide />
                <YAxis type="category" dataKey="name" {...axis} width={120} />
                <Tooltip content={<Tip unit="heists" />} cursor={{ fill: "rgb(255 255 255 / 0.04)" }} />
                <Bar dataKey="held" name="Stopped" fill={BLUE} radius={[0, 4, 4, 0]} barSize={18}>
                  <LabelList dataKey="held" position="right" fill="var(--fg-2)" fontSize={12} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <Empty title="Nothing stopped yet" />}
        </ChartPanel>

        <ChartPanel title="Your loot over your heists" note={me ? `${me.player} · cumulative USDC` : "Play a heist to start"} table={<Table head={["Heist", "Cumulative loot"]} rows={loot.map((l) => [l.label, l.loot.toFixed(2)])} />}>
          {loot.length > 1 ? (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={loot} margin={{ top: 12, right: 12, left: -12, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--line)" />
                <XAxis dataKey="n" {...axis} />
                <YAxis {...axis} width={44} />
                <Tooltip content={<Tip unit="USDC" />} cursor={{ stroke: "var(--fg-4)" }} />
                <Line type="monotone" dataKey="loot" name="Loot" stroke={GOLD} strokeWidth={2} dot={{ r: 4, fill: GOLD, stroke: "var(--bg-2)", strokeWidth: 2 }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : <Empty title="Not enough heists yet">Play two or more heists to see your curve.</Empty>}
        </ChartPanel>
      </div>

      <Activity limit={25} title="Every heist" />
    </div>
  );
}

function Tile({ label, value, explain, gold }: { label: string; value: string; explain: { what: string; how?: string }; gold?: boolean }) {
  return (
    <div className="tile-stat">
      <Explain title={label} what={explain.what} how={explain.how}><span className="stat-k">{label}</span></Explain>
      <b className={`mono ${gold ? "gold-ink" : ""}`}>{value}</b>
    </div>
  );
}

function ChartPanel({ title, note, legend, table, children }: { title: string; note: string; legend?: [string, string][]; table: ReactNode; children: ReactNode }) {
  return (
    <section className="panel chart-panel" aria-label={title}>
      <div className="panel-head"><h2>{title}</h2><span className="link">{note}</span></div>
      {legend && <div className="legend-row">{legend.map(([l, c]) => <span key={l}><i style={{ background: c }} />{l}</span>)}</div>}
      <div aria-hidden="true">{children}</div>
      <details className="disclosure"><summary>Show as a table</summary>{table}</details>
    </section>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="table-wrap">
      <table className="history"><thead><tr>{head.map((h, i) => <th key={h} className={i ? "num" : ""}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={j ? "num mono" : ""}>{c}</td>)}</tr>)}</tbody></table>
    </div>
  );
}

function Tip({ active, payload, label, unit }: { active?: boolean; payload?: { name: string; value: number; color?: string; fill?: string; stroke?: string; payload?: { name?: string; label?: string } }[]; label?: string | number; unit: string }) {
  if (!active || !payload?.length) return null;
  const title = payload[0].payload?.name ?? payload[0].payload?.label ?? label;
  return (
    <div className="chart-tip">
      <b>{title}</b>
      {payload.map((p) => <span key={p.name}><i style={{ background: p.fill ?? p.stroke ?? p.color }} />{p.name}: <b className="mono">{p.value}</b> {unit === "%" ? "" : unit}{unit === "%" ? "%" : ""}</span>)}
    </div>
  );
}
