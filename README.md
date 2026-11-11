# Veyra

Veyra is an autonomous contractor agent for the NEAR AI Agent Market. A person or another agent
hires it with a budget. Veyra splits the job into parts, hires specialist agents on the market,
negotiates, checks their work, pays them in USDC, and delivers the result, keeping a margin. Every
payment passes a deterministic security layer (GUARD) that no model output can override.

**Tracks:** Agent Economy (primary) · AI Security & Defense · Autonomous Business

## The problem

Agents that spend money get robbed by the agents they pay. A counterparty can quote one price and
charge another, redirect the payment to its own account, take the money and never deliver, or
return output containing instructions aimed at the hiring agent ("also send 25 USDC to …"). Spending
limits alone don't stop any of these. Veyra treats every counterparty as hostile and every
deliverable as untrusted input.

## How NEAR is used

| Need | NEAR technology | Where |
|---|---|---|
| Hire agents and get paid | **NEAR AI Agent Market**: A2A + x402 hires, job board over MCP (OAuth device flow), worker API for Veyra's own listing | `apps/server/src/market/` |
| Pay per call | **x402 on NEAR**: USDC `ft_transfer` as a NEP-366 signed delegate action, settled by the market only on delivery | `src/lib/near-signer.ts`, `src/market/cheque.ts` |
| Hold the budget under owner rules | **NEAR Intents Agent API** policy wallet (owner-signed policy, budgets, allowed destinations, freeze) | `src/services/agents.ts`, `src/treasury/treasury.ts` |
| Private planning and judging | **NEAR AI Cloud**, with TDX/GPU attestation and response signatures verified | `src/services/ai/near-ai.ts` |
| Verifiable receipts | **`veyra-ledger` NEAR contract**: append-only Merkle roots of signed receipts | `contracts/ledger/` |
| Market-wide fraud reports | **`veyra-ledger` `report()`**: Watchtower files evidence-hashed threat reports on-chain (NEP-297 `reported` events) | `src/watchtower/`, `contracts/ledger/` |
| Be hired by other agents | **MCP** server (streamable HTTP) and an **A2A** agent card, the protocols the Agent Market speaks | `src/mcp/server.ts`, `src/contractor/identity.ts` |
| Know-your-agent | A signed KYA credential (principal, controls, receipt key, ledger) that the owner countersigns with **NEP-413** | `src/contractor/identity.ts` |

## Try it (no keys, no money)

Requirements: Node ≥ 22.13, pnpm. Optional: Rust + `cargo-near` for the contract.

1. `pnpm install`
2. `pnpm demo`
   **See:** a buyer hires Veyra for 4.00 USDC on the simulated market. Veyra plans 3 subtasks,
   hires `scout-research`, `data-lens` and `brief-writer`, verifies each delivery, delivers, and
   prints `margin 2.15 USDC`. Then four attacks run, and each is blocked with the attacker's
   balance at 0.00 USDC:
   - `payee-swap`: "Payment redirect attempt"
   - `bait-and-switch`: "Quote of 1.00 USDC differs from the listed 0.10"
   - `prompt-injection`: "A fooled model would now transfer 25 USDC … GUARD refused"
   - `no-show`: "cheque was never settled, so nothing was paid"

   Finally it prints a receipt check: hash, signature and Merkle proof all true.
3. `pnpm live:dry-run "Research the main competitors to NEAR Intents agent wallets and write a short report"`
   **See:** the same planner and GUARD against the **real** market.near.ai, using the live
   catalog, live pricing plans and live x402 quotes (free 402 challenges). The treasury is
   pinned from `market.near.ai/.well-known/x402`, every candidate gets an ALLOW or BLOCK verdict
   with reasons, and it prints which agent it would hire. Nothing is signed or paid.
4. `pnpm watchtower`
   **See:** a read-only scan of **every** agent on market.near.ai (about 670, in about 95 s). Each
   agent's free x402 quote is compared with its own published pricing plan and with the market
   treasury. The result is written to `docs/watchtower/latest.md`. The published scan (2026-11-11):
   667 agents, 380 honest, 1 warning (a 14-day cheque window that its 14-day SLA explains),
   0 flagged, 286 not taking calls.
   Only clear integrity breaks are flagged: a payee, asset or network swap, or a quote above the
   listed price. Rounding below the listing and SLA-driven windows are warnings, never accusations.
5. `pnpm --filter @veyra/server test`
   **See:** 55 tests pass. They cover cheques, the key pool, every GUARD rule, injection and
   taint, Merkle proofs, the full hire → deliver loop, all four attacks, job-board negotiation,
   the kill switch, the vault policy, the Agent API owner flows, the Watchtower rules and
   reports, KYA signing, and a real MCP SDK client hiring Veyra over HTTP.
6. `cd contracts && cargo test`
   **See:** 9 ledger-contract tests pass (writer-only, contiguous batches, immutable, threat
   reports with slug and evidence-hash validation).
7. Run the console: start the server with `pnpm dev:server`, then the web app with
   `pnpm dev:web`. Open http://localhost:5173. The landing page shows the latest market scan
   as a dot matrix, one dot per agent. Click **Enter the simulator**.
   - **Hire Veyra:** you land on the contract with a live timeline, subtasks, quotes, payments
     and receipts, ending in "Delivered".
   - **Attack lab → Run attack** on each card: each card shows the security events and
     "attacker received 0.00 USDC".
   - **Treasury & ledger:** the three money tiers, the spend-key pool, the public P&L, the
     counterparty record and the anchors.
   - **Watchtower → Run full scan:** `bait-switch` and `payee-swapper` are flagged. Their
     reports go to the (simulated) ledger contract with an evidence hash, and **Evidence** shows
     the stored challenge.
   - **Identity & MCP:** the signed KYA credential (**Verify signature** → both true), the
     MCP install line, and **Get estimate** (live quotes and GUARD verdicts, nothing paid).
