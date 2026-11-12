import type { IconSvgElement } from "@hugeicons/react";
import { Bug01Icon, SafeIcon, DashboardSquare01Icon, IdentityCardIcon, Radar01Icon, SecurityCheckIcon, Settings01Icon, Store01Icon, Wallet01Icon } from "@hugeicons/core-free-icons";

/**
 * The information architecture. Every feature in the server is reachable from one of these
 * destinations in three taps or fewer; the command palette lists them all plus deep actions.
 */
export interface Destination {
  path: string;
  label: string;
  short: string;
  icon: IconSvgElement;
  blurb: string;
  prefetch: string[];
  simOnly?: boolean;
  group: "run" | "trust" | "setup";
  /** Shown in the phone bottom bar (five slots). */
  bottom?: boolean;
}

export const DESTINATIONS: Destination[] = [
  { path: "/play", label: "Play Heist", short: "Heist", icon: SafeIcon, blurb: "Build a rogue agent and try to rob Veyra.", prefetch: ["/heist"], group: "run" },
  { path: "/app", label: "Business", short: "Business", icon: DashboardSquare01Icon, blurb: "Revenue, margin, contracts, and the owner's controls.", prefetch: ["/ledger", "/contractor/status", "/contracts", "/mandate"], group: "run", bottom: true },
  { path: "/app/market", label: "Market", short: "Market", icon: Store01Icon, blurb: "Browse agents, ask for free quotes, and see what GUARD would do.", prefetch: ["/market/agents?q=research"], group: "run", bottom: true },
  { path: "/app/treasury", label: "Treasury", short: "Treasury", icon: Wallet01Icon, blurb: "The vault, the spend account, payouts, sales, and the public ledger.", prefetch: ["/treasury", "/ledger", "/sales"], group: "run", bottom: true },
  { path: "/app/watchtower", label: "Watchtower", short: "Watch", icon: Radar01Icon, blurb: "Payment integrity across the whole market, with anchored proof.", prefetch: ["/watchtower", "/watchtower/analytics"], group: "trust", bottom: true },
  { path: "/app/lab", label: "Attack lab", short: "Lab", icon: Bug01Icon, blurb: "Hostile agents try to rob Veyra. Watch each attempt fail.", prefetch: [], group: "trust", simOnly: true },
  { path: "/app/evidence", label: "Evidence", short: "Proof", icon: SecurityCheckIcon, blurb: "What is on NEAR: the ledger contract, anchors, reports, and receipts you can verify.", prefetch: ["/evidence"], group: "trust" },
  { path: "/app/identity", label: "Identity & hiring", short: "Identity", icon: IdentityCardIcon, blurb: "Veyra's signed credential and the three ways to hire it.", prefetch: ["/kya"], group: "setup" },
  { path: "/app/settings", label: "Settings", short: "Settings", icon: Settings01Icon, blurb: "Integrations, the market connection, the vault, notifications, and the audit log.", prefetch: ["/contractor/status"], group: "setup" },
];

export const GROUPS: Record<Destination["group"], string> = { run: "Run", trust: "Trust", setup: "Set up" };

export function destinationFor(pathname: string) {
  return [...DESTINATIONS].sort((a, b) => b.path.length - a.path.length).find((d) => pathname === d.path || pathname.startsWith(`${d.path}/`)) ?? DESTINATIONS[0];
}
