# Veyra architecture

## Components

| Module | Responsibility |
|---|---|
| `market/catalog.ts` | Public reads of market.near.ai: agents, pricing plans, reputation, agent cards, `/.well-known/x402` (the settlement recipients used for payee pinning) |
| `market/x402.ts` | A2A JSON-RPC + x402: `SendMessage` without payment → 402 challenge; with `X-PAYMENT` → task; `GetTask`, `CancelTask` |
| `lib/near-signer.ts`, `market/cheque.ts` | NEP-366 signed delegate `ft_transfer` (the x402 cheque); decode and verify; `chequeMatches` checks the signed bytes pay exactly the approved row |
| `market/oauth.ts`, `market/job-board.ts` | Buyer MCP at `/mcp/pro`: OAuth dynamic client registration + device-code grant (tokens sealed), tools matched to their published input schemas |
| `market/worker.ts` | Veyra's own listing: assignments, start, progress, submit; HMAC webhook verification |
| `treasury/spend-account.ts` | The only key-holding account. Pool of full-access keys, one per in-flight cheque; nonces tracked per key |
| `treasury/treasury.ts` | Vault (`AgentApiVault` via the Agent API execution service, or `SimVault`) → just-in-time refills of the spend account, capped by `MAX_FLOAT_USDC` |
| `contractor/engine.ts` | Durable state machine per contract. Every step is persisted and idempotent; payments carry idempotency keys; resumes after restarts |
| `contractor/guard.ts` | Deterministic checks (below); counterparty memory; untrusted-content scanning; taint tracking |
| `contractor/rank.ts` | Candidate order: trust × relevance × price |
| `contractor/brain.ts` | Planning and judging on NEAR AI Cloud (attested) with deterministic fallbacks; models can fail work the rules passed, never pass work the rules failed |
| `contractor/receipts.ts` | ed25519-signed canonical receipts; RFC 6962-style Merkle trees; anchoring and proofs |
| `sim/` | A wire-compatible market (REST, A2A, x402, worker API, job board) and an in-memory NEAR ledger whose relayer enforces signatures, per-key nonces, expiry and balances |
| `watchtower/scanner.ts` | Pages through the whole catalog, asks every agent for a free 402, and judges it against its pricing plan and the pinned treasury (rules below). Stores evidence by hash and files reports for flagged agents |
| `mcp/server.ts` | Stateless streamable-HTTP MCP server at `POST /mcp`. Read tools are public; `veyra_hire` needs the owner's session |
| `contractor/identity.ts` | `veyra-kya/1` credential signed with the receipt key, an owner NEP-413 countersignature, and the A2A agent card |
| `contractor/estimate.ts` | Plan + live quotes + GUARD verdicts with no spending (console, MCP, `live:dry-run`) |
| `contractor/seller.ts` | Veyra as an x402 seller: prices a job within the mandate, prechecks and holds the buyer's cheque, relays it on delivery, voids it on failure, and serves the A2A task view |
| `contractor/mandate.ts` | The owner's signed limits (NEP-413): versioned, hashed, enforced by intake and GUARD, published in the KYA credential |
| `treasury/treasury.ts` (`payout`) | Transfers margin above the float to the owner, with a `payout` receipt; the scheduler runs it automatically |
| `contracts/ledger` | Append-only anchors (writer allow-list, contiguous batches) and threat reports (`report`, `reports_for`, `get_reports`); NEP-297 events |

## GUARD rules (payment time)

| Rule | Blocks when |
|---|---|
| `payee_not_pinned` | network/asset/payTo differ from the market's `/.well-known/x402` (fetched from the market origin only) |
| `price_mismatch` | the 402 amount differs from the agent's published default pricing plan |
| `no_published_price` | the agent has no pricing plan to check against |
| `over_subtask_cap` / `envelope_exhausted` | the amount exceeds the subtask cap or the remaining contract envelope (budget × (1 − margin) − committed) |
| `excessive_validity` | the cheque would stay valid for more than 7 days |
| `counterparty_blocked` / `low_trust_counterparty` | the agent was caught attacking before, or trust is under the mandate's floor (default 25; warn under 45) |
| `over_daily_cap` | the payment would push the rolling 24-hour subcontracting total over the mandate's daily limit |
| `category_blocked` | the agent's category is one the mandate forbids |
| `duplicate_payment` | a cheque for this subtask is already in flight |
| `contractor_frozen` | the owner engaged the kill switch |
| `cheque_mismatch` | the signed cheque does not pay exactly the approved row (self-check before sending) |

