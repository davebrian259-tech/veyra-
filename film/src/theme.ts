import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";

/** The film's palette: Veyra's graphite, gold for money, one tone per vault. */
export const C = {
  black: "#060607", ink: "#0e0e10", steel: "#232327", line: "#3e3e45", mute: "#63636e", dim: "#9a9aa6", soft: "#c9c9d2", white: "#f2f2f5",
  gold: "#f5c451", goldDeep: "#b8891a",
};
export const TONE: Record<number, { a: string; b: string; name: string }> = {
  1: { a: "#34d399", b: "#065f46", name: "mint" },
  2: { a: "#60a5fa", b: "#1e3a8a", name: "sky" },
  3: { a: "#a78bfa", b: "#4c1d95", name: "violet" },
  4: { a: "#fbbf24", b: "#92400e", name: "amber" },
  5: { a: "#f43f5e", b: "#7f1d1d", name: "crimson" },
};
export const SANS = "'Geist Variable', ui-sans-serif, system-ui";
export const MONO = "'Geist Mono Variable', ui-monospace, monospace";
export const SERIF = "'Instrument Serif', Georgia, serif";
