#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "=== [1/5] Running Cargo Tests ==="
cargo test --manifest-path packages/core/Cargo.toml

echo "=== [2/5] Running Cargo Clippy ==="
cargo clippy --manifest-path packages/core/Cargo.toml --all-targets -- -D warnings

echo "=== [3/5] Running SDK Tests ==="
# The SDK loads the napi addon, and the .node binary is gitignored, so a clean checkout has no
# native binding. CI builds it before testing; verify.sh must do the same or it only passes on a
# tree that was already built.
pnpm --filter @zcash-app/core build
pnpm --filter @zcash-app/sdk test

echo "=== [4/5] Running zcash-dev CLI Tests ==="
# zcash-dev imports @zcash-app/sdk, whose types live in dist/ (gitignored). Building the SDK
# first is what makes this step work from a clean checkout, not just from a used one.
pnpm --filter @zcash-app/sdk build
pnpm --filter zcash-dev build
pnpm --filter zcash-dev test

echo "=== [5/5] Running Gitleaks Scan ==="
gitleaks git

echo "=== VERIFY SUCCESS: All 5 checks passed cleanly! ==="
