import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { post } from "../api";
import { invalidate, money, useApi } from "../lib/data";
import { loadWallet, useSession } from "../shell/session";
import { Button, Card, Empty, ErrorNote, Field, Pill, Skeleton, Stat, statusTone, useAction, useConfirm } from "../ui";

/** Business at a glance: profit and loss, the owner's controls, a way to hire Veyra, and the contracts. */
export default function Overview() {
  const { config } = useSession();
  const mode = config!.mode;
  const ledger = useApi<any>("/ledger", { every: 5000 });
  const status = useApi<any>("/contractor/status", { every: 5000 });
  const contracts = useApi<{ contracts: any[] }>("/contracts", { every: 5000 });
  const t = ledger.data?.totals;
  const location = useLocation();
  useEffect(() => { if (location.hash === "#hire") document.getElementById("hire")?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [location.hash]);

  return (
    <div className="stack">
      {ledger.error && <ErrorNote message={ledger.error} retry={ledger.reload} />}
      <div className="stats" aria-label="Profit and loss">
        <Stat label="Revenue" value={t ? `${money(t.revenueUsd)} USDC` : <span className="skeleton" style={{ display: "block", width: 80, height: 24 }} />} />
        <Stat label="Paid to agents" value={t ? `${money(t.costUsd)} USDC` : "…"} />
        <Stat label="Margin" value={t ? `${money(t.marginUsd)} USDC` : "…"} tone="accent" />
        <Stat label="Delivered" value={t ? `${t.delivered} / ${t.contracts}` : "…"} />
        <Stat label="Attacks blocked" value={t ? String(t.securityEvents) : "…"} tone={t?.securityEvents ? "danger" : undefined} />
      </div>

      <div className="grid-2">
        <KillSwitch frozen={Boolean(status.data?.frozen)} loading={status.loading} onChange={status.reload} />
        <MandateCard mode={mode} />
      </div>

      <HireCard mode={mode} />

      <Card title="Contracts" note="Every job Veyra has taken, newest first.">
        {contracts.loading && <Skeleton lines={4} />}
        {contracts.error && <ErrorNote message={contracts.error} retry={contracts.reload} />}
        {contracts.data && (contracts.data.contracts.length ? <ContractsTable rows={contracts.data.contracts} /> : (
          <Empty title="No contracts yet">Hire Veyra above. The contract appears here and you can follow it live.</Empty>
        ))}
      </Card>
    </div>
  );
}

function ContractsTable({ rows }: { rows: any[] }) {
  const navigate = useNavigate();
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Job</th><th>Buyer</th><th>Status</th><th className="num">Budget</th><th className="num">Spent</th></tr></thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className="clickable" onClick={() => navigate(`/app/contracts/${c.id}`)}>
              <td><Link to={`/app/contracts/${c.id}`} onClick={(e) => e.stopPropagation()}>{c.title}</Link></td>
              <td className="mono small">{c.buyer}</td>
              <td><Pill tone={statusTone(c.status)}>{c.status}{c.status === "active" ? ` · ${c.step}` : ""}</Pill></td>
              <td className="num mono">{money(c.budgetUsd)}</td>
              <td className="num mono">{money(c.costUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KillSwitch({ frozen, loading, onChange }: { frozen: boolean; loading: boolean; onChange: () => void }) {
  const { run, busy } = useAction();
  const confirm = useConfirm();
  return (
    <Card title="Kill switch" note="While Veyra is frozen, no contract advances and no cheque is signed. Unfreeze to resume where it stopped.">
      <div className="btn-row">
        <Pill tone={frozen ? "bad" : "good"}>{loading ? "…" : frozen ? "frozen" : "running"}</Pill>
        <Button variant={frozen ? "primary" : "danger"} loading={busy !== null} onClick={async () => {
          if (!frozen && !(await confirm({ title: "Freeze Veyra?", body: <p>Every active contract pauses and no payment is signed until you unfreeze. Buyers see the delay.</p>, confirmLabel: "Freeze Veyra", danger: true }))) return;
          await run(frozen ? "Unfreezing" : "Freezing", () => post("/contractor/freeze", { frozen: !frozen }), { success: frozen ? "Veyra is running again." : "Veyra is frozen." });
          invalidate("/contractor/status");
          onChange();
        }}>{frozen ? "Unfreeze Veyra" : "Freeze Veyra"}</Button>
      </div>
    </Card>
  );
}

function HireCard({ mode }: { mode: "sim" | "live" }) {
  const navigate = useNavigate();
  const { run, busy } = useAction();
  const [job, setJob] = useState({ title: "Competitor research: NEAR agent wallets", brief: "Research competitors to NEAR Intents agent wallets, compare their pricing in a table, and write a short report with recommendations for a founder.", budget: "4" });
  const budgetNum = Number(job.budget);
  const budgetErr = job.budget && !(budgetNum > 0) ? "Enter an amount above 0." : null;
  return (
    <Card title={mode === "sim" ? "Hire Veyra on the simulated market" : "Hire Veyra directly"} note={mode === "sim" ? "A simulated buyer posts this job to Veyra's listing. The market escrows the budget and Veyra picks it up like a real hire." : "Live hires normally arrive from market.near.ai or over A2A. This creates a direct contract."}>
      <div id="hire" className="stack">
        <div className="form-grid">
          <Field label="Title" value={job.title} onChange={(v) => setJob({ ...job, title: v })} />
          <Field label="Budget (USDC)" value={job.budget} onChange={(v) => setJob({ ...job, budget: v })} inputMode="decimal" error={budgetErr} hint="Veyra keeps its margin from this and spends the rest on subcontractors." />
        </div>
        <Field label="Brief" value={job.brief} onChange={(v) => setJob({ ...job, brief: v })} textarea rows={3} />
        <div className="btn-row">
          <Button variant="primary" loading={busy !== null} disabled={!job.title.trim() || job.brief.trim().length < 10 || Boolean(budgetErr) || !job.budget} onClick={() => run("Hiring Veyra", async () => {
            const x = mode === "sim"
              ? await post("/sim/hire", { title: job.title, description: job.brief, budgetUsd: budgetNum })
              : await post("/contracts", { title: job.title, brief: job.brief, budgetUsd: budgetNum });
            invalidate("/contracts"); invalidate("/ledger");
            const id = x.contractId ?? x.id;
            if (id) navigate(`/app/contracts/${id}`);
          })}>Hire Veyra</Button>
          <span className="small muted">Opens the contract so you can watch it run.</span>
        </div>
      </div>
    </Card>
  );
}

/** The owner's signed limits. Live mode signs them with the wallet (NEP-413); the simulator applies them as is. */
function MandateCard({ mode }: { mode: "sim" | "live" }) {
  const m = useApi<any>("/mandate");
  const { run, busy } = useAction();
  const [draft, setDraft] = useState<{ maxJobUsd: string; maxDailyUsd: string; marginPct: string; blocked: string; minTrust: string } | null>(null);
  useEffect(() => {
    if (m.data && !draft) setDraft({ maxJobUsd: String(m.data.mandate.maxJobUsd), maxDailyUsd: String(m.data.mandate.maxDailyUsd), marginPct: (m.data.mandate.marginBps / 100).toString(), blocked: m.data.mandate.blockedCategories.join(", "), minTrust: String(m.data.mandate.minTrust) });
  }, [m.data, draft]);
  if (m.error) return <Card title="Mandate"><ErrorNote message={m.error} retry={m.reload} /></Card>;
  if (!m.data || !draft) return <Card title="Mandate"><Skeleton lines={4} /></Card>;
  const num = (v: string) => Number(v);
  const errs = {
    maxJobUsd: num(draft.maxJobUsd) > 0 ? null : "Enter an amount above 0.",
    maxDailyUsd: num(draft.maxDailyUsd) > 0 ? null : "Enter an amount above 0.",
    marginPct: num(draft.marginPct) >= 0 && num(draft.marginPct) <= 90 ? null : "Between 0 and 90.",
    minTrust: num(draft.minTrust) >= 0 && num(draft.minTrust) <= 100 ? null : "Between 0 and 100.",
  };
  const invalid = Object.values(errs).some(Boolean);
  const mandate = () => ({ maxJobUsd: num(draft.maxJobUsd), maxDailyUsd: num(draft.maxDailyUsd), marginBps: Math.round(num(draft.marginPct) * 100), blockedCategories: draft.blocked.split(",").map((s) => s.trim()).filter(Boolean), minTrust: num(draft.minTrust) });
  const d = m.data;
  return (
    <Card title={`Mandate · v${d.version}`} note={`The limits Veyra works under, enforced before any cheque is signed. ${d.signature ? `Signed by ${d.signedBy}.` : d.version ? `Set in the simulator by ${d.signedBy}.` : "Defaults until the owner signs one."} Spent in the last 24 hours: ${(Number(d.dailySpentAtomic) / 1e6).toFixed(2)} USDC.`}>
      <div className="stack">
        <div className="form-grid">
          <Field label="Largest job (USDC)" value={draft.maxJobUsd} onChange={(v) => setDraft({ ...draft, maxJobUsd: v })} inputMode="decimal" error={errs.maxJobUsd} />
          <Field label="Daily limit (USDC)" value={draft.maxDailyUsd} onChange={(v) => setDraft({ ...draft, maxDailyUsd: v })} inputMode="decimal" error={errs.maxDailyUsd} />
          <Field label="Margin (%)" value={draft.marginPct} onChange={(v) => setDraft({ ...draft, marginPct: v })} inputMode="decimal" error={errs.marginPct} />
          <Field label="Trust floor (0 to 100)" value={draft.minTrust} onChange={(v) => setDraft({ ...draft, minTrust: v })} inputMode="numeric" error={errs.minTrust} />
        </div>
        <Field label="Never buy from these categories" value={draft.blocked} onChange={(v) => setDraft({ ...draft, blocked: v })} placeholder="creative, dev_tools" hint="Comma separated. Leave empty to allow every category." />
        <div className="btn-row">
          <Button variant="primary" disabled={invalid} loading={busy !== null} onClick={() => run(mode === "live" ? "Signing the mandate" : "Applying the mandate", async () => {
            if (mode === "live") {
              const ch = await post("/mandate/challenge", mandate());
              const w = await loadWallet();
              const signed = await w.signMessage(ch.message, ch.recipient, ch.nonce);
              await post("/mandate", { mandate: mandate(), signed });
            } else await post("/mandate", { mandate: mandate() });
            invalidate("/mandate"); invalidate("/kya");
            await m.reload();
          }, { success: "Mandate updated." })}>{mode === "live" ? "Sign with wallet" : "Apply mandate"}</Button>
          <span className="mono small muted" title={d.hash}>hash {d.hash.slice(0, 12)}…</span>
        </div>
      </div>
    </Card>
  );
}
