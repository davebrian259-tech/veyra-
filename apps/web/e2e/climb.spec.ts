import { expect, test, type Page } from "@playwright/test";

/**
 * The whole practice game, played through the UI as a person would: each crack unlocks the next
 * move, vault 5 holds, and the objectives, leaderboard, replay check, palette and inspector all
 * reflect what happened.
 */
const CLIMB: [number, string][] = [[1, "The redirect"], [2, "Bait and switch"], [3, "The whisper"], [4, "The disguise"]];

async function freshPlayer(page: Page, callsign: string) {
  await page.addInitScript((c) => {
    localStorage.setItem("veyra.heist.tour.lobby", "1");
    localStorage.setItem("veyra.heist.tour.arena", "1");
    if (!localStorage.getItem("veyra.heist.progress")) localStorage.setItem("veyra.heist.progress", JSON.stringify({ callsign: c, cracked: [] }));
  }, callsign);
}

test("climb vaults 1 to 4, lose at vault 5, and see it everywhere", async ({ page }) => {
  test.setTimeout(240_000);
  const callsign = `qa-${Date.now().toString(36)}`;
  await freshPlayer(page, callsign);

  for (const [vault, move] of CLIMB) {
    await page.goto(`/play/vault/${vault}`);
    const btn = page.getByRole("button", { name: new RegExp(`^${move}`) });
    await expect(btn).toBeEnabled();
    await btn.click();
    await page.keyboard.press("r"); // the keyboard shortcut runs the heist
    await expect(page.locator(".verdict.won")).toContainText(`Vault ${vault} cracked`, { timeout: 30_000 });
    if (vault < 4) {
      // the next move is now unlocked
      const next = CLIMB[vault][1];
      await page.goto(`/play/vault/${vault + 1}`);
      await expect(page.getByRole("button", { name: new RegExp(`^${next}`) })).toBeEnabled();
    }
  }

  // vault 5 holds against the best move, and names the shield
  await page.goto("/play/vault/5");
  await page.getByRole("button", { name: /^The disguise/ }).click();
  await page.locator("[data-tour=run]").click();
  await expect(page.locator(".verdict.lost")).toContainText("Vault 5 holds", { timeout: 30_000 });
  await expect(page.locator(".verdict")).toContainText("Taint");

  // the climb shows in the top bar and the objectives move past the practice goals
  await page.goto("/play");
  await expect(page.locator(".bal").first()).toContainText("4/5");
  await expect(page.locator(".quest-list li.done")).toHaveCount(3);

  // the leaderboard pins you with vault 4 as your best
  await page.goto("/play/leaderboard");
  await expect(page.locator(".me-rank")).toContainText("You are #");
  await expect(page.locator("tr.is-me")).toContainText("4");

  // the inspector lists the agents you used
  await page.goto(`/play?player=${callsign}`);
  await expect(page.locator(".inspector")).toContainText("Agents");
  await expect(page.locator(".inspector .agent-list li").first()).toBeVisible();

  // any heist can be re-run to check the referee
  await page.locator(".inspector .feed a").first().click();
  await page.getByRole("button", { name: "Re-run and check the referee" }).click();
  await expect(page.getByText("Same outcome hash")).toBeVisible();

  // the palette jumps anywhere
  await page.keyboard.press("Control+k");
  await page.keyboard.type("stats");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Stats" })).toBeVisible();

  // fast-forward: a simulated week, scrubbed to the end, with NPC reasoning in the feed
  await page.goto("/play/fast-forward?seed=7");
  await expect(page.getByRole("button", { name: /Play the week/ })).toBeVisible({ timeout: 30_000 });
  await page.locator(".ff-scrub input").fill("167");
  await expect(page.getByRole("heading", { name: "The week in numbers" })).toBeVisible();
  await expect(page.locator(".ff-events li").first()).toBeVisible();
  await page.locator(".ff-why").first().click();
  await expect(page.locator(".explain-pop")).toBeVisible();
});
