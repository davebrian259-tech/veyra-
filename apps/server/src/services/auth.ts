import { randomBytes } from "node:crypto";
import type { Db } from "../db.js";
import { now } from "../db.js";
import { randomId, randomToken, sha256Hex } from "../lib/crypto.js";
import { badRequest, forbidden, unauthorized } from "../lib/errors.js";
import type { NearRpc } from "../lib/near-rpc.js";
import { parseEd25519PublicKey, verifyNep413 } from "../lib/nep413.js";
import type { AuditLog } from "./audit.js";

export type ChallengePurpose = "login" | "approval" | "veyra_policy" | "unfreeze_local";

export interface SignedChallenge {
  accountId: string;
  publicKey: string;
  signature: string;
  /** base64 nonce exactly as issued */
  nonce: string;
}

export interface User {
  id: string;
  accountId: string;
  publicKey: string;
}

const CHALLENGE_TTL_MS = 5 * 60_000;
const SESSION_TTL_MS = 7 * 24 * 3600_000;

/**
 * Wallet-based authentication. Users prove control of a NEAR account by signing a NEP-413
 * message with one of its full-access keys; the same mechanism authorises owner-only Veyra
 * actions (approvals, Veyra policy changes). The key is checked against the chain each time.
 */
export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly rpc: NearRpc,
    private readonly recipient: string,
    private readonly audit: AuditLog,
    /** Allows tests to skip the on-chain key check. */
    private readonly verifyKeyOnChain = true,
  ) {}

  createChallenge(accountId: string, purpose: ChallengePurpose, message?: string) {
    if (!/^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(accountId) || accountId.length < 2 || accountId.length > 64) {
      throw badRequest("invalid_account", "invalid NEAR account id");
    }
    const nonce = randomBytes(32).toString("base64");
    const text = message ?? `Sign in to Veyra\nAccount: ${accountId}\nIssued: ${now()}`;
    this.db.run("INSERT INTO auth_challenges (nonce, account_id, purpose, message, created_at) VALUES (?,?,?,?,?)", [
      nonce, accountId, purpose, text, now(),
    ]);
    return { message: text, recipient: this.recipient, nonce };
  }

  /** Verifies a signed challenge and consumes it. Returns the verified public key. */
  async consumeChallenge(signed: SignedChallenge, purpose: ChallengePurpose): Promise<{ message: string }> {
    const ch = this.db.get<{ account_id: string; purpose: string; message: string; created_at: string; used: number }>(
      "SELECT * FROM auth_challenges WHERE nonce = ?",
      [signed.nonce],
    );
    if (!ch || ch.used) throw unauthorized("unknown or used challenge");
    if (ch.purpose !== purpose) throw unauthorized("challenge purpose mismatch");
    if (ch.account_id !== signed.accountId) throw unauthorized("challenge account mismatch");
    if (Date.now() - Date.parse(ch.created_at) > CHALLENGE_TTL_MS) throw unauthorized("challenge expired");
    const nonce = new Uint8Array(Buffer.from(signed.nonce, "base64"));
    const ok = verifyNep413({ message: ch.message, recipient: this.recipient, nonce }, signed.publicKey, signed.signature);
    if (!ok) throw unauthorized("invalid signature");
    await this.assertFullAccessKey(signed.accountId, signed.publicKey);
    this.db.run("UPDATE auth_challenges SET used = 1 WHERE nonce = ?", [signed.nonce]);
    return { message: ch.message };
  }

  async assertFullAccessKey(accountId: string, publicKey: string) {
    if (!this.verifyKeyOnChain) return;
    // Implicit accounts: the account id is the hex public key, valid before it exists on-chain.
    if (/^[0-9a-f]{64}$/.test(accountId)) {
      if (Buffer.from(parseEd25519PublicKey(publicKey)).toString("hex") !== accountId) throw unauthorized("key does not match implicit account");
      return;
    }
    let key;
    try {
      key = await this.rpc.viewAccessKey(accountId, publicKey);
    } catch {
      throw unauthorized("public key is not an access key of this account");
    }
    if (key.permission !== "FullAccess") throw forbidden("a full-access key is required");
  }

  async login(signed: SignedChallenge) {
    await this.consumeChallenge(signed, "login");
    const user = this.upsertUser(signed.accountId);
    const token = randomToken();
    const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    this.db.run("INSERT INTO sessions (id_hash, user_id, public_key, created_at, expires_at) VALUES (?,?,?,?,?)", [
      sha256Hex(token), user.id, signed.publicKey, now(), expires,
    ]);
    this.audit.record({ userId: user.id, actor: "user", action: "auth.login", subject: user.accountId, data: { publicKey: signed.publicKey } });
    return { token, expiresAt: expires, user: { ...user, publicKey: signed.publicKey } };
  }

  upsertUser(accountId: string) {
    const existing = this.db.get<{ id: string; account_id: string }>("SELECT * FROM users WHERE account_id = ?", [accountId]);
    if (existing) return { id: existing.id, accountId: existing.account_id };
    const id = randomId("usr_");
    this.db.run("INSERT INTO users (id, account_id, created_at) VALUES (?,?,?)", [id, accountId, now()]);
    return { id, accountId };
  }

  userFromToken(token: string | undefined): User | null {
    if (!token) return null;
    const row = this.db.get<{ user_id: string; account_id: string; public_key: string; expires_at: string }>(
      "SELECT s.user_id, s.public_key, s.expires_at, u.account_id FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?",
      [sha256Hex(token)],
    );
    if (!row || Date.parse(row.expires_at) < Date.now()) return null;
    return { id: row.user_id, accountId: row.account_id, publicKey: row.public_key };
  }

  logout(token: string) {
    this.db.run("DELETE FROM sessions WHERE id_hash = ?", [sha256Hex(token)]);
  }

  /**
   * Owner authorisation for a Veyra-level action. The caller must already be logged in as the
   * owner; the challenge message binds the exact request hash being authorised.
   */
  async verifyOwnerAction(user: User, purpose: ChallengePurpose, signed: SignedChallenge, expectedSubstring: string) {
    if (signed.accountId !== user.accountId) throw forbidden("signature is not from the account owner");
    const { message } = await this.consumeChallenge(signed, purpose);
    if (!message.includes(expectedSubstring)) throw forbidden("signed message does not match this request");
    return { publicKey: signed.publicKey, signature: signed.signature, nonce: signed.nonce, message };
  }
}
