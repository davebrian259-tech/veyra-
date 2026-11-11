import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

/**
 * SQLite through Node's built-in driver. Secrets (grant tokens) are stored only as AES-GCM
 * ciphertext; private keys and API keys are never stored at all.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );
  CREATE TABLE auth_challenges (
    nonce TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    purpose TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE sessions (
    id_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    public_key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE agents (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    owner_account_id TEXT NOT NULL,
    owner_public_key TEXT NOT NULL,
    near_account_id TEXT,
    evm_account_id TEXT,
    solana_account_id TEXT,
    status TEXT NOT NULL,
    local_frozen INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE owner_intents (
    correlation_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    agent_id TEXT,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    intent_json TEXT NOT NULL,
    preview_json TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    failure_code TEXT,
    meta_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE veyra_policies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    policy_json TEXT NOT NULL,
    policy_hash TEXT NOT NULL,
    api_policy_json TEXT NOT NULL,
    status TEXT NOT NULL,
    correlation_id TEXT,
    owner_signature_json TEXT,
    created_at TEXT NOT NULL,
    activated_at TEXT
  );
  CREATE TABLE grants (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    grant_id TEXT,
    label TEXT NOT NULL,
    token_enc TEXT NOT NULL,
    commitment TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    status TEXT NOT NULL,
    correlation_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE operations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    agent_id TEXT,
    kind TEXT NOT NULL,
    origin TEXT NOT NULL,
    request_json TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    correlation_id TEXT,
    status TEXT NOT NULL,
    provider_status TEXT,
    usd_value REAL,
    asset TEXT,
    amount TEXT,
    destination TEXT,
    tx_hash TEXT,
    settlement_json TEXT,
    bodyguard_json TEXT,
    approval_id TEXT,
    goal_id TEXT,
    job_id TEXT,
    reason TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    submitted_at TEXT,
    confirmed_at TEXT,
    settled_at TEXT
  );
  CREATE INDEX operations_user ON operations(user_id, created_at);
  CREATE INDEX operations_status ON operations(status);
  CREATE TABLE approvals (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    status TEXT NOT NULL,
    reason TEXT NOT NULL,
    signature_json TEXT,
    created_at TEXT NOT NULL,
    decided_at TEXT,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE bodyguard_lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    value TEXT NOT NULL,
    label TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(user_id, kind, value)
  );
  CREATE TABLE global_blocklist (
    value TEXT PRIMARY KEY,
    reason TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE audit_log (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    user_id TEXT,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    subject TEXT,
    data_json TEXT NOT NULL,
    prev_hash TEXT NOT NULL,
    hash TEXT NOT NULL
  );
  CREATE TABLE notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    data_json TEXT,
    read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE goals (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    agent_id TEXT,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    prompt TEXT,
    params_json TEXT NOT NULL,
    plan_json TEXT,
    status TEXT NOT NULL,
    auto_execute INTEGER NOT NULL DEFAULT 0,
    progress_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE ai_runs (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    task TEXT NOT NULL,
    privacy TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT,
    request_hash TEXT,
    response_hash TEXT,
    attestation_json TEXT,
    signature_json TEXT,
    verified INTEGER NOT NULL DEFAULT 0,
    latency_ms INTEGER,
    error TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE providers (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    account_id TEXT NOT NULL,
    description TEXT NOT NULL,
    skills_json TEXT NOT NULL,
    base_price_usd REAL NOT NULL,
    min_price_usd REAL,
    rating REAL NOT NULL DEFAULT 0,
    rating_count INTEGER NOT NULL DEFAULT 0,
    completed_jobs INTEGER NOT NULL DEFAULT 0,
    disputes INTEGER NOT NULL DEFAULT 0,
    availability TEXT NOT NULL DEFAULT 'available',
    offer_endpoint TEXT,
    demo INTEGER NOT NULL DEFAULT 0,
    owner_user_id TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    goal_id TEXT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    skills_json TEXT NOT NULL,
    budget_max_usd REAL NOT NULL,
    deadline TEXT NOT NULL,
    completion_conditions_json TEXT NOT NULL,
    status TEXT NOT NULL,
    selected_offer_id TEXT,
    escrow_ref TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE offers (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    price_usd REAL NOT NULL,
    eta_days INTEGER NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL,
    round INTEGER NOT NULL DEFAULT 1,
    history_json TEXT NOT NULL,
    simulated INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE escrows (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    job_id TEXT,
    network TEXT NOT NULL,
    contract_id TEXT NOT NULL,
    onchain_id TEXT,
    payer TEXT NOT NULL,
    approver TEXT NOT NULL,
    provider_account TEXT NOT NULL,
    asset_json TEXT NOT NULL,
    total TEXT NOT NULL,
    terms_json TEXT NOT NULL,
    terms_hash TEXT NOT NULL,
    funding_mode TEXT NOT NULL,
    status TEXT NOT NULL,
    onchain_json TEXT,
    operation_id TEXT,
    create_tx_hash TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE chain_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    network TEXT NOT NULL,
    contract_id TEXT NOT NULL,
    tx_hash TEXT NOT NULL,
    idx INTEGER NOT NULL,
    standard TEXT NOT NULL,
    event TEXT NOT NULL,
    data_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(tx_hash, idx)
  );
  CREATE TABLE evidence (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    path TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE chain_sig_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    chain TEXT NOT NULL,
    path TEXT NOT NULL,
    derived_address TEXT NOT NULL,
    request_json TEXT NOT NULL,
    unsigned_tx_json TEXT NOT NULL,
    payloads_json TEXT NOT NULL,
    near_tx_hash TEXT,
    signed_tx TEXT,
    broadcast_hash TEXT,
    status TEXT NOT NULL,
    operation_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  `,
];

export type Row = Record<string, unknown>;
type Params = Record<string, SQLInputValue> | SQLInputValue[];

export class Db {
  readonly raw: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.raw = new DatabaseSync(path);
    this.raw.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  private migrate() {
    this.raw.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
    const row = this.raw.prepare("SELECT version FROM schema_version").get() as
      | { version: number }
      | undefined;
    let version = row?.version ?? 0;
    if (!row) this.raw.prepare("INSERT INTO schema_version (version) VALUES (0)").run();
    while (version < MIGRATIONS.length) {
      this.raw.exec("BEGIN");
      try {
        this.raw.exec(MIGRATIONS[version]);
        version += 1;
        this.raw.prepare("UPDATE schema_version SET version = ?").run(version);
        this.raw.exec("COMMIT");
      } catch (e) {
        this.raw.exec("ROLLBACK");
        throw e;
      }
    }
  }

  run(sql: string, params: Params = {}) {
    const st = this.raw.prepare(sql);
    return Array.isArray(params) ? st.run(...params) : st.run(params);
  }

  get<T = Row>(sql: string, params: Params = {}): T | undefined {
    const st = this.raw.prepare(sql);
    return (Array.isArray(params) ? st.get(...params) : st.get(params)) as T | undefined;
  }

  all<T = Row>(sql: string, params: Params = {}): T[] {
    const st = this.raw.prepare(sql);
    return (Array.isArray(params) ? st.all(...params) : st.all(params)) as T[];
  }

  tx<T>(fn: () => T): T {
    this.raw.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.raw.exec("COMMIT");
      return out;
    } catch (e) {
      this.raw.exec("ROLLBACK");
      throw e;
    }
  }

  close() {
    this.raw.close();
  }
}

export const now = () => new Date().toISOString();
export const json = (v: unknown) => JSON.stringify(v ?? null);
export function parse<T = unknown>(v: unknown): T {
  return (typeof v === "string" ? JSON.parse(v) : v) as T;
}
