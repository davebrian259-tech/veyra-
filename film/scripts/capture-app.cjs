const { chromium } = require("playwright");
// Captures the running web app (pnpm dev:server + pnpm dev:web) for the film, light theme, 4K.
//   node scripts/capture-app.cjs   (writes public/app/*.jpg)
const OUT = require("node:path").resolve(__dirname, "../public/app") + "/";
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, colorScheme: "light", reducedMotion: "no-preference" });
  await ctx.addInitScript(() => { try { localStorage.setItem("veyra.theme", "light"); localStorage.setItem("veyra.heist.tour.lobby", "1"); localStorage.setItem("veyra.heist.tour.arena", "1"); } catch {} });
  const p = await ctx.newPage();
  const shot = async (name, opts = {}) => { await p.screenshot({ path: OUT + name + ".jpg", type: "jpeg", quality: 92, ...opts }); console.log("shot", name); };
  const go = async (u, wait = 2200) => { await p.goto("http://localhost:5173" + u, { waitUntil: "networkidle" }); await p.waitForTimeout(wait); };
  await go("/", 3000); await shot("landing"); await shot("landing-full", { fullPage: true });
  await go("/play"); await shot("lobby");
  await go("/play/vault/1"); await shot("arena1");
  await p.getByText("The redirect", { exact: true }).first().click(); await p.waitForTimeout(800); await shot("arena1-redirect");
  await p.locator('[data-tour="run"]').click();
  for (let i = 0; i < 16; i++) { await p.waitForTimeout(450); await shot("cam1-" + String(i).padStart(2, "0")); }
  await p.waitForTimeout(1500); await shot("arena1-result");
  await go("/play/vault/2"); await p.getByText("The redirect", { exact: true }).first().click(); await p.waitForTimeout(600);
  await p.locator('[data-tour="run"]').click(); await p.waitForTimeout(8000); await shot("arena2-result");
  for (const [u, n] of [["/play/leaderboard", "leaderboard"], ["/play/underwrite", "underwrite"], ["/play/loot", "loot"], ["/play/stats", "stats"], ["/play/learn", "learn"], ["/play/fast-forward", "fastforward"]]) { await go(u, 2600); await shot(n); }
  await b.close();
})();
