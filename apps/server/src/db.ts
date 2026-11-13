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
  -- Veyra's x402 spend account: one NEAR account, a pool of full-access keys so every
  -- in-flight cheque has its own nonce sequence (cheques settle out of order).
  CREATE TABLE spend_keys (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    public_key TEXT NOT NULL UNIQUE,
    secret_enc TEXT NOT NULL,
    status TEXT NOT NULL,
    locked_by TEXT,
    last_nonce TEXT NOT NULL DEFAULT '0',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE kv (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE contracts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    source TEXT NOT NULL,
    external_ref TEXT UNIQUE,
    buyer TEXT NOT NULL,
    title TEXT NOT NULL,
    brief TEXT NOT NULL,
    budget_atomic TEXT NOT NULL,
    revenue_atomic TEXT NOT NULL DEFAULT '0',
    currency TEXT NOT NULL DEFAULT 'USDC',
    margin_bps INTEGER NOT NULL DEFAULT 2000,
    status TEXT NOT NULL,
    step TEXT NOT NULL,
    plan_json TEXT,
    plan_source_json TEXT,
    deliverable_md TEXT,
    error TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_run_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    delivered_at TEXT
  );
  CREATE INDEX contracts_status ON contracts(status, next_run_at);
  CREATE TABLE subtasks (
    id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL REFERENCES contracts(id),
    idx INTEGER NOT NULL,
    title TEXT NOT NULL,
    spec TEXT NOT NULL,
    criteria_json TEXT NOT NULL,
    mode TEXT NOT NULL,
    search_json TEXT NOT NULL,
    cap_atomic TEXT NOT NULL,
    status TEXT NOT NULL,
    agent_handle TEXT,
    agent_id TEXT,
    price_atomic TEXT,
    result_md TEXT,
    verification_json TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    excluded_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(contract_id, idx)
  );
  CREATE TABLE quotes (
    id TEXT PRIMARY KEY,
    subtask_id TEXT NOT NULL REFERENCES subtasks(id),
    rail TEXT NOT NULL,
    agent_handle TEXT NOT NULL,
    agent_id TEXT,
    amount_atomic TEXT,
    plan_atomic TEXT,
    challenge_json TEXT,
    counter_atomic TEXT,
    decision TEXT NOT NULL,
    reason TEXT NOT NULL,
    score REAL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE payments (
    id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL,
    subtask_id TEXT NOT NULL,
    rail TEXT NOT NULL,
    agent_handle TEXT NOT NULL,
    amount_atomic TEXT NOT NULL,
    payee TEXT NOT NULL,
    asset TEXT NOT NULL,
    network TEXT NOT NULL,
    status TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    cheque_hash TEXT,
    key_id TEXT,
    nonce TEXT,
    max_block_height TEXT,
    task_id TEXT,
    guard_json TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX payments_contract ON payments(contract_id);
  CREATE TABLE contract_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contract_id TEXT NOT NULL,
    ts TEXT NOT NULL,
    kind TEXT NOT NULL,
    message TEXT NOT NULL,
    data_json TEXT
  );
  CREATE INDEX contract_events_c ON contract_events(contract_id, id);
  CREATE TABLE receipts (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    contract_id TEXT NOT NULL,
    subtask_id TEXT,
    kind TEXT NOT NULL,
    body_json TEXT NOT NULL,
    hash TEXT NOT NULL,
    signature TEXT NOT NULL,
    anchor_id TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE anchors (
    id TEXT PRIMARY KEY,
    root TEXT NOT NULL,
    from_seq INTEGER NOT NULL,
    to_seq INTEGER NOT NULL,
    count INTEGER NOT NULL,
    network TEXT NOT NULL,
    contract_id TEXT,
    tx_hash TEXT,
    status TEXT NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE counterparties (
    handle TEXT PRIMARY KEY,
    agent_id TEXT,
    hires INTEGER NOT NULL DEFAULT 0,
    passes INTEGER NOT NULL DEFAULT 0,
    failures INTEGER NOT NULL DEFAULT 0,
    attacks INTEGER NOT NULL DEFAULT 0,
    blocked INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    updated_at TEXT NOT NULL
  );
  `,
  `
  CREATE TABLE watch_scans (
    id TEXT PRIMARY KEY,
    origin TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    total INTEGER NOT NULL DEFAULT 0,
    ok INTEGER NOT NULL DEFAULT 0,
    warn INTEGER NOT NULL DEFAULT 0,
    flagged INTEGER NOT NULL DEFAULT 0,
    offline INTEGER NOT NULL DEFAULT 0,
    treasury_json TEXT,
    status TEXT NOT NULL
  );
  CREATE TABLE watch_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scan_id TEXT NOT NULL,
    handle TEXT NOT NULL,
    agent_id TEXT,
    name TEXT,
    category TEXT,
    verdict TEXT NOT NULL,
    quoted_atomic TEXT,
    listed_atomic TEXT,
    pay_to TEXT,
    network TEXT,
    delivered_jobs INTEGER,
    trust INTEGER,
    findings_json TEXT NOT NULL,
    evidence_hash TEXT,
    report_ref TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX watch_results_handle ON watch_results(handle, created_at);
  CREATE INDEX watch_results_scan ON watch_results(scan_id);
  `,
  `
  -- Veyra as an x402 seller: a buyer's cheque is held and relayed only when the job is delivered.
  CREATE TABLE sales (
    id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL,
    buyer_account TEXT NOT NULL,
    buyer_key TEXT NOT NULL,
    amount_atomic TEXT NOT NULL,
    asset TEXT NOT NULL,
    cheque_b64 TEXT NOT NULL,
    cheque_hash TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    settlement_tx TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    settled_at TEXT
  );
  CREATE INDEX sales_contract ON sales(contract_id);
  -- Payouts of retained margin to the owner.
  CREATE TABLE payouts (
    id TEXT PRIMARY KEY,
    to_account TEXT NOT NULL,
    amount_atomic TEXT NOT NULL,
    asset TEXT NOT NULL,
    tx_hash TEXT,
    receipt_id TEXT,
    status TEXT NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL
  );
  ALTER TABLE watch_results ADD COLUMN row_hash TEXT;
  ALTER TABLE watch_scans ADD COLUMN root TEXT;
  ALTER TABLE watch_scans ADD COLUMN receipt_id TEXT;
  `,
  `
  -- Veyra Heist: every duel, practice or ranked, with its spec and the referee's outcome.
  CREATE TABLE heist_runs (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    vault INTEGER NOT NULL,
    callsign TEXT NOT NULL,
    account TEXT,
    spec_json TEXT NOT NULL,
    spec_hash TEXT NOT NULL,
    engine TEXT NOT NULL,
    cracked INTEGER NOT NULL,
    loot_atomic TEXT NOT NULL,
    stopped_by TEXT,
    steps_json TEXT NOT NULL,
    outcome_hash TEXT NOT NULL,
    entry_id TEXT UNIQUE,
    enter_tx TEXT,
    resolve_tx TEXT,
    receipt_id TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX heist_runs_vault ON heist_runs(vault, created_at);
  CREATE INDEX heist_runs_player ON heist_runs(callsign, account);
  `,
  `
  -- Veyra Heist loot: the NEP-245 mint that gave a ranked winner the vault's gold bar.
  ALTER TABLE heist_runs ADD COLUMN loot_tx TEXT;
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
