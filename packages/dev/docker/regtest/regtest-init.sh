#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

chmod 644 zallet.toml zebra.toml zaino.toml

COMPOSE="docker compose --env-file .env.regtest"

$COMPOSE down -v --remove-orphans 2>/dev/null || true

echo "==> Starting Zebra in regtest mode..."
$COMPOSE up -d zebra

echo "==> Waiting for Zebra RPC to be ready..."
until curl -sf -X POST \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"getblockchaininfo","params":[],"id":1}' \
    "http://127.0.0.1:29232" > /dev/null 2>&1; do
  echo "   Zebra not ready yet, retrying..."
  sleep 2
done
echo "   Zebra is ready."

echo "==> Mining 2 blocks to activate NU6.3 at height 2..."
curl -s \
    -X POST -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"generate","params":[2],"id":1}' \
    "http://127.0.0.1:29232" | grep -q '"result"'
echo "   Blocks mined."

echo "==> Preparing Zallet data volume..."
docker run --rm -v "z3-regtest_zallet:/data" busybox \
    sh -c 'touch /data/.z3-volume-initialized && chown 1000:1000 /data /data/.z3-volume-initialized && rm -f /data/.lock'

echo "==> Initializing Zallet keystore..."
$COMPOSE run --rm --no-deps zallet --datadir /var/lib/zallet --config /etc/zallet/zallet.toml generate-encryption-identity
$COMPOSE run --rm zallet --datadir /var/lib/zallet --config /etc/zallet/zallet.toml init-wallet-encryption
$COMPOSE run --rm zallet --datadir /var/lib/zallet --config /etc/zallet/zallet.toml generate-mnemonic

echo "==> Stopping Zebra (will restart cleanly with full stack)..."
$COMPOSE down

echo "==> Starting full regtest stack (zebra, cookie-permissions, zallet, rpc-router, zaino)..."
$COMPOSE up -d

echo "==> Regtest stack initialized successfully."
