# Veyra Heist: build plan

> **Status:** P0 and P1 are built and running. The referee, five vaults, practice and ranked
> runs, the Heist Cam, the leaderboard, replays, and the pot contract on testnet with
> underwriting are live. A real ranked round has been settled on testnet. P2 seasons and a
> real-model vault are not built.

Veyra holds a pot. You build a rogue agent and try to take it.

Veyra stays the product name, the brand and the visual system. Heist is how people meet it:
a game played against Veyra, in which the attack lab becomes something judges and players do,
not something they watch.

Tracks: **Games With Real Economies** (primary), **AI Security & Defense**, **Agent Economy**.

## The loop

1. **Pick a vault.** Five vaults, each guarded by more of GUARD than the last. Each vault
   publishes its rule set, its pot and how many have tried.
2. **Build a rogue agent** in the Workshop. You control what a real market agent controls:
   its listing (name, category, listed price), its 402 quote (amount, payee, asset, network,
   validity window), its deliverable (any text, which Veyra's model reads), and whether it
   delivers at all.
3. **Run the heist.** Veyra posts a job, finds your agent, quotes it, runs GUARD, pays or
   refuses, reads your deliverable, and acts on it. You watch every step in the Heist Cam.
4. **Score.** You crack the vault if any USDC reaches an account you control beyond the fair
   price of the job: a redirected payment, an over-charge, or a transfer your deliverable
   talked Veyra into. Otherwise the run shows exactly which rule stopped you.
5. **Get paid or pay in.** A failed attempt adds its entry fee to the pot. A crack takes the
   pot. Every attempt leaves a receipt anchored on NEAR, and anyone can replay it.

## The vaults

Each vault switches GUARD rules on. A rule that is off is a real hole, so every vault below the
last can be cracked by someone who reads its rule set carefully.

| Vault | Rules on | The hole |
|---|---|---|
| 1 · Open Door | budget caps only | pay-before-delivery and no payee check: anything goes |
| 2 · Pinned | + payee pinning, settle on delivery | the price is never compared with the listing |
| 3 · Priced | + price integrity, validity window | deliverables are trusted |
| 4 · Read | + injection scanner | payment parameters are not taint-tracked; beat the scanner and the fooled model pays |
| 5 · Veyra | full GUARD: taint, trust floor, mandate, cheque self-check | none known. Cracking it is a real bug bounty |

A crack of vault 5 is a real security finding. It is published with its replay and becomes a
regression test in the repository.

## Economy

- **Practice runs** are free, use play money, and have no pot. Judges start here.
- **Ranked runs** cost a small entry fee in **testnet NEAR** (free from the faucet). This keeps
  the whole game at $0 while every coin is real on-chain. Testnet-only projects are eligible
  for every track.
- Entry fees: 80% to the vault's pot, 20% to the house treasury, which seeds new seasons.
- Higher vaults cost more to enter and hold bigger pots. Pots grow with every failure, so the
  most-defended vault becomes the most valuable target without anyone setting a price.
- **Commit-reveal**: a ranked entry commits to the hash of the rogue agent's spec first and
  reveals it to the referee only afterwards, so nobody can copy a winning design from the
  mempool.

## Making the referee verifiable

Veyra referees every run, so the referee has to be checkable:

- Each run executes in a fresh, sealed simulation (its own in-memory chain and market) with
  fixed seeds. The same spec on the same vault always gives the same outcome.
- The receipt records the hash of the spec, the vault's rule set, the engine version and the
  outcome. Receipts are anchored in `veyra-ledger` on testnet, as today.
- `pnpm heist:replay <receipt>` re-runs any attempt locally and checks it matches the receipt.

## Architecture: what is new and what is reused

**Reused as is:** the contractor engine, cheques and the key pool, the simulated chain and
market, receipts and Merkle anchoring, the testnet ledger, the console shell and design
system, the wallet selector.

**New on the server**
- `GuardProfile`: the set of enabled rules, passed into `checkChallenge`, the scanner and the
  taint check. Default is everything on, so Veyra's normal behaviour does not change.
- `RogueAgentSpec` and a validator (bounded sizes, safe text).
- The simulated market accepts one player-defined agent per run and serves its listing,
  quote and deliverable exactly as a real market agent would.
- `HeistRunner`: builds a sealed simulation, applies the vault's profile, runs one contract,
  measures money that reached attacker-controlled accounts, and returns the run with a
  step-by-step trace.
- Routes: vaults, practice run, ranked entry, run detail, leaderboard, replay.

**New on-chain**
- `veyra-heist` contract on testnet: vaults with pots; `enter(vault, spec_hash)` payable;
  `resolve(entry, cracked, outcome_hash)` callable only by the referee, which pays the pot on
  a crack; views for pots, entries and winners.

**New in the console** (same tokens, type and components)
- Landing: the hero becomes the invitation. "Veyra holds the pot. Take it." Live pots and
  the last crack sit where the mockup is now.
- **Heist** becomes the first section in the nav, before Business:
  - **Vaults**: five cards with rules, pot, attempts and cracks.
  - **Workshop**: the rogue agent form, with a live preview of exactly what Veyra will see.
  - **Heist Cam**: the run replayed step by step on the timeline component, with the rule
    that stopped you, or the moment you got paid.
  - **Leaderboard** and **Replays**.
- The existing pages (Business, Market, Treasury, Watchtower, Evidence) stay, grouped as
  "Veyra", so judges can see the real system the game is played against.

## Phases

**P0, the playable game (must ship)**
1. Guard profiles, defaulting to full. All existing tests stay green.
2. Rogue agent spec and the simulated market hook.
3. Heist runner with deterministic seeds, the trace and scoring. Tests: each vault 1–4 has a
   known crack, and vault 5 holds against every crack below it.
4. Practice-run API, Vaults, Workshop, Heist Cam, and starter templates for each known
   attack, so a judge can crack vault 1 in under two minutes.
5. Receipts for every run, anchored on testnet; `heist:replay`.
6. Landing and README rewritten around the loop, with "do X, see Y" steps.

**P1, the real economy**
7. `veyra-heist` contract, tests, testnet deploy.
8. Ranked entry from the wallet on testnet, commit-reveal, payouts, live pots on the landing
   page.
9. Leaderboard from on-chain entries.

**P2, if time allows**
10. Underwriters: stake into a vault's defence and earn from failed attempts, losing the stake
    on a crack. This gives the economy a second side.
11. Seasons: new vault variants on a schedule, funded by the house treasury.
12. A real model as the target, through NEAR AI Cloud, for a vault where the model is not
    simulated.

## Risks

- **It is solved too fast.** Vaults 1–4 are meant to fall; vault 5 has to hold. If someone
  cracks vault 5, that is the best possible demo: a real finding, paid out, patched in public.
- **It is not fun.** The Workshop has to make attempts quick to change and rerun, and the
  Heist Cam has to show why you were stopped. Seconds per attempt, not minutes.
- **Testnet wallets.** Players need a NEAR testnet wallet and faucet NEAR. Practice runs need
  neither, and judges can play the whole game in practice mode.
- **Scope.** P0 alone is a complete game. P1 makes the economy real. P2 is optional.

## Decisions for the owner

- Entry fee per vault (proposed: 0.1, 0.2, 0.5, 1 and 2 testnet NEAR).
- Whether ranked runs ship in the submission (P1) or practice only (P0).
- Whether vault 5's pot is seeded at launch, and with how much.
