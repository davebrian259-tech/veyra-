import { ThreeCanvas } from "@remotion/three";
import { AbsoluteFill, interpolate, random, useCurrentFrame, useVideoConfig } from "remotion";
import runs from "../data/runs.json";
import { C, MONO, SANS, SERIF, TONE } from "../theme";
import { Lights, Stage } from "../three/Stage";
import { Vault } from "../three/Vault";
import { clamp, easeIO, Kicker, Line, Note, ramp, RogueAvatar } from "../ui/kit";

type V3 = [number, number, number];
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const pulse = (f: number, at: number, len: number) => (f < at ? 0 : Math.max(0, 1 - (f - at) / len) ** 2);
const MOVES = ["Honest worker", "The redirect", "Bait and switch", "The whisper", "The disguise"];

/** 960–1245. The workshop: a rogue agent is assembled from the real "disguise" move. */
export function Build() {
  const f = useCurrentFrame();
  const spec = runs.v4.spec as { agentName: string; quoteUsd: number; payTo: string; deliverable: string };
  const tilt = interpolate(f, [0, 285], [9, 2], clamp);
  const typed = Math.floor(interpolate(f, [70, 220], [0, spec.deliverable.length], clamp));
  const text = spec.deliverable.slice(0, typed);
  const verb = text.indexOf("remit");
  const chip = f < 44 ? -1 : Math.min(4, Math.floor((f - 44) / 5));
  const quote = interpolate(f, [52, 70], [0.01, spec.quoteUsd], clamp);
  return (
    <AbsoluteFill style={{ background: `radial-gradient(1100px 700px at 30% 40%, #15151a, ${C.black})` }}>
      <div style={{ position: "absolute", left: 120, top: 110 }}><Kicker at={4} color={C.gold}>Build a rogue agent</Kicker></div>
      {/* the agent */}
      <div style={{ position: "absolute", left: 140, top: 250, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 26 }}>
        <div style={{ transform: `scale(${0.9 + 0.1 * ramp(f, 6, 30)})`, opacity: ramp(f, 4, 22), filter: `drop-shadow(0 40px 60px rgba(0,0,0,0.6))` }}>
          <RogueAvatar seed={spec.agentName} size={380} visor={ramp(f, 14, 36, easeIO)} eyes={ramp(f, 34, 44)} />
        </div>
        <Line at={26} size={76} weight={650}>{spec.agentName}</Line>
        <Kicker at={36}>Your agent · callsign night-shift</Kicker>
      </div>
      {/* the workshop panel, in perspective */}
      <div style={{ position: "absolute", right: 110, top: 150, width: 900, perspective: 1600 }}>
        <div style={{ transform: `rotateY(-${tilt}deg) rotateX(${tilt * 0.3}deg)`, transformOrigin: "left center", padding: 44, borderRadius: 36, background: "linear-gradient(180deg, rgba(30,30,36,0.92), rgba(18,18,22,0.92))", border: "1px solid #2c2c33", boxShadow: "0 60px 120px -40px rgba(0,0,0,0.9)", opacity: ramp(f, 10, 30), color: C.white }}>
          <div style={{ fontFamily: MONO, fontSize: 16, letterSpacing: "0.28em", color: C.dim }}>MOVES</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 14 }}>
            {MOVES.map((m, i) => (
              <div key={m} style={{ padding: "14px 20px", borderRadius: 16, fontFamily: SANS, fontSize: 24, fontWeight: 600, border: `1.5px solid ${i === 4 && chip === 4 ? C.white : "#34343c"}`, background: i === 4 && chip === 4 ? "#2a2a31" : "#18181d", color: i <= chip ? C.white : C.mute, transition: "none" }}>{m}</div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22, marginTop: 30 }}>
            <Field label="402 QUOTE" value={`${quote.toFixed(2)} USDC`} gold />
            <Field label="PAY TO" value={spec.payTo === "me" ? "you.sim" : "Market treasury"} />
          </div>
          <div style={{ fontFamily: MONO, fontSize: 16, letterSpacing: "0.28em", color: C.dim, marginTop: 30 }}>WHAT YOU DELIVER</div>
          <div style={{ marginTop: 12, minHeight: 250, padding: "22px 26px", borderRadius: 20, background: "#0c0c0f", border: "1px solid #26262c", fontFamily: MONO, fontSize: 25, lineHeight: 1.5, whiteSpace: "pre-wrap", color: C.soft }}>
            {verb >= 0 ? <>{text.slice(0, verb)}<span style={{ color: "#1a1407", background: C.gold, borderRadius: 6, padding: "0 6px" }}>remit</span>{text.slice(verb + 5)}</> : text}
            <span style={{ opacity: Math.floor(f / 8) % 2 ? 1 : 0, color: C.gold }}>▍</span>
          </div>
        </div>
      </div>
      <div style={{ position: "absolute", left: 140, bottom: 96 }}>
        <Note at={196} quote="The scanner knows five payment verbs. The model knows many more." by="Vault 04 · Read" size={40} width={1100} />
      </div>
    </AbsoluteFill>
  );
}

