import { useEffect, useState } from "react";
import { api, post } from "../api";
import { sendAndRecord } from "../flows";
import { Btn, Field, Json, Section, useRunner } from "../ui";

const EXAMPLE = "I have $200. Find someone who can build my business website. Keep the cost below $150. Do not release payment until the work is completed. Keep the remaining funds safe.";

/** Autonomous mode: goal → plan → providers → offers → negotiation → (owner) select → escrow. */
export function AutonomousPage() {
  const r = useRunner();
  const [prompt, setPrompt] = useState(EXAMPLE);
  const [agentId, setAgentId] = useState("");
  const [agents, setAgents] = useState<any[]>([]);
  const [run, setRun] = useState<any>(null);
  const [goals, setGoals] = useState<any[]>([]);
  const [funding, setFunding] = useState<"wallet" | "agent">("wallet");

  const load = async () => {
    setAgents((await api("/agents")).agents);
    setGoals((await api("/goals")).goals);
  };
  useEffect(() => void load(), []);

  return (
    <>
      <Section title="Give Veyra a goal" note="Sensitive goal reasoning runs on NEAR AI Cloud (TEE-attested) when configured; otherwise a labelled deterministic planner is used. The AI only proposes — it cannot move funds or release escrow.">
        <Field label="Goal" value={prompt} onChange={setPrompt} textarea />
        <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
          <option value="">No agent (plan + marketplace only)</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <Btn onClick={() => r.run("Planning and gathering offers", async () => { const x = await post("/autonomous/run", { prompt, agentId: agentId || null }); setRun(x); await load(); return x; })}>Run</Btn>
      </Section>

      {run?.recommendation && (
        <Section title="Recommended offer" note="You decide. Selecting and funding escrow are your actions.">
          <Json value={{ provider: run.recommendation.provider?.name, priceUsd: run.recommendation.price_usd, etaDays: run.recommendation.eta_days, simulated: run.recommendation.simulated }} />
          <Btn onClick={() => r.run("Selecting", () => post(`/wanted/jobs/${run.jobId}/select`, { offerId: run.recommendation.offerId }))}>Select this provider</Btn>
          <select value={funding} onChange={(e) => setFunding(e.target.value as "wallet" | "agent")}>
            <option value="wallet">Fund escrow from my wallet</option>
            <option value="agent">Fund escrow from the agent (mainnet)</option>
          </select>
          <Btn onClick={() => r.run("Creating escrow", async () => {
            const esc = await post(`/wanted/jobs/${run.jobId}/escrow`, { fundingMode: funding, agentId: agentId || undefined });
            if (esc.walletTransactions) {
              const sent = await sendAndRecord(esc.walletTransactions, (h) => post(`/escrows/${esc.escrowId}/confirm`, { txHash: h }));
              return { escrow: esc, sent };
            }
            return esc;
          })}>Create & fund UNDO escrow</Btn>
        </Section>
      )}

      <Section title="Goals">
        {goals.map((g) => (
          <div key={g.id} className="row">
            <span>{g.kind} · {g.title} · {g.status}</span>
            <Btn onClick={() => r.run("Loading", () => api(`/goals/${g.id}`))}>Details</Btn>
            {["allocate", "convert", "rebalance"].includes(g.kind) && <>
              <Btn onClick={() => r.run("Proposal", () => post(`/goals/${g.id}/proposal`))}>Proposed swaps</Btn>
              <Btn onClick={() => r.run("Executing", () => post(`/goals/${g.id}/execute`))}>Execute via BODYGUARD</Btn>
            </>}
          </div>
        ))}
      </Section>
      {r.view}
    </>
  );
}
