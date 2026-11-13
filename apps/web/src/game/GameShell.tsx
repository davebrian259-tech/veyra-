import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from "react-router";
import { MotionConfig } from "motion/react";
import { Command } from "cmdk";
import { Dialog, Popover, Tooltip } from "radix-ui";
import {
  ArrowRight01Icon, ArrowUpRight01Icon, BookOpen01Icon, Coins01Icon, FastForwardIcon, ChampionIcon, ChartLineData01Icon, CommandIcon, DashboardSquare01Icon, Home01Icon,
  Logout01Icon, SafeIcon, Search01Icon, VolumeHighIcon, VolumeOffIcon, Wallet02Icon,
} from "@hugeicons/core-free-icons";
import { Icon, Mark } from "../brand";
import { Footer } from "../shell/Footer";
import { ThemeToggle } from "../theme";
import { Button, Skeleton } from "../ui";
import { FAUCET_URL } from "./errors";
import { Explain, Kbd, Tip } from "./explain";
import { play } from "./fx";
import { explorerAccount, nearNum, usdc } from "./heist-api";
import { nextQuest, quests } from "./quests";
import { HeistProvider, useHeist } from "./session";
import { startTour } from "./tour";
import "./game.css";

const Inspector = lazy(() => import("./Inspector"));
const PendingEntry = lazy(() => import("./PendingEntry"));

/** The player loop, in order: learn, play, compare, back a vault, read the numbers. */
export const NAV = [
  { to: "/play/learn", label: "How to play", short: "Learn", icon: BookOpen01Icon, key: "h" },
  { to: "/play", label: "Vaults", short: "Vaults", icon: Home01Icon, end: true, key: "v" },
  { to: "/play/leaderboard", label: "Leaderboard", short: "Ranks", icon: ChampionIcon, key: "l" },
  { to: "/play/underwrite", label: "Back a vault", short: "Back", icon: SafeIcon, key: "b" },
  { to: "/play/loot", label: "Loot (NEP-245)", short: "Loot", icon: Coins01Icon, key: "o" },
  { to: "/play/stats", label: "Stats", short: "Stats", icon: ChartLineData01Icon, key: "s", desktopOnly: true },
  { to: "/play/fast-forward", label: "Fast-forward a week", short: "Week", icon: FastForwardIcon, key: "f" },
];

export default function GameShell() {
  return (
    <HeistProvider>
      <Tooltip.Provider>
        <MotionConfig reducedMotion="user">
          <Shell />
        </MotionConfig>
      </Tooltip.Provider>
    </HeistProvider>
  );
}

const typing = (e: KeyboardEvent) => { const t = e.target as HTMLElement | null; return Boolean(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))); };

function Shell() {
  const heist = useHeist();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((o) => !o); return; }
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector("[role=dialog]")) return;
      if (e.key === "?") { e.preventDefault(); setHelp(true); return; }
      if (/^[1-5]$/.test(e.key)) { navigate(`/play/vault/${e.key}`); return; }
      const n = NAV.find((x) => x.key === e.key);
      if (n) navigate(n.to);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  return (
    <div className="arena">
      <a href="#arena-main" className="skip">Skip to content</a>
      <div className="arena-frame">
        <nav className="arena-rail" aria-label="Heist">
          <Link to="/" className="rail-logo" aria-label="Veyra home"><Mark size={28} /></Link>
          {NAV.map((n) => (
            <Tip key={n.to} label={n.label} keys={[n.key.toUpperCase()]}>
              <NavLink to={n.to} end={n.end} className="rail-link" aria-label={n.label}><Icon icon={n.icon} size={22} /></NavLink>
            </Tip>
          ))}
          <div className="rail-spacer" />
          <Tip label="Veyra console: the real agent behind the game"><Link to="/app" className="rail-link" aria-label="Veyra console"><Icon icon={DashboardSquare01Icon} size={22} /></Link></Tip>
        </nav>
        <main id="arena-main" className="arena-main" tabIndex={-1}>
          <TopBar onPalette={() => setPalette(true)} />
          <NextStep />
          <Suspense fallback={null}><PendingEntry /></Suspense>
          <Suspense fallback={<Skeleton lines={6} height={28} />}>
            <Outlet />
          </Suspense>
          <Footer compact />
        </main>
      </div>
      <nav className="arena-bottom" aria-label="Heist">
        {NAV.filter((n) => !("desktopOnly" in n)).map((n) => <NavLink key={n.to} to={n.to} end={n.end}><Icon icon={n.icon} size={22} /><span>{n.short}</span></NavLink>)}
      </nav>
      <Palette open={palette} onOpenChange={setPalette} onHelp={() => { setPalette(false); setHelp(true); }} />
      <Shortcuts open={help} onOpenChange={setHelp} />
      {params.get("player") && <Suspense fallback={null}><Inspector who={params.get("player")!} /></Suspense>}
      {heist.lobby.error && !heist.lobby.data && <div className="sr-only" role="alert">{heist.lobby.error}</div>}
    </div>
  );
}

