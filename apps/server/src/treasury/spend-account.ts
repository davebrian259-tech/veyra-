import type { Db } from "../db.js";
import { now } from "../db.js";
import { randomId, type SecretBox } from "../lib/crypto.js";
import { conflict } from "../lib/errors.js";
import { ftTransferAction, implicitAccountId, keyPairFrom, newKeyPair, signDelegate } from "../lib/near-signer.js";
import type { X402Requirement } from "../market/types.js";
import type { AuditLog } from "../services/audit.js";
import type { Chain } from "./chain.js";

/**
 * Veyra's spend account: the only key-holding account in the system, used solely to sign x402
 * cheques (NEP-366 delegate `ft_transfer`s that the market settles on delivery).
 *
 * Why it exists: the market settles x402 with a signed delegate action from a NEAR account,
 * and the policy vault (Agent API) keeps its keys in custody and cannot produce one. So the
 * vault refills this account just-in-time with exactly what the next payment needs, and the
 * float caps what a compromise could lose.
 *
 * Why a key pool: a cheque is settled later, when the agent delivers. Delegate nonces must
 * increase per key, so two outstanding cheques on one key could settle out of order and the
 * lower nonce would then fail. Each in-flight cheque gets its own key.
 */
export interface SpendKey {
  id: string;
  publicKey: string;
  status: "pending" | "free" | "locked" | "retired";
}

export class SpendAccount {
  constructor(
    private readonly db: Db,
    private readonly secrets: SecretBox,
    private readonly chain: Chain,
    private readonly audit: AuditLog,
    private readonly opts: { accountId?: string; importedKey?: string; poolSize: number },
  ) {}

  private keys() {
    return this.db.all<{ id: string; account_id: string; public_key: string; secret_enc: string; status: string; locked_by: string | null; last_nonce: string }>(
      "SELECT * FROM spend_keys ORDER BY created_at",
    );
  }

  /** Creates (or imports) the primary key. Idempotent. */
  init(): { accountId: string; primaryKey: string } {
    const existing = this.keys();
    if (existing.length) return { accountId: existing[0].account_id, primaryKey: existing[0].public_key };
    const kp = this.opts.importedKey ? keyPairFrom(this.opts.importedKey) : newKeyPair();
    const pk = kp.getPublicKey().toString();
    const accountId = this.opts.accountId ?? implicitAccountId(pk);
    const id = randomId("key_");
    this.db.run("INSERT INTO spend_keys (id, account_id, public_key, secret_enc, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)", [
      id, accountId, pk, this.secrets.seal(kp.toString(), `spendkey:${id}`), "free", now(), now(),
    ]);
    this.audit.record({ actor: "system", action: "spend_account.initialised", subject: accountId, data: { publicKey: pk, imported: Boolean(this.opts.importedKey) } });
    return { accountId, primaryKey: pk };
  }

  get accountId(): string {
    return this.init().accountId;
  }

  private keyPair(row: { id: string; secret_enc: string }) {
    return keyPairFrom(this.secrets.open(row.secret_enc, `spendkey:${row.id}`));
  }

  /**
   * Makes sure `poolSize` keys exist on-chain. New keys are generated here, added with one
   * transaction signed by the primary key, and become usable once the chain confirms them.
   */
  async ensurePool(): Promise<{ added: string[]; txHash: string | null }> {
    const { accountId } = this.init();
    const rows = this.keys().filter((k) => k.status !== "retired");
    // Promote pending keys the chain now knows about.
    for (const k of rows.filter((r) => r.status === "pending")) {
      const n = await this.chain.accessKeyNonce(accountId, k.public_key);
      if (n !== null) this.db.run("UPDATE spend_keys SET status = 'free', last_nonce = ?, updated_at = ? WHERE id = ?", [n.toString(), now(), k.id]);
    }
    const missing = this.opts.poolSize - this.keys().filter((k) => k.status !== "retired").length;
    if (missing <= 0) return { added: [], txHash: null };
    const fresh = Array.from({ length: missing }, () => newKeyPair());
    const primary = this.keys()[0];
    const txHash = await this.chain.addKeys(accountId, this.keyPair(primary), fresh.map((k) => k.getPublicKey().toString()));
    for (const kp of fresh) {
      const id = randomId("key_");
      this.db.run("INSERT INTO spend_keys (id, account_id, public_key, secret_enc, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)", [
        id, accountId, kp.getPublicKey().toString(), this.secrets.seal(kp.toString(), `spendkey:${id}`), "pending", now(), now(),
      ]);
    }
    this.audit.record({ actor: "system", action: "spend_account.keys_added", subject: accountId, data: { count: missing, txHash } });
    return { added: fresh.map((k) => k.getPublicKey().toString()), txHash };
  }

