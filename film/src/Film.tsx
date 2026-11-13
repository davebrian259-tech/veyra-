import type React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import cues from "./cues.json";
import { Finish } from "./ui/kit";
import { Five, Heist, Question } from "./v2/acts1";
import { Economy, Escalate, Finale } from "./v2/acts2";
import { W } from "./v2/type";

const S = cues.scenes as unknown as Record<string, [number, number]>;
const SCENES: [string, () => React.ReactElement][] = [["question", Question], ["five", Five], ["heist", Heist], ["escalate", Escalate], ["economy", Economy], ["finale", Finale]];

/** VEYRA: "one AI guards the money, another hunts it". Cuts land on the beat (96 BPM = 15 frames). */
export function Film() {
  return (
    <AbsoluteFill style={{ background: W.pearl }}>
      {SCENES.map(([id, Scene]) => (
        <Sequence key={id} name={id} from={S[id]![0]} durationInFrames={S[id]![1] - S[id]![0]}>
          <Scene />
        </Sequence>
      ))}
      <Finish grain={0.035} vignette={0.12} />
    </AbsoluteFill>
  );
}
