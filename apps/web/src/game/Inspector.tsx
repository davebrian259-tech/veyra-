import { Link, useNavigate } from "react-router";
import { Dialog } from "radix-ui";
import { ArrowUpRight01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "../brand";
import { useApi, when } from "../lib/data";
import { Empty, ErrorNote, Skeleton } from "../ui";
import { RogueAvatar } from "./art";
import { Explain } from "./explain";
import { explorerAccount, usdc, type Player } from "./heist-api";
import { useHeist, useSetParams } from "./session";

/**
 * The agent inspector: any player's rogue agents, their record and recent heists. Deep-linked as
 * ?player=<callsign or account> on any game screen. Your own agents can be loaded back into the
 * workshop; anyone else's build can be copied to try in practice.
 */
export default function Inspector({ who }: { who: string }) {
    const navigate = useNavigate();
  const h = useHeist();
  const p = useApi<Player>(`/heist/players/${encodeURIComponent(who)}`, { every: 15_000 });
  const mine = who === h.progress.callsign || who === h.account;
  const setP = useSetParams();
  const close = () => setP({ player: null });
  const isAccount = /\.(testnet|near)$/.test(who);
  return (
    <Dialog.Root open onOpenChange={(o) => { if (!o) close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="sheet-overlay" />
        <Dialog.Content className="sheet arena-portal inspector" aria-describedby={undefined}>
          <div className="sheet-head">
            <div className="who-big"><RogueAvatar seed={who} size={56} /><div><Dialog.Title asChild><h2>{who}</h2></Dialog.Title><span className="small muted">{mine ? "You" : "Player"}{isAccount ? ` · NEAR ${h.network} account` : " · practice callsign"}</span></div></div>
            <Dialog.Close asChild><button className="btn ghost sm icon" aria-label="Close"><Icon icon={Cancel01Icon} size={16} /></button></Dialog.Close>
          </div>
          {p.error && <ErrorNote message={p.error} retry={p.reload} />}
          {!p.data && !p.error && <Skeleton lines={6} height={22} />}
          {p.data && (
            <>
              <div className="mini-stats four">
                <div><b>{p.data.runs}</b><span>heists</span></div>
                <div><b>{p.data.cracks}</b><span>cracks</span></div>
                <div><b>{p.data.cracked.length ? Math.max(...p.data.cracked) : "—"}</b><span>best vault</span></div>
                <div><Explain title="Loot" what="Play money taken in practice plus USDC scored in ranked heists." how="Sum of loot over every crack.">
                  <b className="gold-ink">{usdc(p.data.lootAtomic)}</b></Explain><span>loot</span></div>
              </div>
              {isAccount && <a className="btn sm" href={explorerAccount(h.network, who)} target="_blank" rel="noreferrer">Account on NearBlocks <Icon icon={ArrowUpRight01Icon} size={12} /></a>}

              <h3 className="sheet-sub">Agents</h3>
              {!p.data.agents.length && <Empty title="No agents yet" action={mine ? <Link className="btn primary sm" to="/play/vault/1?move=redirect" onClick={close}>Build one on vault 1</Link> : undefined}>{mine ? "Your first heist creates your first agent." : "This player has not played yet."}</Empty>}
              <ul className="agent-list">
                {p.data.agents.map((a) => (
                  <li key={a.name}>
                    <RogueAvatar seed={a.name} size={40} />
                    <div className="grow"><b>{a.name}</b><span className="small muted">{a.runs} heists · {a.cracks} cracks{a.bestVault ? ` · best vault ${a.bestVault}` : ""}</span></div>
                    <button type="button" className="btn sm" onClick={() => { close(); navigate(`/play/vault/${Math.min(5, (a.bestVault || 0) + 1)}?load=${a.lastRunId}`); }}>{mine ? "Load in workshop" : "Try this build"}</button>
                  </li>
                ))}
              </ul>

              <h3 className="sheet-sub">Recent heists</h3>
              <ul className="feed compact">
                {p.data.recent.map((r) => (
                  <li key={r.id}><Link to={`/play/runs/${r.id}`} onClick={close}><span className={`pill ${r.cracked ? "gold" : ""}`}>{r.cracked ? "cracked" : "held"}</span> Vault {r.vault} with {r.spec.agentName}{r.kind === "ranked" && <span className="chip gold">ranked</span>}<span className="small muted feed-when">{when(r.createdAt)}</span></Link></li>
                ))}
              </ul>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
