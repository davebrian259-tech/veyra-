/**
 * `pnpm deploy:ledger` — deploys the veyra-ledger contract with nothing but an RPC and a key.
 *
 *   LEDGER_DEPLOY_ACCOUNT=you.testnet LEDGER_DEPLOY_KEY=ed25519:... [LEDGER_NETWORK=testnet] pnpm deploy:ledger
 *
 * The contract is deployed to the account itself (no sub-account, so no extra NEAR), initialised
 * with that account as owner and writer. Afterwards set LEDGER_CONTRACT_ID, LEDGER_WRITER_ID and
 * LEDGER_WRITER_KEY to the same values. Re-running on an already initialised contract redeploys
 * the code and skips `new`.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { actionCreators } from "@near-js/transactions";
import { NearRpc } from "../lib/near-rpc.js";
import { keyPairFrom, sendTransaction } from "../lib/near-signer.js";

const account = process.env.LEDGER_DEPLOY_ACCOUNT;
const key = process.env.LEDGER_DEPLOY_KEY;
const network = process.env.LEDGER_NETWORK ?? "testnet";
if (!account || !key) throw new Error("set LEDGER_DEPLOY_ACCOUNT and LEDGER_DEPLOY_KEY");
const rpc = new NearRpc(network === "mainnet" ? "https://rpc.mainnet.near.org" : "https://rpc.testnet.near.org");
const wasm = readFileSync(resolve(import.meta.dirname, "../../../../contracts/target/near/veyra_ledger/veyra_ledger.wasm"));
const kp = keyPairFrom(key);

const initialised = await rpc.view<number>(account, "count", {}).then(() => true).catch(() => false);
const actions = [actionCreators.deployContract(new Uint8Array(wasm))];
if (!initialised) actions.push(actionCreators.functionCall("new", { owner: account, writers: [account] }, 50_000_000_000_000n, 0n));
const r = await sendTransaction(rpc, account, kp, account, actions);
const explorer = network === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io";
console.log(`${initialised ? "Redeployed" : "Deployed and initialised"} veyra-ledger on ${account} (${network}): ${explorer}/txns/${r.transaction.hash}`);
console.log(`\nLEDGER_CONTRACT_ID=${account}\nLEDGER_NETWORK=${network}\nLEDGER_WRITER_ID=${account}\nLEDGER_WRITER_KEY=<the same key>`);
