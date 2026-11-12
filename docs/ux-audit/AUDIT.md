# Veyra Heist: UX audit (before)

Audited on 12 November 2026 against commit `0b91e2e`, server in sim mode with the testnet pot
contract `veyra-heist-mwdwy8zz.testnet`. Screenshots at 1440px and 390px are in
[`before/`](before/).

## The codebase in one page

| Area | What is there |
|---|---|
| Web | React 19, Vite 8, react-router 7, radix-ui (Dialog), cmdk, motion 14, Hugeicons, Geist. CSS variables in `styles.css`, game theme scoped under `.arena` in `game/game.css`. |
| Server | Fastify 5, `node:sqlite`, zod 4, vitest. Heist routes in `routes/heist.ts`, logic in `heist/`. |
| Contract | `contracts/heist` (near-sdk 5.30). Change: `enter(vault, spec_hash)` payable, `resolve` (referee), `reclaim(entry_id)` after 24h, `underwrite(vault)` payable, `withdraw(vault)`, `seed`, owner calls. View: `get_vaults`, `get_entry`, `entry_count`, `get_stake`, `get_config`. |
| Wallet | `@near-wallet-selector` 10.1.4 (Meteor, MyNearWallet, HERE) in `wallet.ts`. Loaded lazily from the game shell. Works. |
| Game state | Vault pots, stakes, attempts and cracks: on-chain, read by the server every 10s. Runs, leaderboard: server SQLite. Player progress (cracked vaults, callsign, last spec): browser `localStorage`. |
| Agents | The rogue agent is a spec (name, quote, payee, deliverable). The referee runs a sealed, deterministic duel against Veyra's real GUARD with the vault's shields on. |
| Money | Ranked: the player pays the entry fee to the contract with `enter`; the server verifies the tx, runs the duel, and calls `resolve`. A crack pays pot + fee to the player. A miss splits the fee 70% pot, 20% backers, 10% house. |

## Screens

| Route | Purpose |
|---|---|
| `/` | Landing. Still mostly the old contractor story (controls bento, five-step stepper, Watchtower dot matrix) with a Heist hero on top. |
| `/play` | Lobby: featured vault, five vault cards, latest heists, progress ring, shield legend, "real pots" note. |
| `/play/vault/:id` | Arena: stage (vault vs your agent, shields, run buttons, Heist Cam) and the workshop (moves, callsign, name, quote, payee, deliverable). |
| `/play/runs/:id` | A shared run: replay, proof hashes, "re-run and check the referee". |
| `/play/leaderboard` | Podium and table. |
| `/play/underwrite` | Back a vault: stake and withdraw per vault. |
| `/app/*` | The Veyra console (separate shell, behind sign-in). Out of scope here; linked from the game. |

## Where a new player gets lost

1. **No first-run guidance.** The lobby opens on "Good luck, ghost-5355" and a vault 5 hero. Nothing says what a heist is, what a move is, or that practice is free.
2. **"Break in" sends a new player to the hardest vault.** The featured vault is the richest, which is vault 5, which cannot be cracked. The first click is a guaranteed loss.
3. **No stated goal.** The progress ring counts cracks but never says what to do next.
4. **The workshop is below the run button on phones.** On 390px you scroll past the stage to edit, then scroll back up to run. The result appears far from the form you just changed.
5. **The economy is never explained in one place.** Fees, the 70/20/10 split, what backers earn and lose, and where the pot goes are scattered across one sentence on three screens.
6. **Shield names are jargon.** "Taint", "Lock", "Cheque" have a tooltip only on hover (title attribute), which does not exist on touch.
7. **Testnet is assumed.** "Ranked · 0.1 NEAR" gives no hint that it is testnet NEAR, free from a faucet, or where the faucet is.
8. **No way back from nested screens on desktop** except the rail. The run page has a back button; the leaderboard and underwrite pages do not say where they sit.

## Dead ends

- **A ranked entry the server fails to settle.** The fee is paid, the error toast disappears, and the contract's `reclaim` (after 24h) has no button anywhere.
- **Back a vault without a wallet** opens the wallet modal and shows "Connect a NEAR wallet first" as an error toast. No path forward once connected (you have to press again).
- **Withdraw** is always enabled, even with no stake; the contract then panics with "nothing to withdraw", shown raw.
- **Locked moves** say "Crack vault 2 to unlock" but do not link to vault 2.
- **Leaderboard** cannot find yourself; no filters; no way to see one player's runs.
- **Run page** for an unknown id says it does not exist, with no button back to play.

