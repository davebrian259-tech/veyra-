import { ed25519 } from "@noble/curves/ed25519.js";
import { loadConfig } from "../src/config.js";
import { buildApp } from "../src/app.js";
import { Db } from "../src/db.js";
import { NearRpc, type TxOutcome } from "../src/lib/near-rpc.js";
import { encodePublicKey, signNep413 } from "../src/lib/nep413.js";

export const USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
export const WNEAR = "nep141:wrap.near";

export function testConfig(extra: Record<string, string> = {}) {
  return loadConfig({
    NODE_ENV: "test",
    DATABASE_PATH: ":memory:",
    NEAR_INTENTS_AGENT_API_KEY: "test-partner-key",
    NEAR_INTENTS_AGENT_API_URL: "https://agent-api.test",
    ONECLICK_API_URL: "https://oneclick.test",
    VEYRA_MODE: "live",
    WATCHTOWER_INTERVAL_HOURS: "0",
    ...extra,
  });
}

/** In-memory NEAR RPC: every named account exists unless its name contains "ghost". */
export class FakeRpc extends NearRpc {
  outcomes = new Map<string, TxOutcome>();
  views = new Map<string, unknown>();
  constructor() {
    super("http://fake-rpc");
  }
  override async accountExists(id: string) {
    return !id.includes("ghost");
  }
  override async viewAccount(id: string) {
    if (id.includes("ghost")) throw new Error("UNKNOWN_ACCOUNT");
    return { amount: "10000000000000000000000000", locked: "0", code_hash: id.includes("escrow") ? "contract" : "11111111111111111111111111111111", storage_usage: 500, block_height: 1 };
  }
  override async viewAccessKey() {
    return { nonce: 1, permission: "FullAccess" as const };
  }
  override async viewAccessKeyList() {
    return [
      { public_key: "ed25519:full", access_key: { nonce: 1, permission: "FullAccess" as const } },
      { public_key: "ed25519:fc", access_key: { nonce: 1, permission: { FunctionCall: { allowance: null, receiver_id: "wrap.neer", method_names: [] } } } },
    ];
  }
  override async view<T>(contract: string, method: string, args: unknown = {}): Promise<T> {
    const key = `${contract}.${method}.${JSON.stringify(args)}`;
    if (this.views.has(key)) return this.views.get(key) as T;
    if (this.views.has(`${contract}.${method}`)) return this.views.get(`${contract}.${method}`) as T;
    throw new Error(`no fake view for ${key}`);
  }
  override async txStatus(hash: string) {
    const o = this.outcomes.get(hash);
    if (!o) throw new Error("UNKNOWN_TRANSACTION");
    return o;
  }
}

type Handler = (req: { method: string; url: URL; headers: Record<string, string>; body: any }) => { status?: number; body: unknown } | undefined;

