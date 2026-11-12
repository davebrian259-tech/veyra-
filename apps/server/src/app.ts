import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { ZodError } from "zod";
import type { Config } from "./config.js";
import { buildContext, type ContextOverrides } from "./context.js";
import { HttpError } from "./lib/errors.js";
import { agentRoutes } from "./routes/agents.js";
import { coreRoutes } from "./routes/core.js";
import { contractorRoutes } from "./routes/contractor.js";
import { heistRoutes } from "./routes/heist.js";
import { Scheduler } from "./scheduler.js";

export async function buildApp(config: Config, overrides: ContextOverrides = {}) {
  const ctx = buildContext(config, overrides);
  const app = Fastify({
    trustProxy: true,
    logger: config.NODE_ENV === "test" ? false : { level: "info", redact: ["req.headers.authorization", "req.headers.cookie", "req.headers['x-api-key']"] },
    bodyLimit: 15 * 1024 * 1024,
  });
  await app.register(cookie);
  await app.register(cors, { origin: config.PUBLIC_WEB_ORIGIN.split(","), credentials: true });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) return reply.status(400).send({ error: "validation_error", message: "invalid request", issues: err.issues });
    if (err instanceof HttpError) return reply.status(err.statusCode).send({ error: err.code, message: err.message, details: err.details });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    return reply.status(status).send({ error: status >= 500 ? "internal_error" : "error", message: status >= 500 ? "internal error" : (err as Error).message });
  });

  const scheduler = new Scheduler(ctx, config.MONITOR_INTERVAL_MS);
  coreRoutes(app, ctx, scheduler);
  agentRoutes(app, ctx);
  contractorRoutes(app, ctx, scheduler);
  heistRoutes(app, ctx);
  app.addHook("onClose", async () => {
    scheduler.stop();
  });
  return { app, ctx, scheduler };
}
