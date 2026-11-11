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
| `contracts/ledger` | Append-only anchors: writer allow-list, contiguous batches, NEP-297 events |

## GUARD rules (payment time)

| Rule | Blocks when |
|---|---|
| `payee_not_pinned` | network/asset/payTo differ from the market's `/.well-known/x402` (fetched from the market origin only) |
| `price_mismatch` | the 402 amount differs from the agent's published default pricing plan |
| `no_published_price` | the agent has no pricing plan to check against |
| `over_subtask_cap` / `envelope_exhausted` | the amount exceeds the subtask cap or the remaining contract envelope (budget × (1 − margin) − committed) |
| `excessive_validity` | the cheque would stay valid for more than 7 days |
| `counterparty_blocked` / `low_trust_counterparty` | the agent was caught attacking before, or trust < 25 (warn < 45) |
| `duplicate_payment` | a cheque for this subtask is already in flight |
| `contractor_frozen` | the owner engaged the kill switch |
| `cheque_mismatch` | the signed cheque does not pay exactly the approved row (self-check before sending) |

At delivery time: `prompt_injection` (instruction overrides, fake system messages, payment
requests, hidden HTML, invisible characters, role hijacks) and `tainted_recipient` /
`tainted_amount` (payment parameters that appear in counterparty output but in no trusted source).
Veyra also has no general transfer capability: its only payment primitive is "pay the pinned
market treasury the published price for this subtask".

## Trust boundaries

- **Owner wallet**: signs the vault policy, grants, freeze/unfreeze (Agent API) and NEP-413 logins. Never seen by Veyra.
- **Vault**: Agent API custody. Can only withdraw USDC to the spend account, under budgets.
- **Spend account**: sealed key pool on the server. Holds at most the float.
- **Market**: holds x402 cheques until delivery and job-board awards until acceptance.
- **Models**: plan and judge only. Receive no keys, tokens or addresses beyond the brief. Their output is validated against schemas and clamped by rules.
- **Counterparties**: untrusted. Their quotes are checked against published data and their deliverables are scanned and tainted.

## Data

SQLite (`node:sqlite`). Tables: `contracts`, `subtasks`, `quotes`, `payments`, `contract_events`,
`receipts`, `anchors`, `counterparties`, `spend_keys`, `kv`, plus the Agent API owner-flow tables
(`agents`, `owner_intents`, `grants`, `veyra_policies`, `operations`, `approvals`) and the
hash-chained `audit_log`. Secrets are sealed with AES-256-GCM using per-record additional data.
