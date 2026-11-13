/**
 * The first-run tour, built on driver.js. Steps point at stable `data-tour` attributes, never at
 * CSS classes, and skip any target that is not on screen (so the same tour works at 390px).
 */
export type TourId = "lobby" | "arena";
const SEEN = (id: TourId) => `veyra.heist.tour.${id}`;

const STEPS: Record<TourId, { el: string; title: string; text: string }[]> = {
  lobby: [
    { el: "featured", title: "Your next target", text: "Veyra holds a pot in five vaults. Start here: this is the vault you should try next." },
    { el: "quests", title: "Your objectives", text: "Always shows what to do next, worked out from your real runs, wallet and stakes." },
    { el: "vaults", title: "Five vaults, five difficulty levels", text: "Each vault switches on more of Veyra's real defences. A shield that is off is a way in." },
    { el: "activity", title: "Live heists", text: "Every heist anyone plays, as it happens. Ranked ones link to their transactions on NEAR." },
    { el: "wallet", title: "Practice is free", text: "You can play everything without a wallet. Connect a NEAR testnet wallet when you want the real pots." },
    { el: "palette", title: "Jump anywhere", text: "Press Ctrl K (⌘K on a Mac) to jump to any vault or action. Press ? for every shortcut." },
  ],
  arena: [
    { el: "moves", title: "Pick a move", text: "Each move is a ready-made rogue agent. More unlock as you crack vaults." },
    { el: "quote", title: "Tune your agent", text: "Your price, who gets paid, and what you deliver. Veyra's defences check all three." },
    { el: "shields", title: "Read the shields", text: "Lit shields are on. Dashed ones are holes. Tap any shield to see what it blocks." },
    { el: "run", title: "Run the heist", text: "Free, instant, play money. Press R from anywhere on this screen." },
    { el: "ranked", title: "Then play for real", text: "Ranked pays the entry fee in testnet NEAR. Crack the vault and the contract pays you the whole pot." },
  ],
};

export const tourSeen = (id: TourId) => { try { return localStorage.getItem(SEEN(id)) === "1"; } catch { return true; } };

export async function startTour(id: TourId) {
  const { driver } = await import("driver.js");
  await import("driver.js/dist/driver.css");
  const visible = (sel: string) => { const n = document.querySelector<HTMLElement>(`[data-tour="${sel}"]`); return n && n.offsetParent !== null ? n : null; };
  const steps = STEPS[id].filter((s) => visible(s.el)).map((s) => ({ element: `[data-tour="${s.el}"]`, popover: { title: s.title, description: s.text } }));
  if (!steps.length) return;
  // shown once counts as seen, however it ends (finished, skipped, closed, or navigated away)
  try { localStorage.setItem(SEEN(id), "1"); } catch { /* storage blocked */ }
  const d = driver({
    showProgress: true, allowClose: true, overlayOpacity: 0.65, stagePadding: 6, stageRadius: 18, popoverClass: "veyra-tour",
    nextBtnText: "Next", prevBtnText: "Back", doneBtnText: "Let's play", progressText: "{{current}} of {{total}}",
    animate: !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    steps,
  });
  d.drive();
}
