import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Dialog } from "radix-ui";
import { toast } from "sonner";
import { Alert02Icon, ArrowUpRight01Icon, Cancel01Icon, CheckmarkCircle02Icon, Wallet02Icon } from "@hugeicons/core-free-icons";
import { Icon } from "../brand";
import { Button } from "../ui";
import { friendly, FAUCET_URL, type Friendly } from "./errors";
import { Explain } from "./explain";
import { explorerTx, GAS_TGAS, nearNum, YOCTO } from "./heist-api";
import { useHeist } from "./session";

/**
 * One hook for every change call on the pot contract. It shows a confirmation sheet first (cost,
 * deposit, gas, expected outcome, resulting balance), then walks through each state:
 * preparing, waiting for the wallet, confirming on NEAR, (for heists) the referee, confirmed or failed.
 */
export type Phase = "review" | "preparing" | "signing" | "pending" | "settling" | "confirmed" | "failed";

export interface TxPlan<T> {
  title: string;
  intro?: ReactNode;
  /** What the call attaches. Shown as the cost and subtracted from the balance. */
  depositYocto: bigint;
  depositLabel: string;
  depositExplain: { what: ReactNode; how?: ReactNode };
  /** Loaded when the sheet opens: what will happen if the player confirms. */
  outcome?: () => Promise<ReactNode>;
  confirmLabel: string;
  /** Adds the "referee" step for ranked entries. */
  settles?: boolean;
  run: (ctl: { phase: (p: Phase) => void; hash: (h: string) => void }) => Promise<T>;
  success: (r: T) => string;
  onDone?: (r: T) => void;
  /** Rolls back anything shown optimistically. */
  onFail?: () => void;
  onClose?: () => void;
}

const STEPS: { id: Phase; label: string; settlesOnly?: boolean }[] = [
  { id: "preparing", label: "Preparing" },
  { id: "signing", label: "Waiting for your wallet" },
  { id: "pending", label: "Confirming on NEAR" },
  { id: "settling", label: "The referee runs the duel and settles it", settlesOnly: true },
  { id: "confirmed", label: "Done" },
];
const ORDER: Phase[] = ["review", "preparing", "signing", "pending", "settling", "confirmed"];

