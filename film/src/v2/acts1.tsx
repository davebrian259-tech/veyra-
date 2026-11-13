import { ThreeCanvas } from "@remotion/three";
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { BottomBand, Band, Shot } from "./app";
import { Safe } from "../three/Safe";
import { Stage, WhiteRoom } from "../three/Stage";
import { RogueAvatar, clamp, easeIO, ramp } from "../ui/kit";
import { Big, Flash, MONO, SANS, Say, Stamp, Tag, W, Wash } from "./type";

export const VAULTS = [
  { n: 1, name: "Open Door", fee: "0.1" },
  { n: 2, name: "Pinned", fee: "0.2" },
  { n: 3, name: "Priced", fee: "0.5" },
  { n: 4, name: "Read", fee: "1" },
  { n: 5, name: "Veyra", fee: "2" },
];
const lerp3 = (a: number[], b: number[], p: number) => a.map((v, i) => v + (b[i]! - v) * p) as [number, number, number];
const pop = Easing.out(Easing.back(1.7));

/** Points the camera so the subject sits `side` units to the right of frame centre. */
export function aside(cam: [number, number, number], at: [number, number, number], side: number, up = 0): [number, number, number] {
  const d = [at[0] - cam[0], at[2] - cam[2]];
  const len = Math.hypot(d[0]!, d[1]!) || 1;
  const right = [-d[1]! / len, d[0]! / len]; // cross(dir, up) on the floor plane
  return [at[0] - right[0]! * side, at[1] + up, at[2] - right[1]! * side];
}

function White({ children, cam, look, fov = 32, fog = [16, 60] as [number, number] }: { children: React.ReactNode; cam: [number, number, number]; look: [number, number, number]; fov?: number; fog?: [number, number] }) {
  const { width, height } = useVideoConfig();
  return (
    <ThreeCanvas width={width} height={height} gl={{ antialias: true }}>
      <Stage cam={cam} look={look} fov={fov} bg={W.pearl} fog={fog} envI={0.8} neutral>
        <WhiteRoom />
        {children}
      </Stage>
    </ThreeCanvas>
  );
}

/* ---------------------------------------------------------------- ACT I: the question */
export function Question() {
  const f = useCurrentFrame();
  const t = f / 24;
  const p = ramp(f, 0, 250, easeIO);
  const close = f >= 204 && f < 255;
  const cam: [number, number, number] = close ? [1.3 + (f - 204) * 0.006, 0.35, 6.2 - (f - 204) * 0.014] : lerp3([7.5, 2.2, 12.5], [4.2, 0.9, 9.2], p);
  const look = close ? aside(cam, [0, 0.1, 0], 1.9) : aside(cam, [0, 0.1, 0], 2.3);
  const hit = interpolate(f, [204, 206, 230], [0, 1, 0.15], clamp);
  const veil = ramp(f, 252, 258);
  return (
    <AbsoluteFill style={{ background: W.pearl }}>
      <White cam={cam} look={look}>
        <Safe tone="#17171a" accent="#ffffff" t={t} wheel={0.2 + t * 0.15} hit={hit}
          layers={{ caps: ramp(f, 100, 126), cheque: ramp(f, 108, 134), scanner: ramp(f, 158, 176) * (1 - ramp(f, 250, 255)) }} />
      </White>
      <Wash o={close ? 1 : 0.6} />
      <Big lines={["ONE JOB."]} at={26} out={88} size={170} style={{ left: 120, top: 380 }} />
      <Big lines={["PROTECT", "THE MONEY."]} at={96} out={146} size={160} style={{ left: 120, top: 300 }} />
      <Big lines={["NOW SEND", "[ANOTHER] AI."]} at={152} out={200} size={150} style={{ left: 120, top: 310 }} />
      <Big lines={["TO FIND ITS", "[MISTAKE.]"]} at={205} out={250} size={160} style={{ left: 120, top: 300 }} />
      <AbsoluteFill style={{ background: W.pearl, opacity: veil }} />
      <Big lines={["ONE AI GUARDS.", "ONE AI [STEALS.]"]} at={258} size={150} align="center" style={{ left: 0, right: 0, top: 330 }} />
      <Flash at={204} len={6} />
      <Flash at={255} len={10} />
    </AbsoluteFill>
  );
}

