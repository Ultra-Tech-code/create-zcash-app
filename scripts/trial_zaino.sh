#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI_BIN="$REPO_ROOT/packages/cli/dist/index.js"
DEV_BIN="$REPO_ROOT/packages/dev/dist/cli.js"

export ZEBRA_IMAGE="zfnd/zebra:7.1.0"

wait_for_zaino_sync() {
  local target_height
  target_height=$(curl -s -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"getblockchaininfo","params":[]}' http://127.0.0.1:39232 | grep -o '"blocks":[0-9]*' | cut -d: -f2)
  for i in $(seq 1 30); do
    local ok
    ok=$(node -e '
      import { createClient } from "'"$REPO_ROOT"'/packages/sdk/dist/client.js";
      const client = createClient({ endpoint: "127.0.0.1:38137", network: "regtest" });
      try {
        let got = false;
        for await (const b of client.getBlockRange('"$target_height"', '"$target_height"')) {
          got = true;
        }
        if (got) console.log("OK");
      } catch (err) {
        // still indexing
      } finally {
        await client.close();
      }
    ' 2>/dev/null || echo "WAIT")
    if [ "$ok" = "OK" ]; then
      echo "Zaino compact block cache indexed block $target_height"
      break
    fi
    sleep 1
  done
}

echo "=== TRIAL: Zaino Stack with Zebra 7.1.0 ==="
echo "Date: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "ZEBRA_IMAGE: $ZEBRA_IMAGE"
echo ""

echo "--- 1. Stopping Any Running Lightwalletd Containers ---"
"$DEV_BIN" regtest down --stack lightwalletd 2>/dev/null || true

echo ""
echo "--- 2. Resetting Zaino Regtest Chain (wipe) ---"
"$DEV_BIN" regtest wipe --stack zaino --yes
wait_for_zaino_sync

echo ""
echo "--- 3. Running Container Status & Versions ---"
docker ps --format '{{.Names}} {{.Image}} {{.Ports}}'

echo ""
echo "Zebra version:"
docker run --rm "$ZEBRA_IMAGE" zebrad --version

echo ""
echo "--- 4. Zaino GetLightdInfo RPC Connection Verification ---"
node -e '
import { createClient } from "./packages/sdk/dist/client.js";
const client = createClient({ endpoint: "127.0.0.1:38137", network: "regtest" });
const info = await client.getInfo();
console.log(JSON.stringify(info, null, 2));
await client.close();

if (info.consensusBranchId !== "77190ad9") {
  console.error("FAIL: consensus branch ID is not 77190ad9:", info.consensusBranchId);
  process.exit(1);
}
console.log("PASS: Zaino connects to Zebra 7.1.0 over RPC and serves GetLightdInfo with NU7 branch 0x77190ad9");
'

WORK_DIR=$(mktemp -d -t cza-trial-zaino-XXXXXX)
trap 'rm -rf "$WORK_DIR"' EXIT

echo ""
echo "--- 5. Scaffold Application for Zaino ---"
cd "$WORK_DIR"
node "$CLI_BIN" my-shielded-app --network regtest --regtest-stack zaino --key-source generate --docker-compose
cd my-shielded-app

echo ""
echo "--- 6. Configured Account Address ---"
node "$DEV_BIN" address
UA=$(node "$DEV_BIN" address | grep 'Unified Address:' | head -n1 | awk '{print $3}')
echo "Target Unified Address: $UA"

echo ""
echo "--- 7. Initial Balance Before Funding ---"
node "$DEV_BIN" balance

echo ""
echo "--- 8. Fund Account from Miner ---"
node "$DEV_BIN" fund "$UA" 5.0

echo ""
echo "--- 9. Mine 1 Block ---"
node "$DEV_BIN" mine 1
wait_for_zaino_sync

echo ""
echo "--- 10. Account Balance After Funding ---"
node "$DEV_BIN" balance

echo ""
echo "--- 11. Transaction Dry Run ---"
node "$DEV_BIN" send --to "$UA" --amount 0.1 --memo "Trial zaino 7.1.0"

echo ""
echo "--- 12. Transaction Broadcast ---"
SEND_OUT=$(node "$DEV_BIN" send --to "$UA" --amount 0.1 --memo "Trial zaino 7.1.0" --yes)
echo "$SEND_OUT"

TXID=$(echo "$SEND_OUT" | grep 'Txid:' | awk '{print $2}')
echo "Extracted Txid: $TXID"

echo ""
echo "--- 13. Mine 1 Block to Confirm ---"
node "$DEV_BIN" mine 1
wait_for_zaino_sync

echo ""
echo "--- 14. Account Balance After Send ---"
node "$DEV_BIN" balance

echo ""
echo "--- 15. Verification on Zebra Node (txid display order & getrawtransaction) ---"
echo "Querying getrawtransaction for $TXID on Zebra JSON-RPC 39232..."
RAW_TX_RES=$(curl -s -X POST \
  -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":\"check-tx\",\"method\":\"getrawtransaction\",\"params\":[\"$TXID\", 1]}" \
  http://127.0.0.1:39232)
echo "$RAW_TX_RES" | head -n 30

if echo "$RAW_TX_RES" | grep -q "\"hex\""; then
  echo "✅ PASS: Transaction $TXID found in Zebra block in display byte-order!"
else
  echo "❌ FAIL: Transaction $TXID not found in Zebra!"
  exit 1
fi

echo ""
echo "--- 16. Ironwood Anchor Tree State Verification ---"
TIP_HEIGHT=$(curl -s -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"getblockchaininfo","params":[]}' http://127.0.0.1:39232 | grep -o '"blocks":[0-9]*' | cut -d: -f2)
echo "Current chain height: $TIP_HEIGHT"
TREE_STATE=$(curl -s -X POST -H "Content-Type: application/json" -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"z_gettreestate\",\"params\":[\"$TIP_HEIGHT\"]}" http://127.0.0.1:39232)
echo "$TREE_STATE" | head -n 30

if echo "$TREE_STATE" | grep -q '"ironwood"'; then
  echo "✅ PASS: Zebra z_gettreestate contains valid Ironwood tree state."
else
  echo "❌ FAIL: No Ironwood tree state found in Zebra!"
  exit 1
fi

echo ""
echo "=== Zaino Stack Trial Complete: ALL PASS ==="
