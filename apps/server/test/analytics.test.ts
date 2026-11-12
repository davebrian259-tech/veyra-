import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { analyticsMarkdown, marketAnalytics } from "../src/watchtower/analytics.js";

describe("market analytics and the evidence page", () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => close?.());

  it("measures the scanned market and shows what GUARD would do with it", async () => {
    const built = await buildApp(loadConfig({ NODE_ENV: "test", DATABASE_PATH: ":memory:", VEYRA_MODE: "sim" }));
    close = () => built.app.close();
    expect(marketAnalytics(built.ctx.db, built.ctx.guard)).toBeNull(); // no scan yet
    await built.ctx.watchtower.scan();
    const a = marketAnalytics(built.ctx.db, built.ctx.guard)!;
    expect(a.headline.agents).toBe(8);
    expect(a.headline.answering).toBe(8);
    expect(a.headline.flagged).toBe(2);
    expect(a.headline.top10ShareOfJobsPct).toBe(100);
    expect(a.headline.jobsGini).toBeGreaterThan(0);
    expect(a.prices.listed.p50).toBeGreaterThan(0);
    expect(a.categories.reduce((n, c) => n + c.agents, 0)).toBe(8);
    expect(a.guard.quotesChecked).toBe(8);
    expect(a.guard.decisions.block).toBeGreaterThanOrEqual(2); // payee swap and bait-and-switch, at least
    expect(a.guard.blockReasons.map((r) => r.rule)).toEqual(expect.arrayContaining(["payee_not_pinned", "price_mismatch"]));
    expect(a.topAgents[0].deliveredJobs).toBeGreaterThanOrEqual(a.topAgents[1].deliveredJobs);
    const md = analyticsMarkdown(a);
    expect(md).toContain("| Agents listed | 8 |");
    expect(md).toContain("`payee_not_pinned`");

    const res = await built.app.inject({ method: "GET", url: "/watchtower/analytics" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).headline.agents).toBe(8);

    const ev = JSON.parse((await built.app.inject({ method: "GET", url: "/evidence" })).body);
    expect(ev.ledger.contractId).toBe("ledger.veyra.sim");
    expect(ev.reports).toHaveLength(2);
    expect(ev.anchors.length).toBeGreaterThan(0);
    expect(ev.scans[0].root).toMatch(/^[0-9a-f]{64}$/);
  });
});
