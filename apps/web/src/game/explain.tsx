import { useEffect, useRef, type ReactNode } from "react";
import { animate, useInView } from "motion/react";
import { Popover, Tooltip } from "radix-ui";
import { reducedMotion } from "./fx";

/**
 * Explains a number: tap, click or focus the value to see what it means and how it is worked out.
 * A popover rather than a hover tooltip, so it works on touch and with a keyboard.
 */
export function Explain({ children, title, what, how, className }: { children: ReactNode; title: string; what: ReactNode; how?: ReactNode; className?: string }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className={`explain ${className ?? ""}`} aria-label={`${title}: what this means`}>{children}</button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="explain-pop arena-portal" sideOffset={8} collisionPadding={12}>
          <b>{title}</b>
          <p>{what}</p>
          {how && <p className="how"><span>How it is worked out</span>{how}</p>}
          <Popover.Arrow className="explain-arrow" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** A tooltip for a control, with its keyboard shortcut. The control keeps its own accessible name. */
export function Tip({ children, label, keys }: { children: ReactNode; label: string; keys?: string[] }) {
  return (
    <Tooltip.Root delayDuration={350}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tip arena-portal" sideOffset={6}>
          {label}{keys && <span className="tip-keys">{keys.map((k) => <kbd key={k}>{k}</kbd>)}</span>}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/** Counts up to a value when it first comes into view, and on every change after. */
export function Ticker({ value, digits = 2, className }: { value: number; digits?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(0);
  const inView = useInView(ref, { once: true });
  useEffect(() => {
    const el = ref.current;
    if (!el || !inView) return;
    if (reducedMotion()) { el.textContent = value.toFixed(digits); prev.current = value; return; }
    const c = animate(prev.current, value, { duration: 0.9, ease: [0.2, 0.7, 0.2, 1], onUpdate: (v) => { el.textContent = v.toFixed(digits); } });
    prev.current = value;
    return () => c.stop();
  }, [value, digits, inView]);
  return <span ref={ref} className={className}>{value.toFixed(digits)}</span>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}
