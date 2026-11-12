import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests for the critical path. They run against a running app:
 *   pnpm dev:server   (API on :8787, with HEIST_CONTRACT_ID and a referee key for ranked play)
 *   pnpm dev:web      (web on :5173)
 * The on-chain test also needs E2E_NEAR_ACCOUNT and E2E_NEAR_KEY: a funded testnet account.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173", trace: "off" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "phone", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
  ],
});
