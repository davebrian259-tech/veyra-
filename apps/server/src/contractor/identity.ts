import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type { AppContext } from "../context.js";
import { now, parse } from "../db.js";
import { canonicalJson } from "../lib/crypto.js";

/**
 * Know-Your-Agent: a signed, verifiable statement of who Veyra acts for, what it may do and
 * how to check its work — the "identity for non-humans" gap a16z describes. The credential is
 * signed by Veyra's receipt key; the owner can countersign its hash with their NEAR wallet
 * (NEP-413), binding the agent to a human principal.
 */
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

export function kyaMessage(hash: string) {
  return `Veyra KYA\nI am the principal of this agent.\nCredential: ${hash}`;
}

export function buildCredential(ctx: AppContext, publicUrl: string) {
  const owner = ctx.ownerUser();
  const vault = ctx.vault.describe();
  const policy = ctx.config.VAULT_AGENT_ID ? ctx.agents.activePolicy(ctx.config.VAULT_AGENT_ID) : null;
  const scan = ctx.db.get<{ id: string; total: number; flagged: number; finished_at: string }>("SELECT id, total, flagged, finished_at FROM watch_scans WHERE status = 'done' ORDER BY started_at DESC LIMIT 1");
  return {
    standard: "veyra-kya/1",
    agent: {
      name: "Veyra",
      role: "autonomous contractor on the NEAR AI Agent Market",
      mode: ctx.config.VEYRA_MODE,
      endpoints: { api: publicUrl, mcp: `${publicUrl}/mcp`, agentCard: `${publicUrl}/.well-known/agent-card.json`, ledger: `${publicUrl}/ledger` },
    },
    principal: owner ? { nearAccount: owner.accountId } : null,
    controls: {
      vault: { kind: vault.kind, agentId: (vault as { agentId?: string }).agentId ?? null, policyHash: policy?.hash ?? null },
      spendAccount: ctx.spend.accountId,
      maxFloatUsdc: ctx.config.MAX_FLOAT_USDC,
      marginBps: ctx.config.CONTRACT_MARGIN_BPS,
      frozen: ctx.engine.frozen(),
      paysOnlyTo: "the market treasury published at /.well-known/x402, at listed prices",
    },
    accountability: {
      receiptIssuer: ctx.receipts.publicKey(),
      ledger: { contractId: ctx.config.LEDGER_CONTRACT_ID ?? (ctx.sim ? "ledger.veyra.sim" : null), network: ctx.sim ? "sim" : ctx.config.LEDGER_NETWORK },
      watchtower: scan ? { lastScan: scan.finished_at, agentsScanned: scan.total, flagged: scan.flagged } : null,
    },
    issuedAt: now(),
  };
}

export function signCredential(ctx: AppContext, credential: ReturnType<typeof buildCredential>) {
  const hash = hex(sha256(new TextEncoder().encode(canonicalJson(credential))));
  const signature = ctx.receipts.sign(hash);
  const ownerAttestation = ctx.db.get<{ value_json: string }>("SELECT value_json FROM kv WHERE key = 'kya.owner_attestation'");
  return {
    credential,
    hash,
    signature: { alg: "ed25519", publicKey: ctx.receipts.publicKey(), value: signature },
    ownerAttestation: ownerAttestation ? parse(ownerAttestation.value_json) : null,
  };
}

export function verifyCredential(input: { credential: unknown; hash: string; signature: { publicKey: string; value: string } }) {
  const hash = hex(sha256(new TextEncoder().encode(canonicalJson(input.credential))));
  let signatureValid = false;
  try {
    signatureValid = ed25519.verify(Buffer.from(input.signature.value, "hex"), Buffer.from(hash, "hex"), Buffer.from(input.signature.publicKey, "hex"));
  } catch {
    signatureValid = false;
  }
  return { hashMatches: hash === input.hash, signatureValid };
}

/** A2A agent card (https://a2a-protocol.org) describing Veyra's skills and how to reach it. */
export function agentCard(ctx: AppContext, publicUrl: string) {
  return {
    name: "Veyra",
    description: "Autonomous contractor: hire it with a budget; it subcontracts specialist agents on the NEAR AI Agent Market, checks their work, pays them in USDC within an owner-signed policy, and delivers with signed receipts.",
    url: `${publicUrl}/mcp`,
    version: "1.0.0",
    provider: { organization: "Veyra", url: publicUrl },
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/markdown", "application/json"],
    skills: [
      { id: "contracting", name: "Contract a job", description: "Plan, subcontract, verify and deliver research, data and writing jobs within a budget.", tags: ["research", "writing", "data", "subcontracting"] },
      { id: "estimate", name: "Price a job", description: "Live market quotes and a GUARD verdict for every candidate agent, without spending.", tags: ["pricing", "x402"] },
      { id: "watchtower", name: "Check a counterparty", description: "Payment-integrity check of any Agent Market agent against published prices and the market treasury.", tags: ["security", "reputation"] },
      { id: "receipts", name: "Verify a receipt", description: "Signature, hash and Merkle proof of any Veyra receipt against its on-chain anchor.", tags: ["audit"] },
    ],
    kya: `${publicUrl}/kya`,
  };
}