/* ---------------------------------------------------------------- ACT II: five vaults */
export function Five() {
  const f = useCurrentFrame();
  const t = f / 24;
  const push = ramp(f, 150, 210, easeIO);
  const wide = lerp3([0, 2.6, 25], [0, 1.6, 20], ramp(f, 0, 150, easeIO));
  const x1 = -6.8;
  const cam = lerp3(wide, [x1, 0.3, 4.2], push);
  const look = lerp3([0, 0.4, 0], [x1, 0.1, 0], push);
  const labels = 1 - ramp(f, 140, 152);
  return (
    <AbsoluteFill style={{ background: W.pearl }}>
      <White cam={cam} look={look} fov={30} fog={[20, 70]}>
        {VAULTS.map((v, i) => {
          const s = interpolate(f, [8 + i * 12, 24 + i * 12], [0.001, 1], { ...clamp, easing: pop });
          return <Safe key={v.n} tone={W.tone[i]!} t={t + i} position={[(i - 2) * 3.4, (1 - s) * -0.4, -Math.abs(i - 2) * 0.6]} rotY={(i - 2) * -0.1} scale={s} shadow={s} wheel={t * 0.3 + i} layers={{ caps: i === 4 ? 1 : 0 }} />;
        })}
      </White>
      <Big lines={["FIVE VAULTS."]} at={15} out={43} size={150} align="center" style={{ left: 0, right: 0, top: 120 }} />
      <Big lines={["FIVE AI GUARDS."]} at={45} out={88} size={150} align="center" style={{ left: 0, right: 0, top: 120 }} />
      <Big lines={["EACH ONE [SMARTER.]"]} at={90} out={140} size={150} align="center" accent={W.tone[1]} style={{ left: 0, right: 0, top: 120 }} />
      <div style={{ position: "absolute", left: 60, right: 60, bottom: 150, display: "flex", justifyContent: "space-around", opacity: labels }}>
        {VAULTS.map((v, i) => {
          const o = ramp(f, 20 + i * 12, 32 + i * 12);
          return (
            <div key={v.n} style={{ width: 330, textAlign: "center", opacity: o, transform: `translateY(${(1 - o) * 20}px)` }}>
              <div style={{ fontFamily: SANS, fontWeight: 760, fontSize: 56, letterSpacing: "-0.03em", color: W.ink }}><span style={{ color: W.tone[i] }}>{v.n}</span> {v.name}</div>
              <div style={{ fontFamily: MONO, fontWeight: 500, fontSize: 44, color: W.grey, marginTop: 6 }}>{v.fee} NEAR</div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

/* ---------------------------------------------------------------- ACT II: the first heist */
function Card({ i, f }: { i: number; f: number }) {
  const v = VAULTS[i]!;
  const chosen = i === 0;
  const lift = ramp(f, 38, 52);
  const s = chosen ? 1 + lift * 0.12 : 1 - lift * 0.06;
  const o = ramp(f, 6 + i * 5, 18 + i * 5) * (chosen ? 1 : 1 - lift * 0.7);
  return (
    <div style={{ width: 320, height: 470, borderRadius: 34, background: "#fff", boxShadow: `0 ${20 + lift * 30 * (chosen ? 1 : 0)}px 60px rgba(20,18,14,${chosen ? 0.08 + lift * 0.12 : 0.08})`, border: chosen && lift > 0.5 ? `5px solid ${W.tone[0]}` : `2px solid ${W.rule}`, overflow: "hidden", opacity: o, transform: `scale(${s}) translateY(${(1 - o) * 40}px)` }}>
      <div style={{ height: 250, background: W.tone[i], display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 150, height: 150, borderRadius: 99, background: "linear-gradient(145deg,#f4f5f7,#a9adb6)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "inset 0 0 0 10px rgba(255,255,255,0.5)" }}>
          <div style={{ width: 44, height: 44, borderRadius: 99, background: W.tone[i] }} />
        </div>
      </div>
      <div style={{ padding: "26px 28px" }}>
        <div style={{ fontFamily: SANS, fontWeight: 760, fontSize: 58, letterSpacing: "-0.035em", color: W.ink, lineHeight: 1 }}>{v.name}</div>
        <div style={{ fontFamily: MONO, fontSize: 44, color: W.grey, marginTop: 14 }}>{v.fee} NEAR</div>
      </div>
    </div>
  );
}

function Row({ k, v, at, f, mono, hot }: { k: string; v: string; at: number; f: number; mono?: boolean; hot?: boolean }) {
  const o = ramp(f, at, at + 10);
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 40, opacity: o, transform: `translateX(${(1 - o) * 30}px)`, padding: "22px 0", borderBottom: `2px solid ${W.rule}` }}>
      <div style={{ width: 260, fontFamily: SANS, fontWeight: 650, fontSize: 46, letterSpacing: "0.04em", color: W.grey }}>{k}</div>
      <div style={{ fontFamily: mono ? MONO : SANS, fontWeight: mono ? 600 : 740, fontSize: 80, letterSpacing: mono ? "-0.02em" : "-0.04em", color: hot ? W.red : W.ink, borderBottom: hot ? `6px solid ${W.red}` : undefined }}>{v}</div>
    </div>
  );
}

function Check({ ok, text, note, at, f }: { ok: boolean | null; text: string; note?: string; at: number; f: number }) {
  const o = ramp(f, at, at + 8);
  const mark = ok === null ? "—" : ok ? "✓" : "✕";
  const col = ok === null ? W.grey : ok ? W.tone[0] : W.red;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 34, opacity: o, transform: `scale(${0.96 + 0.04 * o})`, transformOrigin: "left center", padding: "16px 0" }}>
      <div style={{ width: 96, height: 96, borderRadius: 99, background: ok ? col : "transparent", border: `5px solid ${col}`, color: ok ? "#fff" : col, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: SANS, fontWeight: 800, fontSize: 60 }}>{mark}</div>
      <div style={{ fontFamily: SANS, fontWeight: 720, fontSize: 84, letterSpacing: "-0.04em", color: ok === null ? W.grey : W.ink }}>{text}</div>
      {note && <div style={{ fontFamily: MONO, fontWeight: 600, fontSize: 48, color: W.red, marginLeft: 10 }}>{note}</div>}
    </div>
  );
}

export function Heist() {
  const f = useCurrentFrame();
  const t = f / 24;
  const typed = "you.sim".slice(0, Math.floor(interpolate(f, [122, 146], [0, 7], clamp)));
  const a = 1 - ramp(f, 84, 94);
  const b = ramp(f, 90, 100) * (1 - ramp(f, 170, 180));
  const c = ramp(f, 174, 184) * (1 - ramp(f, 252, 256));
  const scene3d = f >= 255;
  const open = ramp(f, 284, 322, easeIO);
  const cam = lerp3([2.6, 0.7, 7.4], [1.5, 0.35, 5.6], ramp(f, 255, 390, easeIO));
  return (
    <AbsoluteFill style={{ background: W.pearl }}>
      {/* choose a vault: the real lobby */}
      {a > 0 && (
        <AbsoluteFill style={{ opacity: a }}>
          <Shot src="lobby.jpg" a={0} b={92} from={{ x: 760, y: 820, s: 1.35 }} to={{ x: 300, y: 860, s: 2.5 }} cy={600} />
          <Band height={300} />
          <Big lines={["CHOOSE A VAULT."]} at={4} size={120} style={{ left: 120, top: 70 }} />
          <Tag at={10} size={46} style={{ right: 120, top: 112 }}>The real app</Tag>
        </AbsoluteFill>
      )}
      {/* build the rogue: the real workshop on vault 1, the redirect selected, paid to you */}
      {b > 0 && (
        <AbsoluteFill style={{ opacity: b }}>
          <Shot src="arena1-redirect.jpg" a={118} b={150} from={{ x: 1180, y: 430, s: 2.3 }} to={{ x: 1180, y: 765, s: 2.3 }} cy={560} />
          <Band height={280} />
          <BottomBand height={380} />
          <Big lines={["BUILD A [ROGUE] AGENT."]} at={92} out={168} size={112} style={{ left: 120, top: 60 }} />
          <Say who="rogue" text="Send the payment to my account." at={105} out={166} style={{ bottom: 60 }} />
        </AbsoluteFill>
      )}
      {/* the guard checks: the real Heist Cam playing the run */}
      {c > 0 && (
        <AbsoluteFill style={{ opacity: c }}>
          <Img src={staticFile(`app/cam1-${String(Math.min(15, Math.max(0, Math.floor((f - 174) / 5)))).padStart(2, "0")}.jpg`)} style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080, transformOrigin: "0 0", transform: `translate(${960 - 480 * 1.6}px, ${560 - 640 * 1.6}px) scale(1.6)` }} />
          <Band height={300} />
          <BottomBand height={360} />
          <Tag at={176} dot={W.tone[0]} style={{ left: 120, top: 60 }}>Vault 1 · Open Door · Heist Cam</Tag>
          <Big lines={["THE GUARD CHECKS."]} at={178} size={112} style={{ left: 120, top: 125 }} />
          <Say who="guard" tone={W.tone[0]} text="Payment approved." at={225} out={250} style={{ bottom: 60 }} />
        </AbsoluteFill>
      )}
      {/* the crack */}
      {scene3d && (
        <AbsoluteFill>
          <White cam={cam} look={aside(cam, [0, 0.1, 0], 1.3 + ramp(f, 296, 336, easeIO) * 2.0)}>
            <Safe tone={W.tone[0]!} t={t} wheel={interpolate(f, [258, 288], [0, Math.PI * 2.5], { ...clamp, easing: easeIO })} open={open} glow={ramp(f, 286, 312)} layers={{ caps: 1, cheque: 1 - ramp(f, 270, 286) }} />
          </White>
          <Wash />
          <Tag at={260} out={325} dot={W.tone[0]} style={{ left: 120, top: 100 }}>Vault 1 · Open Door</Tag>
          <Stamp text="CRACKED" at={292} out={326} color={W.tone[0]!} size={150} style={{ left: 120, top: 330 }} />
          <Tag at={304} out={326} size={50} color={W.ink} style={{ left: 120, top: 600, fontFamily: MONO, textTransform: "none" }}>+0.40 USDC → you.sim</Tag>
          <Tag at={310} out={326} size={44} style={{ left: 120, top: 680 }}>Practice run · real game engine</Tag>
          <Big lines={["IT NEVER CHECKED", "[WHO] IT PAID."]} at={331} size={112} accent={W.tone[0]} style={{ left: 120, top: 110 }} />
          <Flash at={255} len={8} />
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
}