/** Where am I: the trail. What do I have: climb, play money, NEAR. Plus sound, palette and wallet. */
function TopBar({ onPalette }: { onPalette: () => void }) {
  const heist = useHeist();
  const { me, cracked, acct, account, sound, setSound, network } = heist;
  return (
    <header className="arena-top">
      <Crumbs />
      <div className="top-right">
        <div className="balances" aria-label="Your balances">
          <Explain title="Your climb" what="How many of the five vaults you have cracked. Vault 5 has never been cracked." how="Counted from your heists on this server, plus this browser's record.">
            <span className="bal"><span className="bal-k">Climb</span><b className="mono">{cracked.length}/5</b></span>
          </Explain>
          <Explain title="Winnings" what="Play money your rogue agents have taken in heists. It ranks you on the leaderboard; it is not real money. Real wins pay testnet NEAR and a gold bar (see Loot)." how="The sum of the USDC each of your cracks moved to an account you control on the sealed test chain.">
            <span className="bal"><span className="bal-k">Winnings</span><b className="mono">{usdc(me?.lootAtomic ?? 0)}</b></span>
          </Explain>
          {account && (
            <Explain title={`NEAR ${network} balance`} what="What your connected wallet holds right now. Ranked entry fees and stakes are paid from it." how={<>Read from NEAR every 15 seconds. {acct && acct.stakes.length > 0 && <>You also back {acct.stakes.length} vault{acct.stakes.length > 1 ? "s" : ""}.</>}</>}>
              <span className="bal gold"><span className="bal-k">NEAR</span><b className="mono">{acct ? nearNum(acct.balanceYocto).toFixed(2) : "…"}</b></span>
            </Explain>
          )}
        </div>
        <Tip label={sound ? "Sound on" : "Sound off"}>
          <button type="button" className="btn ghost sm icon" aria-pressed={sound} aria-label="Sound effects" onClick={() => { setSound(!sound); if (!sound) play("unlock", true); }}>
            <Icon icon={sound ? VolumeHighIcon : VolumeOffIcon} size={18} />
          </button>
        </Tip>
        <Tip label="Light or dark"><span><ThemeToggle /></span></Tip>
        <Tip label="Jump to anything" keys={["Ctrl", "K"]}>
          <button type="button" className="btn sm palette-btn" onClick={onPalette} data-tour="palette" aria-label="Open the command palette"><Icon icon={Search01Icon} size={16} /><span className="hide-sm">Search</span><Kbd>⌘K</Kbd></button>
        </Tip>
        <span className="net-chip" title={`Running on NEAR ${network}`}>{network === "testnet" ? "Testnet" : "Mainnet"}</span>
        <WalletButton />
      </div>
    </header>
  );
}

function Crumbs() {
  const { pathname } = useLocation();
  const { lobby } = useHeist();
  const parts = pathname.split("/").filter(Boolean).slice(1);
  const trail: { label: string; to?: string }[] = [{ label: "Heist", to: "/play" }];
  if (parts[0] === "vault") { const v = lobby.data?.vaults.find((x) => x.id === Number(parts[1])); trail.push({ label: "Vaults", to: "/play" }, { label: v ? `Vault ${v.id} · ${v.name}` : `Vault ${parts[1]}` }); }
  else if (parts[0] === "runs") trail.push({ label: "Heists", to: "/play/stats#activity" }, { label: "One heist" });
  else if (parts[0]) trail.push({ label: NAV.find((n) => n.to === `/play/${parts[0]}`)?.label ?? parts[0] });
  else trail.push({ label: "Vaults" });
  return (
    <nav aria-label="Breadcrumb" className="crumbs">
      <ol>
        {trail.map((c, i) => (
          <li key={i}>{c.to && i < trail.length - 1 ? <Link to={c.to}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}</li>
        ))}
      </ol>
    </nav>
  );
}

