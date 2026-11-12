/**
 * Line-art illustrations, drawn in code so they follow the theme (currentColor, --accent).
 * Isometric shapes use a 2:1 projection: a square of width w becomes a rhombus w wide, w/2 tall.
 */

const rhombus = (cx: number, cy: number, w: number) => `M${cx} ${cy - w / 4} L${cx + w / 2} ${cy} L${cx} ${cy + w / 4} L${cx - w / 2} ${cy} Z`;
/** A flat isometric slab: top face plus the two visible sides. */
function Slab({ cx, cy, w, t, fill = "var(--art-fill, var(--bg))", accent }: { cx: number; cy: number; w: number; t: number; fill?: string; accent?: boolean }) {
  const h = w / 4;
  return (
    <g>
      <path d={`M${cx - w / 2} ${cy} L${cx} ${cy + h} L${cx} ${cy + h + t} L${cx - w / 2} ${cy + t} Z`} fill={fill} />
      <path d={`M${cx + w / 2} ${cy} L${cx} ${cy + h} L${cx} ${cy + h + t} L${cx + w / 2} ${cy + t} Z`} fill={fill} />
      <path d={rhombus(cx, cy, w)} fill={accent ? "var(--accent)" : fill} fillOpacity={accent ? 0.14 : 1} />
      <path d={`${rhombus(cx, cy, w)} M${cx - w / 2} ${cy} v${t} L${cx} ${cy + h + t} L${cx + w / 2} ${cy + t} v${-t} M${cx} ${cy + h} v${t}`} fill="none" />
    </g>
  );
}

const frame = { fill: "none", stroke: "currentColor", strokeWidth: 1.2, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };

/** Three stacked slabs: vault, spend account, market balance. */
export function IsoTiers({ size = 180 }: { size?: number }) {
  return (
    <svg viewBox="0 0 200 170" width={size} height={size * 0.85} {...frame} aria-hidden="true">
      <Slab cx={100} cy={120} w={150} t={12} />
      <Slab cx={100} cy={84} w={112} t={12} />
      <Slab cx={100} cy={50} w={74} t={12} accent />
      <path d="M100 20v-12M94 14l6-6 6 6" stroke="var(--accent)" />
    </svg>
  );
}

/** A cube with a keyhole: GUARD. */
export function IsoGuard({ size = 180 }: { size?: number }) {
  const cx = 100, top = 40, w = 110, t = 70, h = w / 4;
  return (
    <svg viewBox="0 0 200 170" width={size} height={size * 0.85} {...frame} aria-hidden="true">
      <path d={`M${cx - w / 2} ${top + h} L${cx} ${top + 2 * h} L${cx} ${top + 2 * h + t} L${cx - w / 2} ${top + h + t} Z`} fill="var(--art-fill, var(--bg))" />
      <path d={`M${cx + w / 2} ${top + h} L${cx} ${top + 2 * h} L${cx} ${top + 2 * h + t} L${cx + w / 2} ${top + h + t} Z`} fill="var(--art-fill, var(--bg))" />
      <path d={rhombus(cx, top + h, w)} fill="var(--art-fill, var(--bg))" />
      {[0.25, 0.5, 0.75].map((f) => <path key={f} d={`M${cx - w / 2} ${top + h + t * f} L${cx} ${top + 2 * h + t * f}`} strokeOpacity={0.35} />)}
      <g transform={`translate(${cx + w / 4} ${top + 1.5 * h + t / 2}) skewY(-26.565)`}>
        <circle r="9" fill="var(--accent)" fillOpacity={0.14} stroke="var(--accent)" />
        <path d="M0 -3v8" stroke="var(--accent)" strokeWidth={2} />
      </g>
    </svg>
  );
}

/** Concentric rings and a sweep: Watchtower. */
export function IsoRadar({ size = 180 }: { size?: number }) {
  return (
    <svg viewBox="0 0 200 170" width={size} height={size * 0.85} {...frame} aria-hidden="true">
      {[150, 112, 74, 36].map((w, i) => <path key={w} d={rhombus(100, 95, w)} strokeOpacity={0.25 + i * 0.2} />)}
      <path d="M100 95 L160 80" stroke="var(--accent)" />
      <path d="M100 95 L160 80 A60 30 0 0 0 150 70 Z" fill="var(--accent)" fillOpacity={0.12} stroke="none" />
      <path d="M100 95v-70" strokeDasharray="3 4" />
      <circle cx="100" cy="22" r="5" fill="var(--art-fill, var(--bg))" />
      {[[62, 100], [140, 108], [118, 82], [78, 84]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="3.2" fill={i === 1 ? "var(--bad)" : "currentColor"} stroke="none" />)}
    </svg>
  );
}

