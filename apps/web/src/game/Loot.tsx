import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "../brand";
import { invalidate, useApi } from "../lib/data";
import { Button, Empty, ErrorNote, Field, Select, Skeleton } from "../ui";
import { VaultEmblem } from "./art";
import { Explain } from "./explain";
import { explorerAccount, sendItem, waitForTx, type LootCatalog } from "./heist-api";
import { useHeist } from "./session";
import { useTx } from "./tx";

const ACCOUNT = /^(?=.{2,64}$)([a-z\d]+[-_])*[a-z\d]+(\.([a-z\d]+[-_])*[a-z\d]+)*$/;

/**
 * Loot: every item in the game is a NEP-245 multi token held by one contract. A ranked crack mints
 * the vault's gold bar to the winner, who owns it and can send it to anyone.
 */
export default function Loot() {
  const h = useHeist();
  const tx = useTx();
  const cat = useApi<LootCatalog>("/heist/loot", { every: 30_000 });
  const mine = useApi<{ balances: Record<string, string> }>(h.account ? `/heist/loot/${h.account}` : null, { every: 15_000 });
  const [item, setItem] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("1");
  useEffect(() => { document.title = "Loot · Veyra Heist"; }, []);

  if (cat.error) return <ErrorNote message={cat.error} retry={cat.reload} />;
  if (!cat.data) return <Skeleton lines={8} height={28} />;
  if (!cat.data.contractId) return <section className="panel"><Empty title="Loot is off on this server" action={<Link className="btn primary sm" to="/play">Back to the vaults</Link>}>It needs the veyra-loot contract.</Empty></section>;
  const C = cat.data;
  const bal = (id: string) => Number(mine.data?.balances[id] ?? 0);
  const owned = C.items.filter((i) => bal(i.token_id) > 0);
  const total = C.items.reduce((t, i) => t + Number(i.supply), 0);
  const chosen = owned.find((i) => i.token_id === item) ?? owned[0];
  const qty = Number(amount);
  const errors = {
    to: to && !ACCOUNT.test(to) ? "Enter a NEAR account, like friend.testnet." : to === h.account ? "That is your own account." : null,
    amount: !(Number.isInteger(qty) && qty >= 1) ? "Enter a whole number, 1 or more." : chosen && qty > bal(chosen.token_id) ? `You have ${bal(chosen.token_id)}.` : null,
  };

  const send = () => {
    if (!chosen || !C.contractId) return;
    const contract = C.contractId;
    tx.open({
      title: `Send ${qty} ${chosen.metadata.title}${qty > 1 ? "s" : ""}`,
      intro: <>To <b className="mono">{to}</b>. Items move with the NEP-245 <span className="mono">mt_transfer</span> call, straight between wallets.</>,
      depositYocto: 1n,
      depositLabel: "Security deposit",
      depositExplain: { what: "NEP-245 requires exactly 1 yoctoNEAR (10⁻²⁴ NEAR) on every transfer, so only a wallet with full access can move items. It goes to the contract." },
      outcome: async () => <><b className="mono">{to}</b> receives {qty}. You keep {bal(chosen.token_id) - qty}.</>,
      confirmLabel: "Send",
      run: async ({ phase, hash }) => {
        phase("signing");
        const t = await sendItem(h.network, contract, to, chosen.token_id, qty);
        hash(t);
        phase("pending");
        await waitForTx(t, h.account!);
        return t;
      },
      success: () => `Sent ${qty} ${chosen.metadata.title} to ${to}.`,
      onDone: () => { invalidate("/heist/loot"); void mine.reload(); void cat.reload(); setTo(""); },
    });
  };

  return (
    <div className="stack-lg">
      {tx.sheet}
      <div className="page-head">
        <h1>Loot</h1>
        <p>Every item in Veyra Heist lives in one NEP-245 multi-token contract. Crack a vault in a ranked heist and its gold bar is minted to your wallet. It is yours: keep it, show it, or send it to anyone.</p>
      </div>

      <section className="panel loot-contract">
        <div><span className="stat-k">Contract</span><a className="mono" href={C.explorer} target="_blank" rel="noreferrer">{C.contractId} <Icon icon={ArrowUpRight01Icon} size={12} /></a></div>
        <div><span className="stat-k">Standard</span><Explain title="NEP-245" what="NEAR's multi-token standard: one contract holds many item types, each with its own supply, and wallets and markets can read and move them the same way everywhere." how="This contract implements mt_transfer, mt_batch_transfer, mt_transfer_call, balances, supply, metadata and the standard mint and transfer events."><b>NEP-245</b></Explain></div>
        <div><span className="stat-k">Item types</span><b className="mono">{C.items.length}</b></div>
        <div><span className="stat-k">Bars minted</span><b className="mono gold-ink">{total}</b></div>
      </section>

      <div className="loot-grid">
        {C.items.map((i) => {
          const v = Number(i.token_id.split("-")[1]);
          return (
            <section key={i.token_id} className={`panel loot-item ${bal(i.token_id) > 0 ? "owned" : ""}`} aria-label={i.metadata.title}>
              <VaultEmblem id={v} size={120} />
              <h2>{i.metadata.title}</h2>
              <p className="small muted">{i.metadata.description}</p>
              <dl className="ff-kv">
                <dt>In circulation</dt><dd className="mono">{i.supply}</dd>
                {h.account && <><dt>You own</dt><dd className="mono gold-ink">{bal(i.token_id)}</dd></>}
                <dt>Token id</dt><dd className="mono">{i.token_id}</dd>
              </dl>
              {bal(i.token_id) === 0 && <Link className="btn sm" to={`/play/vault/${v}`}>Earn it on vault {v}</Link>}
            </section>
          );
        })}
      </div>

      <section className="panel" aria-labelledby="send-title">
        <div className="panel-head"><h2 id="send-title">Send an item</h2>{h.account && <a href={explorerAccount(h.network, h.account)} target="_blank" rel="noreferrer">Your wallet</a>}</div>
        {!h.account ? (
          <Empty title="Connect a wallet to see and send your loot" action={<Button variant="primary" size="sm" onClick={() => void h.connect()}>Connect wallet</Button>}>Bars are minted to the wallet that wins a ranked heist.</Empty>
        ) : !owned.length ? (
          <Empty title="No bars yet" action={<Link className="btn primary sm" to="/play/vault/1?move=redirect&confirm=ranked">Win vault 1 ranked</Link>}>Crack a vault in a ranked heist and its gold bar lands here.</Empty>
        ) : (
          <div className="form-grid loot-send">
            <Select label="Item" value={chosen?.token_id ?? ""} onChange={setItem}>{owned.map((i) => <option key={i.token_id} value={i.token_id}>{i.metadata.title} (you have {bal(i.token_id)})</option>)}</Select>
            <Field label="To (NEAR account)" value={to} onChange={(x) => setTo(x.trim().toLowerCase())} placeholder="friend.testnet" error={errors.to} />
            <Field label="How many" value={amount} onChange={setAmount} inputMode="numeric" error={errors.amount} />
            <div className="field"><span className="field-label" aria-hidden="true">&nbsp;</span><Button variant="primary" disabled={!to || Boolean(errors.to || errors.amount) || tx.busy} onClick={send}>Send</Button></div>
          </div>
        )}
      </section>
    </div>
  );
}
