import { useState } from "react";
import { Link } from "react-router";
import { post } from "../api";
import { invalidate, usd } from "../lib/data";
import { Button, Card, Pill, useAction } from "../ui";

const SCENARIOS = [
  { id: "payee-swap", name: "Payee swap", what: "The agent's 402 asks for payment to an attacker's account instead of the market treasury.", defence: "The payee is pinned to the market's own /.well-known/x402." },
  { id: "bait-and-switch", name: "Bait and switch", what: "Listed at 0.10 USDC, the agent asks for 1.00 USDC at payment time.", defence: "The 402 amount must equal the published pricing plan." },
  { id: "prompt-injection", name: "Poisoned deliverable", what: "The deliverable hides instructions telling Veyra to send 25 USDC to the attacker. The simulator assumes the model obeys them.", defence: "Injection scanning, taint tracking of payment parameters, and no general transfer capability." },
  { id: "no-show", name: "No-show", what: "The agent accepts the cheque and never delivers.", defence: "Cheques settle only on delivery. Veyra cancels after the SLA and the cheque is never cashed." },
];

/** Hostile counterparties against Veyra, offline, with real signed cheques. */
export default function LabPage() {
  const [results, setResults] = useState<Record<string, any>>({});
  const { run, busy } = useAction();
  return (
    <div className="stack">
      <p className="small muted">Each scenario puts one hostile agent from the simulated market first in line and runs a real contract against it. The money is play money on an in-memory ledger; the cheques are real NEP-366 signatures.</p>
      <div className="grid-2">
        {SCENARIOS.map((s) => {
          const r = results[s.id];
          return (
            <Card key={s.id} title={s.name}>
              <p className="small"><strong>Attack.</strong> {s.what}</p>
              <p className="small" style={{ marginTop: "var(--s-2)" }}><strong>Defence.</strong> {s.defence}</p>
              <div className="btn-row" style={{ marginTop: "var(--s-3)" }}>
                <Button variant="primary" disabled={busy !== null && busy !== s.id} loading={busy === s.id} onClick={() => run(s.id, async () => { const x = await post(`/lab/${s.id}`); setResults((o) => ({ ...o, [s.id]: x })); invalidate("/ledger"); invalidate("/contracts"); })}>Run attack</Button>
              </div>
              {r && (
                <div className="stack" style={{ marginTop: "var(--s-4)" }}>
                  <div className="btn-row">
                    <Pill tone={r.attacker.balance === "0" ? "good" : "bad"}>attacker received {usd(r.attacker.balance)} USDC</Pill>
                    <Pill>contract {r.contract.status}</Pill>
                  </div>
                  <ol className="timeline">{r.securityEvents.map((e: any) => <li key={e.id} className={/retry/.test(e.kind) ? "" : "bad"}><span className="kind">{e.kind}</span><span>{e.message}</span></li>)}</ol>
                  <Link className="btn sm" to={`/app/contracts/${r.contract.id}`}>Open the contract</Link>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
