import { FAUCET_URL } from "./errors";
import { YOCTO, type Account, type Lobby, type Player } from "./heist-api";

/**
 * The player's objectives, worked out from real state: the server's record of their runs, the
 * wallet they connected, its balance and their stakes on the pot contract. Nothing is ticked by
 * hand; each quest is done when the state says so.
 */
export interface Quest {
  id: string;
  title: string;
  why: string;
  done: boolean;
  progress?: { n: number; of: number };
  action: { label: string; to?: string; href?: string; run?: "connect" };
}

export function quests(s: { lobby?: Lobby; me?: Player; cracked: number[]; account: string | null; acct?: Account; rankedEnabled: boolean }): Quest[] {
  const cracked = new Set(s.cracked);
  const tried = new Set(s.me?.tried ?? []);
  const nextVault = [1, 2, 3, 4].find((v) => !cracked.has(v)) ?? 5;
  const fee1 = s.lobby ? BigInt(s.lobby.vaults[0]?.feeYocto ?? "0") : YOCTO / 10n;
  const funded = s.acct ? BigInt(s.acct.balanceYocto) >= fee1 + YOCTO / 20n : false;
  const list: Quest[] = [
    { id: "first-crack", title: "Crack vault 1", why: "It never checks who it pays. The redirect move asks to be paid at your own account.", done: cracked.has(1), action: { label: "Try the redirect", to: "/play/vault/1?move=redirect" } },
    { id: "climb", title: "Climb to vault 4", why: "Each vault adds a shield. Read the hint, pick the move that slips past it.", done: [1, 2, 3, 4].every((v) => cracked.has(v)), progress: { n: [1, 2, 3, 4].filter((v) => cracked.has(v)).length, of: 4 }, action: { label: `Go to vault ${nextVault}`, to: `/play/vault/${nextVault}` } },
    { id: "veyra", title: "Take on vault 5", why: "Production Veyra, every defence on. Nobody has cracked it. A crack is a real bug bounty.", done: tried.has(5), action: { label: "Face vault 5", to: "/play/vault/5" } },
  ];
  if (s.rankedEnabled) {
    list.push(
      { id: "wallet", title: "Connect a NEAR wallet", why: "Ranked heists and backing vaults pay real testnet NEAR from your own wallet.", done: Boolean(s.account), action: { label: "Connect wallet", run: "connect" } },
      { id: "fund", title: "Get free testnet NEAR", why: "The faucet sends testnet NEAR for free. Vault 1 costs 0.1 to enter.", done: funded, action: { label: "Open the faucet", href: FAUCET_URL } },
      { id: "ranked", title: "Play a ranked heist", why: "Same referee, real pot. Crack it and the contract pays the whole pot to your wallet.", done: (s.me?.rankedRuns ?? 0) > 0, action: { label: `Enter vault ${cracked.has(1) ? Math.min(nextVault, 4) : 1} ranked`, to: `/play/vault/${cracked.has(1) ? Math.min(nextVault, 4) : 1}?confirm=ranked` } },
      { id: "back", title: "Back a vault", why: "Play the other side: stake on a vault holding and earn 20% of every failed entry fee.", done: (s.acct?.stakes.length ?? 0) > 0, action: { label: "Back a vault", to: "/play/underwrite" } },
    );
  }
  return list;
}

/** The first quest not done, or null when the player has done them all. */
export const nextQuest = (qs: Quest[]) => qs.find((q) => !q.done) ?? null;
