# Veyra — product direction

> **Veyra is an autonomous contractor for the agent economy.** Hire it with a budget; it breaks the
> work down, hires other agents on the NEAR AI Agent Market, negotiates, checks their work, pays
> them, and delivers — keeping a margin. Every dollar moves inside an owner-signed policy, and no
> agent it deals with can talk it into paying what it shouldn't.

Tracks: **Agent Economy** (primary), **AI Security & Defense**, **Autonomous Business**.

## Why this, and not a "financial OS"

Research findings that shaped this (see the conversation log / README sources):

| Finding | Consequence |
|---|---|
| The Agent Economy brief literally asks for a contractor agent that hires agents, negotiates once, checks work, pays, and writes receipts | Build exactly that, done properly, on the real market |
| The NEAR AI **Agent Market** already has ~50 live agents, held payments, disputes, reputation | Don't rebuild a marketplace or escrow — be its best power user (buyer *and* seller) |
| x402 on the market settles USDC on NEAR via a NEP-366 signed delegate `ft_transfer`; buyer job tools are MCP behind OAuth (device-code grant supported) | Two hiring rails: **instant** (x402) and **negotiated** (job board via MCP) |
| The Agent API wallet's keys are in custody and cannot sign a delegate action | Three-tier treasury: policy vault → bounded spend account → market |
| 7+ entries are "spending firewalls for agents" | Our security angle must be different: defend against **malicious counterparties inside the economy** (poisoned deliverables, payee swaps, price bait-and-switch), not just a malicious prompt |
| Judges: Illia (security is the bottleneck), Haseeb ("it's all toys") | Real money on the real market, verifiable receipts, an attack lab that runs |
| AI judges check "it runs and does what the README says" | A faithful **local market simulator** so every README step runs with zero credentials; live mode is the same code against market.near.ai |

## The loop

```
 buyer (person or agent) ──hires──▶ VEYRA (listed worker agent on market.near.ai)
                                     │ 1. intake: brief + budget → contract with a budget envelope
                                     │ 2. plan (NEAR AI Cloud, attested): subtasks, criteria, caps
                                     │ 3. source: catalog search, reputation, price, SLA
                                     │ 4. quote: x402 402-challenge  |  job-board bids
                                     │ 5. negotiate: counter once with reasoning → accept / walk
                                     │ 6. GUARD: envelope, counterparty score, payee pinning,
                                     │    taint check, duplicate/velocity  → allow | ask | block
                                     │ 7. pay: x402 cheque from spend account | award from market balance
                                     │ 8. verify work: deterministic checks + attested AI judge,
                                     │    deliverable treated as untrusted (injection scan)
                                     │ 9. accept / request changes / dispute; review the agent
                                     │10. assemble → deliver to the buyer → get paid
                                     ▼
                     receipts (signed, Merkle-anchored on NEAR) + public P&L ledger
```

## Architecture

### Treasury — three tiers, each bounded by a different enforcer
1. **Vault** — NEAR Intents Agent API wallet. Owner signs the policy once (destinations = spend
   account + market deposit address only; USD budgets; per-tx limits). Enforced by the Agent API.
2. **Spend account** — a dedicated NEAR account whose only job is signing x402 cheques. It is
   refilled just-in-time from the vault for one job at a time, so it never holds more than the
   current float. Its key is sealed at rest; the float caps the blast radius.
3. **Market balance** — for negotiated jobs; the market itself escrows each award until acceptance.

### Market integration (all verified against the live specs)
- Catalog / agent cards / pricing plans / reputation — public REST.
- **x402 caller** — 402 challenge, NEP-366 signed delegate `ft_transfer`, `X-PAYMENT`, `GetTask` polling, `CancelTask`.
- **MCP buyer client** — OAuth dynamic client registration + device-code grant; `post_job`, `list_bids`, bid messages (counter-offer), `award_bid`, `get_job_result`, `accept_result`, `request_changes`, `review_agent`.
- **Worker client** — `aat_` token; assignments, start, progress, messages, submit; webhook HMAC verification.

### GUARD (BODYGUARD v2) — deterministic, model-independent
- **Budget envelopes**: contract budget → per-subtask caps → per-payment; hierarchical, atomic reservation.
- **Payee pinning**: every x402 challenge must match the treasury/asset/network published at the
  market's `/.well-known/x402` and the amount must equal the agent's pricing plan. A card or proxy
  that swaps the payee or inflates the price is blocked.
- **Counterparty scoring**: success rate, delivered jobs, age, reviews, owner verification, local history.
- **Taint tracking**: text from counterparties (bids, messages, deliverables) is untrusted. Any
  payment parameter (recipient, amount, extra job) that originates there is refused.
- **Injection scanning** of deliverables before they reach the planner.
- Duplicate / velocity / anomaly checks, kill switch, owner escalation with NEP-413 signatures.

### Verifiable trail
- Every subtask yields a **receipt** (what, from whom, price, cheque hash / award, verification
  result, settlement). Receipts are ed25519-signed by Veyra and their **Merkle root is anchored**
  in the `veyra-ledger` NEAR contract, so any receipt can be proven against the chain.
- A public **P&L ledger** page: revenue, costs, margin, per contract.
- NEAR AI Cloud attestation is verified for every planning and judging call.

### Modes
- `sim` — local market simulator implementing the same A2A+x402 and MCP behaviour (including
  scripted adversarial agents). Every README step runs offline.
- `live` — market.near.ai, the Agent API (demo or production), NEAR mainnet for x402 settlement.

## Scope decisions
Removed from the product surface (kept in git history at commit `b023cb3`): the in-house
marketplace and escrow (the Agent Market does this), PROOF OF LIFE, Chain Signatures, goal-based
investing and manual swaps. They did not serve the loop above.
