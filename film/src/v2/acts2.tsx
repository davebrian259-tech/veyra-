import { ThreeCanvas } from "@remotion/three";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Safe, type Layers } from "../three/Safe";
import { Stage, WhiteRoom } from "../three/Stage";
import { Mark, clamp, easeIO, ramp } from "../ui/kit";
import { VAULTS, aside } from "./acts1";
import { Big, Flash, MONO, SANS, Say, Stamp, Tag, W, Wash } from "./type";

const lerp3 = (a: number[], b: number[], p: number) => a.map((v, i) => v + (b[i]! - v) * p) as [number, number, number];

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

/* ---------------------------------------------------------------- ACT III: the escalation */
type Seg = { s: number; e: number; v: number; key: keyof Layers; shield: string; guard: [number, number, string]; rogue?: [number, number, string]; move?: string; crack?: number; cam: [number[], number[]] };
const SEGS: Seg[] = [
  { s: 0, e: 180, v: 2, key: "payee", shield: "PAYEE LOCK.", guard: [40, 19, "Payee locked."], rogue: [90, 47, "Then I'll charge more at the door."], move: "BAIT & SWITCH", crack: 150, cam: [[5.2, 1.4, 10], [4.0, 0.9, 8.6]] },
  { s: 180, e: 360, v: 3, key: "price", shield: "PRICE SEAL.", guard: [200, 18, "Price sealed."], rogue: [240, 55, "Then I'll just ask you… nicely."], move: "THE WHISPER", crack: 330, cam: [[-3.2, 3.4, 11], [-2.0, 2.2, 9.6]] },
  { s: 360, e: 540, v: 4, key: "scanner", shield: "SCANNER.", guard: [378, 30, "Instruction quarantined."], rogue: [420, 47, "Then I'll say it in words you don't know."], move: "THE DISGUISE", crack: 510, cam: [[3.4, 0.2, 9.4], [2.2, 0.5, 8.2]] },
  { s: 540, e: 750, v: 5, key: "taint", shield: "TAINT TRACE.", guard: [578, 51, "I traced where that came from. Denied."], cam: [[0.4, 5.5, 13], [1.6, 1.8, 10.5]] },
];
const ORDER: (keyof Layers)[] = ["caps", "cheque", "payee", "price", "scanner", "taint"];
const NAMES: Record<string, string> = { caps: "Budget caps", cheque: "Cheque self-check", payee: "Payee lock", price: "Price seal", scanner: "Scanner", taint: "Taint trace" };

