import { useEffect, useState } from "react";
import { api, post, type OwnerIntent } from "../api";
import { decideApproval, signAndSubmitOwnerIntent } from "../flows";
import { useApi, invalidate } from "../lib/data";
import { Button, Card, Empty, Field, Json, Select, useAction } from "../ui";

/** The NEAR Intents Agent API vault: owner-signed creation, grants, policy, freeze, actions, approvals. Live mode only. */
export function VaultPage() {
  const { run, busy } = useAction();
  const agents = useApi<{ agents: any[] }>("/agents");
  const approvals = useApi<{ approvals: any[] }>("/approvals", { every: 10_000 });
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("Veyra agent");
  const [policy, setPolicy] = useState("");
  const [enforcement, setEnforcement] = useState<unknown>();
  const [out, setOut] = useState<unknown>();
  const [action, setAction] = useState({ kind: "transfer", asset: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", destinationAsset: "nep141:wrap.near", amount: "5000000", recipient: "", chain: "near", reason: "" });
  const [deposit, setDeposit] = useState({ originAsset: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", amount: "" });

  useEffect(() => {
    if (!selected && agents.data?.agents[0]) setSelected(agents.data.agents[0].id);
  }, [agents.data, selected]);
  useEffect(() => {
    void api("/agents/policy/example").then((p) => setEnforcement(p.enforcement)).catch(() => undefined);
    void api("/vault/recommended-policy").then((p) => setPolicy(JSON.stringify(p.policy, null, 2))).catch(() => undefined);
  }, []);
  const refresh = async () => { invalidate("/agents"); invalidate("/approvals"); await Promise.all([agents.reload(), approvals.reload()]); };
  const owner = (label: string, fn: () => Promise<OwnerIntent>) => run(label, async () => { const o = await fn(); const res = await signAndSubmitOwnerIntent(o); await refresh(); setOut(res); });
  const policyJson = () => { try { return JSON.parse(policy); } catch { throw new Error("The policy is not valid JSON. Fix it and try again."); } };
  const actionBody = () => {
    const a = action;
    const body = a.kind === "swap" ? { kind: "swap", originAsset: a.asset, destinationAsset: a.destinationAsset, amount: a.amount }
      : a.kind === "withdraw" ? { kind: "withdraw", asset: a.asset, amount: a.amount, chain: a.chain, recipient: a.recipient }
      : { kind: "transfer", asset: a.asset, amount: a.amount, recipient: a.recipient };
    return { action: body, reason: a.reason || undefined };
  };
  const pending = (approvals.data?.approvals ?? []).filter((a) => a.status === "pending");
  const sel = Boolean(selected);

  return (
    <div className="stack">
      <Card title="Policy vault (NEAR Intents Agent API)" note="The vault holds Veyra's budget. You sign its policy once in your wallet; it may only pay Veyra's spend account. Experimental mainnet beta, or the demo API with a demo key.">
        <div className="stack">
          <Field label="Agent name" value={name} onChange={setName} />
          <Field label="Policy (Veyra format)" value={policy} onChange={setPolicy} textarea rows={8} hint="Recommended for Veyra. Edit before signing if you want different limits." />
          <details className="disclosure"><summary>Who enforces what</summary><Json value={enforcement} /></details>
          <div className="btn-row"><Button variant="primary" loading={busy === "create"} onClick={() => owner("create", () => post("/agents", { name, policy: policyJson() }))}>Create agent and sign policy</Button></div>
        </div>
      </Card>

      <Card title="Your agents" note="Pick one to manage. Every change below is signed in your wallet.">
        {agents.data && !agents.data.agents.length ? <Empty title="No agent yet">Create one above. It takes one wallet signature.</Empty> : (
          <div className="stack">
            <Select label="Agent" value={selected} onChange={setSelected}>
              <option value="">Choose an agent</option>
              {(agents.data?.agents ?? []).map((a) => <option key={a.id} value={a.id}>{a.name} · {a.status}{a.local_frozen ? " · frozen" : ""}</option>)}
            </Select>
            <div className="btn-row">
              <Button disabled={!sel} loading={busy === "load"} onClick={() => run("load", async () => setOut(await api(`/agents/${selected}`)))}>Show details</Button>
              <Button disabled={!sel} loading={busy === "grant"} onClick={() => owner("grant", () => post(`/agents/${selected}/grants`, { label: "Veyra backend" }))}>Issue grant to Veyra</Button>
              <Button disabled={!sel} loading={busy === "policy"} onClick={() => owner("policy", () => post(`/agents/${selected}/policy`, { policy: policyJson() }))}>Apply the policy above</Button>
              <Button variant="danger" disabled={!sel} loading={busy === "freeze"} onClick={() => run("freeze", async () => { const res = await post(`/agents/${selected}/freeze`, { reason: "owner emergency freeze" }); await refresh(); setOut(res.intent ? { local: res, api: await signAndSubmitOwnerIntent(res.intent) } : res); })}>Emergency freeze</Button>
              <Button disabled={!sel} loading={busy === "unfreeze"} onClick={() => owner("unfreeze", () => post(`/agents/${selected}/unfreeze`))}>Unfreeze (sign)</Button>
            </div>
          </div>
        )}
      </Card>

      <div className="grid-2">
        <Card title="Fund the agent" note="Incoming funds need no grant. Send to the deposit address before it expires.">
          <div className="stack">
            <Field label="Asset id" value={deposit.originAsset} onChange={(v) => setDeposit({ ...deposit, originAsset: v })} />
            <Field label="Exact amount (atomic units, optional)" value={deposit.amount} onChange={(v) => setDeposit({ ...deposit, amount: v })} inputMode="numeric" />
            <div className="btn-row"><Button disabled={!sel} loading={busy === "dep"} onClick={() => run("dep", async () => setOut(await post(`/agents/${selected}/deposit`, { originAsset: deposit.originAsset, amount: deposit.amount || undefined })))}>Get deposit address</Button></div>
          </div>
        </Card>
        <Card title="Agent action" note="Every action passes BODYGUARD and the Agent API policy. Simulate shows the verdict without executing anything.">
          <div className="stack">
            <Select label="Kind" value={action.kind} onChange={(v) => setAction({ ...action, kind: v })}>
              <option value="transfer">transfer (inside NEAR Intents)</option>
              <option value="swap">swap</option>
              <option value="withdraw">withdraw (to a chain)</option>
            </Select>
            <Field label="Asset (origin)" value={action.asset} onChange={(v) => setAction({ ...action, asset: v })} />
            {action.kind === "swap" && <Field label="Destination asset" value={action.destinationAsset} onChange={(v) => setAction({ ...action, destinationAsset: v })} />}
            <Field label="Amount (atomic units)" value={action.amount} onChange={(v) => setAction({ ...action, amount: v })} inputMode="numeric" />
            {action.kind !== "swap" && <Field label="Recipient" value={action.recipient} onChange={(v) => setAction({ ...action, recipient: v })} />}
            {action.kind === "withdraw" && <Field label="Chain" value={action.chain} onChange={(v) => setAction({ ...action, chain: v })} />}
            <Field label="Reason (optional)" value={action.reason} onChange={(v) => setAction({ ...action, reason: v })} />
            <div className="btn-row">
              <Button disabled={!sel} loading={busy === "sim"} onClick={() => run("sim", async () => setOut(await post(`/agents/${selected}/actions/simulate`, actionBody())))}>Simulate</Button>
              <Button variant="primary" disabled={!sel} loading={busy === "exec"} onClick={() => run("exec", async () => { setOut(await post(`/agents/${selected}/actions`, actionBody())); await refresh(); })}>Execute</Button>
            </div>
          </div>
        </Card>
      </div>

      <Card title="Approvals waiting for you" note="Actions above your approval threshold, or flagged as unusual, wait for your signed decision.">
        {pending.length ? pending.map((a) => (
          <div key={a.id} className="btn-row" style={{ justifyContent: "space-between", padding: "var(--s-2) 0", borderBottom: "1px solid var(--line)" }}>
            <span className="small">{a.kind} · ${Number(a.usd_value ?? 0).toFixed(2)} · {a.reason}</span>
            <span className="btn-row">
              <Button size="sm" variant="primary" loading={busy === `ap-${a.id}`} onClick={() => run(`ap-${a.id}`, async () => { setOut(await decideApproval(a.id, "approve")); await refresh(); })}>Approve and sign</Button>
              <Button size="sm" variant="danger" loading={busy === `rj-${a.id}`} onClick={() => run(`rj-${a.id}`, async () => { setOut(await decideApproval(a.id, "reject")); await refresh(); })}>Reject</Button>
            </span>
          </div>
        )) : <Empty title="Nothing waiting">Approvals appear here when an action needs your signature.</Empty>}
      </Card>
      {out !== undefined && <Card title="Last result" actions={<Button size="sm" variant="ghost" onClick={() => setOut(undefined)}>Clear</Button>}><Json value={out} /></Card>}
    </div>
  );
}
