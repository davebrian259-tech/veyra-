import { AbsoluteFill, Freeze } from "remotion";
import { Finale } from "../v2/acts2";
import { Big, SANS, W } from "../v2/type";

/** The cover frame: the five vaults with every shield up, and the question. */
export function Cover() {
  return (
    <AbsoluteFill style={{ background: W.pearl }}>
      <Freeze frame={170}><Finale /></Freeze>
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(245,244,241,0.96) 0%, rgba(245,244,241,0.7) 30%, rgba(245,244,241,0) 55%)" }} />
      <Freeze frame={60}>
        <Big lines={["ONE AI GUARDS THE MONEY.", "ONE AI [STEALS] IT."]} at={0} size={104} style={{ left: 110, top: 80 }} />
      </Freeze>
      <div style={{ position: "absolute", right: 110, bottom: 80, fontFamily: SANS, fontWeight: 800, fontSize: 110, letterSpacing: "0.1em", color: W.ink }}>VEYRA</div>
    </AbsoluteFill>
  );
}
