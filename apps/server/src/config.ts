import { z } from "zod";

/**
 * All configuration comes from the environment (populated by the server's secret manager in
 * production). Secrets in here never leave the backend: they are not serialised into any
 * response, log line or AI prompt. `publicConfig()` is the only view that is exposed.
 */
const bool = z
  .string()
  .optional()
  .transform((v) => v === "1" || v === "true");

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(8787),
  HOST: z.string().default("0.0.0.0"),
  PUBLIC_WEB_ORIGIN: z.string().default("http://localhost:5173"),
  /** Public base URL of this API (used in the agent card, KYA and MCP links). */
  PUBLIC_API_URL: z.string().optional(),
  DATABASE_PATH: z.string().default("./data/veyra.db"),
  EVIDENCE_DIR: z.string().default("./data/evidence"),

  /** 32-byte key (hex or base64) used to encrypt grant tokens and other secrets at rest. */
  VEYRA_ENCRYPTION_KEY: z.string().optional(),
  /** HMAC key for session tokens. */
  VEYRA_SESSION_SECRET: z.string().optional(),
  /** Recipient string users sign NEP-413 login/approval messages for. */
  VEYRA_AUTH_RECIPIENT: z.string().default("veyra.app"),

  // NEAR Intents Agent API (mainnet-only beta). Backend only.
  NEAR_INTENTS_AGENT_API_KEY: z.string().optional(),
  NEAR_INTENTS_AGENT_API_URL: z.string().default("https://api.agentsonintents.com"),
  /** Transparency-log origin and witness key pinned for verifying operation proofs offline. */
  AGENT_API_LOG_ORIGIN: z.string().default("api.agentsonintents.com/log"),
  AGENT_API_WITNESS_KEY: z.string().default("598165a18b588f504e159c0e2573d73983ae22bf15cf80d36902276d63a11101"),
  /** Days a grant stays valid (max 365). */
  AGENT_GRANT_TTL_DAYS: z.coerce.number().min(1).max(365).default(30),

  // NEAR network for wallet login (owner identity)
  NEAR_NETWORK: z.enum(["testnet", "mainnet"]).default("mainnet"),
  NEAR_RPC_URL: z.string().optional(),
  NEAR_MAINNET_RPC_URL: z.string().default("https://rpc.mainnet.near.org"),

  // NEAR AI Cloud (private, TEE-attested inference) for planning and judging.
  NEAR_AI_API_KEY: z.string().optional(),
  NEAR_AI_BASE_URL: z.string().default("https://cloud-api.near.ai"),
  /** Canonical model id (aliases are refused with x-no-aliasing, which signature checks need). */
  NEAR_AI_MODEL: z.string().default("z-ai/glm-5.3-flash"),
  /** Refuse a private-inference result whose response signature cannot be verified. */
  NEAR_AI_REQUIRE_SIGNATURE: bool,

  // Optional ordinary OpenAI-compatible provider, for non-sensitive tasks only.
  STANDARD_AI_API_KEY: z.string().optional(),
  STANDARD_AI_BASE_URL: z.string().optional(),
  STANDARD_AI_MODEL: z.string().optional(),

  // Contractor runtime
  /** sim: local market simulator (no credentials, no real money). live: market.near.ai + NEAR mainnet. */
  VEYRA_MODE: z.enum(["sim", "live"]).default("sim"),
  /** Share of each contract kept as margin (basis points). */
  CONTRACT_MARGIN_BPS: z.coerce.number().int().min(0).max(9000).default(2000),
  /** Run a fully fooled model against poisoned deliverables to prove GUARD holds (sim default on). */
  ASSUME_COMPROMISED_MODEL: z.string().optional(),

  // Agent Market (live mode)
  MARKET_ORIGIN: z.string().default("https://market.near.ai"),
  /** aat_ work token of Veyra's own listing (to earn). Backend only. */
  MARKET_WORKER_TOKEN: z.string().optional(),
  MARKET_WEBHOOK_SECRET: z.string().optional(),

  // Spend account (x402 cheques)
  /** Named mainnet account for the spend account; defaults to an implicit account. */
  SPEND_ACCOUNT_ID: z.string().optional(),
  /** Import an existing key (ed25519:...). Otherwise one is generated and sealed. */
  SPEND_ACCOUNT_KEY: z.string().optional(),
  SPEND_KEY_POOL: z.coerce.number().int().min(1).max(32).default(4),
  /** The spend account never holds more than this (USDC). */
  MAX_FLOAT_USDC: z.coerce.number().positive().default(5),
  /** Earned margin above the float is paid to the owner once it reaches this (USDC). 0 disables automatic payouts. */
  PAYOUT_MIN_USDC: z.coerce.number().min(0).default(1),
  /** Smallest job Veyra sells over x402 (USDC) and the time a buyer's cheque must stay valid. */
  SELLER_MIN_USDC: z.coerce.number().positive().default(1),
  SELLER_SLA_SECONDS: z.coerce.number().int().positive().default(3600),
  /** NEP-141 contract and Agent API asset id of USDC on NEAR. */
  USDC_CONTRACT: z.string().default("17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"),

  // Policy vault (NEAR Intents Agent API agent)
  VAULT_AGENT_ID: z.string().optional(),

  /** Hours between Watchtower scans of the whole market (0 = only on demand). */
  WATCHTOWER_INTERVAL_HOURS: z.coerce.number().min(0).optional(),
  /** In the simulator: audit the real market.near.ai instead of the simulated one (read-only). */
  WATCHTOWER_LIVE: z.coerce.boolean().default(false),

  // Receipt anchoring
  LEDGER_CONTRACT_ID: z.string().optional(),
  LEDGER_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
  /** Writer account for the ledger when it lives on a different network than the spend account. */
  LEDGER_WRITER_ID: z.string().optional(),
  LEDGER_WRITER_KEY: z.string().optional(),

  /** Veyra Heist: the pot contract on NEAR (testnet by default) and the referee that settles runs. */
  HEIST_CONTRACT_ID: z.string().optional(),
  HEIST_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
  HEIST_REFEREE_ID: z.string().optional(),
  HEIST_REFEREE_KEY: z.string().optional(),
  /** Practice runs per minute per visitor. */
  /** The veyra-loot NEP-245 contract; the referee mints a vault's gold bar to each ranked winner. */
  LOOT_CONTRACT_ID: z.string().optional(),
  HEIST_RATE_PER_MIN: z.coerce.number().int().min(1).default(30),

  /** Background monitor interval. */
  MONITOR_INTERVAL_MS: z.coerce.number().default(5000),
});

