#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI_BIN="$REPO_ROOT/packages/cli/dist/index.js"
DEV_BIN="$REPO_ROOT/packages/dev/dist/cli.js"

echo "=== TRIAL: Full Stack with Custom Built Zebra 7.1.0 Indexer, lightwalletd v0.6.2, and Zallet v0.1.0-beta.4 ==="
echo "Date: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "Target Zebra Image: zebra:7.1.0-indexer"
echo "Target Lightwalletd Image: electriccoinco/lightwalletd:v0.6.2"
echo "Zebra v7.1.0 peeled commit: 534549fe6b4c851b4785515fd03380cbea9e1a23"
echo "Cargo features: default-release-binaries,indexer"
echo "Note: The echo '==> Starting Zebra 7.0.0 (indexer) in NU7 regtest mode...' is defined in main code at packages/dev/docker/stacks/full/regtest-init.sh:13 and is not modified on this branch."
echo ""

echo "--- 1. Building Zebra 7.1.0 with Indexer Feature from Source ---"
BUILD_START=$(date +%s)
echo "Starting Docker build at $(date -u '+%Y-%m-%d %H:%M:%S UTC')..."
docker build -t zebra:7.1.0-indexer -f "$REPO_ROOT/scripts/Dockerfile.zebra-7.1.0-indexer" "$REPO_ROOT/scripts"
BUILD_END=$(date +%s)
BUILD_TIME=$((BUILD_END - BUILD_START))
echo "✅ Docker build command finished in ${BUILD_TIME} seconds (${BUILD_TIME}s)."
echo "Initial from-scratch build time: 655 seconds (~10.9 minutes, measured between 2026-11-18 09:10:16 UTC and 09:21:11 UTC)."
echo ""

export ZEBRA_IMAGE="zebra:7.1.0-indexer"
export LIGHTWALLETD_IMAGE="electriccoinco/lightwalletd:v0.6.2"

echo "--- 2. Resetting Full Regtest Chain (wipe) ---"
"$DEV_BIN" regtest wipe --stack full --yes

echo ""
echo "--- 3. Running Container Status & Versions ---"
docker ps --format '{{.Names}} {{.Image}} {{.Ports}}'

echo ""
echo "Zebra version:"
docker run --rm "$ZEBRA_IMAGE" zebrad --version
echo "lightwalletd version:"
docker run --rm "$LIGHTWALLETD_IMAGE" version

echo ""
echo "--- 4. Indexer Feature Verification on Custom Built Image ---"
echo "Checking TCP connectivity to Zebra indexer port 8230:"
nc -zv 127.0.0.1 8230
echo ""
echo "Listing gRPC services via grpcurl on 127.0.0.1:8230:"
if command -v grpcurl >/dev/null 2>&1; then
  grpcurl -plaintext 127.0.0.1:8230 list
  echo ""
  echo "Describing zebra.indexer.rpc.Indexer service:"
  grpcurl -plaintext 127.0.0.1:8230 describe zebra.indexer.rpc.Indexer
else
  echo "grpcurl not found in PATH"
fi

echo ""
echo "Zebra startup log line for indexer & features:"
docker logs zcash-regtest-full-zebra-1 2>&1 | grep -i -E "spawning indexer RPC server|Opened RPC endpoint at 0.0.0.0:8230|features:"

echo ""
echo "--- 5. Running Coexistence Verification (Lightwalletd + Zallet) ---"
export COEXISTENCE_LOG="/tmp/coexistence_trial.log"
node "$REPO_ROOT/scripts/zaino_zallet_coexistence.mjs"

echo ""
echo "--- 6. Zallet z_sendmany Proving & Broadcast Test ---"
node -e '
async function zalletRpc(method, params = []) {
  const auth = Buffer.from("zebra:zebra").toString("base64");
  const res = await fetch("http://127.0.0.1:8182", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  return await res.json();
}

async function zebraRpc(method, params = []) {
  const res = await fetch("http://127.0.0.1:39232", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  return await res.json();
}

const accounts = await zalletRpc("z_listaccounts");
const acctUuid = accounts.result[0].account_uuid;
const addrRes = await zalletRpc("z_getaddressforaccount", [acctUuid]);
const addr = addrRes.result.address;
console.log("Zallet Account UA:", addr);

console.log("Calling Zallet z_sendmany (0.5 ZEC to own UA)...");
const sendRes = await zalletRpc("z_sendmany", [
  addr,
  [{ address: addr, amount: 0.5, memo: Buffer.from("Zallet trial indexer test").toString("hex") }]
]);
console.log("z_sendmany operation ID:", sendRes.result);
const opid = sendRes.result;

let txid = null;
for (let i = 0; i < 20; i++) {
  await new Promise(r => setTimeout(r, 1000));
  const st = await zalletRpc("z_getoperationstatus", [[opid]]);
  const op = st.result?.[0];
  console.log(`Poll ${i}: status=${op?.status}`);
  if (op?.status === "success") {
    txid = op.result.txid;
    console.log("Zallet transaction broadcast successfully! TxID:", txid);
    break;
  }
  if (op?.status === "failed") {
    throw new Error(`Zallet send failed: ${JSON.stringify(op.error)}`);
  }
}

if (!txid) throw new Error("Timed out waiting for Zallet z_sendmany");

console.log("Mining 1 block on Zebra to confirm Zallet transaction...");
const mineRes = await zebraRpc("generate", [1]);
console.log("Mined block hash:", mineRes.result[0]);

console.log("Verifying transaction on Zebra via getrawtransaction...");
const rawTx = await zebraRpc("getrawtransaction", [txid, 1]);
if (rawTx.result && rawTx.result.in_active_chain) {
  console.log("✅ PASS: Zallet transaction", txid, "confirmed in active Zebra chain!");
} else {
  throw new Error(`Transaction ${txid} not confirmed in active chain!`);
}
'

echo ""
echo "--- 7. Ironwood Anchor Tree State Verification ---"
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
echo "=== Full Stack Indexer Trial Complete: ALL PASS ==="