At delivery time: `prompt_injection` (instruction overrides, fake system messages, payment
requests, hidden HTML, invisible characters, role hijacks) and `tainted_recipient` /
`tainted_amount` (payment parameters that appear in counterparty output but in no trusted source).
Veyra also has no general transfer capability: its only payment primitive is "pay the pinned
market treasury the published price for this subtask".

## Watchtower rules (market-wide, read-only)

| Check | Severity | When |
|---|---|---|
| `payee` / `asset` / `network` | flag | the 402 pays anyone or anything other than the market's published treasury |
| `price` | flag | the quote is above the agent's published default plan |
| `price` | info | the quote is below the listing (for example sub-atomic rounding); no buyer is harmed |
| `long_validity` | warn | the cheque window is over 7 days (allowed by the spec when the SLA is long; Veyra's GUARD still refuses) |
| `validity_window` / `scheme` / `no_plan` | warn | an unusual window, a non-`exact` scheme, or no published price |
| — | offline | the agent did not answer with a 402 |

A flag writes a `watchtower_report` receipt, blocks the agent in Veyra's counterparty memory, and
calls `report(subject, kind, evidence_hash)` on the ledger contract. A live run uses the
writer key, and the simulator writes to its in-memory chain.

Every scan is also a Merkle tree: each verdict row is hashed (`rowHash`), the leaves are ordered
by handle, and the root is issued as a `watchtower_scan` receipt, which the next anchor commits
to NEAR. `GET /watchtower/agents/:handle/proof` returns the row, its inclusion path, the root and
the receipt's own proof, so a third party can show what Watchtower found about an agent on a
given day without trusting Veyra's database.

## Selling over x402

```
buyer agent ── SendMessage ──▶ Veyra /a2a/v1 ── 402 { accepts: [price → spend account] }
buyer agent ── SendMessage + X-PAYMENT (NEP-366 cheque) ──▶ Veyra
   precheck: signature · exact row · key exists · nonce higher · not expired · balance   → sale "held"
   contract runs under the mandate (GUARD on every subcontract payment)
   delivery: relay the cheque (meta-transaction, Veyra pays gas) → "settled" → deliverable released
   failure:  cheque "void", never executed; GetTask reports FAILED with no artifact
```

## Trust boundaries

- **Owner wallet**: signs the vault policy, grants, freeze/unfreeze (Agent API) and NEP-413 logins. Never seen by Veyra.
- **Vault**: Agent API custody. Can only withdraw USDC to the spend account, under budgets.
- **Spend account**: sealed key pool on the server. Holds at most the float.
- **Market**: holds x402 cheques until delivery and job-board awards until acceptance.
- **Models**: plan and judge only. Receive no keys, tokens or addresses beyond the brief. Their output is validated against schemas and clamped by rules.
- **Counterparties**: untrusted. Their quotes are checked against published data and their deliverables are scanned and tainted.
- **Buyers**: also untrusted. Their cheques are verified against chain state before any work starts and executed before any deliverable is released.
- **The mandate**: only the owner's wallet can change it. Every version is hashed and the current hash is in the KYA credential.

## Data

SQLite (`node:sqlite`). Tables: `contracts`, `subtasks`, `quotes`, `payments`, `contract_events`,
`receipts`, `anchors`, `counterparties`, `spend_keys`, `kv`, `watch_scans`, `watch_results`,
`sales`, `payouts`, plus the Agent API owner-flow tables
(`agents`, `owner_intents`, `grants`, `veyra_policies`, `operations`, `approvals`) and the
hash-chained `audit_log`. Secrets are sealed with AES-256-GCM using per-record additional data.
