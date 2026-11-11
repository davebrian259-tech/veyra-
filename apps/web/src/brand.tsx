import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

/**
 * Veyra's mark: two stacked rounded squares (the vault behind, the spend account in front)
 * with a V cut through the front one. Drawn for this project; works in one colour.
 */
export function Mark({ size = 28, accent = true }: { size?: number; accent?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="mark">
      <rect x="9" y="9" width="21" height="21" rx="6" fill={accent ? "var(--accent)" : "none"} stroke={accent ? "none" : "currentColor"} strokeWidth="1.5" />
      <rect x="2" y="2" width="21" height="21" rx="6" fill="currentColor" />
      <path d="M7.5 8.5 12.5 17l5-8.5" fill="none" stroke="var(--mark-cut, var(--bg))" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Wordmark({ size = 26 }: { size?: number }) {
  return (
    <span className="wordmark" style={{ fontSize: size * 0.72 }}>
      <Mark size={size} />
      <span>veyra</span>
    </span>
  );
}

export function Icon({ icon, size = 18, stroke = 1.6, className }: { icon: IconSvgElement; size?: number; stroke?: number; className?: string }) {
  return <HugeiconsIcon icon={icon} size={size} strokeWidth={stroke} className={className} color="currentColor" />;
}
