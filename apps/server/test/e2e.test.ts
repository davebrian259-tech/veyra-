import { afterEach, describe, expect, it } from "vitest";
import { examplePolicy } from "../src/services/policy.js";
import { setup, signedIntent, USDC } from "./helpers.js";

type S = Awaited<ReturnType<typeof setup>>;
let s: S;
afterEach(async () => s?.app.close());

/** Creates an agent with the brief's example policy and issues a grant, all owner-signed. */
async function agentWithGrant(env: Record<string, string> = {}) {
  s = await setup(env);
  const token = await s.login();
  const policy = { ...examplePolicy(), destinations: [{ action: "transfer", address: "bob.near", confidential: false }] };
  const created = await s.call("POST", "/agents", { name: "Veyra agent", policy }, token);
  expect(created.status).toBe(200);
  expect(created.json.riskNotice).toMatch(/mainnet-only beta/);
  const submit = await s.call("POST", `/owner-intents/${created.json.correlationId}/submit`, { signedData: signedIntent(created.json.intent, s.kp.publicKey) }, token);
  expect(submit.json.status).toBe("SUCCESS");
  const grant = await s.call("POST", `/agents/${created.json.agentId}/grants`, { label: "backend" }, token);
  expect(grant.status).toBe(200);
  const g = await s.call("POST", `/owner-intents/${grant.json.correlationId}/submit`, { signedData: signedIntent(grant.json.intent, s.kp.publicKey) }, token);
  expect(g.json.status).toBe("SUCCESS");
  return { token, agentId: created.json.agentId as string };
}

const usdc = (usd: number) => String(usd * 1_000_000);

