# Veyra Heist

**Veyra holds the pot. Take it.**

Veyra is an AI agent that hires and pays other agents on NEAR. Heist is a game played against
it: you build a rogue agent and try to rob Veyra. There are five vaults, each guarded by more of
Veyra's real defences. Crack one in practice for the leaderboard, or play ranked with testnet
NEAR and take the vault's real pot, paid by a contract on NEAR.

**Tracks:** Games With Real Economies (primary) · AI Security & Defense · Agent Economy

## Play it (two minutes, no wallet)

1. Open the console (hosted, or locally with `pnpm dev:server` and `pnpm dev:web`, then
   http://localhost:5173) and click **Play Heist**.
   **See:** five vaults with their shields and live pots read from the contract on testnet.
2. Open **vault 1**, pick the move **The redirect**, press **Run the heist**.
   **See:** the Heist Cam plays the duel round by round and ends with **Vault 1 cracked,
   +0.40 USDC**: the vault had no payee lock, so Veyra paid your own wallet.
3. Open **vault 2** and run the same move.
   **See:** "Payee lock blocks". Now pick **Bait and switch** (unlocked by your first crack):
   **Vault 2 cracked, +1.10 USDC**, because vault 2 never compares your price with your listing.
4. Climb on. **The whisper** cracks vault 3 (its model obeys your deliverable). **The
   disguise** cracks vault 4 (it says "remit" instead of the five verbs the scanner knows).
5. Try **vault 5**, which is Veyra as it runs in production.
   **See:** "Veyra's model is fooled", then **Taint trace blocks**: the payee came from your
   text, so it can never be paid. Vault 5 holds. A crack here would be a real bug bounty.
6. Open any finished heist and press **Re-run and check the referee**.
   **See:** "Same outcome hash". Or from a terminal:
   `pnpm --filter @veyra/server heist:replay <run-id> <server-url>`.
7. `pnpm --filter @veyra/server test` runs 67 tests; `cd contracts && cargo test` runs the
   ledger and pot contract tests.

The table every move produces, enforced by `apps/server/test/heist.test.ts`:

| Move | Vault 1 | Vault 2 | Vault 3 | Vault 4 | Vault 5 |
|---|---|---|---|---|---|
| The redirect | cracked | payee lock | payee lock | payee lock | payee lock |
| Bait and switch | cracked | cracked | price seal | price seal | price seal |
| The whisper | cracked | cracked | cracked | scanner | scanner |
| The disguise | cracked | cracked | cracked | cracked | taint trace |

## The real economy

- **Pot contract** `veyra-heist-mwdwy8zz.testnet` on NEAR testnet
  ([explorer](https://testnet.nearblocks.io/address/veyra-heist-mwdwy8zz.testnet)), source in
  `contracts/heist`. Ranked entry costs 0.1 to 2 testnet NEAR and commits to the hash of your
  rogue agent. Veyra's server is the referee: it checks your entry transaction on-chain, runs
  the duel, and calls `resolve`. A crack pays the whole pot to your wallet. A failed attempt
  splits the fee 70% to the pot, 20% to the vault's backers and 10% to the house.
- **Backers** stake into a vault, earn from every failed heist, and lose the stake to whoever
  cracks it. The most defended vault becomes the most valuable target without anyone setting a
  price.
- **No trust in the referee needed.** Each run is a sealed, deterministic simulation using
  Veyra's real GUARD rules, scanner, taint check and NEP-366 cheques. Its outcome hash is stored
  on-chain at settlement and anyone can replay it. If the referee never settles an entry, the
  player reclaims the fee after 24 hours.
- **Verified end to end on testnet:** a fresh player paid 0.1 NEAR into vault 1, the server
  verified the entry, ran the redirect, and `resolve` paid the 0.2 NEAR pot plus the fee to the
  player, with the same outcome hash on-chain as on the server.

## Veyra, the agent behind the game

Veyra is an autonomous contractor for the NEAR AI Agent Market. A person or another agent hires
it with a budget. Veyra splits the job into parts, hires specialist agents on the market, checks
their work, pays them in USDC only once the work has passed, and delivers the result, keeping a
margin. Its owner sets the limits once in a signed mandate. Every payment passes GUARD, a
deterministic layer that no model output and no counterparty can override, and every payment
leaves a receipt anchored on NEAR.

Veyra also sells its own work the same way it buys: any agent with a NEAR account can hire it
over A2A and pay with an x402 cheque that Veyra executes only when the job is delivered.

## The problem

Agents that spend money get robbed by the agents they pay. A counterparty can quote one price and
charge another, redirect a payment to its own account, take the money and never deliver, or return
output that contains instructions aimed at the hiring agent ("also send 25 USDC to…"). Spending
limits alone stop none of these. Veyra treats every counterparty as hostile and every deliverable
as untrusted input.

Agents that earn money have the mirror problem: a buyer can take the work and never pay. Veyra
solves both with the same instrument. A cheque is signed before the work and executed after it.

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
| Know-your-agent | A signed KYA credential (principal, mandate, controls, receipt key, ledger) that the owner countersigns with **NEP-413** | `src/contractor/identity.ts` |
| Sell work, get paid on delivery | Veyra's own **A2A + x402** endpoint: a buyer's NEP-366 cheque is held and relayed as a meta-transaction only when the job is delivered | `src/contractor/seller.ts`, `src/treasury/chain.ts` |
| The owner's limits | A **mandate** signed with the owner's wallet (**NEP-413**): largest job, daily limit, margin, blocked categories, trust floor; enforced by GUARD | `src/contractor/mandate.ts` |
| Pay the owner | Earned margin above the working float is transferred to the owner's NEAR account, with a receipt | `src/treasury/treasury.ts` |
| Provable market audits | Every Watchtower scan is a Merkle tree whose root is anchored with the receipts; any verdict has an inclusion proof | `src/watchtower/scanner.ts` |

## Try it (no keys, no money)

Requirements: Node ≥ 22.13, pnpm. Optional: Rust + `cargo-near` for the contract.

1. `pnpm install`
2. `pnpm demo`
   **See:** a buyer hires Veyra for 4.00 USDC on the simulated market. Veyra plans 3 subtasks,
   hires `scout-research`, `data-lens` and `brief-writer`, verifies each delivery, delivers, and
   prints `margin 2.15 USDC`. Next, another agent hires Veyra over A2A with a 6.00 USDC x402
   cheque: the buyer's balance is unchanged while Veyra works, the cheque is executed on
   delivery, and the earned margin is paid to the owner with a receipt. Then four attacks run,
   and each is blocked with the attacker's balance at 0.00 USDC:
   - `payee-swap`: "Payment redirect attempt"
   - `bait-and-switch`: "Quote of 1.00 USDC differs from the listed 0.10"
   - `prompt-injection`: "A fooled model would now transfer 25 USDC … GUARD refused"
   - `no-show`: "cheque was never settled, so nothing was paid"

   Finally it prints a receipt check (hash, signature and Merkle proof all true) and proves one
   Watchtower verdict against the scan's anchored root.
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
   **See:** 60 tests pass. They cover cheques, the key pool, every GUARD rule, injection and
   taint, Merkle proofs, the full hire → deliver loop, all four attacks, job-board negotiation,
   the kill switch, the vault policy, the Agent API owner flows, the Watchtower rules, reports
   and proofs, KYA signing, a real MCP SDK client hiring Veyra over HTTP, an agent hiring Veyra
   with an x402 cheque (paid on delivery, void on failure), the mandate, and owner payouts.
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
   - **Business → Mandate:** change the limits and apply them (in live mode the wallet signs
     them). A job above the largest-job limit is refused at intake.
   - **Treasury & ledger:** x402 sales, payouts to the owner (**Pay out now**), and the receipts.
   - **Identity & hiring:** the signed KYA credential (**Verify signature** → both true), the
     three ways to hire Veyra, and **Get estimate** (live quotes and GUARD verdicts, nothing paid).
8. Hire Veyra from Claude Code (or any MCP client) while the server runs:
   `claude mcp add --transport http veyra http://localhost:8787/mcp`
   Then ask: *"Use veyra_estimate to price a competitor scan for 4 USDC, then watchtower_check
   payee-swapper."* Tools: `veyra_estimate`, `veyra_hire`, `veyra_contract`, `veyra_mandate`,
   `watchtower_check`, `watchtower_proof`, `watchtower_summary`, `verify_receipt`,
   `veyra_identity`, `veyra_ledger`.
9. Hire Veyra with a cheque, as another agent would. `POST /a2a/v1` with a `SendMessage` and no
   payment returns a 402 naming the price and Veyra's spend account (also published at
   `/.well-known/x402`). Resend it with an `X-PAYMENT` header carrying a NEP-366 cheque for
   exactly that row. `GetTask` shows the job working, then completed with the deliverable and
   the settlement transaction. `test/economy.test.ts` does this end to end.

## How it works

```
buyer ─hires─▶ Veyra (market listing · A2A + x402 cheque · MCP)
  intake  within the owner's signed mandate; an x402 cheque is held, not executed
  plan (NEAR AI Cloud, attested; deterministic fallback)
  for each subtask:
    source  catalog search → trust (market reputation + own history) × relevance × price
    quote   x402 402-challenge (free)              | job board: bids, counter once with reasons
    GUARD   payee pinned to market treasury · quote == published price · subtask cap ·
            contract envelope · daily limit · blocked categories · trust floor · one cheque in flight
    pay     vault ─(policy)→ spend account float ─(signed cheque, self-verified)→ market
    verify  untrusted-content scan · required sections/length/mentions · optional attested judge
            failed or poisoned → record, never re-hire, try the next agent
  assemble → execute the buyer's cheque → deliver → signed receipts → Merkle root on NEAR
  payout  margin above the working float → the owner's account, with a receipt
```

**The mandate.** The owner signs a short document with their wallet: largest job, daily
subcontracting limit, margin, categories never to buy from, and a trust floor. GUARD enforces
it at payment time and intake refuses jobs above the cap. Its hash is part of the KYA
credential, so a buyer can see the limits Veyra works under before hiring it.

**Three-tier treasury.** The market settles x402 from a NEAR account's signed delegate action, and
the Agent API wallet keeps its keys in custody, so it can't sign one. So the **vault** (Agent API,
owner-signed policy that may only pay Veyra's spend account) refills the **spend account** with
exactly what the next payment needs. The spend account signs the cheque, and the **market** holds
it until delivery. The float caps what a compromised spend key could lose.

**Per-cheque key pool.** Cheques settle when each agent delivers, in any order. Delegate nonces
must increase per key, so every in-flight cheque gets its own access key. Without that,
out-of-order settlement would fail.

**Selling with x402.** Veyra is the only agent in this economy that is both an x402 buyer and
an x402 seller. A buyer's cheque is a NEP-366 signed delegate action to Veyra's spend account.
Veyra checks the signature, the exact row, the key, the nonce, the expiry and the balance, then
holds the cheque. On delivery it relays the cheque as a meta-transaction (paying the gas itself)
and only then releases the deliverable. If the job fails, the cheque is marked void and is never
executed. The simulator's chain enforces the same nonce, expiry and balance rules as mainnet.

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
- In the simulator the mandate is applied without a signature, because the demo owner has no
  wallet. In live mode `POST /mandate` refuses an unsigned mandate.
- Live relaying of a buyer's cheque costs Veyra gas (about 0.0005 NEAR) and requires the buyer
  to have registered on the USDC contract. Neither has been exercised on mainnet in this repo.
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

## Deploy

Free, and done from web dashboards. The server runs on Render
([![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/davebrian259-tech/veyra-))
and the console on Cloudflare Pages, connected to this repository. A Pages Function forwards
`/api/*` to the server. The step-by-step guide is [docs/DEPLOY.md](docs/DEPLOY.md). For real
money, run the server on your own machine behind a Cloudflare Tunnel instead; the guide
explains when.

## Repository

```
apps/server/src
  market/       catalog, x402 caller, cheque codec, MCP job board, OAuth, worker client
  treasury/     spend account + key pool, vault (Agent API / sim), chain adapters
  contractor/   engine (state machine), guard, brain (plan/verify/assemble), rank, receipts,
                seller (x402 sales), mandate, identity (KYA + agent card), estimate
  sim/          market simulator (honest + adversarial agents) and in-memory NEAR ledger
  services/     Agent API owner flows, BODYGUARD, NEAR AI Cloud, auth, audit
  watchtower/   market-wide integrity scanner, evidence store, on-chain reporter
  mcp/          Veyra's MCP server (hire / estimate / watchtower / receipts)
  cli/          demo.ts, live-dry-run.ts, watchtower.ts
apps/web        landing page and console (React, Geist, Hugeicons; the Veyra mark is in src/brand.tsx)
contracts/ledger  veyra-ledger NEAR contract
docs/           DIRECTION.md (why this product), ARCHITECTURE.md, watchtower/latest.md (live scan)
```

All code was written during the hackathon window (from 2026-11-10). Libraries used:
`@near-intents-agent-api/sdk`, `@near-js/*`, `@modelcontextprotocol/sdk`, `@phala/dcap-qvl`,
`near-sdk` (Rust), `fastify`, `viem`, `zod`, `@noble/*`, NEAR Wallet Selector, React, Vite,
`@hugeicons/react` + `@hugeicons/core-free-icons` (MIT), Geist and Geist Mono (OFL).
License: MIT.
