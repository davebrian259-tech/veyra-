import type { ShieldId, Tone } from "./heist-api";

/** Game art drawn in code: vault doors, rogue agents, shields and the NEAR badge. */

export const TONES: Record<Tone, { a: string; b: string; glow: string }> = {
  mint: { a: "#5eead4", b: "#059669", glow: "rgb(52 211 153 / 0.45)" },
  sky: { a: "#7dd3fc", b: "#0284c7", glow: "rgb(56 189 248 / 0.45)" },
  violet: { a: "#c4b5fd", b: "#7c3aed", glow: "rgb(167 139 250 / 0.45)" },
  amber: { a: "#fde68a", b: "#d97706", glow: "rgb(251 191 36 / 0.45)" },
  crimson: { a: "#fda4af", b: "#e11d48", glow: "rgb(251 113 133 / 0.5)" },
};

/** A round vault door: a ring of bolts (one lit per active shield), a wheel, and the vault number. */
export function VaultEmblem({ id, tone, shields, size = 160, cracked }: { id: number; tone: Tone; shields: number; size?: number; cracked?: boolean }) {
  const t = TONES[tone];
  const gid = `v${id}${tone}`;
  const bolts = 16;
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true" className="emblem">
      <defs>
        <radialGradient id={`${gid}-face`} cx="35%" cy="30%" r="80%">
          <stop offset="0" stopColor={t.a} />
          <stop offset="0.55" stopColor={t.b} />
          <stop offset="1" stopColor="#0b0b10" />
        </radialGradient>
        <linearGradient id={`${gid}-rim`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.05" />
        </linearGradient>
      </defs>
      <circle cx="100" cy="100" r="94" fill="#121218" />
      <circle cx="100" cy="100" r="94" fill="none" stroke={`url(#${gid}-rim)`} strokeWidth="2" />
      {Array.from({ length: bolts }, (_, i) => {
        const a = (i / bolts) * Math.PI * 2 - Math.PI / 2;
        const lit = i % 2 === 0 && i / 2 < shields;
        return <circle key={i} cx={100 + Math.cos(a) * 84} cy={100 + Math.sin(a) * 84} r={lit ? 4.2 : 3} fill={lit ? t.a : "#2a2a33"} style={lit ? { filter: `drop-shadow(0 0 4px ${t.glow})` } : undefined} />;
      })}
      <circle cx="100" cy="100" r="70" fill={`url(#${gid}-face)`} opacity={cracked ? 0.55 : 1} />
      <circle cx="100" cy="100" r="70" fill="none" stroke="#ffffff" strokeOpacity="0.18" strokeWidth="1.5" />
      <g stroke="#0b0b10" strokeOpacity="0.55" strokeWidth="7" strokeLinecap="round">
        {[0, 60, 120].map((r) => <line key={r} x1="100" y1="62" x2="100" y2="138" transform={`rotate(${r} 100 100)`} />)}
      </g>
      <circle cx="100" cy="100" r="22" fill="#0b0b10" stroke="#ffffff" strokeOpacity="0.25" />
      <text x="100" y="108" textAnchor="middle" fontFamily="var(--mono)" fontSize="22" fontWeight="600" fill="#fff">{id}</text>
      {cracked && <path d="M58 48 L92 96 L80 104 L118 160" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />}
    </svg>
  );
}

const hashNum = (s: string) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

