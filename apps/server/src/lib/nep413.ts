import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58 } from "@scure/base";

/**
 * NEP-413 off-chain message signatures (wallet `signMessage`). Used for Veyra login and for
 * owner approvals of Veyra-level actions. The Agent API's own owner intents are verified by
 * the Agent API itself.
 */
export const NEP413_TAG = 2 ** 31 + 413;

export interface Nep413Payload {
  message: string;
  recipient: string;
  /** 32 bytes */
  nonce: Uint8Array;
  callbackUrl?: string | null;
}

function u32(n: number) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

function str(s: string) {
  const bytes = new TextEncoder().encode(s);
  return concat(u32(bytes.length), bytes);
}

function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function nep413Hash(p: Nep413Payload): Uint8Array {
  if (p.nonce.length !== 32) throw new Error("nonce must be 32 bytes");
  const body = concat(
    str(p.message),
    p.nonce,
    str(p.recipient),
    p.callbackUrl ? concat(new Uint8Array([1]), str(p.callbackUrl)) : new Uint8Array([0]),
  );
  return sha256(concat(u32(NEP413_TAG), body));
}

export function parseEd25519PublicKey(pk: string): Uint8Array {
  const [curve, data] = pk.includes(":") ? pk.split(":") : ["ed25519", pk];
  if (curve !== "ed25519") throw new Error("only ed25519 keys are supported");
  const bytes = base58.decode(data);
  if (bytes.length !== 32) throw new Error("invalid ed25519 public key");
  return bytes;
}

function decodeSignature(sig: string): Uint8Array {
  // Wallets return base64; some return base58 or "ed25519:<base58>".
  if (sig.startsWith("ed25519:")) return base58.decode(sig.slice(8));
  const b64 = Buffer.from(sig, "base64");
  if (b64.length === 64) return new Uint8Array(b64);
  return base58.decode(sig);
}

export function verifyNep413(p: Nep413Payload, publicKey: string, signature: string): boolean {
  try {
    return ed25519.verify(decodeSignature(signature), nep413Hash(p), parseEd25519PublicKey(publicKey));
  } catch {
    return false;
  }
}

/** Test helper / server-side signing for fixtures. */
export function signNep413(p: Nep413Payload, secretKey: Uint8Array): string {
  return Buffer.from(ed25519.sign(nep413Hash(p), secretKey)).toString("base64");
}

export const encodePublicKey = (pk: Uint8Array) => `ed25519:${base58.encode(pk)}`;
