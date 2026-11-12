import { sha256 } from "@noble/hashes/sha2.js";
import { z } from "zod";
import type { Db } from "../db.js";
import { now } from "../db.js";
import { canonicalJson } from "../lib/crypto.js";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

/**
 * The owner's mandate: the limits Veyra works under, signed by the owner's NEAR wallet
 * (NEP-413) and enforced in code. Nothing a model says, and nothing a counterparty sends,
 * can widen it. Its hash is part of Veyra's KYA credential, so a buyer can see the limits.
 */
export const mandateSchema = z.object({
  /** Largest single job Veyra may accept, in USDC. */
  maxJobUsd: z.number().positive().max(10_000),
  /** Most Veyra may pay subcontractors in any rolling 24 hours, in USDC. */
  maxDailyUsd: z.number().positive().max(100_000),
  /** Margin Veyra keeps on each job, in basis points. */
  marginBps: z.number().int().min(0).max(9000),
  /** Market categories Veyra may never buy from. */
  blockedCategories: z.array(z.string().min(1).max(40)).max(50),
  /** Lowest counterparty trust score Veyra will pay without an owner approval. */
  minTrust: z.number().int().min(0).max(100),
});
export type Mandate = z.infer<typeof mandateSchema>;

export interface SignedMandate {
  mandate: Mandate;
  version: number;
  hash: string;
  signedBy: string;
  signature: { publicKey: string; value: string; nonce: string; message: string } | null;
  signedAt: string;
}

export const DEFAULT_MANDATE: Mandate = { maxJobUsd: 25, maxDailyUsd: 50, marginBps: 2000, blockedCategories: [], minTrust: 25 };

export const mandateHash = (m: Mandate, version: number) => hex(sha256(new TextEncoder().encode(canonicalJson({ standard: "veyra-mandate/1", version, ...m }))));

/** The text the owner signs in their wallet. Human-readable, and it commits to the hash. */
export function mandateMessage(m: Mandate, version: number) {
  return [
    `Veyra mandate v${version}`,
    `Largest job: ${m.maxJobUsd} USDC`,
    `Daily subcontracting limit: ${m.maxDailyUsd} USDC`,
    `Margin: ${(m.marginBps / 100).toFixed(1)}%`,
    `Never buy from: ${m.blockedCategories.length ? m.blockedCategories.join(", ") : "no category blocked"}`,
    `Minimum counterparty trust: ${m.minTrust}`,
    `Hash: ${mandateHash(m, version)}`,
  ].join("\n");
}

export class MandateService {
  constructor(private readonly db: Db, private readonly defaults: Mandate = DEFAULT_MANDATE) {}

  current(): SignedMandate {
    const row = this.db.get<{ value_json: string }>("SELECT value_json FROM kv WHERE key = 'mandate'");
    if (row) return JSON.parse(row.value_json) as SignedMandate;
    return { mandate: this.defaults, version: 0, hash: mandateHash(this.defaults, 0), signedBy: "defaults (unsigned)", signature: null, signedAt: now() };
  }

  /** Stores a new version. The caller has already verified the owner's signature. */
  set(mandate: Mandate, signedBy: string, signature: SignedMandate["signature"]) {
    const version = this.current().version + 1;
    const signed: SignedMandate = { mandate, version, hash: mandateHash(mandate, version), signedBy, signature, signedAt: now() };
    this.db.run("INSERT OR REPLACE INTO kv (key, value_json, updated_at) VALUES ('mandate', ?, ?)", [JSON.stringify(signed), now()]);
    return signed;
  }

  /** What Veyra has paid subcontractors in the last 24 hours (committed or completed). */
  dailySpentAtomic(): bigint {
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const s = this.db.get<{ s: number | null }>("SELECT SUM(CAST(amount_atomic AS INTEGER)) AS s FROM payments WHERE created_at >= ? AND status IN ('reserved','signed','sent','completed')", [since])?.s ?? 0;
    return BigInt(s);
  }
}
