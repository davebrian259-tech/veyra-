import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Alert02Icon } from "@hugeicons/core-free-icons";
import { api } from "../api";
import { Icon } from "../brand";
import { Button } from "../ui";
import { explorerTx, loadPending, reclaim, savePending, waitForTx, type Pending, type TxInfo } from "./heist-api";
import { settlePlan } from "./plans";
import { useHeist } from "./session";
import { useTx } from "./tx";

const DAY_MS = 24 * 3600 * 1000;

/**
 * A ranked entry that was paid but never settled (a closed tab, a redirect wallet, a server
 * hiccup) shows up here on every screen, with a way to settle it or, after 24 hours, reclaim it.
 */
export default function PendingEntry() {
  const h = useHeist();
  const navigate = useNavigate();
  const tx = useTx();
  const [p, setP] = useState<Pending | null>(loadPending);
  const [info, setInfo] = useState<TxInfo | null>(null);
  useEffect(() => { const f = () => setP(loadPending()); window.addEventListener("veyra:pending", f); return () => window.removeEventListener("veyra:pending", f); }, []);

  useEffect(() => {
    if (!p?.txHash) return;
    let live = true;
    api<TxInfo>(`/heist/tx/${p.txHash}?sender=${encodeURIComponent(p.accountId)}`).then((t) => {
      if (!live) return;
      if (t.runId || (t.entry && t.entry.status !== "Pending") || (t.found && t.success === false)) { savePending(null); return; }
      setInfo(t);
    }).catch(() => undefined);
    return () => { live = false; };
  }, [p]);

  // Coming back from a redirect wallet: the hash is in the URL. Settle straight away.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const hash = q.get("transactionHashes")?.split(",")[0];
    const pend = loadPending();
    if (!hash || !pend) return;
    q.delete("transactionHashes");
    window.history.replaceState(null, "", `${window.location.pathname}${q.size ? `?${q}` : ""}`);
    savePending({ ...pend, txHash: hash });
    tx.resume(settlePlan(h, { ...pend, txHash: hash }, (r) => navigate(`/play/vault/${r.vault}?run=${r.id}`)), "pending");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!p) return tx.sheet;
  if (!p.txHash) {
    // signing never finished: nothing was charged unless the wallet says otherwise
    if (Date.now() - p.at < 10 * 60_000) return tx.sheet;
    return (
      <>{tx.sheet}
        <div className="alert pending-entry" role="status">
          <Icon icon={Alert02Icon} size={18} />
          <div style={{ flex: 1 }}>An entry into vault {p.vault} was started but never signed. Nothing was charged.</div>
          <Button size="sm" onClick={() => savePending(null)}>Dismiss</Button>
        </div>
      </>
    );
  }
  if (!info?.entry) return tx.sheet;
  const enteredMs = Number(BigInt(info.entry.entered_at_ns) / 1_000_000n);
  const canReclaim = Date.now() >= enteredMs + DAY_MS;
  const hours = Math.max(0, Math.ceil((enteredMs + DAY_MS - Date.now()) / 3_600_000));
  const pend = { txHash: p.txHash, accountId: p.accountId, spec: p.spec, vault: p.vault };
  return (
    <>
      {tx.sheet}
      <div className="alert warn pending-entry" role="status">
        <Icon icon={Alert02Icon} size={18} />
        <div style={{ flex: 1 }}>
          <b>Your vault {p.vault} entry is paid but not settled.</b>{" "}
          <span className="small">Your fee is safe in the contract (<a href={explorerTx(h.network, p.txHash)} target="_blank" rel="noreferrer">entry #{info.entryId}</a>). {canReclaim ? "It has waited over 24 hours, so you can take the fee back." : `Settle it now, or reclaim the fee in ${hours} hour${hours === 1 ? "" : "s"}.`}</span>
        </div>
        <div className="btn-row">
          <Button size="sm" variant="primary" disabled={tx.busy} onClick={() => tx.open(settlePlan(h, pend, (r) => navigate(`/play/vault/${r.vault}?run=${r.id}`)))}>Settle it</Button>
          {canReclaim && h.account === p.accountId && (
            <Button size="sm" disabled={tx.busy} onClick={() => tx.open({
              title: `Reclaim your vault ${p.vault} fee`, intro: "The referee never settled this entry, so the contract returns your fee.",
              depositYocto: 0n, depositLabel: "Nothing to pay", depositExplain: { what: "Reclaiming costs only the network fee." },
              confirmLabel: "Reclaim fee",
              run: async ({ phase, hash }) => { phase("signing"); const t = await reclaim(h.network, h.contractId!, info.entryId!); hash(t); phase("pending"); await waitForTx(t, h.account!); savePending(null); return t; },
              success: () => "Fee reclaimed to your wallet.",
            })}>Reclaim fee</Button>
          )}
        </div>
      </div>
    </>
  );
}
