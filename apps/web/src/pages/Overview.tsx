import { useEffect, useState } from "react";
import { api, post } from "../api";
import { signMessage } from "../wallet";
import { Btn, Field, Section, useRunner } from "../ui";

/** The business at a glance: profit and loss, the owner's controls, and a way to hire Veyra. */
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
        <Stat label="Attacks blocked" value={t ? String(t.securityEvents) : "—"} danger={Boolean(t?.securityEvents)} />
      </div>

      <div className="split even">
        <Section title="Kill switch" note="While Veyra is frozen, no contract advances and no cheque is signed. The vault can also be frozen at the Agent API, under Settings.">
          <div className="row">
            <span className={`pill ${status?.frozen ? "bad" : "good"}`}>{status?.frozen ? "frozen" : "running"}</span>
            <Btn danger={!status?.frozen} onClick={() => r.run("Updating", async () => { const x = await post("/contractor/freeze", { frozen: !status?.frozen }); await load(); return x; })}>
              {status?.frozen ? "Unfreeze" : "Freeze Veyra"}
            </Btn>
          </div>
        </Section>
        <MandateCard mode={mode} runner={r} />
      </div>

      <Section
        title={mode === "sim" ? "Hire Veyra on the simulated Agent Market" : "Hire Veyra directly"}
        note={mode === "sim" ? "A simulated buyer posts this job to Veyra's listing. The market escrows the budget and Veyra picks the job up as it would a real hire." : "Live hires normally arrive from market.near.ai or over A2A. This creates a direct contract."}
      >
        <Field label="Title" value={job.title} onChange={(v) => setJob({ ...job, title: v })} />
        <Field label="Brief" value={job.brief} onChange={(v) => setJob({ ...job, brief: v })} textarea />
        <Field label="Budget (USDC)" value={job.budget} onChange={(v) => setJob({ ...job, budget: v })} />
        <Btn primary onClick={() => r.run("Hiring Veyra", async () => {
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
        <div className="table-wrap">
          <table>
            <thead><tr><th>Job</th><th>Buyer</th><th>Status</th><th className="num">Budget</th><th className="num">Spent</th><th /></tr></thead>
            <tbody>
              {contracts.map((c) => (
                <tr key={c.id}>
                  <td>{c.title}</td>
                  <td className="mono">{c.buyer}</td>
                  <td><span className={`pill ${c.status === "delivered" ? "good" : c.status === "failed" ? "bad" : ""}`}>{c.status}{c.status === "active" ? ` · ${c.step}` : ""}</span></td>
                  <td className="num mono">{c.budgetUsd.toFixed(2)}</td>
                  <td className="num mono">{c.costUsd.toFixed(2)}</td>
                  <td><button onClick={() => open(c.id)}>Open</button></td>
                </tr>
              ))}
              {!contracts.length && <tr><td colSpan={6} className="note">No contracts yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Section>
      {r.view}
    </>
  );
}

/** The owner's signed limits. In live mode the wallet signs them (NEP-413); the simulator applies them unsigned. */
function MandateCard({ mode, runner }: { mode: "sim" | "live"; runner: ReturnType<typeof useRunner> }) {
  const [m, setM] = useState<any>(null);
  const [draft, setDraft] = useState<{ maxJobUsd: string; maxDailyUsd: string; marginPct: string; blocked: string; minTrust: string } | null>(null);
  const load = async () => {
    const x = await api("/mandate");
    setM(x);
    setDraft({ maxJobUsd: String(x.mandate.maxJobUsd), maxDailyUsd: String(x.mandate.maxDailyUsd), marginPct: (x.mandate.marginBps / 100).toString(), blocked: x.mandate.blockedCategories.join(", "), minTrust: String(x.mandate.minTrust) });
  };
  useEffect(() => void load(), []);
  if (!m || !draft) return <Section title="Mandate"><p className="note">Loading…</p></Section>;
  const mandate = () => ({
    maxJobUsd: Number(draft.maxJobUsd), maxDailyUsd: Number(draft.maxDailyUsd), marginBps: Math.round(Number(draft.marginPct) * 100),
    blockedCategories: draft.blocked.split(",").map((s) => s.trim()).filter(Boolean), minTrust: Number(draft.minTrust),
  });
  return (
    <Section title={`Mandate · v${m.version}`} note={`The limits Veyra works under, enforced before any cheque is signed. ${m.signature ? `Signed by ${m.signedBy}.` : m.version ? `Set in the simulator by ${m.signedBy}.` : "Defaults until the owner signs one."} Spent in the last 24 h: ${(Number(m.dailySpentAtomic) / 1e6).toFixed(2)} USDC.`}>
      <div className="row">
        <Field label="Largest job (USDC)" value={draft.maxJobUsd} onChange={(v) => setDraft({ ...draft, maxJobUsd: v })} />
        <Field label="Daily limit (USDC)" value={draft.maxDailyUsd} onChange={(v) => setDraft({ ...draft, maxDailyUsd: v })} />
      </div>
      <div className="row">
        <Field label="Margin (%)" value={draft.marginPct} onChange={(v) => setDraft({ ...draft, marginPct: v })} />
        <Field label="Trust floor (0–100)" value={draft.minTrust} onChange={(v) => setDraft({ ...draft, minTrust: v })} />
      </div>
      <Field label="Never buy from these categories" value={draft.blocked} onChange={(v) => setDraft({ ...draft, blocked: v })} placeholder="e.g. creative, dev_tools" />
      <div className="row">
        <Btn primary onClick={() => runner.run(mode === "live" ? "Signing the mandate" : "Applying the mandate", async () => {
          if (mode === "live") {
            const ch = await post("/mandate/challenge", mandate());
            const signed = await signMessage(ch.message, ch.recipient, ch.nonce);
            const x = await post("/mandate", { mandate: mandate(), signed });
            await load();
            return x;
          }
          const x = await post("/mandate", { mandate: mandate() });
          await load();
          return x;
        })}>{mode === "live" ? "Sign with wallet" : "Apply"}</Btn>
        <span className="mono small">hash {m.hash.slice(0, 16)}…</span>
      </div>
    </Section>
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