export function useTx() {
  const heist = useHeist();
  const [plan, setPlan] = useState<TxPlan<any> | null>(null);
  const [phase, setPhase] = useState<Phase>("review");
  const [hash, setHash] = useState<string | null>(null);
  const [error, setError] = useState<Friendly | null>(null);
  const [failedAt, setFailedAt] = useState<Phase>("review");
  const [outcome, setOutcome] = useState<ReactNode>(null);
  const phaseRef = useRef<Phase>("review");
  const setP = (p: Phase) => { phaseRef.current = p; setPhase(p); };

  const open = useCallback(<T,>(p: TxPlan<T>, start: Phase = "review") => {
    setPlan(p); setHash(null); setError(null); setOutcome(null); setP(start);
  }, []);

  useEffect(() => {
    if (!plan?.outcome || phase !== "review") return;
    let live = true;
    setOutcome(<span className="muted">Asking the referee…</span>);
    plan.outcome().then((o) => live && setOutcome(o)).catch(() => live && setOutcome(<span className="muted">The referee could not preview this one.</span>));
    return () => { live = false; };
  }, [plan, phase]);

  const close = useCallback(() => {
    if (["preparing", "signing", "pending", "settling"].includes(phaseRef.current)) return; // never abandon a live transaction
    plan?.onClose?.();
    setPlan(null);
    setP("review");
  }, [plan]);

  const runPlan = useCallback(async (p: TxPlan<any>, from?: Phase) => {
    setError(null);
    setP(from ?? "preparing");
    let txHash: string | null = null;
    try {
      const r = await p.run({ phase: setP, hash: (h) => { txHash = h; setHash(h); } });
      setP("confirmed");
      const link = txHash ? explorerTx(heist.network, txHash) : null;
      toast.success(p.success(r), link ? { action: { label: "View on NEAR", onClick: () => window.open(link, "_blank", "noopener") }, duration: 7000 } : undefined);
      p.onDone?.(r);
      void heist.reloadAccount();
    } catch (e) {
      p.onFail?.();
      const f = friendly(e);
      setFailedAt(phaseRef.current);
      setError(f);
      setP("failed");
      toast.error(f.title, { description: f.fix });
    }
  }, [heist]);
  const confirm = (from?: Phase) => { if (plan) void runPlan(plan, from); };

  /** Continues a plan that started before a page load (redirect wallets come back mid-flow). */
  const resume = useCallback(<T,>(p: TxPlan<T>, from: Phase) => {
    setPlan(p); setHash(null); setOutcome(null);
    void runPlan(p, from);
  }, [runPlan]);

  const balance = heist.acct ? BigInt(heist.acct.balanceYocto) : null;
  const gasMax = BigInt(GAS_TGAS) * 10n ** 12n * BigInt(heist.acct?.gasPriceYocto ?? "100000000");
  const after = balance !== null && plan ? balance - plan.depositYocto - gasMax : null;
  const short = after !== null && after < YOCTO / 100n; // keep at least 0.01 NEAR for storage
  const steps = STEPS.filter((s) => !s.settlesOnly || plan?.settles);
  const at = phase === "failed" ? failedAt : phase;
  const live = ["preparing", "signing", "pending", "settling"].includes(phase);

  const sheet = (
    <Dialog.Root open={Boolean(plan)} onOpenChange={(o) => { if (!o) close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="sheet-overlay" />
        <Dialog.Content className="sheet arena-portal" aria-describedby={undefined} onEscapeKeyDown={(e) => { if (live) e.preventDefault(); }} onPointerDownOutside={(e) => { if (live) e.preventDefault(); }}>
          {plan && (
            <>
              <div className="sheet-head">
                <Dialog.Title asChild><h2>{plan.title}</h2></Dialog.Title>
                <Dialog.Close asChild><button className="btn ghost sm icon" aria-label="Close" disabled={live}><Icon icon={Cancel01Icon} size={16} /></button></Dialog.Close>
              </div>
              {plan.intro && <div className="sheet-intro">{plan.intro}</div>}

              {phase === "review" && (
                <>
                  <dl className="cost">
                    <dt><Explain title={plan.depositLabel} what={plan.depositExplain.what} how={plan.depositExplain.how}>{plan.depositLabel}</Explain></dt>
                    <dd className="mono gold-ink">{nearNum(plan.depositYocto).toFixed(plan.depositYocto % (YOCTO / 100n) ? 4 : 2)} NEAR</dd>
                    <dt><Explain title="Network fee" what="NEAR charges a small fee in gas to run the call. The wallet reserves the maximum; whatever is not burned comes straight back." how={`${GAS_TGAS} Tgas attached × the current gas price of ${(Number(heist.acct?.gasPriceYocto ?? 100000000) / 1e8).toFixed(1)}×10⁻¹⁶ NEAR per gas.`}>Network fee</Explain></dt>
                    <dd className="mono">up to {nearNum(gasMax).toFixed(4)} NEAR</dd>
                    {balance !== null && <><dt>Your balance</dt><dd className="mono">{nearNum(balance).toFixed(4)} NEAR</dd></>}
                    {after !== null && <><dt>After this</dt><dd className={`mono ${short ? "bad-ink" : ""}`}>{nearNum(after < 0n ? 0n : after).toFixed(4)} NEAR</dd></>}
                  </dl>
                  {plan.outcome && <div className="expect"><span className="expect-k">Expected outcome</span><div>{outcome}</div></div>}
                  {!heist.account ? (
                    <div className="sheet-actions">
                      <p className="small muted">Connect a NEAR {heist.network} wallet to continue. This sheet stays open.</p>
                      <Button variant="primary" className="big" onClick={() => void heist.connect()}><Icon icon={Wallet02Icon} size={18} /> Connect wallet</Button>
                    </div>
                  ) : (
                    <div className="sheet-actions">
                      {short && <div className="alert bad" role="alert"><Icon icon={Alert02Icon} size={18} /><div>Not enough testnet NEAR in <b className="mono">{heist.account}</b>. <a href={FAUCET_URL} target="_blank" rel="noreferrer">Get some free from the faucet</a>, then come back.</div></div>}
                      <Button variant="primary" className="big" disabled={short} onClick={() => void confirm()}>{plan.confirmLabel}</Button>
                      <p className="small muted">You sign as <span className="mono">{heist.account}</span> on NEAR {heist.network}. Nothing moves until you approve it in your wallet.</p>
                    </div>
                  )}
                </>
              )}

              {phase !== "review" && (
                <ol className="tx-steps" aria-live="polite">
                  {steps.map((s) => {
                    const i = ORDER.indexOf(s.id), cur = ORDER.indexOf(at);
                    const state = phase === "failed" && s.id === failedAt ? "failed" : i < cur || phase === "confirmed" ? "done" : i === cur ? "active" : "todo";
                    return (
                      <li key={s.id} className={`tx-step ${state}`}>
                        <span className="dot" aria-hidden="true">{state === "done" ? <Icon icon={CheckmarkCircle02Icon} size={16} /> : state === "failed" ? <Icon icon={Alert02Icon} size={16} /> : null}</span>
                        <span>{s.label}<span className="sr-only"> ({state === "active" ? "in progress" : state === "todo" ? "waiting" : state})</span></span>
                      </li>
                    );
                  })}
                </ol>
              )}

              {hash && <p className="small tx-link"><a href={explorerTx(heist.network, hash)} target="_blank" rel="noreferrer">See the transaction on NearBlocks <Icon icon={ArrowUpRight01Icon} size={12} /></a></p>}

              {phase === "failed" && error && (
                <div className="sheet-actions">
                  <div className="alert bad" role="alert">
                    <Icon icon={Alert02Icon} size={18} />
                    <div><b>{error.title}</b><p className="small">{error.fix}{error.link && <> <a href={error.link.href} target="_blank" rel="noreferrer">{error.link.label}</a></>}</p></div>
                  </div>
                  <div className="btn-row">
                    <Button variant="primary" onClick={() => (failedAt === "settling" ? void confirm("settling") : setP("review"))}>{failedAt === "settling" ? "Retry settlement" : "Try again"}</Button>
                    <Dialog.Close asChild><Button>Close</Button></Dialog.Close>
                  </div>
                  <details className="disclosure"><summary>Technical detail</summary><pre className="json">{error.raw}</pre></details>
                </div>
              )}
              {phase === "confirmed" && <div className="sheet-actions"><Dialog.Close asChild><Button variant="primary" className="big">Done</Button></Dialog.Close></div>}
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );

  return { open, resume, sheet, busy: live, phase };
}
