import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { SIM_OWNER_ACCOUNT } from "../context.js";
import { badRequest, forbidden, notFound } from "../lib/errors.js";
import { verifyMarketWebhook } from "../market/worker.js";
import type { Scheduler } from "../scheduler.js";
import { body, params, query, requireUser, SESSION_COOKIE } from "./http.js";
import { mandateHash, mandateMessage, mandateSchema } from "../contractor/mandate.js";
import { marketAnalytics } from "../watchtower/analytics.js";
import { randomToken, sha256Hex } from "../lib/crypto.js";
import { now } from "../db.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildMcpServer } from "../mcp/server.js";
import { agentCard, buildCredential, kyaMessage, signCredential, verifyCredential } from "../contractor/identity.js";
import { estimate } from "../contractor/estimate.js";
import { sessionToken, signedChallenge } from "./http.js";

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

  const publicUrl = (req: { protocol: string; headers: Record<string, unknown> }) => ctx.config.PUBLIC_API_URL ?? `${req.protocol}://${String(req.headers.host ?? "localhost")}`;

  // -------------------------------------------------------------- identity (KYA) & agent card
  app.get("/.well-known/agent-card.json", async (req) => agentCard(ctx, publicUrl(req)));
  app.get("/kya", async (req) => signCredential(ctx, buildCredential(ctx, publicUrl(req))));
  app.post("/kya/verify", async (req) => verifyCredential(body(z.object({ credential: z.unknown(), hash: z.string(), signature: z.object({ publicKey: z.string(), value: z.string() }) }), req)));
  /** The owner countersigns the credential hash with their NEAR wallet (NEP-413). */
  app.post("/kya/challenge", async (req) => {
    const user = requireUser(ctx, req);
    const signed = signCredential(ctx, buildCredential(ctx, publicUrl(req)));
    return { ...ctx.auth.createChallenge(user.accountId, "veyra_policy", kyaMessage(signed.hash)), hash: signed.hash };
  });
  app.post("/kya/attest", async (req) => {
    const user = requireUser(ctx, req);
    const b = body(z.object({ hash: z.string().length(64), signed: signedChallenge }), req);
    const sig = await ctx.auth.verifyOwnerAction(user, "veyra_policy", b.signed, kyaMessage(b.hash));
    const att = { owner: user.accountId, credentialHash: b.hash, publicKey: sig.publicKey, signature: sig.signature, nonce: sig.nonce, message: sig.message, recipient: ctx.config.VEYRA_AUTH_RECIPIENT, at: now() };
    ctx.db.run("INSERT OR REPLACE INTO kv (key, value_json, updated_at) VALUES ('kya.owner_attestation', ?, ?)", [JSON.stringify(att), now()]);
    return att;
  });

  // -------------------------------------------------------------- the owner's mandate (NEP-413)
  app.get("/mandate", async () => ({ ...ctx.mandate.current(), dailySpentAtomic: ctx.mandate.dailySpentAtomic().toString() }));
  app.post("/mandate/challenge", async (req) => {
    const user = requireUser(ctx, req);
    const m = body(mandateSchema, req);
    const version = ctx.mandate.current().version + 1;
    return { ...ctx.auth.createChallenge(user.accountId, "veyra_policy", mandateMessage(m, version)), version, hash: mandateHash(m, version) };
  });
  app.post("/mandate", async (req) => {
    const user = requireUser(ctx, req);
    const b = body(z.object({ mandate: mandateSchema, signed: signedChallenge.optional() }), req);
    const version = ctx.mandate.current().version + 1;
    if (!b.signed) {
      if (!ctx.sim) throw badRequest("signature_required", "the mandate must be signed by the owner's wallet");
      return ctx.mandate.set(b.mandate, `${user.accountId} (simulator, unsigned)`, null);
    }
    const sig = await ctx.auth.verifyOwnerAction(user, "veyra_policy", b.signed, mandateHash(b.mandate, version));
    return ctx.mandate.set(b.mandate, user.accountId, { publicKey: sig.publicKey, value: sig.signature, nonce: sig.nonce, message: sig.message });
  });

  // -------------------------------------------------------------- Veyra as an x402 seller (A2A)
  app.get("/.well-known/x402", async () => ctx.seller.recipients());
  app.post("/a2a/v1", async (req, reply) => {
    const rpc = body(z.object({ jsonrpc: z.literal("2.0").optional(), id: z.union([z.number(), z.string()]).default(1), method: z.string(), params: z.record(z.string(), z.unknown()).default({}) }), req);
    const ok = (result: unknown) => ({ jsonrpc: "2.0", id: rpc.id, result });
    const fail = (code: number, message: string) => ({ jsonrpc: "2.0", id: rpc.id, error: { code, message } });
    if (rpc.method === "GetTask") {
      try { return ok(ctx.seller.task(String((rpc.params as { id?: string }).id ?? ""))); } catch { return fail(-32001, "task not found"); }
    }
    if (rpc.method !== "SendMessage") return fail(-32601, "method not found");
    const msg = rpc.params as { message?: { parts?: { text?: string }[]; metadata?: { title?: string; budgetUsd?: number } }; metadata?: { title?: string; budgetUsd?: number } };
    const text = String(msg.message?.parts?.[0]?.text ?? "");
    const meta = msg.message?.metadata ?? msg.metadata ?? {};
    const budgetUsd = Number(meta.budgetUsd ?? ctx.config.SELLER_MIN_USDC);
    if (!text.trim()) return fail(-32602, "message.parts[0].text must describe the job");
    const xPayment = req.headers["x-payment"];
    const challenge = () => {
      const row = ctx.seller.price(BigInt(Math.round(budgetUsd * 1e6)));
      return { x402Version: 2, error: "x-payment header is required", accepts: [row], note: "Sign a NEP-366 delegate ft_transfer for exactly this row to Veyra's spend account. It is executed only when the job is delivered." };
    };
    if (typeof xPayment !== "string") return reply.status(402).send(challenge());
    try {
      const { contractId } = await ctx.seller.accept({ title: String(meta.title ?? text.split(/[.\n]/)[0].slice(0, 100)), brief: text, xPayment });
      void ctx.engine.advance(contractId).catch(() => undefined);
      return ok({ task: ctx.seller.task(contractId) });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      return reply.status(402).send({ ...challenge(), error: `invalid payment: ${m}` });
    }
  });
  app.get("/sales", async (req) => { requireUser(ctx, req); return { sales: ctx.seller.list() }; });

  // -------------------------------------------------------------- estimate (no spending)
  app.post("/estimate", async (req) => {
    requireUser(ctx, req);
    const b = body(z.object({ title: z.string().min(3).max(200), brief: z.string().min(10).max(4000), budgetUsd: z.number().positive().max(1000) }), req);
    return estimate({ catalog: ctx.catalog, x402: ctx.x402, guard: ctx.guard, brain: ctx.brain }, { ...b, marginBps: ctx.config.CONTRACT_MARGIN_BPS, perSubtask: 4 });
  });

  // -------------------------------------------------------------- MCP (Streamable HTTP, stateless)
  app.post("/mcp", async (req, reply) => {
    const user = ctx.auth.userFromToken(sessionToken(req));
    const server = buildMcpServer(ctx, user, publicUrl(req));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.hijack();
    reply.raw.on("close", () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });
  app.get("/mcp", async (_req, reply) => reply.status(405).send({ error: "method_not_allowed", message: "Stateless MCP: POST JSON-RPC to /mcp." }));

  // -------------------------------------------------------------- watchtower (public reads)
  app.get("/watchtower", async () => ctx.watchtower.latest());
  app.get("/watchtower/agents/:handle", async (req) => ctx.watchtower.lookup(params(req).handle));
  app.get("/watchtower/evidence/:hash", async (req) => ctx.watchtower.evidence(params(req).hash));
  app.get("/watchtower/analytics", async (req) => marketAnalytics(ctx.db, ctx.guard, query(z.object({ scan: z.string().optional() }), req).scan) ?? { scan: null });

  // -------------------------------------------------------------- evidence (public): what is on-chain, with links
  app.get("/evidence", async () => {
    const L = ctx.ledger;
    const anchors = ctx.receipts.anchors() as { id: string; root: string; from_seq: number; to_seq: number; count: number; tx_hash: string | null; status: string; created_at: string }[];
    const reports = ctx.db.all<{ handle: string; report_ref: string; evidence_hash: string; scan_id: string; created_at: string }>("SELECT handle, report_ref, evidence_hash, scan_id, created_at FROM watch_results WHERE report_ref IS NOT NULL ORDER BY created_at DESC LIMIT 50");
    const scans = ctx.db.all<{ id: string; origin: string; finished_at: string; total: number; flagged: number; root: string | null; receipt_id: string | null }>("SELECT id, origin, finished_at, total, flagged, root, receipt_id FROM watch_scans WHERE status = 'done' ORDER BY started_at DESC LIMIT 10");
    let onChain: { anchors: number; reports: number; latest: unknown } | null = null;
    if (L?.rpc) {
      onChain = await Promise.all([L.rpc.view<number>(L.contractId, "count", {}), L.rpc.view<number>(L.contractId, "report_count", {}), L.rpc.view<unknown>(L.contractId, "latest", {})])
        .then(([a, r, latest]) => ({ anchors: a, reports: r, latest })).catch(() => null);
    }
    const tx = (h: string | null) => (h && L?.explorer ? `${L.explorer}/txns/${h}` : null);
    return {
      ledger: L ? { contractId: L.contractId, network: L.network, explorer: L.explorer ? `${L.explorer}/address/${L.contractId}` : null, onChain } : null,
      receiptIssuer: ctx.receipts.publicKey(),
      anchors: anchors.map((a) => ({ ...a, link: tx(a.tx_hash) })),
      reports: reports.map((r) => ({ ...r, link: tx(r.report_ref) })),
      scans,
      mode: ctx.config.VEYRA_MODE,
      watchtowerOrigin: ctx.config.VEYRA_MODE === "sim" && ctx.config.WATCHTOWER_LIVE ? ctx.config.MARKET_ORIGIN : null,
    };
  });

  app.get("/watchtower/agents/:handle/proof", async (req) => ctx.watchtower.proof(params(req).handle, query(z.object({ scan: z.string().optional() }), req).scan));
  app.post("/watchtower/scan", async (req) => {
    requireUser(ctx, req);
    const b = body(z.object({ limit: z.number().int().min(1).max(5000).optional() }), req);
    return ctx.watchtower.scan({ limit: b.limit });
  });

  // -------------------------------------------------------------- treasury & guard
  app.get("/treasury", async (req) => {
    requireUser(ctx, req);
    return ctx.treasury.status();
  });

  /** The vault policy Veyra needs: USDC withdrawals to its own spend account only, under a budget. */
  app.get("/vault/recommended-policy", async (req) => {
    requireUser(ctx, req);
    const { describePolicy, veyraPolicySchema } = await import("../services/policy.js");
    const policy = veyraPolicySchema.parse({
      actions: ["withdraw"],
      assets: [`nep141:${ctx.config.USDC_CONTRACT}`],
      budget: { dailyUsd: 25, weeklyUsd: 100 },
      perTransactionUsd: ctx.config.MAX_FLOAT_USDC,
      approvalThresholdUsd: null,
      destinationMode: "only",
      destinations: [{ action: "withdraw", chain: "near", address: ctx.spend.accountId, memo: null, label: "Veyra spend account" }],
      maxActionsPerHour: 30,
    });
    return { policy, summary: describePolicy(policy), spendAccountId: ctx.spend.accountId };
  });

  app.post("/treasury/payout", async (req) => {
    const user = requireUser(ctx, req);
    const owner = ctx.ownerUser();
    if (!owner || owner.id !== user.id) throw forbidden("only the owner receives payouts");
    return ctx.treasury.payout(owner.accountId, ctx.receipts, 1n, "owner");
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
    const b = body(z.object({ blocked: z.boolean().default(true) }), req);
    const handle = params(req).handle;
    if (b.blocked) ctx.guard.record(handle, "attacks", `blocked by ${user.accountId}`);
    else {
      ctx.db.run("UPDATE counterparties SET blocked = 0, note = ?, updated_at = ? WHERE handle = ?", [`unblocked by ${user.accountId}`, now(), handle]);
      ctx.audit.record({ userId: user.id, actor: "user", action: "guard.counterparty.unblocked", subject: handle });
    }
    return ctx.guard.counterparty(handle);
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
