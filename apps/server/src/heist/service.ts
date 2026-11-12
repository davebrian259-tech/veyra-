import { actionCreators } from "@near-js/transactions";
import type { Config } from "../config.js";
import type { ReceiptService } from "../contractor/receipts.js";
import type { Db } from "../db.js";
import { json, now, parse } from "../db.js";
import { randomId } from "../lib/crypto.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { NearRpc, txSucceeded, lastSuccessValue, type TxOutcome } from "../lib/near-rpc.js";
import { keyPairFrom, sendTransaction } from "../lib/near-signer.js";
import { ENGINE_VERSION, rogueSpecSchema, runDuel, specHash, TEMPLATES, type DuelResult, type RogueSpec } from "./referee.js";
import { SHIELDS, VAULTS, vault as vaultById } from "./vaults.js";

interface RunRow {
  id: string; kind: "practice" | "ranked"; vault: number; callsign: string; account: string | null; spec_json: string; spec_hash: string; engine: string;
  cracked: number; loot_atomic: string; stopped_by: string | null; steps_json: string; outcome_hash: string; entry_id: string | null; enter_tx: string | null;
  resolve_tx: string | null; receipt_id: string | null; created_at: string;
}

interface OnChainVault { fee: string; pot: string; staked: string; attempts: number; cracks: number; epoch: number; last_cracked_by: string | null }

const YOCTO = 10n ** 24n;
const nearToYocto = (n: string) => {
  const [w, f = ""] = n.split(".");
  return (BigInt(w) * YOCTO + BigInt((f + "0".repeat(24)).slice(0, 24))).toString();
};

/** Practice and ranked runs, the leaderboard, and the pot contract. */
export class HeistService {
  readonly network: "testnet" | "mainnet";
  readonly contractId: string | null;
  private readonly rpc: NearRpc;
  private readonly referee: { accountId: string; keyPair: ReturnType<typeof keyPairFrom> } | null;
  private hits = new Map<string, number[]>();
  private chainCache: { at: number; vaults: OnChainVault[] | null } = { at: 0, vaults: null };

  constructor(private readonly db: Db, private readonly receipts: ReceiptService, private readonly config: Config, fetcher?: typeof fetch) {
    this.network = config.HEIST_NETWORK;
    this.contractId = config.HEIST_CONTRACT_ID ?? null;
    this.rpc = new NearRpc(this.network === "mainnet" ? config.NEAR_MAINNET_RPC_URL : "https://rpc.testnet.near.org", fetcher);
    const id = config.HEIST_REFEREE_ID ?? config.LEDGER_WRITER_ID;
    const key = config.HEIST_REFEREE_KEY ?? config.LEDGER_WRITER_KEY;
    this.referee = id && key ? { accountId: id, keyPair: keyPairFrom(key) } : null;
  }

  get rankedEnabled() {
    return Boolean(this.contractId && this.referee);
  }

  explorer(kind: "txns" | "address", id: string) {
    return `${this.network === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io"}/${kind}/${id}`;
  }

  /** A simple sliding window per visitor, so practice stays free without being abusable. */
  limit(who: string) {
    const t = Date.now();
    const xs = (this.hits.get(who) ?? []).filter((x) => t - x < 60_000);
    if (xs.length >= this.config.HEIST_RATE_PER_MIN) throw conflict("slow_down", "Too many runs in a minute. Take a breath and try again shortly.");
    xs.push(t);
    this.hits.set(who, xs);
  }

  // ---------------------------------------------------------------- lobby

  async vaults() {
    const chain = await this.chainVaults();
    const local = this.db.all<{ vault: number; attempts: number; cracks: number }>("SELECT vault, COUNT(*) AS attempts, SUM(cracked) AS cracks FROM heist_runs GROUP BY vault");
    return VAULTS.map((v) => {
      const c = chain?.[v.id - 1];
      const l = local.find((x) => x.vault === v.id);
      const firstCrack = this.db.get<{ callsign: string; account: string | null; created_at: string }>("SELECT callsign, account, created_at FROM heist_runs WHERE vault = ? AND cracked = 1 ORDER BY created_at LIMIT 1", [v.id]);
      return {
        ...v,
        shields: v.shields.map((s) => SHIELDS[s]),
        feeYocto: nearToYocto(v.feeNear),
        practice: { attempts: l?.attempts ?? 0, cracks: l?.cracks ?? 0, firstCrack: firstCrack ?? null },
        chain: c ? { potYocto: c.pot, stakedYocto: c.staked, attempts: c.attempts, cracks: c.cracks, lastCrackedBy: c.last_cracked_by, epoch: c.epoch } : null,
      };
    });
  }

