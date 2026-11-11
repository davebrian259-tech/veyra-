import { useState } from "react";
import { api, post } from "../api";
import { signAndSendOne } from "../wallet";
import { Btn, Field, Section, useRunner } from "../ui";

/** Chain Signatures: an EVM address controlled by your NEAR account through NEAR's MPC network. */
export function ChainSigPage() {
  const r = useRunner();
  const [to, setTo] = useState("");
  const [eth, setEth] = useState("0.001");
  const toWei = (v: string) => { const [w, f = ""] = v.split("."); return (BigInt(w || "0") * 10n ** 18n + BigInt((f + "0".repeat(18)).slice(0, 18) || "0")).toString(); };

  return (
    <>
      <Section title="Your derived EVM address" note="Use this only where NEAR Intents has no route (e.g. an EVM testnet). For supported swaps and transfers, Intents is used instead.">
        <Btn onClick={() => r.run("Deriving", () => api("/chain-signatures/address"))}>Show address & balance</Btn>
        <Btn onClick={() => r.run("Loading", () => api("/chain-signatures"))}>Past requests</Btn>
      </Section>
      <Section title="Send ETH via MPC signature">
        <Field label="To (0x…)" value={to} onChange={setTo} />
        <Field label="Amount (ETH)" value={eth} onChange={setEth} />
        <Btn onClick={() => r.run("Preparing, signing and broadcasting", async () => {
          const prep = await post("/chain-signatures/evm/prepare", { to, valueWei: toWei(eth) });
          if (!window.confirm(`Request an MPC signature to send ${prep.valueEth} ETH from ${prep.from} to ${prep.to} on chain ${prep.chainId}?`)) throw new Error("cancelled");
          const nearTxHash = await signAndSendOne(prep.walletTransactions[0]);
          return post(`/chain-signatures/${prep.requestId}/complete`, { nearTxHash });
        })}>Sign with MPC & broadcast</Btn>
      </Section>
      {r.view}
    </>
  );
}
