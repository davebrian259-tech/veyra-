import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "../brand";
import { invalidate } from "../lib/data";
import { Button, Empty, ErrorNote, Field, Skeleton } from "../ui";
import { TONES, VaultEmblem } from "./art";
import { FAUCET_URL } from "./errors";
import { Explain } from "./explain";
import { nearNum, toYoctoNear, type Vault } from "./heist-api";
import { backPlan, withdrawPlan } from "./plans";
import { useHeist } from "./session";
import { useTx } from "./tx";

/**
 * The other side of the game: back a vault's defence, earn from failed heists, lose it on a crack.
 * Deep links: ?back=<vault>&amount=<near> and ?withdraw=<vault> open their confirmation sheets.
 */
export default function Underwrite() {
  const h = useHeist();
  const { lobby, acct } = h;
  const tx = useTx();
  const [params, setParams] = useSearchParams();
  const [amount, setAmount] = useState<Record<number, string>>({});
  // optimistic stakes: shown at once, rolled back if the transaction fails
  const [optimistic, setOptimistic] = useState<Record<number, bigint>>({});
  useEffect(() => { document.title = "Back a vault · Veyra Heist"; }, []);
  const clear = () => setParams((p) => { const n = new URLSearchParams(p); n.delete("back"); n.delete("withdraw"); n.delete("amount"); return n; }, { replace: true });
  const refresh = async () => { invalidate("/heist"); await Promise.all([lobby.reload(), h.reloadAccount()]); };

  const backV = Number(params.get("back")) || null;
  const wdV = Number(params.get("withdraw")) || null;
  useEffect(() => {
    if (!lobby.data || tx.phase !== "review") return;
    const v = lobby.data.vaults.find((x) => x.id === (backV ?? wdV));
    if (!v) return;
    if (backV) {
      const amt = params.get("amount") ?? amount[v.id] ?? "0.5";
      if (!(Number(amt) > 0)) return;
      tx.open({ ...backPlan(h, v, amt, () => { setOptimistic((o) => { const n = { ...o }; delete n[v.id]; return n; }); void refresh(); }, () => setOptimistic((o) => { const n = { ...o }; delete n[v.id]; return n; })), onClose: clear,
        run: async (ctl) => { setOptimistic((o) => ({ ...o, [v.id]: toYoctoNear(amt) })); return backPlan(h, v, amt, () => undefined).run(ctl); } });
    } else if (wdV) {
      const s = acct?.stakes.find((x) => x.vault === v.id);
      if (s) tx.open({ ...withdrawPlan(h, v, s, () => void refresh()), onClose: clear });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backV, wdV, lobby.data, acct, h.account]);

  if (lobby.error && !lobby.data) return <ErrorNote message={lobby.error} retry={lobby.reload} />;
  if (!lobby.data) return <Skeleton lines={8} height={28} />;
  const { vaults, ranked } = lobby.data;
  if (!ranked.enabled || !ranked.contractId) return <section className="panel"><Empty title="Backing is off on this server" action={<Link className="btn primary sm" to="/play">Play practice heists</Link>}>It needs the Heist pot contract. Practice heists still work.</Empty></section>;
  const myTotal = (acct?.stakes ?? []).reduce((t, s) => t + BigInt(s.amountYocto), 0n);
  const myEarned = (acct?.stakes ?? []).reduce((t, s) => t + BigInt(s.earnedYocto), 0n);

  return (
    <div className="stack-lg">
      {tx.sheet}
      <div className="page-head">
        <h1>Back a vault</h1>
        <p>Bet on the defence. Your stake joins a vault's pot and earns 20% of every failed ranked entry fee, shared by stake. If someone cracks the vault, the whole pot goes to them, your stake included.</p>
      </div>

      <section className="panel your-stakes">
        <div className="panel-head"><h2>Your backing</h2>{h.account && <span className="link mono">{h.account}</span>}</div>
        {!h.account ? (
          <Empty title="Connect a wallet to back a vault" action={<Button variant="primary" size="sm" onClick={() => void h.connect()}>Connect wallet</Button>}>Backing uses testnet NEAR, which is free. <a href={FAUCET_URL} target="_blank" rel="noreferrer">Get some from the faucet <Icon icon={ArrowUpRight01Icon} size={12} /></a>.</Empty>
        ) : (
          <div className="tiles">
            <div className="tile-stat"><Explain title="Staked" what="NEAR you have staked across vaults that have not been cracked since." how="Read from the contract's get_stake view for each vault."><span className="stat-k">Staked</span></Explain><b className="mono">{nearNum(myTotal).toFixed(2)} NEAR</b></div>
            <div className="tile-stat"><Explain title="Earned" what="Your share of the 20% backers' cut from failed entries, waiting to be withdrawn." how="Each failed fee × 20% × your stake ÷ the vault's total stake."><span className="stat-k">Earned</span></Explain><b className="mono gold-ink">{nearNum(myEarned).toFixed(4)} NEAR</b></div>
            <div className="tile-stat"><span className="stat-k">Vaults backed</span><b className="mono">{acct?.stakes.length ?? 0}</b></div>
            <div className="tile-stat"><span className="stat-k">Wallet</span><b className="mono">{acct ? nearNum(acct.balanceYocto).toFixed(2) : "…"} NEAR</b></div>
          </div>
        )}
      </section>

      <div className="grid-3">
        {vaults.map((v) => <BackCard key={v.id} v={v} amount={amount[v.id] ?? "0.5"} setAmount={(x) => setAmount({ ...amount, [v.id]: x })} optimistic={optimistic[v.id]} busy={tx.busy}
          onBack={(amt) => setParams((p) => { const n = new URLSearchParams(p); n.set("back", String(v.id)); n.set("amount", amt); return n; }, { replace: true })}
          onWithdraw={() => setParams((p) => { const n = new URLSearchParams(p); n.set("withdraw", String(v.id)); return n; }, { replace: true })} />)}
      </div>
    </div>
  );
}

function BackCard({ v, amount, setAmount, optimistic, busy, onBack, onWithdraw }: { v: Vault; amount: string; setAmount: (s: string) => void; optimistic?: bigint; busy: boolean; onBack: (amt: string) => void; onWithdraw: () => void }) {
  const { acct, account } = useHeist();
  const mine = acct?.stakes.find((s) => s.vault === v.id);
  const bad = !(Number(amount) > 0) ? "Enter an amount above 0." : Number(amount) > 100 ? "At most 100 NEAR at a time." : null;
  const staked = (v.chain ? BigInt(v.chain.stakedYocto) : 0n) + (optimistic ?? 0n);
  const pot = (v.chain ? BigInt(v.chain.potYocto) : 0n) + (optimistic ?? 0n);
  return (
    <section className="panel back-card" style={{ ["--glow" as string]: TONES[v.tone].glow }} aria-labelledby={`back-${v.id}`}>
      <div className="back-head">
        <VaultEmblem id={v.id} tone={v.tone} shields={v.shields.length} size={72} />
        <div><h2 id={`back-${v.id}`}>{v.name}</h2><p className="small muted">{v.shields.length} shields · {v.chain?.attempts ?? 0} attempts · {v.chain?.cracks ?? 0} cracks</p></div>
      </div>
      <dl className="kv">
        <dt><Explain title="Pot" what="Everything a crack of this vault would pay out, stakes included." how="House seed + 70% of failed fees + all backers' stakes.">Pot</Explain></dt><dd className="mono gold-ink">{nearNum(pot).toFixed(2)} NEAR{optimistic ? <span className="chip">pending</span> : null}</dd>
        <dt><Explain title="Backed" what="Total staked by everyone backing this vault." how="Your earnings are your stake divided by this, times 20% of each failed fee.">Backed</Explain></dt><dd className="mono">{nearNum(staked).toFixed(2)} NEAR</dd>
        <dt>Earn per failed entry</dt><dd className="mono">{(Number(v.feeNear) * 0.2).toFixed(2)} NEAR shared</dd>
        {mine && <><dt>Your stake</dt><dd className="mono">{nearNum(mine.amountYocto).toFixed(2)} NEAR · earned {nearNum(mine.earnedYocto).toFixed(4)}</dd></>}
      </dl>
      <Field label="Stake (testnet NEAR)" value={amount} onChange={setAmount} inputMode="decimal" error={bad} />
      <div className="btn-row">
        <Button variant="primary" disabled={Boolean(bad) || busy} onClick={() => onBack(amount)}>{account ? `Back vault ${v.id}` : "Connect and back"}</Button>
        <Button disabled={!mine || busy} onClick={onWithdraw} title={mine ? undefined : "You have no stake in this vault"}>Withdraw</Button>
      </div>
    </section>
  );
}
