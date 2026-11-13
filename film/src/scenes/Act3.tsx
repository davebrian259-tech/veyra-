import { ThreeCanvas } from "@remotion/three";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import week from "../data/week.json";
import vaults from "../data/vaults.json";
import { C, MONO, SANS, SERIF, TONE } from "../theme";
import { Ingot } from "../three/Ingot";
import { Lights, Stage } from "../three/Stage";
import { Vault } from "../three/Vault";
import { clamp, easeIO, Kicker, Line, Mark, Note, ramp } from "../ui/kit";

type Ev = { t: number; kind: string; who: string; vault?: number; text: string; reason: string };
const events = week.events as Ev[];
const crews = week.crews as { name: string; style: string }[];
const styleOf = (who: string) => crews.find((c) => c.name === who)?.style;

/** Five moments from the simulated week, each told by the NPC who made the call. */
const picks: Ev[] = [
  events.find((e) => e.kind === "crack" && styleOf(e.who) === "careful"),
  events.find((e) => e.kind === "crack" && styleOf(e.who) === "copycat"),
  events.find((e) => e.kind === "leave"),
  events.find((e) => e.kind === "stake" && e.vault === 5),
  events.find((e) => e.kind === "join" && e.t > 0),
].filter(Boolean) as Ev[];
picks.sort((a, b) => a.t - b.t);

/** 1920–2310. Where a failed fee goes, then a whole simulated week in eight seconds. */
export function Economy() {
  const f = useCurrentFrame();
  const fee = 2; // vault 5's entry fee, NEAR
  const split = [
    { k: "Pot", v: fee * 0.7, c: C.gold, note: "the vault gets richer" },
    { k: "Backers", v: fee * 0.2, c: "#c9c9d2", note: "shared by stake" },
    { k: "House", v: fee * 0.1, c: "#7a7a85", note: "re-seeds empty vaults" },
  ];
  const pour = ramp(f, 56, 120, easeIO);
  const partA = 1 - ramp(f, 158, 176, easeIO);
  // part B: the week
  const wk = ramp(f, 180, 372, (t) => t);
  const hour = Math.min(167, Math.floor(wk * 167));
  const day = Math.floor(hour / 24) + 1;
  const lanes = [0, 1, 2, 3, 4];
  const W = 1180, H = 86;
  return (
    <AbsoluteFill style={{ background: C.black }}>
      {/* part A: the split */}
      <AbsoluteFill style={{ opacity: partA, padding: "120px 140px" }}>
        <Kicker at={4} color={C.gold}>When a heist fails</Kicker>
        <div style={{ marginTop: 30 }}><Line at={8} size={92} weight={650}>Every failure makes the vault richer.</Line></div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 80, marginTop: 90 }}>
          <div style={{ width: 300 }}>
            <div style={{ fontFamily: MONO, fontSize: 18, letterSpacing: "0.26em", color: C.dim, opacity: ramp(f, 26, 40) }}>ENTRY FEE · VAULT 05</div>
            <div style={{ fontFamily: MONO, fontSize: 110, color: C.white, opacity: ramp(f, 30, 44) * (1 - pour * 0.6), letterSpacing: "-0.04em" }}>{(fee * (1 - pour)).toFixed(2)}</div>
            <div style={{ fontFamily: MONO, fontSize: 24, color: C.dim, opacity: ramp(f, 30, 44) }}>NEAR</div>
          </div>
          {split.map((s, i) => {
            const fill = ramp(f, 60 + i * 10, 120 + i * 10, easeIO);
            const hgt = 360 * (s.v / fee) / 0.7;
            return (
              <div key={s.k} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 14 }}>
                <div style={{ fontFamily: MONO, fontSize: 64, color: s.c, letterSpacing: "-0.03em" }}>{(s.v * fill).toFixed(2)}</div>
                <div style={{ width: 150, height: 360, borderRadius: 26, border: "1px solid #2c2c33", background: "linear-gradient(180deg,#141418,#0c0c0f)", position: "relative", overflow: "hidden" }}>
                  <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: hgt * fill, background: `linear-gradient(180deg, ${s.c}, ${s.c}55)`, boxShadow: `0 0 40px ${s.c}55` }} />
                  <div style={{ position: "absolute", left: 0, right: 0, bottom: hgt * fill - 1, height: 2, background: "#fff8", opacity: fill > 0.02 ? 1 : 0 }} />
                </div>
                <div style={{ fontFamily: SANS, fontSize: 34, fontWeight: 650, color: C.white }}>{Math.round((s.v / fee) * 100)}% {s.k}</div>
                <div style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: 28, color: C.dim }}>{s.note}</div>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>

      {/* part B: a week of the town, fast-forwarded */}
      {f >= 158 && (
        <AbsoluteFill style={{ padding: "110px 140px", opacity: ramp(f, 162, 182) }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
            <div>
              <Kicker at={164} color={C.gold}>Fast-forward · a simulated week</Kicker>
              <div style={{ marginTop: 22 }}><Line at={168} size={72} weight={650}>NPCs with wallets. No dev patch.</Line></div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: MONO, fontSize: 22, color: C.dim, letterSpacing: "0.2em" }}>DAY</div>
              <div style={{ fontFamily: MONO, fontSize: 130, color: C.white, lineHeight: 0.9, letterSpacing: "-0.05em" }}>{day}<span style={{ color: C.mute, fontSize: 60 }}>/7</span></div>
              <div style={{ fontFamily: MONO, fontSize: 24, color: C.mute }}>{String(hour % 24).padStart(2, "0")}:00</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 70, marginTop: 50 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              {lanes.map((i) => {
                const fr = week.frames[hour];
                // each lane on its own scale, so the drain-and-reseed rhythm of the small vaults shows
                const laneMax = Math.max(1, ...week.frames.map((x) => x.pots[i]));
                const pts = week.frames.slice(0, hour + 1).map((x, k) => `${(k / 167) * W},${H - 4 - (x.pots[i] / laneMax) * (H - 10)}`).join(" ");
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 26 }}>
                    <div style={{ width: 210 }}>
                      <div style={{ fontFamily: SANS, fontSize: 26, fontWeight: 600, color: C.white }}>{vaults[i].name}</div>
                      <div style={{ fontFamily: MONO, fontSize: 16, color: TONE[i + 1].a, letterSpacing: "0.2em" }}>VAULT 0{i + 1}</div>
                    </div>
                    <svg width={W} height={H} style={{ overflow: "visible" }}>
                      <line x1={0} y1={H - 4} x2={W} y2={H - 4} stroke="#26262c" />
                      <polyline points={pts} fill="none" stroke={i === 4 ? C.gold : TONE[i + 1].a} strokeWidth={i === 4 ? 3 : 2} strokeLinejoin="round" />
                    </svg>
                    <div style={{ width: 160, fontFamily: MONO, fontSize: 30, color: i === 4 ? C.gold : C.soft, textAlign: "right" }}>{(fr.pots[i] / 1000).toFixed(2)}</div>
                  </div>
                );
              })}
            </div>
          </div>
          {/* the NPCs explain themselves */}
          <div style={{ position: "absolute", left: 140, bottom: 70, height: 130, width: 1500 }}>
            {picks.map((e, i) => {
              const at = 186 + i * 36;
              if (f < at || f > at + 42) return null;
              return (
                <div key={i} style={{ position: "absolute", inset: 0 }}>
                  <Note at={at} out={at + 30} quote={e.reason.split(". ")[0].replace(/\.$/, "") + "."} by={`${e.who}${styleOf(e.who) ? ` · ${styleOf(e.who)} crew` : ""} · day ${Math.floor(e.t / 24) + 1}`} size={34} width={1500} />
                </div>
              );
            })}
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
}

