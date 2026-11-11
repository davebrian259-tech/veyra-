import { post, type OwnerIntent, type WalletTx } from "./api";
import { connectedAccount, signAndSend, signMessage, signOwnerIntent } from "./wallet";

/**
 * Owner action: show what will be authorised, sign it in the wallet, submit the signature
 * unchanged. The backend never sees a key.
 */
export async function signAndSubmitOwnerIntent(out: OwnerIntent) {
  const lines = [out.preview.summary, ...(out.policySummary ?? []), "", out.riskNotice].join("\n");
  if (!window.confirm(`Authorise ${out.type}?\n\n${lines}`)) throw new Error("cancelled by owner");
  const signedData = await signOwnerIntent(out.intent);
  return post(`/owner-intents/${out.correlationId}/submit`, { signedData });
}

/** Veyra approval of an escalated agent action, signed with NEP-413. */
export async function decideApproval(approvalId: string, verdict: "approve" | "reject") {
  const ch = await post<{ message: string; recipient: string; nonce: string }>(`/approvals/${approvalId}/challenge`, { verdict });
  const signed = await signMessage(ch.message, ch.recipient, ch.nonce);
  return post(`/approvals/${approvalId}/decide`, { verdict, signed });
}

/** Wallet-signed contract call(s), then report the hash so Veyra tracks finality. */
export async function sendAndRecord(txs: WalletTx[], record: (hash: string) => Promise<unknown>) {
  const hashes = await signAndSend(txs);
  const out = [];
  for (const h of hashes) out.push(await record(h));
  return { hashes, recorded: out };
}

export async function login() {
  const accountId = connectedAccount();
  if (!accountId) throw new Error("connect a wallet first");
  const ch = await post<{ message: string; recipient: string; nonce: string }>("/auth/challenge", { accountId });
  const signed = await signMessage(ch.message, ch.recipient, ch.nonce);
  return post("/auth/login", signed);
}

export async function sha256Hex(data: ArrayBuffer | string) {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export async function uploadEvidence(file: File) {
  return post<{ evidenceHash: string; uri: string }>("/evidence", { filename: file.name, mime: file.type || "application/octet-stream", dataBase64: await fileToBase64(file) });
}
