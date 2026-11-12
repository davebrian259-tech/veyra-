import { useEffect, useState } from "react";
import type { IconSvgElement } from "@hugeicons/react";
import { Bug01Icon, DashboardSquare01Icon, IdentityCardIcon, Logout01Icon, Radar01Icon, Settings01Icon, Store01Icon, Wallet01Icon } from "@hugeicons/core-free-icons";
import { api, post } from "./api";
import { Icon, Wordmark } from "./brand";
import { login } from "./flows";
import { ContractPage } from "./pages/ContractPage";
import { IdentityPage } from "./pages/IdentityPage";
import { LabPage } from "./pages/LabPage";
import { Landing } from "./pages/Landing";
import { MarketPage } from "./pages/MarketPage";
import { MoneyPage } from "./pages/MoneyPage";
import { Overview } from "./pages/Overview";
import { SettingsPage } from "./pages/SettingsPage";
import { WatchtowerPage } from "./pages/WatchtowerPage";
import { connectedAccount, disconnect, initWallet, onAccountChange, showWalletModal } from "./wallet";

type Tab = "overview" | "watchtower" | "lab" | "market" | "money" | "identity" | "settings";

const PAGES: Record<Tab, { label: string; icon: IconSvgElement; title: string; blurb: string }> = {
  overview: { label: "Business", icon: DashboardSquare01Icon, title: "Business", blurb: "Revenue, payments to agents and margin, with the owner's controls: the mandate and the kill switch." },
  watchtower: { label: "Watchtower", icon: Radar01Icon, title: "Watchtower", blurb: "Payment integrity across the whole Agent Market. Read-only, free, and every verdict is anchored on NEAR." },
  lab: { label: "Attack lab", icon: Bug01Icon, title: "Attack lab", blurb: "Hostile agents try to rob Veyra with real signed cheques. Watch each attempt fail." },
  market: { label: "Market", icon: Store01Icon, title: "Agent Market", blurb: "Browse agents, ask for free quotes and see GUARD's verdict on each one." },
  money: { label: "Treasury & ledger", icon: Wallet01Icon, title: "Treasury & ledger", blurb: "The vault, the spend account, payouts to the owner, and every receipt." },
  identity: { label: "Identity & hiring", icon: IdentityCardIcon, title: "Identity & hiring", blurb: "Veyra's signed credential, and the three ways another agent can hire it." },
  settings: { label: "Settings", icon: Settings01Icon, title: "Settings", blurb: "Integrations, the market connection and the policy vault." },
};

export function App() {
  const [config, setConfig] = useState<any>(null);
  const [wallet, setWallet] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [contract, setContract] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    setBusy(true);
    try {
      if (config?.mode === "live" && !wallet) return showWalletModal();
      const r = config.mode === "sim" ? await post("/sim/session") : await login();
      setUser(r.user);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!user) {
    const label = !config ? "Loading…" : config.mode === "sim" ? "Enter the simulator" : wallet ? "Sign in with NEAR" : "Connect wallet";
    return (
      <>
        {error && <pre className="error toast">{error}</pre>}
        <Landing mode={config?.mode ?? null} cta={signIn} ctaLabel={label} busy={!config || busy} />
      </>
    );
  }

  const tabs = (Object.keys(PAGES) as Tab[]).filter((k) => k !== "lab" || config.mode === "sim");
  const go = (t: Tab) => { setTab(t); setContract(null); };
  const page = PAGES[tab];

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="side-top"><Wordmark size={24} /></div>
        <nav className="side-nav">
          {tabs.map((k) => (
            <button key={k} className={k === tab && !contract ? "on" : ""} onClick={() => go(k)}>
              <Icon icon={PAGES[k].icon} size={18} />
              <span>{PAGES[k].label}</span>
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <span className={`mode ${config.mode}`}><i />{config.mode === "sim" ? "Simulator · play money" : "Live · mainnet"}</span>
          <span className="who mono">{user.accountId}</span>
          <button className="ghost" onClick={async () => { await post("/auth/logout"); if (config.mode === "live") await disconnect(); setUser(null); }}>
            <Icon icon={Logout01Icon} size={16} /> Sign out
          </button>
        </div>
      </aside>
      <main className="content">
        {!contract && (
          <header className="page-head">
            <h1>{page.title}</h1>
            <p>{page.blurb}</p>
          </header>
        )}
        {error && <pre className="error">{error}</pre>}
        {contract ? <ContractPage id={contract} back={() => setContract(null)} /> : (
          <>
            {tab === "overview" && <Overview mode={config.mode} open={setContract} />}
            {tab === "watchtower" && <WatchtowerPage mode={config.mode} />}
            {tab === "lab" && <LabPage open={setContract} />}
            {tab === "market" && <MarketPage mode={config.mode} />}
            {tab === "money" && <MoneyPage mode={config.mode} />}
            {tab === "identity" && <IdentityPage mode={config.mode} />}
            {tab === "settings" && <SettingsPage mode={config.mode} config={config} />}
          </>
        )}
      </main>
    </div>
  );
}
