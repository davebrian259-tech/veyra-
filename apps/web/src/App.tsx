import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { AppShell } from "./shell/AppShell";
import { useSession } from "./shell/session";
import { ErrorNote, Skeleton } from "./ui";

/* Each screen is its own chunk; the landing page is the only one in the first load. */
const Landing = lazy(() => import("./pages/Landing"));
const Overview = lazy(() => import("./pages/Overview"));
const ContractPage = lazy(() => import("./pages/ContractPage"));
const MarketPage = lazy(() => import("./pages/MarketPage"));
const MoneyPage = lazy(() => import("./pages/MoneyPage"));
const WatchtowerPage = lazy(() => import("./pages/WatchtowerPage"));
const AgentPage = lazy(() => import("./pages/AgentPage"));
const LabPage = lazy(() => import("./pages/LabPage"));
const EvidencePage = lazy(() => import("./pages/EvidencePage"));
const IdentityPage = lazy(() => import("./pages/IdentityPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const GameShell = lazy(() => import("./game/GameShell"));
const Lobby = lazy(() => import("./game/Lobby"));
const Arena = lazy(() => import("./game/Arena"));
const RunPage = lazy(() => import("./game/RunPage"));
const Leaderboard = lazy(() => import("./game/Leaderboard"));
const Underwrite = lazy(() => import("./game/Underwrite"));
const HowToPlay = lazy(() => import("./game/HowToPlay"));
const Stats = lazy(() => import("./game/Stats"));
const FastForward = lazy(() => import("./game/FastForward"));

function RequireUser() {
  const { user, ready, error } = useSession();
  const location = useLocation();
  if (!ready) return <div style={{ padding: "var(--s-8)" }}><Skeleton lines={5} height={22} /></div>;
  if (error && !user) return <div style={{ padding: "var(--s-8)" }}><ErrorNote message={`The server did not answer: ${error}. Start it with pnpm dev:server and reload.`} /></div>;
  if (!user) return <Navigate to={`/?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <AppShell />;
}

export function App() {
  return (
    <Suspense fallback={<div style={{ padding: "var(--s-8)" }}><Skeleton lines={5} height={22} /></div>}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/play" element={<GameShell />}>
          <Route index element={<Lobby />} />
          <Route path="vault/:id" element={<Arena />} />
          <Route path="runs/:id" element={<RunPage />} />
          <Route path="leaderboard" element={<Leaderboard />} />
          <Route path="underwrite" element={<Underwrite />} />
          <Route path="learn" element={<HowToPlay />} />
          <Route path="stats" element={<Stats />} />
          <Route path="fast-forward" element={<FastForward />} />
          <Route path="*" element={<Navigate to="/play" replace />} />
        </Route>
        <Route path="/app" element={<RequireUser />}>
          <Route index element={<Overview />} />
          <Route path="contracts/:id" element={<ContractPage />} />
          <Route path="market" element={<MarketPage />} />
          <Route path="treasury" element={<MoneyPage />} />
          <Route path="watchtower" element={<WatchtowerPage />} />
          <Route path="watchtower/:handle" element={<AgentPage />} />
          <Route path="lab" element={<LabPage />} />
          <Route path="evidence" element={<EvidencePage />} />
          <Route path="identity" element={<IdentityPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
