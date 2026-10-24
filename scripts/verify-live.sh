#!/usr/bin/env bash
# Opt-in LIVE regtest verification. This is NOT part of scripts/verify.sh.
#
# It destroys the local z3-regtest cluster (chain, indexes, wallet), rebuilds it,
# funds Account 0 and Account 1 exactly once, and runs the P3 cross-account payment.
# It refuses to run without --yes and always prints what it is about to wipe first.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [[ "${1:-}" != "--yes" ]]; then
  cat <<'MSG'
REFUSING TO RUN: scripts/verify-live.sh destroys the local regtest cluster.

It will:
  1. Wipe the z3-regtest Docker project: chain volume, Zallet wallet volume,
     cookie volume and Zallet CA certificates (see the dry run below)
  2. Re-initialise genesis state, recreate the miner account and mine a fresh chain
  3. Fund Account 0 with 5 ZEC and Account 1 with 3 ZEC exactly once
  4. Run scripts/p3_cross_account.mjs and require exit code 0

Nothing has been deleted. Re-run with --yes to proceed.
MSG
  exit 2
fi

echo "=== [0/5] What this run will destroy (dry run) ==="
node packages/dev/dist/cli.js regtest wipe --dry-run

echo
echo "=== [1/5] Building SDK and zcash-dev from source ==="
pnpm --filter @zcash-app/sdk build
pnpm --filter zcash-dev build

echo
echo "=== [2/5] Wiping and rebuilding the regtest cluster ==="
node packages/dev/dist/cli.js regtest wipe --yes

echo
echo "=== [3/5] Funding Account 0 and Account 1 exactly once ==="
node scripts/item10_fund_and_sync_accounts.mjs | tee /tmp/verify-live-funding.log

echo
echo "=== [4/5] Running the P3 cross-account payment ==="
node scripts/p3_cross_account.mjs

echo
echo "=== [5/5] VERIFY-LIVE SUCCESS: wiped, funded once, P3 payment completed (exit 0) ==="
