import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { enforcementMap } from "../services/policy.js";
import { atomic, body, params, query, requireUser } from "./http.js";

const manualTx = z.discriminatedUnion("type", [
  z.object({ type: z.literal("transfer"), asset: z.string(), amount: atomic, receiver: z.string() }),
  z.object({ type: z.literal("function_call"), receiver: z.string(), methodName: z.string(), args: z.record(z.string(), z.unknown()).optional(), deposit: atomic.optional() }),
  z.object({
    type: z.literal("add_key"),
    publicKey: z.string(),
    permission: z.union([z.literal("FullAccess"), z.object({ receiverId: z.string(), methodNames: z.array(z.string()).optional(), allowance: z.string().nullable().optional() })]),
  }),
  z.object({ type: z.literal("delete_account"), beneficiary: z.string() }),
]);

export function moneyRoutes(app: FastifyInstance, ctx: AppContext) {
  // -------------------------------------------------------------- manual wallet
  app.get("/wallet/balances", async (req) => {
    const user = requireUser(ctx, req);
    const q = query(z.object({ tokens: z.string().optional() }), req);
    return ctx.wallet.balances(user.accountId, q.tokens ? q.tokens.split(",") : []);
  });

  /** Record a transaction the user's own wallet signed so it is tracked to finality. */
  app.post("/wallet/transactions", async (req) => {
    const b = body(z.object({ txHash: z.string().min(20), kind: z.string().max(40), receiver: z.string().optional(), asset: z.string().optional(), amount: z.string().optional(), usdValue: z.number().nullable().optional(), analysis: z.unknown().optional() }), req);
    return ctx.wallet.record(requireUser(ctx, req), b);
  });

  app.get("/wallet/history", async (req) => ({ operations: ctx.wallet.history(requireUser(ctx, req)) }));
  app.get("/wallet/insights", async (req) => ctx.wallet.insights(requireUser(ctx, req)));

  // -------------------------------------------------------------- BODYGUARD
  app.post("/bodyguard/analyze", async (req) => {
    const b = body(z.object({ tx: manualTx }), req);
    return ctx.wallet.analyze(requireUser(ctx, req), b.tx);
  });

  app.get("/bodyguard/access-keys", async (req) => ctx.wallet.accessKeys(requireUser(ctx, req)));

  app.get("/bodyguard/lists", async (req) => ({ entries: ctx.bodyguard.list(requireUser(ctx, req).id) }));

  app.post("/bodyguard/lists", async (req) => {
    const user = requireUser(ctx, req);
    const b = body(z.object({ kind: z.enum(["block_destination", "trusted_destination"]), value: z.string().min(2).max(128), label: z.string().max(100).optional() }), req);
    ctx.bodyguard.addToList(user.id, b.kind, b.value, b.label);
    ctx.audit.record({ userId: user.id, actor: "user", action: `bodyguard.list.${b.kind}`, subject: b.value, data: { label: b.label } });
    return { entries: ctx.bodyguard.list(user.id) };
  });

  app.delete("/bodyguard/lists/:id", async (req) => {
    const user = requireUser(ctx, req);
    ctx.bodyguard.removeFromList(user.id, Number(params(req).id));
    return { entries: ctx.bodyguard.list(user.id) };
  });

  app.get("/bodyguard/enforcement", async () => enforcementMap());

  /** Security dashboard summary: blocks, approvals, frozen agents, audit-chain integrity. */
  app.get("/bodyguard/summary", async (req) => {
    const user = requireUser(ctx, req);
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const counts = ctx.db.all<{ status: string; n: number }>("SELECT status, COUNT(*) AS n FROM operations WHERE user_id = ? AND created_at >= ? GROUP BY status", [user.id, since]);
    const blocked = ctx.execution.list(user.id, { limit: 200 }).filter((o) => o.status === "blocked").slice(0, 20);
    return {
      last30Days: Object.fromEntries(counts.map((c) => [c.status, c.n])),
      recentBlocks: blocked,
      pendingApprovals: ctx.execution.listApprovals(user.id).filter((a) => (a as unknown as { status: string }).status === "pending"),
      agents: ctx.agents.listAgents(user).map((a) => ({ id: a.id, name: a.name, frozen: Boolean(a.local_frozen), status: a.status })),
      auditChain: ctx.audit.verify(),
    };
  });

  // -------------------------------------------------------------- NEAR Intents (1Click)
  app.get("/intents/tokens", async () => ({ tokens: await ctx.tokens.oneClickTokens(), source: "NEAR Intents 1Click /v0/tokens (live)" }));

  const quoteBody = z.object({
    originAsset: z.string(),
    destinationAsset: z.string(),
    amount: atomic,
    slippageBps: z.number().int().min(0).max(1000).default(100),
    recipient: z.string().optional(),
    refundTo: z.string().optional(),
  });

  app.post("/intents/quote", async (req) => {
    const user = requireUser(ctx, req);
    const b = body(quoteBody, req);
    return ctx.intents.compare({ ...b, recipient: b.recipient ?? user.accountId, refundTo: b.refundTo ?? user.accountId });
  });

  app.post("/intents/swaps", async (req) => {
    const user = requireUser(ctx, req);
    const b = body(quoteBody.extend({ recipientType: z.enum(["DESTINATION_CHAIN", "INTENTS"]).default("DESTINATION_CHAIN") }), req);
    return ctx.intents.createManualSwap(user, { ...b, recipient: b.recipient ?? user.accountId, refundTo: b.refundTo ?? user.accountId });
  });

  app.post("/intents/swaps/:id/deposit", async (req) => {
    const b = body(z.object({ txHash: z.string().min(20) }), req);
    return ctx.intents.submitDeposit(requireUser(ctx, req), params(req).id, b.txHash);
  });

  app.get("/intents/swaps/:id", async (req) => {
    requireUser(ctx, req);
    return ctx.intents.refresh(params(req).id);
  });

  // -------------------------------------------------------------- Chain Signatures
  app.get("/chain-signatures/address", async (req) => {
    const q = query(z.object({ index: z.coerce.number().int().min(1).max(100).default(1) }), req);
    return ctx.chainSigs.derive(requireUser(ctx, req), q.index);
  });

  app.post("/chain-signatures/evm/prepare", async (req) => {
    const b = body(z.object({ to: z.string(), valueWei: atomic, index: z.number().int().min(1).max(100).optional() }), req);
    return ctx.chainSigs.prepare(requireUser(ctx, req), b);
  });

  app.post("/chain-signatures/:id/complete", async (req) => {
    const b = body(z.object({ nearTxHash: z.string().min(20) }), req);
    return ctx.chainSigs.complete(requireUser(ctx, req), params(req).id, b.nearTxHash);
  });

  app.get("/chain-signatures", async (req) => ({ requests: ctx.chainSigs.list(requireUser(ctx, req)) }));
}
