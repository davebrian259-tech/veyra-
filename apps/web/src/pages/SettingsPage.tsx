import { useEffect, useState } from "react";
import { api, del, post } from "../api";
import { Section, useRunner } from "../ui";
import { VaultPage } from "./VaultPage";

/** Live-mode setup: connect the Agent Market account and create the policy vault. */
export function SettingsPage({ mode, config }: { mode: "sim" | "live"; config: any }) {
  const r = useRunner();
  const [status, setStatus] = useState<any>(null);
  const [device, setDevice] = useState<any>(null);
  useEffect(() => void api("/contractor/status").then(setStatus), []);
  return (
    <>
      <Section title="Integrations" note="What is live, simulated or not configured on this server.">
        <table>
          <tbody>
            <tr><td>Mode</td><td>{mode === "sim" ? "Simulator — local market, in-memory NEAR ledger, play money" : "Live — market.near.ai, NEAR mainnet"}</td></tr>
            <tr><td>Agent Market (earning)</td><td>{status?.workerConfigured ? "worker listing configured" : "no MARKET_WORKER_TOKEN"}</td></tr>
            <tr><td>Agent Market (job board)</td><td>{mode === "sim" ? "simulated" : status?.marketConnected ? "connected via OAuth" : "not connected"}</td></tr>
            <tr><td>Policy vault</td><td>{config.integrations.agentApiVault.simulated ? "simulated" : config.integrations.agentApiVault.configured ? "Agent API agent configured" : "not configured"}</td></tr>
            <tr><td>NEAR AI Cloud</td><td>{config.integrations.nearAiCloud.configured ? `${config.integrations.nearAiCloud.model} (attested)` : "not configured — deterministic planner"}</td></tr>
            <tr><td>Receipt ledger</td><td>{config.integrations.ledger.simulated ? "simulated chain" : config.integrations.ledger.contractId ?? "not configured"}</td></tr>
          </tbody>
        </table>
      </Section>

      {mode === "live" && (
        <Section title="Connect the Agent Market (job board)" note="One-time approval on market.near.ai (OAuth device flow). Lets Veyra post jobs, negotiate and award from your market balance. Tokens are encrypted on the server.">
          {status?.marketConnected ? (
            <button onClick={() => r.run("Disconnecting", async () => { const x = await del("/market/connect"); setStatus(await api("/contractor/status")); return x; })}>Disconnect</button>
          ) : (
            <>
              <button onClick={() => r.run("Starting", async () => { const d = await post("/market/connect"); setDevice(d); return d; })}>Connect</button>
              {device && <p>Open <a href={device.verificationUriComplete ?? device.verificationUri} target="_blank" rel="noreferrer">{device.verificationUri}</a> and enter <strong className="mono">{device.userCode}</strong>, then
                <button onClick={() => r.run("Checking", async () => { const x = await post("/market/connect/poll"); setStatus(await api("/contractor/status")); return x; })}>I approved it</button></p>}
            </>
          )}
        </Section>
      )}

      {mode === "live" ? <VaultPage /> : <Section title="Policy vault"><p className="note">In the simulator the vault is a simulated policy wallet (25 USDC/day, 5 USDC per withdrawal, destination: the spend account only). In live mode you create a NEAR Intents Agent API agent here and sign its policy with your wallet.</p></Section>}
      {r.view}
    </>
  );
}
