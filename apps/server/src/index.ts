import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const { app, scheduler } = await buildApp(config);
scheduler.start();
await app.listen({ port: config.PORT, host: config.HOST });

if (config.VEYRA_MODE === "sim") {
  app.log.info("SIM mode: local Agent Market simulator, in-memory NEAR ledger, play money. Set VEYRA_MODE=live for market.near.ai.");
} else {
  const missing = [
    !config.NEAR_INTENTS_AGENT_API_KEY && "NEAR_INTENTS_AGENT_API_KEY",
    !config.VAULT_AGENT_ID && "VAULT_AGENT_ID",
    !config.MARKET_WORKER_TOKEN && "MARKET_WORKER_TOKEN (needed to earn)",
    !config.LEDGER_CONTRACT_ID && "LEDGER_CONTRACT_ID (receipts stay off-chain)",
    !config.NEAR_AI_API_KEY && "NEAR_AI_API_KEY (deterministic planner used)",
  ].filter(Boolean);
  if (missing.length) app.log.warn(`LIVE mode, not configured: ${missing.join("; ")}`);
}
