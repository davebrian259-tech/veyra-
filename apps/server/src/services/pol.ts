import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Db } from "../db.js";
import { now } from "../db.js";
import { toAtomic, YOCTO } from "../lib/amounts.js";
import { randomId, sha256Hex } from "../lib/crypto.js";
import { badRequest, notConfigured, notFound } from "../lib/errors.js";
import type { User } from "./auth.js";
import type { WalletTx } from "./escrow.js";
import type { NearTxTracker, Network } from "./near-tx.js";

/**
 * PROOF OF LIFE — challenges and bounties on the `veyra-rewards` contract. Reward pools,
 * submissions (as evidence hashes), approvals and payouts are on-chain; evidence files are
 * stored off-chain here and only their SHA-256 is anchored.
 */
export class ProofOfLifeService {
  constructor(private readonly db: Db, private readonly tracker: NearTxTracker, private readonly opts: { network: Network; contractId?: string }) {}

  private contract() {
    if (!this.opts.contractId) throw notConfigured("rewards contract (REWARDS_CONTRACT_ID)");
    return this.opts.contractId;
  }

  private rpc() {
    return this.tracker.rpc(this.opts.network);
  }

  async challenges(from = 0, limit = 50) {
    return this.rpc().view<unknown[]>(this.contract(), "get_challenges", { from_index: from, limit });
  }

  async challenge(id: string) {
    const c = await this.rpc().view<unknown>(this.contract(), "get_challenge", { challenge_id: id });
    if (!c) throw notFound("challenge");
    const submissions = await this.rpc().view<unknown[]>(this.contract(), "get_submissions", { challenge_id: id });
    return { challenge: c, submissions };
  }

  async contributor(accountId: string) {
    const stats = await this.rpc().view<{ approved: number; rejected: number; submitted: number; total_earned: string }>(this.contract(), "get_contributor", { account_id: accountId });
    const marketplace = this.db.get<{ jobs: number; rating: number }>("SELECT SUM(completed_jobs) AS jobs, MAX(rating) AS rating FROM providers WHERE account_id = ?", [accountId]);
    const escrowsCompleted = this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM escrows WHERE provider_account = ? AND status = 'completed'", [accountId])?.n ?? 0;
    return { accountId, proofOfLife: stats, marketplace: { completedJobs: marketplace?.jobs ?? 0, rating: marketplace?.rating ?? null, escrowsCompleted } };
  }

  /** Leaderboard sorted off-chain from the contract's contributor stats. */
  async leaderboard(limit = 50) {
    const rows = await this.rpc().view<[string, { approved: number; total_earned: string; submitted: number; rejected: number }][]>(this.contract(), "get_contributors", { from_index: 0, limit: 200 });
    return rows
      .map(([accountId, s]) => ({ accountId, ...s, acceptanceRate: s.submitted ? s.approved / s.submitted : 0 }))
      .sort((a, b) => (BigInt(b.total_earned) > BigInt(a.total_earned) ? 1 : BigInt(b.total_earned) < BigInt(a.total_earned) ? -1 : b.approved - a.approved))
      .slice(0, limit);
  }

  async treasury() {
    const list = (await this.challenges(0, 100)) as { pool_remaining: string; status: string }[];
    const open = list.filter((c) => c.status === "open");
    const locked = open.reduce((n, c) => n + BigInt(c.pool_remaining), 0n);
    const account = await this.rpc().viewAccount(this.contract()).catch(() => null);
    return { contractId: this.contract(), openChallenges: open.length, rewardPoolsYocto: locked.toString(), contractBalanceYocto: account?.amount ?? null };
  }

  createTx(input: { kind: "challenge" | "bounty" | "community_objective"; title: string; rulesHash: string; metadataUri?: string | null; reviewers: string[]; rewardNear: string; maxApprovals: number; deadlineDays: number }): WalletTx {
    const reward = toAtomic(input.rewardNear, YOCTO);
    const pool = BigInt(reward) * BigInt(input.maxApprovals);
    const deposit = (pool + BigInt(toAtomic("0.05", YOCTO))).toString(); // excess storage deposit is refunded
    return {
      receiverId: this.contract(),
      actions: [{
        type: "FunctionCall",
        params: {
          methodName: "create_challenge",
          args: { kind: input.kind, title: input.title, rules_hash: input.rulesHash, metadata_uri: input.metadataUri ?? null, reviewers: input.reviewers, reward_per_approval: reward, max_approvals: input.maxApprovals, deadline_ns: (BigInt(Date.now() + input.deadlineDays * 86_400_000) * 1_000_000n).toString() },
          gas: "100000000000000",
          deposit,
        },
      }],
    };
  }

  submitTx(challengeId: string, evidenceHash: string, evidenceUri: string | null): WalletTx {
    return { receiverId: this.contract(), actions: [{ type: "FunctionCall", params: { methodName: "submit", args: { challenge_id: challengeId, evidence_hash: evidenceHash, evidence_uri: evidenceUri }, gas: "50000000000000", deposit: toAtomic("0.01", YOCTO) } }] };
  }

  reviewTx(challengeId: string, contributor: string, approve: boolean, note: string | null): WalletTx {
    return { receiverId: this.contract(), actions: [{ type: "FunctionCall", params: { methodName: "review", args: { challenge_id: challengeId, contributor, approve, note }, gas: "50000000000000", deposit: "0" } }] };
  }

  closeTx(challengeId: string): WalletTx {
    return { receiverId: this.contract(), actions: [{ type: "FunctionCall", params: { methodName: "close_challenge", args: { challenge_id: challengeId }, gas: "50000000000000", deposit: "0" } }] };
  }

  recordTx(user: User, action: string, txHash: string, meta: Record<string, unknown> = {}) {
    return { operationId: this.tracker.track(user.id, { kind: `pol_${action}`, txHash, signerId: user.accountId, network: this.opts.network, destination: this.contract(), meta }) };
  }
}

/** Off-chain evidence store: content-addressed by SHA-256, the hash is what goes on-chain. */
export class EvidenceStore {
  constructor(private readonly db: Db, private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  save(user: User, input: { filename: string; mime: string; dataBase64: string }) {
    const data = Buffer.from(input.dataBase64, "base64");
    if (!data.length) throw badRequest("empty_file", "evidence file is empty");
    if (data.length > 10 * 1024 * 1024) throw badRequest("too_large", "evidence must be 10 MB or less");
    const hash = sha256Hex(data);
    const id = randomId("evd_");
    const path = resolve(join(this.dir, hash));
    writeFileSync(path, data);
    this.db.run("INSERT INTO evidence (id, user_id, sha256, filename, mime, size, path, created_at) VALUES (?,?,?,?,?,?,?,?)", [id, user.id, hash, input.filename.slice(0, 200), input.mime.slice(0, 100), data.length, path, now()]);
    return { id, evidenceHash: `sha256:${hash}`, uri: `veyra://evidence/${hash}`, size: data.length };
  }

  get(hash: string) {
    const h = hash.replace(/^sha256:/, "");
    const row = this.db.get<{ path: string; mime: string; filename: string }>("SELECT path, mime, filename FROM evidence WHERE sha256 = ? LIMIT 1", [h]);
    if (!row) throw notFound("evidence");
    return row;
  }
}
