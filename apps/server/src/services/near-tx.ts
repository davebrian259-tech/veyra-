import type { Db } from "../db.js";
import { json, now, parse } from "../db.js";
import { hashObject, randomId } from "../lib/crypto.js";
import { extractEvents, txSucceeded, type NearRpc, type TxOutcome } from "../lib/near-rpc.js";
import type { AuditLog } from "./audit.js";
import type { Notifier } from "./notifications.js";

export type Network = "testnet" | "mainnet";

/**
 * Tracks transactions the user's own wallet signed (manual transfers, escrow actions, reward
 * claims, MPC signature requests). Distinguishes submitted → confirmed (executed, optimistic)
 * → settled (final). Never assumes a submitted transaction succeeded.
 */
export class NearTxTracker {
  private readonly hooks: ((op: { id: string; kind: string; outcome: TxOutcome; meta: Record<string, unknown> }) => Promise<void> | void)[] = [];

  constructor(
    private readonly db: Db,
    private readonly rpcs: Record<Network, NearRpc>,
    private readonly audit: AuditLog,
    private readonly notifier: Notifier,
  ) {}

  rpc(network: Network) {
    return this.rpcs[network];
  }

  onOutcome(fn: (op: { id: string; kind: string; outcome: TxOutcome; meta: Record<string, unknown> }) => Promise<void> | void) {
    this.hooks.push(fn);
  }

  track(userId: string, input: { kind: string; txHash: string; signerId: string; network: Network; usdValue?: number | null; asset?: string | null; amount?: string | null; destination?: string | null; meta?: Record<string, unknown>; analysis?: unknown }) {
    const existing = this.db.get<{ id: string }>("SELECT id FROM operations WHERE idempotency_key = ?", [`tx:${input.txHash}`]);
    if (existing) return existing.id;
    const id = randomId("op_");
    const request = { signerId: input.signerId, network: input.network, txHash: input.txHash, ...input.meta };
    this.db.run(
      `INSERT INTO operations (id, user_id, agent_id, kind, origin, request_json, request_hash, idempotency_key, status, usd_value, asset, amount, destination, tx_hash, bodyguard_json, created_at, updated_at, submitted_at)
       VALUES (?,?,NULL,?,'manual',?,?,?,'submitted',?,?,?,?,?,?,?,?,?)`,
      [id, userId, input.kind, json(request), hashObject(request), `tx:${input.txHash}`, input.usdValue ?? null, input.asset ?? null, input.amount ?? null, input.destination ?? null, input.txHash, input.analysis ? json(input.analysis) : null, now(), now(), now()],
    );
    this.audit.record({ userId, actor: "user", action: `tx.submitted.${input.kind}`, subject: id, data: request });
    return id;
  }

  pending() {
    return this.db.all<{ id: string; user_id: string; kind: string; request_json: string; status: string; tx_hash: string; created_at: string }>(
      "SELECT id, user_id, kind, request_json, status, tx_hash, created_at FROM operations WHERE agent_id IS NULL AND tx_hash IS NOT NULL AND kind != 'manual_swap' AND kind != 'chain_sig_broadcast' AND status IN ('submitted','confirmed')",
    );
  }

  async refresh(id: string) {
    const op = this.db.get<{ id: string; user_id: string; kind: string; request_json: string; status: string; tx_hash: string; created_at: string }>("SELECT * FROM operations WHERE id = ?", [id]);
    if (!op) return null;
    const req = parse<{ signerId: string; network: Network } & Record<string, unknown>>(op.request_json);
    let outcome: TxOutcome;
    try {
      outcome = await this.rpcs[req.network].txStatus(op.tx_hash, req.signerId, "NONE");
    } catch (e) {
      // Unknown yet; give up after 30 minutes.
      if (Date.now() - Date.parse(op.created_at) > 30 * 60_000) this.set(op, "failed", { error: String(e) });
      return op.status;
    }
    const ok = txSucceeded(outcome);
    const finality = outcome.final_execution_status ?? "NONE";
    let next = op.status;
    if (ok === false) next = "failed";
    else if (finality === "FINAL") next = "settled";
    else if (["EXECUTED_OPTIMISTIC", "EXECUTED", "INCLUDED_FINAL", "INCLUDED"].includes(finality)) next = "confirmed";
    if (next !== op.status) {
      const events = extractEvents(outcome);
      this.set(op, next, { finality, events });
      this.storeEvents(req.network, op.tx_hash, outcome);
      if (next === "settled" || next === "failed") for (const h of this.hooks) await Promise.resolve(h({ id: op.id, kind: op.kind, outcome, meta: req })).catch(() => undefined);
    }
    return next;
  }

  private set(op: { id: string; user_id: string; kind: string; status: string }, next: string, settlement: Record<string, unknown>) {
    this.db.run(
      `UPDATE operations SET status = ?, settlement_json = ?, updated_at = ?, confirmed_at = CASE WHEN ? IN ('confirmed','settled') THEN COALESCE(confirmed_at, ?) ELSE confirmed_at END, settled_at = CASE WHEN ? = 'settled' THEN ? ELSE settled_at END WHERE id = ?`,
      [next, json(settlement), now(), next, now(), next, now(), op.id],
    );
    this.audit.record({ userId: op.user_id, actor: "system", action: `tx.${next}.${op.kind}`, subject: op.id, data: { finality: settlement.finality } });
    this.notifier.emit(op.user_id, "operation.status", { operationId: op.id, status: next });
    if (next === "failed") this.notifier.notify(op.user_id, "tx.failed", "Transaction failed", `${op.kind} failed on-chain.`, { operationId: op.id });
  }

  storeEvents(network: Network, txHash: string, outcome: TxOutcome) {
    let idx = 0;
    for (const r of outcome.receipts_outcome) {
      for (const log of r.outcome.logs) {
        if (!log.startsWith("EVENT_JSON:")) continue;
        try {
          const ev = JSON.parse(log.slice(11)) as { standard: string; event: string; data: unknown };
          this.db.run("INSERT OR IGNORE INTO chain_events (network, contract_id, tx_hash, idx, standard, event, data_json, created_at) VALUES (?,?,?,?,?,?,?,?)", [
            network, r.outcome.executor_id, txHash, idx++, ev.standard, ev.event, json(ev.data), now(),
          ]);
        } catch {
          /* ignore malformed */
        }
      }
    }
  }
}
