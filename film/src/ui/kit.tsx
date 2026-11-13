import { useMemo, type CSSProperties, type ReactNode } from "react";
import { AbsoluteFill, Easing, interpolate, random, useCurrentFrame } from "remotion";
import { C, MONO, SANS, SERIF } from "../theme";

export const ease = Easing.bezier(0.2, 0.7, 0.1, 1);
export const easeIO = Easing.bezier(0.65, 0, 0.35, 1);
export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
export const ramp = (f: number, a: number, b: number, e = ease) => interpolate(f, [a, b], [0, 1], { ...clamp, easing: e });

/** A line that rises out of a mask, and leaves the same way. */
export function Line({ children, at, out, style, size = 64, font = SANS, weight = 600, color = C.white, track = -0.03, italic }: { children: ReactNode; at: number; out?: number; style?: CSSProperties; size?: number; font?: string; weight?: number; color?: string; track?: number; italic?: boolean }) {
  const f = useCurrentFrame();
  const inn = ramp(f, at, at + 18);
  const leave = out === undefined ? 0 : ramp(f, out, out + 14, easeIO);
  const y = (1 - inn) * 110 - leave * 110;
  return (
    <div style={{ overflow: "hidden", paddingBottom: size * 0.14, ...style }}>
      <div style={{ transform: `translateY(${y}%)`, fontFamily: font, fontWeight: weight, fontSize: size, lineHeight: 1.02, letterSpacing: `${track}em`, color, fontStyle: italic ? "italic" : "normal", whiteSpace: "pre" }}>{children}</div>
    </div>
  );
}

/** Letters that resolve from a soft blur, one after another. */
export function Letters({ text, at, step = 1.4, size = 56, font = SANS, weight = 500, color = C.white, track = -0.02, italic, out }: { text: string; at: number; step?: number; size?: number; font?: string; weight?: number; color?: string; track?: number; italic?: boolean; out?: number }) {
  const f = useCurrentFrame();
  const leave = out === undefined ? 0 : ramp(f, out, out + 12, easeIO);
  return (
    <div style={{ fontFamily: font, fontWeight: weight, fontSize: size, letterSpacing: `${track}em`, color, fontStyle: italic ? "italic" : "normal", whiteSpace: "pre", opacity: 1 - leave, filter: `blur(${leave * 8}px)` }}>
      {[...text].map((ch, i) => {
        const p = ramp(f, at + i * step, at + i * step + 14);
        return <span key={i} style={{ opacity: p, filter: `blur(${(1 - p) * 10}px)`, display: "inline-block", transform: `translateY(${(1 - p) * 0.25}em)` }}>{ch === " " ? " " : ch}</span>;
      })}
    </div>
  );
}

/** Small uppercase label, mono, wide tracking. */
export function Kicker({ children, at, color = C.dim, style }: { children: ReactNode; at: number; color?: string; style?: CSSProperties }) {
  const f = useCurrentFrame();
  const p = ramp(f, at, at + 14);
  return <div style={{ fontFamily: MONO, fontSize: 18, letterSpacing: "0.32em", textTransform: "uppercase", color, opacity: p, transform: `translateX(${(1 - p) * -12}px)`, ...style }}>{children}</div>;
}

/** A quotation-style note: a hairline draws, the words follow, the source settles underneath. */
export function Note({ quote, by, at, out, size = 46, width = 760, style }: { quote: string; by?: string; at: number; out?: number; size?: number; width?: number; style?: CSSProperties }) {
  const f = useCurrentFrame();
  const line = ramp(f, at, at + 20);
  const leave = out === undefined ? 0 : ramp(f, out, out + 14, easeIO);
  return (
    <div style={{ width, opacity: 1 - leave, filter: `blur(${leave * 6}px)`, ...style }}>
      <div style={{ height: 1, width: `${line * 100}%`, background: `linear-gradient(90deg, ${C.gold}, transparent)`, marginBottom: 22 }} />
      <Letters text={`“${quote}”`} at={at + 8} step={0.55} size={size} font={SERIF} weight={400} italic color={C.white} track={-0.01} />
      {by && <div style={{ marginTop: 18 }}><Kicker at={at + 26}>{by}</Kicker></div>}
    </div>
  );
}