/** A Merkle tree resting on a slab: receipts anchored on NEAR. */
export function IsoMerkle({ size = 180 }: { size?: number }) {
  const leaves = [40, 80, 120, 160];
  return (
    <svg viewBox="0 0 200 170" width={size} height={size * 0.85} {...frame} aria-hidden="true">
      <Slab cx={100} cy={128} w={170} t={10} />
      {leaves.map((x) => <rect key={x} x={x - 9} y={92} width="18" height="18" rx="4" fill="var(--art-fill, var(--bg))" />)}
      {[60, 140].map((x) => <rect key={x} x={x - 10} y={56} width="20" height="20" rx="5" fill="var(--art-fill, var(--bg))" />)}
      <rect x="88" y="16" width="24" height="24" rx="6" fill="var(--accent)" fillOpacity={0.14} stroke="var(--accent)" />
      <path d="M40 92 V84 H80 V92 M60 84 V76 M120 92 V84 H160 V92 M140 84 V76 M60 56 V48 H140 V56 M100 48 V40" />
    </svg>
  );
}

/** Interlocking rings: MCP / A2A interoperability. */
export function IsoPlug({ size = 180 }: { size?: number }) {
  return (
    <svg viewBox="0 0 200 170" width={size} height={size * 0.85} {...frame} aria-hidden="true">
      <ellipse cx="78" cy="85" rx="48" ry="24" fill="var(--art-fill, var(--bg))" />
      <ellipse cx="122" cy="85" rx="48" ry="24" />
      <ellipse cx="100" cy="85" rx="10" ry="5" fill="var(--accent)" fillOpacity={0.3} stroke="var(--accent)" />
      <path d="M78 61v-30M122 61v-30M70 31h16M114 31h16" strokeOpacity={0.6} />
      <path d="M78 109v30M122 109v30" strokeDasharray="3 4" strokeOpacity={0.5} />
    </svg>
  );
}

/** The soft ribbon behind the hero: many thin sine lines with a slow phase drift. */
export function WaveField() {
  const lines = Array.from({ length: 46 }, (_, i) => {
    const pts: string[] = [];
    for (let x = -40; x <= 1480; x += 40) {
      const k = i / 46;
      const y = 300 + Math.sin(x / 260 + k * 2.4) * (120 - k * 60) + Math.cos(x / 520 - k * 3) * 60 + k * 90 - 40;
      pts.push(`${x},${y.toFixed(1)}`);
    }
    return `M${pts.join(" L")}`;
  });
  return (
    <svg className="wavefield" viewBox="0 0 1440 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="wf" x1="0" x2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0" />
          <stop offset="0.45" stopColor="currentColor" stopOpacity="0.5" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.05" />
        </linearGradient>
      </defs>
      {lines.map((d, i) => <path key={i} d={d} fill="none" stroke="url(#wf)" strokeWidth={0.8} opacity={0.18 + (i % 5) * 0.06} />)}
    </svg>
  );
}

export type DotKind = "ok" | "warn" | "flagged" | "offline";
/** One dot per agent: the whole market at a glance. */
export function DotMatrix({ counts, cols = 32 }: { counts: Record<DotKind, number>; cols?: number }) {
  const order: DotKind[] = ["flagged", "warn", "ok", "offline"];
  const dots = order.flatMap((k) => Array.from({ length: counts[k] ?? 0 }, () => k));
  const rows = Math.ceil(dots.length / cols) || 1;
  const gap = 10;
  const r = 3;
  // One path per kind keeps the DOM small (4 nodes for 667 agents) and the animation cheap.
  const paths = order.map((k) => ({
    k,
    d: dots.map((kind, i) => (kind === k ? `M${(i % cols) * gap + gap / 2 - r} ${Math.floor(i / cols) * gap + gap / 2}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 -${r * 2} 0` : "")).join(""),
  }));
  return (
    <svg className="dotmatrix" style={{ maxWidth: cols * 16 }} viewBox={`0 0 ${cols * gap} ${rows * gap}`} role="img" aria-label={`${dots.length} agents: ${order.map((k) => `${counts[k] ?? 0} ${k}`).join(", ")}`}>
      {paths.map((p) => p.d && <path key={p.k} d={p.d} className={`dot-${p.k}`} />)}
    </svg>
  );
}
