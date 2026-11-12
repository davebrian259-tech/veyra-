import type { KeyPair } from "@near-js/crypto";
import { decodeCheque } from "../market/cheque.js";
import type { Chain } from "../treasury/chain.js";

/**
 * In-memory NEAR ledger for the simulator. It enforces the rules that matter for x402:
 * per-key nonces that must strictly increase, delegate expiry by block height, signature
 * validity, and token balances. Block height advances one per second, like mainnet.
 */
export class SimChain implements Chain {
  readonly network = "sim";
  private readonly start = Date.now();
  private keys = new Map<string, Map<string, bigint>>(); // account -> publicKey -> nonce
  private ft = new Map<string, Map<string, bigint>>(); // token -> account -> balance
  private near = new Map<string, bigint>();
  private seq = 0;
  readonly log: { hash: string; kind: string; detail: Record<string, unknown> }[] = [];

  private txHash(kind: string, detail: Record<string, unknown>) {
    const hash = `SIM${(++this.seq).toString().padStart(6, "0")}${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    this.log.push({ hash, kind, detail });
    return hash;
  }

  createAccount(accountId: string, publicKey: string, nearYocto = 10n ** 24n) {
    if (!this.keys.has(accountId)) this.keys.set(accountId, new Map());
    this.keys.get(accountId)!.set(publicKey, 0n);
    this.near.set(accountId, (this.near.get(accountId) ?? 0n) + nearYocto);
  }

  mint(token: string, accountId: string, amount: bigint) {
    const m = this.ft.get(token) ?? new Map();
    m.set(accountId, (m.get(accountId) ?? 0n) + amount);
    this.ft.set(token, m);
    return this.txHash("mint", { token, accountId, amount: amount.toString() });
  }

  async accessKeyNonce(accountId: string, publicKey: string) {
    return this.keys.get(accountId)?.get(publicKey) ?? null;
  }

  async blockHeight() {
    return 100_000_000n + BigInt(Math.floor((Date.now() - this.start) / 1000));
  }

  async ftBalance(token: string, accountId: string) {
    return this.ft.get(token)?.get(accountId) ?? 0n;
  }

  async nearBalance(accountId: string) {
    return this.near.get(accountId) ?? 0n;
  }

  async addKeys(accountId: string, signer: KeyPair, publicKeys: string[]) {
    const ks = this.keys.get(accountId);
    if (!ks?.has(signer.getPublicKey().toString())) throw new Error("signer is not a key of this account");
    for (const pk of publicKeys) ks.set(pk, 0n);
    return this.txHash("add_keys", { accountId, count: publicKeys.length });
  }

  async registerStorage() {
    return null;
  }

  async ftTransfer(token: string, fromId: string, signer: KeyPair, to: string, amount: string) {
    if (!this.keys.get(fromId)?.has(signer.getPublicKey().toString())) throw new Error("not authorised");
    this.move(token, fromId, to, BigInt(amount));
    return this.txHash("ft_transfer", { token, fromId, to, amount });
  }

  private move(token: string, from: string, to: string, amount: bigint) {
    const m = this.ft.get(token) ?? new Map();
    const bal = m.get(from) ?? 0n;
    if (bal < amount) throw new Error("insufficient token balance");
    m.set(from, bal - amount);
    m.set(to, (m.get(to) ?? 0n) + amount);
    this.ft.set(token, m);
  }

  /** Moves tokens between simulated custody accounts (the vault has no keys here). */
  custodyTransfer(token: string, from: string, to: string, amount: bigint) {
    this.move(token, from, to, amount);
    return this.txHash("custody_transfer", { token, from, to, amount: amount.toString() });
  }

  /** Records an arbitrary transaction (used for receipt anchoring). */
  record(kind: string, detail: Record<string, unknown>) {
    return this.txHash(kind, detail);
  }

  /** What a relayer does with an x402 cheque: verify, check nonce and expiry, execute. */
  async relay(signedDelegateBase64: string, _relayer?: unknown): Promise<{ ok: true; hash: string } | { ok: false; error: string }> {
    const c = decodeCheque(signedDelegateBase64);
    if (!c.signatureValid) return { ok: false, error: "invalid_signature" };
    const ks = this.keys.get(c.senderId);
    const current = ks?.get(c.publicKey);
    if (current === undefined) return { ok: false, error: "access_key_not_found" };
    if (c.nonce <= current) return { ok: false, error: "delegate_nonce_too_low" };
    if (c.maxBlockHeight < (await this.blockHeight())) return { ok: false, error: "delegate_expired" };
    const call = c.calls[0];
    if (!call || call.methodName !== "ft_transfer") return { ok: false, error: "unsupported_action" };
    try {
      this.move(c.receiverId, c.senderId, String(call.args.receiver_id), BigInt(String(call.args.amount)));
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "transfer_failed" };
    }
    ks!.set(c.publicKey, c.nonce);
    return { ok: true, hash: this.txHash("x402_settlement", { from: c.senderId, to: call.args.receiver_id, amount: call.args.amount, chequeHash: c.hash }) };
  }

  /** Checks a cheque without executing it (what the market does when it accepts the header). */
  async precheck(signedDelegateBase64: string) {
    const c = decodeCheque(signedDelegateBase64);
    if (!c.signatureValid) return "invalid_signature";
    const current = this.keys.get(c.senderId)?.get(c.publicKey);
    if (current === undefined) return "access_key_not_found";
    if (c.nonce <= current) return "delegate_nonce_too_low";
    if (c.maxBlockHeight < (await this.blockHeight())) return "delegate_expired";
    const amount = BigInt(String(c.calls[0]?.args.amount ?? "0"));
    if ((await this.ftBalance(c.receiverId, c.senderId)) < amount) return "insufficient_funds";
    return null;
  }
}
