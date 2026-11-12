import { ApiError } from "../api";

export const FAUCET_URL = "https://near-faucet.io/";

/** A readable error: what happened, and what to do about it. */
export interface Friendly { title: string; fix: string; link?: { href: string; label: string }; raw: string }

const RULES: { test: RegExp; title: string; fix: string; link?: Friendly["link"] }[] = [
  { test: /user (rejected|cancel|denied|closed)|rejected the request|request rejected|cancelled|canceled|window closed|popup closed/i, title: "You cancelled in your wallet. Nothing was sent.", fix: "Press the button again when you are ready." },
  { test: /NotEnoughBalance|LackBalanceForState|not enough balance|insufficient (funds|balance)|exceeds.*balance/i, title: "Your wallet does not have enough testnet NEAR.", fix: "Get free testnet NEAR from the faucet, then try again.", link: { href: FAUCET_URL, label: "Open the faucet" } },
  { test: /attach exactly the vault's entry fee/, title: "The fee did not match this vault's price.", fix: "Reload the page so the fee is current, then enter again." },
  { test: /spec_hash must be 64 hex/, title: "Your agent's fingerprint was malformed.", fix: "Reload the page and enter again." },
  { test: /no such vault/, title: "That vault does not exist on the contract.", fix: "Pick a vault from 1 to 5." },
  { test: /nothing to withdraw/, title: "You have nothing to withdraw from this vault.", fix: "Back the vault first, or check that it was not cracked since you backed it." },
  { test: /attach a deposit/, title: "The amount was zero.", fix: "Enter an amount above 0." },
  { test: /too early to reclaim/, title: "It is too early to reclaim this fee.", fix: "Fees can be reclaimed 24 hours after entering if the referee never settled them." },
  { test: /only the player can reclaim/, title: "Only the wallet that entered can reclaim this fee.", fix: "Switch to the account that paid the entry." },
  { test: /entry is already settled|entry_settled/, title: "This entry has already been settled.", fix: "Open your latest heists to see the result." },
  { test: /tx_not_found|Could not find that entry transaction/, title: "NEAR has not finished processing your entry yet.", fix: "Wait a few seconds and press Retry. Your fee is safe in the contract." },
  { test: /spec_mismatch/, title: "The agent you sent is not the one you paid for.", fix: "Do not change the workshop while an entry is settling. Retry with the original build." },
  { test: /slow_down|Too many runs/, title: "That was a lot of heists in one minute.", fix: "Wait a few seconds, then go again." },
  { test: /ranked_off/, title: "Ranked play is switched off on this server.", fix: "Practice runs still work and use the same referee." },
  { test: /server_unreachable|Failed to fetch|NetworkError|Load failed/i, title: "The game server did not answer.", fix: "Check your connection. If it was asleep, it wakes in about a minute." },
  { test: /wallet not initialised|Connect a NEAR wallet/i, title: "No wallet is connected.", fix: "Connect a NEAR testnet wallet, then press the button again." },
];

export function friendly(e: unknown): Friendly {
  const raw = e instanceof ApiError ? `${e.code ?? ""} ${e.message}` : e instanceof Error ? e.message : String(e);
  for (const r of RULES) if (r.test.test(raw)) return { title: r.title, fix: r.fix, link: r.link, raw };
  const msg = e instanceof Error ? e.message : String(e);
  return { title: msg.length > 160 ? `${msg.slice(0, 157)}…` : msg, fix: "Try again. If it keeps happening, reload the page.", raw };
}
