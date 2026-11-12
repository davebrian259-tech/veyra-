/**
 * `pnpm demo` — the whole agent economy, offline, in about ten seconds.
 * Local market simulator + in-memory NEAR ledger + real ed25519 cheques. No keys, no money.
 */
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { ftTransferAction, implicitAccountId, newKeyPair, signDelegate } from "../lib/near-signer.js";
import { SIM_USDC } from "../sim/market.js";

const c = { dim: "\x1b[2m", b: "\x1b[1m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m", r: "\x1b[0m" };
const color = (kind: string) => (/attack|block|no_show/.test(kind) ? c.red : /done|verified|delivered/.test(kind) ? c.green : /pay|award|negotiate/.test(kind) ? c.yellow : c.cyan);
const usd = (atomic: string) => `${(Number(atomic) / 1e6).toFixed(2)} USDC`;

const { app, ctx, scheduler } = await buildApp(loadConfig({ ...process.env, NODE_ENV: "test", DATABASE_PATH: ":memory:", VEYRA_MODE: "sim", NEAR_AI_API_KEY: process.env.NEAR_AI_API_KEY ?? "" }));
await scheduler.runOnce();
const call = async (method: string, url: string, payload?: unknown, token?: string) => {
  const r = await app.inject({ method: method as never, url, payload: payload as never, headers: token ? { authorization: `Bearer ${token}` } : {} });
  return JSON.parse(r.body);
};
const { token } = await call("POST", "/sim/session");

console.log(`\n${c.b}VEYRA: an autonomous contractor on the (simulated) NEAR AI Agent Market${c.r}`);
console.log(`${c.dim}Spend account ${ctx.spend.accountId.slice(0, 16)}… · receipt key ${ctx.receipts.publicKey().slice(0, 16)}… · mode: sim${c.r}\n`);

console.log(`${c.b}1. A buyer hires Veyra on the market for 4.00 USDC${c.r}`);
const hire = await call("POST", "/sim/hire", {
  title: "Competitor research: NEAR agent wallets",
  description: "Research competitors to NEAR Intents agent wallets, compare their pricing in a table, and write a short report with recommendations for a founder.",
  budgetUsd: 4,
});
for (const e of hire.contract.events) console.log(`   ${color(e.kind)}${e.kind.padEnd(16)}${c.r} ${e.message}`);
const m = hire.contract.money;
console.log(`   ${c.b}P&L:${c.r} revenue ${m.revenueUsd.toFixed(2)} · cost ${m.costUsd.toFixed(2)} · margin ${c.green}${m.marginUsd.toFixed(2)} USDC${c.r}\n`);

