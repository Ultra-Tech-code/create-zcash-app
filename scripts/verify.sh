#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "=== [1/4] Running Cargo Tests ==="
cargo test --manifest-path packages/core/Cargo.toml

echo "=== [2/4] Running Cargo Clippy ==="
cargo clippy --manifest-path packages/core/Cargo.toml --all-targets -- -D warnings

echo "=== [3/4] Running SDK Tests ==="
pnpm --filter @zcash-app/sdk test

echo "=== [4/4] Running Gitleaks Scan ==="
gitleaks git

echo "=== VERIFY SUCCESS: All 4 checks passed cleanly! ==="
