import { Composition, Still } from "remotion";
import cues from "./cues.json";
import { Film } from "./Film";
import { Cover } from "./scenes/Cover";
import "./theme";

export function Root() {
  return (
    <>
      <Composition id="VeyraHeist" component={Film} durationInFrames={cues.duration} fps={cues.fps} width={1920} height={1080} />
      <Still id="Cover" component={Cover} width={1920} height={1080} />
    </>
  );
}