/** What should I do next: the first objective not done, on every screen. */
function NextStep() {
  const h = useHeist();
  const { pathname, search } = useLocation();
  const q = nextQuest(quests({ lobby: h.lobby.data, me: h.me, cracked: h.cracked, account: h.account, acct: h.acct, rankedEnabled: h.rankedEnabled }));
  if (!q || !h.lobby.data) return null;
  const here = q.action.to && q.action.to.split("?")[0] === pathname && (!q.action.to.includes("?") || search);
  return (
    <div className="next-step" role="note" aria-label="Your next step">
      <span className="ns-k">Next</span>
      <span className="ns-t"><b>{q.title}.</b> <span className="hide-sm">{q.why}</span></span>
      {!here && <QuestAction q={q} small />}
    </div>
  );
}

export function QuestAction({ q, small }: { q: ReturnType<typeof quests>[number]; small?: boolean }) {
  const h = useHeist();
  const cls = `btn ${small ? "sm" : ""} primary`;
  if (q.action.run === "connect") return <button type="button" className={cls} onClick={() => void h.connect()}>{q.action.label}</button>;
  if (q.action.href) return <a className={cls} href={q.action.href} target="_blank" rel="noreferrer">{q.action.label} <Icon icon={ArrowUpRight01Icon} size={14} /></a>;
  return <Link className={cls} to={q.action.to!}>{q.action.label} <Icon icon={ArrowRight01Icon} size={14} /></Link>;
}

