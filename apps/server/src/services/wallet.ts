import type { Db } from "../db.js";
import { parse } from "../db.js";
import { fromAtomic, YOCTO } from "../lib/amounts.js";
import type { NearRpc } from "../lib/near-rpc.js";
import type { User } from "./auth.js";
import type { ManualAnalyzer, ManualTx } from "./bodyguard/manual.js";
import type { NearTxTracker, Network } from "./near-tx.js";
import type { TokenCatalog } from "./tokens.js";

const DEFAULT_TOKENS: Record<Network, string[]> = {
  mainnet: ["wrap.near", "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", "usdt.tether-token.near", "eth.bridge.near"],
  testnet: ["wrap.testnet", "usdc.fakes.testnet", "usdt.fakes.testnet"],
};

/**
 * Manual mode: the user's own wallet holds and signs. Veyra reads balances, analyses
 * transactions before signing, tracks them after, and derives spending insights.
 */
export class WalletService {
  constructor(
    private readonly db: Db,
    private readonly rpc: NearRpc,
    private readonly network: Network,
    private readonly tokens: TokenCatalog,
    private readonly analyzer: ManualAnalyzer,
    private readonly tracker: NearTxTracker,
  ) {}

  async balances(accountId: string, extraTokens: string[] = []) {
    const acct = await this.rpc.viewAccount(accountId);
    const nearPrice = await this.tokens.nearUsd().catch(() => null);
    const near = Number(fromAtomic(acct.amount, YOCTO));
    const priced = this.network === "mainnet";
    const list = [...new Set([...DEFAULT_TOKENS[this.network], ...extraTokens])];
    const fts = await Promise.all(
      list.map(async (contract) => {
        const [bal, meta] = await Promise.all([
          this.rpc.view<string>(contract, "ft_balance_of", { account_id: accountId }).catch(() => null),
          this.rpc.view<{ symbol: string; decimals: number }>(contract, "ft_metadata").catch(() => null),
        ]);
        if (bal == null || !meta || bal === "0") return null;
        const t = await this.tokens.findNearContract(contract);
        const amount = Number(fromAtomic(bal, meta.decimals));
        return { contract, symbol: meta.symbol, decimals: meta.decimals, raw: bal, amount, usd: t?.price != null && priced ? amount * t.price : null };
      }),
    );
    return {
      accountId,
      network: this.network,
      near: { raw: acct.amount, amount: near, storageBytes: acct.storage_usage, usd: nearPrice != null && priced ? near * nearPrice : null },
      tokens: fts.filter(Boolean),
      note: priced ? null : "Testnet assets have no market value; USD values are omitted.",
    };
  }

  analyze(user: User, tx: ManualTx) {
    return this.analyzer.analyze(user.id, user.accountId, tx);
  }

  accessKeys(user: User) {
    return this.analyzer.analyzeAccessKeys(user.id, user.accountId);
  }

  /** Records a transaction the user's wallet signed so it is tracked to finality. */
  record(user: User, input: { txHash: string; kind: string; receiver?: string; asset?: string; amount?: string; usdValue?: number | null; analysis?: unknown }) {
    return {
      operationId: this.tracker.track(user.id, {
        kind: input.kind.startsWith("manual_") ? input.kind : `manual_${input.kind}`,
        txHash: input.txHash,
        signerId: user.accountId,
        network: this.network,
        destination: input.receiver ?? null,
        asset: input.asset ?? null,
        amount: input.amount ?? null,
        usdValue: input.usdValue ?? null,
        analysis: input.analysis,
      }),
    };
  }

  /** Spending patterns and unusual activity across manual and agent activity. */
  insights(user: User) {
    const rows = this.db.all<{ kind: string; status: string; usd_value: number | null; asset: string | null; destination: string | null; created_at: string; agent_id: string | null; origin: string }>(
      "SELECT kind, status, usd_value, asset, destination, created_at, agent_id, origin FROM operations WHERE user_id = ? AND created_at >= ? ORDER BY created_at",
      [user.id, new Date(Date.now() - 90 * 86_400_000).toISOString()],
    );
    const spent = rows.filter((r) => ["settled", "confirmed", "submitted"].includes(r.status) && r.usd_value != null);
    const byWeek = new Map<string, number>();
    const byKind = new Map<string, number>();
    const byCounterparty = new Map<string, number>();
    for (const r of spent) {
      const d = new Date(r.created_at);
      const week = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - d.getUTCDay())).toISOString().slice(0, 10);
      byWeek.set(week, (byWeek.get(week) ?? 0) + r.usd_value!);
      byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + r.usd_value!);
      if (r.destination) byCounterparty.set(r.destination, (byCounterparty.get(r.destination) ?? 0) + r.usd_value!);
    }
    const vals = spent.map((r) => r.usd_value!);
    const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    const sd = vals.length > 1 ? Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (vals.length - 1)) : 0;
    const unusual = spent.filter((r) => sd > 0 && (r.usd_value! - mean) / sd > 2.5).map((r) => ({ ...r, zScore: Number(((r.usd_value! - mean) / sd).toFixed(2)) }));
    const blocked = rows.filter((r) => r.status === "blocked").length;
    const weeks = [...byWeek.entries()].sort();
    const last = weeks.at(-1)?.[1] ?? 0;
    const prevAvg = weeks.length > 1 ? weeks.slice(0, -1).reduce((n, [, v]) => n + v, 0) / (weeks.length - 1) : null;
    const tips: string[] = [];
    if (prevAvg && last > prevAvg * 1.5) tips.push(`This week's spending ($${last.toFixed(2)}) is well above your weekly average ($${prevAvg.toFixed(2)}).`);
    if (blocked) tips.push(`BODYGUARD blocked ${blocked} action(s) in the last 90 days. Review them in the security dashboard.`);
    if (unusual.length) tips.push(`${unusual.length} transaction(s) were unusually large compared with your history.`);
    const round = (n: number) => Number(n.toFixed(2));
    return {
      periodDays: 90,
      totalUsd: round(vals.reduce((a, b) => a + b, 0)),
      manualUsd: round(spent.filter((r) => !r.agent_id).reduce((n, r) => n + r.usd_value!, 0)),
      agentUsd: round(spent.filter((r) => r.agent_id).reduce((n, r) => n + r.usd_value!, 0)),
      byWeek: weeks.map(([week, usd]) => ({ week, usd: round(usd) })),
      byKind: Object.fromEntries([...byKind].map(([k, v]) => [k, round(v)])),
      topCounterparties: [...byCounterparty].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([destination, usd]) => ({ destination, usd: round(usd) })),
      unusual,
      blockedActions: blocked,
      tips,
    };
  }

  history(user: User, limit = 100) {
    return this.db
      .all<Record<string, string>>("SELECT * FROM operations WHERE user_id = ? ORDER BY created_at DESC LIMIT ?", [user.id, limit])
      .map((o) => ({ ...o, request: parse(o.request_json), bodyguard: o.bodyguard_json ? parse(o.bodyguard_json) : null, settlement: o.settlement_json ? parse(o.settlement_json) : null, request_json: undefined, bodyguard_json: undefined, settlement_json: undefined }));
  }
}
