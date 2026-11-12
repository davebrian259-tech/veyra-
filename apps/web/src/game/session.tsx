import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useApi } from "../lib/data";
import { heistWallet, loadProgress, saveProgress, type Account, type Lobby, type Player, type Progress } from "./heist-api";

/**
 * Everything the game screens share: the lobby (vaults, pots, templates), the player's wallet and
 * its live balance and stakes, the player's profile from the server, local progress, and sound.
 */
export interface HeistState {
  lobby: ReturnType<typeof useApi<Lobby>>;
  network: "testnet" | "mainnet";
  contractId: string | null;
  rankedEnabled: boolean;
  account: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  acct: Account | undefined;
  reloadAccount: () => Promise<void>;
  progress: Progress;
  setProgress: (p: Progress) => void;
  me: Player | undefined;
  reloadMe: () => Promise<void>;
  /** Vaults this player has cracked: the server's record merged with this browser's. */
  cracked: number[];
  sound: boolean;
  setSound: (on: boolean) => void;
}

const Ctx = createContext<HeistState | null>(null);
export function useHeist() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useHeist outside the game shell");
  return c;
}

const SOUND = "veyra.heist.sound";
const WALLET_KEY = "near-wallet-selector:selectedWalletId";

export function HeistProvider({ children }: { children: ReactNode }) {
  const lobby = useApi<Lobby>("/heist", { every: 15_000 });
  const network = lobby.data?.ranked.network ?? "testnet";
  const contractId = lobby.data?.ranked.contractId ?? null;
  const rankedEnabled = Boolean(lobby.data?.ranked.enabled && contractId);

  const [progress, setProgressState] = useState(loadProgress);
  const setProgress = useCallback((p: Progress) => { saveProgress(p); setProgressState(p); }, []);

  // The wallet bundle is large: load it only for visitors who connected before, or on click.
  const [wanted, setWanted] = useState(() => { try { return Boolean(localStorage.getItem(WALLET_KEY)); } catch { return false; } });
  const [account, setAccount] = useState<string | null>(null);
  useEffect(() => {
    if (!wanted || !lobby.data) return;
    let unsub: { unsubscribe(): void } | undefined;
    void heistWallet(network).then((w) => { setAccount(w.connectedAccount()); unsub = w.onAccountChange(setAccount) as typeof unsub; }).catch(() => undefined);
    return () => unsub?.unsubscribe();
  }, [network, wanted, lobby.data]);
  const connect = useCallback(async () => { setWanted(true); (await heistWallet(network)).showWalletModal(); }, [network]);
  const disconnect = useCallback(async () => { const w = await heistWallet(network); await w.disconnect(); setAccount(null); }, [network]);

  const acctApi = useApi<Account>(account ? `/heist/accounts/${account}` : null, { every: 15_000 });
  const meApi = useApi<Player>(progress.callsign ? `/heist/players/${encodeURIComponent(progress.callsign)}` : null, { every: 20_000 });

  const cracked = useMemo(() => [...new Set([...progress.cracked, ...(meApi.data?.cracked ?? [])])].sort(), [progress.cracked, meApi.data]);

  const [sound, setSoundState] = useState(() => { try { return localStorage.getItem(SOUND) === "on"; } catch { return false; } });
  const setSound = useCallback((on: boolean) => { try { localStorage.setItem(SOUND, on ? "on" : "off"); } catch { /* storage blocked */ } setSoundState(on); }, []);

  const value: HeistState = {
    lobby, network, contractId, rankedEnabled, account, connect, disconnect,
    acct: acctApi.data, reloadAccount: acctApi.reload, progress, setProgress, me: meApi.data, reloadMe: meApi.reload, cracked, sound, setSound,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
