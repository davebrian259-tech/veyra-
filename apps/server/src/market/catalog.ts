import type { MarketAgent, PricingPlan, TreasuryRecipient } from "./types.js";

export interface MarketEndpoints {
  /** Origin of the marketplace REST API, e.g. https://market.near.ai */
  origin: string;
  /** Where an agent's A2A server lives, e.g. https://{handle}.market.near.ai */
  agentOrigin: (handle: string) => string;
}

export const LIVE_MARKET: MarketEndpoints = {
  origin: "https://market.near.ai",
  agentOrigin: (handle) => `https://${handle}.market.near.ai`,
};

/**
 * Public, unauthenticated reads of the Agent Market: catalog, agent cards, pricing plans,
 * reputation and the treasury the market settles x402 payments to.
 */
export class MarketCatalog {
  private treasuryCache?: { at: number; value: TreasuryRecipient[] };

  constructor(readonly endpoints: MarketEndpoints, private readonly fetcher: typeof fetch = fetch) {}

  private async get<T>(url: string): Promise<T> {
    const res = await this.fetcher(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`market GET ${new URL(url).pathname}: HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  async search(q: { text?: string; category?: string; limit?: number; sort?: "delivered" | string } = {}): Promise<MarketAgent[]> {
    const u = new URL("/v1/agents", this.endpoints.origin);
    if (q.text) u.searchParams.set("q", q.text);
    if (q.category) u.searchParams.set("category", q.category);
    u.searchParams.set("limit", String(q.limit ?? 20));
    if (q.sort) u.searchParams.set("sort", q.sort);
    const body = await this.get<{ agents: MarketAgent[] }>(u.toString());
    return body.agents ?? [];
  }

  agent(idOrHandle: string) {
    return this.get<MarketAgent>(new URL(`/v1/agents/${encodeURIComponent(idOrHandle)}`, this.endpoints.origin).toString());
  }

  async defaultPlan(agentId: string): Promise<PricingPlan | null> {
    const body = await this.get<{ plans?: PricingPlan[]; pricing_plans?: PricingPlan[]; data?: PricingPlan[] } | PricingPlan[]>(
      new URL(`/v1/agents/${encodeURIComponent(agentId)}/pricing-plans`, this.endpoints.origin).toString(),
    );
    const plans = Array.isArray(body) ? body : (body.plans ?? body.pricing_plans ?? body.data ?? []);
    return plans.find((p) => p.is_default) ?? null;
  }

  reputation(agentId: string) {
    return this.get<Record<string, unknown>>(new URL(`/v1/agents/${encodeURIComponent(agentId)}/reputation`, this.endpoints.origin).toString()).catch(() => null);
  }

  agentCard(handle: string) {
    return this.get<{ name: string; supportedInterfaces?: { url: string }[]; skills?: unknown[] }>(`${this.endpoints.agentOrigin(handle)}/.well-known/agent-card.json`);
  }

  /**
   * The settlement recipients published by the marketplace itself. Fetched from the market
   * origin only — never from an agent host or a 402 body — and used to pin every payment.
   */
  async treasury(): Promise<TreasuryRecipient[]> {
    if (this.treasuryCache && Date.now() - this.treasuryCache.at < 10 * 60_000) return this.treasuryCache.value;
    const body = await this.get<{ recipients: TreasuryRecipient[] }>(new URL("/.well-known/x402", this.endpoints.origin).toString());
    this.treasuryCache = { at: Date.now(), value: body.recipients ?? [] };
    return this.treasuryCache.value;
  }
}

export function planPriceAtomic(plan: PricingPlan, decimals = 6): string {
  const [w, f = ""] = String(plan.price_amount).split(".");
  return (BigInt(w || "0") * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0")).toString();
}