  private async chainVaults(): Promise<OnChainVault[] | null> {
    if (!this.contractId) return null;
    if (Date.now() - this.chainCache.at < 10_000) return this.chainCache.vaults;
    const vaults = await this.rpc.view<OnChainVault[]>(this.contractId, "get_vaults", {}).catch(() => this.chainCache.vaults);
    this.chainCache = { at: Date.now(), vaults };
    return vaults;
  }

  templates() {
    return TEMPLATES;
  }

  // ---------------------------------------------------------------- runs

  async practice(vault: number, input: unknown) {
    if (!vaultById(vault)) throw notFound("vault");
    const spec = this.parseSpec(input);
    const r = await runDuel(vault, spec);
    return this.store("practice", spec, r, {});
  }

  /**
   * A ranked run: the player has called `enter(vault, spec_hash)` on the pot contract with their
   * wallet. Veyra checks that transaction on-chain, runs the duel, and settles it with `resolve`.
   */
  async ranked(input: { txHash: string; accountId: string; spec: unknown }) {
    if (!this.rankedEnabled || !this.referee) throw conflict("ranked_off", "Ranked runs are not configured on this server.");
    const spec = this.parseSpec(input.spec);
    const hash = specHash(spec);
    let tx: TxOutcome;
    try {
      tx = await this.rpc.txStatus(input.txHash, input.accountId, "EXECUTED_OPTIMISTIC");
    } catch (e) {
      throw badRequest("tx_not_found", `Could not find that entry transaction on NEAR ${this.network}. Wait a few seconds and try again. (${e instanceof Error ? e.message : e})`);
    }
    if (tx.transaction.receiver_id !== this.contractId) throw badRequest("wrong_contract", "That transaction did not call the Heist contract.");
    if (tx.transaction.signer_id !== input.accountId) throw badRequest("wrong_signer", "That transaction was signed by another account.");
    if (txSucceeded(tx) !== true) throw badRequest("tx_failed", "The entry transaction did not succeed on-chain.");
    const call = (tx.transaction.actions as { FunctionCall?: { method_name: string; args: string } }[]).find((a) => a.FunctionCall?.method_name === "enter")?.FunctionCall;
    if (!call) throw badRequest("not_entry", "That transaction is not a Heist entry.");
    const args = JSON.parse(Buffer.from(call.args, "base64").toString("utf8")) as { vault: number; spec_hash: string };
    if (args.spec_hash !== hash) throw badRequest("spec_mismatch", "The rogue agent you sent is not the one you committed to. Send exactly the spec you entered with.");
    const entryId = lastSuccessValue<string>(tx);
    if (entryId === null) throw badRequest("no_entry", "The entry transaction returned no entry id.");
    const existing = this.db.get<RunRow>("SELECT * FROM heist_runs WHERE entry_id = ?", [String(entryId)]);
    if (existing) return this.view(existing);
    const entry = await this.rpc.view<{ status: string; player: string; vault: number }>(this.contractId!, "get_entry", { entry_id: String(entryId) });
    if (!entry || entry.status !== "Pending") throw conflict("entry_settled", "This entry is already settled.");
    if (entry.player !== input.accountId) throw badRequest("wrong_player", "This entry belongs to another player.");

    const r = await runDuel(args.vault, spec);
    const res = await sendTransaction(this.rpc, this.referee.accountId, this.referee.keyPair, this.contractId!, [
      actionCreators.functionCall("resolve", { entry_id: String(entryId), cracked: r.cracked, loot: r.lootAtomic, outcome_hash: r.outcomeHash }, 100_000_000_000_000n, 0n),
    ]);
    this.chainCache.at = 0;
    return this.store("ranked", spec, r, { account: input.accountId, entryId: String(entryId), enterTx: input.txHash, resolveTx: res.transaction.hash });
  }

  private parseSpec(input: unknown): RogueSpec {
    const r = rogueSpecSchema.safeParse(input);
    if (!r.success) throw badRequest("invalid_spec", `Your rogue agent is not valid: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}.`);
    return r.data;
  }

