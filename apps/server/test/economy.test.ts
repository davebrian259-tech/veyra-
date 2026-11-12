import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { ContractorGuard } from "../src/contractor/guard.js";
import { DEFAULT_MANDATE, mandateHash, mandateMessage } from "../src/contractor/mandate.js";
import { Db } from "../src/db.js";
import { ftTransferAction, implicitAccountId, newKeyPair, signDelegate } from "../src/lib/near-signer.js";
import type { X402Requirement } from "../src/market/types.js";
import { SIM_TREASURY, SIM_USDC } from "../src/sim/market.js";

/**
 * The economy end to end: another agent hires Veyra with an x402 cheque, Veyra subcontracts
 * under the owner's mandate, the cheque settles only on delivery, the margin is paid to the
 * owner, and every Watchtower verdict is provable against an anchored root.
 */
describe("Veyra as an x402 seller, the mandate, payouts and anchored verdicts", () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => close?.());

  async function boot(env: Record<string, string> = {}) {
    const built = await buildApp(loadConfig({ NODE_ENV: "test", DATABASE_PATH: ":memory:", VEYRA_MODE: "sim", ...env }));
    await built.app.listen({ port: 0, host: "127.0.0.1" });
    const addr = built.app.server.address() as { port: number };
    close = () => built.app.close();
    return { ...built, base: `http://127.0.0.1:${addr.port}` };
  }

  /** A buyer agent with its own NEAR account and USDC on the simulated chain. */
  function buyer(t: Awaited<ReturnType<typeof boot>>, usdc: bigint) {
    const kp = newKeyPair();
    const accountId = implicitAccountId(kp.getPublicKey().toString());
    t.ctx.sim!.chain.createAccount(accountId, kp.getPublicKey().toString());
    t.ctx.sim!.chain.mint(SIM_USDC, accountId, usdc);
    const pay = async (row: X402Requirement, nonce = 1n) => {
      const height = await t.ctx.chain.blockHeight();
      const s = signDelegate({ senderId: accountId, receiverId: row.asset, actions: [ftTransferAction(row.payTo, row.amount)], nonce, maxBlockHeight: height + BigInt(row.maxTimeoutSeconds), keyPair: kp });
      return Buffer.from(JSON.stringify({ accepted: row, payload: { signedDelegateAction: s.base64 } })).toString("base64");
    };
    return { accountId, kp, pay, balance: () => t.ctx.chain.ftBalance(SIM_USDC, accountId) };
  }

  const a2a = (base: string, params: unknown, xPayment?: string) =>
    fetch(`${base}/a2a/v1`, { method: "POST", headers: { "content-type": "application/json", ...(xPayment ? { "x-payment": xPayment } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "SendMessage", params }) });
  const job = { message: { parts: [{ text: "Research competitors to NEAR Intents agent wallets, compare their pricing in a table, and write a short report for a founder." }], metadata: { title: "Competitor scan", budgetUsd: 4 } } };

  it("another agent hires Veyra with a cheque that is executed only when the job is delivered", async () => {
    const t = await boot();
    const b = buyer(t, 10_000_000n);

    // 1. No payment: a 402 that names Veyra's spend account, the same payee as /.well-known/x402.
    const r402 = await a2a(t.base, job);
    expect(r402.status).toBe(402);
    const ch = await r402.json();
    const row: X402Requirement = ch.accepts[0];
    expect(row.amount).toBe("4000000");
    expect(row.payTo).toBe(t.ctx.spend.accountId);
    const wk = await (await fetch(`${t.base}/.well-known/x402`)).json();
    expect(wk.recipients[0].payTo).toBe(row.payTo);

    // 2. With a signed cheque: the job is accepted and the buyer has not paid yet. (Veyra is
    //    frozen here so the simulator cannot finish the job before we look.)
    const spendBefore = await t.ctx.spend.usdcBalance(SIM_USDC);
    t.ctx.engine.setFrozen(true, "test");
    const header = await b.pay(row);
    const paid = await a2a(t.base, job, header);
    expect(paid.status).toBe(200);
    const task = (await paid.json()).result.task;
    expect(task.status.state).toBe("TASK_STATE_WORKING");
    expect(task.payment.status).toBe("held");
    expect(await b.balance()).toBe(10_000_000n);

    // 3. Veyra works; delivery executes the cheque; the deliverable is released.
    t.ctx.engine.setFrozen(false, "test");
    await t.ctx.engine.advance(task.id);
    const done = await (await fetch(`${t.base}/a2a/v1`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "GetTask", params: { id: task.id } }) })).json();
    expect(done.result.status.state).toBe("TASK_STATE_COMPLETED");
    expect(done.result.payment.status).toBe("settled");
    expect(done.result.payment.settlement).toMatch(/^SIM/);
    expect(done.result.artifacts[0].parts[0].text).toContain("## Provenance");
    expect(await b.balance()).toBe(6_000_000n);
    expect(await t.ctx.spend.usdcBalance(SIM_USDC)).toBeGreaterThan(spendBefore);
    const c = t.ctx.engine.view(task.id);
    expect(c.buyer).toBe(`x402:${b.accountId}`);
    expect(c.money.marginUsd).toBeGreaterThan(0);
    expect(c.events.some((e) => e.kind === "settled")).toBe(true);

    // 4. The same cheque again is the same sale, not a second charge.
    const again = await a2a(t.base, job, header);
    expect((await again.json()).result.task.id).toBe(task.id);
    expect(await b.balance()).toBe(6_000_000n);
    // A fresh cheque reusing a spent nonce is refused by the chain rules before any work starts.
    const stale = await a2a(t.base, job, await b.pay(row, 0n));
    expect(stale.status).toBe(402);
    expect((await stale.json()).error).toMatch(/nonce/);
  });

  it("a job that cannot be done costs the buyer nothing: the cheque is void, never executed", async () => {
    const t = await boot();
    const b = buyer(t, 10_000_000n);
    // The owner's mandate forbids the categories every subtask needs, so nothing can be bought.
    t.ctx.mandate.set({ ...DEFAULT_MANDATE, blockedCategories: ["research", "data", "creative"] }, "test", null);
    const row = (await (await a2a(t.base, job)).json()).accepts[0];
    const task = (await (await a2a(t.base, job, await b.pay(row))).json()).result.task;
    await t.ctx.engine.advance(task.id);
    const c = t.ctx.engine.view(task.id);
    expect(c.status).toBe("failed");
    expect(t.ctx.seller.forContract(task.id)!.status).toBe("void");
    expect(await b.balance()).toBe(10_000_000n);
    expect(c.events.filter((e) => e.kind === "guard_block").some((e) => /category/.test(e.message))).toBe(true);
    const view = t.ctx.seller.task(task.id);
    expect(view.status.state).toBe("TASK_STATE_FAILED");
    expect(view.artifacts).toBeUndefined();
  });

  it("the mandate is a signed, versioned document whose limits GUARD and intake enforce", async () => {
    const t = await boot();
    const m0 = t.ctx.mandate.current();
    expect(m0.version).toBe(0);
    expect(mandateMessage(DEFAULT_MANDATE, 1)).toContain(`Hash: ${mandateHash(DEFAULT_MANDATE, 1)}`);
    expect(mandateHash(DEFAULT_MANDATE, 1)).not.toBe(mandateHash({ ...DEFAULT_MANDATE, maxJobUsd: 26 }, 1));

    // Intake: a job above the cap is refused before any work starts.
    t.ctx.mandate.set({ ...DEFAULT_MANDATE, maxJobUsd: 2 }, "test", null);
    expect(t.ctx.mandate.current().version).toBe(1);
    const r = await a2a(t.base, job);
    expect(r.status).toBe(400); // not a payment challenge: Veyra declines the job outright
    expect((await r.json()).message).toMatch(/mandate caps a single job at 2/);
    expect(() => t.ctx.engine.create({ userId: "u", title: "x", brief: "y", budgetUsd: 3, buyer: "b", source: "direct" })).toThrow(/mandate/);

    // GUARD: the rolling daily limit, the category block and the trust floor.
    const g = new ContractorGuard(new Db(":memory:"));
    const treasury = [{ network: "near:sim", asset: SIM_USDC, payTo: SIM_TREASURY }];
    const row: X402Requirement = { scheme: "exact", network: "near:sim", asset: SIM_USDC, amount: "500000", payTo: SIM_TREASURY, maxTimeoutSeconds: 720 };
    const agent = { agent_id: "a", handle: "h", name: "H", description: "", category: "data", tags: [], delivered_jobs: 200, success_rate: 98, sla_seconds: 60, available_now: true };
    const base = { contractId: "c", subtaskId: "s", handle: "h", row, treasury, planAtomic: "500000", subtaskCapAtomic: 1_000_000n, envelopeRemainingAtomic: 2_000_000n, agent, frozen: false };
    const rules = (m: Partial<NonNullable<typeof base & { mandate: unknown }>["mandate"]>) =>
      g.checkChallenge({ ...base, mandate: { maxDailyAtomic: 50_000_000n, dailySpentAtomic: 0n, blockedCategories: [], minTrust: 25, ...m } }).findings.filter((f) => f.severity === "block").map((f) => f.rule);
    expect(rules({})).toEqual([]);
    expect(rules({ maxDailyAtomic: 1_000_000n, dailySpentAtomic: 600_000n })).toEqual(["over_daily_cap"]);
    expect(rules({ blockedCategories: ["Data"] })).toEqual(["category_blocked"]);
    expect(rules({ minTrust: 99 })).toEqual(["low_trust_counterparty"]);
  });

  it("earned margin above the float is paid to the owner with a receipt", async () => {
    const t = await boot({ MAX_FLOAT_USDC: "1", PAYOUT_MIN_USDC: "1" });
    const b = buyer(t, 20_000_000n);
    const owner = t.ctx.ownerUser()!;
    const before = await t.ctx.chain.ftBalance(SIM_USDC, owner.accountId);
    const big = { ...job, message: { ...job.message, metadata: { title: "Competitor scan", budgetUsd: 8 } } };
    const row = (await (await a2a(t.base, big)).json()).accepts[0];
    const task = (await (await a2a(t.base, big, await b.pay(row))).json()).result.task;
    await t.ctx.engine.advance(task.id);
    expect(t.ctx.engine.view(task.id).status).toBe("delivered");
    const status = await t.ctx.treasury.status();
    expect(BigInt(status.surplusAtomic)).toBeGreaterThan(1_000_000n);
    const p = await t.ctx.treasury.payout(owner.accountId, t.ctx.receipts, 1_000_000n, "owner");
    expect(p.paid).toBe(true);
    const after = await t.ctx.chain.ftBalance(SIM_USDC, owner.accountId);
    expect(after - before).toBe(BigInt(status.surplusAtomic));
    expect(await t.ctx.spend.usdcBalance(SIM_USDC)).toBe(1_000_000n); // exactly the float stays
    const receipt = t.ctx.receipts.proof((p as { receiptId: string }).receiptId);
    expect(receipt.receipt.kind).toBe("payout");
    expect(receipt.checks).toEqual({ hashMatchesBody: true, signatureValid: true });
    // Nothing left above the float: a second payout does nothing.
    expect((await t.ctx.treasury.payout(owner.accountId, t.ctx.receipts, 1_000_000n, "scheduler")).paid).toBe(false);
  });

  it("every Watchtower verdict is provable against the scan's anchored Merkle root", async () => {
    const t = await boot();
    await t.ctx.watchtower.scan();
    const latest = t.ctx.watchtower.latest();
    expect(latest.scan!.root).toMatch(/^[0-9a-f]{64}$/);
    const p = t.ctx.watchtower.proof("payee-swapper");
    expect(p.valid).toBe(true);
    expect(p.root).toBe(latest.scan!.root);
    expect(p.verdict.verdict).toBe("flagged");
    expect(p.receipt!.receipt.root).toBe(p.root);
    expect(p.receipt!.checks.signatureValid).toBe(true);
    expect(p.receipt!.anchor?.status).toBe("anchored");
    expect(p.receipt!.proof?.valid).toBe(true);
    const ok = t.ctx.watchtower.proof("scout-research");
    expect(ok.verdict.verdict).toBe("ok");
    expect(ok.path.length).toBe(p.path.length);
    const viaHttp = await (await fetch(`${t.base}/watchtower/agents/scout-research/proof`)).json();
    expect(viaHttp.valid).toBe(true);
  });
});
