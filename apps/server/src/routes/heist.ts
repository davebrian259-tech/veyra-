import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.js";
import { body, params, query } from "./http.js";

/** Veyra Heist. Public: anyone can play practice runs; ranked runs are paid from the player's wallet. */
/** The player's address: the Pages proxy passes the visitor's IP; direct calls use the socket. */
const who = (req: FastifyRequest) => {
  const h = req.headers["x-veyra-client-ip"];
  return (Array.isArray(h) ? h[0] : h)?.slice(0, 64) || req.ip;
};

export function heistRoutes(app: FastifyInstance, ctx: AppContext) {
  const H = ctx.heist;

  app.get("/heist", async () => ({
    vaults: await H.vaults(),
    templates: H.templates(),
    stats: H.stats(),
    ranked: { enabled: H.rankedEnabled, contractId: H.contractId, network: H.network, explorer: H.contractId ? H.explorer("address", H.contractId) : null },
  }));
  app.get("/heist/leaderboard", async (req) => ({ players: H.leaderboard(query(z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }), req).limit) }));
  app.get("/heist/runs", async (req) => {
    const q = query(z.object({ vault: z.coerce.number().int().min(1).max(5).optional(), kind: z.enum(["practice", "ranked"]).optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }), req);
    return { runs: H.recent(q.limit, q.vault, q.kind) };
  });
  app.get("/heist/runs/:id", async (req) => H.get(params(req).id));
  app.get("/heist/runs/:id/replay", async (req) => H.replay(params(req).id));

  app.post("/heist/vaults/:vault/practice", async (req) => {
    H.limit(who(req));
    return H.practice(Number(params(req).vault), (req.body as { spec?: unknown } | undefined)?.spec);
  });
  app.post("/heist/ranked", async (req) => {
    H.limit(who(req));
    const b = body(z.object({ txHash: z.string().min(20).max(80), accountId: z.string().min(2).max(64), spec: z.unknown() }), req);
    return H.ranked(b);
  });
  app.get("/heist/series", async () => H.series());
  app.get("/heist/players/:who", async (req) => H.player(z.string().min(1).max(64).parse(params(req).who)));
  app.get("/heist/accounts/:account", async (req) => H.account(z.string().regex(/^[a-z0-9._-]{2,64}$/).parse(params(req).account)));
  app.get("/heist/tx/:hash", async (req) => H.tx(z.string().min(20).max(80).parse(params(req).hash), z.string().regex(/^[a-z0-9._-]{2,64}$/).parse(query(z.object({ sender: z.string() }), req).sender)));
  app.post("/heist/vaults/:vault/preview", async (req) => {
    H.limit(who(req));
    return H.preview(Number(params(req).vault), (req.body as { spec?: unknown } | undefined)?.spec);
  });
  app.get("/heist/stakes/:vault/:account", async (req) => ({ stake: await H.stake(Number(params(req).vault), params(req).account) }));
}
