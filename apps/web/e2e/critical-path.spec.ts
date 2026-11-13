import { expect, test } from "@playwright/test";
import { e2eAccount, hasTestnetKey, installWallet } from "./wallet";

/** A brand-new visitor: onboarding, the first heist, and a result that survives a refresh. */
test("onboarding, first heist and result", async ({ page }) => {
  await page.goto("/play");
  // the tour opens on a first visit and can be walked to the end
  const tour = page.locator(".driver-popover");
  await expect(tour).toBeVisible();
  while (await tour.isVisible()) await page.locator(".driver-popover-next-btn").click();

  // the objective tells a new player exactly what to do, and its button does it
  await expect(page.getByRole("note", { name: "Your next step" })).toContainText("Crack vault 1");
  await page.locator(".quest-now").getByRole("link", { name: /Try the redirect/ }).click();
  await expect(page).toHaveURL(/\/play\/vault\/1\?move=redirect/);
  // the arena has its own short tour, which opens after a moment
  await expect(tour).toBeVisible({ timeout: 5_000 });
  while (await tour.isVisible()) await page.locator(".driver-popover-next-btn").click();

  await page.locator("[data-tour=run]").click();
  await expect(page.locator(".verdict.won")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".verdict")).toContainText("Vault 1 cracked");
  await expect(page).toHaveURL(/run=run_/);

  // deep link: the result is still there after a refresh
  await page.reload();
  await expect(page.locator(".verdict.won")).toBeVisible();
  // and the objective has moved on
  await expect(page.getByRole("note", { name: "Your next step" })).toContainText("Climb to vault 4");
});

/** A cancelled signature is explained in plain words, and nothing is charged. */
test("ranked entry cancelled in the wallet shows a readable error", async ({ page }) => {
  const ranked = (await (await page.request.get("/api/heist")).json()).ranked.enabled;
  test.skip(!ranked, "Ranked play is off on this server (no referee key).");
  await installWallet(page, { accountId: "someone.testnet", reject: true });
  await page.addInitScript(() => { localStorage.setItem("veyra.heist.tour.lobby", "1"); localStorage.setItem("veyra.heist.tour.arena", "1"); });
  await page.goto("/play/vault/1?confirm=ranked");
  const sheet = page.locator(".sheet");
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "Connect wallet" }).click();
  await expect(sheet.getByRole("button", { name: /Pay 0.1 NEAR and run/ })).toBeVisible();
  await expect(sheet).toContainText("Expected outcome");
  await sheet.getByRole("button", { name: /Pay 0.1 NEAR and run/ }).click();
  await expect(sheet).toContainText("You cancelled in your wallet. Nothing was sent.");
  await expect(sheet.getByRole("button", { name: "Try again" })).toBeVisible();
});

/** The full on-chain path on NEAR testnet: connect, confirm, sign, settle, see the result. */
test("connect wallet, ranked entry on testnet, settled result", async ({ page }, info) => {
  test.skip(!hasTestnetKey, "Set E2E_NEAR_ACCOUNT and E2E_NEAR_KEY (a funded testnet account) to run the on-chain test.");
  test.skip(info.project.name !== "desktop", "One real transaction per run is enough.");
  test.skip(!(await (await page.request.get("/api/heist")).json()).ranked.enabled, "Ranked play is off on this server.");
  await installWallet(page);
  await page.addInitScript(() => { localStorage.setItem("veyra.heist.tour.lobby", "1"); localStorage.setItem("veyra.heist.tour.arena", "1"); });
  await page.goto("/play");
  await page.getByRole("button", { name: "Connect wallet" }).first().click();
  await expect(page.getByRole("button", { name: `Wallet ${e2eAccount}` })).toBeVisible();
  await expect(page.locator(".bal.gold")).not.toContainText("…");

  // the honest move never cracks, so the test pays one small fee into the pot and takes nothing
  await page.goto("/play/vault/1?move=honest");
  await page.locator("[data-tour=ranked]").click();
  const sheet = page.locator(".sheet");
  await expect(sheet).toContainText("Entry fee");
  await expect(sheet).toContainText("vault 1 holds");
  await sheet.getByRole("button", { name: /Pay 0.1 NEAR and run/ }).click();
  await expect(sheet.locator(".tx-step.done", { hasText: "Done" })).toBeVisible({ timeout: 90_000 });
  await expect(sheet.getByRole("link", { name: /NearBlocks/ })).toBeVisible();
  await sheet.getByRole("button", { name: "Done" }).click();

  await expect(page.locator(".verdict.lost")).toBeVisible();
  await expect(page.locator(".verdict")).toContainText("settled on NEAR");
});
