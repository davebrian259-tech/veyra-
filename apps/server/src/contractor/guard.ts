import type { Db } from "../db.js";
import { decide, type Finding, type Verdict } from "../services/bodyguard/engine.js";
import { chequeMatches, decodeCheque } from "../market/cheque.js";
import type { MarketAgent, TreasuryRecipient, X402Requirement } from "../market/types.js";

/**
 * GUARD — the contractor's deterministic security layer. No model output can relax it.
 *
 * Its threat model is the *economy*, not just the prompt: every counterparty Veyra hires can
 * lie in its quote, swap the payee, inflate the price after listing, deliver poisoned output,
 * or vanish with the cheque. Checks here are pure functions of signed data, published market
 * data and Veyra's own records.
 */

export interface PaymentCheckInput {
  contractId: string;
  subtaskId: string;
  handle: string;
  row: X402Requirement;
  /** Published by the market origin (never taken from an agent or a 402 body). */
  treasury: TreasuryRecipient[];
  /** The agent's default pricing plan price, atomic. Null when the agent has none. */
  planAtomic: string | null;
  subtaskCapAtomic: bigint;
  envelopeRemainingAtomic: bigint;
  agent: MarketAgent | null;
  frozen: boolean;
}

export interface CounterpartyRecord {
  handle: string;
  hires: number;
  passes: number;
  failures: number;
  attacks: number;
  blocked: number;
}

export class ContractorGuard {
  constructor(private readonly db: Db) {}

  counterparty(handle: string): CounterpartyRecord {
    return this.db.get<CounterpartyRecord>("SELECT * FROM counterparties WHERE handle = ?", [handle]) ?? { handle, hires: 0, passes: 0, failures: 0, attacks: 0, blocked: 0 };
  }

  record(handle: string, field: "hires" | "passes" | "failures" | "attacks", note?: string) {
    this.db.run(
      `INSERT INTO counterparties (handle, ${field}, note, updated_at) VALUES (?, 1, ?, ?)
       ON CONFLICT(handle) DO UPDATE SET ${field} = ${field} + 1, note = COALESCE(?, note), updated_at = ?`,
      [handle, note ?? null, new Date().toISOString(), note ?? null, new Date().toISOString()],
    );
    // Any proven attack blocks the counterparty for good.
    if (field === "attacks") this.db.run("UPDATE counterparties SET blocked = 1 WHERE handle = ?", [handle]);
  }

  /** 0–100 trust score from market reputation and Veyra's own history with this agent. */
  score(agent: MarketAgent | null, handle: string): { score: number; reasons: string[] } {
    const local = this.counterparty(handle);
    const reasons: string[] = [];
    let s = 50;
    if (agent) {
      const n = agent.delivered_jobs ?? 0;
      // The live market reports success_rate as a percentage; with no deliveries it means "no data", not 0%.
      let sr: number | null = agent.success_rate ?? null;
      if (sr !== null && sr > 1) sr /= 100;
      if (n === 0) sr = null;
      s = 30 + (sr ?? 0.6) * 40 + Math.min(20, Math.log10(1 + n) * 8);
      if (n === 0) { s -= 15; reasons.push("no delivery history yet"); }
      else if (n < 10) { s -= 15; reasons.push(`only ${n} delivered jobs`); }
      if (sr !== null && sr < 0.8) { s -= (0.8 - sr) * 50; reasons.push(`success rate ${(sr * 100).toFixed(0)}%`); }
      const ageDays = agent.created_at ? (Date.now() - Date.parse(agent.created_at)) / 86_400_000 : null;
      if (ageDays !== null && ageDays < 14) { s -= 10; reasons.push(`listed ${Math.floor(ageDays)} days ago`); }
      const v = agent.builder?.verification as unknown;
      if (v && (typeof v === "string" ? v !== "none" : (v as { level?: string }).level !== "none")) s += 5;
    }
    s += Math.min(15, local.passes * 3) - local.failures * 10;
    if (local.attacks) { s = 0; reasons.push("caught attacking Veyra before"); }
    return { score: Math.max(0, Math.min(100, Math.round(s))), reasons };
  }

