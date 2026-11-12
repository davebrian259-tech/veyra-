import { useState } from "react";
import { useOutletContext } from "react-router";
import type { useApi } from "../lib/data";
import { invalidate } from "../lib/data";
import { Button, Empty, ErrorNote, Field, Skeleton, useAction } from "../ui";
import { TONES, VaultEmblem } from "./art";
import { near, underwrite, withdrawStake, type Lobby } from "./heist-api";

type LobbyCtx = ReturnType<typeof useApi<Lobby>>;

/** The other side of the game: back a vault's defence, earn from failed heists, lose it all on a crack. */
export default function Underwrite() {
  const lobby = useOutletContext<LobbyCtx>();
  const [amount, setAmount] = useState<Record<number, string>>({});
  const { run, busy } = useAction();
  if (lobby.error) return <ErrorNote message={lobby.error} retry={lobby.reload} />;
  if (!lobby.data) return <Skeleton lines={8} height={28} />;
  const { vaults, ranked } = lobby.data;
  if (!ranked.enabled || !ranked.contractId) return <section className="panel"><Empty title="Underwriting is off on this server">It needs the Heist pot contract. Practice runs still work.</Empty></section>;
  return (
    <div className="stack-lg">
      <section className="panel">
        <div className="panel-head"><h2>Back a vault</h2></div>
        <p className="muted" style={{ maxWidth: "70ch" }}>Your stake joins the vault's pot. Every failed ranked heist pays 20% of its entry fee to the vault's backers, shared by stake. If someone cracks the vault, the whole pot goes to them, your stake included. Back the vaults you believe will hold.</p>
      </section>
      <div className="grid-3">
        {vaults.map((v) => {
          const val = amount[v.id] ?? "0.5";
          const bad = !(Number(val) > 0) ? "Enter an amount above 0." : null;
          return (
            <section key={v.id} className="panel" style={{ ["--glow" as string]: TONES[v.tone].glow }}>
              <div className="btn-row" style={{ alignItems: "center", gap: "var(--s-4)", flexWrap: "nowrap" }}>
                <VaultEmblem id={v.id} tone={v.tone} shields={v.shields.length} size={84} />
                <div><h2>{v.name}</h2><p className="small muted">{v.shields.length} shields · {v.chain?.cracks ?? 0} cracks</p></div>
              </div>
              <dl className="kv" style={{ margin: "var(--s-4) 0" }}>
                <dt>Pot</dt><dd className="mono" style={{ color: "var(--gold)" }}>{near(v.chain?.potYocto)} NEAR</dd>
                <dt>Backed</dt><dd className="mono">{near(v.chain?.stakedYocto)} NEAR</dd>
                <dt>Attempts</dt><dd>{v.chain?.attempts ?? 0}</dd>
              </dl>
              <Field label="Stake (testnet NEAR)" value={val} onChange={(x) => setAmount({ ...amount, [v.id]: x })} inputMode="decimal" error={bad} />
              <div className="btn-row" style={{ marginTop: "var(--s-3)" }}>
                <Button variant="primary" disabled={Boolean(bad)} loading={busy === `uw${v.id}`} onClick={() => run(`uw${v.id}`, async () => { await underwrite(ranked.network, ranked.contractId!, v.id, val); invalidate("/heist"); await lobby.reload(); }, { success: `You now back vault ${v.id}.` })}>Back vault {v.id}</Button>
                <Button loading={busy === `wd${v.id}`} onClick={() => run(`wd${v.id}`, async () => { await withdrawStake(ranked.network, ranked.contractId!, v.id); invalidate("/heist"); await lobby.reload(); }, { success: "Stake and earnings withdrawn." })}>Withdraw</Button>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
