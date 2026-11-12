import { join } from "node:path";
import type { Config } from "./config.js";
import { ContractorBrain } from "./contractor/brain.js";
import { ContractorEngine } from "./contractor/engine.js";
import { ContractorGuard } from "./contractor/guard.js";
import { ReceiptService, type Anchorer } from "./contractor/receipts.js";
import { Db, now } from "./db.js";
import { SecretBox } from "./lib/crypto.js";
import { NearRpc } from "./lib/near-rpc.js";
import { keyPairFrom, sendTransaction, actionCreators } from "./lib/near-signer.js";
import { LIVE_MARKET, MarketCatalog } from "./market/catalog.js";
import { McpJobBoard, type JobBoard } from "./market/job-board.js";
import { MarketOAuth } from "./market/oauth.js";
import { MarketWorker } from "./market/worker.js";
import { X402Caller } from "./market/x402.js";
import { AgentService } from "./services/agents.js";
import { NearAiCloud } from "./services/ai/near-ai.js";
import { AiRouter, StandardAi } from "./services/ai/router.js";
import { AuditLog } from "./services/audit.js";
import { AuthService } from "./services/auth.js";
import { Bodyguard } from "./services/bodyguard/engine.js";
import { ExecutionService } from "./services/execution.js";
import { Notifier } from "./services/notifications.js";
import { TokenCatalog } from "./services/tokens.js";
import { SimChain } from "./sim/chain.js";
import { SIM_ENDPOINTS, SIM_USDC, SIM_WORKER_TOKEN, SimMarket } from "./sim/market.js";
import { LiveChain, type Chain } from "./treasury/chain.js";
import { SpendAccount } from "./treasury/spend-account.js";
import { AgentApiVault, SimVault, Treasury, type Vault } from "./treasury/treasury.js";
import { Watchtower, type ThreatReporter } from "./watchtower/scanner.js";
import { MandateService } from "./contractor/mandate.js";
import { X402Seller } from "./contractor/seller.js";

export interface ContextOverrides {
  db?: Db;
  fetch?: typeof fetch;
  rpc?: NearRpc;
  verifyKeysOnChain?: boolean;
  nearAi?: NearAiCloud | null;
}

export type AppContext = ReturnType<typeof buildContext>;

export const SIM_OWNER_ACCOUNT = "veyra-owner.sim";
export const SIM_VAULT_ACCOUNT = "veyra-vault.sim";

