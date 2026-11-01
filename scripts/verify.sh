#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "=== [1/7] Checking Log Provenance & Integrity against MANIFEST ==="
./scripts/check_logs_provenance.sh

echo "=== [2/7] Running Cargo Tests ==="
cargo test --manifest-path packages/core/Cargo.toml

echo "=== [3/7] Running Cargo Clippy ==="
cargo clippy --manifest-path packages/core/Cargo.toml --all-targets -- -D warnings

echo "=== [4/7] Running SDK Tests ==="
# The SDK loads the napi addon, and the .node binary is gitignored, so a clean checkout has no
# native binding. CI builds it before testing; verify.sh must do the same or it only passes on a
# tree that was already built.
pnpm --filter @zcash-app/core build
pnpm --filter @zcash-app/sdk test

echo "=== [5/7] Running zcash-dev CLI Tests ==="
# zcash-dev imports @zcash-app/sdk, whose types live in dist/ (gitignored). Building the SDK
# first is what makes this step work from a clean checkout, not just from a used one.
# dev tests (keys-and-cli.test.mjs) import create-zcash-app's dist/ (gitignored), so build it first.
pnpm --filter @zcash-app/sdk build
pnpm --filter zcash-dev build
pnpm --filter create-zcash-app build
pnpm --filter zcash-dev test

echo "=== [6/8] Running Dashboard Tests ==="
# Test dashboard node sync percentage calculation, secret redaction, and status calculation
pnpm --filter dashboard test

echo "=== [7/8] Running Documentation Drift & Link Check ==="
# Verify that generated reference docs match the codebase, no CLI commands/flags in prose drift,
# and all internal links are valid. If mdbook is installed, verify the book builds cleanly.
pnpm docs:check
if command -v mdbook >/dev/null 2>&1; then
  mdbook build docs
fi

echo "=== [8/8] Running Gitleaks Scan ==="
gitleaks git

echo "=== VERIFY SUCCESS: All 8 checks passed cleanly! ==="