  /** Locks a free key for one payment and computes its next nonce. */
  private async lockKey(paymentId: string) {
    const { accountId } = this.init();
    const row = this.db.tx(() => {
      const free = this.db.get<{ id: string; public_key: string; secret_enc: string; last_nonce: string }>("SELECT * FROM spend_keys WHERE status = 'free' ORDER BY updated_at LIMIT 1");
      if (!free) return null;
      this.db.run("UPDATE spend_keys SET status = 'locked', locked_by = ?, updated_at = ? WHERE id = ?", [paymentId, now(), free.id]);
      return free;
    });
    if (!row) throw conflict("no_free_spend_key", "every spend key has a cheque in flight; wait for one to settle or grow the pool");
    const onchain = await this.chain.accessKeyNonce(accountId, row.public_key);
    if (onchain === null) {
      this.release(row.id);
      throw conflict("spend_key_not_on_chain", "the spend key is not on-chain yet");
    }
    const local = BigInt(row.last_nonce);
    const nonce = (onchain > local ? onchain : local) + 1n;
    return { row, nonce };
  }

  /** Frees a key after its cheque settled, was cancelled, or expired. */
  release(keyId: string, usedNonce?: bigint) {
    this.db.run(
      `UPDATE spend_keys SET status = CASE WHEN status = 'locked' THEN 'free' ELSE status END, locked_by = NULL,
         last_nonce = CASE WHEN ? IS NOT NULL AND CAST(? AS INTEGER) > CAST(last_nonce AS INTEGER) THEN ? ELSE last_nonce END, updated_at = ? WHERE id = ?`,
      [usedNonce?.toString() ?? null, usedNonce?.toString() ?? null, usedNonce?.toString() ?? null, now(), keyId],
    );
  }

  /**
   * Signs the x402 cheque for exactly the challenge row: `ft_transfer` of `amount` of `asset` to
   * `payTo`, valid for `maxTimeoutSeconds` blocks. Callers must have run GUARD first.
   */
  async signCheque(row: X402Requirement, paymentId: string) {
    const { accountId } = this.init();
    const { row: key, nonce } = await this.lockKey(paymentId);
    try {
      const height = await this.chain.blockHeight();
      const maxBlockHeight = height + BigInt(row.maxTimeoutSeconds);
      const { base64, hash } = signDelegate({
        senderId: accountId,
        receiverId: row.asset,
        actions: [ftTransferAction(row.payTo, row.amount)],
        nonce,
        maxBlockHeight,
        keyPair: this.keyPair(key),
      });
      this.db.run("UPDATE spend_keys SET last_nonce = ?, updated_at = ? WHERE id = ?", [nonce.toString(), now(), key.id]);
      return { signedDelegateBase64: base64, chequeHash: hash, keyId: key.id, nonce, maxBlockHeight };
    } catch (e) {
      this.release(key.id);
      throw e;
    }
  }

  /** The primary key, for the spend account's own housekeeping transactions (e.g. anchoring). */
  housekeepingSigner() {
    const { accountId } = this.init();
    return { accountId, keyPair: this.keyPair(this.keys()[0]) };
  }

  async status(asset: string) {
    const { accountId } = this.init();
    const [usdc, near] = await Promise.all([this.chain.ftBalance(asset, accountId).catch(() => null), this.chain.nearBalance(accountId).catch(() => null)]);
    const keys = this.keys().map((k) => ({ id: k.id, publicKey: k.public_key, status: k.status, lockedBy: k.locked_by }));
    return { accountId, network: this.chain.network, usdcAtomic: usdc?.toString() ?? null, nearYocto: near?.toString() ?? null, keys };
  }

  async usdcBalance(asset: string) {
    return this.chain.ftBalance(asset, this.accountId);
  }
}
