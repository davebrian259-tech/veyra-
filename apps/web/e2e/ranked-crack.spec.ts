import { expect, test } from "@playwright/test";
import { callFromTestAccount, e2eAccount, hasTestnetKey, installWallet, testAccountBalance } from "./wallet";

/**
 * Winning for real: a ranked crack of vault 1 on testnet, paid by the pot contract to the player's
 * wallet. Opt-in (E2E_RANKED_CRACK=1) because it empties vault 1's pot; the test seeds it again.
 */
test("ranked crack pays the pot to the player's wallet", async ({ page }, info) => {
  test.skip(!hasTestnetKey || process.env.E2E_RANKED_CRACK !== "1", "Set E2E_RANKED_CRACK=1 and a testnet key to run.");
  test.skip(info.project.name !== "desktop", "Once is enough.");
  test.setTimeout(240_000);
  await installWallet(page);
  await page.addInitScript(() => { localStorage.setItem("veyra.heist.tour.lobby", "1"); localStorage.setItem("veyra.heist.tour.arena", "1"); localStorage.setItem("near-wallet-selector:selectedWalletId", "e2e"); });
  const lobby = await (await page.request.get("/api/heist")).json();
  const contract = lobby.ranked.contractId as string;
  const pot = BigInt(lobby.vaults[0].chain.potYocto);
  const before = await testAccountBalance();

  await page.goto("/play/vault/1?move=redirect");
  await expect(page.getByRole("button", { name: `Wallet ${e2eAccount}` })).toBeVisible();
  await page.locator("[data-tour=ranked]").click();
  const sheet = page.locator(".sheet");
  await expect(sheet).toContainText("cracks vault 1");
  await sheet.getByRole("button", { name: /Pay 0.1 NEAR and run/ }).click();
  await expect(sheet.locator(".tx-step.done", { hasText: "Done" })).toBeVisible({ timeout: 90_000 });
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(page.locator(".verdict.won")).toContainText("Vault 1 cracked", { timeout: 30_000 });
  await expect(page.locator(".verdict")).toContainText("The pot contract paid you");

  // the wallet gained the pot (minus gas): fee out, pot + fee back
  await expect.poll(async () => (await testAccountBalance()) - before, { timeout: 30_000 }).toBeGreaterThan((pot * 9n) / 10n);

  // put the pot back so the next players have something to take
  await callFromTestAccount(contract, "seed", { vault: 1 }, pot > 0n ? pot : 2n * 10n ** 23n);
});
