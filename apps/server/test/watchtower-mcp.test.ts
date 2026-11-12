import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { verifyCredential } from "../src/contractor/identity.js";
import { judge } from "../src/watchtower/scanner.js";

const treasury = [{ network: "near:mainnet", asset: "usdc.near", payTo: "treasury.near" }];
const agent = { agent_id: "a1", handle: "agent-one", name: "Agent One", description: "", category: "research", tags: [], delivered_jobs: 10, success_rate: 95, sla_seconds: 120, available_now: true };
const plan = { is_default: true, price_amount: "0.50", sla_seconds: 120 };
const row = { scheme: "exact" as const, network: "near:mainnet", asset: "usdc.near", amount: "500000", payTo: "treasury.near", maxTimeoutSeconds: 720 };

describe("Watchtower judging rules", () => {
  it("passes an honest challenge", () => {
    expect(judge(agent, plan, { x402Version: 2, accepts: [row] }, treasury, null).verdict).toBe("ok");
  });
  it("flags payee swaps, foreign assets, wrong networks and price mismatches", () => {
    const v = (r: Partial<typeof row>) => judge(agent, plan, { x402Version: 2, accepts: [{ ...row, ...r }] }, treasury, null);
    expect(v({ payTo: "attacker.near" }).findings[0].check).toBe("payee");
    expect(v({ asset: "fake.near" }).findings[0].check).toBe("asset");
    expect(v({ network: "eip155:8453" }).findings[0].check).toBe("network");
    expect(v({ amount: "5000000" }).findings.map((f) => f.check)).toContain("price");
    expect(v({ payTo: "x" }).verdict).toBe("flagged");
    // Charging less than listed harms nobody: not flagged.
    expect(v({ amount: "1" }).verdict).toBe("ok");
  });
  it("warns on unpublished prices and odd payment windows, and marks unreachable agents offline", () => {
    expect(judge(agent, null, { x402Version: 2, accepts: [row] }, treasury, null).verdict).toBe("warn");
    expect(judge(agent, plan, { x402Version: 2, accepts: [{ ...row, maxTimeoutSeconds: 99_999 }] }, treasury, null).findings[0].check).toBe("validity_window");
    const long = judge(agent, { ...plan, sla_seconds: 1_209_600 }, { x402Version: 2, accepts: [{ ...row, maxTimeoutSeconds: 1_210_200 }] }, treasury, null);
    expect(long.verdict).toBe("warn"); // SLA-driven, allowed by the spec
    expect(long.findings.map((f) => f.check)).toEqual(["long_validity"]);
    expect(judge(agent, plan, null, treasury, "no reachable backend").verdict).toBe("offline");
  });
});

describe("Watchtower, KYA and MCP (simulator)", () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => close?.());

  async function boot() {
    const built = await buildApp(loadConfig({ NODE_ENV: "test", DATABASE_PATH: ":memory:", VEYRA_MODE: "sim" }));
    await built.app.listen({ port: 0, host: "127.0.0.1" });
    const addr = built.app.server.address() as { port: number };
    close = () => built.app.close();
    return { ...built, base: `http://127.0.0.1:${addr.port}` };
  }

  it("scans the market, flags exactly the dishonest agents, and files verifiable reports", async () => {
    const t = await boot();
    const r = (await t.ctx.watchtower.scan()) as { total: number; flagged: number };
    expect(r.total).toBe(8);
    const latest = t.ctx.watchtower.latest();
    const flagged = (latest.results as { handle: string; verdict: string; evidence_hash: string; report_ref: string }[]).filter((x) => x.verdict === "flagged");
    expect(flagged.map((f) => f.handle).sort()).toEqual(["bait-switch", "payee-swapper"]);
    for (const f of flagged) {
      expect(f.report_ref).toMatch(/^SIM/); // filed to the (simulated) ledger contract
      expect(t.ctx.watchtower.evidence(f.evidence_hash).hashMatches).toBe(true);
      expect(t.ctx.guard.counterparty(f.handle).blocked).toBe(1); // Veyra will never pay them
    }
    expect(t.ctx.sim!.chain.log.filter((l) => l.kind === "ledger_report")).toHaveLength(2);
    const look = await t.ctx.watchtower.lookup("scout-research");
    expect(look.safeToPay).toBe(true);
    expect((await t.ctx.watchtower.lookup("payee-swapper")).safeToPay).toBe(false);
  });

  it("issues a signed KYA credential and an A2A agent card", async () => {
    const t = await boot();
    const kya = await (await fetch(`${t.base}/kya`)).json();
    expect(kya.credential.standard).toBe("veyra-kya/1");
    expect(kya.credential.controls.spendAccount).toBe(t.ctx.spend.accountId);
    expect(verifyCredential(kya)).toEqual({ hashMatches: true, signatureValid: true });
    expect(verifyCredential({ ...kya, credential: { ...kya.credential, controls: { ...kya.credential.controls, maxFloatUsdc: 9999 } } }).hashMatches).toBe(false);
    const card = await (await fetch(`${t.base}/.well-known/agent-card.json`)).json();
    expect(card.skills.map((s: { id: string }) => s.id)).toEqual(["contracting", "estimate", "watchtower", "receipts"]);
  });

  it("serves MCP: an official SDK client lists tools, prices a job, hires Veyra and checks a counterparty", async () => {
    const t = await boot();
    const client = new Client({ name: "judge", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${t.base}/mcp`)));
    const tools = (await client.listTools()).tools.map((x) => x.name).sort();
    expect(tools).toEqual(["market_analytics", "veyra_contract", "veyra_estimate", "veyra_hire", "veyra_identity", "veyra_ledger", "veyra_mandate", "verify_receipt", "watchtower_check", "watchtower_proof", "watchtower_summary"].sort());
    const read = async (name: string, args: Record<string, unknown> = {}) => {
      const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
      expect(r.isError).toBeFalsy();
      return JSON.parse(r.content[0].text);
    };
    const est = await read("veyra_estimate", { title: "Competitor scan", brief: "Research competitors of NEAR agent wallets and write a report.", budgetUsd: 4 });
    expect(est.lines.length).toBeGreaterThan(0);
    expect(est.estimatedCostUsd).toBeLessThanOrEqual(est.envelopeUsd);
    const hire = await read("veyra_hire", { title: "Competitor scan", brief: "Research competitors of NEAR agent wallets and write a report.", budgetUsd: 4 });
    expect(hire.status).toBe("delivered");
    const c = await read("veyra_contract", { contractId: hire.contractId });
    expect(c.deliverable).toContain("## Provenance");
    const w = await read("watchtower_check", { handle: "payee-swapper" });
    expect(w.fresh.verdict).toBe("flagged");
    const ledger = await read("veyra_ledger");
    expect(ledger.totals.delivered).toBe(1);
    await client.close();
  });
});
