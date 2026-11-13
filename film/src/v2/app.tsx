import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { clamp, easeIO, ramp } from "../ui/kit";
import { Big, Flash, MONO, SANS, Tag, W } from "./type";

/**
 * Real captures of the Veyra web app (light theme, 3840x2160, captured from the running app by
 * scripts/capture-app.cjs). A Shot frames one of them like a camera: it centres a focal point
 * (x, y in 1920x1080 page pixels) at scale s, and moves between two framings.
 */
type Frame = { x: number; y: number; s: number };
export function Shot({ src, a, b, from, to, w = 1920, h = 1080, cx = 960, cy = 540 }: { src: string; a: number; b: number; from: Frame; to: Frame; w?: number; h?: number; cx?: number; cy?: number }) {
  const f = useCurrentFrame();
  const p = interpolate(f, [a, b], [0, 1], { ...clamp, easing: easeIO });
  const x = from.x + (to.x - from.x) * p, y = from.y + (to.y - from.y) * p, s = from.s + (to.s - from.s) * p;
  return (
    <Img src={staticFile(`app/${src}`)} style={{ position: "absolute", left: 0, top: 0, width: w, height: h, transformOrigin: "0 0", transform: `translate(${cx - x * s}px, ${cy - y * s}px) scale(${s})` }} />
  );
}

/** A soft pearl band behind headline type laid over app footage. */
export function Band({ top = 0, height = 300, o = 1 }: { top?: number; height?: number; o?: number }) {
  return <div style={{ position: "absolute", left: 0, right: 0, top, height, opacity: o, background: "linear-gradient(180deg, rgba(245,244,241,0.97) 0%, rgba(245,244,241,0.93) 70%, rgba(245,244,241,0) 100%)" }} />;
}
export function BottomBand({ height = 360, o = 1 }: { height?: number; o?: number }) {
  return <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height, opacity: o, background: "linear-gradient(0deg, rgba(245,244,241,0.98) 0%, rgba(245,244,241,0.94) 65%, rgba(245,244,241,0) 100%)" }} />;
}

/* ---------------------------------------------------------------- the whole app, in one pass */
const PAGES = [
  { src: "landing.jpg", url: "veyra-ccp.pages.dev", label: "The front door", focus: { x: 960, y: 520 } },
  { src: "lobby.jpg", url: "/play", label: "Five vaults", focus: { x: 900, y: 560 } },
  { src: "arena1-redirect.jpg", url: "/play/vault/1", label: "Build your rogue", focus: { x: 1150, y: 480 } },
  { src: "arena2-result.jpg", url: "/play/vault/2", label: "Every heist, replayed", focus: { x: 900, y: 640 } },
  { src: "leaderboard.jpg", url: "/play/leaderboard", label: "Leaderboard", focus: { x: 900, y: 520 } },
  { src: "underwrite.jpg", url: "/play/underwrite", label: "Back a vault", focus: { x: 900, y: 600 } },
  { src: "stats.jpg", url: "/play/stats", label: "Live stats", focus: { x: 1000, y: 620 } },
  { src: "loot.jpg", url: "/play/loot", label: "Loot · NEP-245", focus: { x: 900, y: 520 } },
];
export const APP_LEN = 168;
const STEP = 18;
const START = 22;

function Window({ children, url }: { children: React.ReactNode; url: string }) {
  return (
    <div style={{ position: "absolute", left: 150, top: 250, width: 1620, height: 790, borderRadius: 28, overflow: "hidden", background: "#fff", boxShadow: "0 40px 120px rgba(20,18,14,0.18), 0 0 0 2px rgba(20,18,14,0.06)" }}>
      <div style={{ height: 56, background: "#f1efea", display: "flex", alignItems: "center", gap: 12, padding: "0 22px", borderBottom: "2px solid #e4e1da" }}>
        {["#f87171", "#fbbf24", "#34d399"].map((c) => <span key={c} style={{ width: 16, height: 16, borderRadius: 99, background: c }} />)}
        <div style={{ marginLeft: 24, flex: 1, height: 36, borderRadius: 10, background: "#fff", display: "flex", alignItems: "center", padding: "0 18px", fontFamily: MONO, fontSize: 24, color: W.grey }}>{url}</div>
      </div>
      <div style={{ position: "absolute", left: 0, top: 56, right: 0, bottom: 0, overflow: "hidden" }}>{children}</div>
    </div>
  );
}

export function AppTour() {
  const f = useCurrentFrame();
  const idx = Math.max(0, Math.min(PAGES.length - 1, Math.floor((f - START) / STEP)));
  const pg = PAGES[idx]!;
  const local = f - START - idx * STEP;
  const slide = f < START ? 0 : interpolate(local, [0, 6], [60, 0], { ...clamp, easing: easeIO });
  const enter = ramp(f, 0, 14);
  return (
    <AbsoluteFill style={{ background: W.pearl }}>
      <div style={{ position: "absolute", inset: 0, opacity: enter, transform: `translateY(${(1 - enter) * 80}px)` }}>
        <Window url={pg.url}>
          <div style={{ position: "absolute", inset: 0, transform: `translateX(${slide}px)`, opacity: f < START ? 1 : ramp(local, 0, 4) }}>
            <Shot src={pg.src} a={START + idx * STEP} b={START + idx * STEP + STEP + 6} from={{ ...pg.focus, s: 0.86 }} to={{ ...pg.focus, s: 0.95 }} cx={810} cy={367} />
          </div>
        </Window>
      </div>
      <Big lines={["THE WHOLE GAME.", "[IN YOUR BROWSER.]"]} at={2} out={START - 2} size={110} accent={W.grey} style={{ left: 150, top: 30 }} />
      {f >= START && (
        <div key={idx} style={{ position: "absolute", left: 150, top: 70, display: "flex", alignItems: "baseline", gap: 36 }}>
          <div style={{ fontFamily: MONO, fontWeight: 600, fontSize: 56, color: W.tone[idx % 5] }}>{String(idx + 1).padStart(2, "0")}</div>
          <div style={{ fontFamily: SANS, fontWeight: 780, fontSize: 120, letterSpacing: "-0.045em", color: W.ink, lineHeight: 1, transform: `translateY(${(1 - ramp(local, 0, 6)) * 30}px)`, opacity: ramp(local, 0, 5) }}>{pg.label}</div>
        </div>
      )}
      <Tag at={START} size={46} style={{ right: 150, top: 120 }}>Real app · testnet</Tag>
      <Flash at={0} len={8} />
    </AbsoluteFill>
  );
}