  private store(kind: "practice" | "ranked", spec: RogueSpec, r: DuelResult, extra: { account?: string; entryId?: string; enterTx?: string; resolveTx?: string }) {
    const id = randomId("run_");
    const receipt = this.receipts.issue("heist_run", "heist", null, {
      runId: id, kind, vault: r.vault, engine: r.engine, specHash: r.specHash, outcomeHash: r.outcomeHash, cracked: r.cracked, lootAtomic: r.lootAtomic,
      stoppedBy: r.stoppedBy, player: extra.account ?? spec.callsign, entryId: extra.entryId ?? null, resolveTx: extra.resolveTx ?? null,
    });
    this.db.run(
      `INSERT INTO heist_runs (id, kind, vault, callsign, account, spec_json, spec_hash, engine, cracked, loot_atomic, stopped_by, steps_json, outcome_hash, entry_id, enter_tx, resolve_tx, receipt_id, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, kind, r.vault, spec.callsign, extra.account ?? null, json(spec), r.specHash, r.engine, r.cracked ? 1 : 0, r.lootAtomic, r.stoppedBy, json(r.steps), r.outcomeHash, extra.entryId ?? null, extra.enterTx ?? null, extra.resolveTx ?? null, receipt.id, now()],
    );
    return this.get(id);
  }

  get(id: string) {
    const row = this.db.get<RunRow>("SELECT * FROM heist_runs WHERE id = ?", [id]);
    if (!row) throw notFound("run");
    return this.view(row);
  }

  private view(r: RunRow) {
    return {
      id: r.id, kind: r.kind, vault: r.vault, callsign: r.callsign, account: r.account, spec: parse<RogueSpec>(r.spec_json), specHash: r.spec_hash, engine: r.engine,
      cracked: Boolean(r.cracked), lootAtomic: r.loot_atomic, stoppedBy: r.stopped_by, steps: parse(r.steps_json), outcomeHash: r.outcome_hash,
      entryId: r.entry_id, enterTx: r.enter_tx, resolveTx: r.resolve_tx, receiptId: r.receipt_id, createdAt: r.created_at,
      links: { enter: r.enter_tx ? this.explorer("txns", r.enter_tx) : null, resolve: r.resolve_tx ? this.explorer("txns", r.resolve_tx) : null },
    };
  }

  recent(limit = 30, vault?: number) {
    const rows = this.db.all<RunRow>(`SELECT * FROM heist_runs ${vault ? "WHERE vault = ?" : ""} ORDER BY created_at DESC LIMIT ?`, vault ? [vault, limit] : [limit]);
    return rows.map((r) => ({ ...this.view(r), steps: undefined, spec: { agentName: parse<RogueSpec>(r.spec_json).agentName } }));
  }

  /** Re-runs a stored attempt and checks the referee would give the same outcome. */
  async replay(id: string) {
    const run = this.get(id);
    const again = await runDuel(run.vault, run.spec);
    return { runId: id, engine: ENGINE_VERSION, stored: run.outcomeHash, replayed: again.outcomeHash, matches: again.outcomeHash === run.outcomeHash, cracked: again.cracked, lootAtomic: again.lootAtomic };
  }

  /** Best vault cracked, then total loot, then who got there first. */
  leaderboard(limit = 50) {
    const rows = this.db.all<{ who: string; account: string | null; best: number; loot: number; runs: number; cracks: number; ranked: number; first: string }>(`
      SELECT COALESCE(account, callsign) AS who, MAX(account) AS account,
             MAX(CASE WHEN cracked = 1 THEN vault ELSE 0 END) AS best,
             SUM(CASE WHEN cracked = 1 THEN CAST(loot_atomic AS INTEGER) ELSE 0 END) AS loot,
             COUNT(*) AS runs, SUM(cracked) AS cracks, SUM(CASE WHEN kind = 'ranked' THEN 1 ELSE 0 END) AS ranked,
             MIN(CASE WHEN cracked = 1 THEN created_at END) AS first
      FROM heist_runs GROUP BY COALESCE(account, callsign)
      ORDER BY best DESC, loot DESC, first ASC LIMIT ?`, [limit]);
    return rows.map((r, i) => ({ rank: i + 1, player: r.who, account: r.account, bestVault: r.best, lootAtomic: String(r.loot ?? 0), runs: r.runs, cracks: r.cracks ?? 0, rankedRuns: r.ranked, firstCrackAt: r.first }));
  }

  /** What the pot contract knows about an underwriter, for the UI. */
  async stake(vault: number, account: string) {
    if (!this.contractId) return null;
    return this.rpc.view(this.contractId, "get_stake", { vault, account_id: account }).catch(() => null);
  }

  stats() {
    const s = this.db.get<{ runs: number; cracks: number; players: number }>("SELECT COUNT(*) AS runs, SUM(cracked) AS cracks, COUNT(DISTINCT COALESCE(account, callsign)) AS players FROM heist_runs");
    return { runs: s?.runs ?? 0, cracks: s?.cracks ?? 0, players: s?.players ?? 0 };
  }
}
