import { useEffect, useState } from "react";
import { api, post } from "../api";
import { Json, Section, useRunner } from "../ui";

const usd = (a: string | null | undefined) => (a ? (Number(a) / 1e6).toFixed(2) : "—");

/** The treasury tiers, payouts to the owner, x402 sales and the public ledger. */
export function MoneyPage({ mode }: { mode: "sim" | "live" }) {
  const r = useRunner();
  const [t, setT] = useState<any>(null);
  const [ledger, setLedger] = useState<any>(null);
  const [sales, setSales] = useState<any[]>([]);
  const [sim, setSim] = useState<any>(null);
  const load = async () => {
    setT(await api("/treasury"));
    setLedger(await api("/ledger"));
    setSales((await api("/sales")).sales);
    if (mode === "sim") setSim(await api("/sim/state"));
  };
  useEffect(() => void load(), []);
  if (!t || !ledger) return <p className="note">Loading…</p>;
  return (
    <>
      <div className="tiers">
        <Section title="1 · Vault" note="Bound by an owner-signed policy. It pays only the spend account, and only within its budget.">
          <p className="big">{usd(t.vault.balanceAtomic)} USDC</p>
          <Json value={t.vault} />
        </Section>
        <Section title="2 · Spend account" note={`Signs x402 cheques and receives x402 sales. Refilled just in time; it never needs to hold more than ${usd(t.maxFloatAtomic)} USDC.`}>
          <p className="big">{usd(t.spend.usdcAtomic)} USDC</p>
          <p className="mono small">{t.spend.accountId}</p>
          <p className="note">Key pool, one key per cheque in flight:</p>
          <div className="row">{t.spend.keys.map((k: any) => <span key={k.id} className={`pill ${k.status === "locked" ? "warn" : k.status === "free" ? "good" : ""}`} title={k.publicKey}>{k.status}</span>)}</div>
          <button onClick={() => r.run("Topping up the key pool", async () => { const x = await post("/treasury/spend/pool"); await load(); return x; })}>Top up key pool</button>
        </Section>
        <Section title="3 · Market" note="x402 payments settle to the market treasury on delivery. Job-board awards are escrowed by the market.">
          {sim ? <><p className="big">{usd(sim.balances.treasury)} USDC</p><p className="note">received by the simulated market treasury · attacker {usd(sim.balances.attacker)} USDC</p></> : <p className="note">See market.near.ai for balances.</p>}
        </Section>
      </div>

      <div className="split even">
        <Section title="Payouts to the owner" note={`Whatever the spend account holds above the ${usd(t.maxFloatAtomic)} USDC float is earned margin. It is paid to the owner's account on a schedule, with a receipt for each payout.`}>
          <p className="big">{usd(t.surplusAtomic)} USDC <span className="note">available now</span></p>
          <button className="btn-dark" disabled={BigInt(t.surplusAtomic) === 0n} onClick={() => r.run("Paying out", async () => { const x = await post("/treasury/payout"); await load(); return x; })}>Pay out now</button>
          {t.payouts.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead><tr><th>To</th><th className="num">Amount</th><th>Status</th><th>Tx</th></tr></thead>
                <tbody>{t.payouts.map((p: any) => <tr key={p.id}><td className="mono">{p.to_account}</td><td className="num mono">{usd(p.amount_atomic)}</td><td><span className={`pill ${p.status === "paid" ? "good" : p.status === "failed" ? "bad" : ""}`}>{p.status}</span></td><td className="mono small">{p.tx_hash ?? p.error ?? ""}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </Section>
        <Section title="x402 sales" note="Jobs other agents paid for with a cheque. A cheque is executed only when the job is delivered; a void cheque was never executed.">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Buyer</th><th className="num">Amount</th><th>Cheque</th><th>Settlement</th></tr></thead>
              <tbody>
                {sales.map((s) => <tr key={s.id}><td className="mono">{s.buyer_account.slice(0, 14)}…</td><td className="num mono">{usd(s.amount_atomic)}</td><td><span className={`pill ${s.status === "settled" ? "good" : s.status === "held" ? "warn" : s.status === "void" ? "" : "bad"}`}>{s.status}</span></td><td className="mono small">{s.settlement_tx ?? s.error ?? "—"}</td></tr>)}
                {!sales.length && <tr><td colSpan={4} className="note">No x402 sales yet. See Identity &amp; hiring for how an agent pays with a cheque.</td></tr>}
              </tbody>
            </table>
          </div>
        </Section>
      </div>

      <Section title="Public ledger" note="Anyone can read it at /ledger. Receipts are signed with the key below and anchored on NEAR.">
        <p className="mono small">Receipt issuer: {ledger.receiptsIssuer}</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Contract</th><th>Buyer</th><th>Status</th><th className="num">Revenue</th><th className="num">Cost</th><th className="num">Margin</th></tr></thead>
            <tbody>
              {ledger.contracts.map((c: any) => <tr key={c.id}><td>{c.title}</td><td className="mono">{c.buyer}</td><td>{c.status}</td><td className="num mono">{c.revenueUsd.toFixed(2)}</td><td className="num mono">{c.costUsd.toFixed(2)}</td><td className="num mono">{(c.revenueUsd - c.costUsd).toFixed(2)}</td></tr>)}
            </tbody>
          </table>
        </div>
        <h4>Purchases</h4>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Agent</th><th>For</th><th>Rail</th><th className="num">Amount</th><th>Status</th></tr></thead>
            <tbody>{ledger.purchases.map((p: any) => <tr key={p.id}><td className="mono">{p.agent_handle}</td><td>{p.subtask}</td><td>{p.rail}</td><td className="num mono">{usd(p.amount_atomic)}</td><td>{p.status}</td></tr>)}</tbody>
          </table>
        </div>
        <h4>Counterparties</h4>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Agent</th><th className="num">Hires</th><th className="num">Passed</th><th className="num">Failed</th><th className="num">Attacks</th><th>Blocked</th></tr></thead>
            <tbody>{ledger.counterparties.map((c: any) => <tr key={c.handle} className={c.blocked ? "bad" : ""}><td className="mono">{c.handle}</td><td className="num">{c.hires}</td><td className="num">{c.passes}</td><td className="num">{c.failures}</td><td className="num">{c.attacks}</td><td>{c.blocked ? "yes" : ""}</td></tr>)}</tbody>
          </table>
        </div>
        <h4>Anchors</h4>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Root</th><th>Receipts</th><th>Network</th><th>Transaction</th></tr></thead>
            <tbody>{ledger.anchors.map((a: any) => <tr key={a.id}><td className="mono">{a.root.slice(0, 20)}…</td><td>{a.from_seq}–{a.to_seq}</td><td>{a.network}</td><td className="mono">{a.tx_hash ?? a.status}</td></tr>)}</tbody>
          </table>
        </div>
      </Section>
      {r.view}
    </>
  );
}
