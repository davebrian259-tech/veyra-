import { useEffect, useState } from "react";
import { api, post, type OwnerIntent } from "../api";
import { decideApproval, signAndSubmitOwnerIntent } from "../flows";
import { Btn, Field, Json, Section, useRunner } from "../ui";

/** Autonomous agent wallet: owner-signed creation, grants, policy, freeze, actions, approvals. */
export function AgentPage() {
  const r = useRunner();
  const [agents, setAgents] = useState<any[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [name, setName] = useState("Veyra agent");
  const [policy, setPolicy] = useState("");
  const [enforcement, setEnforcement] = useState<unknown>();
  const [action, setAction] = useState({ kind: "transfer", asset: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", destinationAsset: "nep141:wrap.near", amount: "5000000", recipient: "", chain: "near", reason: "" });
  const [deposit, setDeposit] = useState({ originAsset: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", amount: "" });
  const [approvals, setApprovals] = useState<any[]>([]);

  const refresh = async () => {
    const a = await api("/agents");
    setAgents(a.agents);
    if (!selected && a.agents[0]) setSelected(a.agents[0].id);
    setApprovals((await api("/approvals")).approvals);
  };
  useEffect(() => {
    void refresh();
    void api("/agents/policy/example").then((p) => { setPolicy(JSON.stringify(p.policy, null, 2)); setEnforcement(p.enforcement); });
  }, []);

  const owner = (label: string, fn: () => Promise<OwnerIntent>) =>
    r.run(label, async () => {
      const out = await fn();
      const res = await signAndSubmitOwnerIntent(out);
      await refresh();
      return res;
    });

  const actionBody = () => {
    const a = action;
    const body =
      a.kind === "swap" ? { kind: "swap", originAsset: a.asset, destinationAsset: a.destinationAsset, amount: a.amount }
      : a.kind === "withdraw" ? { kind: "withdraw", asset: a.asset, amount: a.amount, chain: a.chain, recipient: a.recipient }
      : { kind: "transfer", asset: a.asset, amount: a.amount, recipient: a.recipient };
    return { action: body, reason: a.reason || undefined };
  };

  return (
    <>
      <Section title="Create an agent wallet" note="NEAR Intents Agent API — experimental, mainnet-only beta with real funds. You sign the policy once in your wallet.">
        <Field label="Name" value={name} onChange={setName} />
        <Field label="Policy (Veyra format)" value={policy} onChange={setPolicy} textarea />
        <details><summary>Who enforces what</summary><Json value={enforcement} /></details>
        <Btn onClick={() => owner("Creating agent", () => post("/agents", { name, policy: JSON.parse(policy) }))}>Create agent & sign policy</Btn>
      </Section>

      <Section title="Your agents">
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">—</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.status}{a.local_frozen ? " · FROZEN" : ""}</option>)}
        </select>
        <Btn onClick={() => r.run("Loading agent", () => api(`/agents/${selected}`))} disabled={!selected}>Overview</Btn>
        <Btn onClick={() => owner("Issuing grant", () => post(`/agents/${selected}/grants`, { label: "Veyra backend" }))} disabled={!selected}>Issue grant to Veyra</Btn>
        <Btn onClick={() => owner("Updating policy", () => post(`/agents/${selected}/policy`, { policy: JSON.parse(policy) }))} disabled={!selected}>Apply policy above</Btn>
        <Btn danger disabled={!selected} onClick={() => r.run("Freezing", async () => {
          const res = await post(`/agents/${selected}/freeze`, { reason: "owner emergency freeze" });
          await refresh();
          if (res.intent) return { local: res, api: await signAndSubmitOwnerIntent(res.intent) };
          return res;
        })}>EMERGENCY FREEZE</Btn>
        <Btn onClick={() => owner("Unfreezing", () => post(`/agents/${selected}/unfreeze`))} disabled={!selected}>Unfreeze (sign)</Btn>
      </Section>

      <Section title="Fund the agent" note="Incoming funds need no grant. Send to the deposit address before it expires.">
        <Field label="Asset id" value={deposit.originAsset} onChange={(v) => setDeposit({ ...deposit, originAsset: v })} />
        <Field label="Exact amount (atomic, optional)" value={deposit.amount} onChange={(v) => setDeposit({ ...deposit, amount: v })} />
        <Btn disabled={!selected} onClick={() => r.run("Requesting deposit address", () => post(`/agents/${selected}/deposit`, { originAsset: deposit.originAsset, amount: deposit.amount || undefined }))}>Get deposit address</Btn>
      </Section>

      <Section title="Agent action" note="Every action passes BODYGUARD and the Agent API policy. Simulate shows the verdict without executing.">
        <select value={action.kind} onChange={(e) => setAction({ ...action, kind: e.target.value })}>
          <option value="transfer">transfer (inside NEAR Intents)</option>
          <option value="swap">swap</option>
          <option value="withdraw">withdraw (to a chain)</option>
        </select>
        <Field label="Asset (origin)" value={action.asset} onChange={(v) => setAction({ ...action, asset: v })} />
        {action.kind === "swap" && <Field label="Destination asset" value={action.destinationAsset} onChange={(v) => setAction({ ...action, destinationAsset: v })} />}
        <Field label="Amount (atomic units)" value={action.amount} onChange={(v) => setAction({ ...action, amount: v })} />
        {action.kind !== "swap" && <Field label="Recipient" value={action.recipient} onChange={(v) => setAction({ ...action, recipient: v })} />}
        {action.kind === "withdraw" && <Field label="Chain" value={action.chain} onChange={(v) => setAction({ ...action, chain: v })} />}
        <Field label="Reason (optional)" value={action.reason} onChange={(v) => setAction({ ...action, reason: v })} />
        <Btn disabled={!selected} onClick={() => r.run("Simulating", () => post(`/agents/${selected}/actions/simulate`, actionBody()))}>Simulate</Btn>
        <Btn disabled={!selected} onClick={() => r.run("Executing", async () => { const o = await post(`/agents/${selected}/actions`, actionBody()); await refresh(); return o; })}>Execute</Btn>
      </Section>

      <Section title="Approvals waiting for you" note="Actions above your approval threshold, or flagged as unusual, wait for your signed decision.">
        {approvals.filter((a) => a.status === "pending").map((a) => (
          <div key={a.id} className="row">
            <span>{a.kind} · ${Number(a.usd_value ?? 0).toFixed(2)} · {a.reason}</span>
            <Btn onClick={() => r.run("Approving", async () => { const x = await decideApproval(a.id, "approve"); await refresh(); return x; })}>Approve (sign)</Btn>
            <Btn danger onClick={() => r.run("Rejecting", async () => { const x = await decideApproval(a.id, "reject"); await refresh(); return x; })}>Reject</Btn>
          </div>
        ))}
        {!approvals.some((a) => a.status === "pending") && <p className="note">None.</p>}
      </Section>
      {r.view}
    </>
  );
}
