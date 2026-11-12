import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, post } from "../api";
import { invalidate } from "../lib/data";

/**
 * Who is signed in, which mode the server runs in, and the wallet (live mode only). The wallet
 * selector is loaded on demand so the simulator never downloads it.
 */
export interface Config {
  mode: "sim" | "live";
  nearNetwork: "testnet" | "mainnet";
  integrations: Record<string, any>;
  [k: string]: unknown;
}
interface Session {
  config: Config | null;
  user: { accountId: string; id: string } | null;
  wallet: string | null;
  ready: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  connectWallet: () => Promise<void>;
  busy: boolean;
}
const Ctx = createContext<Session | null>(null);
export const useSession = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
};

type WalletModule = typeof import("../wallet");
let walletMod: Promise<WalletModule> | null = null;
export const loadWallet = () => (walletMod ??= import("../wallet"));

export function SessionProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [user, setUser] = useState<Session["user"]>(null);
  const [wallet, setWallet] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const c = await api<Config>("/config");
        setConfig(c);
        setUser((await api("/auth/me").catch(() => null))?.user ?? null);
        if (c.mode === "live") {
          const w = await loadWallet();
          await w.initWallet(c.nearNetwork);
          setWallet(w.connectedAccount());
          w.onAccountChange(setWallet);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const connectWallet = useCallback(async () => { (await loadWallet()).showWalletModal(); }, []);

  const signIn = useCallback(async () => {
    if (!config) return;
    setError(null);
    setBusy(true);
    try {
      if (config.mode === "live" && !wallet) { await connectWallet(); return; }
      const r = config.mode === "sim" ? await post("/sim/session") : await (await import("../flows")).login();
      setUser(r.user);
      invalidate("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [config, wallet, connectWallet]);

  const signOut = useCallback(async () => {
    await post("/auth/logout").catch(() => undefined);
    if (config?.mode === "live") await (await loadWallet()).disconnect().catch(() => undefined);
    setUser(null);
    invalidate("/");
  }, [config]);

  const value = useMemo<Session>(() => ({ config, user, wallet, ready, error, signIn, signOut, connectWallet, busy }), [config, user, wallet, ready, error, signIn, signOut, connectWallet, busy]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
