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
import { RULES, simulateWeek } from "./economy.js";

interface RunRow {
  id: string; kind: "practice" | "ranked"; vault: number; callsign: string; account: string | null; spec_json: string; spec_hash: string; engine: string;
  cracked: number; loot_atomic: string; stopped_by: string | null; steps_json: string; outcome_hash: string; entry_id: string | null; enter_tx: string | null;
  resolve_tx: string | null; receipt_id: string | null; created_at: string; loot_tx: string | null;
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
  readonly lootContractId: string | null;
  private readonly rpc: NearRpc;
  private readonly referee: { accountId: string; keyPair: ReturnType<typeof keyPairFrom> } | null;
  private hits = new Map<string, number[]>();
  private chainCache: { at: number; vaults: OnChainVault[] | null } = { at: 0, vaults: null };

  constructor(private readonly db: Db, private readonly receipts: ReceiptService, private readonly config: Config, fetcher?: typeof fetch) {
    this.network = config.HEIST_NETWORK;
    this.contractId = config.HEIST_CONTRACT_ID ?? null;
    this.lootContractId = config.LOOT_CONTRACT_ID ?? null;
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
    const stored = this.store("ranked", spec, r, { account: input.accountId, entryId: String(entryId), enterTx: input.txHash, resolveTx: res.transaction.hash });
    if (r.cracked) await this.mintBar(stored.id, input.accountId, args.vault);
    return this.get(stored.id);
  }

  /**
   * A ranked crack earns the vault's gold bar, minted as a NEP-245 token in veyra-loot. The pot is
   * already paid by then; if the mint fails the run still stands and the mint can be retried.
   */
  async mintBar(runId: string, account: string, vault: number) {
    if (!this.lootContractId || !this.referee) return null;
    try {
      const res = await sendTransaction(this.rpc, this.referee.accountId, this.referee.keyPair, this.lootContractId, [
        actionCreators.functionCall("mt_mint", { owner_id: account, token_ids: [`bar-${vault}`], amounts: ["1"], memo: `Veyra Heist ${runId}` }, 30_000_000_000_000n, 0n),
      ]);
      if (txSucceeded(res as unknown as TxOutcome) === false) return null; // send_tx reports a failed call without throwing
      this.db.run("UPDATE heist_runs SET loot_tx = ? WHERE id = ?", [res.transaction.hash, runId]);
      return res.transaction.hash;
    } catch {
      return null;
    }
  }

  /** Every item type in the loot contract, with supply. */
  async lootItems() {
    if (!this.lootContractId) return { contractId: null, items: [] };
    const items = await this.rpc.view<{ token_id: string; metadata: { title: string; description: string; media: string | null }; supply: string }[]>(this.lootContractId, "items", {}).catch(() => []);
    return { contractId: this.lootContractId, standard: "NEP-245", explorer: this.explorer("address", this.lootContractId), items };
  }

