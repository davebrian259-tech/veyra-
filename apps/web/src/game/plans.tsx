import { toYoctoNear, loadPending, nearNum, preview, signEntry, specHash, submitRanked, underwrite, waitForTx, withdrawStake, clean, type Run, type Spec, type Vault } from "./heist-api";
import type { HeistState } from "./session";
import type { TxPlan } from "./tx";

const pct = (v: bigint, bps: bigint) => nearNum((v * bps) / 10_000n).toFixed(3);

/** A ranked entry: sign `enter` with the fee, wait for NEAR, then the referee settles it. */
export function rankedPlan(h: HeistState, vault: Vault, spec: Spec, onDone: (r: Run) => void): TxPlan<Run> {
  const fee = BigInt(vault.feeYocto);
  const pot = vault.chain ? BigInt(vault.chain.potYocto) : 0n;
  return {
    title: `Ranked heist on vault ${vault.id}`,
    intro: <>You pay <b className="mono">{vault.feeNear} NEAR</b> to enter. The same referee as practice runs your agent <b>{spec.agentName}</b>, then settles the result on the pot contract.</>,
    depositYocto: fee,
    depositLabel: "Entry fee",
    depositExplain: {
      what: "Paid into the Heist contract when you enter. It is never held by Veyra.",
      how: <>If you crack the vault, you get it back with the whole pot. If the vault holds, it splits: 70% to the pot ({pct(fee, 7000n)} NEAR), 20% to the vault's backers, 10% to the house. If nobody settles your entry within 24 hours, you can reclaim it.</>,
    },
    outcome: async () => {
      const p = await preview(vault.id, spec);
      return p.cracked
        ? <><b className="good-ink">The referee says this cracks vault {vault.id}.</b> You would receive the pot plus your fee back: about <b className="mono gold-ink">{nearNum(pot + fee).toFixed(2)} NEAR</b>.</>
        : <><b>The referee says vault {vault.id} holds{p.stoppedBy ? `, stopped by the ${p.stoppedBy.replace("_", " ")} shield` : ""}.</b> Your fee would go to the pot and its backers. Try another build in practice first.</>;
    },
    confirmLabel: `Pay ${vault.feeNear} NEAR and run`,
    settles: true,
    run: async ({ phase, hash }) => {
      if (!h.contractId || !h.account) throw new Error("Connect a NEAR wallet first.");
      phase("preparing");
      const want = await specHash(spec);
      const p = loadPending();
      let tx: string;
      if (p?.txHash && p.vault === vault.id && p.accountId === h.account && (await specHash(p.spec)) === want) tx = p.txHash; // already paid: settle it
      else { phase("signing"); tx = await signEntry(h.network, h.contractId, vault, spec, h.account); }
      hash(tx);
      phase("pending");
      await waitForTx(tx, h.account);
      phase("settling");
      return submitRanked(tx, h.account, clean(spec));
    },
    success: (r) => (r.cracked ? `Vault ${r.vault} cracked. The pot is on its way to your wallet.` : `Vault ${r.vault} held. Your fee joined the pot.`),
    onDone,
  };
}

/** Settles an entry that was paid but not settled (a redirect wallet, a closed tab, a server hiccup). */
export function settlePlan(h: HeistState, p: { txHash: string; accountId: string; spec: Spec; vault: number }, onDone: (r: Run) => void): TxPlan<Run> {
  return {
    title: `Settle your vault ${p.vault} entry`,
    intro: "Your entry fee is already in the contract. The referee checks the entry on NEAR, runs the duel and settles it.",
    depositYocto: 0n, depositLabel: "Nothing more to pay", depositExplain: { what: "The fee was paid when you entered." },
    confirmLabel: "Settle it", settles: true,
    run: async ({ phase, hash }) => {
      hash(p.txHash);
      phase("pending");
      await waitForTx(p.txHash, p.accountId);
      phase("settling");
      return submitRanked(p.txHash, p.accountId, p.spec);
    },
    success: (r) => (r.cracked ? `Vault ${r.vault} cracked. The pot is on its way to your wallet.` : `Vault ${r.vault} held. Your fee joined the pot.`),
    onDone,
  };
}

export function backPlan(h: HeistState, vault: Vault, amount: string, onDone: () => void, onFail?: () => void): TxPlan<string> {
  const y = toYoctoNear(amount);
  const staked = vault.chain ? BigInt(vault.chain.stakedYocto) : 0n;
  const share = staked + y > 0n ? Number((y * 10_000n) / (staked + y)) / 100 : 100;
  return {
    title: `Back vault ${vault.id} · ${vault.name}`,
    intro: <>Your stake joins the pot. You bet that {vault.name} holds.</>,
    depositYocto: y,
    depositLabel: "Your stake",
    depositExplain: {
      what: "Locked in the vault's pot until you withdraw it. You can withdraw any time the vault has not been cracked.",
      how: "Every failed ranked entry on this vault pays 20% of its fee to backers, shared by stake. A crack pays the whole pot, stakes included, to the player who cracked it.",
    },
    outcome: async () => <>You would hold <b className="mono">{share.toFixed(1)}%</b> of vault {vault.id}'s backing ({nearNum(staked + y).toFixed(2)} NEAR in total) and earn that share of 20% of every failed entry fee ({vault.feeNear} NEAR each, so about <b className="mono gold-ink">{((Number(vault.feeNear) * 0.2 * share) / 100).toFixed(4)} NEAR</b> per failed heist). If vault {vault.id} is cracked, you lose the stake.</>,
    confirmLabel: `Stake ${amount} NEAR`,
    run: async ({ phase, hash }) => {
      if (!h.contractId) throw new Error("ranked_off");
      phase("signing");
      const tx = await underwrite(h.network, h.contractId, vault.id, amount);
      hash(tx);
      phase("pending");
      await waitForTx(tx, h.account!);
      return tx;
    },
    success: () => `You now back vault ${vault.id}.`,
    onDone,
    onFail,
  };
}

export function withdrawPlan(h: HeistState, vault: Vault, stake: { amountYocto: string; earnedYocto: string }, onDone: () => void): TxPlan<string> {
  const total = BigInt(stake.amountYocto) + BigInt(stake.earnedYocto);
  return {
    title: `Withdraw from vault ${vault.id}`,
    intro: <>You receive your stake and everything it earned: <b className="mono gold-ink">{nearNum(total).toFixed(4)} NEAR</b>.</>,
    depositYocto: 0n, depositLabel: "Nothing to pay", depositExplain: { what: "Withdrawing only costs the network fee." },
    outcome: async () => <>Stake <b className="mono">{nearNum(stake.amountYocto).toFixed(4)}</b> + earned <b className="mono">{nearNum(stake.earnedYocto).toFixed(4)}</b> NEAR back to your wallet. You stop earning from vault {vault.id}.</>,
    confirmLabel: "Withdraw",
    run: async ({ phase, hash }) => {
      if (!h.contractId) throw new Error("ranked_off");
      phase("signing");
      const tx = await withdrawStake(h.network, h.contractId, vault.id);
      hash(tx);
      phase("pending");
      await waitForTx(tx, h.account!);
      return tx;
    },
    success: () => `Withdrew ${nearNum(total).toFixed(4)} NEAR from vault ${vault.id}.`,
    onDone,
  };
}
