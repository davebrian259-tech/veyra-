import { useEffect, useState } from "react";
import { api, post } from "../api";
import { Btn, Field, Section, useRunner } from "../ui";

/** Business at a glance: P&L, the kill switch, and a way to hire Veyra. */
export function Overview({ mode, open }: { mode: "sim" | "live"; open: (contractId: string) => void }) {
  const r = useRunner();
  const [ledger, setLedger] = useState<any>(null);
  const [status, setStatus] = useState<any>(null);
  const [contracts, setContracts] = useState<any[]>([]);
  const [job, setJob] = useState({
    title: "Competitor research: NEAR agent wallets",
    brief: "Research competitors to NEAR Intents agent wallets, compare their pricing in a table, and write a short report with recommendations for a founder.",
    budget: "4",
  });

  const load = async () => {
    const [l, s, c] = await Promise.all([api("/ledger"), api("/contractor/status"), api("/contracts")]);
    setLedger(l);
    setStatus(s);
    setContracts(c.contracts);
  };
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, []);

  const t = ledger?.totals;
  return (
    <>
      <div className="stats">
        <Stat label="Revenue" value={t ? `${t.revenueUsd.toFixed(2)} USDC` : "—"} />
        <Stat label="Paid to agents" value={t ? `${t.costUsd.toFixed(2)} USDC` : "—"} />
        <Stat label="Margin" value={t ? `${t.marginUsd.toFixed(2)} USDC` : "—"} accent />
        <Stat label="Delivered" value={t ? `${t.delivered}/${t.contracts}` : "—"} />
        <Stat label="Attacks & blocks" value={t ? String(t.securityEvents) : "—"} danger={Boolean(t?.securityEvents)} />
      </div>

      <Section title="Kill switch" note="Frozen: no contract advances and no cheque is signed. The vault can also be frozen at the Agent API (Settings → Vault).">
        <div className="row">
          <span className={`pill ${status?.frozen ? "bad" : "good"}`}>{status?.frozen ? "FROZEN" : "running"}</span>
          <Btn danger={!status?.frozen} onClick={() => r.run("Updating", async () => { const x = await post("/contractor/freeze", { frozen: !status?.frozen }); await load(); return x; })}>
            {status?.frozen ? "Unfreeze" : "Freeze Veyra"}
          </Btn>
        </div>
      </Section>

      <Section
        title={mode === "sim" ? "Hire Veyra on the (simulated) Agent Market" : "Hire Veyra directly"}
        note={mode === "sim" ? "A simulated buyer posts this job to Veyra's listing; the market escrows the budget and Veyra picks it up like a real hire." : "Live hires normally arrive from market.near.ai; this creates a direct contract."}
      >
        <Field label="Title" value={job.title} onChange={(v) => setJob({ ...job, title: v })} />
        <Field label="Brief" value={job.brief} onChange={(v) => setJob({ ...job, brief: v })} textarea />
        <Field label="Budget (USDC)" value={job.budget} onChange={(v) => setJob({ ...job, budget: v })} />
        <Btn onClick={() => r.run("Hiring Veyra", async () => {
          const x = mode === "sim"
            ? await post("/sim/hire", { title: job.title, description: job.brief, budgetUsd: Number(job.budget) })
            : await post("/contracts", { title: job.title, brief: job.brief, budgetUsd: Number(job.budget) });
          const id = x.contractId ?? x.id;
          await load();
          if (id) open(id);
          return { contractId: id };
        })}>Hire Veyra</Btn>
      </Section>

      <Section title="Contracts">
        <table>
          <thead><tr><th>Job</th><th>Buyer</th><th>Status</th><th>Budget</th><th>Spent</th><th /></tr></thead>
          <tbody>
            {contracts.map((c) => (
              <tr key={c.id}>
                <td>{c.title}</td>
                <td className="mono">{c.buyer}</td>
                <td><span className={`pill ${c.status === "delivered" ? "good" : c.status === "failed" ? "bad" : ""}`}>{c.status}{c.status === "active" ? ` · ${c.step}` : ""}</span></td>
                <td>{c.budgetUsd.toFixed(2)}</td>
                <td>{c.costUsd.toFixed(2)}</td>
                <td><button onClick={() => open(c.id)}>Open</button></td>
              </tr>
            ))}
            {!contracts.length && <tr><td colSpan={6} className="note">No contracts yet.</td></tr>}
          </tbody>
        </table>
      </Section>
      {r.view}
    </>
  );
}

function Stat({ label, value, accent, danger }: { label: string; value: string; accent?: boolean; danger?: boolean }) {
  return (
    <div className={`stat ${accent ? "accent" : ""} ${danger ? "danger" : ""}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}