  /** Checks an x402 challenge before anything is signed. */
  checkChallenge(i: PaymentCheckInput): Verdict {
    const f: Finding[] = [];
    if (i.frozen) f.push({ rule: "contractor_frozen", severity: "block", message: "Veyra is frozen by its owner." });

    // Payee pinning: the challenge must pay the market's own published treasury.
    const pinned = i.treasury.find((t) => t.network === i.row.network && t.asset === i.row.asset && t.payTo === i.row.payTo);
    if (!pinned) {
      const sameNet = i.treasury.find((t) => t.network === i.row.network);
      const why = !sameNet ? `network ${i.row.network} is not one the market settles on`
        : sameNet.asset !== i.row.asset ? `asset ${i.row.asset} is not the market's ${sameNet.asset}`
        : `payee ${i.row.payTo} is not the market treasury ${sameNet.payTo}`;
      f.push({ rule: "payee_not_pinned", severity: "block", message: `Payment redirect attempt: ${why}.`, data: { row: i.row } });
    }
    if (i.row.scheme !== "exact") f.push({ rule: "unsupported_scheme", severity: "block", message: `x402 scheme ${i.row.scheme} is not supported.` });

    // Price integrity: the 402 must ask exactly the published plan price.
    if (i.planAtomic === null) f.push({ rule: "no_published_price", severity: "block", message: "The agent has no published pricing plan to check the quote against." });
    else if (BigInt(i.row.amount) !== BigInt(i.planAtomic)) {
      f.push({ rule: "price_mismatch", severity: "block", message: `Quote of ${fmt(i.row.amount)} USDC differs from the listed ${fmt(i.planAtomic)} USDC (bait-and-switch).`, data: { quoted: i.row.amount, listed: i.planAtomic } });
    }

    // Budget envelope: subtask cap, then the whole contract.
    const amt = BigInt(i.row.amount);
    if (amt > i.subtaskCapAtomic) f.push({ rule: "over_subtask_cap", severity: "block", message: `${fmt(i.row.amount)} USDC exceeds this subtask's cap of ${fmt(i.subtaskCapAtomic)}.` });
    if (amt > i.envelopeRemainingAtomic) f.push({ rule: "envelope_exhausted", severity: "block", message: `Only ${fmt(i.envelopeRemainingAtomic)} USDC of the contract budget is left.` });
    if (i.row.maxTimeoutSeconds > 7 * 86_400) f.push({ rule: "excessive_validity", severity: "block", message: "The cheque would stay valid for more than 7 days." });

    // Counterparty.
    const local = this.counterparty(i.handle);
    if (local.blocked) f.push({ rule: "counterparty_blocked", severity: "block", message: `${i.handle} is blocked after a previous attack.` });
    const { score, reasons } = this.score(i.agent, i.handle);
    if (score < 25) f.push({ rule: "low_trust_counterparty", severity: "block", message: `${i.handle} trust score ${score}/100 (${reasons.join("; ")}).` });
    else if (score < 45) f.push({ rule: "unproven_counterparty", severity: "warn", message: `${i.handle} trust score ${score}/100 (${reasons.join("; ")}).` });

    // No double payment: one cheque in flight per subtask. (A retry after a failed delivery is
    // a new purchase; the earlier settled payment is recorded and counted against the envelope.)
    const inFlight = this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM payments WHERE subtask_id = ? AND status IN ('reserved','signed','sent')", [i.subtaskId])?.n ?? 0;
    if (inFlight) f.push({ rule: "duplicate_payment", severity: "block", message: "This subtask already has a payment in flight." });
    return decide(f);
  }

  /** Last check before the header leaves: the signed bytes must pay exactly the approved row. */
  verifyOwnCheque(signedDelegateBase64: string, row: X402Requirement): Finding[] {
    const { ok, problems } = chequeMatches(decodeCheque(signedDelegateBase64), row);
    return ok ? [] : [{ rule: "cheque_mismatch", severity: "block", message: `Signed cheque does not match the approved payment: ${problems.join("; ")}` }];
  }
}

const fmt = (a: string | bigint) => (Number(BigInt(a)) / 1e6).toFixed(2);

// ---------------------------------------------------------------- untrusted content

const INSTRUCTION_PATTERNS: [RegExp, string][] = [
  [/ignore (all |any )?(previous|prior|above|earlier) (instructions|rules|budgets?)/i, "instruction override"],
  [/\b(system|developer|assistant)[ -]?(notice|prompt|message|instructions?)\b/i, "fake system message"],
  [/\b(transfer|send|pay|wire|tip)\b[^.\n]{0,40}\b\d+(\.\d+)?\s*(usdc|near|usd|\$)/i, "payment request"],
  [/\bmark (this|the) (task|work|deliverable) as (verified|accepted|complete)/i, "verification override"],
  [/\b(approve|accept|release) (the )?(payment|escrow|funds)\b/i, "payment approval request"],
  [/<!--[\s\S]*?(instruction|assistant|system|agent)[\s\S]*?-->/i, "hidden HTML instructions"],
  [/[​-‏⁠-⁤﻿]/, "invisible characters"],
  [/\byou are now\b|\bnew instructions\b|\bdeveloper mode\b/i, "role hijack"],
];

const ACCOUNT_RE = /\b(?:[a-z0-9_-]+\.)+(?:near|testnet|sim|tg)\b|\b[0-9a-f]{64}\b|\b0x[0-9a-fA-F]{40}\b/g;

export interface ScanResult {
  injected: boolean;
  findings: Finding[];
  accountsMentioned: string[];
  /** Safe-to-forward text: comments and invisible characters stripped, fenced as data. */
  sanitized: string;
}

/** Treats a counterparty's deliverable as hostile input. */
export function scanUntrusted(text: string): ScanResult {
  const findings: Finding[] = [];
  for (const [re, label] of INSTRUCTION_PATTERNS) {
    const m = text.match(re);
    if (m) findings.push({ rule: "prompt_injection", severity: "block", message: `Deliverable contains ${label}: "${m[0].slice(0, 80)}"` });
  }
  const accountsMentioned = [...new Set(text.match(ACCOUNT_RE) ?? [])];
  const sanitized = text.replace(/<!--[\s\S]*?-->/g, "").replace(/[​-‏⁠-⁤﻿]/g, "");
  return { injected: findings.length > 0, findings, accountsMentioned, sanitized };
}

/**
 * Taint tracking: a payment parameter (recipient or amount) that appears in untrusted text and
 * not in a trusted source cannot be used, whatever a model says about it.
 */
export function taintCheck(params: { recipient?: string; amountUsd?: number }, trusted: string[], untrusted: string[]): Finding[] {
  const f: Finding[] = [];
  const inText = (needle: string, hay: string[]) => hay.some((h) => h.toLowerCase().includes(needle.toLowerCase()));
  if (params.recipient && inText(params.recipient, untrusted) && !inText(params.recipient, trusted)) {
    f.push({ rule: "tainted_recipient", severity: "block", message: `Recipient ${params.recipient} came from a counterparty's output, not from the owner or the market.` });
  }
  if (params.amountUsd !== undefined) {
    const s = String(params.amountUsd);
    if (inText(s, untrusted) && !inText(s, trusted)) f.push({ rule: "tainted_amount", severity: "block", message: `Amount ${s} came from a counterparty's output.` });
  }
  return f;
}
