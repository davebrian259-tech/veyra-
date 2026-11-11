import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { unauthorized } from "../lib/errors.js";
import type { User } from "../services/auth.js";

export const SESSION_COOKIE = "veyra_session";

export function sessionToken(req: FastifyRequest): string | undefined {
  const h = req.headers.authorization;
  if (h?.startsWith("Bearer ")) return h.slice(7);
  return (req.cookies as Record<string, string | undefined> | undefined)?.[SESSION_COOKIE];
}

export function requireUser(ctx: AppContext, req: FastifyRequest): User {
  const user = ctx.auth.userFromToken(sessionToken(req));
  if (!user) throw unauthorized();
  return user;
}

export function body<T extends z.ZodTypeAny>(schema: T, req: FastifyRequest): z.infer<T> {
  return schema.parse(req.body ?? {});
}

export function query<T extends z.ZodTypeAny>(schema: T, req: FastifyRequest): z.infer<T> {
  return schema.parse(req.query ?? {});
}

export const params = (req: FastifyRequest) => req.params as Record<string, string>;

export const signedChallenge = z.object({
  accountId: z.string(),
  publicKey: z.string(),
  signature: z.string(),
  nonce: z.string(),
});

export const atomic = z.string().regex(/^\d+$/, "atomic units (integer string)");

export type Reply = FastifyReply;
