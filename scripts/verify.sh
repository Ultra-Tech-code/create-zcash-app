#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "=== [1/6] Checking Log Provenance & Integrity against MANIFEST ==="
./scripts/check_logs_provenance.sh

echo "=== [2/6] Running Cargo Tests ==="
cargo test --manifest-path packages/core/Cargo.toml

echo "=== [3/6] Running Cargo Clippy ==="
cargo clippy --manifest-path packages/core/Cargo.toml --all-targets -- -D warnings

echo "=== [4/6] Running SDK Tests ==="
# The SDK loads the napi addon, and the .node binary is gitignored, so a clean checkout has no
# native binding. CI builds it before testing; verify.sh must do the same or it only passes on a
# tree that was already built.
pnpm --filter @zcash-app/core build
pnpm --filter @zcash-app/sdk test

echo "=== [5/6] Running zcash-dev CLI Tests ==="
# zcash-dev imports @zcash-app/sdk, whose types live in dist/ (gitignored). Building the SDK
# first is what makes this step work from a clean checkout, not just from a used one.
# dev tests (keys-and-cli.test.mjs) import create-zcash-app's dist/ (gitignored), so build it first.
pnpm --filter @zcash-app/sdk build
pnpm --filter zcash-dev build
pnpm --filter create-zcash-app build
pnpm --filter zcash-dev test

echo "=== [6/6] Running Gitleaks Scan ==="
gitleaks git

echo "=== VERIFY SUCCESS: All 6 checks passed cleanly! ==="
