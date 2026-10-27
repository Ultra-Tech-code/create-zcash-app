#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

chmod 644 zebra.toml 2>/dev/null || true

COMPOSE="docker compose"

echo "==> Cleaning up previous containers and volumes..."
$COMPOSE down -v --remove-orphans 2>/dev/null || true

echo "==> Starting Zebra 7.0.0 in NU7 regtest mode..."
$COMPOSE up -d zebra

ZEBRA_PORT="${ZEBRA_RPC_PORT:-39232}"
echo "==> Waiting for Zebra RPC on port ${ZEBRA_PORT}..."
until curl -sf -X POST \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"getblockchaininfo","params":[],"id":1}' \
    "http://127.0.0.1:${ZEBRA_PORT}" > /dev/null 2>&1; do
  echo "   Zebra not ready yet, retrying..."
  sleep 2
done
echo "   Zebra is ready."

echo "==> Mining 2 initial blocks to activate NU7 at height 2..."
curl -s \
    -X POST -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"generate","params":[2],"id":1}' \
    "http://127.0.0.1:${ZEBRA_PORT}" | grep -q '"result"'
echo "   Blocks mined. NU7 is now active."

echo "==> Starting lightwalletd service..."
$COMPOSE up -d lightwalletd

LIGHTD_PORT="${LIGHTWALLETD_GRPC_PORT:-39067}"
echo "==> Waiting for lightwalletd on port ${LIGHTD_PORT}..."
for i in $(seq 1 30); do
  if nc -z 127.0.0.1 "${LIGHTD_PORT}" 2>/dev/null || curl -sf "http://127.0.0.1:${LIGHTWALLETD_HTTP_PORT:-39068}" >/dev/null 2>&1; then
    echo "   lightwalletd is reachable."
    break
  fi
  sleep 1
done

echo "==> NU7 Regtest stack initialized successfully."
