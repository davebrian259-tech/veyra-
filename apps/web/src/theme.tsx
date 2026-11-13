import { useEffect, useState } from "react";
import { Moon02Icon, Sun03Icon } from "@hugeicons/core-free-icons";
import { Icon } from "./brand";

/** Light or dark, for the whole site. Dark is the default; the choice is remembered. */
export type Theme = "dark" | "light";
const KEY = "veyra.theme";

export const currentTheme = (): Theme => (document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark");

export function setTheme(t: Theme) {
  document.documentElement.setAttribute("data-theme", t);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "light" ? "#f2f2f5" : "#0e0e10");
  try { localStorage.setItem(KEY, t); } catch { /* storage blocked */ }
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [t, setT] = useState<Theme>(currentTheme);
  useEffect(() => {
    const mo = new MutationObserver(() => setT(currentTheme()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);
  return [t, setTheme];
}

export function ThemeToggle({ className }: { className?: string }) {
  const [t, set] = useTheme();
  const next = t === "dark" ? "light" : "dark";
  return (
    <button type="button" className={`btn ghost sm icon theme-toggle ${className ?? ""}`} onClick={() => set(next)} aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}>
      <Icon icon={t === "dark" ? Sun03Icon : Moon02Icon} size={18} />
    </button>
  );
}