export function buildContext(config: Config, o: ContextOverrides = {}) {
  const db = o.db ?? new Db(config.DATABASE_PATH);
  const secrets = SecretBox.fromConfig({
    key: config.VEYRA_ENCRYPTION_KEY,
    production: config.NODE_ENV === "production",
    devKeyPath: config.DATABASE_PATH === ":memory:" ? ":memory:" : join(config.DATABASE_PATH, "..", "dev-encryption.key"),
  });
  const sim = config.VEYRA_MODE === "sim";
  const rpc = o.rpc ?? new NearRpc(config.nearRpcUrl, o.fetch);
  const mainnetRpc = new NearRpc(config.NEAR_MAINNET_RPC_URL, o.fetch);
  const audit = new AuditLog(db);
  const notifier = new Notifier(db);
  const tokens = new TokenCatalog(config.NEAR_INTENTS_AGENT_API_URL, "https://1click.chaindefuser.com", o.fetch);
  const auth = new AuthService(db, rpc, config.VEYRA_AUTH_RECIPIENT, audit, sim ? false : (o.verifyKeysOnChain ?? true));
  const bodyguard = new Bodyguard(db, rpc);
  const agents = new AgentService(db, audit, notifier, secrets, {
    apiKey: config.NEAR_INTENTS_AGENT_API_KEY,
    baseUrl: config.NEAR_INTENTS_AGENT_API_URL,
    grantTtlDays: config.AGENT_GRANT_TTL_DAYS,
    fetch: o.fetch,
  });
  const execution = new ExecutionService(db, agents, bodyguard, tokens, auth, audit, notifier);

  // ---------------------------------------------------------------- AI (private inference)
  const nearAi =
    o.nearAi !== undefined
      ? o.nearAi
      : config.NEAR_AI_API_KEY
        ? new NearAiCloud({ apiKey: config.NEAR_AI_API_KEY, baseUrl: config.NEAR_AI_BASE_URL, model: config.NEAR_AI_MODEL, requireSignature: config.NEAR_AI_REQUIRE_SIGNATURE, fetch: o.fetch })
        : null;
  const standardAi = config.STANDARD_AI_API_KEY && config.STANDARD_AI_BASE_URL && config.STANDARD_AI_MODEL
    ? new StandardAi({ apiKey: config.STANDARD_AI_API_KEY, baseUrl: config.STANDARD_AI_BASE_URL, model: config.STANDARD_AI_MODEL, fetch: o.fetch })
    : null;
  const ai = new AiRouter(db, nearAi, standardAi);

  // ---------------------------------------------------------------- market, chain, treasury
  const simChain = sim ? new SimChain() : null;
  const simMarket = simChain ? new SimMarket(simChain, SIM_OWNER_ACCOUNT) : null;
  const marketFetch = simMarket ? simMarket.fetch : (o.fetch ?? fetch);
  const endpoints = sim ? SIM_ENDPOINTS : { ...LIVE_MARKET, origin: config.MARKET_ORIGIN };
  const catalog = new MarketCatalog(endpoints, marketFetch);
  const x402 = new X402Caller(endpoints, marketFetch);
  const chain: Chain = simChain ?? new LiveChain("near:mainnet", mainnetRpc);
  const usdc = sim ? SIM_USDC : config.USDC_CONTRACT;
  const spend = new SpendAccount(db, secrets, chain, audit, { accountId: sim ? undefined : config.SPEND_ACCOUNT_ID, importedKey: sim ? undefined : config.SPEND_ACCOUNT_KEY, poolSize: config.SPEND_KEY_POOL });
  const oauth = new MarketOAuth(db, secrets, config.MARKET_ORIGIN, o.fetch);
  const mcpBoard = sim ? null : new McpJobBoard(config.MARKET_ORIGIN, oauth);

  /** The Veyra owner: in sim a built-in demo account; live, whoever owns the vault agent. */
  const ownerUser = () => {
    if (sim) {
      const u = db.get<{ id: string; account_id: string }>("SELECT id, account_id FROM users WHERE account_id = ?", [SIM_OWNER_ACCOUNT]) ?? auth.upsertUser(SIM_OWNER_ACCOUNT);
      return { id: u.id, accountId: SIM_OWNER_ACCOUNT, publicKey: "ed25519:sim" };
    }
    if (!config.VAULT_AGENT_ID) return null;
    const a = agents.getAgentRow(config.VAULT_AGENT_ID);
    return a ? { id: a.user_id, accountId: a.owner_account_id, publicKey: a.owner_public_key } : null;
  };

  let vault: Vault;
  if (simChain) {
    const { accountId: spendId, primaryKey } = spend.init();
    simChain.createAccount(spendId, primaryKey);
    simChain.mint(SIM_USDC, SIM_VAULT_ACCOUNT, 50_000_000n); // 50 USDC of play money
    vault = new SimVault(simChain, SIM_USDC, SIM_VAULT_ACCOUNT, { destinations: [spendId], dailyCapAtomic: 25_000_000n, perTxAtomic: 5_000_000n });
  } else {
    vault = new AgentApiVault(agents, execution, () => {
      const u = ownerUser();
      return u && config.VAULT_AGENT_ID ? { user: u, agentId: config.VAULT_AGENT_ID } : null;
    }, `nep141:${config.USDC_CONTRACT}`);
  }
  const treasury = new Treasury(db, spend, vault, usdc, audit, BigInt(Math.round(config.MAX_FLOAT_USDC * 1e6)));

  // ---------------------------------------------------------------- receipts & anchoring
  // A real ledger contract is used whenever one is configured, in the simulator too: anchors
  // and threat reports from the hosted demo land on testnet for free.
  const ledgerRpc = config.LEDGER_NETWORK === "mainnet" ? mainnetRpc : new NearRpc("https://rpc.testnet.near.org", o.fetch);
  const ledger = config.LEDGER_CONTRACT_ID
    ? { contractId: config.LEDGER_CONTRACT_ID, network: config.LEDGER_NETWORK, explorer: config.LEDGER_NETWORK === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io", rpc: ledgerRpc }
    : simChain ? { contractId: "ledger.veyra.sim", network: "sim", explorer: null, rpc: null } : null;
  let anchorer: Anchorer | null = null;
  if (simChain && !config.LEDGER_CONTRACT_ID) {
    anchorer = { network: "sim", contractId: "ledger.veyra.sim", anchor: async (root, from, to, count) => simChain.record("ledger_anchor", { root, from, to, count }) };
  } else if (config.LEDGER_CONTRACT_ID) {
    anchorer = {
      network: config.LEDGER_NETWORK,
      contractId: config.LEDGER_CONTRACT_ID,
      anchor: async (root, from, to, count) => {
        const signer = config.LEDGER_WRITER_ID && config.LEDGER_WRITER_KEY
          ? { accountId: config.LEDGER_WRITER_ID, keyPair: keyPairFrom(config.LEDGER_WRITER_KEY) }
          : spend.housekeepingSigner();
        const r = await sendTransaction(ledgerRpc, signer.accountId, signer.keyPair, config.LEDGER_CONTRACT_ID!, [
          actionCreators.functionCall("anchor", { root, from_seq: String(from), to_seq: String(to), count }, 30_000_000_000_000n, 0n),
        ]);
        return r.transaction.hash;
      },
    };
  }
  const receipts = new ReceiptService(db, secrets, anchorer);

  // ---------------------------------------------------------------- threat reports (veyra-ledger `report`)
  let reporter: ThreatReporter | null = null;
  if (simChain && !config.LEDGER_CONTRACT_ID) {
    reporter = { target: "ledger.veyra.sim", report: async (subject, kind, evidenceHash) => simChain.record("ledger_report", { subject, kind, evidenceHash }) };
  } else if (config.LEDGER_CONTRACT_ID) {
    reporter = {
      target: `${config.LEDGER_CONTRACT_ID} (${config.LEDGER_NETWORK})`,
      report: async (subject, kind, evidenceHash) => {
        const signer = config.LEDGER_WRITER_ID && config.LEDGER_WRITER_KEY ? { accountId: config.LEDGER_WRITER_ID, keyPair: keyPairFrom(config.LEDGER_WRITER_KEY) } : spend.housekeepingSigner();
        const r = await sendTransaction(ledgerRpc, signer.accountId, signer.keyPair, config.LEDGER_CONTRACT_ID!, [
          actionCreators.functionCall("report", { subject, kind, evidence_hash: evidenceHash }, 30_000_000_000_000n, 0n),
        ]);
        return r.transaction.hash;
      },
    };
  }

  // ---------------------------------------------------------------- the contractor
  const guard = new ContractorGuard(db);
  const brain = new ContractorBrain(ai);
  const worker = sim
    ? new MarketWorker(SIM_ENDPOINTS.origin, SIM_WORKER_TOKEN, marketFetch)
    : config.MARKET_WORKER_TOKEN ? new MarketWorker(config.MARKET_ORIGIN, config.MARKET_WORKER_TOKEN, o.fetch) : null;
  const board = (): JobBoard | null => (simMarket ? simMarket.jobBoard(SIM_OWNER_ACCOUNT) : oauth.connected ? mcpBoard : null);
  // The simulator can audit the real market: read-only, free, and the most honest demo there is.
  const liveEndpoints = { ...LIVE_MARKET, origin: config.MARKET_ORIGIN };
  const wtLive = sim && config.WATCHTOWER_LIVE;
  const wtCatalog = wtLive ? new MarketCatalog(liveEndpoints, o.fetch ?? fetch) : catalog;
  const wtX402 = wtLive ? new X402Caller(liveEndpoints, o.fetch ?? fetch) : x402;
  const watchtower = new Watchtower(db, wtCatalog, wtX402, guard, receipts, reporter, wtLive ? liveEndpoints.origin : endpoints.origin);
  const mandate = new MandateService(db, { maxJobUsd: 25, maxDailyUsd: 50, marginBps: config.CONTRACT_MARGIN_BPS, blockedCategories: [], minTrust: 25 });
  const engineDeps: import("./contractor/engine.js").EngineDeps = {
    db, catalog, x402, board, worker: () => worker, treasury, guard, brain, receipts, audit, notifier, mandate,
    ownerUserId: () => ownerUser()?.id ?? null,
    assumeCompromisedModel: config.assumeCompromisedModel,
  };
  const engine = new ContractorEngine(engineDeps);
  // Veyra as a seller: other agents pay it with x402 cheques that settle on delivery.
  const seller = new X402Seller({
    db, chain, spend, engine, mandate, ownerUserId: engineDeps.ownerUserId,
    network: sim ? "near:sim" : "near:mainnet", asset: usdc,
    windowSeconds: config.SELLER_SLA_SECONDS + 600, minPriceAtomic: BigInt(Math.round(config.SELLER_MIN_USDC * 1e6)),
  });
  engineDeps.sales = seller;

  if (simMarket) {
    // Seed the owner's market balance so job-board awards work offline.
    simMarket.balances.set(SIM_OWNER_ACCOUNT, 10_000_000n);
    db.run("INSERT OR IGNORE INTO kv (key, value_json, updated_at) VALUES ('sim.started', ?, ?)", [JSON.stringify(now()), now()]);
  }

  return {
    config, db, secrets, rpc, audit, notifier, tokens, auth, bodyguard, agents, execution, ai, nearAi,
    catalog, x402, chain, spend, treasury, vault, oauth, mcpBoard, receipts, guard, brain, engine, worker, watchtower, mandate, seller, ledger,
    sim: simChain && simMarket ? { chain: simChain, market: simMarket } : null,
    ownerUser,
  };
}
