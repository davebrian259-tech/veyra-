import { fetchWitnessCheckpoint, verifyOperationProof, type SignedData } from "@near-intents-agent-api/sdk";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { toHttp } from "../services/agents.js";
import { describePolicy, enforcementMap, examplePolicy, veyraPolicySchema } from "../services/policy.js";
import { atomic, body, params, query, requireUser, signedChallenge } from "./http.js";

export const actionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("swap"), originAsset: z.string(), destinationAsset: z.string(), amount: atomic }),
  z.object({ kind: z.literal("transfer"), asset: z.string(), amount: atomic, recipient: z.string() }),
  z.object({ kind: z.literal("withdraw"), asset: z.string(), amount: atomic, chain: z.string(), recipient: z.string(), memo: z.string().optional() }),
]);

export function agentRoutes(app: FastifyInstance, ctx: AppContext) {
  const A = ctx.agents;

  app.get("/agents/policy/example", async () => {
    const p = examplePolicy();
    return { policy: p, summary: describePolicy(p), enforcement: enforcementMap() };
  });

  app.get("/agents/tokens", async () => ({ tokens: await ctx.tokens.agentTokens(), source: "NEAR Intents Agent API /v1/tokens (live)" }));

  app.get("/agents", async (req) => ({ agents: A.listAgents(requireUser(ctx, req)), configured: A.configured }));

  /** Step 1: backend prepares agent_create; the browser shows the preview and the wallet signs. */
  app.post("/agents", async (req) => {
    const user = requireUser(ctx, req);
    const b = body(z.object({ name: z.string().min(1).max(64), policy: veyraPolicySchema }), req);
    return A.prepareCreate(user, b);
  });

  app.get("/agents/:id", async (req) => A.overview(requireUser(ctx, req), params(req).id));

  app.post("/agents/:id/sync", async (req) => {
    A.assertOwner(requireUser(ctx, req), params(req).id);
    return A.syncAgent(params(req).id).catch((e) => { throw toHttp(e); });
  });

  app.post("/agents/:id/grants", async (req) => {
    const b = body(z.object({ label: z.string().min(1).max(64).default("Veyra backend") }), req);
    return A.prepareGrant(requireUser(ctx, req), params(req).id, b.label);
  });

  app.get("/agents/:id/grants", async (req) => ({ grants: A.listGrants(requireUser(ctx, req), params(req).id) }));

  app.post("/agents/:id/grants/:grantId/revoke", async (req) => A.prepareRevoke(requireUser(ctx, req), params(req).id, params(req).grantId));

  app.post("/agents/:id/policy", async (req) => {
    const b = body(z.object({ policy: veyraPolicySchema }), req);
    return A.preparePolicyUpdate(requireUser(ctx, req), params(req).id, b.policy);
  });

  /** Emergency freeze: local kill switch now + agent_freeze intent for the owner to sign. */
  app.post("/agents/:id/freeze", async (req) => {
    const b = body(z.object({ reason: z.string().max(200).optional() }), req);
    return A.freeze(requireUser(ctx, req), params(req).id, b.reason);
  });

  app.post("/agents/:id/unfreeze", async (req) => A.prepareUnfreeze(requireUser(ctx, req), params(req).id));

  /** Deposit address for funding the agent wallet (incoming funds need no grant). */
  app.post("/agents/:id/deposit", async (req) => {
    const user = requireUser(ctx, req);
    A.assertOwner(user, params(req).id);
    const b = body(z.object({ originAsset: z.string(), amount: atomic.optional() }), req);
    const res = await A.api().deposit(params(req).id, { origin_asset: b.originAsset, amount: b.amount, confidential: false }).catch((e) => { throw toHttp(e); });
    ctx.audit.record({ userId: user.id, actor: "user", action: "agent.deposit_address", subject: params(req).id, data: { correlationId: res.correlation_id, asset: b.originAsset } });
    return { ...res, idempotencyKey: undefined };
  });

  app.get("/agents/:id/history", async (req) => {
    A.assertOwner(requireUser(ctx, req), params(req).id);
    const q = query(z.object({ cursor: z.string().optional() }), req);
    return A.api().getHistory(params(req).id, { cursor: q.cursor, limit: 50 }).catch((e) => { throw toHttp(e); });
  });

  /** Offline verification of an execution's transparency-log proof (does not trust the API). */
  app.get("/agents/:id/operations/:correlationId/proof", async (req) => {
    A.assertOwner(requireUser(ctx, req), params(req).id);
    const trusted = await fetchWitnessCheckpoint(ctx.config.NEAR_INTENTS_AGENT_API_URL, ctx.config.AGENT_API_LOG_ORIGIN, ctx.config.AGENT_API_WITNESS_KEY);
    const proof = await A.api().getOperationProof(params(req).id, params(req).correlationId, { from_size: String(trusted.size) }).catch((e) => { throw toHttp(e); });
    try {
      const verified = verifyOperationProof(proof as never, ctx.config.AGENT_API_LOG_ORIGIN, trusted);
      return { verified: true, proven: verified.proven, checkpoint: verified.checkpoint };
    } catch (e) {
      return { verified: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  app.post("/agents/:id/api-approvals/:approvalId/vote", async (req) => {
    const b = body(z.object({ verdict: z.enum(["approve", "reject"]) }), req);
    return A.prepareApprovalVote(requireUser(ctx, req), params(req).id, params(req).approvalId, b.verdict);
  });

  app.post("/agents/:id/executions/:correlationId/cancel", async (req) => A.prepareExecutionCancel(requireUser(ctx, req), params(req).id, params(req).correlationId));

  // -------------------------------------------------------------- owner intents (signing)
  app.get("/owner-intents/:correlationId", async (req) => A.ownerIntent(requireUser(ctx, req), params(req).correlationId));

  app.post("/owner-intents/:correlationId/submit", async (req) => {
    const b = body(z.object({ signedData: z.record(z.string(), z.unknown()) }), req);
    return A.submit(requireUser(ctx, req), params(req).correlationId, b.signedData as unknown as SignedData);
  });

  app.post("/owner-intents/:correlationId/refresh", async (req) => {
    requireUser(ctx, req);
    return A.refreshOwnerIntent(params(req).correlationId, 10_000).catch((e) => { throw toHttp(e); });
  });

  // -------------------------------------------------------------- agent actions
  const meta = z.object({ reason: z.string().max(1000).optional(), idempotencyKey: z.string().min(8).max(128).optional() });

  app.post("/agents/:id/actions", async (req) => {
    const b = body(z.object({ action: actionSchema }).merge(meta), req);
    return ctx.execution.execute(requireUser(ctx, req), params(req).id, b.action, { origin: "user", reason: b.reason, idempotencyKey: b.idempotencyKey });
  });

  app.post("/agents/:id/actions/simulate", async (req) => {
    const b = body(z.object({ action: actionSchema }), req);
    return ctx.execution.simulate(requireUser(ctx, req), params(req).id, b.action);
  });

  app.get("/operations", async (req) => {
    const q = query(z.object({ agentId: z.string().optional(), kind: z.string().optional(), limit: z.coerce.number().optional() }), req);
    return { operations: ctx.execution.list(requireUser(ctx, req).id, q) };
  });

  app.get("/operations/:id", async (req) => {
    const user = requireUser(ctx, req);
    const op = ctx.execution.get(params(req).id);
    if (!op || op.user_id !== user.id) throw Object.assign(new Error("operation not found"), { statusCode: 404 });
    return { operation: ctx.execution.view(op), audit: ctx.audit.list(user.id, { subject: op.id }) };
  });

  app.post("/operations/:id/retry", async (req) => ctx.execution.retryUncertain(requireUser(ctx, req), params(req).id));
  app.post("/operations/:id/cancel", async (req) => ctx.execution.cancel(requireUser(ctx, req), params(req).id));

  // -------------------------------------------------------------- Veyra approvals (NEP-413 signed)
  app.get("/approvals", async (req) => ({ approvals: ctx.execution.listApprovals(requireUser(ctx, req).id) }));

  app.post("/approvals/:id/challenge", async (req) => {
    const b = body(z.object({ verdict: z.enum(["approve", "reject"]) }), req);
    return ctx.execution.approvalChallenge(requireUser(ctx, req), params(req).id, b.verdict);
  });

  app.post("/approvals/:id/decide", async (req) => {
    const b = body(z.object({ verdict: z.enum(["approve", "reject"]), signed: signedChallenge }), req);
    return ctx.execution.decide(requireUser(ctx, req), params(req).id, b.verdict, b.signed);
  });
}