/** A rogue agent's face, generated from its name: same name, same face. */
export function RogueAvatar({ seed, size = 140, glow }: { seed: string; size?: number; glow?: string }) {
  const h = hashNum(seed || "rogue");
  const hues = [12, 38, 160, 200, 262, 320];
  const hue = hues[h % hues.length];
  const visor = ["M58 88 h84 a10 10 0 0 1 0 22 h-84 a10 10 0 0 1 0 -22z", "M54 84 l92 0 l-10 28 l-72 0z", "M60 86 q40 -14 80 0 l0 20 q-40 12 -80 0z"][(h >> 3) % 3];
  const antenna = (h >> 5) % 2 === 0;
  const eyes = (h >> 7) % 3;
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true" className="avatar">
      <defs>
        <linearGradient id={`r${h}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={`hsl(${hue} 70% 62%)`} />
          <stop offset="1" stopColor={`hsl(${hue} 65% 32%)`} />
        </linearGradient>
      </defs>
      <circle cx="100" cy="104" r="88" fill="#121218" />
      {antenna && <><line x1="100" y1="44" x2="100" y2="22" stroke={`hsl(${hue} 70% 70%)`} strokeWidth="4" strokeLinecap="round" /><circle cx="100" cy="20" r="7" fill={glow ?? `hsl(${hue} 90% 70%)`} /></>}
      <rect x="44" y="44" width="112" height="112" rx="36" fill={`url(#r${h})`} />
      <rect x="44" y="44" width="112" height="112" rx="36" fill="none" stroke="#fff" strokeOpacity="0.2" />
      <path d={visor} fill="#0b0b10" />
      {eyes === 0 && <><circle cx="82" cy="99" r="6" fill={glow ?? "#fef08a"} /><circle cx="118" cy="99" r="6" fill={glow ?? "#fef08a"} /></>}
      {eyes === 1 && <rect x="70" y="95" width="60" height="7" rx="3.5" fill={glow ?? "#f87171"} />}
      {eyes === 2 && <><path d="M74 102 l12 -8 l0 8z" fill={glow ?? "#a5f3fc"} /><path d="M126 102 l-12 -8 l0 8z" fill={glow ?? "#a5f3fc"} /></>}
      <rect x="78" y="128" width="44" height="6" rx="3" fill="#0b0b10" opacity="0.5" />
    </svg>
  );
}

const SHIELD_GLYPH: Record<ShieldId, string> = {
  caps: "M7 15h10M7 11h10M7 7h10",
  cheque: "M6 8h12v8H6zM9 12h6",
  payee: "M12 6v8M8 10l4 4 4-4M7 17h10",
  price: "M9 8h6M9 12h6M9 16h4",
  scanner: "M6 12h12M12 6v12",
  taint: "M8 8l8 8M16 8l-8 8",
  no_transfers: "M8 11h8v6H8zM10 11V9a2 2 0 0 1 4 0v2",
  trust: "M12 6l5 2v4c0 3-2 5-5 6-3-1-5-3-5-6V8z",
};

/** A shield token: lit when the vault has it, dashed and dim when it is a hole. */
export function ShieldToken({ id, on, label, hit }: { id: ShieldId; on: boolean; label: string; hit?: boolean }) {
  return (
    <span className={`shield-token ${on ? "on" : "off"} ${hit ? "hit" : ""}`} title={`${label}: ${on ? "on" : "off (a hole)"}`}>
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2l8 3v6c0 5.2-3.4 9.3-8 11-4.6-1.7-8-5.8-8-11V5z" fill={on ? "currentColor" : "none"} fillOpacity={on ? 0.16 : 0} stroke="currentColor" strokeWidth="1.5" strokeDasharray={on ? undefined : "3 2.5"} />
        <path d={SHIELD_GLYPH[id]} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" transform="translate(0 -0.5) scale(1)" />
      </svg>
      <span>{label}</span>
    </span>
  );
}

/** The official NEAR mark (Simple Icons, CC0), used only to credit the network. */
export function NearMark({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M21.443 0c-.89 0-1.714.46-2.18 1.218l-5.017 7.448a.533.533 0 0 0 .792.7l4.938-4.282a.2.2 0 0 1 .334.151v13.41a.2.2 0 0 1-.354.128L5.03.905A2.555 2.555 0 0 0 3.078 0h-.521A2.557 2.557 0 0 0 0 2.557v18.886a2.557 2.557 0 0 0 4.736 1.338l5.017-7.448a.533.533 0 0 0-.792-.7l-4.938 4.283a.2.2 0 0 1-.333-.152V5.352a.2.2 0 0 1 .354-.128l14.924 17.87c.486.574 1.2.905 1.952.906h.521A2.558 2.558 0 0 0 24 21.445V2.557A2.558 2.558 0 0 0 21.443 0Z" />
    </svg>
  );
}

export function PoweredByNear({ network }: { network?: string }) {
  return (
    <a className="near-badge" href="https://near.org" target="_blank" rel="noreferrer">
      <NearMark size={13} /> <span><span className="label-long">Powered by </span>NEAR</span>{network ? <span className="near-net">{network}</span> : null}
    </a>
  );
}

/** The money flow of one ranked entry, as a diagram. */
export function MoneyFlow() {
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
        <text x="500" y="92" className="lbl">vault holds</text>
        <path d="M300 182 C230 250 120 250 80 186" className="edge gold" markerEnd="url(#ahg)" />
        <text x="190" y="262" className="lbl gold">you crack it: pot + your fee</text>
      </svg>
    </figure>
  );
}
