import { ThreeCanvas } from "@remotion/three";
import { AbsoluteFill } from "remotion";
import { C, MONO, SANS, SERIF, TONE } from "../theme";
import { Lights, Stage } from "../three/Stage";
import { Vault } from "../three/Vault";
import { Finish, Mark } from "../ui/kit";

/** The cover frame: Veyra's door, ajar, gold spilling out; the title set like a film poster. */
export function Cover() {
  return (
    <AbsoluteFill style={{ background: C.black }}>
      <ThreeCanvas width={1920} height={1080} gl={{ antialias: true }}>
        <Stage cam={[0.6, 0.55, 7.4]} look={[2.2, 0.1, 0]} fov={34} fog={[4, 18]}>
          <Lights rim={TONE[5].a} rimI={3} />
          <Vault tone={TONE[5].a} lit={8} t={2.4} wheel={1.1} bars={1} open={0.62} glow={1} field={0.08} />
        </Stage>
      </ThreeCanvas>
      <AbsoluteFill style={{ background: `linear-gradient(90deg, transparent 38%, ${C.black}aa 58%, ${C.black}ee 100%)` }} />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "flex-end", paddingRight: 140 }}>
        <div style={{ textAlign: "right" }}>
          <Mark size={96} />
          <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: 118, letterSpacing: "0.22em", color: C.white, marginTop: 26, paddingLeft: "0.22em" }}>VEYRA</div>
          <div style={{ fontFamily: SANS, fontWeight: 700, fontSize: 118, letterSpacing: "0.22em", color: C.gold, marginTop: -16 }}>HEIST</div>
          <div style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: 50, color: C.soft, marginTop: 22 }}>Veyra holds the pot. Take it.</div>
          <div style={{ fontFamily: MONO, fontSize: 20, color: C.mute, letterSpacing: "0.3em", marginTop: 40 }}>FIVE VAULTS · ONE AI · REAL POTS</div>
        </div>
      </AbsoluteFill>
      <Finish grain={0.06} vignette={0.65} />
    </AbsoluteFill>
  );
}