console.log(`${c.b}2. Another agent hires Veyra with an x402 cheque, executed only on delivery${c.r}`);
{
  const kp = newKeyPair();
  const buyerId = implicitAccountId(kp.getPublicKey().toString());
  ctx.sim!.chain.createAccount(buyerId, kp.getPublicKey().toString());
  ctx.sim!.chain.mint(SIM_USDC, buyerId, 10_000_000n);
  const params = { message: { parts: [{ text: "Compare three NEAR wallets for agents and write a short recommendation." }], metadata: { title: "Wallet comparison", budgetUsd: 6 } } };
  const challenge = JSON.parse((await app.inject({ method: "POST", url: "/a2a/v1", payload: { jsonrpc: "2.0", id: 1, method: "SendMessage", params } })).body);
  const row = challenge.accepts[0];
  console.log(`   ${c.cyan}402             ${c.r} Veyra asks for ${usd(row.amount)} to ${row.payTo.slice(0, 12)}… (its spend account, as published at /.well-known/x402)`);
  const height = await ctx.chain.blockHeight();
  const cheque = signDelegate({ senderId: buyerId, receiverId: row.asset, actions: [ftTransferAction(row.payTo, row.amount)], nonce: 1n, maxBlockHeight: height + BigInt(row.maxTimeoutSeconds), keyPair: kp });
  const xPayment = Buffer.from(JSON.stringify({ accepted: row, payload: { signedDelegateAction: cheque.base64 } })).toString("base64");
  ctx.engine.setFrozen(true, "demo"); // hold the job so the "not yet paid" state is visible
  const accepted = JSON.parse((await app.inject({ method: "POST", url: "/a2a/v1", headers: { "x-payment": xPayment }, payload: { jsonrpc: "2.0", id: 2, method: "SendMessage", params } })).body);
  const taskId = accepted.result.task.id;
  console.log(`   ${c.yellow}cheque_held     ${c.r} buyer ${buyerId.slice(0, 12)}… signed a NEP-366 cheque; balance still ${usd((await ctx.chain.ftBalance(SIM_USDC, buyerId)).toString())}`);
  ctx.engine.setFrozen(false, "demo");
  await ctx.engine.advance(taskId);
  const task = JSON.parse((await app.inject({ method: "POST", url: "/a2a/v1", payload: { jsonrpc: "2.0", id: 3, method: "GetTask", params: { id: taskId } } })).body).result;
  console.log(`   ${c.green}${task.status.state.replace("TASK_STATE_", "").toLowerCase().padEnd(16)}${c.r} cheque ${task.payment.status} in ${task.payment.settlement}; buyer balance now ${usd((await ctx.chain.ftBalance(SIM_USDC, buyerId)).toString())}`);
  const owner = ctx.ownerUser()!;
  const payout = await ctx.treasury.payout(owner.accountId, ctx.receipts, 1n, "scheduler");
  if (payout.paid) console.log(`   ${c.green}payout          ${c.r} ${usd(payout.amountAtomic)} of earned margin paid to ${owner.accountId} (receipt ${payout.receiptId})\n`);
  else console.log(`   ${c.dim}payout           nothing above the float yet (${payout.reason})${c.r}\n`);
}

console.log(`${c.b}3. Attack lab: counterparties try to rob Veyra${c.r}`);
for (const s of ["payee-swap", "bait-and-switch", "prompt-injection", "no-show"]) {
  const r = await call("POST", `/lab/${s}`, {}, token);
  console.log(`   ${c.b}${s}${c.r} ${c.dim}(adversary: ${r.adversary})${c.r}`);
  for (const e of r.securityEvents.filter((x: { kind: string }) => x.kind !== "retry")) console.log(`     ${color(e.kind)}${e.kind.padEnd(16)}${c.r} ${e.message.slice(0, 220)}`);
  console.log(`     ${c.green}✓ contract ${r.contract.status}; attacker balance ${usd(r.attacker.balance)}${c.r}`);
}

console.log(`\n${c.b}4. The verifiable trail${c.r}`);
const ledger = await call("GET", "/ledger");
const t = ledger.totals;
console.log(`   ${t.delivered}/${t.contracts} contracts delivered · revenue ${t.revenueUsd.toFixed(2)} · cost ${t.costUsd.toFixed(2)} · margin ${t.marginUsd.toFixed(2)} USDC · ${t.securityEvents} security events`);
const receipts = (await call("GET", `/receipts?contract=${hire.contract.id}`)).receipts;
const proof = await call("GET", `/receipts/${receipts[0].id}/proof`);
console.log(`   receipt ${receipts[0].id}: hash ✓ ${proof.checks.hashMatchesBody} · signature ✓ ${proof.checks.signatureValid} · Merkle proof ✓ ${proof.proof.valid} · anchored in ${proof.anchor.tx_hash}`);
const st = await call("GET", "/sim/state");
console.log(`   balances: vault ${usd(st.balances.vault)} · spend float ${usd(st.balances.spend)} · market treasury ${usd(st.balances.treasury)} · ${c.red}attacker ${usd(st.balances.attacker)}${c.r}`);
const scan = await ctx.watchtower.scan() as { flagged: number; total: number };
const wproof = ctx.watchtower.proof("payee-swapper");
console.log(`   watchtower: ${scan.total} agents scanned, ${scan.flagged} flagged · verdict for payee-swapper proven against root ${wproof.root!.slice(0, 12)}… ✓ ${wproof.valid}`);
console.log(`\n${c.dim}The same code runs live against market.near.ai with VEYRA_MODE=live (see the README). Try the live dry run: pnpm live:dry-run "your task"${c.r}\n`);
await app.close();
