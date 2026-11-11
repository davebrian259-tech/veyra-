import { useEffect, useState } from "react";
import { api, post } from "../api";
import { sendAndRecord, uploadEvidence } from "../flows";
import { Btn, Field, Section, toYocto, useRunner } from "../ui";

/** UNDO: protected payments. Every state change is signed by a party's own wallet. */
export function EscrowPage() {
  const r = useRunner();
  const [escrows, setEscrows] = useState<any[]>([]);
  const [sel, setSel] = useState("");
  const [idx, setIdx] = useState("0");
  const [reason, setReason] = useState("");
  const [providerAmount, setProviderAmount] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({ provider: "", amountUsd: "", totalNear: "", milestones: "Design:50,Build:50", days: "14", reviewer: "", arbiter: "" });

  const load = async () => setEscrows((await api("/escrows")).escrows);
  useEffect(() => void load(), []);

  const act = (action: string, extra: Record<string, unknown> = {}) =>
    r.run(`Preparing ${action}`, async () => {
      const prep = await post(`/escrows/${sel}/actions/${action}`, { milestoneIndex: Number(idx), reason: reason || undefined, providerAmount: providerAmount || undefined, ...extra });
      const sent = await sendAndRecord(prep.walletTransactions, (h) => post(`/escrows/${sel}/tx`, { action, txHash: h }));
      await load();
      return sent;
    });

  return (
    <>
      <Section title="New protected payment" note="Funds are held by the veyra-escrow contract and released only when you (or your reviewer) accept submitted evidence. A completed transfer cannot be reversed.">
        <Field label="Provider account" value={form.provider} onChange={(v) => setForm({ ...form, provider: v })} />
        <Field label="Amount in USD (converted to NEAR)" value={form.amountUsd} onChange={(v) => setForm({ ...form, amountUsd: v })} />
        <Field label="…or exact amount in NEAR" value={form.totalNear} onChange={(v) => setForm({ ...form, totalNear: v })} />
        <Field label="Milestones (title:share%,…)" value={form.milestones} onChange={(v) => setForm({ ...form, milestones: v })} />
        <Field label="Deadline (days)" value={form.days} onChange={(v) => setForm({ ...form, days: v })} />
        <Field label="Reviewer (optional)" value={form.reviewer} onChange={(v) => setForm({ ...form, reviewer: v })} />
        <Field label="Arbiter (optional)" value={form.arbiter} onChange={(v) => setForm({ ...form, arbiter: v })} />
        <Btn onClick={() => r.run("Creating escrow", async () => {
          const esc = await post("/escrows", {
            provider: form.provider,
            amountUsd: form.amountUsd ? Number(form.amountUsd) : undefined,
            totalAtomic: form.totalNear ? toYocto(form.totalNear) : undefined,
            milestones: form.milestones.split(",").map((m) => { const [title, pct] = m.split(":"); return { title: title.trim(), sharePct: Number(pct) }; }),
            deadlineDays: Number(form.days), reviewer: form.reviewer || null, arbiter: form.arbiter || null, fundingMode: "wallet",
          });
          const sent = await sendAndRecord(esc.walletTransactions, (h) => post(`/escrows/${esc.escrowId}/confirm`, { txHash: h }));
          await load();
          return { escrow: esc, sent };
        })}>Create & fund (sign)</Btn>
      </Section>

      <Section title="Escrows">
        <select value={sel} onChange={(e) => setSel(e.target.value)}>
          <option value="">—</option>
          {escrows.map((e) => <option key={e.id} value={e.id}>#{e.onchain_id ?? "?"} · {e.provider_account} · {e.status}</option>)}
        </select>
        <Btn disabled={!sel} onClick={() => r.run("Loading", () => api(`/escrows/${sel}`))}>Details</Btn>
        <Btn disabled={!sel} onClick={() => r.run("Syncing", () => post(`/escrows/${sel}/sync`))}>Sync from chain</Btn>
        <Btn disabled={!sel} onClick={() => r.run("Loading events", () => api(`/escrows/${sel}/events`))}>On-chain events</Btn>
        <Field label="Milestone index" value={idx} onChange={setIdx} />
        <Field label="Reason / note" value={reason} onChange={setReason} />
      </Section>

      <Section title="Payer / approver actions">
        <Btn disabled={!sel} onClick={() => act("accept")}>Accept milestone & release</Btn>
        <Btn disabled={!sel} onClick={() => act("reject")}>Reject submission</Btn>
        <Btn disabled={!sel} onClick={() => act("dispute")}>Open dispute</Btn>
        <Btn disabled={!sel} onClick={() => act("refund_expired")}>Refund after deadline</Btn>
        <Btn disabled={!sel} onClick={() => act("cancel")}>Cancel (unfunded)</Btn>
      </Section>

      <Section title="Provider actions">
        <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <Btn disabled={!sel || !file} onClick={() => r.run("Uploading evidence", async () => {
          const ev = await uploadEvidence(file!);
          const prep = await post(`/escrows/${sel}/actions/submit_evidence`, { milestoneIndex: Number(idx), evidenceHash: ev.evidenceHash, evidenceUri: ev.uri });
          return sendAndRecord(prep.walletTransactions, (h) => post(`/escrows/${sel}/tx`, { action: "submit_evidence", txHash: h }));
        })}>Submit evidence (hash on-chain)</Btn>
        <Btn disabled={!sel} onClick={() => act("claim")}>Claim after review period</Btn>
        <Btn disabled={!sel} onClick={() => act("provider_withdraw")}>Withdraw from job (refund payer)</Btn>
      </Section>

      <Section title="Arbiter">
        <Field label="Amount to provider (yoctoNEAR)" value={providerAmount} onChange={setProviderAmount} />
        <Btn disabled={!sel} onClick={() => act("resolve", { note: reason || "Resolved" })}>Resolve dispute</Btn>
      </Section>
      {r.view}
    </>
  );
}
