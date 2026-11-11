# Veyra architecture

## 1. Shape of the system

```
 Browser (apps/web)                Backend (apps/server)                         NEAR & partners
 ───────────────────               ────────────────────────────────              ─────────────────────────────
 Wallet Selector  ── NEP-413 ───▶  AuthService (sessions)
   signs: login, owner intents,    AgentService ── partner key ───────────────▶  NEAR Intents Agent API (mainnet)
   approvals, escrow calls,        ExecutionService ── grant token (decrypted ─▶   swap / transfer / withdraw /
   manual transfers, MPC sign        only here) after BODYGUARD                    native NEAR call (escrow funding)
                                   Bodyguard (deterministic)
                                   IntentsService ─────────────────────────────▶  1Click API (quotes, deposits, status)
                                   EscrowService / ProofOfLifeService ── RPC ──▶  veyra-escrow / veyra-rewards contracts
                                   NearTxTracker (submitted→confirmed→settled)
                                   AiRouter ── private tasks ──────────────────▶  NEAR AI Cloud (TEE) + attestation
                                   ChainSignatureService ──────────────────────▶  v1.signer(-prod.testnet) MPC, EVM RPC
                                   WantedService, GoalService, WalletService
                                   AuditLog (hash-chained), Notifier (SSE), Monitor
                                   SQLite (node:sqlite)
```

One application and one database. Manual and autonomous activity land in the same `operations` table, are checked by the same BODYGUARD and appear in the same history, insights and audit trail.

## 2. Flows

### Agent creation and grants (owner-signed, Agent API)
1. `POST /agents` with a Veyra policy → backend `generateIntent(agent_create)` with the API-enforceable part of the policy. The response carries `intent`, `preview` and the required risk notice.
2. The browser shows the preview and the wallet signs `intent.payload` unchanged (NEP-413 `signMessage`, or NEP-366 delegate action).
3. `POST /owner-intents/:id/submit` → the backend checks that the signed payload is byte-for-byte the one it prepared, then calls `submitIntent`. The monitor follows the status. On `SUCCESS` the Veyra policy becomes active.
4. `POST /agents/:id/grants` → the backend creates the grant credential, seals the token (AES-GCM, AAD = agent + grant id) and sends only the **commitment** to the wallet to sign.
5. From then on the agent acts with `api.forGrant(token)` and no further owner signature, inside the policy.

Policy changes, freeze/unfreeze, grant revocation, Agent API approval votes and execution cancellation use the same generate → sign → submit cycle.

### Autonomous action
`ExecutionService.execute()` is the single entry point (AI, goals and user all use it):
1. Ownership check (session account = agent owner).
2. Agent API dry run (`swap`/`withdraw` with `dry: true`) for warnings, fees and the expected output.
3. USD valuation from the live Agent API token catalogue.
4. **BODYGUARD verdict**: `allow` / `require_approval` / `block`.
5. The operation row and its **idempotency key are persisted before dispatch**.
6. Dispatch with the grant client. Swaps carry `min_amount_out` derived from the policy's slippage limit.
7. Status tracking: `submitted` (accepted, not on-chain) → `confirmed` (settlement tx exists) → `settled` (Agent API `SUCCESS`, backed by reconciled evidence). Also `uncertain` (never resent under a new key), `needs_review`, `rejected_by_api`, `failed` and `refunded`.
8. `GET /agents/:id/operations/:cid/proof` verifies the Agent API's transparency-log proof offline, against a pinned witness key.

### Approvals
Above `approvalThresholdUsd`, unusually large actions and AI justifications containing instruction-override language are held as `pending_approval`. The owner signs a NEP-413 message binding `approval id + request hash + decision`. After approval **every other rule is re-evaluated**, because approval only satisfies the escalation.

### Emergency freeze
`POST /agents/:id/freeze` engages Veyra's local kill switch at once (no dispatch leaves the backend; pending approvals are cancelled). It also returns an `agent_freeze` intent so the owner can lock the agent at the Agent API itself. Unfreezing is never local-only: the switch lifts only when a signed `agent_unfreeze` succeeds.

