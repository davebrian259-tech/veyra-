import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type { Db } from "../db.js";
import { json, now, parse } from "../db.js";
import { canonicalJson, randomId, type SecretBox } from "../lib/crypto.js";
import { notFound } from "../lib/errors.js";

/**
 * Receipts: one per purchase, verification, delivery and payout. Each is canonical JSON,
 * hashed, and signed with Veyra's receipt key (ed25519). Batches are committed as a Merkle root
 * to the `veyra-ledger` NEAR contract, so any single receipt can be proven against the chain
 * without trusting Veyra's database.
 *
 * Merkle construction (RFC 6962 style, domain-separated):
 *   leaf = sha256(0x00 || receipt_hash)   node = sha256(0x01 || left || right)
 *   an odd node is promoted unchanged to the next level.
 */

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const unhex = (s: string) => new Uint8Array(Buffer.from(s, "hex"));

export function leafHash(receiptHash: string) {
  return hex(sha256(new Uint8Array([0, ...unhex(receiptHash)])));
}
function node(l: string, r: string) {
  return hex(sha256(new Uint8Array([1, ...unhex(l), ...unhex(r)])));
}

export function merkleRoot(leaves: string[]): string {
  if (!leaves.length) return hex(sha256(new Uint8Array()));
  let level = leaves;
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? node(level[i], level[i + 1]) : level[i]);
    level = next;
  }
  return level[0];
}

export function merkleProof(leaves: string[], index: number): { sibling: string; side: "left" | "right" }[] {
  const proof: { sibling: string; side: "left" | "right" }[] = [];
  let level = leaves;
  let i = index;
  while (level.length > 1) {
    const pair = i % 2 === 0 ? i + 1 : i - 1;
    if (pair < level.length) proof.push({ sibling: level[pair], side: i % 2 === 0 ? "right" : "left" });
    const next: string[] = [];
    for (let j = 0; j < level.length; j += 2) next.push(j + 1 < level.length ? node(level[j], level[j + 1]) : level[j]);
    level = next;
    i = Math.floor(i / 2);
  }
  return proof;
}

export function verifyProof(leaf: string, proof: { sibling: string; side: "left" | "right" }[], root: string) {
  let h = leaf;
  for (const p of proof) h = p.side === "right" ? node(h, p.sibling) : node(p.sibling, h);
  return h === root;
}

export interface Anchorer {
  readonly network: string;
  readonly contractId: string | null;
  anchor(root: string, fromSeq: number, toSeq: number, count: number): Promise<string>;
}

export class ReceiptService {
  private key?: { sk: Uint8Array; pk: string };

  constructor(private readonly db: Db, private readonly secrets: SecretBox, private readonly anchorer: Anchorer | null) {}

  private signingKey() {
    if (this.key) return this.key;
    const row = this.db.get<{ value_json: string }>("SELECT value_json FROM kv WHERE key = 'receipts.key'");
    let sk: Uint8Array;
    if (row) sk = unhex(this.secrets.open(parse<{ sealed: string }>(row.value_json).sealed, "receipts.key"));
    else {
      sk = ed25519.utils.randomSecretKey();
      this.db.run("INSERT INTO kv (key, value_json, updated_at) VALUES (?,?,?)", ["receipts.key", JSON.stringify({ sealed: this.secrets.seal(hex(sk), "receipts.key") }), now()]);
    }
    this.key = { sk, pk: hex(ed25519.getPublicKey(sk)) };
    return this.key;
  }

  publicKey() {
    return this.signingKey().pk;
  }

