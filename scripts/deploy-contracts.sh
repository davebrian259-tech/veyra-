#!/usr/bin/env bash
# Deploys the UNDO escrow and PROOF OF LIFE contracts with NEAR CLI (near-cli-rs).
#
#   ./scripts/deploy-contracts.sh <parent-account> [network]
#
# Example: ./scripts/deploy-contracts.sh veyra-demo.testnet testnet
# creates escrow.<parent> and pol.<parent>, deploys, and initialises them with <parent> as owner
# (the owner is the default dispute arbiter for escrows that name no arbiter).
# Requires the parent account's key in your local keychain (`near account import-account`).
set -euo pipefail
PARENT="${1:?parent account required}"
NETWORK="${2:-testnet}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
"$ROOT/scripts/build-contracts.sh"

deploy() {
  local sub="$1" wasm="$2"
  local id="$sub.$PARENT"
  near account create-account fund-myself "$id" '3 NEAR' autogenerate-new-keypair save-to-keychain \
    sign-as "$PARENT" network-config "$NETWORK" sign-with-keychain send || echo "($id may already exist)"
  near contract deploy "$id" use-file "$wasm" with-init-call new json-args "{\"owner\":\"$PARENT\"}" \
    prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config "$NETWORK" sign-with-keychain send
  echo "$id"
}

ESCROW=$(deploy escrow "$ROOT/contracts/target/near/veyra_escrow/veyra_escrow.wasm" | tail -1)
POL=$(deploy pol "$ROOT/contracts/target/near/veyra_rewards/veyra_rewards.wasm" | tail -1)
echo
echo "Add to apps/server/.env:"
echo "NEAR_NETWORK=$NETWORK"
echo "ESCROW_CONTRACT_ID=$ESCROW"
echo "REWARDS_CONTRACT_ID=$POL"
[ "$NETWORK" = "mainnet" ] && echo "AGENT_ESCROW_CONTRACT_ID=$ESCROW"
