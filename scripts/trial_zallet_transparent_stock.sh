#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV_BIN="$REPO_ROOT/packages/dev/dist/cli.js"

export ZEBRA_IMAGE="zfnd/zebra:7.1.0"
export LIGHTWALLETD_IMAGE="electriccoinco/lightwalletd:v0.6.2"

echo "=== TRIAL: Zallet Transparent Funds & Spend Detection (Stock Zebra 7.1.0) ==="
echo "Date: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "ZEBRA_IMAGE: $ZEBRA_IMAGE"
echo "LIGHTWALLETD_IMAGE: $LIGHTWALLETD_IMAGE"
echo ""

echo "--- 1. Resetting Full Regtest Chain (wipe) ---"
"$DEV_BIN" regtest wipe --stack full --yes

echo ""
echo "--- 2. Running Container Status & Versions ---"
docker ps --format '{{.Names}} {{.Image}} {{.Ports}}'

echo ""
echo "Zebra version:"
docker run --rm "$ZEBRA_IMAGE" zebrad --version
echo "lightwalletd version:"
docker run --rm "$LIGHTWALLETD_IMAGE" version

echo ""
echo "--- 3. Stock Zebra Indexer Feature & Connectivity Check ---"
echo "Checking TCP connectivity to Zebra indexer port 8230:"
nc -zv 127.0.0.1 8230
echo ""
echo "Zebra startup features from logs:"
docker logs zcash-regtest-full-zebra-1 2>&1 | grep -i "features:" || true

echo ""
echo "--- 4. Running Transparent Funds & Spend Test ---"
node "$REPO_ROOT/scripts/test_zallet_transparent.mjs"

echo ""
echo "=== Trial Complete: Stock Zebra 7.1.0 ==="

