import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { api, del, post } from "../api";
import { invalidate, useApi, when } from "../lib/data";
import { useSession } from "../shell/session";
import { Button, Card, Empty, ErrorNote, Json, Pill, Skeleton, statusTone, useAction } from "../ui";
import { VaultPage } from "./VaultPage";

/** Integrations, the market connection, the policy vault, notifications, and the audit log. */
export default function SettingsPage() {
  const { config } = useSession();
  const mode = config!.mode;
  const status = useApi<any>("/contractor/status", { every: 10_000 });
  const location = useLocation();
  useEffect(() => { if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: "smooth" }); }, [location.hash]);
  const i = config!.integrations;
  return (
    <div className="stack">
      <Card title="Integrations" note="What is live, what is simulated, and what is not configured on this server.">
        <div className="table-wrap">
          <table>
            <tbody>
              <tr><td>Mode</td><td>{mode === "sim" ? "Simulator: a local market, an in-memory NEAR ledger and play money" : "Live: market.near.ai and NEAR mainnet"}</td></tr>
              <tr><td>Agent Market (earning)</td><td>{status.data?.workerConfigured ? <Pill tone="good">worker listing configured</Pill> : <Pill>no MARKET_WORKER_TOKEN</Pill>}</td></tr>
              <tr><td>Agent Market (job board)</td><td>{mode === "sim" ? <Pill tone="warn">simulated</Pill> : status.data?.marketConnected ? <Pill tone="good">connected</Pill> : <Pill>not connected</Pill>}</td></tr>
              <tr><td>Policy vault</td><td>{i.agentApiVault.simulated ? <Pill tone="warn">simulated</Pill> : i.agentApiVault.configured ? <Pill tone="good">Agent API agent configured</Pill> : <Pill>not configured</Pill>}</td></tr>
              <tr><td>NEAR AI Cloud</td><td>{i.nearAiCloud.configured ? <Pill tone="good">{i.nearAiCloud.model} (attested)</Pill> : <Pill>not configured; deterministic planner</Pill>}</td></tr>
              <tr><td>Receipt ledger</td><td>{i.ledger.simulated ? <Pill tone="warn">simulated chain</Pill> : i.ledger.contractId ? <Pill tone="good">{i.ledger.contractId} ({i.ledger.network})</Pill> : <Pill>not configured</Pill>}</td></tr>
              <tr><td>Scheduler</td><td className="small">{status.data?.scheduler ? `last run ${when(status.data.scheduler.at)}${status.data.scheduler.errors.length ? ` · ${status.data.scheduler.errors.length} error(s)` : ""}` : "—"}</td></tr>
            </tbody>
          </table>
        </div>
      </Card>

      {mode === "live" && <MarketConnect connected={Boolean(status.data?.marketConnected)} onChange={status.reload} />}

      <div id="vault">
        {mode === "live" ? <VaultPage /> : (
          <Card title="Policy vault" note="In the simulator the vault is a simulated policy wallet: 25 USDC a day, 5 USDC per withdrawal, and the spend account as the only destination. In live mode you create a NEAR Intents Agent API agent here and sign its policy with your wallet." children={null} />
        )}
      </div>

      <Notifications />
      <AuditLog />
    </div>
  );
}

function MarketConnect({ connected, onChange }: { connected: boolean; onChange: () => void }) {
  const { run, busy } = useAction();
  const [device, setDevice] = useState<any>(null);
  return (
    <Card title="Connect the Agent Market job board" note="A one-time approval on market.near.ai (OAuth device flow). It lets Veyra post jobs, negotiate and award them from your market balance. Tokens are encrypted on the server.">
      {connected ? (
        <Button variant="danger" loading={busy === "dc"} onClick={() => run("dc", async () => { await del("/market/connect"); invalidate("/contractor/status"); onChange(); }, { success: "Disconnected from the market." })}>Disconnect</Button>
      ) : (
        <div className="stack">
          <div className="btn-row"><Button variant="primary" loading={busy === "start"} onClick={() => run("start", async () => setDevice(await post("/market/connect")))}>Connect</Button></div>
          {device && (
            <div className="alert">
              <div>Open <a href={device.verificationUriComplete ?? device.verificationUri} target="_blank" rel="noreferrer">{device.verificationUri}</a> and enter <strong className="mono">{device.userCode}</strong>. Then come back and press the button.
                <div className="btn-row" style={{ marginTop: "var(--s-2)" }}><Button size="sm" loading={busy === "poll"} onClick={() => run("poll", async () => { await post("/market/connect/poll"); invalidate("/contractor/status"); onChange(); }, { success: "Connected to the market." })}>I approved it</Button></div>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function Notifications() {
  const n = useApi<{ notifications: any[] }>("/notifications", { every: 15_000 });
  const { run, busy } = useAction();
  const items = n.data?.notifications ?? [];
  const unread = items.filter((x) => !x.read);
  return (
    <Card title="Notifications" note="What Veyra wanted you to know: deliveries, blocked attacks, approvals, failures." actions={unread.length ? <Button size="sm" loading={busy === "read"} onClick={() => run("read", async () => { await post("/notifications/read", { ids: unread.map((x) => x.id) }); invalidate("/notifications"); await n.reload(); })}>Mark all read</Button> : undefined}>
      <div id="notifications">
        {n.loading && !n.data && <Skeleton lines={3} />}
        {n.error && <ErrorNote message={n.error} retry={n.reload} />}
        {n.data && !items.length && <Empty title="Nothing yet">Deliveries and blocked attacks show up here.</Empty>}
        {items.length > 0 && (
          <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {items.slice(0, 30).map((x) => (
              <li key={x.id} className="alert" style={{ opacity: x.read ? 0.7 : 1 }}>
                <div style={{ flex: 1 }}><strong>{x.title}</strong><div className="small">{x.body}</div><div className="small muted">{when(x.created_at)}</div></div>
                {!x.read && <Pill tone="accent">new</Pill>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function AuditLog() {
  const a = useApi<{ entries: any[] }>("/audit?limit=50");
  const [verify, setVerify] = useState<any>(undefined);
  const { run, busy } = useAction();
  const rows = a.data?.entries ?? (a.data as any)?.audit ?? [];
  return (
    <Card title="Audit log" note="Every action Veyra or its owner took, in a hash chain. Verify checks that no entry was altered or removed." actions={<Button size="sm" loading={busy === "v"} onClick={() => run("v", async () => setVerify(await api("/audit/verify")))}>Verify chain</Button>}>
      <div id="audit">
        {verify !== undefined && <div className={`alert ${verify.ok || verify.valid ? "good" : "bad"}`} style={{ marginBottom: "var(--s-3)" }}>{verify.ok || verify.valid ? `Chain intact: ${verify.count ?? verify.entries ?? rows.length} entries.` : "The chain is broken. Treat the log as tampered."}</div>}
        {a.loading && !a.data && <Skeleton lines={4} />}
        {a.error && <ErrorNote message={a.error} retry={a.reload} />}
        {a.data && !rows.length && <Empty title="No entries yet" />}
        {rows.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Subject</th></tr></thead>
              <tbody>{rows.map((e: any) => <tr key={e.id ?? e.seq}><td className="small">{when(e.created_at ?? e.at)}</td><td>{e.actor}</td><td className="mono small">{e.action}</td><td className="mono small">{e.subject ?? ""}</td></tr>)}</tbody>
            </table>
          </div>
        )}
        {a.data && <details className="disclosure" style={{ marginTop: "var(--s-3)" }}><summary>Raw</summary><Json value={a.data} /></details>}
      </div>
    </Card>
  );
}

export { statusTone };
