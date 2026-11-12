import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

/**
 * The Veyra mark: a V cut as one sharp stroke on a rounded square. One shape, one colour, and it
 * still reads at 16 pixels. `tile={false}` draws the V alone in the current colour.
 */
export function Mark({ size = 28, tile = true }: { size?: number; tile?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="mark">
      {tile && <rect width="32" height="32" rx="8.5" fill="currentColor" />}
      <path d="M8 9 16 25.5 24 9" fill="none" stroke={tile ? "var(--mark-cut, var(--bg))" : "currentColor"} strokeWidth="4.4" strokeLinejoin="miter" strokeMiterlimit="6" />
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