function WalletButton() {
  const { account, acct, connect, disconnect, network, rankedEnabled } = useHeist();
  if (!rankedEnabled) return null;
  if (!account) return <Button size="sm" variant="primary" className="wallet-btn" onClick={() => void connect()} data-tour="wallet"><Icon icon={Wallet02Icon} size={16} /> Connect wallet</Button>;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="btn sm wallet-btn" data-tour="wallet" aria-label={`Wallet ${account}`}><Icon icon={Wallet02Icon} size={16} /><span className="mono acct">{account}</span></button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="explain-pop wallet-pop arena-portal" align="end" sideOffset={8}>
          <b className="mono">{account}</b>
          <p>{acct ? `${nearNum(acct.balanceYocto).toFixed(4)} NEAR on ${network}` : "Reading balance…"}</p>
          {acct?.stakes.map((s) => <p key={s.vault} className="small">Backing vault {s.vault}: <span className="mono">{nearNum(s.amountYocto).toFixed(2)}</span> NEAR, earned <span className="mono">{nearNum(s.earnedYocto).toFixed(4)}</span></p>)}
          <div className="btn-row">
            <a className="btn sm" href={explorerAccount(network, account)} target="_blank" rel="noreferrer">NearBlocks <Icon icon={ArrowUpRight01Icon} size={12} /></a>
            {network === "testnet" && <a className="btn sm" href={FAUCET_URL} target="_blank" rel="noreferrer">Faucet <Icon icon={ArrowUpRight01Icon} size={12} /></a>}
            <button type="button" className="btn sm" onClick={() => void disconnect()}><Icon icon={Logout01Icon} size={14} /> Disconnect</button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Ctrl/⌘K: every screen, every vault and the common actions. */
function Palette({ open, onOpenChange, onHelp }: { open: boolean; onOpenChange: (o: boolean) => void; onHelp: () => void }) {
  const navigate = useNavigate();
  const h = useHeist();
  const vaults = h.lobby.data?.vaults ?? [];
  const go = (to: string) => { onOpenChange(false); navigate(to); };
  const act = (fn: () => void) => { onOpenChange(false); fn(); };
  const qs = useMemo(() => quests({ lobby: h.lobby.data, me: h.me, cracked: h.cracked, account: h.account, acct: h.acct, rankedEnabled: h.rankedEnabled }), [h.lobby.data, h.me, h.cracked, h.account, h.acct, h.rankedEnabled]);
  const q = nextQuest(qs);
  return (
    <Command.Dialog open={open} onOpenChange={onOpenChange} label="Jump to" className="palette arena-portal" overlayClassName="sheet-overlay">
      <Command.Input placeholder="Jump to a vault, a screen or an action…" />
      <Command.List>
        <Command.Empty>Nothing matches. Try "vault 3" or "leaderboard".</Command.Empty>
        {q && (
          <Command.Group heading="Next step">
            <Command.Item onSelect={() => act(() => { if (q.action.run === "connect") void h.connect(); else if (q.action.href) window.open(q.action.href, "_blank", "noopener"); else navigate(q.action.to!); })}>{q.title}<span className="cmd-hint">{q.action.label}</span></Command.Item>
          </Command.Group>
        )}
        <Command.Group heading="Vaults">
          {vaults.map((v) => (
            <Command.Item key={v.id} value={`vault ${v.id} ${v.name}`} onSelect={() => go(`/play/vault/${v.id}`)}>
              Vault {v.id} · {v.name}{h.cracked.includes(v.id) && <span className="chip gold">cracked</span>}<span className="cmd-hint"><Kbd>{v.id}</Kbd></span>
            </Command.Item>
          ))}
        </Command.Group>
        <Command.Group heading="Screens">
          {NAV.map((n) => <Command.Item key={n.to} onSelect={() => go(n.to)}>{n.label}<span className="cmd-hint"><Kbd>{n.key.toUpperCase()}</Kbd></span></Command.Item>)}
          <Command.Item onSelect={() => go(`/play?player=${encodeURIComponent(h.account ?? h.progress.callsign)}`)}>Your profile</Command.Item>
          <Command.Item onSelect={() => go("/app")}>Veyra console</Command.Item>
          <Command.Item onSelect={() => go("/")}>Home page</Command.Item>
        </Command.Group>
        <Command.Group heading="Actions">
          {h.rankedEnabled && !h.account && <Command.Item onSelect={() => act(() => void h.connect())}>Connect a NEAR wallet</Command.Item>}
          {h.account && <Command.Item onSelect={() => act(() => void h.disconnect())}>Disconnect {h.account}</Command.Item>}
          {h.network === "testnet" && <Command.Item onSelect={() => act(() => window.open(FAUCET_URL, "_blank", "noopener"))}>Get free testnet NEAR</Command.Item>}
          <Command.Item onSelect={() => act(() => h.setSound(!h.sound))}>Turn sound {h.sound ? "off" : "on"}</Command.Item>
          <Command.Item onSelect={() => act(() => { navigate("/play"); setTimeout(() => void startTour("lobby"), 400); })}>Take the tour</Command.Item>
          <Command.Item onSelect={() => act(onHelp)}>Keyboard shortcuts<span className="cmd-hint"><Kbd>?</Kbd></span></Command.Item>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ["Ctrl", "K"], label: "Jump to anything (⌘K on a Mac)" }, { keys: ["?"], label: "This list" },
  { keys: ["1", "–", "5"], label: "Go to vault 1 to 5" }, { keys: ["V"], label: "Vaults" }, { keys: ["H"], label: "How to play" },
  { keys: ["L"], label: "Leaderboard" }, { keys: ["B"], label: "Back a vault" }, { keys: ["S"], label: "Stats" }, { keys: ["F"], label: "Fast-forward a week" }, { keys: ["O"], label: "Loot" },
  { keys: ["R"], label: "Run the heist (in a vault)" }, { keys: ["Shift", "R"], label: "Ranked heist (in a vault)" }, { keys: ["[", "]"], label: "Previous or next vault" },
];

function Shortcuts({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="sheet-overlay" />
        <Dialog.Content className="dialog arena-portal shortcuts">
          <Dialog.Title asChild><h2><Icon icon={CommandIcon} size={18} /> Keyboard shortcuts</h2></Dialog.Title>
          <Dialog.Description className="small muted">They work anywhere in the game except while you type in a field.</Dialog.Description>
          <dl>
            {SHORTCUTS.map((x) => <div key={x.label}><dt>{x.keys.map((k) => (k === "–" ? <span key={k} className="muted"> to </span> : <Kbd key={k}>{k}</Kbd>))}</dt><dd>{x.label}</dd></div>)}
          </dl>
          <div className="btn-row"><Dialog.Close asChild><Button variant="primary">Got it</Button></Dialog.Close></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
