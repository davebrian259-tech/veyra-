# Submitting Veyra Heist

The deadline is **2026-11-14 at 23:59 UTC**. Judging starts on 2026-11-16 and results are due by
2026-11-18. Source: the [NEAR HACKATHON rules](https://nearhackathon.com/HACKATHON.md).

## Before you submit

- [ ] **The repository is public.** Judges cannot open a private repository.
- [x] README with what it is, the problem, and "do X, see Y" steps to try it.
- [x] LICENSE (MIT).
- [x] AI assistance and the start date disclosed in the README ("Built at NEAR HACKATHON").
- [ ] **The demo post is live on X** with the film attached, saying it was built at NEAR
      HACKATHON, tagging @NEARProtocol and #NEARHackathon.
- [ ] **A mainnet NEAR account for the payout.** Prizes are paid on mainnet: a named account
      such as `yourname.near`, or a 64-character implicit account. A testnet account will not work.
- [ ] The hosted game is up: the Render service shows **Live**, and https://veyra-ccp.pages.dev
      plays. Keep it up until at least 2026-11-18, ideally 2026-11-25.

## The form

| Field | What to enter |
|---|---|
| Project name | Veyra Heist |
| Team lead | Your name |
| Email address | Your email (used only to contact you) |
| Team size | 1, if you built it alone |
| Tracks | Games With Real Economies; AI Security & Defense; Agent Economy |
| NEAR wallet address | Your **mainnet** account, for example `yourname.near` |
| Repository link | https://github.com/davebrian259-tech/veyra- |
| Demo post link | The link to your post on X |
| What did you build? | The text below (1270 characters; the limit is 2,000) |

To change anything after submitting, use https://nearhackathon.com/request-changes. Do not
submit a second time.

### What did you build?

Veyra Heist is a game with a real economy, played against a real AI agent. Veyra hires and pays other AI agents on NEAR. Once agents pay agents, every agent with a wallet is a vault: a hired agent can overcharge it, redirect the payment, or hide instructions in the work it delivers.

In Veyra Heist you build a rogue agent and try to make Veyra overpay. Five vaults each switch on more of Veyra's real defences: budget caps, a cheque self-check, a payee lock, a price seal, an injection scanner and a taint trace. Each move cracks one vault and is stopped by the next, so players learn real attacks and real defences by playing. Practice is free and needs no wallet; a new player cracks vault 1 within a minute.

NEAR is the economy. Ranked heists pay an entry fee (0.1 to 2 testnet NEAR) into the veyra-heist contract, which holds every pot. A failed heist splits its fee 70% to the pot, 20% to the vault's backers and 10% to the house. A crack pays the whole pot, and the winner gets a NEP-245 gold bar they own and can send. Nobody sets prices: failures pile up on the vaults that hold, so the best-defended vault becomes the richest target without a dev patch. Every heist is deterministic and replayable, and the agent's hash is committed on-chain before the duel.

## The demo post on X

Attach the film (`veyra-heist.mp4`, 1:57). It is 255 characters, under X's 280-character limit.

```text
Built at #NEARHackathon: Veyra Heist.

One AI guards the money. You build another AI to steal it.

5 vaults, each with tougher defences. Every failed heist grows the pot on @NEARProtocol. Crack it and the contract pays you.

Play free: veyra-ccp.pages.dev
```

Then reply to your own post with the code, so the main post stays short:

```text
Code: github.com/davebrian259-tech/veyra-
@NearBuilders @NearLegion
```
