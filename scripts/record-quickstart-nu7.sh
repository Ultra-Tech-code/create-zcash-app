#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI_BIN="$REPO_ROOT/packages/cli/dist/index.js"
DEV_BIN="$REPO_ROOT/packages/dev/dist/cli.js"

WORK_DIR=$(mktemp -d -t cza-quickstart-XXXXXX)
trap 'rm -rf "$WORK_DIR"' EXIT

echo "=== Docker Status ==="
docker ps --format '{{.Names}} {{.Image}} {{.Ports}}'

echo ""
echo "=== Step 1: Scaffold Application ==="
cd "$WORK_DIR"
node "$CLI_BIN" my-shielded-app --network regtest --regtest-stack nu7 --key-source generate --docker-compose

cd my-shielded-app

echo ""
echo "=== Step 2: Configured Account Address ==="
node "$DEV_BIN" address

UA=$(node "$DEV_BIN" address | grep 'Unified Address:' | head -n1 | awk '{print $3}')

echo ""
echo "=== Step 3: Initial Balance Before Funding ==="
node "$DEV_BIN" balance

echo ""
echo "=== Step 4: Fund Account from Miner ==="
node "$DEV_BIN" fund "$UA" 5.0

echo ""
echo "=== Step 5: Mine Block ==="
node "$DEV_BIN" mine 1

echo ""
echo "=== Step 6: Account Balance After Funding ==="
node "$DEV_BIN" balance

echo ""
echo "=== Step 7: Transaction Dry Run ==="
node "$DEV_BIN" send --to "$UA" --amount 0.1 --memo "Coffee payment"

echo ""
echo "=== Step 8: Broadcast Transaction ==="
node "$DEV_BIN" send --to "$UA" --amount 0.1 --memo "Coffee payment" --yes

echo ""
echo "=== Step 9: Mine Block to Confirm ==="
node "$DEV_BIN" mine 1

echo ""
echo "=== Step 10: Account Balance After Send ==="
node "$DEV_BIN" balance

