import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

/**
 * The Veyra mark: two blades meeting at a point, each cut into two facets so the form reads as
 * folded metal without a gradient. The split at the vertex is deliberate: two parties, one
 * settlement. It is drawn in the current colour; `tile` sets it on a superellipse for app
 * icons and the favicon, where it needs more mass at 16 pixels.
 */
const BLADES = [
  { outer: "M5 9 30 58 24 33z", inner: "M5 9 24 33 12 16z" },
  { outer: "M59 9 34 58 40 33z", inner: "M59 9 40 33 52 16z" },
];
const TILE_BLADES = [
  { outer: "M12 15 31 52 26 34z", inner: "M12 15 26 34 17 21z" },
  { outer: "M52 15 33 52 38 34z", inner: "M52 15 38 34 47 21z" },
];
const TILE = "M32 2c23 0 30 7 30 30s-7 30-30 30S2 55 2 32 9 2 32 2z";

export function Mark({ size = 28, tile = false }: { size?: number; tile?: boolean }) {
  const blades = tile ? TILE_BLADES : BLADES;
  const fill = tile ? "var(--mark-cut, var(--bg))" : "currentColor";
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="mark">
      {tile && <path d={TILE} fill="currentColor" />}
      {blades.map((b, i) => (
        <g key={i} fill={fill}>
          <path d={b.outer} />
          <path d={b.inner} opacity={0.5} />
        </g>
      ))}
    </svg>
  );
}

export function Wordmark({ size = 26 }: { size?: number }) {
  return (
    <span className="wordmark" style={{ fontSize: size * 0.78 }}>
      <Mark size={size * 1.15} />
      <span>veyra</span>
    </span>
  );
}

export function Icon({ icon, size = 18, stroke = 1.6, className }: { icon: IconSvgElement; size?: number; stroke?: number; className?: string }) {
  return <HugeiconsIcon icon={icon} size={size} strokeWidth={stroke} className={className} color="currentColor" />;
}
