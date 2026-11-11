import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { publicConfig } from "../config.js";
import type { AppContext } from "../context.js";
import type { Scheduler } from "../scheduler.js";
import { body, query, requireUser, SESSION_COOKIE, sessionToken, signedChallenge } from "./http.js";

export function coreRoutes(app: FastifyInstance, ctx: AppContext, scheduler: Scheduler) {
  app.get("/health", async () => ({ ok: true, mode: ctx.config.VEYRA_MODE, scheduler: scheduler.lastRun }));
  app.get("/config", async () => publicConfig(ctx.config));

  // -------------------------------------------------------------- auth (NEP-413 wallet login)
  app.post("/auth/challenge", async (req) => {
    const { accountId } = body(z.object({ accountId: z.string() }), req);
    return ctx.auth.createChallenge(accountId, "login");
  });

  app.post("/auth/login", async (req, reply) => {
    const signed = body(signedChallenge, req);
    const out = await ctx.auth.login(signed);
    reply.setCookie(SESSION_COOKIE, out.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: ctx.config.NODE_ENV === "production",
      path: "/",
      expires: new Date(out.expiresAt),
    });
    // The token is also returned for non-browser API clients.
    return { user: out.user, expiresAt: out.expiresAt, token: out.token };
  });

  app.post("/auth/logout", async (req, reply) => {
    const t = sessionToken(req);
    if (t) ctx.auth.logout(t);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/auth/me", async (req) => ({ user: requireUser(ctx, req) }));

  // -------------------------------------------------------------- audit & notifications
  app.get("/audit", async (req) => {
    const user = requireUser(ctx, req);
    const q = query(z.object({ limit: z.coerce.number().optional(), before: z.coerce.number().optional(), subject: z.string().optional() }), req);
    return { entries: ctx.audit.list(user.id, q) };
  });

  app.get("/audit/verify", async (req) => {
    requireUser(ctx, req);
    return ctx.audit.verify();
  });

  app.get("/notifications", async (req) => {
    const user = requireUser(ctx, req);
    const q = query(z.object({ unread: z.coerce.boolean().optional() }), req);
    return { notifications: ctx.notifier.list(user.id, q.unread) };
  });

  app.post("/notifications/read", async (req) => {
    const user = requireUser(ctx, req);
    const b = body(z.object({ ids: z.union([z.array(z.string()), z.literal("all")]) }), req);
    ctx.notifier.markRead(user.id, b.ids);
    return { ok: true };
  });

  /** Server-sent events: live notifications and operation status changes. */
  app.get("/events", async (req, reply) => {
    const user = requireUser(ctx, req);
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "access-control-allow-origin": ctx.config.PUBLIC_WEB_ORIGIN,
      "access-control-allow-credentials": "true",
    });
    reply.raw.write(": connected\n\n");
    const off = ctx.notifier.subscribe(user.id, (n) => reply.raw.write(`event: ${n.kind}\ndata: ${JSON.stringify(n)}\n\n`));
    const ping = setInterval(() => reply.raw.write(": ping\n\n"), 25_000);
    req.raw.on("close", () => {
      clearInterval(ping);
      off();
    });
    return reply;
  });
}
