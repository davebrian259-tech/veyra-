/** Game feel: sound cues (off by default), confetti on a crack, and the reduced-motion check. */
export type Cue = "tick" | "hold" | "crack" | "unlock";

export const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const soundOn = () => { try { return localStorage.getItem("veyra.heist.sound") === "on"; } catch { return false; } };

let howls: Promise<Record<Cue, import("howler").Howl>> | null = null;
function load() {
  return (howls ??= import("howler").then(({ Howl }) => {
    const mk = (c: Cue, volume: number) => new Howl({ src: [`/sfx/${c}.wav`], volume, preload: true });
    return { tick: mk("tick", 0.25), hold: mk("hold", 0.5), crack: mk("crack", 0.5), unlock: mk("unlock", 0.45) };
  }));
}

/** Plays a cue if the player turned sound on. Loads howler only then. */
export function play(cue: Cue, force = false) {
  if (!force && !soundOn()) return;
  void load().then((h) => h[cue].play()).catch(() => undefined);
}

/** A short gold-and-tone confetti burst from the verdict card. Skipped for reduced motion. */
export function celebrate(tone: string, origin?: { x: number; y: number }) {
  if (reducedMotion()) return;
  void import("canvas-confetti").then(({ default: confetti }) => {
    const o = origin ?? { x: 0.5, y: 0.45 };
    confetti({ particleCount: 90, spread: 70, startVelocity: 38, origin: o, colors: ["#f5c451", tone, "#ffffff"], disableForReducedMotion: true, zIndex: 80 });
    setTimeout(() => confetti({ particleCount: 50, spread: 110, startVelocity: 28, origin: o, colors: ["#f5c451", tone], disableForReducedMotion: true, zIndex: 80 }), 180);
  });
}