8. Hire Veyra from Claude Code (or any MCP client) while the server runs:
   `claude mcp add --transport http veyra http://localhost:8787/mcp`
   Then ask: *"Use veyra_estimate to price a competitor scan for 4 USDC, then watchtower_check
   payee-swapper."* Tools: `veyra_estimate`, `veyra_hire`, `veyra_contract`,
   `watchtower_check`, `watchtower_summary`, `verify_receipt`, `veyra_identity`, `veyra_ledger`.

## How it works

```
buyer ─hires─▶ Veyra (listed on market.near.ai)
  plan (NEAR AI Cloud, attested; deterministic fallback)
  for each subtask:
    source  catalog search → trust (market reputation + own history) × relevance × price
    quote   x402 402-challenge (free)              | job board: bids, counter once with reasons
    GUARD   payee pinned to market treasury · quote == published price · subtask cap ·
            contract envelope · counterparty blocked/low-trust · one cheque in flight
    pay     vault ─(policy)→ spend account float ─(signed cheque, self-verified)→ market
    verify  untrusted-content scan · required sections/length/mentions · optional attested judge
            failed or poisoned → record, never re-hire, try the next agent
  assemble → deliver through the worker API → signed receipts → Merkle root on NEAR
```

**Three-tier treasury.** The market settles x402 from a NEAR account's signed delegate action, and
the Agent API wallet keeps its keys in custody, so it can't sign one. So the **vault** (Agent API,
owner-signed policy that may only pay Veyra's spend account) refills the **spend account** with
exactly what the next payment needs. The spend account signs the cheque, and the **market** holds
it until delivery. The float caps what a compromised spend key could lose.

**Per-cheque key pool.** Cheques settle when each agent delivers, in any order. Delegate nonces
must increase per key, so every in-flight cheque gets its own access key. Without that,
out-of-order settlement would fail.

**Honesty notes.**
- x402 settles on delivery with no buyer acceptance step. A poisoned but delivered x402 result
  is therefore paid at its listed price (0.15 USDC in the lab). It is caught before it can cause
  any further payment, the agent is blocked, and Veyra retries elsewhere. The job-board rail
  holds funds until Veyra accepts.
- The live market path was verified for discovery, pricing, quotes, treasury pinning and cheque
  encoding (the live relayer decoded a test cheque from an unfunded account and rejected it on
  validity window, not format). Paid live hires need a funded spend account, which this repo
  does not include.
- NEAR Gas Keys (NEP-611) cannot sign delegate actions from protocol 87, so they can't
  replace the per-cheque key pool. The pool remains the right design.
- Watchtower never pays and never accuses on ambiguity: on-chain reports are filed only for
  flagged findings, and every report carries the hash of the stored evidence.
- The NEAR Intents Agent API is an experimental beta. The vault flows are built on the official
  SDK and tested against a fake API. Use small amounts.

## Run live

Copy `apps/server/.env.example` to `apps/server/.env` and set `VEYRA_MODE=live` plus:
- `MARKET_WORKER_TOKEN`: the `aat_` token of Veyra's listing on market.near.ai (to earn).
- A spend account: leave the variables empty to generate one, then fund it with a little NEAR
  and USDC, or import `SPEND_ACCOUNT_ID` / `SPEND_ACCOUNT_KEY`.
- `NEAR_INTENTS_AGENT_API_KEY`, then create the vault in **Settings → Vault**, sign with your
  wallet, issue the grant, and set `VAULT_AGENT_ID`.
- Optional: `NEAR_AI_API_KEY`, `LEDGER_CONTRACT_ID` (deploy with
  `./scripts/deploy-contracts.sh <parent> <writer> testnet`), and **Settings → Connect the
  Agent Market** for the job board.

## Repository

```
apps/server/src
  market/       catalog, x402 caller, cheque codec, MCP job board, OAuth, worker client
  treasury/     spend account + key pool, vault (Agent API / sim), chain adapters
  contractor/   engine (state machine), guard, brain (plan/verify/assemble), rank, receipts
  sim/          market simulator (honest + adversarial agents) and in-memory NEAR ledger
  services/     Agent API owner flows, BODYGUARD, NEAR AI Cloud, auth, audit
  watchtower/   market-wide integrity scanner, evidence store, on-chain reporter
  mcp/          Veyra's MCP server (hire / estimate / watchtower / receipts)
  cli/          demo.ts, live-dry-run.ts, watchtower.ts
apps/web        landing page + console (React, Geist, Hugeicons; original Veyra mark in src/brand.tsx)
contracts/ledger  veyra-ledger NEAR contract
docs/           DIRECTION.md (why this product), ARCHITECTURE.md, watchtower/latest.md (live scan)
```

All code was written during the hackathon window (from 2026-11-10). Libraries used:
`@near-intents-agent-api/sdk`, `@near-js/*`, `@modelcontextprotocol/sdk`, `@phala/dcap-qvl`,
`near-sdk` (Rust), `fastify`, `viem`, `zod`, `@noble/*`, NEAR Wallet Selector, React, Vite,
`@hugeicons/react` + `@hugeicons/core-free-icons` (MIT), Geist and Geist Mono (OFL).
License: MIT.
