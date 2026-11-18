#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

CLI="node $REPO_ROOT/packages/dev/dist/cli.js"
UA="uregtest1cjtspq0p660zrmhwn8uhzugwpxwyxh3g0yznk885y808v34flmv4fzvdrx5ztsk480lrfkzmx7v0hlhttvtqhdyvc9wwq2qtk84nq20qr3qxtpmcy3tmk6365ey3e5hc48zq3g6spcqlx28j9xzq4lkmhl8d2zt99svv8vtdm9qx3lgn69xjpgwpp605tqffvaygl9kzhcc8ckt306k"

run_lightwalletd() {
  local LOG_FILE="$REPO_ROOT/packages/core/tests/logs/pins_lightwalletd_defaults.log"
  echo "=== Running Lightwalletd Stack Verification (Defaults) ==="
  {
    echo "=== PINS VERIFICATION: LIGHTWALLETD STACK (NEW DEFAULTS) ==="
    echo "Date: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    echo "Platform: $(uname -s) $(uname -m)"
    echo "Defaults: Zebra zfnd/zebra:7.1.0, lightwalletd electriccoinco/lightwalletd:v0.6.2"
    echo ""

    echo "--- 1. Wiping previous regtest state ---"
    $CLI regtest wipe --stack lightwalletd --yes

    echo ""
    echo "--- 2. Starting Lightwalletd stack with defaults ---"
    $CLI regtest up --stack lightwalletd

    echo ""
    echo "--- 3. Container status & images ---"
    docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"

    echo ""
    echo "--- 4. Indexer Info (GetLightdInfo) ---"
    $CLI info -e 127.0.0.1:39067

    echo ""
    echo "--- 5. Configured Account Address ---"
    $CLI address

    echo ""
    echo "--- 6. Fund Account 0 (1.0 ZEC) ---"
    $CLI fund "$UA" 1.0 --stack lightwalletd

    echo ""
    echo "--- 7. Mine 1 block to confirm funding ---"
    $CLI mine 1

    echo ""
    echo "--- 8. Check balance after funding ---"
    $CLI balance -e 127.0.0.1:39067

    echo ""
    echo "--- 9. Send 0.5 ZEC from Account 0 to own UA ---"
    $CLI send --to "$UA" --amount 0.5 --yes -e 127.0.0.1:39067

    echo ""
    echo "--- 10. Mine 1 block to confirm send ---"
    $CLI mine 1

    echo ""
    echo "--- 11. Check balance after send ---"
    $CLI balance -e 127.0.0.1:39067

    echo ""
    echo "--- 12. Teardown ---"
    docker compose -f "$REPO_ROOT/packages/dev/docker/stacks/lightwalletd/docker-compose.yml" down -v
    echo "Lightwalletd stack verification complete."
  } 2>&1 | tee "$LOG_FILE"
}

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

run_zaino() {
  local LOG_FILE="$REPO_ROOT/packages/core/tests/logs/pins_zaino_defaults.log"
  echo "=== Running Zaino Stack Verification (Defaults) ==="
  {
    echo "=== PINS VERIFICATION: ZAINO STACK (NEW DEFAULTS) ==="
    echo "Date: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    echo "Platform: $(uname -s) $(uname -m)"
    echo "Defaults: Zebra zfnd/zebra:7.1.0, Zaino feat/nu7 (pin aaf8122a)"
    echo ""

    echo "--- 1. Wiping previous regtest state ---"
    $CLI regtest wipe --stack zaino --yes

    echo ""
    echo "--- 2. Starting Zaino stack with defaults ---"
    $CLI regtest up --stack zaino
    wait_for_zaino_sync

    echo ""
    echo "--- 3. Container status & images ---"
    docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"

    echo ""
    echo "--- 4. Indexer Info (GetLightdInfo) ---"
    $CLI info -e 127.0.0.1:38137

    echo ""
    echo "--- 5. Configured Account Address ---"
    $CLI address

    echo ""
    echo "--- 6. Fund Account 0 (1.0 ZEC) ---"
    $CLI fund "$UA" 1.0 --stack zaino

    echo ""
    echo "--- 7. Mine 1 block to confirm funding ---"
    $CLI mine 1
    wait_for_zaino_sync

    echo ""
    echo "--- 8. Check balance after funding ---"
    $CLI balance -e 127.0.0.1:38137

    echo ""
    echo "--- 9. Send 0.5 ZEC from Account 0 to own UA ---"
    $CLI send --to "$UA" --amount 0.5 --yes -e 127.0.0.1:38137

    echo ""
    echo "--- 10. Mine 1 block to confirm send ---"
    $CLI mine 1
    wait_for_zaino_sync

    echo ""
    echo "--- 11. Check balance after send ---"
    $CLI balance -e 127.0.0.1:38137

    echo ""
    echo "--- 12. Teardown ---"
    docker compose -f "$REPO_ROOT/packages/dev/docker/stacks/zaino/docker-compose.yml" down -v
    echo "Zaino stack verification complete."
  } 2>&1 | tee "$LOG_FILE"
}

