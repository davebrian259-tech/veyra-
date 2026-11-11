import { Buffer } from "buffer";
import { setupWalletSelector, type WalletSelector } from "@near-wallet-selector/core";
import { setupModal, type WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import "@near-wallet-selector/modal-ui/styles.css";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import { setupHereWallet } from "@near-wallet-selector/here-wallet";
import type { OwnerIntent, WalletTx } from "./api";

(globalThis as { Buffer?: typeof Buffer }).Buffer ??= Buffer;

/**
 * The user's own NEAR wallet. Every signature in Veyra — login, owner intents for the Agent
 * API, approvals, escrow releases, manual transfers, MPC signature requests — happens here.
 * No private key ever reaches the Veyra backend or its AI.
 */
let selector: WalletSelector | null = null;
let modal: WalletSelectorModal | null = null;

export async function initWallet(network: "testnet" | "mainnet") {
  if (selector) return selector;
  selector = await setupWalletSelector({
    network,
    modules: [setupMeteorWallet(), setupMyNearWallet(), setupHereWallet()],
  });
  modal = setupModal(selector, { contractId: "" });
  return selector;
}

export function showWalletModal() {
  modal?.show();
}

export function connectedAccount(): string | null {
  return selector?.store.getState().accounts.find((a) => a.active)?.accountId ?? null;
}

export function onAccountChange(fn: (accountId: string | null) => void) {
  return selector?.store.observable.subscribe((s) => fn(s.accounts.find((a) => a.active)?.accountId ?? null));
}

async function wallet() {
  if (!selector) throw new Error("wallet not initialised");
  return selector.wallet();
}

export async function disconnect() {
  if (selector?.isSignedIn()) await (await wallet()).signOut();
}

/** NEP-413 signMessage. `nonce` is base64 exactly as the backend issued it. */
export async function signMessage(message: string, recipient: string, nonce: string) {
  const w = await wallet();
  if (!w.signMessage) throw new Error("this wallet does not support signMessage (NEP-413)");
  const signed = await w.signMessage({ message, recipient, nonce: Buffer.from(nonce, "base64") });
  if (!signed) throw new Error("the wallet did not return a signature");
  return { accountId: signed.accountId, publicKey: signed.publicKey, signature: signed.signature, nonce };
}

/** Signs an Agent API owner intent and returns `signed_data` for submission, unchanged. */
export async function signOwnerIntent(intent: OwnerIntent["intent"]) {
  const w = (await wallet()) as any;
  switch (intent.standard) {
    case "nep413": {
      const p = intent.payload as { message: string; recipient: string; nonce: string };
      const s = await signMessage(p.message, p.recipient, p.nonce);
      return { ...intent, public_key: s.publicKey, signature: s.signature };
    }
    case "nep366": {
      if (typeof w.signDelegateActions !== "function") throw new Error("this wallet cannot sign NEP-366 delegate actions; try another wallet");
      const r = await w.signDelegateActions({ delegateActions: [intent.payload] });
      return { ...intent, signed_delegate: r.signedDelegateActions[0] };
    }
    default:
      throw new Error(`${intent.standard} signing needs an EVM wallet or passkey, which this demo does not connect`);
  }
}

/** Signs and sends prepared transactions; returns their hashes. */
export async function signAndSend(txs: WalletTx[]): Promise<string[]> {
  const w = await wallet();
  const outcomes = await w.signAndSendTransactions({ transactions: txs as never });
  return (outcomes ?? []).map((o: any) => o.transaction?.hash ?? o.transaction_outcome?.id);
}

export async function signAndSendOne(tx: WalletTx): Promise<string> {
  const [hash] = await signAndSend([tx]);
  if (!hash) throw new Error("the wallet returned no transaction hash");
  return hash;
}