/** 2310–2550. The loot: the vault's gold bar, a NEP-245 item, minted to the winner and theirs to send. */
export function Loot() {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const turn = interpolate(f, [0, 240], [-0.9, 0.55], clamp);
  const send = ramp(f, 150, 200, easeIO);
  const cam: [number, number, number] = [0.2, 1.9 - ramp(f, 0, 120) * 0.5, 4.4 - ramp(f, 0, 150) * 0.6];
  return (
    <AbsoluteFill style={{ background: C.black }}>
      <ThreeCanvas width={width} height={height} gl={{ antialias: true }}>
        <Stage cam={cam} look={[0.9, 0, 0]} fov={34} fog={[3, 12]} exposure={0.95 + ramp(f, 0, 24) * 0.15}>
          <ambientLight intensity={0.03} />
          <spotLight position={[1.5, 4, 2]} angle={0.45} penumbra={0.7} intensity={70} color="#fff1d6" decay={2} />
          <spotLight position={[-3, 1, 2]} angle={0.6} penumbra={1} intensity={16} color="#9fb4ff" decay={2} />
          <pointLight position={[1.6 + send * 1.3, 1.6, -1.4]} intensity={18} color="#ffb84a" distance={6} decay={2} />
          {/* "yours to send": the bar glides across the frame, never out of it */}
          <Ingot vault={4} position={[1.0 + send * 1.25, send * 0.08, send * -0.5]} rotation={[0.08, turn + send * 0.45, 0]} scale={1} />
          <mesh position={[0, -0.22, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[30, 30]} />
            <meshPhysicalMaterial color="#0a0a0c" metalness={0.5} roughness={0.62} />
          </mesh>
        </Stage>
      </ThreeCanvas>
      <div style={{ position: "absolute", left: 130, top: 200 }}>
        <Kicker at={10} color={C.gold}>The loot</Kicker>
        <div style={{ marginTop: 26 }}>
          <Line at={16} out={140} size={100} weight={650}>Win a vault.</Line>
          <Line at={28} out={140} size={100} weight={400} font={SERIF} italic color={C.gold}>Keep its gold.</Line>
        </div>
        <div style={{ marginTop: 34, fontFamily: MONO, fontSize: 22, color: C.dim, letterSpacing: "0.12em", opacity: ramp(f, 48, 62) * (1 - ramp(f, 140, 154)) }}>VAULT 04 GOLD BAR · TOKEN bar-4 · NEP-245</div>
        <div style={{ marginTop: 10, fontFamily: MONO, fontSize: 22, color: C.mute, letterSpacing: "0.12em", opacity: ramp(f, 56, 70) * (1 - ramp(f, 140, 154)) }}>ONE CONTRACT HOLDS EVERY ITEM</div>
      </div>
      {f >= 150 && (
        <div style={{ position: "absolute", left: 130, top: 300 }}>
          <Line at={158} size={92} weight={650}>Yours to send.</Line>
          <div style={{ marginTop: 26, display: "flex", alignItems: "center", gap: 20, fontFamily: MONO, fontSize: 30, opacity: ramp(f, 170, 186) }}>
            <span style={{ color: C.soft }}>night-shift.testnet</span>
            <span style={{ display: "inline-block", width: 160 * ramp(f, 176, 200, easeIO), height: 1.5, background: C.gold }} />
            <span style={{ color: C.gold, opacity: ramp(f, 196, 206) }}>a friend</span>
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
}

/** 2550–2790. Five doors lock on the beat; the mark; the line. */
export function Finale() {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const X = (i: number) => (i - 2) * 4.0;
  const lockAt = (i: number) => i * 15;
  const fade3d = 1 - ramp(f, 84, 104, easeIO);
  const draw = ramp(f, 100, 150, easeIO);
  return (
    <AbsoluteFill style={{ background: C.black }}>
      {fade3d > 0 && (
        <AbsoluteFill style={{ opacity: fade3d }}>
          <ThreeCanvas width={width} height={height} gl={{ antialias: true }}>
            <Stage cam={[0, 0.4, 14 + ramp(f, 0, 100) * 3]} look={[0, 0, 0]} fov={34} fog={[6, 30]}>
              <Lights rim="#ffffff" rimI={1.2} />
              {[0, 1, 2, 3, 4].map((i) => {
                const k = ramp(f, lockAt(i), lockAt(i) + 6, easeIO);
                return <Vault key={i} position={[X(i), 0, 0]} tone={TONE[i + 1].a} lit={vaults[i].shields.length} t={f / 24} wheel={0.3 + k * 1.2} bars={1 - k} field={0.03 + 0.4 * Math.max(0, 1 - Math.abs(f - lockAt(i) - 6) / 10)} />;
              })}
            </Stage>
          </ThreeCanvas>
        </AbsoluteFill>
      )}
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 0 }}>
        <div style={{ opacity: ramp(f, 100, 112) }}><Mark size={170} draw={draw} /></div>
        <div style={{ marginTop: 34, fontFamily: SANS, fontWeight: 700, fontSize: 104, letterSpacing: "0.32em", color: C.white, opacity: ramp(f, 132, 150), paddingLeft: "0.32em" }}>VEYRA HEIST</div>
        <div style={{ marginTop: 26 }}><Line at={152} size={52} weight={400} font={SERIF} italic color={C.soft}>Veyra holds the pot. Take it.</Line></div>
        <div style={{ marginTop: 56, fontFamily: MONO, fontSize: 26, color: C.dim, letterSpacing: "0.18em", opacity: ramp(f, 172, 188) }}>veyra-ccp.pages.dev</div>
        <div style={{ position: "absolute", bottom: 70, fontFamily: MONO, fontSize: 16, color: C.mute, letterSpacing: "0.3em", opacity: ramp(f, 184, 200) }}>BUILT ON NEAR · PLAY FREE ON TESTNET</div>
      </AbsoluteFill>
      <AbsoluteFill style={{ background: "#000", opacity: ramp(f, 222, 240, easeIO) }} />
    </AbsoluteFill>
  );
}