### WANTED → UNDO (the brief's end-to-end example)
1. `POST /autonomous/run` with the goal text → planner (NEAR AI Cloud, or the labelled deterministic planner) → deterministic clamping (it cannot exceed stated budgets; release-on-completion is enforced when the user said so).
2. A job is posted; RFQs go to matching providers. **The budget is never sent to providers.**
3. Deterministic negotiation: target 85% of budget, counters never above budget, at most 3 rounds.
4. Offers are ranked. The **owner selects**.
5. `POST /wanted/jobs/:id/escrow` builds the agreement (payer, approver = owner, provider, amount, milestones, completion conditions, evidence requirements, deadline, acceptance/dispute/refund rules). Its SHA-256 `terms_hash` goes on-chain.
6. Funding: the owner's wallet signs `create_escrow` (testnet or mainnet), or the agent funds it with an Agent API native NEAR call on mainnet (gated by BODYGUARD: the contract must be allow-listed and the approver must be the owner).
7. The provider uploads evidence (stored off-chain, hash on-chain) and calls `submit_evidence` from their wallet.
8. The owner (or reviewer) calls `accept_milestone` from their wallet and the contract pays. Disputes freeze releases until the arbiter splits the funds. Unearned milestones are refundable after the deadline. Unanswered submissions can be claimed after the review period.

### Manual mode
- `POST /bodyguard/analyze` explains a transaction and lists risk signals before signing (lookalike accounts, non-existent receivers, unknown tokens, insufficient balance, unregistered FT receivers, privileged methods, full-access keys, account deletion).
- The wallet signs. `POST /wallet/transactions` registers the hash and the tracker follows it to finality.
- Swaps: `POST /intents/quote` returns live 1Click quotes for alternative delivery routes. `POST /intents/swaps` creates a live quote and deposit address, and returns the wallet actions (storage registration, optional wrap, `ft_transfer`). Status is tracked to settlement.
- `GET /bodyguard/access-keys` covers NEAR's equivalent of token approvals: it lists full-access and function-call keys, flags risky ones and offers a `DeleteKey` action.
- `GET /wallet/insights` shows weekly spend, by-kind totals, top counterparties, statistical outliers and blocked actions.

### Chain Signatures
For external-chain transfers that Intents cannot route. The EVM address is derived from **the user's own NEAR account** plus a path, so the flow is non-custodial. Veyra prepares the EVM transaction and, through `chainsig.js`, the exact MPC `sign` call. The user's wallet sends it, Veyra reads the signature from the transaction outcome, **verifies it recovers to the derived address**, broadcasts it and tracks confirmations.

## 3. Security model (brief §7 mapping)

| Requirement | Implementation |
|---|---|
| AI never receives private keys | No private keys exist in the backend; all signing happens in the wallet |
| AI never receives partner key / grant token | Key is backend config only; tokens decrypted only in `AgentService.grantClient`; `AiRouter.assertNoSecrets` refuses key-shaped prompts; tests scan every response for `ngt_` and the partner key |
| All autonomous actions through backend execution | `ExecutionService.execute` is the only dispatch path |
| Checked against authorised policy | Agent API policy plus BODYGUARD on every action, including after approval |
| Sensitive policy changes need owner authorisation | `policy_update` is owner-signed; Veyra-only fields activate only when that signed intent succeeds |
| Freeze / revoke | Local kill switch + `agent_freeze`; `grant_revoke` |
| Idempotency | Key stored before dispatch; same key + same body replays; reuse with a different body is refused; duplicate requests within 10 min are blocked |
| Monitor states | `Monitor` polls owner intents, agent ops, 1Click swaps, NEAR txs, escrows, EVM txs |
| Audit trail | Append-only, SHA-256 hash-chained `audit_log`; `GET /audit/verify` |
| AI cannot override escrow | Only the approver, reviewer, arbiter or the review-period rule can release; contract-enforced and unit-tested (`agent_payer_cannot_release_funds`) |
| Adversarial tests | Forged login signatures, tampered intents, malicious AI justification, lookalike addresses, invalid destinations, over-limit, duplicates, cross-user access, frozen agent, API policy refusal |
| Submitted vs confirmed vs settled | Explicit statuses with `submitted_at`, `confirmed_at`, `settled_at` |

