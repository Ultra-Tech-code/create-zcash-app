#!/usr/bin/env bash
# Standalone Zebra 7.0.0 + Zallet v0.1.0-beta.4 spike execution script.
# Reproduces the NU7 regtest integration spike verified in packages/core/tests/logs/zallet_nu7_spike.log.
# NOTE: This spike is experimental and not wired into the default shipping stack.

set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

IMAGE_ZEBRA="zfnd/zebra:7.0.0"
IMAGE_ZALLET="zodlinc/zallet@sha256:682ba6f9a9931ac25f6a2eb2218f39e0bf5295c3cbe4d8dfa3fc275c34559506"
NETWORK="zallet-spike-net"
VOL_ZEBRA="zallet-spike-zebra-data"
DATA_DIR="/tmp/zallet-spike-run/data"

echo "==> Cleaning up prior spike resources..."
docker rm -f zebra-spike zallet-spike 2>/dev/null || true
docker network rm "$NETWORK" 2>/dev/null || true
docker volume rm "$VOL_ZEBRA" 2>/dev/null || true
rm -rf "$DATA_DIR"
mkdir -p "$DATA_DIR"

echo "==> Creating Docker network and Zebra state volume..."
docker network create "$NETWORK"
docker volume create "$VOL_ZEBRA"

echo "==> Launching Zebra 7.0.0 with indexer gRPC enabled..."
docker run -d --name zebra-spike --network "$NETWORK" \
  -v "$VOL_ZEBRA:/home/zebra/.cache/zebra" \
  -v "$DIR/zebra.toml:/home/zebra/.config/zebrad.toml:ro" \
  -e ZEBRA_NETWORK__NETWORK=Regtest \
  -e ZEBRA_RPC__LISTEN_ADDR=0.0.0.0:18232 \
  -e ZEBRA_RPC__INDEXER_LISTEN_ADDR=0.0.0.0:8230 \
  -e ZEBRA_RPC__ENABLE_COOKIE_AUTH=false \
  -e ZEBRA_HEALTH__LISTEN_ADDR=0.0.0.0:8080 \
  -e ZEBRA_HEALTH__MIN_CONNECTED_PEERS=0 \
  -e ZEBRA_HEALTH__ENFORCE_ON_TEST_NETWORKS=false \
  -e ZEBRA_HEALTH__READY_MAX_BLOCKS_BEHIND=2 \
  -p 127.0.0.1:49232:18232 \
  "$IMAGE_ZEBRA"

echo "==> Waiting for Zebra JSON-RPC to become available..."
until curl -sf -X POST -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"getblockchaininfo","params":[],"id":1}' \
  http://127.0.0.1:49232 > /dev/null 2>&1; do
  sleep 1
done

echo "==> Initializing Zallet keystore and importing miner mnemonic..."
docker run --rm --user 0:0 -v "$DATA_DIR:/data" -v "$DIR/zallet.toml:/etc/zallet/zallet.toml:ro" "$IMAGE_ZALLET" -d /data -c /etc/zallet/zallet.toml generate-encryption-identity
docker run --rm --user 0:0 -v "$DATA_DIR:/data" -v "$DIR/zallet.toml:/etc/zallet/zallet.toml:ro" "$IMAGE_ZALLET" -d /data -c /etc/zallet/zallet.toml init-wallet-encryption
python3 -c "
import pty, os, subprocess
master, slave = pty.openpty()
proc = subprocess.Popen(
    ['docker', 'run', '-i', '-t', '--rm', '--user', '0:0',
     '-v', '$DATA_DIR:/data',
     '-v', '$DIR/zallet.toml:/etc/zallet/zallet.toml:ro',
     '$IMAGE_ZALLET', '-d', '/data', '-c', '/etc/zallet/zallet.toml', 'import-mnemonic'],
    stdin=slave, stdout=slave, stderr=slave, close_fds=True
)
os.close(slave)
os.write(master, b'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about\n\n')
try:
    while os.read(master, 1024): pass
except OSError: pass
proc.wait()
if proc.returncode != 0:
    exit(proc.returncode)
"

echo "==> Launching Zallet v0.1.0-beta.4..."
# Note workarounds:
# 1. --user 0:0 allows reading Zebra's UID 10001 state cache.
# 2. --tmpfs /tmp prevents RocksDB secondary state initialization panics.
docker run -d --name zallet-spike --network "$NETWORK" \
  --user 0:0 \
  --tmpfs /tmp \
  -v "$DATA_DIR:/data" \
  -v "$DIR/zallet.toml:/etc/zallet/zallet.toml:ro" \
  -v "$VOL_ZEBRA:/zebra-cache:ro" \
  -p 127.0.0.1:48232:28232 \
  "$IMAGE_ZALLET" \
  -d /data -c /etc/zallet/zallet.toml start

echo "==> Waiting for Zallet JSON-RPC to become available..."
until curl -sf -u zebra:zebra -X POST -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"getwalletinfo","params":[],"id":1}' \
  http://127.0.0.1:48232 > /dev/null 2>&1; do
  sleep 1
done

echo "==> Initializing Account 0 in Zallet..."
SEEDFP=$(curl -s -u zebra:zebra -X POST -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"getwalletinfo","params":[],"id":1}' \
  http://127.0.0.1:48232 | jq -r '.result.mnemonic_seedfp')
curl -s -u zebra:zebra -X POST -H 'Content-Type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"method\":\"z_getnewaccount\",\"params\":[\"$SEEDFP\"],\"id\":2}" \
  http://127.0.0.1:48232 > /dev/null

echo "==> Mining 110 blocks on Zebra to activate NU7 (height 2)..."
curl -sf -X POST -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"generate","params":[110],"id":2}' \
  http://127.0.0.1:49232 > /dev/null

echo "==> Restarting Zallet so history recovery sync scans blocks for initialized Account 0..."
docker restart zallet-spike > /dev/null
until curl -sf -u zebra:zebra -X POST -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"getwalletinfo","params":[],"id":1}' \
  http://127.0.0.1:48232 > /dev/null 2>&1; do
  sleep 1
done

echo "==> Waiting for Zallet to sync to chain tip (height 110)..."
until curl -s -u zebra:zebra -X POST -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"z_listunspent","params":[],"id":3}' \
  http://127.0.0.1:48232 | jq -e '.result | length > 0' > /dev/null 2>&1; do
  sleep 2
done

echo "==> Testing Zallet RPC endpoints..."
echo "--- z_listunspent ---"
curl -s -u zebra:zebra -X POST -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"z_listunspent","params":[],"id":3}' \
  http://127.0.0.1:48232 | jq .

echo "--- z_listtransactions (demonstrates upstream InvalidUtf8 issue) ---"
curl -s -u zebra:zebra -X POST -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"z_listtransactions","params":[],"id":4}' \
  http://127.0.0.1:48232 | jq .

echo "==> Spike complete! To clean up, run: docker rm -f zebra-spike zallet-spike && docker network rm $NETWORK && docker volume rm $VOL_ZEBRA && rm -rf $DATA_DIR"

