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
  ranked: { enabled: boolean; contractId: string | null; network: "testnet" | "mainnet"; explorer: string | null; lootContractId?: string | null };
}
export interface Step { round: number; actor: "veyra" | "you" | "shield" | "chain"; code: string; title: string; detail: string; tone: "neutral" | "attack" | "blocked" | "hit" | "veyra"; shield?: ShieldId }
export interface Run {
  id: string; kind: "practice" | "ranked"; vault: number; callsign: string; account: string | null; spec: Spec; specHash: string; engine: string;
  cracked: boolean; lootAtomic: string; stoppedBy: ShieldId | null; steps: Step[]; outcomeHash: string; entryId: string | null;
  enterTx: string | null; resolveTx: string | null; receiptId: string | null; createdAt: string; lootTx?: string | null; links: { enter: string | null; resolve: string | null; loot?: string | null };
}

export const ALL_SHIELDS: { id: ShieldId; short: string }[] = [
  { id: "caps", short: "Caps" }, { id: "cheque", short: "Cheque" }, { id: "payee", short: "Payee" }, { id: "price", short: "Price" },
  { id: "scanner", short: "Scan" }, { id: "taint", short: "Taint" }, { id: "no_transfers", short: "Lock" }, { id: "trust", short: "Trust" },
];

export const practice = (vault: number, spec: Spec) => post<Run>(`/heist/vaults/${vault}/practice`, { spec: clean(spec) });
export const replay = (id: string) => api<{ matches: boolean; stored: string; replayed: string }>(`/heist/runs/${id}/replay`);

export interface PlayerAgent { name: string; runs: number; cracks: number; bestVault: number; lootAtomic: string; lastRunId: string; lastAt: string }
export interface Player { player: string; runs: number; cracks: number; rankedRuns: number; cracked: number[]; tried: number[]; lootAtomic: string; agents: PlayerAgent[]; recent: Run[] }
export interface Account { accountId: string; exists: boolean; gasPriceYocto: string; balanceYocto: string; lockedYocto: string; storageBytes: number; stakes: { vault: number; amountYocto: string; earnedYocto: string }[] }
export interface TxInfo { hash: string; found: boolean; success: boolean | null; entryId: string | null; entry: { status: string; entered_at_ns: string; fee: string; vault: number } | null; runId: string | null; link: string }
export interface Series { days: { day: string; runs: number; cracks: number; held: number; ranked: number; lootAtomic: string }[]; vaults: { vault: number; name: string; runs: number; cracks: number }[]; stoppers: { shield: ShieldId; name: string; held: number }[] }

export const YOCTO = 10n ** 24n;
/** yoctoNEAR to a NEAR string. Exact BigInt division, then rounded for display. */
export const nearNum = (yocto: string | bigint | null | undefined) => (yocto ? Number(BigInt(yocto) / 10n ** 18n) / 1e6 : 0);
export function toYoctoNear(n: string) {
  const [w0, f = ""] = n.trim().split(".");
  return BigInt(w0 || "0") * YOCTO + BigInt((f + "0".repeat(24)).slice(0, 24) || "0");
}
export const explorerTx = (network: string, hash: string) => `${network === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io"}/txns/${hash}`;
export const explorerAccount = (network: string, id: string) => `${network === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io"}/address/${id}`;

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
export const GAS = "30000000000000";
export const GAS_TGAS = 30;
let walletReady: Promise<typeof import("../wallet")> | null = null;
export function heistWallet(network: "testnet" | "mainnet") {
  return (walletReady ??= import("../wallet").then(async (w) => { await w.initWallet(network); return w; }));
}

export interface Pending { txHash?: string; accountId: string; spec: Spec; vault: number; at: number }
export function loadPending(): Pending | null {
  try { const p = JSON.parse(localStorage.getItem(PENDING) ?? "null"); return p?.spec && p.accountId ? p : null; } catch { return null; }
}
export function savePending(p: Pending | null) {
  try { if (p) localStorage.setItem(PENDING, JSON.stringify(p)); else localStorage.removeItem(PENDING); } catch { /* storage blocked */ }
  window.dispatchEvent(new Event("veyra:pending"));
}

