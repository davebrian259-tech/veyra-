import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { SIM_OWNER_ACCOUNT } from "../context.js";
import { forbidden, notFound } from "../lib/errors.js";
import { verifyMarketWebhook } from "../market/worker.js";
import type { Scheduler } from "../scheduler.js";
import { body, params, query, requireUser, SESSION_COOKIE } from "./http.js";
import { randomToken, sha256Hex } from "../lib/crypto.js";
import { now } from "../db.js";

/** Attack-lab scenarios: each puts one adversarial market agent first in line. */
export const LAB_SCENARIOS = {
  "prompt-injection": { handle: "inject-o-matic", title: "Competitor scan: NEAR agent wallets", brief: "Research the main competitors to NEAR Intents agent wallets and summarise the market for a founder." },
  "payee-swap": { handle: "payee-swapper", title: "Pricing comparison: agent payment rails", brief: "Compare pricing data and fees of agent payment rails (x402, cards, Intents) in a table." },
  "bait-and-switch": { handle: "bait-switch", title: "One-page report: agent commerce", brief: "Write a short report summarising agent commerce trends for a founder." },
  "no-show": { handle: "ghost-worker", title: "Data pull: stablecoin rails", brief: "Pull pricing data on stablecoin payment rails into a comparison table." },
} as const;