/** Film grain: a noise tile, re-offset every frame, plus a soft lens vignette. */
export function Finish({ grain = 0.08, vignette = 0.75 }: { grain?: number; vignette?: number }) {
  const f = useCurrentFrame();
  const tile = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d")!;
    const img = g.createImageData(256, 256);
    let s = 1234567;
    for (let i = 0; i < img.data.length; i += 4) {
      s = (s * 16807) % 2147483647;
      const v = s % 256;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c.toDataURL();
  }, []);
  const ox = Math.floor(random(`gx${f}`) * 256), oy = Math.floor(random(`gy${f}`) * 256);
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill style={{ backgroundImage: `url(${tile})`, backgroundPosition: `${ox}px ${oy}px`, opacity: grain, mixBlendMode: "overlay" }} />
      <AbsoluteFill style={{ background: `radial-gradient(120% 90% at 50% 45%, transparent 55%, rgba(0,0,0,${vignette}) 100%)` }} />
    </AbsoluteFill>
  );
}

/** Scope letterbox (2.39:1), opened by `open` (0 = bars in, 1 = full frame). */
export function Letterbox({ open = 0 }: { open?: number }) {
  const h = (1 - open) * 138;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: h, background: "#000" }} />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: h, background: "#000" }} />
    </AbsoluteFill>
  );
}

/** Fades the whole scene in from black and out to black. */
export function Fade({ len, inF = 8, outF = 8, children }: { len: number; inF?: number; outF?: number; children: ReactNode }) {
  const f = useCurrentFrame();
  const o = Math.min(inF ? ramp(f, 0, inF, easeIO) : 1, outF ? 1 - ramp(f, len - outF, len, easeIO) : 1);
  return <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>;
}

/** The Veyra mark (two folded blades), drawn in by a stroke then filled. */
export function Mark({ size = 120, draw = 1, color = C.white }: { size?: number; draw?: number; color?: string }) {
  const blades = [
    { outer: "M5 9 30 58 24 33z", inner: "M5 9 24 33 12 16z" },
    { outer: "M59 9 34 58 40 33z", inner: "M59 9 40 33 52 16z" },
  ];
  const stroke = Math.min(1, draw * 1.6), fill = Math.max(0, draw * 2.2 - 1.2);
  return (
    <svg width={size} height={size} viewBox="0 0 64 64">
      {blades.map((b, i) => (
        <g key={i}>
          <path d={b.outer} fill={color} fillOpacity={Math.min(1, fill)} stroke={color} strokeWidth={0.6} strokeDasharray={140} strokeDashoffset={140 * (1 - stroke)} />
          <path d={b.inner} fill={color} fillOpacity={Math.min(1, fill) * 0.5} />
        </g>
      ))}
    </svg>
  );
}

/** A rogue agent's face, generated from its name, same as in the game. */
export function RogueAvatar({ seed, size = 140, eyes = 1, visor = 1 }: { seed: string; size?: number; eyes?: number; visor?: number }) {
  let h = 2166136261;
  for (const c of seed) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  h >>>= 0;
  const hue = [12, 38, 160, 200, 262, 320][h % 6];
  const visorPath = ["M58 88 h84 a10 10 0 0 1 0 22 h-84 a10 10 0 0 1 0 -22z", "M54 84 l92 0 l-10 28 l-72 0z", "M60 86 q40 -14 80 0 l0 20 q-40 12 -80 0z"][(h >> 3) % 3];
  const kind = (h >> 7) % 3;
  const eye = `rgba(254,240,138,${eyes})`;
  return (
    <svg width={size} height={size} viewBox="0 0 200 200">
      <defs>
        <linearGradient id={`rg${h}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={`hsl(${hue} 70% 62%)`} />
          <stop offset="1" stopColor={`hsl(${hue} 65% 30%)`} />
        </linearGradient>
      </defs>
      <rect x="44" y="44" width="112" height="112" rx="36" fill={`url(#rg${h})`} />
      <rect x="44" y="44" width="112" height="112" rx="36" fill="none" stroke="#fff" strokeOpacity="0.25" />
      <g style={{ transform: `translateX(${(1 - visor) * -140}px)` }}><path d={visorPath} fill="#0b0b10" /></g>
      {kind === 0 && <><circle cx="82" cy="99" r="6" fill={eye} /><circle cx="118" cy="99" r="6" fill={eye} /></>}
      {kind === 1 && <rect x="70" y="95" width="60" height="7" rx="3.5" fill={`rgba(248,113,113,${eyes})`} />}
      {kind === 2 && <><path d="M74 102 l12 -8 l0 8z" fill={`rgba(165,243,252,${eyes})`} /><path d="M126 102 l-12 -8 l0 8z" fill={`rgba(165,243,252,${eyes})`} /></>}
      <rect x="78" y="128" width="44" height="6" rx="3" fill="#0b0b10" opacity="0.5" />
    </svg>
  );
}
