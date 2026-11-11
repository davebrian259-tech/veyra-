import { join } from "node:path";
import type { Config } from "./config.js";
import { Db } from "./db.js";
import { SecretBox } from "./lib/crypto.js";
import { NearRpc } from "./lib/near-rpc.js";
import { AgentService } from "./services/agents.js";
import { NearAiCloud } from "./services/ai/near-ai.js";
import { Planner } from "./services/ai/planner.js";
import { AiRouter, StandardAi } from "./services/ai/router.js";
import { AuditLog } from "./services/audit.js";
import { AuthService } from "./services/auth.js";
import { Bodyguard } from "./services/bodyguard/engine.js";
import { ManualAnalyzer } from "./services/bodyguard/manual.js";
import { ChainSignatureService } from "./services/chain-signatures.js";
import { EscrowService } from "./services/escrow.js";
import { ExecutionService } from "./services/execution.js";
import { GoalService } from "./services/goals.js";
import { IntentsService } from "./services/intents.js";
import { Monitor } from "./services/monitor.js";
import { NearTxTracker } from "./services/near-tx.js";
import { Notifier } from "./services/notifications.js";
import { EvidenceStore, ProofOfLifeService } from "./services/pol.js";
import { TokenCatalog } from "./services/tokens.js";
import { WalletService } from "./services/wallet.js";
import { WantedService } from "./services/wanted.js";

export interface ContextOverrides {
  db?: Db;
  fetch?: typeof fetch;
  rpc?: NearRpc;
  mainnetRpc?: NearRpc;
  verifyKeysOnChain?: boolean;
  nearAi?: NearAiCloud | null;
}

export type AppContext = ReturnType<typeof buildContext>;

export function buildContext(config: Config, o: ContextOverrides = {}) {
  const db = o.db ?? new Db(config.DATABASE_PATH);
  const secrets = SecretBox.fromConfig({
    key: config.VEYRA_ENCRYPTION_KEY,
    production: config.NODE_ENV === "production",
    devKeyPath: config.DATABASE_PATH === ":memory:" ? ":memory:" : join(config.DATABASE_PATH, "..", "dev-encryption.key"),
  });
  const rpc = o.rpc ?? new NearRpc(config.nearRpcUrl, o.fetch);
  const mainnetRpc = o.mainnetRpc ?? (config.NEAR_NETWORK === "mainnet" ? rpc : new NearRpc(config.NEAR_MAINNET_RPC_URL, o.fetch));
  const audit = new AuditLog(db);
  const notifier = new Notifier(db);
  const tokens = new TokenCatalog(config.NEAR_INTENTS_AGENT_API_URL, config.ONECLICK_API_URL, o.fetch);
  const auth = new AuthService(db, rpc, config.VEYRA_AUTH_RECIPIENT, audit, o.verifyKeysOnChain ?? true);
  const bodyguard = new Bodyguard(db, rpc);
  const analyzer = new ManualAnalyzer(bodyguard, rpc, tokens);
  const agents = new AgentService(db, audit, notifier, secrets, {
    apiKey: config.NEAR_INTENTS_AGENT_API_KEY,
    baseUrl: config.NEAR_INTENTS_AGENT_API_URL,
    grantTtlDays: config.AGENT_GRANT_TTL_DAYS,
    fetch: o.fetch,
  });
  const execution = new ExecutionService(db, agents, bodyguard, tokens, auth, audit, notifier);
  const tracker = new NearTxTracker(db, { testnet: config.NEAR_NETWORK === "testnet" ? rpc : new NearRpc("https://rpc.testnet.near.org", o.fetch), mainnet: mainnetRpc }, audit, notifier);
  const intents = new IntentsService(db, tokens, bodyguard, audit, notifier, { baseUrl: config.ONECLICK_API_URL, jwt: config.ONECLICK_JWT, fetch: o.fetch });
  const nearAi =
    o.nearAi !== undefined
      ? o.nearAi
      : config.NEAR_AI_API_KEY
        ? new NearAiCloud({ apiKey: config.NEAR_AI_API_KEY, baseUrl: config.NEAR_AI_BASE_URL, model: config.NEAR_AI_MODEL, requireSignature: config.NEAR_AI_REQUIRE_SIGNATURE, fetch: o.fetch })
        : null;
  const standardAi =
    config.STANDARD_AI_API_KEY && config.STANDARD_AI_BASE_URL && config.STANDARD_AI_MODEL
      ? new StandardAi({ apiKey: config.STANDARD_AI_API_KEY, baseUrl: config.STANDARD_AI_BASE_URL, model: config.STANDARD_AI_MODEL, fetch: o.fetch })
      : null;
  const ai = new AiRouter(db, nearAi, standardAi);
  const planner = new Planner(ai);
  const wanted = new WantedService(db, bodyguard, audit, notifier, o.fetch);
  const escrow = new EscrowService(db, tracker, tokens, agents, execution, audit, notifier, {
    network: config.NEAR_NETWORK,
    contractId: config.ESCROW_CONTRACT_ID,
    agentContractId: config.AGENT_ESCROW_CONTRACT_ID,
  });
  const goals = new GoalService(db, planner, agents, execution, wanted, tokens, audit, notifier);
  const pol = new ProofOfLifeService(db, tracker, { network: config.NEAR_NETWORK, contractId: config.REWARDS_CONTRACT_ID });
  const evidence = new EvidenceStore(db, config.EVIDENCE_DIR);
  const wallet = new WalletService(db, rpc, config.NEAR_NETWORK, tokens, analyzer, tracker);
  const chainSigs = new ChainSignatureService(db, rpc, bodyguard, audit, {
    network: config.NEAR_NETWORK,
    contractId: config.chainSignaturesContractId,
    evmRpcUrl: config.EVM_RPC_URL,
    evmChainId: config.EVM_CHAIN_ID,
  });
  const monitor = new Monitor({ agents, execution, intents, tracker, escrow, chainSigs, goals }, config.MONITOR_INTERVAL_MS);
  if (config.SEED_DEMO_PROVIDERS) wanted.seedDemoProviders();

  return { config, db, secrets, rpc, mainnetRpc, audit, notifier, tokens, auth, bodyguard, analyzer, agents, execution, tracker, intents, nearAi, ai, planner, wanted, escrow, goals, pol, evidence, wallet, chainSigs, monitor };
}