## Actions with no feedback

| Action | Today | Missing |
|---|---|---|
| Ranked entry | Button spinner, then the Heist Cam | No "waiting for wallet", "confirming on NEAR", "referee running" states; no tx link until the run ends |
| Back a vault | Button spinner, toast "You now back vault N" | No confirmation of cost, no tx link, staked total updates only on the next poll |
| Withdraw | Button spinner, toast | No preview of what you will receive (stake + earnings) |
| Connect wallet | Modal | No balance shown after connecting |
| Copy link | Label flips to "Copied" | Fine |
| Practice run | Spinner, then cam | Fine, but a win has no celebration beyond the card |

## On-chain actions and their states

| Call | Pending | Success | Error |
|---|---|---|---|
| `enter` | spinner only | run shown | raw wallet or RPC text |
| `underwrite` | spinner only | toast, no tx link | raw text ("attach a deposit") |
| `withdraw` | spinner only | toast, no tx link | raw text ("nothing to withdraw") |
| `reclaim` | not exposed | not exposed | not exposed |

No confirmation step before any of them. No estimate of gas or resulting balance.

## Inconsistencies

- **Spacing:** panels use `--s-6` padding, the featured panel `--s-8`, vault cards `--s-4`; section headings sit outside panels on the lobby but inside on other screens.
- **Type:** headings mix `--fs-lg` (panel), `clamp()` (feature, verdict) and `--fs-xl` (top bar); the lobby section title overrides inline.
- **Colour:** gold is used for money, the ranked button, the "cracked" chip and the slider; "cracked" uses `pill warn` (amber) in tables but `chip gold` on cards.
- **Components:** two toast styles (console toasts appear in the dark arena as light cards); buttons use `.btn.big` in the arena and `.btn.lg` on the landing; tables are styled by the console theme and partly overridden.
- **Tokens:** z-index values and motion durations are hard-coded in places (`z-index: 40`, `520ms` beats, `600ms` shield hit).
- **Tooltips:** `title` attributes only; nothing on touch, nothing for keyboard users.

## Accessibility and performance (before)

- Lighthouse on `/play`: mobile performance 91, accessibility, best practices and SEO 100. Desktop 96/100/100/100.
- Keyboard: all controls reachable; no shortcuts; focus rings present.
- The Heist Cam is `aria-live`, good. The progress ring has a label, good. Win and loss are shown with colour and text, good.

## Plan

1. **Design system:** write the direction, consolidate game tokens (z-index, motion, elevation, type scale) in `game.css`, one toast system (sonner) themed to the arena, one tooltip/explain primitive for every number.
2. **Shell and navigation:** loop-shaped nav (Learn → Vaults → Ranks → Back a vault → Stats), top bar with account, NEAR balance (live from RPC), practice loot and climb, breadcrumbs on nested screens, Ctrl+K palette, keyboard shortcuts, deep links for the selected move, the last run and every sheet.
3. **Direction:** a driver.js tour on first visit, a quest panel driven by real state (your runs, wallet, balance, on-chain stake), a How to play page with a money-flow diagram, empty states with the button that fixes them, faucet link, and "Start at vault 1" as the primary path for new players.
4. **On-chain actions:** one `useTx` hook (preparing, awaiting signature, pending on NEAR, confirmed, failed), a confirmation sheet with cost, deposit, gas, expected outcome from a dry run of the deterministic referee, and resulting balance; nearblocks links; readable errors for every contract panic; recovery for unsettled ranked entries, including `reclaim`.
5. **Game feel:** live activity feed, a Stats page (pots and stakes, heists per day, crack rate by vault, your loot), leaderboard filters with your row pinned, confetti and counters on a crack, move-unlock toasts, optional sound (off by default), and an agent inspector.
6. **Quality:** 390px first, AA contrast, Playwright tests for the critical path, after screenshots, before/after summary. Then the landing redesign and the README.

**Not changed:** the referee, the contract, the economy and the fee split. If something there is broken I will say so first.
