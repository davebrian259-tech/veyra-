import { api, post } from "../api";

/** Types and calls for Veyra Heist, plus the player's local progress and the ranked wallet flow. */
export type ShieldId = "caps" | "cheque" | "payee" | "price" | "scanner" | "taint" | "no_transfers" | "trust";
export type Tone = "mint" | "sky" | "violet" | "amber" | "crimson";
export interface Shield { id: ShieldId; name: string; rules: string[]; what: string }
export interface Vault {
  id: number; name: string; tagline: string; hint: string; shields: Shield[]; feeNear: string; feeYocto: string; tone: Tone;
  practice: { attempts: number; cracks: number; firstCrack: { callsign: string; account: string | null; created_at: string } | null };
  chain: { potYocto: string; stakedYocto: string; attempts: number; cracks: number; lastCrackedBy: string | null; epoch: number } | null;
}
export interface Spec { callsign: string; agentName: string; quoteUsd: number; payTo: "treasury" | "me"; deliverable: string }
export interface Template { id: string; name: string; move: string; spec: Omit<Spec, "callsign"> }
export interface Lobby {
  vaults: Vault[]; templates: Template[]; stats: { runs: number; cracks: number; players: number };
  ranked: { enabled: boolean; contractId: string | null; network: "testnet" | "mainnet"; explorer: string | null };
}
export interface Step { round: number; actor: "veyra" | "you" | "shield" | "chain"; code: string; title: string; detail: string; tone: "neutral" | "attack" | "blocked" | "hit" | "veyra"; shield?: ShieldId }
export interface Run {
  id: string; kind: "practice" | "ranked"; vault: number; callsign: string; account: string | null; spec: Spec; specHash: string; engine: string;
  cracked: boolean; lootAtomic: string; stoppedBy: ShieldId | null; steps: Step[]; outcomeHash: string; entryId: string | null;
  enterTx: string | null; resolveTx: string | null; receiptId: string | null; createdAt: string; links: { enter: string | null; resolve: string | null };
}

export const ALL_SHIELDS: { id: ShieldId; short: string }[] = [
  { id: "caps", short: "Caps" }, { id: "cheque", short: "Cheque" }, { id: "payee", short: "Payee" }, { id: "price", short: "Price" },
  { id: "scanner", short: "Scan" }, { id: "taint", short: "Taint" }, { id: "no_transfers", short: "Lock" }, { id: "trust", short: "Trust" },
];

export const practice = (vault: number, spec: Spec) => post<Run>(`/heist/vaults/${vault}/practice`, { spec: clean(spec) });
export const replay = (id: string) => api<{ matches: boolean; stored: string; replayed: string }>(`/heist/runs/${id}/replay`);

export const near = (yocto: string | null | undefined, digits = 2) => (yocto ? (Number(BigInt(yocto) / 10n ** 18n) / 1e6).toFixed(digits) : "0.00");
export const usdc = (atomic: string | number) => (Number(atomic) / 1e6).toFixed(2);

/** The exact spec the server validates and hashes: trimmed strings, numbers as given. */
export function clean(s: Spec): Spec {
  return { callsign: s.callsign.trim(), agentName: s.agentName.trim(), quoteUsd: Number(s.quoteUsd), payTo: s.payTo, deliverable: s.deliverable };
}