describe("autonomous agent end to end (fake Agent API)", () => {
  it("logs in with a NEP-413 wallet signature and rejects a forged one", async () => {
    s = await setup();
    const ch = await s.call("POST", "/auth/challenge", { accountId: s.accountId });
    const bad = await s.call("POST", "/auth/login", { accountId: s.accountId, publicKey: s.kp.publicKey, nonce: ch.json.nonce, signature: s.sign("something else", ch.json.nonce, ch.json.recipient) });
    expect(bad.status).toBe(401);
    const token = await s.login();
    const me = await s.call("GET", "/auth/me", undefined, token);
    expect(me.json.user.accountId).toBe("alice.testnet");
    expect((await s.call("GET", "/agents")).status).toBe(401);
  });

  it("refuses a signed payload that differs from the prepared intent", async () => {
    s = await setup();
    const token = await s.login();
    const created = await s.call("POST", "/agents", { name: "a", policy: examplePolicy() }, token);
    const tampered = { ...created.json.intent, payload: { ...created.json.intent.payload, message: "different" } };
    const r = await s.call("POST", `/owner-intents/${created.json.correlationId}/submit`, { signedData: signedIntent(tampered, s.kp.publicKey) }, token);
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("payload_mismatch");
  });

  it("executes a permitted transfer, tracks it to settlement and keeps the grant token server-side", async () => {
    const { token, agentId } = await agentWithGrant();
    const op = await s.call("POST", `/agents/${agentId}/actions`, { action: { kind: "transfer", asset: USDC, amount: usdc(20), recipient: "bob.near" }, reason: "pay invoice" }, token);
    expect(["submitted", "confirmed"]).toContain(op.json.status);
    expect(op.json.bodyguard.decision).toBe("allow");
    await s.ctx.monitor.runOnce();
    const after = await s.call("GET", `/operations/${op.json.id}`, undefined, token);
    expect(after.json.operation.status).toBe("settled");
    expect(after.json.operation.tx_hash).toBeTruthy();
    // The grant token was sent only to grant-scoped Agent API endpoints...
    const withGrant = s.net.requests.filter((r) => r.headers["x-grant-token"]);
    expect(withGrant.length).toBeGreaterThan(0);
    expect(withGrant.every((r) => /\/v1\/agents\/[^/]+\/(transfer|swap|withdraw)/.test(r.url))).toBe(true);
    // ...and never appears in any HTTP response, including grant listings and the audit log.
    await s.call("GET", `/agents/${agentId}/grants`, undefined, token);
    await s.call("GET", "/audit", undefined, token);
    expect(s.responses.join("\n")).not.toMatch(/ngt_/);
    expect(s.responses.join("\n")).not.toContain("test-partner-key");
  });

  it("blocks over-limit and unapproved-destination actions before they reach the API", async () => {
    const { token, agentId } = await agentWithGrant();
    const before = s.net.requests.length;
    const big = await s.call("POST", `/agents/${agentId}/actions`, { action: { kind: "transfer", asset: USDC, amount: usdc(150), recipient: "bob.near" } }, token);
    expect(big.json.status).toBe("blocked");
    expect(big.json.bodyguard.findings.map((f: { rule: string }) => f.rule)).toEqual(expect.arrayContaining(["per_transaction_limit", "weekly_budget"]));
    const stranger = await s.call("POST", `/agents/${agentId}/actions`, { action: { kind: "transfer", asset: USDC, amount: usdc(5), recipient: "mallory.near" } }, token);
    expect(stranger.json.status).toBe("blocked");
    expect(stranger.json.bodyguard.findings.map((f: { rule: string }) => f.rule)).toContain("destination_not_approved");
    const dispatched = s.net.requests.slice(before).filter((r) => /\/transfer$/.test(new URL(r.url).pathname) && !r.body?.dry);
    expect(dispatched).toHaveLength(0);
  });

  it("escalates above the $30 threshold and dispatches only after a signed owner approval", async () => {
    const { token, agentId } = await agentWithGrant();
    const op = await s.call("POST", `/agents/${agentId}/actions`, { action: { kind: "transfer", asset: USDC, amount: usdc(45), recipient: "bob.near" } }, token);
    expect(op.json.status).toBe("pending_approval");
    const ch = await s.call("POST", `/approvals/${op.json.approval_id}/challenge`, { verdict: "approve" }, token);
    expect(ch.json.message).toContain(op.json.request_hash);
    // A signature over a different decision is refused.
    const wrong = await s.call("POST", `/approvals/${op.json.approval_id}/decide`, { verdict: "approve", signed: { accountId: s.accountId, publicKey: s.kp.publicKey, nonce: ch.json.nonce, signature: s.sign(ch.json.message.replace("approve", "reject"), ch.json.nonce, ch.json.recipient) } }, token);
    expect(wrong.status).toBe(401);
    const ch2 = await s.call("POST", `/approvals/${op.json.approval_id}/challenge`, { verdict: "approve" }, token);
    const ok = await s.call("POST", `/approvals/${op.json.approval_id}/decide`, { verdict: "approve", signed: { accountId: s.accountId, publicKey: s.kp.publicKey, nonce: ch2.json.nonce, signature: s.sign(ch2.json.message, ch2.json.nonce, ch2.json.recipient) } }, token);
    expect(ok.status).toBe(200);
    expect(["submitted", "confirmed"]).toContain(ok.json.status);
  });

  it("rejects duplicate payments but replays the same idempotency key safely", async () => {
    const { token, agentId } = await agentWithGrant();
    const action = { kind: "transfer", asset: USDC, amount: usdc(10), recipient: "bob.near" };
    const first = await s.call("POST", `/agents/${agentId}/actions`, { action, idempotencyKey: "key-123456" }, token);
    const replay = await s.call("POST", `/agents/${agentId}/actions`, { action, idempotencyKey: "key-123456" }, token);
    expect(replay.json.id).toBe(first.json.id);
    const dup = await s.call("POST", `/agents/${agentId}/actions`, { action }, token);
    expect(dup.json.status).toBe("blocked");
    expect(dup.json.bodyguard.findings.map((f: { rule: string }) => f.rule)).toContain("duplicate_request");
  });

  it("freezes immediately: no dispatch after the kill switch", async () => {
    const { token, agentId } = await agentWithGrant();
    const fr = await s.call("POST", `/agents/${agentId}/freeze`, { reason: "suspicious" }, token);
    expect(fr.json.localFrozen).toBe(true);
    expect(fr.json.intent.type).toBe("agent_freeze");
    const op = await s.call("POST", `/agents/${agentId}/actions`, { action: { kind: "transfer", asset: USDC, amount: usdc(5), recipient: "bob.near" } }, token);
    expect(op.json.status).toBe("blocked");
    expect(op.json.bodyguard.findings[0].rule).toBe("agent_frozen");
  });

  it("records an Agent API policy refusal as rejected_by_api", async () => {
    const { token, agentId } = await agentWithGrant();
    s.net.policyDenied.add("bob.near");
    const op = await s.call("POST", `/agents/${agentId}/actions`, { action: { kind: "transfer", asset: USDC, amount: usdc(5), recipient: "bob.near" } }, token);
    expect(op.json.status).toBe("rejected_by_api");
    expect(op.json.error).toMatch(/policy_destination_denied/);
  });

  it("does not let another user act on someone else's agent", async () => {
    const { agentId } = await agentWithGrant();
    const otherKp = (await import("./helpers.js")).keypair();
    const ch = await s.call("POST", "/auth/challenge", { accountId: "mallory.testnet" });
    const sig = (await import("../src/lib/nep413.js")).signNep413({ message: ch.json.message, recipient: ch.json.recipient, nonce: new Uint8Array(Buffer.from(ch.json.nonce, "base64")) }, otherKp.sk);
    const login = await s.call("POST", "/auth/login", { accountId: "mallory.testnet", publicKey: otherKp.publicKey, nonce: ch.json.nonce, signature: sig });
    const r = await s.call("POST", `/agents/${agentId}/actions`, { action: { kind: "transfer", asset: USDC, amount: usdc(5), recipient: "bob.near" } }, login.json.token);
    expect(r.status).toBe(403);
    const f = await s.call("POST", `/agents/${agentId}/freeze`, {}, login.json.token);
    expect(f.status).toBe(403);
  });

  it("keeps the audit chain verifiable", async () => {
    const { token } = await agentWithGrant();
    const v = await s.call("GET", "/audit/verify", undefined, token);
    expect(v.json.ok).toBe(true);
    expect(v.json.checked).toBeGreaterThan(5);
    s.db.run("UPDATE audit_log SET data_json = '{}' WHERE seq = 2");
    expect(s.ctx.audit.verify().ok).toBe(false);
  });
});