  /** A wallet's items, read from the loot contract with mt_batch_balance_of. */
  async lootOf(account: string) {
    if (!this.lootContractId) return { account, balances: {} as Record<string, string> };
    const ids = VAULTS.map((v) => `bar-${v.id}`);
    const bal = await this.rpc.view<string[]>(this.lootContractId, "mt_batch_balance_of", { account_id: account, token_ids: ids }).catch(() => ids.map(() => "0"));
    return { account, balances: Object.fromEntries(ids.map((id, i) => [id, bal[i] ?? "0"])) };
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
      lootTx: r.loot_tx ?? null,
      links: { enter: r.enter_tx ? this.explorer("txns", r.enter_tx) : null, resolve: r.resolve_tx ? this.explorer("txns", r.resolve_tx) : null, loot: r.loot_tx ? this.explorer("txns", r.loot_tx) : null },
    };
  }

  recent(limit = 30, vault?: number, kind?: "practice" | "ranked") {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (vault) { where.push("vault = ?"); args.push(vault); }
    if (kind) { where.push("kind = ?"); args.push(kind); }
    const rows = this.db.all<RunRow>(`SELECT * FROM heist_runs ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ?`, [...args, limit]);
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

  /** The referee's verdict for a spec without storing anything: the expected outcome of a ranked entry. */
  async preview(vault: number, input: unknown) {
    if (!vaultById(vault)) throw notFound("vault");
    const spec = this.parseSpec(input);
    const r = await runDuel(vault, spec);
    return { vault, cracked: r.cracked, lootAtomic: r.lootAtomic, stoppedBy: r.stoppedBy, specHash: r.specHash, outcomeHash: r.outcomeHash, engine: r.engine };
  }

  /** Everything about one player (a callsign or a NEAR account): totals, cracked vaults, agents and recent runs. */
  player(who: string) {
    const rows = this.db.all<RunRow>("SELECT * FROM heist_runs WHERE callsign = ? OR account = ? ORDER BY created_at DESC LIMIT 200", [who, who]);
    const cracked = [...new Set(rows.filter((r) => r.cracked).map((r) => r.vault))].sort();
    const agents = new Map<string, { name: string; runs: number; cracks: number; bestVault: number; lootAtomic: bigint; lastRunId: string; lastAt: string }>();
    for (const r of rows) {
      const name = parse<RogueSpec>(r.spec_json).agentName;
      const a = agents.get(name) ?? { name, runs: 0, cracks: 0, bestVault: 0, lootAtomic: 0n, lastRunId: r.id, lastAt: r.created_at };
      a.runs += 1;
      if (r.cracked) { a.cracks += 1; a.bestVault = Math.max(a.bestVault, r.vault); a.lootAtomic += BigInt(r.loot_atomic); }
      agents.set(name, a);
    }
    const loot = rows.reduce((t, r) => t + (r.cracked ? BigInt(r.loot_atomic) : 0n), 0n);
    return {
      player: who,
      runs: rows.length,
      cracks: rows.filter((r) => r.cracked).length,
      rankedRuns: rows.filter((r) => r.kind === "ranked").length,
      cracked,
      tried: [...new Set(rows.map((r) => r.vault))].sort(),
      lootAtomic: loot.toString(),
      agents: [...agents.values()].map((a) => ({ ...a, lootAtomic: a.lootAtomic.toString() })),
      recent: rows.slice(0, 20).map((r) => ({ ...this.view(r), steps: undefined })),
    };
  }

  /** A wallet's NEAR balance and its stake in every vault, read from the chain. */
  async account(accountId: string) {
    const acct = await this.rpc.viewAccount(accountId).catch((e) => {
      if (/UNKNOWN_ACCOUNT|does not exist/.test(String(e))) return null;
      throw e;
    });
    const stakes = this.contractId
      ? await Promise.all(VAULTS.map(async (v) => ({ vault: v.id, stake: await this.rpc.view<{ epoch: number; amount: string; earned: string } | null>(this.contractId!, "get_stake", { vault: v.id, account_id: accountId }).catch(() => null) })))
      : [];
    const gas = await this.rpc.call<{ gas_price: string }>("gas_price", [null]).catch(() => ({ gas_price: "100000000" }));
    return {
      accountId,
      exists: Boolean(acct),
      gasPriceYocto: gas.gas_price,
      balanceYocto: acct ? (BigInt(acct.amount)).toString() : "0",
      lockedYocto: acct?.locked ?? "0",
      storageBytes: acct?.storage_usage ?? 0,
      stakes: stakes.filter((s) => s.stake && (BigInt(s.stake.amount) > 0n || BigInt(s.stake.earned) > 0n)).map((s) => ({ vault: s.vault, amountYocto: s.stake!.amount, earnedYocto: s.stake!.earned })),
    };
  }

  /** Where a transaction stands on NEAR, and the entry it opened if it was an `enter`. */
  async tx(hash: string, sender: string) {
    const out = await this.rpc.txStatus(hash, sender, "NONE").catch(() => null);
    if (!out || !out.transaction) return { hash, found: false, success: null, entryId: null, entry: null, link: this.explorer("txns", hash) };
    const success = txSucceeded(out);
    const isEnter = (out.transaction.actions as { FunctionCall?: { method_name: string } }[]).some((a) => a.FunctionCall?.method_name === "enter");
    const entryId = isEnter && success ? lastSuccessValue<string>(out) : null;
    const entry = entryId && this.contractId ? await this.rpc.view(this.contractId, "get_entry", { entry_id: String(entryId) }).catch(() => null) : null;
    const run = entryId ? this.db.get<{ id: string }>("SELECT id FROM heist_runs WHERE entry_id = ?", [String(entryId)]) : undefined;
    return { hash, found: true, success, entryId: entryId === null ? null : String(entryId), entry, runId: run?.id ?? null, link: this.explorer("txns", hash) };
  }

  /** Heists per day and per vault, crack rates, and loot over time, for the stats page. */
  series(days = 14) {
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const daily = this.db.all<{ day: string; runs: number; cracks: number; ranked: number; loot: number }>(`
      SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS runs, SUM(cracked) AS cracks, SUM(CASE WHEN kind = 'ranked' THEN 1 ELSE 0 END) AS ranked,
             SUM(CASE WHEN cracked = 1 THEN CAST(loot_atomic AS INTEGER) ELSE 0 END) AS loot
      FROM heist_runs WHERE created_at >= ? GROUP BY day ORDER BY day`, [since]);
    const byVault = this.db.all<{ vault: number; runs: number; cracks: number }>("SELECT vault, COUNT(*) AS runs, SUM(cracked) AS cracks FROM heist_runs GROUP BY vault");
    const stoppers = this.db.all<{ shield: string; n: number }>("SELECT stopped_by AS shield, COUNT(*) AS n FROM heist_runs WHERE cracked = 0 AND stopped_by IS NOT NULL GROUP BY stopped_by ORDER BY n DESC");
    return {
      days: daily.map((d) => ({ day: d.day, runs: d.runs, cracks: d.cracks ?? 0, held: d.runs - (d.cracks ?? 0), ranked: d.ranked, lootAtomic: String(d.loot ?? 0) })),
      vaults: VAULTS.map((v) => { const x = byVault.find((b) => b.vault === v.id); return { vault: v.id, name: v.name, runs: x?.runs ?? 0, cracks: x?.cracks ?? 0 }; }),
      stoppers: stoppers.map((s) => ({ shield: s.shield, name: SHIELDS[s.shield as keyof typeof SHIELDS]?.name ?? s.shield, held: s.n })),
    };
  }

  /** Fast-forward: a week of the town's economy, from today's pots, run on the rules in economy.ts. */
  private simCache = new Map<string, { at: number; value: Awaited<ReturnType<typeof simulateWeek>> }>();
  async simulate(seed: number, days: number) {
    const v = await this.vaults();
    const startPots = v.map((x) => (x.chain ? Number(BigInt(x.chain.potYocto) / 10n ** 21n) : RULES.houseReseed[x.id]));
    const key = `${seed}:${days}:${startPots.join(",")}`;
    const hit = this.simCache.get(key);
    if (hit) return hit.value;
    const value = await simulateWeek({ seed, days, startPots });
    if (this.simCache.size > 20) this.simCache.clear();
    this.simCache.set(key, { at: Date.now(), value });
    return value;
  }

  stats() {
    const s = this.db.get<{ runs: number; cracks: number; players: number }>("SELECT COUNT(*) AS runs, SUM(cracked) AS cracks, COUNT(DISTINCT COALESCE(account, callsign)) AS players FROM heist_runs");
    return { runs: s?.runs ?? 0, cracks: s?.cracks ?? 0, players: s?.players ?? 0 };
  }
}
