# Veyra

**Give intelligence the power to act.** Veyra is an AI-powered financial operating system on NEAR. It has an **autonomous mode**, where an agent plans, hires, pays and tracks results inside an owner-signed policy, and a **manual mode**, where your own wallet signs and Veyra explains, checks and tracks. Both modes share one security system, one transaction history and one permission framework.

| Capability | What it does | NEAR technology |
|---|---|---|
| **Agent wallet** | Owner-signed agent creation, grants, policy, freeze | NEAR Intents **Agent API** (`@near-intents-agent-api/sdk`) |
| **WANTED** | Find human/AI providers, competing offers, bounded negotiation | Agent API payments, UNDO escrow |
| **UNDO** | Milestone escrow; release only on accepted evidence | `veyra-escrow` NEAR contract |
| **PROOF OF LIFE** | Funded challenges and bounties, verified payouts, reputation | `veyra-rewards` NEAR contract |
| **GOAL WALLET** | Goals become plans; allocations, conversions, rebalances | Agent API + NEAR Intents + NEAR AI Cloud |
| **BODYGUARD** | Deterministic checks on every action, autonomous or manual | Agent API policy + contract rules + Veyra engine |
| Manual swaps | Live quotes, deposit, tracking to settlement | NEAR Intents **1Click** |
| Private AI | Goal interpretation in a TEE, attestation verified | **NEAR AI Cloud** |
| External chains | EVM transfers signed by your NEAR account | **Chain Signatures** (`chainsig.js`, MPC) |

## Repository layout

```
contracts/
  escrow/     UNDO escrow contract (Rust, near-sdk 5)      — 23 unit tests
  rewards/    PROOF OF LIFE contract (Rust, near-sdk 5)    — 8 unit tests
apps/
  server/     Fastify + TypeScript backend (Node ≥ 22.13, built-in SQLite) — 37 tests
  web/        Vite + React frontend with NEAR Wallet Selector (functional, unstyled)
scripts/      build-contracts.sh, deploy-contracts.sh
docs/         ARCHITECTURE.md (design, security model, integration status, demo script)
```

## Quick start

```bash
pnpm install
```

```bash
cp apps/server/.env.example apps/server/.env
```

```bash
pnpm dev:server
```

```bash
pnpm dev:web
```

Open http://localhost:5173, connect a NEAR wallet and sign in. The server starts with nothing configured. Each integration switches on when its variable is set (see `apps/server/.env.example`), and `/config` reports what is live.

Contracts (needs `cargo install cargo-near --locked` and [NEAR CLI](https://github.com/near/near-cli-rs)):

```bash
./scripts/deploy-contracts.sh your-account.testnet testnet
```

Tests:

```bash
pnpm --filter @veyra/server test
```

```bash
cd contracts && cargo test
```

## Important facts

- **The NEAR Intents Agent API is an experimental, mainnet-only beta with real funds.** Agent wallets, grants and agent transactions therefore run on mainnet. Use small amounts and a dedicated owner account. UNDO and PROOF OF LIFE can run on testnet. Agent-funded escrow needs a mainnet escrow deployment (`AGENT_ESCROW_CONTRACT_ID`).
- The partner API key and grant tokens exist only on the backend. Grant tokens are AES-256-GCM encrypted at rest, and no HTTP response, log line or AI prompt contains them (enforced by tests).
- The AI proposes; it never authorises. Money moves only through the execution service, after BODYGUARD and the Agent API policy. Escrow releases need the owner's own wallet signature.
- Anything simulated is labelled: demo providers (`SEED_DEMO_PROVIDERS=1`) produce `[simulated]` offers, and without `NEAR_AI_API_KEY` the planner is a deterministic one marked `source.kind = "heuristic"`.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design, the security model, a per-integration status table and the hackathon demo script.