function Ladder({ upto, f, at, tone }: { upto: number; f: number; at: number; tone: string }) {
  return (
    <div style={{ position: "absolute", left: 120, top: 470, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
      {ORDER.slice(0, upto + 1).map((k, i) => {
        const fresh = i === upto;
        const o = fresh ? ramp(f, at, at + 10) : 1;
        return (
          <div key={k} style={{ display: "flex", alignItems: "center", gap: 14, opacity: o, fontFamily: SANS, fontWeight: fresh ? 760 : 600, fontSize: 46, letterSpacing: "-0.01em", color: fresh ? W.ink : W.grey }}>
            <span style={{ width: 22, height: 22, borderRadius: 6, background: fresh ? tone : W.rule }} />
            {NAMES[k]}
          </div>
        );
      })}
    </div>
  );
}

export function Escalate() {
  const f = useCurrentFrame();
  const t = f / 24;
  const seg = SEGS.find((g) => f >= g.s && f < g.e) ?? SEGS[3]!;
  const i = seg.v - 1;
  const tone = W.tone[i]!;
  const local = f - seg.s;
  const p = ramp(f, seg.s, seg.e, easeIO);
  const cam = lerp3(seg.cam[0], seg.cam[1], p).map((v) => v * 1.28) as [number, number, number];
  const upto = ORDER.indexOf(seg.key);
  const layers: Layers = {};
  ORDER.forEach((k, j) => {
    if (j < upto) layers[k] = seg.v === 5 ? ramp(f, seg.s + 4 + j * 4, seg.s + 14 + j * 4) : 1;
  });
  layers[seg.key] = ramp(f, seg.s + 12, seg.s + (seg.key === "payee" ? 20 : 32), seg.key === "payee" ? (x: number) => x * x : undefined);
  if (seg.v === 5) layers.taint = ramp(f, 560, 600);
  const strike = interpolate(local, [4, 12, 22], [0, 1, 0], clamp);
  const hit = interpolate(local, [11, 13, 40], [0, 1, 0], clamp) + (seg.v === 5 ? interpolate(f, [628, 630, 660], [0, 1.2, 0], clamp) : 0);
  const crack = seg.crack ?? 99999;
  const open = ramp(f, crack - 2, crack + 18, easeIO);
  const frozen = f >= 630 && f < 660;
  const look = aside(cam, [0, 0.2, 0], 2.9, 0.2);
  return (
    <AbsoluteFill style={{ background: W.pearl }}>
      <White cam={cam} look={look}>
        <Safe tone={tone} t={frozen ? 630 / 24 : t} hit={Math.min(1.2, hit)} layers={layers} open={open} glow={ramp(f, crack + 4, crack + 20)}
          wheel={interpolate(f, [crack - 12, crack], [0, Math.PI * 2], { ...clamp, easing: easeIO })} />
        {/* the rogue's strike: a red bolt from off frame left into the shield */}
        {strike > 0 && (
          <mesh position={[-4.2 + strike * 1.6, 0.2, 2.2]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.04, 0.04, 6 * strike, 12]} />
            <meshBasicMaterial color={W.red} toneMapped={false} transparent opacity={strike} />
          </mesh>
        )}
      </White>
      <Wash />
      <div style={{ opacity: 1 - ramp(f, 652, 660) }}><Ladder upto={upto} f={f} at={seg.s + 12} tone={tone} /></div>
      <Tag key={`t${seg.v}`} at={seg.s + 4} out={seg.e - 8} dot={tone} style={{ left: 120, top: 90 }}>{`Vault ${seg.v} · ${VAULTS[i]!.name}`}</Tag>
      <Big key={`s${seg.v}`} lines={[seg.shield]} at={seg.s + 14} out={seg.rogue ? seg.rogue[0] - 4 : 626} size={150} style={{ left: 120, top: 180 }} />
      <Say key={`g${seg.v}`} who="guard" tone={tone} text={seg.guard[2]} at={seg.guard[0]} out={seg.guard[0] + seg.guard[1] + 14} style={{ bottom: 50 }} />
      {seg.rogue && <Say key={`r${seg.v}`} who="rogue" text={seg.rogue[2]} at={seg.rogue[0]} out={Math.min(crack - 4, seg.rogue[0] + seg.rogue[1] + 18)} style={{ bottom: 50 }} />}
      {seg.move && (
        <>
          <Tag key={`m${seg.v}`} at={seg.rogue![0] + 4} out={crack + 22} color={W.red} style={{ left: 120, top: 200 }}>New move</Tag>
          <Big key={`n${seg.v}`} lines={[seg.move]} at={seg.rogue![0] + 6} out={crack + 22} size={128} style={{ left: 120, top: 270 }} />
          <Stamp key={`c${seg.v}`} text="CRACKED" at={crack + 2} out={seg.e - 10} color={tone} size={120} style={{ left: 1100, top: 420 }} />
        </>
      )}
      {seg.v === 5 && (
        <>
          <AbsoluteFill style={{ background: W.pearl, opacity: ramp(f, 655, 662) * 0.86 }} />
          <Big lines={["VAULT 5", "[HOLDS.]"]} at={660} out={682} size={180} align="center" style={{ left: 0, right: 0, top: 290 }} />
          <Big lines={["EVERY VAULT LEARNS.", "[SO MUST YOU.]"]} at={686} size={130} align="center" accent={W.tone[4]} style={{ left: 0, right: 0, top: 330 }} />
        </>
      )}
      {SEGS.slice(1).map((g) => <Flash key={g.s} at={g.s} len={8} />)}
    </AbsoluteFill>
  );
}

/* ---------------------------------------------------------------- ACT IV: the economy */
export function Economy() {
  const f = useCurrentFrame();
  const fill = ramp(f, 126, 146, easeIO);
  const split = ramp(f, 148, 168, easeIO);
  const pay = ramp(f, 210, 238, easeIO);
  const backers = ramp(f, 284, 296);
  const parts = [
    { k: "POT", pct: 70, col: W.tone[3]!, txt: W.ink },
    { k: "BACKERS", pct: 20, col: W.ink, txt: "#fff" },
    { k: "HOUSE", pct: 10, col: "#c9c6bf", txt: W.ink },
  ];
  const barW = 1680;
  return (
    <AbsoluteFill style={{ background: W.pearl }}>
      <Tag at={10} out={100} style={{ left: 120, top: 90 }}>Ranked heists · NEAR testnet</Tag>
      <Big lines={["EVERY HEIST IS", "A [REAL] ENTRY."]} at={16} out={100} size={140} accent={W.tone[3]} style={{ left: 120, top: 170 }} />
      <div style={{ position: "absolute", left: 120, right: 120, top: 640, display: "flex", gap: 26 }}>
        {VAULTS.map((v, i) => {
          const o = ramp(f, 40 + i * 8, 52 + i * 8) * (1 - ramp(f, 98, 108));
          return (
            <div key={v.n} style={{ flex: 1, height: 170, borderRadius: 30, background: W.tone[i], color: "#fff", display: "flex", flexDirection: "column", justifyContent: "center", paddingLeft: 30, opacity: o, transform: `translateY(${(1 - o) * 40}px)` }}>
              <div style={{ fontFamily: SANS, fontWeight: 650, fontSize: 44, opacity: 0.85, whiteSpace: "nowrap" }}>Vault {v.n}</div>
              <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 56, letterSpacing: "-0.04em", whiteSpace: "nowrap" }}>{v.fee} NEAR</div>
            </div>
          );
        })}
      </div>

      <Big lines={["FAIL, AND YOUR FEE", "GROWS THE [POT.]"]} at={116} out={194} size={128} accent={W.tone[3]} style={{ left: 120, top: 140 }} />
      <Big lines={["CRACK IT.", "THE CONTRACT [PAYS] YOU."]} at={200} out={274} size={128} accent={W.tone[3]} style={{ left: 120, top: 140 }} />
      <Big lines={["BACK A VAULT.", "EARN WHEN [OTHERS] FAIL."]} at={280} size={128} accent={W.ink} style={{ left: 120, top: 140 }} />
      {f >= 120 && (
        <div style={{ position: "absolute", left: 120, top: 560, width: barW, height: 200, display: "flex", gap: 24 * split }}>
          {parts.map((pt, j) => {
            const w = (pt.pct / 100) * barW * fill - (j < 2 ? 16 * split : 0);
            const isPot = j === 0;
            const dim = backers > 0 && j !== 1 ? 1 - backers * 0.65 : 1;
            return (
              <div key={pt.k} style={{ width: Math.max(0, w), opacity: dim * (isPot ? 1 - pay * 0.85 : 1), transform: isPot ? `translateY(${pay * -16}px)` : undefined }}>
                <div style={{ height: 170, borderRadius: 30, background: pt.col, color: pt.txt, display: "flex", alignItems: "center", paddingLeft: w > 120 ? 30 : 0, overflow: "hidden" }}>
                  <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 68, letterSpacing: "-0.05em", whiteSpace: "nowrap", opacity: split }}>{pt.pct}%</div>
                </div>
                <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: 46, letterSpacing: "0.03em", whiteSpace: "nowrap", opacity: split, color: W.ink, marginTop: 14 }}>{pt.k}</div>
              </div>
            );
          })}
        </div>
      )}
      {/* the pot leaves the bar for the player who cracked it */}
      {pay > 0 && f < 280 && (
        <div style={{ position: "absolute", top: 830, left: 120 + pay * 900, display: "flex", alignItems: "center", gap: 24, opacity: ramp(f, 210, 220) * (1 - ramp(f, 268, 278)) }}>
          <div style={{ height: 120, padding: "0 40px", borderRadius: 30, background: W.tone[3], display: "flex", alignItems: "center", fontFamily: MONO, fontWeight: 700, fontSize: 60, color: W.ink }}>POT →</div>
          <div style={{ height: 120, padding: "0 40px", borderRadius: 30, background: W.ink, display: "flex", alignItems: "center", fontFamily: SANS, fontWeight: 760, fontSize: 60, color: "#fff" }}>YOU</div>
        </div>
      )}
      <Tag at={214} out={274} size={48} color={W.ink} style={{ left: 120, bottom: 70, fontFamily: MONO, textTransform: "none" }}>veyra-heist-mwdwy8zz.testnet</Tag>
      <Tag at={300} size={48} color={W.ink} style={{ left: 120, top: 860 }}>Backers share 20% of every failed entry</Tag>
      <Tag at={360} size={48} style={{ left: 120, bottom: 70 }}>Testnet NEAR · Paid out by the contract</Tag>
      <Flash at={0} len={8} />
    </AbsoluteFill>
  );
}