/** Fake NEAR Intents Agent API + 1Click endpoints, recording every request. */
export function fakeNetwork() {
  const requests: { method: string; url: string; headers: Record<string, string>; body: any }[] = [];
  const statuses = new Map<string, any>();
  const intents = new Map<string, any>();
  let n = 0;
  const agentId = "agt_test_1";
  const extra: Handler[] = [];
  const policyDenied = new Set<string>();

  const tokens = [
    { asset_id: USDC, symbol: "USDC", decimals: 6, blockchain: "near", price: 1, price_updated_at: null, price_expires_at: null },
    { asset_id: WNEAR, symbol: "wNEAR", decimals: 24, blockchain: "near", price: 4, price_updated_at: null, price_expires_at: null },
  ];
  const status = (id: string, type: string, st: string, details: Record<string, unknown> = {}) => ({
    correlation_id: id, agent_id: agentId, status: st, failure_code: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    dispatch_committed_at: null, grant: null, type, details,
  });

  const handle: Handler = ({ method, url, headers, body }) => {
    for (const h of extra) {
      const r = h({ method, url, headers, body });
      if (r) return r;
    }
    const p = url.pathname;
    if (url.host === "oneclick.test" && p === "/v0/tokens") return { body: tokens.map((t) => ({ assetId: t.asset_id, symbol: t.symbol, decimals: t.decimals, blockchain: t.blockchain, price: t.price, contractAddress: t.asset_id.replace("nep141:", "") })) };
    if (p === "/v1/tokens") return { body: { data: tokens } };
    if (p === "/v1/generate-intent") {
      const id = `cor_${++n}`;
      const g = { correlation_id: id, type: body.type, agent_id: body.agent_id ?? agentId, status: "PENDING_SIGNATURE", expires_at: new Date(Date.now() + 600_000).toISOString(),
        signer: body.owner ?? { type: "near", account_id: "alice.testnet", public_key: "ed25519:x" },
        intent: { standard: "nep413", payload: { message: JSON.stringify({ type: body.type, n }), recipient: "intents.near", nonce: Buffer.alloc(32, n).toString("base64") } },
        preview: { summary: `${body.type} preview`, policy: body.policy } };
      intents.set(id, { ...g, request: body });
      return { status: 201, body: g };
    }
    if (p === "/v1/submit-intent") {
      const g = intents.get(body.correlation_id);
      const details = g.type === "grant_issue" ? { grant_id: "grant_1" } : { revision: 1 };
      const s = status(body.correlation_id, g.type, "SUCCESS", details);
      statuses.set(body.correlation_id, s);
      return { body: s };
    }
    if (p === "/v1/status") return { body: statuses.get(url.searchParams.get("correlation_id")!) };
    if (p === `/v1/agents/${agentId}`) return { body: { id: agentId, name: "Test agent", external_user_id: null, status: "ACTIVE", archived: false, deleted: false, owner: null, owner_account: null, wallet: { wallet_id: "w1", near_account_id: "agent-1.near", evm_account_id: null, solana_account_id: null }, created_at: "", cooldowns: { policy_change_available_at: null, unfreeze_available_at: null } } };
    if (p === `/v1/agents/${agentId}/policy`) return { body: { wallet_id: "w1", revision: 1, policy_hash: "h", status: "APPLIED", applied_at: null, transaction_hash: null, provider_policy_synced: true, cooldowns: {}, policy: { frozen: false }, usage: {} } };
    if (p === `/v1/agents/${agentId}/grants`) return { body: [] };
    const m = p.match(/^\/v1\/agents\/[^/]+\/(transfer|swap|withdraw|native\/near\/call)$/);
    if (m) {
      if (!headers["x-grant-token"]?.startsWith("ngt_")) return { status: 401, body: { errors: [{ status: "401", code: "grant_required", layer: "grant", title: "grant required" }], meta: {} } };
      const kind = m[1];
      if (body.dry) return { body: { dry: true, type: kind, quote: { amount_out: "1000000", min_amount_out: "995000" }, spend: { amount_usd: null, budget: {} }, owner_approval: false, fee: { amount_usd: "0.01", percent: "0.1" }, warnings: [] } };
      if (policyDenied.has(body.recipient ?? "")) return { status: 403, body: { errors: [{ status: "403", code: "policy_destination_denied", layer: "policy", title: "denied", meta: { retryable: false } }], meta: {} } };
      const id = `exec_${++n}`;
      statuses.set(id, status(id, kind.replace("native/near/call", "native"), "SUCCESS", { tx_hash: `tx${n}`, amount_out: "1000000" }));
      return { body: { ...status(id, kind, "PROCESSING", { tx_hash: null }), idempotency_key: headers["idempotency-key"] } };
    }
    return undefined;
  };

  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input.toString() : input.url);
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const method = (init?.method ?? "GET").toUpperCase();
    requests.push({ method, url: url.toString(), headers, body });
    const r = handle({ method, url, headers, body });
    if (!r) return new Response(JSON.stringify({ errors: [{ status: "404", code: "not_found", layer: "api", title: `no fake for ${url}` }], meta: {} }), { status: 404, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  return { fetcher, requests, statuses, intents, agentId, extra, policyDenied, tokens };
}

export function keypair() {
  const sk = ed25519.utils.randomSecretKey();
  return { sk, publicKey: encodePublicKey(ed25519.getPublicKey(sk)) };
}

export async function setup(extraEnv: Record<string, string> = {}) {
  const net = fakeNetwork();
  const rpc = new FakeRpc();
  const db = new Db(":memory:");
  const { app, ctx, scheduler } = await buildApp(testConfig(extraEnv), { db, fetch: net.fetcher, rpc, verifyKeysOnChain: true, nearAi: null });
  const accountId = "alice.testnet";
  const kp = keypair();
  const responses: string[] = [];
  const call = async (method: string, url: string, payload?: unknown, token?: string) => {
    const res = await app.inject({ method: method as never, url, payload: payload as never, headers: token ? { authorization: `Bearer ${token}` } : {} });
    responses.push(res.body);
    return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
  };
  const sign = (message: string, nonce: string, recipient: string) => signNep413({ message, recipient, nonce: new Uint8Array(Buffer.from(nonce, "base64")) }, kp.sk);
  const login = async () => {
    const ch = await call("POST", "/auth/challenge", { accountId });
    const r = await call("POST", "/auth/login", { accountId, publicKey: kp.publicKey, nonce: ch.json.nonce, signature: sign(ch.json.message, ch.json.nonce, ch.json.recipient) });
    return r.json.token as string;
  };
  return { app, ctx, scheduler, net, rpc, db, call, login, sign, kp, accountId, responses };
}

/** Signs an Agent API nep413 intent the way the wallet would. */
export function signedIntent(intent: { standard: string; payload: any }, publicKey: string) {
  return { ...intent, public_key: publicKey, signature: "c2lnbmF0dXJl" };
}
