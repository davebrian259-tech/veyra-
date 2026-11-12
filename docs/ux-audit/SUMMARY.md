# Veyra Heist: before and after

Screenshots at 1440px and 390px: [`before/`](before/) (commit `0b91e2e`) and [`after/`](after/).
The audit that drove these changes is [AUDIT.md](AUDIT.md).

| Area | Before | After |
|---|---|---|
| First visit | Opens on vault 5, the vault that cannot be cracked. No guidance. | Opens on **Start here: vault 1** with the winning move preloaded. A six-step tour (driver.js), then a shorter one in the arena. |
| Where am I | A title in the top bar. | Breadcrumbs on every screen, plus a page title and one line on what the screen is for. |
| What next | Nothing. | A **Next** strip on every screen and an **Objectives** panel with seven goals. They come from real state: your runs on the server, the wallet, its balance, and your stakes on the contract. Each goal has the button that does it. |
| Navigation | Three rail icons and the console. | The nav follows the player loop: Learn, Vaults, Ranks, Back, Stats. Ctrl/⌘K palette, keyboard shortcuts with tooltips, `?` for the list. |
| Deep links | The vault id only. | The move, the result, the ranked sheet, the inspected player, the leaderboard filters and the backing sheets are all in the URL. |
| Ranked entry | One button, a spinner, raw wallet errors. | A confirmation sheet with the fee, the network fee from the live gas price, your balance before and after, and the referee's verdict for your exact agent. Then each step in turn: preparing, wallet, confirming on NEAR, the referee, done. NearBlocks links in the sheet and the toast. Readable errors with a fix. |
| Paid but not settled | A dead end. The fee could only be recovered from a terminal. | A banner on every screen: settle it now, or reclaim the fee after 24 hours. |
| Back a vault | Spinner, toast, raw panics ("nothing to withdraw"). | Your stake and earnings read from the contract. Confirmation sheets with your share and the expected earnings per failed heist. The stake shows at once and rolls back if the transaction fails. Withdraw is disabled when there is nothing to withdraw. |
| The economy | One sentence on three screens. | A How to play page with a money-flow diagram, live fees and pots, risks in plain words, every shield and every move. Every number explains itself on tap. |
| Liveliness | A table of recent runs. | A live feed with timestamps, replays and entry and settlement transactions. A Stats page with five charts (palette validated for colour blindness and contrast) and table views. |
| Leaderboard | A table. | Filters and search in the URL, your rank pinned at the top, and a player inspector with their agents and the option to load a build. |
| Winning | A gold card. | The loot counts up, confetti, an achievement toast, a "new move unlocked" toast with a button to use it, and **On to vault N**. Optional sound, off by default. |
| Phones | The workshop sat below the run button; edit, scroll up, run. | A run dock pinned above the bottom nav, sheets that slide up from the bottom, and a five-tab bottom nav. |
| Landing | The old contractor story, with a game hero on top. | Rebuilt around the game in its art direction: live pots, a Heist Cam still, the vault ladder, the economy, fair play, and the agent behind it. |
| Toasts | Two styles, light toasts in the dark arena. | One system (sonner), themed by the page. |

## Measured

| Check | Before | After |
|---|---|---|
| Lighthouse `/play` mobile (perf / a11y / best practices / SEO) | 91 / 100 / 100 / 100 | 81 / 100 / 100 / 100 |
| Lighthouse `/play` desktop | 96 / 100 / 100 / 100 | 94 / 100 / 100 / 100 |
| Lighthouse `/` mobile | 95 / 100 / 100 / 100 | 91 / 100 / 100 / 100 |
| Horizontal scroll at 390px | none | none |
| Console errors on every route | none | none |
| Server tests | 67 | 68 |
| Playwright critical path | none | 5 pass (desktop and phone); 1 runs a real ranked entry on testnet |

Mobile performance on the lobby dropped because the shell now loads Radix popovers and
tooltips, the palette and the transaction sheet before its first paint on emulated slow 4G.
The next step would be to load the palette and the explain popovers after first paint.
