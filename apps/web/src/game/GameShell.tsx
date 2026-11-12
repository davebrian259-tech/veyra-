import { Suspense, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { MotionConfig } from "motion/react";
import { ChampionIcon, DashboardSquare01Icon, Home01Icon, SafeIcon, Wallet02Icon } from "@hugeicons/core-free-icons";
import { Icon, Mark } from "../brand";
import { useApi } from "../lib/data";
import { Button, Skeleton, useToast } from "../ui";
import { PoweredByNear } from "./art";
import { heistWallet, loadProgress, type Lobby } from "./heist-api";
import "./game.css";

const NAV = [
  { to: "/play", label: "Vaults", icon: Home01Icon, end: true },
  { to: "/play/leaderboard", label: "Ranks", icon: ChampionIcon },
  { to: "/play/underwrite", label: "Back a vault", icon: SafeIcon },
];

/** The arena: a slim rail on desktop, a bottom bar on phones, and the wallet up top. */
export default function GameShell() {
  const lobby = useApi<Lobby>("/heist", { every: 15_000 });
  const location = useLocation();
  const [progress] = useState(loadProgress);
  useEffect(() => { document.title = "Veyra Heist · take the pot"; }, []);
  return (
    <MotionConfig reducedMotion="user">
      <div className="arena">
        <a href="#arena-main" className="skip">Skip to content</a>
        <div className="arena-frame">
          <nav className="arena-rail" aria-label="Heist">
            <Link to="/" className="rail-logo" aria-label="Veyra home"><Mark size={28} /></Link>
            {NAV.map((n) => <NavLink key={n.to} to={n.to} end={n.end} className="rail-link" aria-label={n.label} title={n.label}><Icon icon={n.icon} size={22} /></NavLink>)}
            <div className="rail-spacer" />
            <Link to="/app" className="rail-link" aria-label="Veyra console" title="Veyra console"><Icon icon={DashboardSquare01Icon} size={22} /></Link>
          </nav>
          <main id="arena-main" className="arena-main" tabIndex={-1}>
            <div className="arena-top">
              <h1>{location.pathname === "/play" ? <>Good luck, <em>{progress.callsign}</em></> : <Link to="/play" style={{ textDecoration: "none" }}>Veyra <em>Heist</em></Link>}</h1>
              <div className="top-right">
                <PoweredByNear network={lobby.data?.ranked.network ?? "testnet"} />
                {lobby.data?.ranked.enabled && <WalletButton network={lobby.data.ranked.network} />}
              </div>
            </div>
            <Suspense fallback={<Skeleton lines={6} height={28} />}>
              <Outlet context={lobby} />
            </Suspense>
          </main>
        </div>
        <nav className="arena-bottom" aria-label="Heist">
          {NAV.map((n) => <NavLink key={n.to} to={n.to} end={n.end}><Icon icon={n.icon} size={22} /><span>{n.label}</span></NavLink>)}
          <Link to="/app"><Icon icon={DashboardSquare01Icon} size={22} /><span>Console</span></Link>
        </nav>
      </div>
    </MotionConfig>
  );
}

/** Connects a NEAR wallet for ranked runs and backing vaults. Loaded only when pressed. */
export function WalletButton({ network }: { network: "testnet" | "mainnet" }) {
  const [account, setAccount] = useState<string | null>(null);
  const toast = useToast();
  // The wallet bundle is large: load it only for visitors who connected before, or on click.
  const [wanted, setWanted] = useState(() => { try { return Boolean(localStorage.getItem("near-wallet-selector:selectedWalletId")); } catch { return false; } });
  useEffect(() => {
    if (!wanted) return;
    let unsub: { unsubscribe(): void } | undefined;
    void heistWallet(network).then((w) => { setAccount(w.connectedAccount()); unsub = w.onAccountChange(setAccount) as typeof unsub; }).catch(() => undefined);
    return () => unsub?.unsubscribe();
  }, [network, wanted]);
  if (account) {
    return (
      <Button size="sm" className="wallet-btn" onClick={async () => { const w = await heistWallet(network); await w.disconnect(); setAccount(null); toast.show("Wallet disconnected."); }} title="Disconnect">
        <Icon icon={Wallet02Icon} size={16} /> <span className="mono" style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis" }}>{account}</span>
      </Button>
    );
  }
  return <Button size="sm" variant="primary" className="wallet-btn" onClick={async () => { setWanted(true); (await heistWallet(network)).showWalletModal(); }}><Icon icon={Wallet02Icon} size={16} /> Connect wallet</Button>;
}