describe("WANTED → UNDO", () => {
  it("plans the brief's website goal, gathers simulated offers within budget and builds an owner-controlled escrow", async () => {
    s = await setup();
    const token = await s.login();
    s.rpc.views.set("escrow.veyra.testnet.get_escrows_for", []);
    const run = await s.call("POST", "/autonomous/run", { prompt: "I have $200. Find someone who can build my business website. Keep the cost below $150. Do not release payment until the work is completed. Keep the remaining funds safe." }, token);
    expect(run.status).toBe(200);
    const plan = run.json.steps[0].result.plan;
    expect(plan.intent).toBe("hire");
    expect(plan.budgetUsd).toBe(200);
    expect(plan.maxSpendUsd).toBe(150);
    expect(plan.hire.releaseOnlyOnCompletion).toBe(true);
    expect(run.json.source.kind).toBe("heuristic");
    const ranked = run.json.steps.find((x: { step: string }) => x.step === "rank").result;
    expect(ranked.length).toBeGreaterThan(0);
    for (const o of ranked) expect(o.priceUsd).toBeLessThanOrEqual(150);
    // Budget is never revealed to providers in offer requests.
    expect(JSON.stringify(s.net.requests.map((r) => r.body))).not.toContain("150");

    const sel = await s.call("POST", `/wanted/jobs/${run.json.jobId}/select`, { offerId: run.json.recommendation.offerId }, token);
    expect(sel.status).toBe(200);
    const esc = await s.call("POST", `/wanted/jobs/${run.json.jobId}/escrow`, { fundingMode: "wallet" }, token);
    expect(esc.status).toBe(200);
    const tx = esc.json.walletTransactions[0];
    expect(tx.receiverId).toBe("escrow.veyra.testnet");
    const args = tx.actions[0].params.args;
    expect(args.approver).toBe("alice.testnet");
    expect(args.terms_hash).toBe(esc.json.termsHash);
    const total = args.milestones.reduce((n: bigint, m: { amount: string }) => n + BigInt(m.amount), 0n);
    expect(total.toString()).toBe(esc.json.terms.total);
    expect(BigInt(tx.actions[0].params.deposit)).toBeGreaterThan(total);

    // Confirm with an on-chain outcome that emitted escrow_created for these exact terms.
    s.rpc.outcomes.set("HASH1111111111111111111111111", {
      final_execution_status: "EXECUTED_OPTIMISTIC",
      status: { SuccessValue: "" },
      transaction: { hash: "HASH", signer_id: "alice.testnet", receiver_id: "escrow.veyra.testnet", actions: [] },
      transaction_outcome: { outcome: { logs: [], status: {} } },
      receipts_outcome: [{ id: "r", outcome: { executor_id: "escrow.veyra.testnet", status: { SuccessValue: "" }, logs: [`EVENT_JSON:${JSON.stringify({ standard: "veyra_escrow", version: "1.0.0", event: "escrow_created", data: [{ escrow_id: "7", payer: "alice.testnet", provider: args.provider, total: esc.json.terms.total }] })}`] } }],
    });
    s.rpc.views.set(`escrow.veyra.testnet.get_escrow.${JSON.stringify({ escrow_id: "7" })}`, { id: "7", status: "active", terms_hash: esc.json.termsHash });
    const conf = await s.call("POST", `/escrows/${esc.json.escrowId}/confirm`, { txHash: "HASH1111111111111111111111111" }, token);
    expect(conf.status).toBe(200);
    expect(conf.json.onchain_id).toBe("7");
    expect(conf.json.status).toBe("active");

    // Release is a wallet transaction for the owner; the backend only prepares it.
    const accept = await s.call("POST", `/escrows/${esc.json.escrowId}/actions/accept`, { milestoneIndex: 0 }, token);
    expect(accept.json.walletTransactions[0].actions[0].params.methodName).toBe("accept_milestone");
  });

  it("blocks agent escrow funding when the agent policy does not allow the contract", async () => {
    const { token, agentId } = await agentWithGrant();
    const r = await s.call("POST", "/escrows", { provider: "bob.near", totalAtomic: "1000000000000000000000000", milestones: [{ title: "All", sharePct: 100 }], deadlineDays: 7, fundingMode: "agent", agentId }, token);
    expect(r.status).toBe(200);
    expect(r.json.operation.status).toBe("blocked");
    expect(r.json.operation.bodyguard.findings.map((f: { rule: string }) => f.rule)).toContain("escrow_contract_not_approved");
  });
});