run_full() {
  local LOG_FILE="$REPO_ROOT/packages/core/tests/logs/pins_full_defaults.log"
  echo "=== Running Full Stack Verification (Defaults) ==="
  {
    echo "=== PINS VERIFICATION: FULL STACK (NEW DEFAULTS) ==="
    echo "Date: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    echo "Platform: $(uname -s) $(uname -m)"
    echo "Defaults: Zebra zfnd/zebra:7.1.0, lightwalletd electriccoinco/lightwalletd:v0.6.2, Zallet v0.1.0-beta.4"
    echo ""

    echo "--- 1. Wiping previous regtest state ---"
    $CLI regtest wipe --stack full --yes

    echo ""
    echo "--- 2. Starting Full stack with defaults ---"
    $CLI regtest up --stack full

    echo ""
    echo "--- 3. Container status & images ---"
    docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"

    echo ""
    echo "--- 4. Indexer Info (GetLightdInfo) ---"
    $CLI info -e 127.0.0.1:39067

    echo ""
    echo "--- 5. Configured Account Address ---"
    $CLI address

    echo ""
    echo "--- 6. Fund Account 0 (1.0 ZEC) ---"
    $CLI fund "$UA" 1.0 --stack full

    echo ""
    echo "--- 7. Mine 1 block to confirm funding ---"
    $CLI mine 1

    echo ""
    echo "--- 8. Check balance after funding ---"
    $CLI balance -e 127.0.0.1:39067

    echo ""
    echo "--- 9. Send 0.5 ZEC from Account 0 to own UA ---"
    $CLI send --to "$UA" --amount 0.5 --yes -e 127.0.0.1:39067

    echo ""
    echo "--- 10. Mine 1 block to confirm send ---"
    $CLI mine 1

    echo ""
    echo "--- 11. Check balance after send ---"
    $CLI balance -e 127.0.0.1:39067

    echo ""
    echo "--- 12. Zallet Verification: z_listunspent + z_sendmany ---"
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

    console.log("Checking Zallet z_listunspent...");
    const unspent = await zalletRpc("z_listunspent");
    console.log("Zallet unspent notes count:", unspent.result?.length ?? 0);
    for (const note of (unspent.result || []).slice(0, 3)) {
      console.log(`  Note: pool=${note.pool} value=${note.value} txid=${note.txid}`);
    }

    const accounts = await zalletRpc("z_listaccounts");
    const acctUuid = accounts.result[0].account_uuid;
    const addrRes = await zalletRpc("z_getaddressforaccount", [acctUuid]);
    const addr = addrRes.result.address;
    console.log("Zallet Account UA:", addr);

    console.log("Executing Zallet z_sendmany (0.25 ZEC)...");
    const sendRes = await zalletRpc("z_sendmany", [
      addr,
      [{ address: addr, amount: 0.25, memo: Buffer.from("Zallet defaults verification").toString("hex") }]
    ]);
    console.log("z_sendmany operation ID:", sendRes.result);
    const opid = sendRes.result;

    let txid = null;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const st = await zalletRpc("z_getoperationstatus", [[opid]]);
      const op = st.result?.[0];
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

    console.log("Verifying transaction in active chain on Zebra...");
    const rawTx = await zebraRpc("getrawtransaction", [txid, 1]);
    if (rawTx.result && rawTx.result.in_active_chain) {
      console.log("✅ PASS: Zallet transaction confirmed in active Zebra chain!");
      console.log("Tx details: txid=" + txid + " height=" + rawTx.result.height);
    } else {
      throw new Error(`Transaction ${txid} not confirmed in active chain!`);
    }
    '

    echo ""
    echo "--- 13. Teardown ---"
    docker compose -f "$REPO_ROOT/packages/dev/docker/stacks/full/docker-compose.yml" down -v
    echo "Full stack verification complete."
  } 2>&1 | tee "$LOG_FILE"
}

case "${1:-all}" in
  lightwalletd)
    run_lightwalletd
    ;;
  zaino)
    run_zaino
    ;;
  full)
    run_full
    ;;
  all)
    run_lightwalletd
    run_zaino
    run_full
    ;;
  *)
    echo "Usage: $0 [lightwalletd|zaino|full|all]"
    exit 1
    ;;
esac

