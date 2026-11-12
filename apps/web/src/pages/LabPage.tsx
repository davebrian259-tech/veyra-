import { useState } from "react";
import { post } from "../api";
import { Section } from "../ui";

const SCENARIOS = [
  { id: "payee-swap", name: "Payee swap", what: "The agent's 402 challenge asks for payment to an attacker's account instead of the market treasury.", defence: "The payee is pinned to the market's own /.well-known/x402." },
  { id: "bait-and-switch", name: "Bait and switch", what: "Listed at 0.10 USDC, the agent asks for 1.00 USDC at payment time.", defence: "The 402 amount must equal the published pricing plan." },
  { id: "prompt-injection", name: "Poisoned deliverable", what: "The deliverable hides instructions telling Veyra to send 25 USDC to the attacker. The simulator assumes the model obeys them.", defence: "Injection scanning, taint tracking of payment parameters, and no general transfer capability." },
  { id: "no-show", name: "No-show", what: "The agent accepts the cheque and never delivers.", defence: "Cheques settle only on delivery. Veyra cancels after the SLA and the cheque is never cashed." },
];

/** Run adversarial counterparties against Veyra, offline, with real signed cheques. */
export function LabPage({ open }: { open: (id: string) => void }) {
  const [results, setResults] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <>
      <p className="note">Each scenario puts one hostile agent from the simulated market first in line and runs a real contract against it. The money is play money on an in-memory ledger; the cheques are real NEP-366 signatures.</p>
      <div className="cards">
        {SCENARIOS.map((s) => {
          const r = results[s.id];
          return (
            <Section key={s.id} title={s.name}>
              <p><strong>Attack:</strong> {s.what}</p>
              <p><strong>Defence:</strong> {s.defence}</p>
              <button disabled={busy !== null} onClick={async () => {
                setBusy(s.id);
                try { setResults({ ...results, [s.id]: await post(`/lab/${s.id}`) }); } finally { setBusy(null); }
              }}>{busy === s.id ? "Running…" : "Run attack"}</button>
              {r && (
                <div className="lab-result">
                  <p><span className={`pill ${r.attacker.balance === "0" ? "good" : "bad"}`}>attacker received {(Number(r.attacker.balance) / 1e6).toFixed(2)} USDC</span> <span className="pill">contract {r.contract.status}</span></p>
                  <ol className="timeline">{r.securityEvents.map((e: any) => <li key={e.id} className={/retry/.test(e.kind) ? "" : "bad"}><span className="mono kind">{e.kind}</span> {e.message}</li>)}</ol>
                  <button onClick={() => open(r.contract.id)}>Open contract</button>
                </div>
              )}
            </Section>
          );
        })}
      </div>
    </>
  );
}
