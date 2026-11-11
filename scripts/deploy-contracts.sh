#!/usr/bin/env bash
# Deploys the veyra-ledger receipt-anchoring contract with NEAR CLI (near-cli-rs).
#
#   ./scripts/deploy-contracts.sh <parent-account> <writer-account> [network]
#
# Creates ledger.<parent>, deploys the wasm and initialises it with <parent> as owner and
# <writer-account> as the only account allowed to anchor (normally Veyra's spend account, or a
# dedicated LEDGER_WRITER_ID). Requires the parent's key in your keychain
# (`near account import-account`). This spends a little NEAR; nothing runs without you.
set -euo pipefail
PARENT="${1:?parent account required}"
WRITER="${2:?writer account required}"
NETWORK="${3:-testnet}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
"$ROOT/scripts/build-contracts.sh"
ID="ledger.$PARENT"
near account create-account fund-myself "$ID" '2 NEAR' autogenerate-new-keypair save-to-keychain \
  sign-as "$PARENT" network-config "$NETWORK" sign-with-keychain send || echo "($ID may already exist)"
near contract deploy "$ID" use-file "$ROOT/contracts/target/near/veyra_ledger/veyra_ledger.wasm" \
  with-init-call new json-args "{\"owner\":\"$PARENT\",\"writers\":[\"$WRITER\"]}" \
  prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config "$NETWORK" sign-with-keychain send
echo
echo "Add to apps/server/.env:"
echo "LEDGER_CONTRACT_ID=$ID"
echo "LEDGER_NETWORK=$NETWORK"