export function contractorRoutes(app: FastifyInstance, ctx: AppContext, scheduler: Scheduler) {
  const E = ctx.engine;

  // -------------------------------------------------------------- contracts
  app.get("/contracts", async (req) => ({ contracts: E.list(requireUser(ctx, req).id) }));

  /** Hire Veyra directly (outside the market), e.g. from another app or agent. */
  app.post("/contracts", async (req) => {
    const user = requireUser(ctx, req);
    const b = body(z.object({ title: z.string().min(3).max(200), brief: z.string().min(10).max(8000), budgetUsd: z.number().positive().max(1000) }), req);
    const c = E.create({ userId: user.id, title: b.title, brief: b.brief, budgetUsd: b.budgetUsd, buyer: user.accountId, source: "direct", marginBps: ctx.config.CONTRACT_MARGIN_BPS });
    void E.advance(c.id);
    return c;
  });

  app.get("/contracts/:id", async (req) => {
    const user = requireUser(ctx, req);
    const c = E.view(params(req).id);
    if (c.user_id !== user.id) throw notFound("contract");
    return c;
  });

  app.get("/contracts/:id/events", async (req) => {
    requireUser(ctx, req);
    const q = query(z.object({ after: z.coerce.number().default(0) }), req);
    return { events: E.events_(params(req).id, q.after) };
  });

  app.post("/contracts/:id/advance", async (req) => {
    requireUser(ctx, req);
    await E.advance(params(req).id);
    return E.view(params(req).id);
  });

  // -------------------------------------------------------------- public ledger & receipts (no auth)
  app.get("/ledger", async () => ({ ...E.ledger(), receiptsIssuer: ctx.receipts.publicKey(), anchors: ctx.receipts.anchors() }));
  app.get("/receipts", async (req) => {
    const q = query(z.object({ contract: z.string().optional() }), req);
    return { issuer: ctx.receipts.publicKey(), receipts: ctx.receipts.list(q.contract) };
  });
  app.get("/receipts/:id/proof", async (req) => ctx.receipts.proof(params(req).id));
  app.post("/receipts/anchor", async (req) => {
    requireUser(ctx, req);
    return { anchored: await ctx.receipts.anchorPending() };
  });

  // -------------------------------------------------------------- treasury & guard
  app.get("/treasury", async (req) => {
    requireUser(ctx, req);
    return ctx.treasury.status();
  });

  app.post("/treasury/spend/pool", async (req) => {
    requireUser(ctx, req);
    return ctx.spend.ensurePool();
  });

  /** Kill switch: no contract advances, no cheque is signed. */
  app.post("/contractor/freeze", async (req) => {
    const user = requireUser(ctx, req);
    const b = body(z.object({ frozen: z.boolean() }), req);
    E.setFrozen(b.frozen, user.accountId);
    return { frozen: E.frozen() };
  });
  app.get("/contractor/status", async () => ({ frozen: E.frozen(), mode: ctx.config.VEYRA_MODE, scheduler: scheduler.lastRun, marketConnected: ctx.oauth.connected, workerConfigured: Boolean(ctx.worker) }));

  app.get("/guard/counterparties", async (req) => {
    requireUser(ctx, req);
    return { counterparties: ctx.db.all("SELECT * FROM counterparties ORDER BY updated_at DESC") };
  });

  app.post("/guard/counterparties/:handle/block", async (req) => {
    const user = requireUser(ctx, req);
    ctx.guard.record(params(req).handle, "attacks", `blocked by ${user.accountId}`);
    return ctx.guard.counterparty(params(req).handle);
  });

  // -------------------------------------------------------------- market
  app.get("/market/agents", async (req) => {
    const q = query(z.object({ q: z.string().optional(), category: z.string().optional() }), req);
    const agents = await ctx.catalog.search({ text: q.q, category: q.category, limit: 20 });
    return { agents: agents.map((a) => ({ ...a, trust: ctx.guard.score(a, a.handle) })) };
  });

  /** A free x402 price check (no payment is made) plus GUARD's verdict on it. */
  app.get("/market/quote", async (req) => {
    requireUser(ctx, req);
    const q = query(z.object({ handle: z.string(), task: z.string().default("Price check\nHow much for one call?") }), req);
    const [agent, quote, treasury] = await Promise.all([ctx.catalog.agent(q.handle).catch(() => null), ctx.x402.quote(q.handle, q.task), ctx.catalog.treasury()]);
    const plan = agent ? await ctx.catalog.defaultPlan(agent.agent_id).catch(() => null) : null;
    const { planPriceAtomic } = await import("../market/catalog.js");
    const verdict = quote.kind === "quote" && quote.challenge.accepts[0]
      ? ctx.guard.checkChallenge({ contractId: "quote", subtaskId: "quote", handle: q.handle, row: quote.challenge.accepts[0], treasury, planAtomic: plan ? planPriceAtomic(plan) : null, subtaskCapAtomic: 10n ** 12n, envelopeRemainingAtomic: 10n ** 12n, agent, frozen: false })
      : null;
    return { agent, plan, quote, treasury, verdict };
  });

  app.post("/market/connect", async (req) => {
    requireUser(ctx, req);
    if (ctx.sim) throw forbidden("the simulator needs no market connection");
    return ctx.oauth.startDeviceFlow();
  });
  app.post("/market/connect/poll", async (req) => {
    requireUser(ctx, req);
    return { status: await ctx.oauth.pollDeviceFlow() };
  });
  app.delete("/market/connect", async (req) => {
    requireUser(ctx, req);
    ctx.oauth.disconnect();
    return { connected: false };
  });

  /** Signed market webhook (hire.created, …): verify, acknowledge fast, then reconcile. */
  app.post("/webhooks/market", { config: { rawBody: true } }, async (req, reply) => {
    const secret = ctx.config.MARKET_WEBHOOK_SECRET;
    if (!secret) throw forbidden("webhooks are not configured");
    const raw = (req as { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? {});
    const ok = verifyMarketWebhook(secret, { timestamp: req.headers["x-market-timestamp"] as string, signature: req.headers["x-market-signature"] as string }, raw);
    if (!ok) return reply.status(401).send({ error: "bad_signature" });
    ctx.audit.record({ actor: "system", action: `market.webhook.${req.headers["x-market-event"]}`, data: { delivery: req.headers["x-market-delivery"] } });
    void ctx.engine.pollAssignments().then(() => ctx.engine.tick());
    return { ok: true };
  });

  // -------------------------------------------------------------- simulator & attack lab
  if (!ctx.sim) return;
  const { chain, market } = ctx.sim;

  /** Sim only: sign in as the built-in owner (no wallet needed offline). */
  app.post("/sim/session", async (_req, reply) => {
    const owner = ctx.ownerUser()!;
    const token = randomToken();
    ctx.db.run("INSERT INTO sessions (id_hash, user_id, public_key, created_at, expires_at) VALUES (?,?,?,?,?)", [sha256Hex(token), owner.id, owner.publicKey, now(), new Date(Date.now() + 86_400_000).toISOString()]);
    reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/" });
    return { token, user: { id: owner.id, accountId: SIM_OWNER_ACCOUNT }, note: "Simulator session. Live mode requires a NEAR wallet signature." };
  });

  /** A simulated buyer hires Veyra on the (simulated) Agent Market. */
  app.post("/sim/hire", async (req) => {
    const b = body(z.object({ title: z.string().min(3).max(200), description: z.string().min(10).max(4000), budgetUsd: z.number().positive().max(100) }), req);
    const a = market.hireVeyra({ title: b.title, description: b.description, budgetUsd: b.budgetUsd, buyer: "sim-buyer" });
    await ctx.engine.pollAssignments();
    const c = ctx.db.get<{ id: string }>("SELECT id FROM contracts WHERE external_ref = ?", [a.assignmentId]);
    if (c) await ctx.engine.advance(c.id);
    return { assignmentId: a.assignmentId, contractId: c?.id ?? null, contract: c ? ctx.engine.view(c.id) : null };
  });

  /** Runs one adversarial scenario end to end and returns the contract with its security log. */
  app.post("/lab/:scenario", async (req) => {
    const user = requireUser(ctx, req);
    const s = LAB_SCENARIOS[params(req).scenario as keyof typeof LAB_SCENARIOS];
    if (!s) throw notFound("scenario");
    const c = ctx.engine.create({ userId: user.id, title: s.title, brief: s.brief, budgetUsd: 3, buyer: `attack-lab:${params(req).scenario}`, source: "direct", preferHandle: s.handle, marginBps: ctx.config.CONTRACT_MARGIN_BPS });
    // The no-show scenario has to outwait the ghost's 3-second SLA before it can cancel.
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      await ctx.engine.advance(c.id);
      if (ctx.engine.view(c.id).status !== "active") break;
      await new Promise((r) => setTimeout(r, 500));
      ctx.db.run("UPDATE contracts SET next_run_at = NULL WHERE id = ?", [c.id]);
    }
    const v = ctx.engine.view(c.id);
    return { scenario: params(req).scenario, adversary: s.handle, contract: v, securityEvents: v.events.filter((e) => /attack|guard|no_show|retry/.test(e.kind)), attacker: { account: "bonus-collector.sim", balance: (await chain.ftBalance("usdc.sim", "bonus-collector.sim")).toString() } };
  });

  app.get("/sim/state", async () => ({
    chainLog: chain.log.slice(-50),
    marketEvents: market.events.slice(-50),
    balances: {
      vault: (await chain.ftBalance("usdc.sim", "veyra-vault.sim")).toString(),
      spend: (await chain.ftBalance("usdc.sim", ctx.spend.accountId)).toString(),
      treasury: (await chain.ftBalance("usdc.sim", "market-treasury.sim")).toString(),
      attacker: (await chain.ftBalance("usdc.sim", "bonus-collector.sim")).toString(),
      ownerMarketBalance: (market.balances.get(SIM_OWNER_ACCOUNT) ?? 0n).toString(),
    },
  }));
}