describe("manual mode", () => {
  it("flags lookalike destinations and unlimited function-call keys", async () => {
    s = await setup();
    const token = await s.login();
    const a = await s.call("POST", "/bodyguard/analyze", { tx: { type: "transfer", asset: "NEAR", amount: "1000000000000000000000000", receiver: "wrap.neer" } }, token);
    expect(a.json.findings.map((f: { rule: string }) => f.rule)).toContain("lookalike_address");
    expect(a.json.level).toBe("danger");
    const ghost = await s.call("POST", "/bodyguard/analyze", { tx: { type: "transfer", asset: "NEAR", amount: "1", receiver: "ghost-account.testnet" } }, token);
    expect(ghost.json.findings.map((f: { rule: string }) => f.rule)).toContain("account_not_found");
    const key = await s.call("POST", "/bodyguard/analyze", { tx: { type: "add_key", publicKey: "ed25519:x", permission: "FullAccess" } }, token);
    expect(key.json.decision).toBe("block");
    const keys = await s.call("GET", "/bodyguard/access-keys", undefined, token);
    expect(keys.json.functionCallKeys).toBe(1);
    expect(keys.json.keys[1].findings.map((f: { rule: string }) => f.rule)).toEqual(expect.arrayContaining(["unlimited_allowance", "lookalike_address"]));
  });

  it("refuses unsupported assets for NEAR Intents quotes", async () => {
    s = await setup();
    const token = await s.login();
    const r = await s.call("POST", "/intents/quote", { originAsset: "nep141:not-a-token.near", destinationAsset: USDC, amount: "100" }, token);
    expect(r.json.quotes.every((q: { ok: boolean; error?: string }) => !q.ok && /not currently supported/.test(q.error ?? ""))).toBe(true);
  });
});
