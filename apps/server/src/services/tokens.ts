import { atomicToUsd } from "../lib/amounts.js";

export interface TokenInfo {
  assetId: string;
  symbol: string;
  decimals: number;
  blockchain: string;
  price: number | null;
  contractAddress?: string | null;
  priceUpdatedAt?: string | null;
}

/**
 * Live catalogue of assets NEAR Intents supports, with USD prices. Two sources:
 *  - the Agent API's public `/v1/tokens` (what an agent can hold and spend)
 *  - 1Click's `/v0/tokens` (what a user can swap from their own wallet)
 * Nothing is assumed supported unless it appears here.
 */
export class TokenCatalog {
  private cache = new Map<string, { at: number; tokens: TokenInfo[] }>();
  constructor(
    private readonly agentApiUrl: string,
    private readonly oneClickUrl: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly ttlMs = 60_000,
  ) {}

  private async cached(key: string, load: () => Promise<TokenInfo[]>) {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.tokens;
    try {
      const tokens = await load();
      this.cache.set(key, { at: Date.now(), tokens });
      return tokens;
    } catch (e) {
      if (hit) return hit.tokens; // serve stale prices rather than nothing; callers see priceUpdatedAt
      throw e;
    }
  }

  agentTokens(): Promise<TokenInfo[]> {
    return this.cached("agent", async () => {
      const r = await this.fetcher(`${this.agentApiUrl}/v1/tokens`, { signal: AbortSignal.timeout(15_000) });
      if (!r.ok) throw new Error(`agent tokens: HTTP ${r.status}`);
      const body = (await r.json()) as { data: { asset_id: string; symbol: string; decimals: number; blockchain: string; price: number | null; price_updated_at: string | null }[] };
      return body.data.map((t) => ({ assetId: t.asset_id, symbol: t.symbol, decimals: t.decimals, blockchain: t.blockchain, price: t.price, priceUpdatedAt: t.price_updated_at }));
    });
  }

  oneClickTokens(): Promise<TokenInfo[]> {
    return this.cached("oneclick", async () => {
      const r = await this.fetcher(`${this.oneClickUrl}/v0/tokens`, { signal: AbortSignal.timeout(15_000) });
      if (!r.ok) throw new Error(`1click tokens: HTTP ${r.status}`);
      const body = (await r.json()) as { assetId: string; symbol: string; decimals: number; blockchain: string; price: number; contractAddress?: string; priceUpdatedAt?: string }[];
      return body.map((t) => ({ assetId: t.assetId, symbol: t.symbol, decimals: t.decimals, blockchain: t.blockchain, price: t.price ?? null, contractAddress: t.contractAddress ?? null, priceUpdatedAt: t.priceUpdatedAt ?? null }));
    });
  }

  async find(assetId: string, source: "agent" | "oneclick" = "agent"): Promise<TokenInfo | undefined> {
    const list = source === "agent" ? await this.agentTokens() : await this.oneClickTokens();
    return list.find((t) => t.assetId === assetId);
  }

  /** Finds a NEAR-chain NEP-141 token by its contract account id (for manual wallet analysis). */
  async findNearContract(contractId: string): Promise<TokenInfo | undefined> {
    const list = await this.oneClickTokens().catch(() => [] as TokenInfo[]);
    return list.find((t) => t.blockchain === "near" && (t.contractAddress === contractId || t.assetId === `nep141:${contractId}`));
  }

  async usdValue(assetId: string, atomic: string, source: "agent" | "oneclick" = "agent"): Promise<number | null> {
    const t = await this.find(assetId, source).catch(() => undefined);
    if (!t) return null;
    return atomicToUsd(atomic, t.decimals, t.price);
  }

  /** USD price of NEAR (via wNEAR), used to value native NEAR amounts. */
  async nearUsd(): Promise<number | null> {
    const t = (await this.find("nep141:wrap.near", "oneclick").catch(() => undefined)) ?? (await this.find("nep141:wrap.near").catch(() => undefined));
    return t?.price ?? null;
  }
}