/** Step 1 of a ranked entry: sign `enter(vault, spec_hash)` with the fee. Returns the tx hash. */
export async function signEntry(network: "testnet" | "mainnet", contractId: string, vault: Vault, spec: Spec, accountId: string) {
  const w = await heistWallet(network);
  const hash = await specHash(spec);
  savePending({ vault: vault.id, spec: clean(spec), accountId, at: Date.now() });
  const [txHash] = await w.signAndSend([{ receiverId: contractId, actions: [{ type: "FunctionCall", params: { methodName: "enter", args: { vault: vault.id, spec_hash: hash }, gas: GAS, deposit: vault.feeYocto } }] }]);
  if (!txHash) throw new Error("The wallet returned no transaction. Nothing was charged.");
  savePending({ vault: vault.id, spec: clean(spec), accountId, txHash, at: Date.now() });
  return txHash;
}

/** Step 2: wait until NEAR reports the transaction as executed. */
export async function waitForTx(hash: string, sender: string, tries = 15): Promise<TxInfo> {
  for (let i = 0; i < tries; i++) {
    const t = await api<TxInfo>(`/heist/tx/${hash}?sender=${encodeURIComponent(sender)}`).catch(() => null);
    if (t?.found && t.success === false) throw new Error("The transaction failed on NEAR. Your wallet shows the reason.");
    if (t?.found && t.success) return t;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("tx_not_found: NEAR has not confirmed the transaction yet.");
}

/** Step 3: the referee verifies the entry, runs the duel and settles it on-chain. */
export async function submitRanked(txHash: string, accountId: string, spec: Spec) {
  const run = await post<Run>("/heist/ranked", { txHash, accountId, spec: clean(spec) });
  savePending(null);
  return run;
}

/** After a redirect wallet: ?transactionHashes=… plus the stashed entry. */
export function pendingFromRedirect(): Pending | null {
  const q = new URLSearchParams(window.location.search);
  const txHash = q.get("transactionHashes")?.split(",")[0];
  if (!txHash) return null;
  const p = loadPending();
  return p ? { ...p, txHash } : null;
}

export const preview = (vault: number, spec: Spec) => post<{ cracked: boolean; lootAtomic: string; stoppedBy: ShieldId | null; outcomeHash: string }>(`/heist/vaults/${vault}/preview`, { spec: clean(spec) });

export async function reclaim(network: "testnet" | "mainnet", contractId: string, entryId: string) {
  const w = await heistWallet(network);
  const [h] = await w.signAndSend([{ receiverId: contractId, actions: [{ type: "FunctionCall", params: { methodName: "reclaim", args: { entry_id: entryId }, gas: GAS, deposit: "0" } }] }]);
  if (!h) throw new Error("The wallet returned no transaction.");
  return h;
}

export async function underwrite(network: "testnet" | "mainnet", contractId: string, vault: number, nearAmount: string) {
  const w = await heistWallet(network);
  const [w0, f = ""] = nearAmount.split(".");
  const yocto = (BigInt(w0 || "0") * 10n ** 24n + BigInt((f + "0".repeat(24)).slice(0, 24))).toString();
  const [h] = await w.signAndSend([{ receiverId: contractId, actions: [{ type: "FunctionCall", params: { methodName: "underwrite", args: { vault }, gas: GAS, deposit: yocto } }] }]);
  if (!h) throw new Error("The wallet returned no transaction.");
  return h;
}

export async function withdrawStake(network: "testnet" | "mainnet", contractId: string, vault: number) {
  const w = await heistWallet(network);
  const [h] = await w.signAndSend([{ receiverId: contractId, actions: [{ type: "FunctionCall", params: { methodName: "withdraw", args: { vault }, gas: GAS, deposit: "0" } }] }]);
  if (!h) throw new Error("The wallet returned no transaction.");
  return h;
}

// ---------------------------------------------------------------- loot (NEP-245)

export interface LootItem { token_id: string; metadata: { title: string; description: string; media: string | null }; supply: string }
export interface LootCatalog { contractId: string | null; standard?: string; explorer?: string; items: LootItem[] }

/** Sends items with NEP-245 mt_transfer. The standard requires exactly 1 yoctoNEAR attached. */
export async function sendItem(network: "testnet" | "mainnet", contractId: string, receiverId: string, tokenId: string, amount: number) {
  const w = await heistWallet(network);
  const [h] = await w.signAndSend([{ receiverId: contractId, actions: [{ type: "FunctionCall", params: { methodName: "mt_transfer", args: { receiver_id: receiverId, token_id: tokenId, amount: String(amount), approval: null, memo: "sent from Veyra Heist" }, gas: GAS, deposit: "1" } }] }]);
  if (!h) throw new Error("The wallet returned no transaction.");
  return h;
}
