import { KeyPair, KeyType, PublicKey, type KeyPairString } from "@near-js/crypto";
import {
  actionCreators,
  buildDelegateAction,
  createTransaction,
  encodeDelegateAction,
  encodeSignedDelegate,
  encodeTransaction,
  Signature,
  SignedDelegate,
  SignedTransaction,
  type Action,
} from "@near-js/transactions";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58 } from "@scure/base";
import type { NearRpc } from "./near-rpc.js";

/**
 * Server-side NEAR signing for Veyra's spend account only. The owner's keys never come here;
 * this signs x402 cheques (NEP-366 delegate actions) and the spend account's own housekeeping
 * transactions (adding pooled keys, storage registration).
 */

export const TGAS = 1_000_000_000_000n;

export function newKeyPair(): KeyPair {
  return KeyPair.fromRandom("ed25519");
}

export function keyPairFrom(secret: string): KeyPair {
  return KeyPair.fromString(secret as KeyPairString);
}

export function implicitAccountId(publicKey: string): string {
  return Buffer.from(PublicKey.fromString(publicKey).data).toString("hex");
}

export interface DelegateInput {
  senderId: string;
  receiverId: string;
  actions: Action[];
  nonce: bigint;
  maxBlockHeight: bigint;
  keyPair: KeyPair;
}

/** NEP-366: sign sha256(prefix(2^30+366) || borsh(DelegateAction)). */
export function signDelegate(i: DelegateInput) {
  const publicKey = i.keyPair.getPublicKey();
  const delegateAction = buildDelegateAction({
    senderId: i.senderId,
    receiverId: i.receiverId,
    actions: i.actions,
    nonce: i.nonce,
    maxBlockHeight: i.maxBlockHeight,
    publicKey,
  });
  const hash = sha256(encodeDelegateAction(delegateAction));
  const { signature } = i.keyPair.sign(hash);
  const signed = new SignedDelegate({ delegateAction, signature: new Signature({ keyType: KeyType.ED25519, data: signature }) });
  const bytes = encodeSignedDelegate(signed);
  return { signed, base64: Buffer.from(bytes).toString("base64"), hash: Buffer.from(hash).toString("hex") };
}

export function ftTransferAction(receiverId: string, amount: string, memo?: string) {
  return actionCreators.functionCall("ft_transfer", { receiver_id: receiverId, amount, ...(memo ? { memo } : {}) }, 30n * TGAS, 1n);
}

/** Builds, signs and broadcasts a normal transaction from the spend account. */
export async function sendTransaction(rpc: NearRpc, signerId: string, keyPair: KeyPair, receiverId: string, actions: Action[]) {
  const publicKey = keyPair.getPublicKey();
  const ak = await rpc.viewAccessKey(signerId, publicKey.toString());
  const block = await rpc.latestBlock();
  const tx = createTransaction(signerId, publicKey, receiverId, BigInt(ak.nonce) + 1n, actions, base58.decode(block.hash));
  const hash = sha256(encodeTransaction(tx));
  const { signature } = keyPair.sign(hash);
  const signedTx = new SignedTransaction({ transaction: tx, signature: new Signature({ keyType: KeyType.ED25519, data: signature }) });
  const b64 = Buffer.from(signedTx.encode()).toString("base64");
  return rpc.call<{ transaction: { hash: string } }>("send_tx", { signed_tx_base64: b64, wait_until: "EXECUTED_OPTIMISTIC" });
}

export { actionCreators, KeyPair };
