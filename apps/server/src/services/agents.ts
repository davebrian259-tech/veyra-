import {
  AgentApiError,
  createAgentApi,
  createGrantCredential,
  createIdempotencyKey,
  type AgentApi,
  type GenerateIntentRequest,
  type GenerateIntentResponse,
  type SignedData,
  type StatusResponse,
} from "@near-intents-agent-api/sdk";
import type { Db } from "../db.js";
import { json, now, parse } from "../db.js";
import { canonicalJson, randomId, type SecretBox } from "../lib/crypto.js";
import { badRequest, conflict, forbidden, HttpError, notConfigured, notFound } from "../lib/errors.js";
import type { AuditLog } from "./audit.js";
import type { User } from "./auth.js";
import type { Notifier } from "./notifications.js";
import { describePolicy, policyHash, toApiPolicy, type VeyraPolicy } from "./policy.js";

export interface AgentRow {
  id: string;
  user_id: string;
  name: string;
  owner_account_id: string;
  owner_public_key: string;
  near_account_id: string | null;
  evm_account_id: string | null;
  solana_account_id: string | null;
  status: string;
  local_frozen: number;
  created_at: string;
  updated_at: string;
}

const TERMINAL = new Set(["SUCCESS", "FAILED", "REFUNDED", "NEEDS_REVIEW"]);

/** Shown before every owner signature, as the Agent API requires. */
export const RISK_NOTICE =
  "The NEAR Intents Agent API is an experimental, mainnet-only beta operated by NEAR Technologies Limited. " +
  "You may lose all assets used with it, or lose access to them. Use small amounts. Review the Owner Terms and OutLayer's terms before signing.";

/**
 * Owner-controlled agent lifecycle on the NEAR Intents Agent API.
 *
 * Every owner action follows generate → owner signs in their wallet → submit → follow status.
 * The partner API key lives only in this process; grant tokens are created here, sealed with
 * AES-GCM and never returned to the browser or passed to the AI.
 */
export class AgentService {
  private client?: AgentApi;

  constructor(
    private readonly db: Db,
    private readonly audit: AuditLog,
    private readonly notifier: Notifier,
    private readonly secrets: SecretBox,
    private readonly opts: { apiKey?: string; baseUrl: string; grantTtlDays: number; fetch?: typeof fetch },
  ) {}

  get configured() {
    return Boolean(this.opts.apiKey);
  }

  api(): AgentApi {
    if (!this.opts.apiKey) throw notConfigured("NEAR Intents Agent API (NEAR_INTENTS_AGENT_API_KEY)");
    this.client ??= createAgentApi({ apiKey: this.opts.apiKey, baseUrl: this.opts.baseUrl, fetch: this.opts.fetch });
    return this.client;
  }

  // ---------------------------------------------------------------- ownership

  getAgentRow(agentId: string): AgentRow | undefined {
    return this.db.get<AgentRow>("SELECT * FROM agents WHERE id = ?", [agentId]);
  }

  /** The authenticated user must own the agent, both in Veyra's records and as signer. */
  assertOwner(user: User, agentId: string): AgentRow {
    const row = this.getAgentRow(agentId);
    if (!row) throw notFound("agent");
    if (row.user_id !== user.id || row.owner_account_id !== user.accountId) throw forbidden("you do not own this agent");
    return row;
  }

  listAgents(user: User) {
    return this.db.all<AgentRow>("SELECT * FROM agents WHERE user_id = ? ORDER BY created_at DESC", [user.id]);
  }

  activePolicy(agentId: string): { policy: VeyraPolicy; hash: string; id: number } | null {
    const row = this.db.get<{ id: number; policy_json: string; policy_hash: string }>(
      "SELECT id, policy_json, policy_hash FROM veyra_policies WHERE agent_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1",
      [agentId],
    );
    return row ? { policy: parse<VeyraPolicy>(row.policy_json), hash: row.policy_hash, id: row.id } : null;
  }

  isFrozen(agentId: string): boolean {
    return Boolean(this.getAgentRow(agentId)?.local_frozen);
  }

  // ---------------------------------------------------------------- owner intents

  private owner(user: User) {
    return { type: "near" as const, account_id: user.accountId, public_key: user.publicKey };
  }

