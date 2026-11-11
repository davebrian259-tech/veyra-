#!/usr/bin/env bash
# Tests and builds the veyra-ledger contract with cargo-near
# (install: cargo install cargo-near --locked --no-default-features).
set -euo pipefail
cd "$(dirname "$0")/../contracts"
cargo test
(cd ledger && cargo near build non-reproducible-wasm)
ls -la target/near/veyra_ledger/veyra_ledger.wasm
