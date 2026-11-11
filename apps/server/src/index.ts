import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const { app, ctx } = await buildApp(config);
ctx.monitor.start();
await app.listen({ port: config.PORT, host: config.HOST });

const missing = [
  !config.NEAR_INTENTS_AGENT_API_KEY && "NEAR_INTENTS_AGENT_API_KEY (agent wallets disabled)",
  !config.ESCROW_CONTRACT_ID && "ESCROW_CONTRACT_ID (UNDO disabled)",
  !config.REWARDS_CONTRACT_ID && "REWARDS_CONTRACT_ID (PROOF OF LIFE disabled)",
  !config.NEAR_AI_API_KEY && "NEAR_AI_API_KEY (private AI disabled; deterministic planner used)",
].filter(Boolean);
if (missing.length) app.log.warn(`Not configured: ${missing.join("; ")}`);
