/**
 * `pnpm deploy:heist`: deploys the veyra-heist pot contract to an account you control and
 * initialises it with the five vault fees.
 *
 *   HEIST_DEPLOY_ACCOUNT=pots.testnet HEIST_DEPLOY_KEY=ed25519:... HEIST_REFEREE_ID=referee.testnet pnpm deploy:heist
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { actionCreators } from "@near-js/transactions";
import { VAULTS } from "../heist/vaults.js";
import { NearRpc } from "../lib/near-rpc.js";
import { keyPairFrom, sendTransaction } from "../lib/near-signer.js";

const account = process.env.HEIST_DEPLOY_ACCOUNT;
const key = process.env.HEIST_DEPLOY_KEY;
const referee = process.env.HEIST_REFEREE_ID ?? account;
const network = process.env.HEIST_NETWORK ?? "testnet";
if (!account || !key) throw new Error("set HEIST_DEPLOY_ACCOUNT and HEIST_DEPLOY_KEY");
const rpc = new NearRpc(network === "mainnet" ? "https://rpc.mainnet.near.org" : "https://rpc.testnet.near.org");
const wasm = readFileSync(resolve(import.meta.dirname, "../../../../contracts/target/near/veyra_heist/veyra_heist.wasm"));
const yocto = (n: string) => { const [w, f = ""] = n.split("."); return (BigInt(w) * 10n ** 24n + BigInt((f + "0".repeat(24)).slice(0, 24))).toString(); };
const initialised = await rpc.view(account, "get_config", {}).then(() => true).catch(() => false);
const actions = [actionCreators.deployContract(new Uint8Array(wasm))];
if (!initialised) actions.push(actionCreators.functionCall("new", { owner: account, referee, fees: VAULTS.map((v) => yocto(v.feeNear)) }, 50_000_000_000_000n, 0n));
const r = await sendTransaction(rpc, account, keyPairFrom(key), account, actions);
console.log(`${initialised ? "Redeployed" : "Deployed and initialised"} veyra-heist on ${account} (${network}), referee ${referee}: https://${network === "mainnet" ? "" : "testnet."}nearblocks.io/txns/${r.transaction.hash}`);
console.log(`\nHEIST_CONTRACT_ID=${account}\nHEIST_NETWORK=${network}`);
