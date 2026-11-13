import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

/**
 * A test wallet: the page sees an ordinary connected NEAR account, and each transaction it asks
 * to sign is signed here, in Node, with a testnet key from the environment. Nothing is mocked:
 * the transaction goes to NEAR testnet and the app follows it as it would a real wallet's.
 */
const serverRequire = createRequire(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../server/package.json"));

export const e2eAccount = process.env.E2E_NEAR_ACCOUNT ?? "";
const e2eKey = process.env.E2E_NEAR_KEY ?? "";
export const hasTestnetKey = Boolean(e2eAccount && e2eKey);

type WalletTx = { receiverId: string; actions: { type: "FunctionCall"; params: { methodName: string; args: unknown; gas: string; deposit: string } }[] };

async function signAndSend(txs: WalletTx[]) {
  const { actionCreators } = serverRequire("@near-js/transactions");
  const { sendTransaction, keyPairFrom } = await import("../../server/src/lib/near-signer.ts");
  const { NearRpc } = await import("../../server/src/lib/near-rpc.ts");
  const rpc = new NearRpc("https://rpc.testnet.near.org");
  const hashes: string[] = [];
  for (const tx of txs) {
    const actions = tx.actions.map((a) => actionCreators.functionCall(a.params.methodName, a.params.args as object, BigInt(a.params.gas), BigInt(a.params.deposit)));
    const res = await sendTransaction(rpc, e2eAccount, keyPairFrom(e2eKey), tx.receiverId, actions);
    hashes.push(res.transaction.hash);
  }
  return hashes;
}

/** Sends a call from the test account directly (no page), e.g. to put house money back in a pot. */
export async function callFromTestAccount(contractId: string, method: string, args: object, depositYocto: bigint) {
  return signAndSend([{ receiverId: contractId, actions: [{ type: "FunctionCall", params: { methodName: method, args, gas: "30000000000000", deposit: depositYocto.toString() } }] }]);
}

/** The test account's balance in yoctoNEAR. */
export async function testAccountBalance() {
  const { NearRpc } = await import("../../server/src/lib/near-rpc.ts");
  return BigInt((await new NearRpc("https://rpc.testnet.near.org").viewAccount(e2eAccount)).amount);
}

/** Installs the bridge. `reject` makes every signature fail the way a cancelled wallet does. */
export async function installWallet(page: Page, opts: { accountId?: string; reject?: boolean } = {}) {
  const accountId = opts.accountId ?? e2eAccount;
  await page.exposeFunction("__veyraE2ESign", async (txsJson: string) => {
    if (opts.reject) throw new Error("User rejected the request.");
    return signAndSend(JSON.parse(txsJson));
  });
  await page.addInitScript((id) => {
    (window as unknown as { __veyraE2E: unknown }).__veyraE2E = { accountId: id, sign: (t: string) => (window as unknown as { __veyraE2ESign: (t: string) => Promise<string[]> }).__veyraE2ESign(t) };
  }, accountId);
}

/** How many of a NEP-245 item the test account holds. */
export async function itemBalance(lootContract: string, tokenId: string, account = e2eAccount) {
  const { NearRpc } = await import("../../server/src/lib/near-rpc.ts");
  return BigInt(await new NearRpc("https://rpc.testnet.near.org").view<string>(lootContract, "mt_balance_of", { account_id: account, token_id: tokenId }));
}
