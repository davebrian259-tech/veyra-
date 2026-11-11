import { useState } from "react";
import { api, post, type WalletTx } from "../api";
import { sendAndRecord } from "../flows";
import { Btn, Field, Json, Section, toYocto, useRunner } from "../ui";

/** Manual mode: your wallet signs; Veyra explains, checks and tracks. */
export function WalletPage() {
  const r = useRunner();
  const [send, setSend] = useState({ asset: "NEAR", amount: "0.1", receiver: "" });
  const [analysis, setAnalysis] = useState<any>(null);
  const [swap, setSwap] = useState({ originAsset: "nep141:wrap.near", destinationAsset: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", amount: "1000000000000000000000000", slippageBps: "100" });
  const [live, setLive] = useState<any>(null);

  const atomic = () => (send.asset === "NEAR" ? toYocto(send.amount) : send.amount);
  const buildTx = (): WalletTx =>
    send.asset === "NEAR"
      ? { receiverId: send.receiver, actions: [{ type: "Transfer", params: { deposit: atomic() } }] }
      : { receiverId: send.asset.replace(/^nep141:/, ""), actions: [{ type: "FunctionCall", params: { methodName: "ft_transfer", args: { receiver_id: send.receiver, amount: atomic() }, gas: "30000000000000", deposit: "1" } }] };

  return (
    <>
      <Section title="Balances">
        <Btn onClick={() => r.run("Loading balances", () => api("/wallet/balances"))}>Refresh</Btn>
        <Btn onClick={() => r.run("Loading insights", () => api("/wallet/insights"))}>Spending insights</Btn>
        <Btn onClick={() => r.run("Loading history", () => api("/wallet/history"))}>History</Btn>
      </Section>

      <Section title="Send" note='Asset: "NEAR", or a token contract (e.g. usdc.fakes.testnet). Token amounts are in atomic units.'>
        <Field label="Asset" value={send.asset} onChange={(v) => setSend({ ...send, asset: v })} />
        <Field label={send.asset === "NEAR" ? "Amount (NEAR)" : "Amount (atomic)"} value={send.amount} onChange={(v) => setSend({ ...send, amount: v })} />
        <Field label="Receiver" value={send.receiver} onChange={(v) => setSend({ ...send, receiver: v })} />
        <Btn onClick={() => r.run("Analysing", async () => { const a = await post("/bodyguard/analyze", { tx: { type: "transfer", asset: send.asset, amount: atomic(), receiver: send.receiver } }); setAnalysis(a); return a; })}>1. Check with BODYGUARD</Btn>
        {analysis && <div className={`verdict ${analysis.level}`}><strong>{analysis.level.toUpperCase()}</strong><ul>{analysis.explanation.map((e: string) => <li key={e}>{e}</li>)}{analysis.findings.map((f: any) => <li key={f.rule}>[{f.severity}] {f.message}</li>)}</ul></div>}
        <Btn disabled={!analysis} danger={analysis?.level === "danger"} onClick={() => {
          if (analysis?.level === "danger" && !window.confirm("BODYGUARD flagged this as dangerous. Send anyway?")) return;
          void r.run("Sending", () => sendAndRecord([buildTx()], (h) => post("/wallet/transactions", { txHash: h, kind: "transfer", receiver: send.receiver, asset: send.asset, amount: atomic(), usdValue: analysis?.usdValue ?? null, analysis })));
        }}>2. Sign & send with my wallet</Btn>
      </Section>

      <Section title="Swap with NEAR Intents" note="Live 1Click quotes. Your wallet funds the deposit address; Veyra tracks the swap to settlement.">
        <Field label="From asset" value={swap.originAsset} onChange={(v) => setSwap({ ...swap, originAsset: v })} />
        <Field label="To asset" value={swap.destinationAsset} onChange={(v) => setSwap({ ...swap, destinationAsset: v })} />
        <Field label="Amount (atomic)" value={swap.amount} onChange={(v) => setSwap({ ...swap, amount: v })} />
        <Field label="Slippage (bps)" value={swap.slippageBps} onChange={(v) => setSwap({ ...swap, slippageBps: v })} />
        <Btn onClick={() => r.run("Comparing quotes", () => post("/intents/quote", { ...swap, slippageBps: Number(swap.slippageBps) }))}>Compare quotes</Btn>
        <Btn onClick={() => r.run("Creating swap", async () => { const s = await post("/intents/swaps", { ...swap, slippageBps: Number(swap.slippageBps) }); setLive(s); return s; })}>Get live quote & deposit address</Btn>
        {live && <>
          <Json value={live.summary} />
          {live.walletTransactions
            ? <Btn onClick={() => r.run("Depositing", () => sendAndRecord(live.walletTransactions, (h) => post(`/intents/swaps/${live.operationId}/deposit`, { txHash: h })))}>Sign deposit</Btn>
            : <p className="note">{live.instructions}</p>}
          <Btn onClick={() => r.run("Checking status", () => api(`/intents/swaps/${live.operationId}`))}>Swap status</Btn>
        </>}
      </Section>
      {r.view}
    </>
  );
}
