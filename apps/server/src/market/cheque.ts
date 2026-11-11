import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { deserialize } from "borsh";
import { encodeDelegateAction, SCHEMA } from "@near-js/transactions";
import { base58 } from "@scure/base";
import type { X402Requirement } from "./types.js";

export interface DecodedCheque {
  senderId: string;
  receiverId: string;
  nonce: bigint;
  maxBlockHeight: bigint;
  publicKey: string;
  calls: { methodName: string; args: Record<string, unknown>; gas: bigint; deposit: bigint }[];
  otherActions: number;
  signatureValid: boolean;
  hash: string;
}

/** Decodes a base64 NEP-366 SignedDelegate and verifies its signature. */
export function decodeCheque(signedDelegateBase64: string): DecodedCheque {
  const bytes = Buffer.from(signedDelegateBase64, "base64");
  // biome-ignore lint: borsh returns an untyped structure
  const sd = deserialize(SCHEMA.SignedDelegate, bytes) as any;
  const da = sd.delegateAction;
  const pkBytes = Uint8Array.from(da.publicKey.ed25519Key?.data ?? da.publicKey.data);
  const sig = Uint8Array.from(sd.signature.ed25519Signature?.data ?? sd.signature.data);
  const hash = sha256(encodeDelegateAction(da));
  let signatureValid = false;
  try {
    signatureValid = ed25519.verify(sig, hash, pkBytes);
  } catch {
    signatureValid = false;
  }
  const calls: DecodedCheque["calls"] = [];
  let otherActions = 0;
  for (const a of da.actions as any[]) {
    const fc = a.functionCall;
    if (!fc) { otherActions++; continue; }
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(Buffer.from(Uint8Array.from(fc.args)).toString("utf8")); } catch { /* non-JSON args */ }
    calls.push({ methodName: fc.methodName, args, gas: BigInt(fc.gas), deposit: BigInt(fc.deposit) });
  }
  return {
    senderId: da.senderId,
    receiverId: da.receiverId,
    nonce: BigInt(da.nonce),
    maxBlockHeight: BigInt(da.maxBlockHeight),
    publicKey: `ed25519:${base58.encode(pkBytes)}`,
    calls,
    otherActions,
    signatureValid,
    hash: Buffer.from(hash).toString("hex"),
  };
}

/**
 * True when the cheque pays exactly `row` and nothing else: one `ft_transfer` on `row.asset`
 * of `row.amount` to `row.payTo`, 1 yoctoNEAR attached, valid signature.
 */
export function chequeMatches(c: DecodedCheque, row: X402Requirement): { ok: boolean; problems: string[] } {
  const p: string[] = [];
  if (!c.signatureValid) p.push("invalid signature");
  if (c.receiverId !== row.asset) p.push(`token ${c.receiverId} ≠ ${row.asset}`);
  if (c.otherActions || c.calls.length !== 1) p.push("cheque must contain exactly one ft_transfer");
  const call = c.calls[0];
  if (call) {
    if (call.methodName !== "ft_transfer") p.push(`method ${call.methodName} is not ft_transfer`);
    if (call.args.receiver_id !== row.payTo) p.push(`payee ${String(call.args.receiver_id)} ≠ ${row.payTo}`);
    if (call.args.amount !== row.amount) p.push(`amount ${String(call.args.amount)} ≠ ${row.amount}`);
    if (call.deposit !== 1n) p.push("deposit must be 1 yoctoNEAR");
  }
  return { ok: p.length === 0, problems: p };
}
