#!/usr/bin/env bash
set -euo pipefail

# scripts/verify-testnet.sh
# Opt-in testnet verification script for the Zcash TypeScript SDK.
# Read-only unless --yes is explicitly passed.
# Strictly refuses mainnet.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="$REPO_ROOT/packages/core/tests/logs"
LOG_FILE="$LOG_DIR/testnet_readonly.log"

mkdir -p "$LOG_DIR"

# 1. Mainnet guard check
for arg in "$@"; do
  if [ "$arg" = "mainnet" ] || [ "$arg" = "--mainnet" ]; then
    echo "Refusing: scripts/verify-testnet.sh strictly refuses mainnet to prevent accidental operations on mainnet." >&2
    exit 1
  fi
done

if [ "${1:-}" = "--network" ] && [ "${2:-}" = "mainnet" ]; then
  echo "Refusing: scripts/verify-testnet.sh strictly refuses mainnet to prevent accidental operations on mainnet." >&2
  exit 1
fi

echo "==============================================================="
echo "=== ZCASH SDK TESTNET INTEGRATION VERIFIER                 ==="
echo "==============================================================="
echo "Mode: Opt-in testnet verification (Read-only)"
echo "Target Endpoint: ${ZCASH_ENDPOINT:-127.0.0.1:8137}"
echo "Log file: packages/core/tests/logs/testnet_readonly.log"
echo "Accounts file: ~/.zcash-app-testnet/accounts.json (outside repo)"
echo "Wallet DB: ~/.zcash-app-testnet/wallet_a.db (outside repo)"
echo "==============================================================="
echo ""

# Ensure SDK is built
pnpm --filter @zcash-app/sdk build >/dev/null

# Execute the testnet runner and tee output to log
node "$SCRIPT_DIR/verify_testnet.mjs" "$@" 2>&1 | tee "$LOG_FILE"

echo ""
echo "=== Verifying zero secret leaks in log via Gitleaks ==="
gitleaks detect --source="$LOG_FILE" --no-git -v || {
  echo "Gitleaks detected secret leak in log file!" >&2
  exit 1
}
echo "Log file clean: zero secrets or mnemonics detected by Gitleaks ✅"
