import type { CSSProperties, ReactNode } from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { ease, easeIO, ramp } from "../ui/kit";

/** The white film's palette. */
export const W = {
  pearl: "#f5f4f1", paper: "#fbfaf8", ink: "#0b0b0c", grey: "#6e6c68", rule: "#dcd9d2", red: "#e11d48",
  tone: ["#10b981", "#2563eb", "#7c3aed", "#f0a500", "#e11d48"],
};
export const SANS = "'Geist Variable', ui-sans-serif, system-ui";
export const MONO = "'Geist Mono Variable', ui-monospace, monospace";

/**
 * A big statement. Each word rises out of its own mask on a short stagger and the whole line
 * leaves upward. `lines` are rendered one under the other; wrap words in [] to colour them.
 */
export function Big({ lines, at, out, size = 150, color = W.ink, accent = W.red, weight = 760, align = "left", style, track = -0.045, stagger = 3 }: { lines: string[]; at: number; out?: number; size?: number; color?: string; accent?: string; weight?: number; align?: "left" | "center" | "right"; style?: CSSProperties; track?: number; stagger?: number }) {
  const f = useCurrentFrame();
  const leave = out === undefined ? 0 : ramp(f, out, out + 12, easeIO);
  if (f < at - 1 || leave >= 1) return null;
  let k = 0;
  return (
    <div style={{ position: "absolute", display: "flex", flexDirection: "column", alignItems: align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start", opacity: 1 - leave, transform: `translateY(${-leave * 60}px)`, filter: leave > 0 ? `blur(${leave * 8}px)` : undefined, ...style }}>
      {lines.map((line, li) => (
        <div key={li} style={{ display: "flex", gap: size * 0.24, justifyContent: align === "center" ? "center" : "flex-start" }}>
          {line.split(" ").map((word, wi) => {
            const i = k++;
            const p = ramp(f, at + i * stagger, at + i * stagger + 14);
            const hot = word.startsWith("[");
            const text = word.replace(/[[\]]/g, "");
            return (
              <div key={wi} style={{ overflow: "hidden", paddingBottom: size * 0.12, marginBottom: -size * 0.1 }}>
                <div style={{ transform: `translateY(${(1 - p) * 105}%)`, fontFamily: SANS, fontWeight: weight, fontSize: size, lineHeight: 1, letterSpacing: `${track}em`, color: hot ? accent : color, whiteSpace: "pre" }}>{text}</div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** A small caps label that slides in: section marks, units, sources. Never below 44px. */
export function Tag({ children, at, out, size = 48, color = W.grey, style, dot }: { children: ReactNode; at: number; out?: number; size?: number; color?: string; style?: CSSProperties; dot?: string }) {
  const f = useCurrentFrame();
  const p = ramp(f, at, at + 12);
  const leave = out === undefined ? 0 : ramp(f, out, out + 10, easeIO);
  if (f < at - 1 || leave >= 1) return null;
  return (
    <div style={{ position: "absolute", display: "flex", alignItems: "center", gap: 18, fontFamily: SANS, fontWeight: 650, fontSize: size, letterSpacing: "0.04em", textTransform: "uppercase", color, opacity: p * (1 - leave), transform: `translateX(${(1 - p) * -30}px)`, ...style }}>
      {dot && <span style={{ width: size * 0.42, height: size * 0.42, borderRadius: 99, background: dot }} />}
      {children}
    </div>
  );
}

/**
 * A line of dialogue between the two AIs: who is speaking, then what they said, large enough
 * for a phone. The rogue speaks from the left in black; the guard answers in the vault's colour.
 */
export function Say({ who, text, at, out, tone = W.ink, style }: { who: "rogue" | "guard"; text: string; at: number; out: number; tone?: string; style?: CSSProperties }) {
  const f = useCurrentFrame();
  const p = ramp(f, at - 4, at + 10);
  const leave = ramp(f, out, out + 10, easeIO);
  if (f < at - 5 || leave >= 1) return null;
  const chars = Math.floor(interpolate(f, [at, at + Math.max(8, text.length * 0.9)], [0, text.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const rogue = who === "rogue";
  return (
    <div style={{ position: "absolute", left: 120, bottom: 110, maxWidth: 1500, opacity: p * (1 - leave), transform: `translateY(${(1 - p) * 30 - leave * 20}px)`, ...style }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 14, padding: "10px 22px 10px 16px", borderRadius: 99, background: rogue ? W.ink : tone, color: "#fff", fontFamily: MONO, fontWeight: 600, fontSize: 44, letterSpacing: "0.02em" }}>
        <span style={{ width: 18, height: 18, borderRadius: 99, background: rogue ? W.red : "#fff" }} />
        {rogue ? "ROGUE AI" : "GUARD AI"}
      </div>
      <div style={{ marginTop: 18, fontFamily: SANS, fontWeight: 680, fontSize: 84, lineHeight: 1.05, letterSpacing: "-0.035em", color: W.ink }}>
        “{text.slice(0, chars)}{chars < text.length ? "▍" : "”"}
      </div>
    </div>
  );
}

/** A white flash that hides a cut. */
export function Flash({ at, len = 10, color = "#fff" }: { at: number; len?: number; color?: string }) {
  const f = useCurrentFrame();
  const o = interpolate(f, [at - 2, at, at + len], [0, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
  if (o <= 0) return null;
  return <div style={{ position: "absolute", inset: 0, background: color, opacity: o }} />;
}

/** A stamp that lands with a little overshoot: CRACKED, HOLDS. */
export function Stamp({ text, at, out, color, size = 120, style }: { text: string; at: number; out?: number; color: string; size?: number; style?: CSSProperties }) {
  const f = useCurrentFrame();
  if (f < at || (out !== undefined && f > out + 10)) return null;
  const p = ramp(f, at, at + 8);
  const s = 1.6 - 0.6 * p + Math.sin(Math.min(1, (f - at) / 10) * Math.PI) * 0.04;
  const leave = out === undefined ? 0 : ramp(f, out, out + 10, easeIO);
  return (
    <div style={{ position: "absolute", transform: `scale(${s}) rotate(-4deg)`, opacity: p * (1 - leave), border: `${size * 0.07}px solid ${color}`, color, padding: `${size * 0.08}px ${size * 0.22}px`, borderRadius: size * 0.12, fontFamily: SANS, fontWeight: 820, fontSize: size, letterSpacing: "-0.02em", lineHeight: 1, background: "rgba(255,255,255,0.88)", ...style }}>
      {text}
    </div>
  );
}

/** A pearl wash from the left, so type always sits on a clean field over 3D. */
export function Wash({ o = 1, to = 62 }: { o?: number; to?: number }) {
  return <div style={{ position: "absolute", inset: 0, opacity: o, background: `linear-gradient(90deg, rgba(245,244,241,0.94) 0%, rgba(245,244,241,0.8) ${to * 0.55}%, rgba(245,244,241,0) ${to}%)` }} />;
}
