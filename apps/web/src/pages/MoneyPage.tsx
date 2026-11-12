import { Link } from "react-router";
import { post } from "../api";
import { invalidate, money, shortId, usd, useApi } from "../lib/data";
import { useSession } from "../shell/session";
import { Button, Card, Empty, ErrorNote, Json, Pill, Skeleton, statusTone, useAction, useConfirm } from "../ui";

/** The treasury tiers, payouts to the owner, x402 sales, and the public ledger. */
export default function MoneyPage() {
  const { config } = useSession();
  const sim = config!.mode === "sim";
  const t = useApi<any>("/treasury", { every: 8000 });
  const ledger = useApi<any>("/ledger", { every: 8000 });
  const sales = useApi<{ sales: any[] }>("/sales", { every: 8000 });
  const simState = useApi<any>(sim ? "/sim/state" : null, { every: 8000 });
  const { run, busy } = useAction();
  const confirm = useConfirm();

  if (t.error) return <ErrorNote message={t.error} retry={t.reload} />;
  if (!t.data || !ledger.data) return <Skeleton lines={8} height={22} />;
  const tr = t.data;
  const lg = ledger.data;
  const surplus = BigInt(tr.surplusAtomic ?? "0");
  const reload = () => { invalidate("/treasury"); invalidate("/ledger"); invalidate("/sales"); };

  return (
    <div className="stack">
      <div className="grid-3">
        <Card title="1 · Vault" note="Bound by an owner-signed policy. It pays only the spend account, within its budget.">
          <p className="stat-value" style={{ fontSize: "var(--fs-2xl)" }}>{usd(tr.vault.balanceAtomic)} USDC</p>
          <details className="disclosure" style={{ marginTop: "var(--s-3)" }}><summary>Policy details</summary><Json value={tr.vault} /></details>
        </Card>
        <Card title="2 · Spend account" note={`Signs x402 cheques and receives x402 sales. Refilled just in time. It never needs more than ${usd(tr.maxFloatAtomic)} USDC.`}>
          <p className="stat-value" style={{ fontSize: "var(--fs-2xl)" }}>{usd(tr.spend.usdcAtomic)} USDC</p>
          <p className="mono small muted" style={{ marginTop: "var(--s-1)" }}>{tr.spend.accountId}</p>
          <p className="small muted" style={{ margin: "var(--s-3) 0 var(--s-2)" }}>Key pool, one key per cheque in flight</p>
          <div className="btn-row">{tr.spend.keys.map((k: any) => <Pill key={k.id} tone={statusTone(k.status)} title={k.publicKey}>{k.status}</Pill>)}</div>
          <div style={{ marginTop: "var(--s-3)" }}><Button size="sm" loading={busy === "pool"} onClick={() => run("pool", async () => { await post("/treasury/spend/pool"); reload(); }, { success: "Key pool topped up." })}>Top up key pool</Button></div>
        </Card>
        <Card title="3 · Market" note="x402 payments settle to the market treasury on delivery. Job-board awards are escrowed by the market.">
          {sim ? <><p className="stat-value" style={{ fontSize: "var(--fs-2xl)" }}>{usd(simState.data?.balances.treasury)} USDC</p><p className="small muted">received by the simulated market treasury · attacker holds {usd(simState.data?.balances.attacker)} USDC</p></> : <p className="small muted">Balances are on market.near.ai.</p>}
        </Card>
      </div>

      <div className="grid-2">
        <Card title="Payouts to the owner" note={`Whatever the spend account holds above the ${usd(tr.maxFloatAtomic)} USDC float is earned margin. It is paid to the owner on a schedule, with a receipt each time.`}>
          <p className="stat-value" style={{ fontSize: "var(--fs-2xl)" }}>{usd(tr.surplusAtomic)} USDC <span className="small muted" style={{ fontFamily: "var(--sans)", fontWeight: 400 }}>available now</span></p>
          <div className="btn-row" style={{ margin: "var(--s-3) 0" }}>
            <Button variant="primary" disabled={surplus === 0n} loading={busy === "payout"} onClick={async () => {
              if (!(await confirm({ title: `Pay out ${usd(tr.surplusAtomic)} USDC?`, body: <p>The amount goes to the owner's account now and gets a signed receipt. The float stays in the spend account.</p>, confirmLabel: "Pay out now" }))) return;
              await run("payout", async () => { await post("/treasury/payout"); reload(); }, { success: "Payout sent." });
            }}>Pay out now</Button>
            {surplus === 0n && <span className="small muted">Nothing above the float yet.</span>}
          </div>
          {tr.payouts.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>To</th><th className="num">Amount</th><th>Status</th><th>Transaction</th></tr></thead>
                <tbody>{tr.payouts.map((p: any) => <tr key={p.id}><td className="mono small">{p.to_account}</td><td className="num mono">{usd(p.amount_atomic)}</td><td><Pill tone={statusTone(p.status)}>{p.status}</Pill></td><td className="mono small">{p.tx_hash ?? p.error ?? ""}</td></tr>)}</tbody>
              </table>
            </div>
          ) : <Empty title="No payouts yet">The first payout happens once earned margin rises above the float.</Empty>}
        </Card>
        <Card title="x402 sales" note="Jobs other agents paid for with a cheque. A cheque is executed only when the job is delivered. A void cheque was never executed.">
          {sales.data?.sales.length ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Buyer</th><th className="num">Amount</th><th>Cheque</th><th>Contract</th></tr></thead>
                <tbody>
                  {sales.data.sales.map((s) => <tr key={s.id}><td className="mono small">{shortId(s.buyer_account, 14)}</td><td className="num mono">{usd(s.amount_atomic)}</td><td><Pill tone={statusTone(s.status)}>{s.status}</Pill></td><td><Link to={`/app/contracts/${s.contract_id}`}>Open</Link></td></tr>)}
                </tbody>
              </table>
            </div>
          ) : <Empty title="No x402 sales yet" action={<Link className="btn sm" to="/app/identity#hire">How an agent pays with a cheque</Link>}>When another agent hires Veyra over A2A, its cheque appears here.</Empty>}
        </Card>
      </div>

      <Card title="Public ledger" note="Anyone can read it at /ledger. Receipts are signed with the key below and anchored on NEAR." actions={<Link className="btn sm" to="/app/evidence">See what is on-chain</Link>}>
        <p className="mono small muted" style={{ marginBottom: "var(--s-3)" }}>Receipt issuer {lg.receiptsIssuer}</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Contract</th><th>Buyer</th><th>Status</th><th className="num">Revenue</th><th className="num">Cost</th><th className="num">Margin</th></tr></thead>
            <tbody>
              {lg.contracts.map((c: any) => <tr key={c.id}><td><Link to={`/app/contracts/${c.id}`}>{c.title}</Link></td><td className="mono small">{c.buyer}</td><td><Pill tone={statusTone(c.status)}>{c.status}</Pill></td><td className="num mono">{money(c.revenueUsd)}</td><td className="num mono">{money(c.costUsd)}</td><td className="num mono">{money(c.revenueUsd - c.costUsd)}</td></tr>)}
              {!lg.contracts.length && <tr><td colSpan={6} className="muted small">No contracts yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <details className="disclosure" style={{ marginTop: "var(--s-4)" }}>
          <summary>Purchases ({lg.purchases.length})</summary>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Agent</th><th>For</th><th>Rail</th><th className="num">Amount</th><th>Status</th></tr></thead>
              <tbody>{lg.purchases.map((p: any) => <tr key={p.id}><td><Link to={`/app/watchtower/${encodeURIComponent(p.agent_handle)}`} className="mono">{p.agent_handle}</Link></td><td>{p.subtask}</td><td>{p.rail}</td><td className="num mono">{usd(p.amount_atomic)}</td><td>{p.status}</td></tr>)}</tbody>
            </table>
          </div>
        </details>
        <details className="disclosure">
          <summary>Counterparties ({lg.counterparties.length})</summary>
          <p className="small muted" style={{ margin: "var(--s-2) 0" }}>Veyra's memory of every agent it dealt with. Block one and Veyra never pays it again.</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Agent</th><th className="num">Hires</th><th className="num">Passed</th><th className="num">Failed</th><th className="num">Attacks</th><th>Blocked</th><th /></tr></thead>
              <tbody>{lg.counterparties.map((c: any) => (
                <tr key={c.handle} className={c.blocked ? "bad" : ""}>
                  <td><Link to={`/app/watchtower/${encodeURIComponent(c.handle)}`} className="mono">{c.handle}</Link></td><td className="num">{c.hires}</td><td className="num">{c.passes}</td><td className="num">{c.failures}</td><td className="num">{c.attacks}</td><td>{c.blocked ? "yes" : "no"}</td>
                  <td><Button size="sm" variant={c.blocked ? "default" : "danger"} loading={busy === `block-${c.handle}`} onClick={() => run(`block-${c.handle}`, async () => { await post(`/guard/counterparties/${encodeURIComponent(c.handle)}/block`, { blocked: !c.blocked }); reload(); }, { success: c.blocked ? `${c.handle} unblocked.` : `${c.handle} blocked.` })}>{c.blocked ? "Unblock" : "Block"}</Button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </details>
        <details className="disclosure">
          <summary>Anchors ({lg.anchors.length})</summary>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Root</th><th>Receipts</th><th>Network</th><th>Transaction</th></tr></thead>
              <tbody>{lg.anchors.map((a: any) => <tr key={a.id}><td className="mono small">{a.root.slice(0, 20)}…</td><td>{a.from_seq}–{a.to_seq}</td><td>{a.network}</td><td className="mono small">{a.tx_hash ?? a.status}</td></tr>)}</tbody>
            </table>
          </div>
        </details>
      </Card>
    </div>
  );
}
