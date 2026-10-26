#!/usr/bin/env bash
set -euo pipefail

# Build the release native addon with deterministic build-path remapping.
# This prevents leaking absolute developer filesystem paths and cargo registry paths
# into the compiled binary strings and symbols.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "=== Building @zcash-app/core (Release) ==="
echo "Repo Root:  ${REPO_ROOT}"
echo "Cargo Home: ${CARGO_HOME:-$HOME/.cargo}"

export RUSTFLAGS="--remap-path-prefix ${REPO_ROOT}=/build --remap-path-prefix ${CARGO_HOME:-$HOME/.cargo}=/cargo"

cd "${REPO_ROOT}/packages/core"
pnpm run build

echo "Release build completed successfully with path remapping."
