/**
 * `pnpm deploy:loot`: deploys the veyra-loot NEP-245 contract and defines one gold bar per vault.
 *
 *   LOOT_DEPLOY_ACCOUNT=loot.testnet LOOT_DEPLOY_KEY=ed25519:... HEIST_REFEREE_ID=referee.testnet pnpm deploy:loot
 *
 * The referee becomes the minter: it mints a vault's bar to whoever cracks it in a ranked heist.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { actionCreators } from "@near-js/transactions";
import { VAULTS } from "../heist/vaults.js";
import { NearRpc } from "../lib/near-rpc.js";
import { keyPairFrom, sendTransaction } from "../lib/near-signer.js";

const account = process.env.LOOT_DEPLOY_ACCOUNT;
const key = process.env.LOOT_DEPLOY_KEY;
const minter = process.env.HEIST_REFEREE_ID ?? process.env.LEDGER_WRITER_ID ?? account;
const network = process.env.HEIST_NETWORK ?? "testnet";
const media = process.env.LOOT_MEDIA_BASE ?? "https://veyra-ccp.pages.dev/vaults";
if (!account || !key) throw new Error("set LOOT_DEPLOY_ACCOUNT and LOOT_DEPLOY_KEY");
const rpc = new NearRpc(network === "mainnet" ? "https://rpc.mainnet.near.org" : "https://rpc.testnet.near.org");
const wasm = readFileSync(resolve(import.meta.dirname, "../../../../contracts/target/near/veyra_loot/veyra_loot.wasm"));
const initialised = await rpc.view(account, "get_config", {}).then(() => true).catch(() => false);
const actions = [actionCreators.deployContract(new Uint8Array(wasm))];
if (!initialised) {
  actions.push(actionCreators.functionCall("new", { owner: account, minter }, 30_000_000_000_000n, 0n));
  for (const v of VAULTS) {
    actions.push(actionCreators.functionCall("add_item", {
      token_id: `bar-${v.id}`,
      metadata: { title: `${v.name} gold bar`, description: `Taken from vault ${v.id}, ${v.name}, in a ranked Veyra Heist. ${v.shields.length} of 8 shields were up.`, media: `${media}/vault-${v.id}.webp` },
    }, 20_000_000_000_000n, 0n));
  }
}
const r = await sendTransaction(rpc, account, keyPairFrom(key), account, actions);
console.log(`${initialised ? "Redeployed" : "Deployed and initialised"} veyra-loot on ${account} (${network}), minter ${minter}: https://${network === "mainnet" ? "" : "testnet."}nearblocks.io/txns/${r.transaction.hash}`);
console.log(`\nLOOT_CONTRACT_ID=${account}`);