**Who enforces what.** The Agent API enforces actions, assets, destinations, USD budgets, per-asset limits, timelock, schedule, hourly action cap, owner approval-for-all, native-call allow-list and freeze. BODYGUARD adds per-transaction USD caps, the approval threshold, slippage, escrow-funding budgets (native calls skip API budgets), destination risk, duplicates/velocity and anomalies. The contracts enforce escrow and reward rules on their own.

**What attestation proves.** NEAR AI Cloud results are accepted after the gateway and model TDX quotes pass Intel DCAP verification (`@phala/dcap-qvl`) with an accepted TCB status, and after these checks: `report_data` binds signer + fresh nonce, RTMR3 replays from the event log, MRCONFIGID matches `app_compose`, the TD is not in debug mode, NVIDIA GPU evidence passes NRAS, and the response signature over the exact request/response bytes recovers to the attested signer. This proves *where and what* ran. It does not prove the advice is right, and it grants no financial permission.

## 4. Integration status

| Integration | Status | Verified how |
|---|---|---|
| NEAR wallet login (NEP-413) | **Real** | Signature + on-chain full-access key check; tests with real ed25519 keys |
| Agent API: create, grant, policy, freeze, actions, approvals, proofs | **Real SDK integration; needs partner key; mainnet** | Built on the official SDK v0.8.2 types; e2e tests run against a fake HTTP Agent API. **Not yet exercised against the live API** (needs a partner key and mainnet funds) |
| 1Click quotes / swaps / status | **Real** | Live quotes fetched during development (1 wNEAR → USDC) |
| Token catalogue & prices | **Real** | Live `/v1/tokens` (216 assets) and 1Click `/v0/tokens` |
| NEAR AI Cloud attestation | **Real** | Live report fully verified (DCAP UpToDate, nonce, RTMR3, compose, GPU via NRAS); fixture in tests |
| NEAR AI Cloud completions + signatures | **Real; needs API key** | Signature verification unit-tested with a real secp256k1 key |
| UNDO escrow contract | **Real; not yet deployed** | 23 unit tests; wasm builds with cargo-near; run `deploy-contracts.sh` |
| PROOF OF LIFE contract | **Real; not yet deployed** | 8 unit tests; wasm builds |
| Chain Signatures | **Real** | Derivation and the MPC call format come from `chainsig.js` against `v1.signer-prod.testnet`; the full MPC round trip needs a funded wallet |
| WANTED demo providers | **Simulated, labelled** | `demo: true`, offers marked `[simulated]` |
| Planner without NEAR AI key | **Deterministic, labelled** | `source.kind = "heuristic"` |

## 5. Hackathon demo script (brief §9)

Prerequisites: the partner key and a small amount of mainnet funds (Agent API), contracts deployed with `deploy-contracts.sh`, and optionally a NEAR AI key.

1. **Connect a wallet** → *Connect wallet* → *Sign in (NEP-413)*.
2. **Create an agent** → *Agent wallet* → keep the example policy ($100/week, $30 approval threshold, 1% slippage) → sign.
3. **Grant permission** → *Issue grant to Veyra* → sign the commitment.
4. **Fund it** → *Get deposit address*, send a few USDC.
5. **Give a goal** → *Autonomous* → run the website example. Watch the plan, providers, offers and negotiation.
6. **Permitted transaction** → *Agent action* → transfer $5 to an approved destination → watch `submitted → confirmed → settled` in *Activity*, then open the proof endpoint.
7. **BODYGUARD block** → transfer $150, or to a non-approved address → `blocked`, with reasons.
8. **Approval** → transfer $45 → *Approvals* → approve with a wallet signature.
9. **Protected payment** → select the offer → *Create & fund UNDO escrow* → as the provider, upload evidence → as the owner, *Accept milestone & release* → see the `milestone_released` event.
10. **Freeze** → *EMERGENCY FREEZE* → any further action is blocked; sign the API freeze.
11. **Manual intelligence** → *Manual wallet* → live swap quotes; check a transfer to `wrap.neer` (lookalike) → danger.

Clearly state on screen: agent steps run on **mainnet** (Agent API beta), escrow/PoL on **testnet** unless deployed to mainnet, and demo providers are simulated.
