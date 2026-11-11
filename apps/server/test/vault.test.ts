import { afterEach, describe, expect, it } from "vitest";
import { examplePolicy } from "../src/services/policy.js";
import { setup, signedIntent, USDC } from "./helpers.js";

type S = Awaited<ReturnType<typeof setup>>;
let s: S;
afterEach(async () => s?.app.close());

/** Creates the vault agent with the example policy and issues a grant, all owner-signed. */
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
    await s.scheduler.runOnce();
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
