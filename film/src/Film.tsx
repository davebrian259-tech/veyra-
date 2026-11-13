import type React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import cues from "./cues.json";
import { Five, Open, Reveal } from "./scenes/Act1";
import { Build, Crack, Hold } from "./scenes/Act2";
import { Economy, Finale, Loot } from "./scenes/Act3";
import { Finish } from "./ui/kit";

const S = cues.scenes as unknown as Record<string, [number, number]>;
const SCENES: [string, () => React.ReactElement][] = [["open", Open], ["reveal", Reveal], ["five", Five], ["build", Build], ["crack", Crack], ["hold", Hold], ["economy", Economy], ["loot", Loot], ["finale", Finale]];

/** VEYRA HEIST, the launch film. Scenes cut on the beat (96 BPM = 15 frames at 24 fps). */
export function Film() {
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {SCENES.map(([id, Scene]) => (
        <Sequence key={id} name={id} from={S[id][0]} durationInFrames={S[id][1] - S[id][0]}>
          <Scene />
        </Sequence>
      ))}
      <Finish grain={0.07} vignette={0.7} />
    </AbsoluteFill>
  );
}
