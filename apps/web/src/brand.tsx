import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

/**
 * The Veyra mark: a typographic V with stroke contrast (a heavy left arm, a hairline right arm)
 * set on a superellipse. The contrast gives it a voice; the superellipse keeps it soft. It is
 * one path in one colour and still reads at 16 pixels.
 */
const TILE = "M16 1C27.5 1 31 4.5 31 16s-3.5 15-15 15S1 27.5 1 16 4.5 1 16 1z";
const V = "M7.2 8.5h5.2l4.6 11.2L22.9 8.5h2.6L17.6 25h-3z";

export function Mark({ size = 28, tile = true }: { size?: number; tile?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="mark">
      {tile && <path d={TILE} fill="currentColor" />}
      <path d={V} fill={tile ? "var(--mark-cut, var(--bg))" : "currentColor"} />
    </svg>
  );
}

export function Wordmark({ size = 26 }: { size?: number }) {
  return (
    <span className="wordmark" style={{ fontSize: size * 0.74 }}>
      <Mark size={size} />
      <span>veyra</span>
    </span>
  );
}

export function Icon({ icon, size = 18, stroke = 1.6, className }: { icon: IconSvgElement; size?: number; stroke?: number; className?: string }) {
  return <HugeiconsIcon icon={icon} size={size} strokeWidth={stroke} className={className} color="currentColor" />;
}