/** Same canonical JSON as the server: sorted keys, standard JSON values. */
function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  return `{${Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`).join(",")}}`;
}
export async function specHash(spec: Spec) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(clean(spec))));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------- local progress

export interface Progress { callsign: string; cracked: number[]; lastSpec?: Partial<Spec> }
const KEY = "veyra.heist.progress";
export function loadProgress(): Progress {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (p && typeof p.callsign === "string" && Array.isArray(p.cracked)) return p;
  } catch { /* storage blocked */ }
  return { callsign: `ghost-${Math.random().toString(36).slice(2, 6)}`, cracked: [] };
}
export function saveProgress(p: Progress) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage blocked */ }
}
export function recordRun(p: Progress, run: Run): Progress {
  const next = { ...p, cracked: run.cracked && !p.cracked.includes(run.vault) ? [...p.cracked, run.vault].sort() : p.cracked };
  saveProgress(next);
  return next;
}
/** Moves unlock as you climb: each template needs the vault below its target cracked first. */
export const MOVE_UNLOCK: Record<string, number> = { honest: 0, redirect: 0, bait: 1, whisper: 2, disguise: 3 };

// ---------------------------------------------------------------- ranked: the player's NEAR wallet

const PENDING = "veyra.heist.pending";
let walletReady: Promise<typeof import("../wallet")> | null = null;
export function heistWallet(network: "testnet" | "mainnet") {
  return (walletReady ??= import("../wallet").then(async (w) => { await w.initWallet(network); return w; }));
}

/** Pays the vault's fee and commits to the spec. Redirect wallets come back with the hash in the URL. */
export async function enterRanked(network: "testnet" | "mainnet", contractId: string, vault: Vault, spec: Spec) {
  const w = await heistWallet(network);
  const accountId = w.connectedAccount();
  if (!accountId) { w.showWalletModal(); throw new Error("Connect a NEAR wallet first, then press the button again."); }
  const hash = await specHash(spec);
  try { localStorage.setItem(PENDING, JSON.stringify({ vault: vault.id, spec: clean(spec), accountId })); } catch { /* storage blocked */ }
  const [txHash] = await w.signAndSend([{ receiverId: contractId, actions: [{ type: "FunctionCall", params: { methodName: "enter", args: { vault: vault.id, spec_hash: hash }, gas: "30000000000000", deposit: vault.feeYocto } }] }]);
  if (!txHash) throw new Error("The wallet returned no transaction. Nothing was charged.");
  return submitRanked(txHash, accountId, spec);
}

export async function submitRanked(txHash: string, accountId: string, spec: Spec) {
  const run = await post<Run>("/heist/ranked", { txHash, accountId, spec: clean(spec) });
  try { localStorage.removeItem(PENDING); } catch { /* storage blocked */ }
  return run;
}

/** After a redirect wallet: ?transactionHashes=… plus the stashed entry. */
export function pendingFromRedirect(): { txHash: string; accountId: string; spec: Spec; vault: number } | null {
  const q = new URLSearchParams(window.location.search);
  const txHash = q.get("transactionHashes")?.split(",")[0];
  if (!txHash) return null;
  try {
    const p = JSON.parse(localStorage.getItem(PENDING) ?? "null");
    if (p?.spec && p.accountId) return { txHash, accountId: p.accountId, spec: p.spec, vault: p.vault };
  } catch { /* storage blocked */ }
  return null;
}

export async function underwrite(network: "testnet" | "mainnet", contractId: string, vault: number, nearAmount: string) {
  const w = await heistWallet(network);
  if (!w.connectedAccount()) { w.showWalletModal(); throw new Error("Connect a NEAR wallet first."); }
  const [w0, f = ""] = nearAmount.split(".");
  const yocto = (BigInt(w0 || "0") * 10n ** 24n + BigInt((f + "0".repeat(24)).slice(0, 24))).toString();
  return w.signAndSend([{ receiverId: contractId, actions: [{ type: "FunctionCall", params: { methodName: "underwrite", args: { vault }, gas: "30000000000000", deposit: yocto } }] }]);
}

export async function withdrawStake(network: "testnet" | "mainnet", contractId: string, vault: number) {
  const w = await heistWallet(network);
  if (!w.connectedAccount()) { w.showWalletModal(); throw new Error("Connect a NEAR wallet first."); }
  return w.signAndSend([{ receiverId: contractId, actions: [{ type: "FunctionCall", params: { methodName: "withdraw", args: { vault }, gas: "30000000000000", deposit: "0" } }] }]);
}
