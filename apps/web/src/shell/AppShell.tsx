import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { Command } from "cmdk";
import { ArrowLeft01Icon, Logout01Icon, Menu01Icon, Notification01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { Icon, Wordmark } from "../brand";
import { prefetch, useApi } from "../lib/data";
import { post } from "../api";
import { Button, Skeleton } from "../ui";
import { DESTINATIONS, GROUPS, destinationFor, type Destination } from "./nav";
import { useSession } from "./session";

/** Desktop: sidebar. Phone: bottom bar with five destinations and a "more" sheet. Both: ⌘K. */
export function AppShell() {
  const { config, user, signOut } = useSession();
  const location = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const visible = useMemo(() => DESTINATIONS.filter((d) => !d.simOnly || config?.mode === "sim"), [config?.mode]);
  const here = destinationFor(location.pathname);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen((o) => !o); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { setMoreOpen(false); }, [location.pathname]);
  useEffect(() => { document.title = `${here.label} · Veyra`; }, [here.label]);

  return (
    <div className="shell">
      <a href="#main" className="skip">Skip to content</a>
      <aside className="sidebar" aria-label="Primary">
        <div className="side-top">
          <Link to="/" className="wordmark" aria-label="Veyra home"><Wordmark size={24} /></Link>
          <Button icon variant="ghost" size="sm" aria-label="Search and commands (Ctrl K)" onClick={() => setPaletteOpen(true)}><Icon icon={Search01Icon} size={18} /></Button>
        </div>
        <nav className="side-nav" aria-label="Sections">
          {(["run", "trust", "setup"] as const).map((g) => (
            <div key={g}>
              <div className="side-group">{GROUPS[g]}</div>
              {visible.filter((d) => d.group === g).map((d) => <DestLink key={d.path} d={d} />)}
            </div>
          ))}
        </nav>
        <div className="side-foot">
          <span className={`mode ${config?.mode ?? ""}`}><i aria-hidden="true" />{config?.mode === "sim" ? "Simulator · play money" : "Live · NEAR mainnet"}</span>
          <span className="who" title={user?.accountId}>{user?.accountId}</span>
          <Button variant="ghost" size="sm" onClick={signOut} style={{ justifyContent: "flex-start", paddingLeft: 0 }}><Icon icon={Logout01Icon} size={16} /> Sign out</Button>
        </div>
      </aside>

      <main id="main" className="content" tabIndex={-1}>
        <TopBar onPalette={() => setPaletteOpen(true)} />
        <Suspense fallback={<Skeleton lines={6} height={22} />}>
          <Outlet />
        </Suspense>
      </main>

      <nav className="bottom-nav" aria-label="Primary">
        {visible.filter((d) => d.bottom).map((d) => (
          <NavLink key={d.path} to={d.path} end={d.path === "/app"} onMouseEnter={() => d.prefetch.forEach(prefetch)}>
            <Icon icon={d.icon} size={22} /><span>{d.short}</span>
          </NavLink>
        ))}
        <button type="button" onClick={() => setMoreOpen(true)} aria-haspopup="dialog" aria-expanded={moreOpen}><Icon icon={Menu01Icon} size={22} /><span>More</span></button>
      </nav>
      {moreOpen && <MoreSheet items={visible} onClose={() => setMoreOpen(false)} />}
      {paletteOpen && <Palette items={visible} onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}

function DestLink({ d }: { d: Destination }) {
  return (
    <NavLink to={d.path} end={d.path === "/app"} onMouseEnter={() => d.prefetch.forEach(prefetch)} onFocus={() => d.prefetch.forEach(prefetch)}>
      <Icon icon={d.icon} size={18} /><span>{d.label}</span>
    </NavLink>
  );
}

/** Breadcrumb or back link, the page title on phones, notifications, and the palette button. */
function TopBar({ onPalette }: { onPalette: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const here = destinationFor(location.pathname);
  const deep = location.pathname !== here.path;
  const notes = useApi<{ notifications: { id: string; title: string; body: string; read: number; created_at: string }[] }>("/notifications", { every: 15_000 });
  const unread = notes.data?.notifications.filter((n) => !n.read).length ?? 0;
  return (
    <div className="topbar">
      <div className="topbar-left">
        {deep ? (
          <nav className="crumbs" aria-label="Breadcrumb">
            <Button variant="ghost" size="sm" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate(here.path))} aria-label="Back"><Icon icon={ArrowLeft01Icon} size={18} /></Button>
            <Link to={here.path}>{here.label}</Link><span aria-hidden="true">/</span><span>{crumbLabel(location.pathname)}</span>
          </nav>
        ) : (
          <div className="page-head" style={{ margin: 0 }}>
            <div><h1>{here.label}</h1><p>{here.blurb}</p></div>
          </div>
        )}
      </div>
      <div className="btn-row" style={{ flexWrap: "nowrap" }}>
        <Link to="/app/settings#notifications" className="btn ghost sm icon" aria-label={unread ? `${unread} unread notifications` : "Notifications"} style={{ position: "relative" }}>
          <Icon icon={Notification01Icon} size={18} />
          {unread > 0 && <span aria-hidden="true" style={{ position: "absolute", top: 6, right: 6, width: 8, height: 8, borderRadius: 8, background: "var(--accent)" }} />}
        </Link>
        <Button variant="ghost" size="sm" onClick={onPalette} aria-label="Search and commands"><Icon icon={Search01Icon} size={18} /><span className="kbd" aria-hidden="true">⌘K</span></Button>
      </div>
    </div>
  );
}

function crumbLabel(pathname: string) {
  const last = pathname.split("/").filter(Boolean).pop() ?? "";
  if (last.startsWith("ctr_")) return `Contract ${last.slice(4, 10)}`;
  if (pathname.includes("/watchtower/")) return decodeURIComponent(last);
  return last.replace(/-/g, " ");
}

function MoreSheet({ items, onClose }: { items: Destination[]; onClose: () => void }) {
  const { signOut, user, config } = useSession();
  return (
    <>
      <div className="dialog-overlay" onClick={onClose} />
      <div className="dialog" role="dialog" aria-modal="true" aria-label="More sections" style={{ top: "auto", bottom: "calc(var(--bottom-nav) + env(safe-area-inset-bottom) + 8px)", transform: "translateX(-50%)", padding: "var(--s-3)" }}>
        <nav className="side-nav" aria-label="All sections">
          {items.map((d) => <DestLink key={d.path} d={d} />)}
        </nav>
        <div className="side-foot">
          <span className={`mode ${config?.mode ?? ""}`}><i aria-hidden="true" />{config?.mode === "sim" ? "Simulator" : "Live"}</span>
          <span className="who">{user?.accountId}</span>
          <Button variant="ghost" size="sm" onClick={signOut} style={{ justifyContent: "flex-start", paddingLeft: 0 }}><Icon icon={Logout01Icon} size={16} /> Sign out</Button>
        </div>
      </div>
    </>
  );
}

/** ⌘K: every destination, deep actions, and a jump to any contract or agent handle. */
function Palette({ items, onClose }: { items: Destination[]; onClose: () => void }) {
  const navigate = useNavigate();
  const { signOut } = useSession();
  const contracts = useApi<{ contracts: { id: string; title: string; status: string }[] }>("/contracts");
  const [q, setQ] = useState("");
  const go = (to: string) => { navigate(to); onClose(); };
  const act = async (fn: () => Promise<unknown>, then?: string) => { onClose(); await fn().catch(() => undefined); if (then) navigate(then); };
  return (
    <>
      <div className="palette-overlay" onClick={onClose} />
      <Command label="Search and commands" className="palette" loop>
        <Command.Input value={q} onValueChange={setQ} placeholder="Go to, run, or find…" autoFocus />
        <Command.List>
          <Command.Empty>Nothing matches. Try a section name, an action, or a contract title.</Command.Empty>
          <Command.Group heading="Go to">
            {items.map((d) => <Command.Item key={d.path} value={`${d.label} ${d.blurb}`} onSelect={() => go(d.path)}><Icon icon={d.icon} size={16} />{d.label}</Command.Item>)}
            <Command.Item value="landing page home" onSelect={() => go("/")}>Landing page</Command.Item>
          </Command.Group>
          <Command.Group heading="Do">
            <Command.Item value="hire veyra new contract job" onSelect={() => go("/app#hire")}>Hire Veyra for a job</Command.Item>
            <Command.Item value="run watchtower scan market audit" onSelect={() => act(() => post("/watchtower/scan", {}), "/app/watchtower")}>Run a Watchtower scan</Command.Item>
            <Command.Item value="pay out margin owner" onSelect={() => act(() => post("/treasury/payout"), "/app/treasury")}>Pay out margin to the owner</Command.Item>
            <Command.Item value="freeze veyra kill switch stop" onSelect={() => act(() => post("/contractor/freeze", { frozen: true }), "/app")}>Freeze Veyra (kill switch)</Command.Item>
            <Command.Item value="unfreeze veyra resume" onSelect={() => act(() => post("/contractor/freeze", { frozen: false }), "/app")}>Unfreeze Veyra</Command.Item>
            <Command.Item value="estimate price a job quotes" onSelect={() => go("/app/identity#estimate")}>Estimate a job (free quotes)</Command.Item>
            <Command.Item value="verify receipt proof" onSelect={() => go("/app/evidence#verify")}>Verify a receipt</Command.Item>
            <Command.Item value="check agent before paying watchtower" onSelect={() => go(`/app/watchtower/${encodeURIComponent(q.trim() || "payee-swapper")}`)}>Check an agent{q.trim() ? `: ${q.trim()}` : ""}</Command.Item>
            <Command.Item value="sign out log out" onSelect={() => { onClose(); void signOut(); }}>Sign out</Command.Item>
          </Command.Group>
          {contracts.data?.contracts.length ? (
            <Command.Group heading="Contracts">
              {contracts.data.contracts.slice(0, 20).map((c) => <Command.Item key={c.id} value={`${c.title} ${c.id}`} onSelect={() => go(`/app/contracts/${c.id}`)}>{c.title}<span className="hint">{c.status}</span></Command.Item>)}
            </Command.Group>
          ) : null}
        </Command.List>
      </Command>
    </>
  );
}

export function PageIntro({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div><h1>{title}</h1>{children && <p>{children}</p>}</div>
      {actions && <div className="btn-row">{actions}</div>}
    </div>
  );
}
