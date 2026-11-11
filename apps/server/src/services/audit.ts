import type { Db } from "../db.js";
import { json, now } from "../db.js";
import { canonicalJson, sha256Hex } from "../lib/crypto.js";

export type Actor = "user" | "ai" | "agent" | "system" | "bodyguard" | "provider" | "contract";

const SECRET_PATTERNS = [/ngt_[A-Za-z0-9_-]+/g, /"(api[_-]?key|grant[_-]?token|token_enc|secret)"\s*:\s*"[^"]*"/gi];

/** Strips anything that looks like a credential before it is persisted or shown. */
export function redact<T>(value: T): T {
  let s = JSON.stringify(value ?? null);
  for (const p of SECRET_PATTERNS) s = s.replace(p, (m) => (m.startsWith("ngt_") ? "ngt_[redacted]" : m.replace(/:\s*"[^"]*"$/, ':"[redacted]"')));
  return JSON.parse(s) as T;
}

/**
 * Append-only, hash-chained audit trail of agent decisions, user approvals, security verdicts
 * and execution results. Each entry commits to the previous one, so any edit or deletion
 * breaks `verify()`.
 */
export class AuditLog {
  constructor(private readonly db: Db) {}

  record(entry: { userId?: string | null; actor: Actor; action: string; subject?: string | null; data?: unknown }) {
    return this.db.tx(() => {
      const prev = this.db.get<{ hash: string }>("SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1");
      const prevHash = prev?.hash ?? "genesis";
      const ts = now();
      const data = redact(entry.data ?? {});
      const body = { ts, userId: entry.userId ?? null, actor: entry.actor, action: entry.action, subject: entry.subject ?? null, data, prevHash };
      const hash = sha256Hex(canonicalJson(body));
      this.db.run(
        "INSERT INTO audit_log (ts, user_id, actor, action, subject, data_json, prev_hash, hash) VALUES (?,?,?,?,?,?,?,?)",
        [ts, body.userId, entry.actor, entry.action, body.subject, json(data), prevHash, hash],
      );
      return hash;
    });
  }

  list(userId: string, opts: { limit?: number; before?: number; subject?: string } = {}) {
    const rows = this.db.all<Record<string, unknown>>(
      `SELECT * FROM audit_log WHERE user_id = ? ${opts.subject ? "AND subject = ?" : ""} ${opts.before ? "AND seq < ?" : ""} ORDER BY seq DESC LIMIT ?`,
      [userId, ...(opts.subject ? [opts.subject] : []), ...(opts.before ? [opts.before] : []), Math.min(opts.limit ?? 100, 500)],
    );
    return rows.map((r) => ({ ...r, data: JSON.parse(r.data_json as string), data_json: undefined }));
  }

  /** Recomputes the whole chain. Returns the first broken sequence number, if any. */
  verify(): { ok: boolean; checked: number; brokenAt?: number } {
    const rows = this.db.all<Record<string, string | number | null>>("SELECT * FROM audit_log ORDER BY seq ASC");
    let prev = "genesis";
    for (const r of rows) {
      const body = { ts: r.ts, userId: r.user_id, actor: r.actor, action: r.action, subject: r.subject, data: JSON.parse(r.data_json as string), prevHash: r.prev_hash };
      if (r.prev_hash !== prev || sha256Hex(canonicalJson(body)) !== r.hash) return { ok: false, checked: rows.length, brokenAt: r.seq as number };
      prev = r.hash as string;
    }
    return { ok: true, checked: rows.length };
  }
}
