import { actionCreators, SCHEMA, type SignedDelegate } from "@near-js/transactions";
import { deserialize } from "borsh";
import type { KeyPair } from "@near-js/crypto";
import { PublicKey } from "@near-js/crypto";
import type { NearRpc } from "../lib/near-rpc.js";
import { sendTransaction } from "../lib/near-signer.js";

/**
 * The few chain operations the spend account needs. `LiveChain` talks to NEAR RPC; the
 * simulator provides an in-memory ledger with the same semantics (nonces, balances, relayer).
 */
export interface Chain {
  readonly network: string;
  accessKeyNonce(accountId: string, publicKey: string): Promise<bigint | null>;
  blockHeight(): Promise<bigint>;
  ftBalance(token: string, accountId: string): Promise<bigint>;
  nearBalance(accountId: string): Promise<bigint>;
  /** Adds full-access keys to `accountId`, signed by `signer` (an existing full-access key). */
  addKeys(accountId: string, signer: KeyPair, publicKeys: string[]): Promise<string>;
  /** Registers storage for `accountId` on a NEP-141 token (needed before it can receive). */
  registerStorage(token: string, payerId: string, payer: KeyPair, accountId: string): Promise<string | null>;
  /** Sends `amount` of a NEP-141 token. */
  ftTransfer(token: string, fromId: string, signer: KeyPair, to: string, amount: string): Promise<string>;
  /** Executes a NEP-366 signed delegate action (an x402 cheque). `relayer` pays the gas. */
  relay(signedDelegateBase64: string, relayer: { accountId: string; keyPair: KeyPair }): Promise<RelayResult>;
}

export type RelayResult = { ok: true; hash: string } | { ok: false; error: string };

export class LiveChain implements Chain {
  constructor(readonly network: string, private readonly rpc: NearRpc) {}

  async accessKeyNonce(accountId: string, publicKey: string) {
    try {
      return BigInt((await this.rpc.viewAccessKey(accountId, publicKey)).nonce);
    } catch {
      return null;
    }
  }

  async blockHeight() {
    return BigInt((await this.rpc.latestBlock()).height);
  }

  async ftBalance(token: string, accountId: string) {
    const v = await this.rpc.view<string | null>(token, "ft_balance_of", { account_id: accountId }).catch(() => "0");
    return BigInt(v ?? "0");
  }

  async nearBalance(accountId: string) {
    try {
      return BigInt((await this.rpc.viewAccount(accountId)).amount);
    } catch {
      return 0n;
    }
  }

  async addKeys(accountId: string, signer: KeyPair, publicKeys: string[]) {
    const actions = publicKeys.map((pk) => actionCreators.addKey(PublicKey.fromString(pk), actionCreators.fullAccessKey()));
    const r = await sendTransaction(this.rpc, accountId, signer, accountId, actions);
    return r.transaction.hash;
  }

  async registerStorage(token: string, payerId: string, payer: KeyPair, accountId: string) {
    const existing = await this.rpc.view<unknown>(token, "storage_balance_of", { account_id: accountId }).catch(() => null);
    if (existing) return null;
    const r = await sendTransaction(this.rpc, payerId, payer, token, [
      actionCreators.functionCall("storage_deposit", { account_id: accountId, registration_only: true }, 30_000_000_000_000n, 1_250_000_000_000_000_000_000n),
    ]);
    return r.transaction.hash;
  }

  async ftTransfer(token: string, fromId: string, signer: KeyPair, to: string, amount: string) {
    const r = await sendTransaction(this.rpc, fromId, signer, token, [
      actionCreators.functionCall("ft_transfer", { receiver_id: to, amount }, 30_000_000_000_000n, 1n),
    ]);
    return r.transaction.hash;
  }

  /** A meta-transaction: the relayer sends the buyer's SignedDelegate to the buyer's account and pays the gas. */
  async relay(signedDelegateBase64: string, relayer: { accountId: string; keyPair: KeyPair }): Promise<RelayResult> {
    try {
      const sd = deserialize(SCHEMA.SignedDelegate, Buffer.from(signedDelegateBase64, "base64")) as SignedDelegate;
      const r = await sendTransaction(this.rpc, relayer.accountId, relayer.keyPair, sd.delegateAction.senderId, [actionCreators.signedDelegate(sd)]);
      return { ok: true, hash: r.transaction.hash };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
