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

  // NEAR Intents 1Click API (manual swaps). JWT optional: without it 1Click adds its default fee.
  ONECLICK_API_URL: z.string().default("https://1click.chaindefuser.com"),
  ONECLICK_JWT: z.string().optional(),

  // NEAR network for the user's wallet, auth and Veyra contracts.
  NEAR_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
  NEAR_RPC_URL: z.string().optional(),
  NEAR_MAINNET_RPC_URL: z.string().default("https://rpc.mainnet.near.org"),
  ESCROW_CONTRACT_ID: z.string().optional(),
  REWARDS_CONTRACT_ID: z.string().optional(),
  /**
   * Escrow contract on mainnet that agents may fund through the Agent API's native NEAR call.
   * The Agent API only runs on mainnet, so agent-funded escrow needs a mainnet deployment.
   */
  AGENT_ESCROW_CONTRACT_ID: z.string().optional(),

  // NEAR AI Cloud (private inference, OpenAI-compatible, TEE attested).
  NEAR_AI_API_KEY: z.string().optional(),
  NEAR_AI_BASE_URL: z.string().default("https://cloud-api.near.ai"),
  /** Canonical model id (aliases are refused with x-no-aliasing, which signature checks need). */
  NEAR_AI_MODEL: z.string().default("z-ai/glm-5.3-flash"),
  /** Require a verified response signature before using a private-inference result. */
  NEAR_AI_REQUIRE_SIGNATURE: bool,

  // Optional ordinary OpenAI-compatible provider for non-sensitive tasks only.
  STANDARD_AI_API_KEY: z.string().optional(),
  STANDARD_AI_BASE_URL: z.string().optional(),
  STANDARD_AI_MODEL: z.string().optional(),

  // Chain Signatures
  CHAIN_SIGNATURES_CONTRACT_ID: z.string().optional(),
  EVM_RPC_URL: z.string().default("https://ethereum-sepolia-rpc.publicnode.com"),
  EVM_CHAIN_ID: z.coerce.number().default(11155111),

  /** Seed clearly-labelled demo providers into WANTED. */
  SEED_DEMO_PROVIDERS: bool,
  /** Background monitor interval. */
  MONITOR_INTERVAL_MS: z.coerce.number().default(5000),
});

export type Config = z.infer<typeof schema> & {
  nearRpcUrl: string;
  chainSignaturesContractId: string;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = schema.parse(env);
  return {
    ...parsed,
    nearRpcUrl: parsed.NEAR_RPC_URL ?? `https://rpc.${parsed.NEAR_NETWORK}.near.org`,
    chainSignaturesContractId:
      parsed.CHAIN_SIGNATURES_CONTRACT_ID ??
      (parsed.NEAR_NETWORK === "mainnet" ? "v1.signer" : "v1.signer-prod.testnet"),
  };
}

/** What the frontend may know about the deployment. Never includes secrets. */
export function publicConfig(c: Config) {
  return {
    nearNetwork: c.NEAR_NETWORK,
    nearRpcUrl: c.nearRpcUrl,
    authRecipient: c.VEYRA_AUTH_RECIPIENT,
    escrowContractId: c.ESCROW_CONTRACT_ID ?? null,
    rewardsContractId: c.REWARDS_CONTRACT_ID ?? null,
    agentEscrowContractId: c.AGENT_ESCROW_CONTRACT_ID ?? null,
    chainSignaturesContractId: c.chainSignaturesContractId,
    evmChainId: c.EVM_CHAIN_ID,
    integrations: {
      agentApi: {
        configured: Boolean(c.NEAR_INTENTS_AGENT_API_KEY),
        network: "mainnet",
        note: "The NEAR Intents Agent API is an experimental mainnet-only beta with real funds.",
      },
      oneClick: { configured: true, authenticated: Boolean(c.ONECLICK_JWT) },
      nearAiCloud: { configured: Boolean(c.NEAR_AI_API_KEY), model: c.NEAR_AI_MODEL },
      standardAi: { configured: Boolean(c.STANDARD_AI_API_KEY && c.STANDARD_AI_BASE_URL) },
      escrow: { configured: Boolean(c.ESCROW_CONTRACT_ID), network: c.NEAR_NETWORK },
      rewards: { configured: Boolean(c.REWARDS_CONTRACT_ID), network: c.NEAR_NETWORK },
      chainSignatures: { contractId: c.chainSignaturesContractId, evmChainId: c.EVM_CHAIN_ID },
    },
  };
}
