#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI_BIN="$REPO_ROOT/packages/cli/dist/index.js"
DEV_BIN="$REPO_ROOT/packages/dev/dist/cli.js"

export ZEBRA_IMAGE="zfnd/zebra:7.1.0"
export LIGHTWALLETD_IMAGE="electriccoinco/lightwalletd:v0.6.2"

echo "=== TRIAL: Full Stack with Zebra 7.1.0, lightwalletd v0.6.2, and Zallet v0.1.0-beta.4 ==="
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
echo "--- 3. Running Coexistence Verification (Lightwalletd + Zallet) ---"
export COEXISTENCE_LOG="/tmp/coexistence_trial.log"
node "$REPO_ROOT/scripts/zaino_zallet_coexistence.mjs"

echo ""
echo "--- 4. Zallet z_sendmany Proving & Broadcast Test ---"
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
  [{ address: addr, amount: 0.5, memo: Buffer.from("Zallet trial test").toString("hex") }]
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
echo "--- 5. Ironwood Anchor Tree State Verification ---"
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
echo "=== Full Stack Trial Complete: ALL PASS ==="

