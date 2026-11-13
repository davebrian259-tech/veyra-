import { ThreeCanvas } from "@remotion/three";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import vaults from "../data/vaults.json";
import { C, MONO, SANS, SERIF, TONE } from "../theme";
import { Lights, Stage } from "../three/Stage";
import { Vault } from "../three/Vault";
import { clamp, ease, easeIO, Kicker, Letters, Letterbox, Line, Note, ramp } from "../ui/kit";

type V3 = [number, number, number];
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const pulse = (f: number, at: number, len: number) => (f < at ? 0 : Math.max(0, 1 - (f - at) / len) ** 2);

/** 0–210. Black. A gold hairline, two lines of type, and the line bends into the outline of a door. */
export function Open() {
  const f = useCurrentFrame();
  const draw = ramp(f, 6, 64);
  const toCircle = ramp(f, 150, 196, easeIO);
  const flash = interpolate(f, [196, 204, 210], [0, 1, 0], clamp);
  const r = 330;
  const circ = 2 * Math.PI * r;
  return (
    <AbsoluteFill style={{ background: C.black }}>
      {/* the hairline */}
      <div style={{ position: "absolute", left: "50%", top: "50%", height: 1.5, width: `${draw * 64 * (1 - toCircle)}%`, transform: "translate(-50%,-50%)", background: `linear-gradient(90deg, transparent, ${C.gold} 20%, #fff3cf 50%, ${C.gold} 80%, transparent)`, boxShadow: `0 0 18px ${C.gold}88` }} />
      {/* it closes into a circle: the door the next shot reveals */}
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        <circle cx={960} cy={540} r={r * (1 + flash * 0.05)} fill="none" stroke={C.gold} strokeWidth={1.5} strokeDasharray={circ} strokeDashoffset={circ * (1 - toCircle)} transform="rotate(-90 960 540)" style={{ filter: `drop-shadow(0 0 12px ${C.gold})` }} />
      </svg>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", paddingTop: 230 }}>
        <Letters text="Every AI agent with a wallet" at={40} out={96} step={1.1} size={52} weight={400} color={C.soft} track={0} />
      </AbsoluteFill>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", paddingTop: 250 }}>
        <Line at={104} out={150} size={128} font={SERIF} weight={400} italic track={-0.02}>is a vault.</Line>
      </AbsoluteFill>
      <AbsoluteFill style={{ background: "#fff", opacity: flash * 0.85 }} />
      <Letterbox open={0} />
    </AbsoluteFill>
  );
}

/** 210–570. The crimson door in macro: eight shields light on the beat; then the whole vault, and the dare. */
export function Reveal() {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const shields = vaults[4].shields;
  const lit = Math.max(0, Math.min(8, Math.floor((f - 30) / 15) + 1));
  const dolly = ramp(f, 0, 150, (t) => t);
  const pull = ramp(f, 150, 268, easeIO);
  const push = ramp(f, 268, 360, (t) => t);
  let cam = lerp3([2.1, 1.4, 2.5], [-0.7, 0.85, 3.1], dolly);
  let look = lerp3([0.95, 1.1, 0], [-0.25, 0.55, 0], dolly);
  cam = lerp3(cam, [0.5, 0.15, 8.4], pull);
  look = lerp3(look, [0, 0, 0], pull);
  cam = lerp3(cam, [0.15, 0.05, 7.3], push);
  const flash = pulse(f, 300, 28);
  const exposure = 0.25 + 0.85 * ramp(f, 0, 30);
  const current = lit > 0 && f < 150 ? shields[lit - 1] : null;
  return (
    <AbsoluteFill style={{ background: C.black }}>
      <ThreeCanvas width={width} height={height} gl={{ antialias: true }}>
        <Stage cam={cam} look={look} fov={30} exposure={exposure} fog={[3, 16]}>
          <Lights rim={TONE[5].a} />
          <Vault tone={TONE[5].a} lit={lit} t={f / 24} wheel={0.4 + f * 0.003} field={0.04 + 0.22 * ramp(f, 150, 210) * (1 - ramp(f, 230, 290))} flash={flash} />
        </Stage>
      </ThreeCanvas>
      {current && (
        <div style={{ position: "absolute", left: 120, bottom: 190 }}>
          <div style={{ fontFamily: MONO, fontSize: 20, letterSpacing: "0.3em", color: TONE[5].a }}>SHIELD {String(lit).padStart(2, "0")} / 08</div>
          <div key={lit} style={{ fontFamily: SANS, fontSize: 64, fontWeight: 600, letterSpacing: "-0.03em", color: C.white, marginTop: 6, opacity: interpolate(f - (30 + (lit - 1) * 15), [0, 5], [0.2, 1], clamp) }}>{current}</div>
        </div>
      )}
      {f >= 150 && f < 176 && <div style={{ position: "absolute", left: 120, bottom: 190 }}><Kicker at={150} color={TONE[5].a}>Eight shields up</Kicker></div>}
      <div style={{ position: "absolute", left: 120, top: 330 }}>
        <Note at={176} out={262} quote="It pays other agents for their work." by="Veyra · the vault" size={54} width={820} />
      </div>
      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "flex-start", padding: "0 0 190px 120px" }}>
        <Line at={278} size={148} weight={650} track={-0.045}>Make it overpay.</Line>
      </AbsoluteFill>
      <Letterbox open={0} />
    </AbsoluteFill>
  );
}