  private async generate(user: User, agentId: string | null, request: GenerateIntentRequest, meta: Record<string, unknown> = {}) {
    const idempotencyKey = createIdempotencyKey();
    let generated: GenerateIntentResponse;
    try {
      generated = (await this.api().generateIntent(request as never, { idempotencyKey })) as unknown as GenerateIntentResponse;
    } catch (e) {
      throw toHttp(e);
    }
    const agent = agentId ?? generated.agent_id;
    this.db.run(
      `INSERT INTO owner_intents (correlation_id, user_id, agent_id, type, status, intent_json, preview_json, idempotency_key, meta_json, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [generated.correlation_id, user.id, agent, generated.type, generated.status, json(generated.intent), json(generated.preview), idempotencyKey, json(meta), now(), now()],
    );
    this.audit.record({ userId: user.id, actor: "user", action: `owner_intent.generated.${generated.type}`, subject: agent, data: { correlationId: generated.correlation_id, summary: generated.preview.summary } });
    return {
      correlationId: generated.correlation_id,
      type: generated.type,
      agentId: agent,
      expiresAt: generated.expires_at,
      intent: generated.intent,
      preview: generated.preview,
      riskNotice: RISK_NOTICE,
    };
  }

  /** Step 1 of agent creation: prepares the agent_create intent with the initial policy. */
  async prepareCreate(user: User, input: { name: string; policy: VeyraPolicy }) {
    const apiPolicy = toApiPolicy(input.policy);
    const hash = policyHash(input.policy);
    const out = await this.generate(
      user,
      null,
      { type: "agent_create", name: input.name, external_user_id: user.id, owner: this.owner(user), policy: apiPolicy },
      { veyraPolicyHash: hash },
    );
    this.db.tx(() => {
      this.db.run(
        `INSERT OR IGNORE INTO agents (id, user_id, name, owner_account_id, owner_public_key, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
        [out.agentId, user.id, input.name, user.accountId, user.publicKey, "PENDING", now(), now()],
      );
      this.db.run(
        `INSERT INTO veyra_policies (user_id, agent_id, policy_json, policy_hash, api_policy_json, status, correlation_id, created_at) VALUES (?,?,?,?,?,?,?,?)`,
        [user.id, out.agentId, json(input.policy), hash, json(apiPolicy), "pending", out.correlationId, now()],
      );
    });
    return { ...out, veyraPolicyHash: hash, policySummary: describePolicy(input.policy) };
  }

  async preparePolicyUpdate(user: User, agentId: string, policy: VeyraPolicy) {
    this.assertOwner(user, agentId);
    const current = await this.api().getPolicy(agentId).catch((e) => { throw toHttp(e); });
    if (current.revision === null || current.policy === null) throw conflict("policy_not_ready", "the agent's current policy is not applied yet");
    const apiPolicy = toApiPolicy(policy, current.policy.frozen);
    const hash = policyHash(policy);
    const out = await this.generate(user, agentId, { type: "policy_update", agent_id: agentId, expected_revision: current.revision, policy: apiPolicy }, { veyraPolicyHash: hash });
    this.db.run(
      `INSERT INTO veyra_policies (user_id, agent_id, policy_json, policy_hash, api_policy_json, status, correlation_id, created_at) VALUES (?,?,?,?,?,?,?,?)`,
      [user.id, agentId, json(policy), hash, json(apiPolicy), "pending", out.correlationId, now()],
    );
    return { ...out, veyraPolicyHash: hash, policySummary: describePolicy(policy) };
  }

  /** Creates the grant credential here; only its commitment goes to the owner's wallet. */
  async prepareGrant(user: User, agentId: string, label = "Veyra backend") {
    this.assertOwner(user, agentId);
    const { token, commitment } = createGrantCredential();
    const expiresAt = new Date(Date.now() + this.opts.grantTtlDays * 86_400_000).toISOString();
    const id = randomId("grt_");
    const out = await this.generate(user, agentId, { type: "grant_issue", agent_id: agentId, label, credential: commitment, expires_at: expiresAt }, { grantLocalId: id });
    this.db.run(
      `INSERT INTO grants (id, agent_id, user_id, label, token_enc, commitment, expires_at, status, correlation_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [id, agentId, user.id, label, this.secrets.seal(token, `grant:${agentId}:${id}`), commitment, expiresAt, "pending", out.correlationId, now(), now()],
    );
    return { ...out, grant: { id, label, expiresAt } };
  }

  async prepareRevoke(user: User, agentId: string, grantId: string) {
    this.assertOwner(user, agentId);
    return this.generate(user, agentId, { type: "grant_revoke", agent_id: agentId, grant_id: grantId }, { grantId });
  }

  /**
   * Emergency freeze. Veyra's local kill switch engages immediately (no dispatch can leave this
   * backend), then the owner signs `agent_freeze` so the Agent API refuses everything too.
   */
  async freeze(user: User, agentId: string, reason = "owner requested") {
    this.assertOwner(user, agentId);
    this.db.run("UPDATE agents SET local_frozen = 1, updated_at = ? WHERE id = ?", [now(), agentId]);
    this.db.run("UPDATE operations SET status = 'cancelled', error = 'agent frozen', updated_at = ? WHERE agent_id = ? AND status IN ('pending_approval')", [now(), agentId]);
    this.db.run("UPDATE approvals SET status = 'expired', decided_at = ? WHERE status = 'pending' AND operation_id IN (SELECT id FROM operations WHERE agent_id = ?)", [now(), agentId]);
    this.audit.record({ userId: user.id, actor: "user", action: "agent.freeze.local", subject: agentId, data: { reason } });
    this.notifier.notify(user.id, "agent.frozen", "Agent frozen", "Veyra stopped all agent activity. Sign the freeze to also lock it at the NEAR Intents Agent API.", { agentId });
    let intent = null;
    let error: string | null = null;
    if (this.configured) {
      try {
        intent = await this.generate(user, agentId, { type: "agent_freeze", agent_id: agentId }, { reason });
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
    }
    return { localFrozen: true, intent, error };
  }

  /** Unfreezing is never local-only: the local switch lifts when the signed unfreeze succeeds. */
  async prepareUnfreeze(user: User, agentId: string) {
    this.assertOwner(user, agentId);
    return this.generate(user, agentId, { type: "agent_unfreeze", agent_id: agentId });
  }

  async prepareApprovalVote(user: User, agentId: string, approvalId: string, verdict: "approve" | "reject") {
    this.assertOwner(user, agentId);
    return this.generate(user, agentId, { type: "approval_vote", agent_id: agentId, approval_id: approvalId, verdict });
  }

  async prepareExecutionCancel(user: User, agentId: string, correlationId: string) {
    this.assertOwner(user, agentId);
    return this.generate(user, agentId, { type: "execution_cancel", agent_id: agentId, correlation_id: correlationId });
  }

  /** Step 3: the browser returns the wallet's signature; we submit it unchanged. */
  async submit(user: User, correlationId: string, signed: SignedData) {
    const row = this.db.get<{ user_id: string; type: string; intent_json: string; agent_id: string; status: string }>(
      "SELECT * FROM owner_intents WHERE correlation_id = ?",
      [correlationId],
    );
    if (!row) throw notFound("owner intent");
    if (row.user_id !== user.id) throw forbidden("this intent belongs to another user");
    const intent = parse<{ standard: string; payload: unknown }>(row.intent_json);
    if (signed.standard !== intent.standard || canonicalJson(signed.payload) !== canonicalJson(intent.payload)) {
      throw badRequest("payload_mismatch", "the signed payload differs from the prepared intent");
    }
    let status: StatusResponse;
    try {
      status = (await this.api().submitIntent({ type: row.type as never, correlation_id: correlationId, signed_data: signed })) as StatusResponse;
    } catch (e) {
      throw toHttp(e);
    }
    // applyStatus records the new status and runs side effects exactly once.
    this.audit.record({ userId: user.id, actor: "user", action: `owner_intent.signed.${row.type}`, subject: row.agent_id, data: { correlationId, status: status.status } });
    await this.applyStatus(correlationId, status);
    return status;
  }

  /** Polls one owner intent and applies side effects once it settles. */
  async refreshOwnerIntent(correlationId: string, waitMs = 0) {
    const status = await this.api().getStatus(correlationId, waitMs ? { waitMs } : undefined);
    await this.applyStatus(correlationId, status);
    return status;
  }

  pendingOwnerIntents() {
    return this.db.all<{ correlation_id: string }>(
      "SELECT correlation_id FROM owner_intents WHERE status NOT IN ('SUCCESS','FAILED','REFUNDED','NEEDS_REVIEW','PENDING_SIGNATURE','EXPIRED')",
    );
  }

  private async applyStatus(correlationId: string, status: StatusResponse) {
    const row = this.db.get<{ user_id: string; type: string; agent_id: string; status: string; meta_json: string }>(
      "SELECT * FROM owner_intents WHERE correlation_id = ?",
      [correlationId],
    );
    if (!row) return;
    const wasTerminal = TERMINAL.has(row.status) && row.status === status.status;
    this.db.run("UPDATE owner_intents SET status = ?, failure_code = ?, updated_at = ? WHERE correlation_id = ?", [status.status, status.failure_code, now(), correlationId]);
    if (wasTerminal || !TERMINAL.has(status.status)) return;
    const meta = parse<Record<string, string>>(row.meta_json) ?? {};
    const ok = status.status === "SUCCESS";
    const agentId = row.agent_id;
    this.audit.record({ userId: row.user_id, actor: "system", action: `owner_intent.${ok ? "succeeded" : "failed"}.${row.type}`, subject: agentId, data: { correlationId, failure: status.failure_code } });
    if (!ok) {
      if (row.type === "agent_create") this.db.run("UPDATE agents SET status = 'FAILED', updated_at = ? WHERE id = ?", [now(), agentId]);
      if (row.type === "grant_issue") this.db.run("UPDATE grants SET status = 'failed', updated_at = ? WHERE correlation_id = ?", [now(), correlationId]);
      this.db.run("UPDATE veyra_policies SET status = 'failed' WHERE correlation_id = ?", [correlationId]);
      this.notifier.notify(row.user_id, "owner_intent.failed", `${row.type} failed`, status.failure_code ?? status.status, { correlationId });
      return;
    }
    switch (row.type) {
      case "agent_create":
        this.activatePolicy(agentId, correlationId);
        await this.syncAgent(agentId).catch(() => undefined);
        this.notifier.notify(row.user_id, "agent.created", "Agent created", "Your agent wallet exists. Issue a grant so Veyra can act within its policy.", { agentId });
        break;
      case "policy_update":
        this.activatePolicy(agentId, correlationId);
        this.notifier.notify(row.user_id, "agent.policy", "Policy updated", "The new spending policy is in force.", { agentId });
        break;
      case "grant_issue": {
        const grantId = (status.details as { grant_id?: string } | null)?.grant_id ?? null;
        this.db.run("UPDATE grants SET status = 'active', grant_id = COALESCE(?, grant_id), updated_at = ? WHERE correlation_id = ?", [grantId, now(), correlationId]);
        if (!grantId) await this.syncGrantIds(agentId).catch(() => undefined);
        this.notifier.notify(row.user_id, "agent.grant", "Grant issued", "Veyra may now act within the agent's policy.", { agentId });
        break;
      }
      case "grant_revoke":
        this.db.run("UPDATE grants SET status = 'revoked', updated_at = ? WHERE agent_id = ? AND grant_id = ?", [now(), agentId, meta.grantId ?? ""]);
        break;
      case "agent_freeze":
        this.db.run("UPDATE agents SET local_frozen = 1, updated_at = ? WHERE id = ?", [now(), agentId]);
        break;
      case "agent_unfreeze":
        this.db.run("UPDATE agents SET local_frozen = 0, updated_at = ? WHERE id = ?", [now(), agentId]);
        this.audit.record({ userId: row.user_id, actor: "system", action: "agent.unfreeze.local", subject: agentId });
        this.notifier.notify(row.user_id, "agent.unfrozen", "Agent unfrozen", "Agent activity may resume within its policy.", { agentId });
        break;
      case "agent_delete":
      case "agent_archive":
        this.db.run("UPDATE agents SET status = ?, local_frozen = 1, updated_at = ? WHERE id = ?", [row.type === "agent_delete" ? "DELETED" : "ARCHIVED", now(), agentId]);
        break;
    }
  }

  private activatePolicy(agentId: string, correlationId: string) {
    this.db.tx(() => {
      const pending = this.db.get<{ id: number }>("SELECT id FROM veyra_policies WHERE correlation_id = ? AND status = 'pending'", [correlationId]);
      if (!pending) return;
      this.db.run("UPDATE veyra_policies SET status = 'superseded' WHERE agent_id = ? AND status = 'active'", [agentId]);
      this.db.run("UPDATE veyra_policies SET status = 'active', activated_at = ? WHERE id = ?", [now(), pending.id]);
    });
  }

  async syncAgent(agentId: string) {
    const agent = await this.api().getAgent(agentId);
    this.db.run(
      "UPDATE agents SET status = ?, near_account_id = ?, evm_account_id = ?, solana_account_id = ?, updated_at = ? WHERE id = ?",
      [agent.status, agent.wallet?.near_account_id ?? null, agent.wallet?.evm_account_id ?? null, agent.wallet?.solana_account_id ?? null, now(), agentId],
    );
    return agent;
  }

  private async syncGrantIds(agentId: string) {
    const grants = await this.api().listGrants(agentId);
    for (const g of grants) {
      const local = this.db.get<{ id: string; commitment: string }>("SELECT id, commitment FROM grants WHERE agent_id = ? AND commitment = ?", [agentId, g.owner_message.credential]);
      if (local) this.db.run("UPDATE grants SET grant_id = ?, status = ? WHERE id = ?", [g.grant_id, g.revoked_at ? "revoked" : "active", local.id]);
    }
  }

  /**
   * The only place a grant token is decrypted. Returns a per-grant SDK client; callers are the
   * execution service and status monitor. Never expose the return value over HTTP or to AI.
   */
  grantClient(agentId: string): AgentApi {
    const g = this.db.get<{ id: string; token_enc: string; expires_at: string }>(
      "SELECT id, token_enc, expires_at FROM grants WHERE agent_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1",
      [agentId],
    );
    if (!g) throw conflict("no_active_grant", "the owner has not issued an active grant for this agent");
    if (Date.parse(g.expires_at) < Date.now()) throw conflict("grant_expired", "the agent's grant has expired; the owner must issue a new one");
    return this.api().forGrant(this.secrets.open(g.token_enc, `grant:${agentId}:${g.id}`));
  }

  /** Grants as shown to the owner — commitments and labels only, never tokens. */
  listGrants(user: User, agentId: string) {
    this.assertOwner(user, agentId);
    return this.db.all("SELECT id, grant_id, label, expires_at, status, created_at FROM grants WHERE agent_id = ? ORDER BY created_at DESC", [agentId]);
  }

  ownerIntent(user: User, correlationId: string) {
    const row = this.db.get<Record<string, string>>("SELECT * FROM owner_intents WHERE correlation_id = ? AND user_id = ?", [correlationId, user.id]);
    if (!row) throw notFound("owner intent");
    return { ...row, intent: parse(row.intent_json), preview: parse(row.preview_json), intent_json: undefined, preview_json: undefined, meta_json: undefined };
  }

  /** Live view of an agent for its owner. */
  async overview(user: User, agentId: string) {
    const row = this.assertOwner(user, agentId);
    const api = this.api();
    const [agent, balances, policy, approvals, scheduled] = await Promise.all([
      api.getAgent(agentId).catch(() => null),
      api.getBalances(agentId).catch(() => null),
      api.getPolicy(agentId).catch(() => null),
      api.listApprovals(agentId).catch(() => []),
      api.listScheduledExecutions(agentId).catch(() => null),
    ]);
    const local = this.activePolicy(agentId);
    return {
      agent: row,
      remote: agent,
      balances,
      apiPolicy: policy,
      veyraPolicy: local ? { ...local, summary: describePolicy(local.policy) } : null,
      apiApprovals: approvals,
      scheduled,
      grants: this.listGrants(user, agentId),
    };
  }
}

/** Converts SDK errors into HTTP errors without leaking request headers. */
export function toHttp(e: unknown): Error {
  if (e instanceof HttpError) return e;
  if (e instanceof AgentApiError) {
    return new HttpError(e.status >= 500 ? 502 : e.status === 401 ? 502 : 400, e.code, e.message, { layer: e.layer, retryable: e.retryable, availableAt: e.availableAt });
  }
  return e instanceof Error ? e : new Error(String(e));
}