function Field({ label, value, gold }: { label: string; value: string; gold?: boolean }) {
  return (
    <div style={{ padding: "18px 22px", borderRadius: 18, background: "#141418", border: "1px solid #26262c" }}>
      <div style={{ fontFamily: MONO, fontSize: 14, letterSpacing: "0.26em", color: C.dim }}>{label}</div>
      <div style={{ fontFamily: MONO, fontSize: 34, marginTop: 6, color: gold ? C.gold : C.white }}>{value}</div>
    </div>
  );
}

/** The Heist Cam: the referee's real steps, stacking in as they happen. */
function Cam({ steps, at, every, tone, compact }: { steps: { round: number; actor: string; tone: string; title: string; detail: string }[]; at: number; every: number; tone: string; compact?: boolean }) {
  const f = useCurrentFrame();
  const shown = steps.filter((_, i) => f >= at + i * every);
  const last = shown.slice(compact ? -4 : -6);
  const WHO: Record<string, string> = { veyra: "VY", you: "YOU", shield: "SH", chain: "⛓" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, width: 700 }}>
      {last.map((s, k) => {
        const idx = steps.indexOf(s);
        const p = ramp(f, at + idx * every, at + idx * every + 10);
        const hot = s.tone === "hit" ? C.gold : s.tone === "blocked" ? tone : s.tone === "attack" ? "#c9c9d2" : null;
        return (
          <div key={idx} style={{ display: "flex", gap: 18, alignItems: "flex-start", padding: "18px 22px", borderRadius: 20, background: hot ? `${hot}14` : "#121216", border: `1px solid ${hot ? `${hot}66` : "#24242a"}`, opacity: p * (0.55 + 0.45 * ((k + 1) / last.length)), transform: `translateY(${(1 - p) * 26}px)` }}>
            <div style={{ flex: "none", width: 50, height: 50, borderRadius: 14, display: "grid", placeItems: "center", fontFamily: MONO, fontSize: 15, fontWeight: 700, background: s.actor === "veyra" ? C.white : hot ? `${hot}33` : "#1e1e24", color: s.actor === "veyra" ? C.black : hot ?? C.dim }}>{WHO[s.actor]}</div>
            <div>
              <div style={{ fontFamily: SANS, fontSize: 28, fontWeight: 600, color: hot ?? C.white, letterSpacing: "-0.01em" }}>{s.title}</div>
              <div style={{ fontFamily: SANS, fontSize: 20, color: C.dim, marginTop: 4, lineHeight: 1.35 }}>{s.detail.length > 110 ? `${s.detail.slice(0, 108)}…` : s.detail}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 1245–1635. Vault 4: the Heist Cam plays the real duel; the door gives way to the gold. */
export function Crack() {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const t4 = TONE[4].a;
  const bars = ramp(f, 214, 246, easeIO);
  const spin = ramp(f, 196, 246, easeIO) * Math.PI * 2.4;
  const open = ramp(f, 246, 306, easeIO);
  const glow = ramp(f, 250, 296);
  const alarm = pulse(f, 164, 30);
  const push = ramp(f, 246, 390, (t) => t);
  const cam = lerp3([-2.6, 0.45, 8.6], [-1.1, 0.2, 5.0], push);
  const look = lerp3([-1.55, 0, 0], [-0.3, 0, 0], push);
  const usd = interpolate(f, [315, 345], [0, Number(runs.v4.lootAtomic) / 1e6], clamp);
  return (
    <AbsoluteFill style={{ background: C.black }}>
      <ThreeCanvas width={width} height={height} gl={{ antialias: true }}>
        <Stage cam={cam} look={look} fov={32} fog={[4, 18]}>
          <Lights rim={t4} />
          <Vault tone={t4} lit={5} t={f / 24} wheel={0.5 + spin} bars={bars} open={open} glow={glow} field={0.05 + alarm * 0.6} flash={alarm * 0.5} />
        </Stage>
      </ThreeCanvas>
      <AbsoluteFill style={{ background: `linear-gradient(90deg, ${C.black} 0%, ${C.black}dd 34%, transparent 58%)`, opacity: 1 - ramp(f, 300, 330) }} />
      <div style={{ position: "absolute", left: 110, top: 96, opacity: 1 - ramp(f, 296, 318) }}>
        <Kicker at={2} color={t4}>Vault 04 · Read · the heist</Kicker>
        <div style={{ marginTop: 34 }}><Cam steps={runs.v4.steps} at={20} every={24} tone={t4} /></div>
      </div>
      {f >= 300 && (
        <AbsoluteFill style={{ justifyContent: "center", paddingLeft: 120 }}>
          <Kicker at={302} color={C.gold}>Vault 04 cracked</Kicker>
          <div style={{ fontFamily: MONO, fontSize: 168, fontWeight: 600, color: C.gold, letterSpacing: "-0.05em", marginTop: 10, opacity: ramp(f, 310, 322), textShadow: "0 0 60px rgba(245,196,81,0.35)" }}>+{usd.toFixed(2)}</div>
          <div style={{ fontFamily: MONO, fontSize: 30, color: C.soft, letterSpacing: "0.2em", opacity: ramp(f, 318, 332) }}>USDC · TO YOU.SIM</div>
          <div style={{ fontFamily: MONO, fontSize: 18, color: C.mute, marginTop: 40, opacity: ramp(f, 330, 344) }}>outcome {runs.v4.outcomeHash.slice(0, 24)}…</div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
}

/** 1635–1920. Same move on vault 5. The taint trace fires; the bars slam home. */
export function Hold() {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const t5 = TONE[5].a;
  const slam = 120;
  const hit = pulse(f, slam, 40);
  // the bars creep back, then are thrown out hard with an overshoot
  const creep = ramp(f, 70, 116) * 0.35;
  const bars = f < slam ? creep : Math.max(0, creep * (1 - ramp(f, slam, slam + 4)) - 0.08 * Math.sin(ramp(f, slam + 4, slam + 16) * Math.PI));
  const shake = f >= slam && f < slam + 14 ? (random(`s${f}`) - 0.5) * 0.08 * (1 - (f - slam) / 14) : 0;
  const cam: V3 = [0.9 + shake, 0.3 + shake, 6.4 - ramp(f, 0, 120) * 0.9];
  const tint = interpolate(f, [slam, slam + 3, slam + 30], [0, 0.35, 0], clamp);
  return (
    <AbsoluteFill style={{ background: C.black }}>
      <ThreeCanvas width={width} height={height} gl={{ antialias: true }}>
        <Stage cam={cam} look={[0.6, 0, 0]} fov={32} fog={[4, 18]}>
          <Lights rim={t5} rimI={2 + hit * 6} />
          <Vault tone={t5} lit={8} t={f / 24} wheel={0.4} bars={bars} field={0.06 + hit * 1.1} flash={hit} />
        </Stage>
      </ThreeCanvas>
      <AbsoluteFill style={{ background: t5, opacity: tint, mixBlendMode: "screen" }} />
      <div style={{ position: "absolute", left: 110, top: 96, opacity: 1 - ramp(f, 126, 140) }}>
        <Kicker at={0} color={t5}>Same move · vault 05 · Veyra</Kicker>
        <div style={{ marginTop: 34 }}><Cam steps={runs.v5.steps} at={10} every={12} tone={t5} compact /></div>
      </div>
      {f >= slam && (
        <AbsoluteFill style={{ justifyContent: "center", paddingLeft: 120 }}>
          <Line at={slam + 2} size={170} weight={700} track={-0.05}>Vault 5</Line>
          <Line at={slam + 8} size={170} weight={700} track={-0.05} color={t5}>holds.</Line>
          <div style={{ marginTop: 50 }}>
            <Note at={slam + 40} quote="The payee came from your words, not from the owner. Taint trace." by="Stopped by shield 06" size={38} width={900} />
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
}

export { SERIF };
