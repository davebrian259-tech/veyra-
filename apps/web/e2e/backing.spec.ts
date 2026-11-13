import { expect, test } from "@playwright/test";
import { e2eAccount, hasTestnetKey, installWallet } from "./wallet";

/** Back a vault with real testnet NEAR, see the stake from the contract, then withdraw it. */
test("back a vault on testnet, then withdraw", async ({ page }, info) => {
  test.skip(!hasTestnetKey, "Set E2E_NEAR_ACCOUNT and E2E_NEAR_KEY to run on-chain tests.");
  test.skip(info.project.name !== "desktop", "One run of each on-chain test is enough.");
  test.setTimeout(240_000);
  await installWallet(page);
  await page.addInitScript(() => { localStorage.setItem("veyra.heist.tour.lobby", "1"); localStorage.setItem("veyra.heist.tour.arena", "1"); localStorage.setItem("near-wallet-selector:selectedWalletId", "e2e"); });
  await page.goto("/play/underwrite");
  await expect(page.getByRole("button", { name: `Wallet ${e2eAccount}` })).toBeVisible();

  const card = page.locator(".back-card", { hasText: "Veyra" });
  await card.getByLabel("Stake (testnet NEAR)").fill("0.1");
  await card.getByRole("button", { name: "Back vault 5" }).click();
  const sheet = page.locator(".sheet");
  await expect(sheet).toContainText("Your stake");
  await expect(sheet).toContainText("of vault 5's backing");
  await sheet.getByRole("button", { name: "Stake 0.1 NEAR" }).click();
  await expect(sheet.locator(".tx-step.done", { hasText: "Done" })).toBeVisible({ timeout: 90_000 });
  await sheet.getByRole("button", { name: "Done" }).click();

  // the stake is read back from the contract
  await expect(card).toContainText("Your stake", { timeout: 30_000 });
  await expect(card.getByRole("button", { name: "Withdraw" })).toBeEnabled();
  await card.getByRole("button", { name: "Withdraw" }).click();
  await expect(sheet).toContainText("You receive your stake");
  await sheet.getByRole("button", { name: "Withdraw" }).click();
  await expect(sheet.locator(".tx-step.done", { hasText: "Done" })).toBeVisible({ timeout: 90_000 });
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(card).not.toContainText("Your stake", { timeout: 30_000 });
});
