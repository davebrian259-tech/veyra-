import { useState } from "react";
import { api, del, post } from "../api";
import { sendAndRecord } from "../flows";
import { connectedAccount } from "../wallet";
import { Btn, Field, Section, useRunner } from "../ui";

/** BODYGUARD dashboard: blocks, approvals, lists, access keys, audit integrity. */
export function SecurityPage() {
  const r = useRunner();
  const [entry, setEntry] = useState({ kind: "block_destination", value: "", label: "" });

  return (
    <>
      <Section title="Security overview" note="Deterministic rules run before every agent action. An AI recommendation can never override a failed rule.">
        <Btn onClick={() => r.run("Loading", () => api("/bodyguard/summary"))}>Summary</Btn>
        <Btn onClick={() => r.run("Loading", () => api("/bodyguard/enforcement"))}>Who enforces what</Btn>
        <Btn onClick={() => r.run("Verifying", () => api("/audit/verify"))}>Verify audit chain</Btn>
      </Section>

      <Section title="Trusted and blocked destinations">
        <select value={entry.kind} onChange={(e) => setEntry({ ...entry, kind: e.target.value })}>
          <option value="block_destination">Block</option>
          <option value="trusted_destination">Trust</option>
        </select>
        <Field label="Address" value={entry.value} onChange={(v) => setEntry({ ...entry, value: v })} />
        <Field label="Label" value={entry.label} onChange={(v) => setEntry({ ...entry, label: v })} />
        <Btn onClick={() => r.run("Saving", () => post("/bodyguard/lists", entry))}>Add</Btn>
        <Btn onClick={() => r.run("Loading", () => api("/bodyguard/lists"))}>Show lists</Btn>
        <Btn onClick={() => { const id = prompt("Entry id to remove"); if (id) void r.run("Removing", () => del(`/bodyguard/lists/${id}`)); }}>Remove…</Btn>
      </Section>

      <Section title="Access keys (NEAR's approvals)" note="Full-access keys control your account; function-call keys let dApps act for you. Revoke anything you don't recognise.">
        <Btn onClick={() => r.run("Analysing keys", () => api("/bodyguard/access-keys"))}>Analyse my keys</Btn>
        <Btn onClick={() => {
          const pk = prompt("Public key to revoke (ed25519:…)");
          const me = connectedAccount();
          if (pk && me) void r.run("Revoking", () => sendAndRecord([{ receiverId: me, actions: [{ type: "DeleteKey", params: { publicKey: pk } }] }], (h) => post("/wallet/transactions", { txHash: h, kind: "delete_key", receiver: me })));
        }}>Revoke a key…</Btn>
      </Section>
      {r.view}
    </>
  );
}
