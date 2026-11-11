import type { Db } from "../db.js";
import { now, parse } from "../db.js";
import type { SecretBox } from "../lib/crypto.js";
import { conflict } from "../lib/errors.js";

/**
 * OAuth for the Agent Market's buyer MCP (`/mcp/pro`): dynamic client registration and the
 * device-authorization grant, so the owner approves Veyra once on market.near.ai and the
 * backend never handles their password. Tokens are sealed at rest.
 * Metadata: https://market.near.ai/.well-known/oauth-authorization-server
 */
interface TokenSet {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  scope?: string;
}

const KV_CLIENT = "market.oauth.client";
const KV_TOKENS = "market.oauth.tokens";
const KV_DEVICE = "market.oauth.device";

export class MarketOAuth {
  constructor(
    private readonly db: Db,
    private readonly secrets: SecretBox,
    private readonly origin: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private kvGet<T>(key: string): T | null {
    const r = this.db.get<{ value_json: string }>("SELECT value_json FROM kv WHERE key = ?", [key]);
    return r ? parse<T>(r.value_json) : null;
  }
  private kvSet(key: string, value: unknown) {
    this.db.run("INSERT OR REPLACE INTO kv (key, value_json, updated_at) VALUES (?,?,?)", [key, JSON.stringify(value), now()]);
  }

  private async form<T>(path: string, body: Record<string, string>): Promise<{ status: number; body: T }> {
    const res = await this.fetcher(new URL(path, this.origin), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(20_000),
    });
    return { status: res.status, body: (await res.json()) as T };
  }

  async clientId(): Promise<string> {
    const existing = this.kvGet<{ client_id: string }>(KV_CLIENT);
    if (existing) return existing.client_id;
    const res = await this.fetcher(new URL("/oauth/register", this.origin), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Veyra contractor",
        grant_types: ["urn:ietf:params:oauth:grant-type:device_code", "refresh_token"],
        token_endpoint_auth_method: "none",
        redirect_uris: ["http://localhost/unused"],
        scope: "mcp hiring",
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`oauth register: HTTP ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { client_id: string };
    this.kvSet(KV_CLIENT, { client_id: body.client_id });
    return body.client_id;
  }

  /** Step 1: show the owner `user_code` and `verification_uri`. */
  async startDeviceFlow() {
    const client_id = await this.clientId();
    const r = await this.form<{ device_code: string; user_code: string; verification_uri: string; verification_uri_complete?: string; expires_in: number; interval?: number }>(
      "/oauth/device/code",
      { client_id, scope: "mcp hiring", resource: new URL("/mcp/pro", this.origin).toString() },
    );
    if (r.status >= 400) throw new Error(`device code: HTTP ${r.status} ${JSON.stringify(r.body)}`);
    this.kvSet(KV_DEVICE, { device_code_enc: this.secrets.seal(r.body.device_code, "market.device"), interval: r.body.interval ?? 5, expires_at: Date.now() + r.body.expires_in * 1000 });
    return { userCode: r.body.user_code, verificationUri: r.body.verification_uri, verificationUriComplete: r.body.verification_uri_complete ?? null, expiresIn: r.body.expires_in };
  }

  /** Step 2: poll until the owner approves. Returns "pending" until then. */
  async pollDeviceFlow(): Promise<"approved" | "pending" | "expired" | "denied"> {
    const d = this.kvGet<{ device_code_enc: string; expires_at: number }>(KV_DEVICE);
    if (!d) throw conflict("no_device_flow", "start the device flow first");
    if (Date.now() > d.expires_at) return "expired";
    const r = await this.form<{ access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string }>("/oauth/token", {
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: this.secrets.open(d.device_code_enc, "market.device"),
      client_id: await this.clientId(),
    });
    if (r.body.access_token) {
      this.store({ access_token: r.body.access_token, refresh_token: r.body.refresh_token, expires_at: Date.now() + (r.body.expires_in ?? 3600) * 1000, scope: r.body.scope });
      this.db.run("DELETE FROM kv WHERE key = ?", [KV_DEVICE]);
      return "approved";
    }
    if (r.body.error === "authorization_pending" || r.body.error === "slow_down") return "pending";
    if (r.body.error === "access_denied") return "denied";
    return "expired";
  }

  private store(t: TokenSet) {
    this.kvSet(KV_TOKENS, { sealed: this.secrets.seal(JSON.stringify(t), "market.tokens") });
  }

  private load(): TokenSet | null {
    const r = this.kvGet<{ sealed: string }>(KV_TOKENS);
    return r ? (JSON.parse(this.secrets.open(r.sealed, "market.tokens")) as TokenSet) : null;
  }

  get connected() {
    return Boolean(this.load());
  }

  /** A valid access token, refreshed when it is about to expire. */
  async accessToken(): Promise<string> {
    const t = this.load();
    if (!t) throw conflict("market_not_connected", "connect the Agent Market account first (device flow)");
    if (t.expires_at - Date.now() > 60_000) return t.access_token;
    if (!t.refresh_token) throw conflict("market_token_expired", "the market token expired; reconnect");
    const r = await this.form<{ access_token: string; refresh_token?: string; expires_in?: number; error?: string }>("/oauth/token", {
      grant_type: "refresh_token",
      refresh_token: t.refresh_token,
      client_id: await this.clientId(),
    });
    if (!r.body.access_token) throw conflict("market_refresh_failed", r.body.error ?? "refresh failed");
    this.store({ access_token: r.body.access_token, refresh_token: r.body.refresh_token ?? t.refresh_token, expires_at: Date.now() + (r.body.expires_in ?? 3600) * 1000 });
    return r.body.access_token;
  }

  disconnect() {
    this.db.run("DELETE FROM kv WHERE key IN (?, ?)", [KV_TOKENS, KV_DEVICE]);
  }
}