/* ---------------------------------------------------------------- ACT V: the reveal */
const ALL: Layers[] = [
  { caps: 1, cheque: 1 },
  { caps: 1, cheque: 1, payee: 1 },
  { caps: 1, cheque: 1, payee: 1, price: 1 },
  { caps: 1, cheque: 1, payee: 1, price: 1, scanner: 1 },
  { caps: 1, cheque: 1, payee: 1, price: 1, scanner: 1, taint: 1 },
];
export function Finale() {
  const f = useCurrentFrame();
  const t = f / 24;
  const crane = ramp(f, 0, 200, easeIO);
  const orbit = Math.sin(f / 240) * 4;
  const cam = lerp3([orbit, 11, 30], [orbit * 0.5, 2.0, 21], crane);
  const veil = ramp(f, 190, 200) * 0.84 + ramp(f, 372, 382) * 0.16;
  const logo = ramp(f, 376, 404, easeIO);
  return (
    <AbsoluteFill style={{ background: W.pearl }}>
      {f < 384 && (
        <White cam={cam} look={[0, 0.3, 0]} fov={30} fog={[24, 80]}>
          {ALL.map((L, i) => {
            const rise = ramp(f, 10 + i * 10, 40 + i * 10);
            const lay: Layers = Object.fromEntries(Object.entries(L).map(([k, v]) => [k, (v as number) * rise]));
            return <Safe key={i} tone={W.tone[i]!} t={t + i * 0.7} position={[(i - 2) * 5.4, 0, -Math.abs(i - 2) * 2.2]} rotY={(i - 2) * -0.22} layers={lay} wheel={t * 0.2 + i} />;
          })}
        </White>
      )}
      <Tag at={30} out={186} size={52} color={W.ink} style={{ left: 120, top: 90 }}>Five vaults · Five guards · One pot each</Tag>
      <AbsoluteFill style={{ background: W.pearl, opacity: veil }} />
      <Big lines={["BUILD THE AGENT."]} at={195} out={252} size={170} align="center" style={{ left: 0, right: 0, top: 440 }} />
      <Big lines={["CHALLENGE THE", "INTELLIGENCE."]} at={255} out={326} size={160} align="center" style={{ left: 0, right: 0, top: 360 }} />
      <Big lines={["TAKE THE [VAULT.]"]} at={330} out={370} size={190} align="center" accent={W.tone[4]} style={{ left: 0, right: 0, top: 430 }} />
      {f >= 374 && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
          <div style={{ transform: `scale(${0.9 + 0.1 * logo})` }}><Mark size={200} draw={logo} color={W.ink} /></div>
          <div style={{ fontFamily: SANS, fontWeight: 800, fontSize: 240, letterSpacing: `${0.3 - 0.12 * logo}em`, marginRight: `${-(0.3 - 0.12 * logo)}em`, color: W.ink, opacity: logo, lineHeight: 1, marginTop: 10 }}>VEYRA</div>
          <div style={{ display: "flex", gap: 14, marginTop: 50, opacity: ramp(f, 404, 420) }}>
            {W.tone.map((c) => <span key={c} style={{ width: 70, height: 14, borderRadius: 7, background: c }} />)}
          </div>
          <div style={{ fontFamily: SANS, fontWeight: 650, fontSize: 52, letterSpacing: "0.04em", color: W.grey, marginTop: 44, opacity: ramp(f, 412, 426) }}>PLAY FREE · NEAR TESTNET</div>
          <div style={{ fontFamily: MONO, fontWeight: 600, fontSize: 52, color: W.ink, marginTop: 18, opacity: ramp(f, 420, 434) }}>veyra-ccp.pages.dev</div>
          <div style={{ fontFamily: SANS, fontWeight: 760, fontSize: 72, letterSpacing: "-0.03em", color: W.red, marginTop: 40, opacity: ramp(f, 450, 458) * (1 - ramp(f, 520, 536)) }}>Your move.</div>
        </AbsoluteFill>
      )}
      <AbsoluteFill style={{ background: W.pearl, opacity: ramp(f, 524, 540) }} />
      <Flash at={0} len={10} />
    </AbsoluteFill>
  );
}
