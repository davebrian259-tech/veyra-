# Veyra Heist: hackathon submission

**Track:** Games With Real Economies (`games`): *the economy is the gameplay.*
**Also relevant to:** AI Security & Defense, Agent Economy.
**Play:** https://veyra-ccp.pages.dev · **Pot contract:** [`veyra-heist-mwdwy8zz.testnet`](https://testnet.nearblocks.io/address/veyra-heist-mwdwy8zz.testnet)

Veyra is an AI agent that pays other agents for their work. In Veyra Heist you build a rogue
agent and try to make it overpay. Five vaults hold real pots on NEAR, each guarded by more of
Veyra's real defences. Failed heists make the pots bigger. Successful ones empty them. Backers bet
on vaults holding. Nobody sets the prices: the pots are the market.

## The game loop, on paper

| Every… | The player… | What changes |
|---|---|---|
| **30 seconds** | Picks a move, tweaks the price, payee or deliverable, presses <kbd>R</kbd>, and watches the Heist Cam play the duel round by round. | They crack it (loot, confetti, a new move unlocked) or see the exact shield that stopped them. Then they change one thing and go again. |
| **5 minutes** | Climbs a vault. Reads the hint, learns why a shield exists, and unlocks the move that beats the next one. Checks the live feed and the leaderboard. | Their rank, their climb (0 to 5), and the objective panel's next step. |
| **A session** | Plays ranked for a real pot (testnet NEAR), or backs the vault they believe will hold. Fast-forwards a week to see where the money flows. | Real pots on-chain: their fee grows a pot or they take it. Their stake earns from other people's failures or is lost to a crack. |

The first session needs no wallet at all. Practice is free and instant, and a new player cracks
vault 1 within a minute of landing.

## How the economy moves without a dev patch

- **The pots are the prices.** A failed ranked heist splits its fee: 70% into the vault's pot,
  20% to the vault's backers, 10% to the house. A crack pays the whole pot and the fee back. The
  contract enforces this; no one adjusts it.
- **Hard vaults get rich, easy vaults get farmed.** Players learn which vaults fall. Their
  failures pile up on the vaults that hold, and those pots draw more players. The best-defended
  vault ends up the most valuable target, and nobody had to set a price for that.
- **Backers are the other side of the market.** They stake on a vault holding, earn from every
  failed heist, and lose the stake to a crack. Their money is part of the prize.
- **The house** banks its 10% and re-seeds pots that a crack emptied.

### Agent NPCs with wallets, and fast-forward

[`/play/fast-forward`](https://veyra-ccp.pages.dev/play/fast-forward) plays a week of the town in
a minute, starting from today's pots on NEAR. Three kinds of NPC live there, each an agent with its
own wallet:

- **Crews** rob vaults, in one of three styles:
  - **Careful** crews practise first and only pay when they know a move works.
  - **Copycats** reuse moves from public replays.
  - **Gamblers** chase the biggest pot with moves nobody has tried.
- **Backers** wait a day, then stake where failed heists pay best and nobody has cracked. They
  pull out after a crack.
- **The house** re-seeds empty pots with at most a quarter of what it holds.

Every decision appears in the feed with its reasoning, under **Why?**. Every heist in the
simulation is decided by the real referee, the same sealed duel that settles ranked entries on
NEAR. The split is the contract's split. A test checks that the simulation is deterministic and
that it never creates or loses a single milliNEAR.

What a typical week shows:

- Vaults 1 to 4 get farmed by crews who practise first, and copycats ride on their replays.
- Gamblers spend their wallets on vault 5 and leave town.
- Backers pile into vault 5, which ends every simulated week as the richest vault.
- The house spends more re-seeding easy vaults than it earns. That is a real design finding: with a
  deterministic referee, free practice is the biggest lever in the economy.

### The rules live in one readable file

[`apps/server/src/heist/economy.ts`](../apps/server/src/heist/economy.ts) holds every rule that
moves money in plain terms:

- the split and the entry fees, which are the same numbers as the contract's
- what a crack pays
- the house re-seed policy
- how moves unlock
- every NPC parameter, and the three crew styles

The fast-forward runs on that file, and the Fast-forward screen links to it.

## Players never have to notice the chain

- Practice, the climb, the leaderboard, replays and fast-forward need **no wallet, no account,
  no gas and no popups**. A player gets a callsign and plays.
- The chain appears only when the player chooses real money. Even then, a confirmation sheet
  explains the cost, the network fee, the resulting balance and the referee's verdict for their
  exact agent in plain words before anything is signed.

## Against the track's checklist

| Brief | Status |
|---|---|
| Economy is the gameplay, evolves without a dev patch | **Done.** Pots, splits and backing on-chain; the fast-forward shows a week of it. |
| NPCs with wallets | **Done.** Veyra itself (the AI that pays, guarded by GUARD), plus crews, backers and the house in fast-forward. |
| Player-owned markets | **Partly.** Players own stakes in vaults (backing) and the pots they win. There is no player-to-player item market. |
| Pricing rules in one readable file, reasoning in a tooltip | **Done.** `economy.ts`; every NPC decision has a **Why?** popover. |
| Fast-forward a week in a minute | **Done.** `/play/fast-forward`, deterministic per week number, shareable by link. |
| No seed phrases, popups or gas in the normal loop | **Done for practice**, which is the whole normal loop. Ranked play uses a NEAR wallet by design. |
| Social or email login | **Not built.** Practice needs no login at all. Ranked uses the NEAR Wallet Selector (Meteor, MyNearWallet, HERE). |
| NEP-245 multi tokens | **Not built.** Loot is NEAR in the pot, paid by the contract. Trophies as NEP-245 tokens would be the next step. |
| NEAR Intents | Used by the agent behind the game (its vault is a NEAR Intents Agent API policy wallet), not in the game loop. |

## What is real, and how to check it

- **The contract:** `contracts/heist`, deployed on testnet, with tests for fees, settlement,
  splits, staking and reclaim.
- **A real win on testnet, tested end to end:** the Playwright test `ranked-crack.spec.ts`
  connects a wallet, enters vault 1 with real testnet NEAR and cracks it. It then checks that the
  contract paid the pot to the player's wallet, and seeds the pot back.
- **Backing and withdrawing on testnet:** `backing.spec.ts` stakes 0.1 NEAR on vault 5, reads
  the stake back from the contract, and withdraws it.
- **The whole climb in a browser:** `climb.spec.ts` cracks vaults 1 to 4 using unlocked moves,
  loses at vault 5, then checks the objectives, leaderboard, inspector, replay check and palette.
- **Every move against every vault:** the server tests pin the table below, and every heist can be
  replayed with the same outcome hash.

| Move | Vault 1 | Vault 2 | Vault 3 | Vault 4 | Vault 5 |
|---|---|---|---|---|---|
| The redirect | cracked | payee lock | payee lock | payee lock | payee lock |
| Bait and switch | cracked | cracked | price seal | price seal | price seal |
| The whisper | cracked | cracked | cracked | scanner | scanner |
| The disguise | cracked | cracked | cracked | cracked | taint trace |

## Honest limits

- The referee is Veyra's server. Every outcome is deterministic and replayable, the agent's hash
  is committed before the duel, and an unsettled fee can be reclaimed after 24 hours. But the
  contract cannot check the duel itself.
- Testnet only.
- The hosted demo runs on free tiers, so practice history resets when the server restarts. Pots
  and ranked settlements live on-chain.
- Ranked play on the hosted site needs the referee key set on the server.
