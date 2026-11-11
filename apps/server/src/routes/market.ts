import { createReadStream } from "node:fs";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { parse } from "../db.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import type { Plan } from "../services/ai/planner.js";
import { atomic, body, params, query, requireUser } from "./http.js";

const milestones = z.array(z.object({ title: z.string().min(1).max(120), sharePct: z.number().min(1).max(100) })).min(1).max(20);

export function marketRoutes(app: FastifyInstance, ctx: AppContext) {
  // -------------------------------------------------------------- AI goals & orchestration
  app.post("/goals", async (req) => {
    const b = body(z.object({ prompt: z.string().min(3).max(3000), agentId: z.string().nullable().optional(), autoExecute: z.boolean().default(false) }), req);
    return ctx.goals.create(requireUser(ctx, req), b);
  });
  app.get("/goals", async (req) => ({ goals: ctx.goals.list(requireUser(ctx, req)) }));
  app.get("/goals/:id", async (req) => ctx.goals.get(requireUser(ctx, req), params(req).id));
  app.post("/goals/:id/start", async (req) => ctx.goals.start(requireUser(ctx, req), params(req).id));
  app.post("/goals/:id/proposal", async (req) => ctx.goals.proposal(requireUser(ctx, req), params(req).id));
  app.post("/goals/:id/execute", async (req) => ctx.goals.execute(requireUser(ctx, req), params(req).id));

  /**
   * Autonomous mode, end to end up to the point where the owner must decide: interpret the
   * goal, post the job, gather competing offers, negotiate within budget and rank them.
   * Selecting a provider and funding escrow stay explicit owner actions.
   */
  app.post("/autonomous/run", async (req) => {
    const user = requireUser(ctx, req);
    const b = body(z.object({ prompt: z.string().min(3).max(3000), agentId: z.string().nullable().optional() }), req);
    const goal = await ctx.goals.create(user, { prompt: b.prompt, agentId: b.agentId ?? null });
    const steps: { step: string; result: unknown }[] = [{ step: "interpret", result: { plan: goal.plan, source: goal.source, adjustments: goal.adjustments } }];
    if (goal.plan.intent === "hire") {
      const started = await ctx.goals.start(user, goal.id);
      steps.push({ step: "discover_and_request_offers", result: started.requested });
      const neg = await ctx.wanted.negotiate(user, started.jobId);
      steps.push({ step: "negotiate", result: neg.rounds });
      const ranked = ctx.wanted.rankOffers(user, started.jobId);
      steps.push({ step: "rank", result: ranked.slice(0, 5).map((o) => ({ offerId: o.offerId, provider: o.provider, priceUsd: o.price_usd, etaDays: o.eta_days, score: o.score, simulated: (o as { simulated?: boolean }).simulated ?? false })) });
      return { goalId: goal.id, jobId: started.jobId, steps, recommendation: ranked[0] ?? null, next: "Select an offer (POST /wanted/jobs/:id/select), then fund UNDO escrow (POST /wanted/jobs/:id/escrow).", source: goal.source };
    }
    if (["allocate", "convert", "rebalance"].includes(goal.plan.intent) && b.agentId) {
      const proposal = await ctx.goals.proposal(user, goal.id);
      steps.push({ step: "proposal", result: proposal });
      return { goalId: goal.id, steps, next: "Review, then POST /goals/:id/execute. Every swap is checked by BODYGUARD and the Agent API.", source: goal.source };
    }
    return { goalId: goal.id, steps, source: goal.source };
  });

  app.get("/ai/runs", async (req) => ({ runs: ctx.ai.runs(requireUser(ctx, req).id) }));

  /** Live attestation of the private-inference environment, for display. */
  app.get("/ai/attestation", async (req) => {
    requireUser(ctx, req);
    if (!ctx.nearAi) return { configured: false, note: "Set NEAR_AI_API_KEY to enable private inference on NEAR AI Cloud." };
    return { configured: true, attestation: await ctx.nearAi.attest(), note: "Attestation proves the execution environment, not that any AI recommendation is correct." };
  });

  // -------------------------------------------------------------- WANTED
  app.get("/wanted/providers", async (req) => {
    const q = query(z.object({ skills: z.string().optional(), text: z.string().optional(), maxPriceUsd: z.coerce.number().optional(), kind: z.enum(["human", "ai_agent"]).optional() }), req);
    return { providers: ctx.wanted.search({ ...q, skills: q.skills?.split(",").filter(Boolean) }) };
  });

  app.post("/wanted/providers", async (req) => {
    const b = body(z.object({ kind: z.enum(["human", "ai_agent"]), name: z.string().min(2).max(80), description: z.string().max(1000), skills: z.array(z.string().max(40)).min(1).max(15), basePriceUsd: z.number().positive(), minPriceUsd: z.number().positive().optional(), offerEndpoint: z.string().url().nullable().optional() }), req);
    return ctx.wanted.registerProvider(requireUser(ctx, req), b);
  });

  app.get("/wanted/providers/:id", async (req) => ctx.wanted.provider(params(req).id));

  app.post("/wanted/jobs", async (req) => {
    const b = body(z.object({ title: z.string().min(3).max(140), description: z.string().max(3000), skills: z.array(z.string()).min(1).max(10), budgetMaxUsd: z.number().positive(), deadlineDays: z.number().int().min(1).max(365), completionConditions: z.array(z.string().max(300)).max(10).default([]) }), req);
    return ctx.wanted.createJob(requireUser(ctx, req), b);
  });
  app.get("/wanted/jobs", async (req) => ({ jobs: ctx.wanted.listJobs(requireUser(ctx, req)) }));
  app.get("/wanted/open-jobs", async (req) => ({ jobs: ctx.wanted.openJobsFor(requireUser(ctx, req)) }));
  app.get("/wanted/jobs/:id", async (req) => ctx.wanted.job(requireUser(ctx, req), params(req).id));
  app.post("/wanted/jobs/:id/request-offers", async (req) => ctx.wanted.requestOffers(requireUser(ctx, req), params(req).id));
  app.post("/wanted/jobs/:id/negotiate", async (req) => ctx.wanted.negotiate(requireUser(ctx, req), params(req).id));
  app.get("/wanted/jobs/:id/ranking", async (req) => ({ offers: ctx.wanted.rankOffers(requireUser(ctx, req), params(req).id) }));

  app.post("/wanted/jobs/:id/offers", async (req) => {
    const b = body(z.object({ providerId: z.string(), priceUsd: z.number().positive(), etaDays: z.number().int().min(1).max(365), message: z.string().max(1000) }), req);
    return ctx.wanted.submitOffer(requireUser(ctx, req), params(req).id, b);
  });

  app.post("/wanted/jobs/:id/select", async (req) => {
    const b = body(z.object({ offerId: z.string() }), req);
    return ctx.wanted.select(requireUser(ctx, req), params(req).id, b.offerId);
  });

  /** Turns the selected offer into an UNDO escrow agreement. */
  app.post("/wanted/jobs/:id/escrow", async (req) => {
    const user = requireUser(ctx, req);
    const b = body(z.object({ fundingMode: z.enum(["wallet", "agent"]).default("wallet"), agentId: z.string().optional(), milestones: milestones.optional(), reviewer: z.string().nullable().optional(), arbiter: z.string().nullable().optional(), reviewPeriodDays: z.number().min(0).max(30).optional(), totalAtomic: atomic.optional() }), req);
    const job = ctx.db.get<{ user_id: string; status: string; selected_offer_id: string | null; title: string; description: string; completion_conditions_json: string; deadline: string; goal_id: string | null }>("SELECT * FROM jobs WHERE id = ?", [params(req).id]);
    if (!job || job.user_id !== user.id) throw notFound("job");
    if (job.status !== "selected" || !job.selected_offer_id) throw conflict("no_selection", "select an offer first");
    const offer = ctx.db.get<{ price_usd: number; provider_id: string; eta_days: number }>("SELECT * FROM offers WHERE id = ?", [job.selected_offer_id])!;
    const provider = ctx.db.get<{ account_id: string }>("SELECT account_id FROM providers WHERE id = ?", [offer.provider_id])!;
    let plan: Plan | null = null;
    if (job.goal_id) plan = parse<{ plan: Plan }>(ctx.db.get<{ plan_json: string }>("SELECT plan_json FROM goals WHERE id = ?", [job.goal_id])!.plan_json).plan;
    const days = Math.max(1, Math.ceil((Date.parse(job.deadline) - Date.now()) / 86_400_000));
    const res = await ctx.escrow.prepare(user, {
      provider: provider.account_id,
      amountUsd: offer.price_usd,
      totalAtomic: b.totalAtomic,
      milestones: b.milestones ?? plan?.hire?.milestones ?? [{ title: "Complete delivery", sharePct: 100 }],
      deadlineDays: days,
      reviewPeriodDays: b.reviewPeriodDays,
      reviewer: b.reviewer ?? null,
      arbiter: b.arbiter ?? null,
      completionConditions: parse<string[]>(job.completion_conditions_json),
      evidenceRequirements: plan?.hire?.evidenceRequirements ?? ["Link or files for the delivered work"],
      description: `${job.title}\n\n${job.description}`,
      jobId: params(req).id,
      fundingMode: b.fundingMode,
      agentId: b.agentId,
    });
    ctx.wanted.markEscrowed(params(req).id, res.escrowId as string);
    return res;
  });

  app.post("/wanted/jobs/:id/rate", async (req) => {
    const b = body(z.object({ rating: z.number().min(1).max(5) }), req);
    return ctx.wanted.rate(requireUser(ctx, req), params(req).id, b.rating);
  });

  // -------------------------------------------------------------- UNDO escrow
  app.get("/escrows", async (req) => ({ escrows: ctx.escrow.list(requireUser(ctx, req)) }));

  app.post("/escrows", async (req) => {
    const b = body(z.object({
      provider: z.string(), amountUsd: z.number().positive().optional(), totalAtomic: atomic.optional(),
      asset: z.discriminatedUnion("kind", [z.object({ kind: z.literal("native") }), z.object({ kind: z.literal("ft"), contract_id: z.string() })]).optional(),
      milestones, deadlineDays: z.number().int().min(1).max(365), reviewPeriodDays: z.number().min(0).max(30).optional(),
      reviewer: z.string().nullable().optional(), arbiter: z.string().nullable().optional(),
      completionConditions: z.array(z.string()).default([]), evidenceRequirements: z.array(z.string()).default([]),
      description: z.string().max(2000).default(""), fundingMode: z.enum(["wallet", "agent"]).default("wallet"), agentId: z.string().optional(),
    }), req);
    if (!b.amountUsd && !b.totalAtomic) throw badRequest("amount_required", "amountUsd or totalAtomic is required");
    return ctx.escrow.prepare(requireUser(ctx, req), b);
  });

  app.get("/escrows/:id", async (req) => ctx.escrow.get(requireUser(ctx, req), params(req).id));
  app.get("/escrows/:id/events", async (req) => {
    ctx.escrow.get(requireUser(ctx, req), params(req).id);
    return { events: ctx.escrow.events(params(req).id) };
  });

  app.post("/escrows/:id/confirm", async (req) => {
    const b = body(z.object({ txHash: z.string().min(20) }), req);
    return ctx.escrow.confirmCreate(requireUser(ctx, req), params(req).id, b.txHash);
  });

  app.post("/escrows/:id/sync", async (req) => {
    ctx.escrow.get(requireUser(ctx, req), params(req).id);
    return ctx.escrow.sync(params(req).id);
  });

  /** Returns the contract call for the caller's wallet; the backend never signs it. */
  app.post("/escrows/:id/actions/:action", async (req) => {
    const b = body(z.object({ milestoneIndex: z.number().int().min(0).optional(), reason: z.string().max(256).optional(), evidenceHash: z.string().max(128).optional(), evidenceUri: z.string().max(256).nullable().optional(), providerAmount: atomic.optional(), note: z.string().max(256).optional() }), req);
    return ctx.escrow.action(requireUser(ctx, req), params(req).id, params(req).action, b);
  });

  app.post("/escrows/:id/tx", async (req) => {
    const b = body(z.object({ action: z.string().max(40), txHash: z.string().min(20) }), req);
    return ctx.escrow.recordTx(requireUser(ctx, req), params(req).id, b.action, b.txHash);
  });

  // -------------------------------------------------------------- evidence (off-chain, hash on-chain)
  app.post("/evidence", async (req) => {
    const b = body(z.object({ filename: z.string().min(1).max(200), mime: z.string().max(100).default("application/octet-stream"), dataBase64: z.string().min(4) }), req);
    return ctx.evidence.save(requireUser(ctx, req), b);
  });

  app.get("/evidence/:hash", async (req, reply) => {
    requireUser(ctx, req);
    const e = ctx.evidence.get(params(req).hash);
    reply.header("content-type", e.mime).header("content-disposition", `attachment; filename="${e.filename.replace(/"/g, "")}"`);
    return reply.send(createReadStream(e.path));
  });

  // -------------------------------------------------------------- PROOF OF LIFE
  app.get("/pol/challenges", async () => ({ challenges: await ctx.pol.challenges() }));
  app.get("/pol/challenges/:id", async (req) => ctx.pol.challenge(params(req).id));
  app.get("/pol/leaderboard", async () => ({ leaderboard: await ctx.pol.leaderboard() }));
  app.get("/pol/treasury", async () => ctx.pol.treasury());
  app.get("/pol/contributors/:account", async (req) => ctx.pol.contributor(params(req).account));

  app.post("/pol/challenges", async (req) => {
    requireUser(ctx, req);
    const b = body(z.object({ kind: z.enum(["challenge", "bounty", "community_objective"]), title: z.string().min(3).max(200), rulesHash: z.string().min(8).max(128), metadataUri: z.string().max(256).nullable().optional(), reviewers: z.array(z.string()).max(10).default([]), rewardNear: z.string().regex(/^\d+(\.\d+)?$/), maxApprovals: z.number().int().min(1).max(1000), deadlineDays: z.number().int().min(1).max(365) }), req);
    return { walletTransactions: [ctx.pol.createTx(b)] };
  });

  app.post("/pol/challenges/:id/submit", async (req) => {
    requireUser(ctx, req);
    const b = body(z.object({ evidenceHash: z.string().min(8).max(128), evidenceUri: z.string().max(256).nullable().optional() }), req);
    return { walletTransactions: [ctx.pol.submitTx(params(req).id, b.evidenceHash, b.evidenceUri ?? null)] };
  });

  app.post("/pol/challenges/:id/review", async (req) => {
    requireUser(ctx, req);
    const b = body(z.object({ contributor: z.string(), approve: z.boolean(), note: z.string().max(256).nullable().optional() }), req);
    return { walletTransactions: [ctx.pol.reviewTx(params(req).id, b.contributor, b.approve, b.note ?? null)] };
  });

  app.post("/pol/challenges/:id/close", async (req) => {
    requireUser(ctx, req);
    return { walletTransactions: [ctx.pol.closeTx(params(req).id)] };
  });

  app.post("/pol/tx", async (req) => {
    const b = body(z.object({ action: z.string().max(40), txHash: z.string().min(20), challengeId: z.string().optional() }), req);
    return ctx.pol.recordTx(requireUser(ctx, req), b.action, b.txHash, { challengeId: b.challengeId });
  });
}