export type Config = Omit<z.infer<typeof schema>, "WATCHTOWER_INTERVAL_HOURS"> & {
  WATCHTOWER_INTERVAL_HOURS: number;
  nearRpcUrl: string;
  assumeCompromisedModel: boolean;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = schema.parse(env);
  return {
    ...parsed,
    nearRpcUrl: parsed.NEAR_RPC_URL ?? `https://rpc.${parsed.NEAR_NETWORK}.near.org`,
    // Live: scan the market every 6 h. Sim: on demand, so the attack lab shows payment-time defences.
    WATCHTOWER_INTERVAL_HOURS: parsed.WATCHTOWER_INTERVAL_HOURS ?? (parsed.VEYRA_MODE === "live" ? 6 : 0),
    assumeCompromisedModel: parsed.ASSUME_COMPROMISED_MODEL ? ["1", "true"].includes(parsed.ASSUME_COMPROMISED_MODEL) : parsed.VEYRA_MODE === "sim",
  };
}

/** What the frontend may know about the deployment. Never includes secrets. */
export function publicConfig(c: Config) {
  return {
    mode: c.VEYRA_MODE,
    nearNetwork: c.NEAR_NETWORK,
    authRecipient: c.VEYRA_AUTH_RECIPIENT,
    marketOrigin: c.VEYRA_MODE === "live" ? c.MARKET_ORIGIN : "https://market.sim (local simulator)",
    marginBps: c.CONTRACT_MARGIN_BPS,
    maxFloatUsdc: c.MAX_FLOAT_USDC,
    integrations: {
      agentMarket: { mode: c.VEYRA_MODE, workerConfigured: c.VEYRA_MODE === "sim" || Boolean(c.MARKET_WORKER_TOKEN) },
      agentApiVault: { configured: c.VEYRA_MODE === "sim" || Boolean(c.NEAR_INTENTS_AGENT_API_KEY && c.VAULT_AGENT_ID), simulated: c.VEYRA_MODE === "sim", note: "Live vault: NEAR Intents Agent API (mainnet beta, or the demo API with a demo key)." },
      nearAiCloud: { configured: Boolean(c.NEAR_AI_API_KEY), model: c.NEAR_AI_MODEL },
      ledger: { contractId: c.LEDGER_CONTRACT_ID ?? null, network: c.LEDGER_NETWORK, simulated: c.VEYRA_MODE === "sim" && !c.LEDGER_CONTRACT_ID },
    },
    heist: { contractId: c.HEIST_CONTRACT_ID ?? null, network: c.HEIST_NETWORK, ranked: Boolean(c.HEIST_CONTRACT_ID && (c.HEIST_REFEREE_KEY || c.LEDGER_WRITER_KEY)) },
  };
}
