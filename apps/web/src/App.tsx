import { useEffect, useState } from "react";
import { api, post } from "./api";
import { login } from "./flows";
import { ContractPage } from "./pages/ContractPage";
import { LabPage } from "./pages/LabPage";
import { MarketPage } from "./pages/MarketPage";
import { MoneyPage } from "./pages/MoneyPage";
import { Overview } from "./pages/Overview";
import { SettingsPage } from "./pages/SettingsPage";
import { connectedAccount, disconnect, initWallet, onAccountChange, showWalletModal } from "./wallet";

type Tab = "overview" | "lab" | "market" | "money" | "settings";

export function App() {
  const [config, setConfig] = useState<any>(null);
  const [wallet, setWallet] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [contract, setContract] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const c = await api("/config");
      setConfig(c);
      setUser((await api("/auth/me").catch(() => null))?.user ?? null);
      if (c.mode === "live") {
        await initWallet(c.nearNetwork);
        setWallet(connectedAccount());
        onAccountChange(setWallet);
      }
    })().catch((e) => setError(String(e)));
  }, []);

  const signIn = async () => {
    setError(null);
    try {
      const r = config.mode === "sim" ? await post("/sim/session") : await login();
      setUser(r.user);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const tabs: [Tab, string][] = [["overview", "Business"], ...(config?.mode === "sim" ? ([["lab", "Attack lab"]] as [Tab, string][]) : []), ["market", "Market"], ["money", "Treasury & ledger"], ["settings", "Settings"]];
  const go = (t: Tab) => { setTab(t); setContract(null); };

  return (
    <div className="app">
      <header>
        <div>
          <h1>Veyra</h1>
          <p className="tagline">An autonomous contractor on the NEAR AI Agent Market — it earns, hires, pays, and can't be robbed while doing it.</p>
        </div>
        <div className="row">
          {config && <span className={`pill ${config.mode === "sim" ? "warn" : "good"}`}>{config.mode === "sim" ? "SIMULATOR · play money" : "LIVE · mainnet"}</span>}
          {config?.mode === "live" && (wallet ? <span className="pill">{wallet}</span> : <button onClick={showWalletModal}>Connect wallet</button>)}
          {!user && config && (config.mode === "sim" || wallet) && <button className="primary" onClick={signIn}>{config.mode === "sim" ? "Enter simulator" : "Sign in (NEP-413)"}</button>}
          {user && <span className="pill">{user.accountId}</span>}
          {user && <button onClick={async () => { await post("/auth/logout"); if (config.mode === "live") await disconnect(); setUser(null); }}>Sign out</button>}
        </div>
      </header>
      {error && <pre className="error">{error}</pre>}
      {user ? (
        <>
          <nav>{tabs.map(([k, label]) => <button key={k} className={k === tab && !contract ? "active" : undefined} onClick={() => go(k)}>{label}</button>)}</nav>
          <main>
            {contract ? <ContractPage id={contract} back={() => setContract(null)} /> : (
              <>
                {tab === "overview" && <Overview mode={config.mode} open={setContract} />}
                {tab === "lab" && <LabPage open={setContract} />}
                {tab === "market" && <MarketPage mode={config.mode} />}
                {tab === "money" && <MoneyPage mode={config.mode} />}
                {tab === "settings" && <SettingsPage mode={config.mode} config={config} />}
              </>
            )}
          </main>
        </>
      ) : (
        <p className="note">{config?.mode === "sim" ? "Enter the simulator to run the economy offline — no wallet or keys needed." : "Connect your NEAR wallet and sign in. Veyra never receives your keys."}</p>
      )}
    </div>
  );
}
