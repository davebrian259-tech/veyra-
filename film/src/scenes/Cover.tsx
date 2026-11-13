import { AbsoluteFill, Sequence } from "remotion";
import { Finale } from "../v2/acts2";
import { Big, SANS, W } from "../v2/type";

/** The cover frame: the five vaults with every shield up, and the question. */
export function Cover() {
  return (
    <AbsoluteFill style={{ background: W.pearl }}>
      <Sequence from={-172}><Finale /></Sequence>
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(245,244,241,1) 0%, rgba(245,244,241,1) 27%, rgba(245,244,241,0) 40%)" }} />
      <Sequence from={-60}>
        <Big lines={["ONE AI GUARDS THE MONEY.", "ONE AI [STEALS] IT."]} at={0} size={104} style={{ left: 110, top: 80 }} />
      </Sequence>
      <div style={{ position: "absolute", right: 110, bottom: 80, fontFamily: SANS, fontWeight: 800, fontSize: 110, letterSpacing: "0.1em", color: W.ink }}>VEYRA</div>
    </AbsoluteFill>
  );
}