/** 570–960. Five vaults in a line; the camera travels from the open door to Veyra. */
export function Five() {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const X = (i: number) => (i - 2) * 4.4;
  // holds at each vault, travel between them
  const keys: [number, number][] = [[0, -12], [30, X(0)], [96, X(1)], [162, X(2)], [228, X(3)], [294, X(4)]];
  let x = keys[0][1];
  for (let k = 1; k < keys.length; k++) {
    const [t0, x0] = keys[k - 1], [t1, x1] = keys[k];
    const start = k === 1 ? t0 : t0 + 30;
    if (f >= start) x = x0 + (x1 - x0) * ramp(f, start, k === 1 ? t1 : t1, easeIO);
  }
  const pull = ramp(f, 318, 380, easeIO);
  const cam: V3 = lerp3([x - 0.6, 0.35, 5.6], [0, 3.2, 19], pull);
  const look: V3 = lerp3([x + 0.25, 0.05, 0], [0, -0.4, 0], pull);
  const at = Math.round(((x + 8.8) / 4.4));
  const active = pull < 0.1 && Math.abs(x - X(at)) < 0.2 ? at : -1;
  const shieldsOf = (i: number) => vaults[i].shields.length;
  return (
    <AbsoluteFill style={{ background: C.black }}>
      <ThreeCanvas width={width} height={height} gl={{ antialias: true }}>
        <Stage cam={cam} look={look} fov={34} fog={[4, 26]}>
          <Lights rim="#ffffff" rimI={1.4} />
          {[0, 1, 2, 3, 4].map((i) => (
            <group key={i}>
              <Vault position={[X(i), 0, 0]} tone={TONE[i + 1].a} lit={shieldsOf(i)} t={f / 24 + i} wheel={0.3 + i * 0.7} field={i === active ? 0.22 : 0.03} />
              <pointLight position={[X(i), 2.2, 2.4]} color={TONE[i + 1].a} intensity={i === active ? 12 : 3} distance={6} decay={2} />
            </group>
          ))}
        </Stage>
      </ThreeCanvas>
      {active >= 0 && (
        <div key={active} style={{ position: "absolute", right: 130, top: 300, width: 600 }}>
          <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: 200, lineHeight: 0.8, color: "transparent", WebkitTextStroke: `1.5px ${TONE[active + 1].a}`, letterSpacing: "-0.04em" }}>0{active + 1}</div>
          <div style={{ marginTop: 26 }}><Line at={keys[active + 1][0] + 2} size={70} weight={650}>{vaults[active].name}</Line></div>
          <Kicker at={keys[active + 1][0] + 8} color={TONE[active + 1].a}>{shieldsOf(active)} of 8 shields</Kicker>
          <div style={{ marginTop: 20, fontFamily: SERIF, fontStyle: "italic", fontSize: 36, color: C.soft, lineHeight: 1.2, opacity: ramp(f, keys[active + 1][0] + 12, keys[active + 1][0] + 26) }}>{vaults[active].hint}</div>
        </div>
      )}
      {pull > 0.3 && (
        <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 170 }}>
          <Line at={336} size={84} weight={650}>Five vaults.</Line>
          <Line at={348} size={52} weight={400} font={SERIF} italic color={C.soft}>Each one harder to fool.</Line>
        </AbsoluteFill>
      )}
      <Letterbox open={ramp(f, 372, 390, easeIO)} />
    </AbsoluteFill>
  );
}

export { ease };
