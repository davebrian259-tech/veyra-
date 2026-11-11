import { useEffect, useState } from "react";
import { api, post } from "./api";
import { login } from "./flows";
import { ActivityPage } from "./pages/ActivityPage";
import { AgentPage } from "./pages/AgentPage";
import { AutonomousPage } from "./pages/AutonomousPage";
import { ChainSigPage } from "./pages/ChainSigPage";
import { EscrowPage } from "./pages/EscrowPage";
import { PolPage } from "./pages/PolPage";
import { SecurityPage } from "./pages/SecurityPage";
import { WalletPage } from "./pages/WalletPage";
import { WantedPage } from "./pages/WantedPage";
import { Json } from "./ui";
import { connectedAccount, disconnect, initWallet, onAccountChange, showWalletModal } from "./wallet";

const TABS = {
  autonomous: { label: "Autonomous", el: <AutonomousPage /> },
  agent: { label: "Agent wallet", el: <AgentPage /> },
  wallet: { label: "Manual wallet", el: <WalletPage /> },
  wanted: { label: "WANTED", el: <WantedPage /> },
  undo: { label: "UNDO", el: <EscrowPage /> },
  bodyguard: { label: "BODYGUARD", el: <SecurityPage /> },
  pol: { label: "PROOF OF LIFE", el: <PolPage /> },
  chainsig: { label: "Chain Signatures", el: <ChainSigPage /> },
  activity: { label: "Activity", el: <ActivityPage /> },
} as const;

export function App() {
  const [config, setConfig] = useState<any>(null);
  const [wallet, setWallet] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);
  const [tab, setTab] = useState<keyof typeof TABS>("autonomous");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const c = await api("/config");
      setConfig(c);
      await initWallet(c.nearNetwork);
      setWallet(connectedAccount());
      onAccountChange(setWallet);
      setUser((await api("/auth/me").catch(() => null))?.user ?? null);
    })().catch((e) => setError(String(e)));
  }, []);

  const signIn = async () => {
    setError(null);
    try {
      const r = await login();
      setUser(r.user);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="app">
      <header>
        <h1>Veyra <small>Give intelligence the power to act.</small></h1>
        <div className="row">
          {config && <span className="pill">NEAR {config.nearNetwork}{config.nearNetwork === "testnet" ? " (testnet — no real value)" : ""}</span>}
          {wallet ? <span className="pill">Wallet: {wallet}</span> : <button onClick={showWalletModal}>Connect wallet</button>}
          {wallet && !user && <button onClick={signIn}>Sign in (NEP-413)</button>}
          {user && <span className="pill">Signed in: {user.accountId}</span>}
          {wallet && <button onClick={async () => { await post("/auth/logout"); await disconnect(); setUser(null); }}>Sign out</button>}
        </div>
      </header>
      {error && <pre className="error">{error}</pre>}
      {config && (
        <details className="integrations">
          <summary>Integration status (mocked or unconfigured parts are labelled)</summary>
          <Json value={config.integrations} />
        </details>
      )}
      {user ? (
        <>
          <nav>
            {Object.entries(TABS).map(([k, t]) => (
              <button key={k} className={k === tab ? "active" : undefined} onClick={() => setTab(k as keyof typeof TABS)}>{t.label}</button>
            ))}
          </nav>
          <main>{TABS[tab].el}</main>
        </>
      ) : (
        <p className="note">Connect a NEAR wallet and sign in. Veyra never receives your keys.</p>
      )}
    </div>
  );
}