  issue(kind: string, contractId: string, subtaskId: string | null, body: Record<string, unknown>) {
    const id = randomId("rcp_");
    const full = { v: 1, id, kind, contractId, subtaskId, issuedAt: now(), issuer: this.publicKey(), ...body };
    const hash = hex(sha256(new TextEncoder().encode(canonicalJson(full))));
    const signature = hex(ed25519.sign(unhex(hash), this.signingKey().sk));
    this.db.run("INSERT INTO receipts (id, contract_id, subtask_id, kind, body_json, hash, signature, created_at) VALUES (?,?,?,?,?,?,?,?)", [
      id, contractId, subtaskId, kind, json(full), hash, signature, full.issuedAt,
    ]);
    return { id, hash, signature, body: full };
  }

  list(contractId?: string) {
    return this.db
      .all<Record<string, unknown>>(`SELECT * FROM receipts ${contractId ? "WHERE contract_id = ?" : ""} ORDER BY seq`, contractId ? [contractId] : [])
      .map((r) => ({ ...r, body: parse(r.body_json as string), body_json: undefined }));
  }

  /** Commits every unanchored receipt as one Merkle root. */
  async anchorPending() {
    const rows = this.db.all<{ seq: number; hash: string }>("SELECT seq, hash FROM receipts WHERE anchor_id IS NULL ORDER BY seq");
    if (!rows.length || !this.anchorer) return null;
    const root = merkleRoot(rows.map((r) => leafHash(r.hash)));
    const id = randomId("anc_");
    const from = rows[0].seq;
    const to = rows[rows.length - 1].seq;
    this.db.run("INSERT INTO anchors (id, root, from_seq, to_seq, count, network, contract_id, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)", [
      id, root, from, to, rows.length, this.anchorer.network, this.anchorer.contractId, "pending", now(),
    ]);
    try {
      const tx = await this.anchorer.anchor(root, from, to, rows.length);
      this.db.tx(() => {
        this.db.run("UPDATE anchors SET status = 'anchored', tx_hash = ? WHERE id = ?", [tx, id]);
        this.db.run("UPDATE receipts SET anchor_id = ? WHERE seq BETWEEN ? AND ? AND anchor_id IS NULL", [id, from, to]);
      });
      return { id, root, txHash: tx, count: rows.length };
    } catch (e) {
      this.db.run("UPDATE anchors SET status = 'failed', error = ? WHERE id = ?", [String(e instanceof Error ? e.message : e), id]);
      return null;
    }
  }

  /** Everything a third party needs to check a receipt against the on-chain root. */
  proof(receiptId: string) {
    const r = this.db.get<{ seq: number; hash: string; signature: string; body_json: string; anchor_id: string | null }>("SELECT * FROM receipts WHERE id = ?", [receiptId]);
    if (!r) throw notFound("receipt");
    const anchor = r.anchor_id ? this.db.get<{ id: string; root: string; from_seq: number; to_seq: number; network: string; contract_id: string | null; tx_hash: string | null }>("SELECT * FROM anchors WHERE id = ?", [r.anchor_id]) : null;
    let proof = null;
    if (anchor) {
      const batch = this.db.all<{ seq: number; hash: string }>("SELECT seq, hash FROM receipts WHERE anchor_id = ? ORDER BY seq", [anchor.id]);
      const leaves = batch.map((b) => leafHash(b.hash));
      const idx = batch.findIndex((b) => b.seq === r.seq);
      proof = { leaf: leaves[idx], index: idx, path: merkleProof(leaves, idx), root: anchor.root, valid: verifyProof(leaves[idx], merkleProof(leaves, idx), anchor.root) };
    }
    const hashOk = hex(sha256(new TextEncoder().encode(canonicalJson(parse(r.body_json))))) === r.hash;
    const sigOk = ed25519.verify(unhex(r.signature), unhex(r.hash), unhex(this.publicKey()));
    return { receipt: parse(r.body_json), hash: r.hash, signature: r.signature, issuer: this.publicKey(), checks: { hashMatchesBody: hashOk, signatureValid: sigOk }, anchor, proof };
  }

  anchors() {
    return this.db.all("SELECT * FROM anchors ORDER BY created_at DESC LIMIT 100");
  }
}
