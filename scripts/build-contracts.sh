#!/usr/bin/env bash
# Builds both NEAR contracts with cargo-near (install: cargo install cargo-near --locked).
set -euo pipefail
cd "$(dirname "$0")/../contracts"
cargo test
(cd escrow && cargo near build non-reproducible-wasm)
(cd rewards && cargo near build non-reproducible-wasm)
ls -la target/near/veyra_escrow/veyra_escrow.wasm target/near/veyra_rewards/veyra_rewards.wasm
