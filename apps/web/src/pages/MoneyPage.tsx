import { useEffect, useState } from "react";
import { api, post } from "../api";
import { Json, Section, useRunner } from "../ui";

const usd = (a: string | null | undefined) => (a ? (Number(a) / 1e6).toFixed(2) : "—");

/** Treasury tiers and the public P&L ledger. */
export function MoneyPage({ mode }: { mode: "sim" | "live" }) {
  const r = useRunner();
  const [t, setT] = useState<any>(null);
  const [ledger, setLedger] = useState<any>(null);
  const [sim, setSim] = useState<any>(null);
  const load = async () => {
    setT(await api("/treasury"));
    setLedger(await api("/ledger"));
    if (mode === "sim") setSim(await api("/sim/state"));
  };
  useEffect(() => void load(), []);
  if (!t || !ledger) return <p className="note">Loading…</p>;
  return (
    <>
      <div className="tiers">
        <Section title="1 · Vault" note="Owner-signed policy. Pays only the spend account, under budget.">
          <p className="big">{usd(t.vault.balanceAtomic)} USDC</p>
          <Json value={t.vault} />
        </Section>
        <Section title="2 · Spend account" note={`Signs x402 cheques. Refilled just in time; never holds more than ${usd(t.maxFloatAtomic)} USDC.`}>
          <p className="big">{usd(t.spend.usdcAtomic)} USDC</p>
          <p className="mono small">{t.spend.accountId}</p>
          <p>Key pool (one key per in-flight cheque):</p>
          <div className="row">{t.spend.keys.map((k: any) => <span key={k.id} className={`pill ${k.status === "locked" ? "warn" : k.status === "free" ? "good" : ""}`} title={k.publicKey}>{k.status}</span>)}</div>
          <button onClick={() => r.run("Topping up key pool", async () => { const x = await post("/treasury/spend/pool"); await load(); return x; })}>Ensure key pool</button>
        </Section>
        <Section title="3 · Market" note="x402 payments settle to the market treasury on delivery; job-board awards are escrowed by the market.">
          {sim ? <><p className="big">{usd(sim.balances.treasury)} USDC</p><p className="note">received by the simulated market treasury · attacker {usd(sim.balances.attacker)} USDC</p></> : <p className="note">See market.near.ai for balances.</p>}
        </Section>
      </div>

      <Section title="Public P&L ledger" note="Readable by anyone at /ledger. Receipts are signed by the key below and anchored on NEAR.">
        <p className="mono small">Receipt issuer: {ledger.receiptsIssuer}</p>
        <table>
          <thead><tr><th>Contract</th><th>Buyer</th><th>Status</th><th>Revenue</th><th>Cost</th><th>Margin</th></tr></thead>
          <tbody>
            {ledger.contracts.map((c: any) => <tr key={c.id}><td>{c.title}</td><td className="mono">{c.buyer}</td><td>{c.status}</td><td>{c.revenueUsd.toFixed(2)}</td><td>{c.costUsd.toFixed(2)}</td><td>{(c.revenueUsd - c.costUsd).toFixed(2)}</td></tr>)}
          </tbody>
        </table>
        <h4>Purchases</h4>
        <table>
          <thead><tr><th>Agent</th><th>For</th><th>Rail</th><th>Amount</th><th>Status</th></tr></thead>
          <tbody>{ledger.purchases.map((p: any) => <tr key={p.id}><td className="mono">{p.agent_handle}</td><td>{p.subtask}</td><td>{p.rail}</td><td>{usd(p.amount_atomic)}</td><td>{p.status}</td></tr>)}</tbody>
        </table>
        <h4>Counterparties</h4>
        <table>
          <thead><tr><th>Agent</th><th>Hires</th><th>Passed</th><th>Failed</th><th>Attacks</th><th>Blocked</th></tr></thead>
          <tbody>{ledger.counterparties.map((c: any) => <tr key={c.handle} className={c.blocked ? "bad" : ""}><td className="mono">{c.handle}</td><td>{c.hires}</td><td>{c.passes}</td><td>{c.failures}</td><td>{c.attacks}</td><td>{c.blocked ? "yes" : ""}</td></tr>)}</tbody>
        </table>
        <h4>Anchors</h4>
        <table>
          <thead><tr><th>Root</th><th>Receipts</th><th>Network</th><th>Tx</th></tr></thead>
          <tbody>{ledger.anchors.map((a: any) => <tr key={a.id}><td className="mono">{a.root.slice(0, 20)}…</td><td>{a.from_seq}–{a.to_seq}</td><td>{a.network}</td><td className="mono">{a.tx_hash ?? a.status}</td></tr>)}</tbody>
        </table>
      </Section>
      {r.view}
    </>
  );
}
