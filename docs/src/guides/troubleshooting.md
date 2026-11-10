# Troubleshooting Guide

This guide details common failure modes encountered during development, diagnostics, and step-by-step solutions based on real test scenarios.

---

## 1. Regtest Startup Race Condition

### Symptom
Running `zcash-dev regtest up --stack nu7` previously failed during initialization with an unhandled Node error or exit code 1 at:
```text
Mining 2 initial blocks to activate NU7 at height 2...
```

### Cause
When the Docker container starts, Zebra takes several seconds to initialize its internal database and open its JSON-RPC listener on port `39232` (or `18232`). In earlier releases, `regtest-init.sh` ran `curl -s ... generate ... | grep -q '"result"'` once immediately after `getblockchaininfo` first responded. Because shell scripts execute with `set -euo pipefail`, if Zebra was still warming up its miner state, `curl` returned an empty or error response, the pipe failed, and Zebra's actual error message was discarded.

### Solution
1. **Automatic Retry Loop**: `regtest-init.sh` now loops with a 60-second retry loop (polling every 2 seconds). It captures the response into a variable and asserts that the response contains `"result"` and no `"error"`.
2. **Diagnostics on Failure**: If the command times out, it prints the last response body and the last 20 lines of `docker compose logs zebra`.
3. **Clean CLI Handling**: In [`packages/dev/src/cli.ts`](https://github.com/Ultra-Tech-code/create-zcash-app/blob/main/packages/dev/src/cli.ts), when `execSync` of the init script fails, it prints a clean error message (`regtest-init.sh failed, see output above`) and exits with code 1 without a confusing stack trace.

---

## 2. "Cannot find native binding" Error

### Symptom
When running application code or documentation scripts, Node terminates with:
```text
Error: Cannot find native binding
    at Object.<anonymous> (.../packages/core/index.js:...)
```

### Cause
`@zcash-app/core` uses [NAPI-RS](https://napi.rs/) to bind Rust cryptographic primitives (Halo 2 prover, ZIP 32 derivation, note decryption, V6 Ironwood transaction builder) to Node.js. Node requires a compiled `.node` platform addon binary (e.g. `index.darwin-arm64.node` or `index.linux-x64-gnu.node`). When checking out a fresh git clone or running CI jobs without pre-built native artifacts, the native addon is absent.

### Solution
- **Compile the Core Addon**: Run the native build script (requires a Rust toolchain):
  ```bash
  pnpm --filter @zcash-app/core run build
  ```
- **Documentation & Analysis Tooling**: For environments without Rust (such as documentation build jobs in CI), [`scripts/docs-gen.mjs`](https://github.com/Ultra-Tech-code/create-zcash-app/blob/main/scripts/docs-gen.mjs) installs an in-memory stub (`installNativeCoreStub()`) via `Module._load` before requiring CLI dist files. This allows command-tree extraction to run cleanly without compiling native binaries.

---

## 3. Zaino/Zallet vs. NU7 Invalid Consensus Branch ID

### Symptom
Transactions constructed for NU7 or Ironwood fail when broadcast to the Z3 regtest stack with:
```text
Error: Invalid consensus branch ID: expected 0xc2d6d0b4 (NU6), got 0x77190ad9 (NU7)
```

### Cause
Legacy Z3 regtest stacks configured for Network Upgrade 6 (NU6 / NU6.3) have been removed in 0.1.0-alpha.5. All active regtest tiers now follow the canonical NU7 consensus branch ID (`0x77190ad9`) activating at block 2.

### Solution
- **Use the Default Lightwalletd Stack**: Run `zcash-dev regtest up --stack lightwalletd`, which runs Zebra 7.0.0 + Lightwalletd with NU7 active at block 2.
- **Fund Accounts via CLI**: Use `zcash-dev fund <address>` (which builds and mines transactions directly using the TypeScript SDK miner send pipeline).
- **Consult Known Issues**: See [known-issues.md](../known-issues.md) for a full matrix of stack compatibility.
- **Upgrader Instructions**: When upgrading from older alpha releases, run `zcash-dev regtest wipe --yes` and delete old regtest SQLite wallet databases (e.g. `~/.zcash-app/dashboard/` or project cache directories) because stacks, ports, volumes, and chain state changed. While `@zcash-app/core` automatically normalizes legacy `'regtest-nu7'` network metadata to `'regtest'`, old chain blocks cannot be reused.

---

## 4. Connection Refused on Regtest Endpoints (39067 vs. 38137)

### Symptom
CLI commands or SDK clients fail with `ECONNREFUSED` or:
```text
14 UNAVAILABLE: No connection established to 127.0.0.1:39067
```

### Cause
The regtest tiers use specific gRPC and JSON-RPC port mappings:

| Stack Tier | Service | Port | Endpoint String |
| :--- | :--- | :--- | :--- |
| **Tier 1: Lightwalletd** (`--stack lightwalletd`) | lightwalletd (gRPC) | `39067` | `127.0.0.1:39067` |
| **Tier 1: Lightwalletd** (`--stack lightwalletd`) | Zebra RPC (JSON-RPC) | `39232` | `http://127.0.0.1:39232` |
| **Tier 2: Zaino** (`--stack zaino`) | Zaino (gRPC) | `38137` | `127.0.0.1:38137` |
| **Tier 2: Zaino** (`--stack zaino`) | Zebra RPC (JSON-RPC) | `39232` | `http://127.0.0.1:39232` |
| **Tier 3: Full Stack** (`--stack full`) | lightwalletd (gRPC) | `39067` | `127.0.0.1:39067` |
| **Tier 3: Full Stack** (`--stack full`) | Zallet (JSON-RPC) | `8182` | `http://127.0.0.1:8182` |
| **Tier 3: Full Stack** (`--stack full`) | Zebra RPC (JSON-RPC) | `39232` | `http://127.0.0.1:39232` |

Connecting to port `39067` while running the Zaino stack (on `38137`) results in a connection refusal.
Remember: only one regtest stack can run at a time due to shared port `39232`.

### Solution
Ensure the target stack is running, and configure `.env.local` appropriately:
```bash
# For Tier 1 (Lightwalletd) & Tier 3 (Full Stack):
ZCASH_ENDPOINT=127.0.0.1:39067
ZCASH_ZEBRA_RPC=http://127.0.0.1:39232

# For Tier 2 (Zaino):
ZCASH_ENDPOINT=127.0.0.1:38137
ZCASH_ZEBRA_RPC=http://127.0.0.1:39232
```

---

## 5. Zebra RPC Cookie Authentication on Testnet

### Symptom
When connecting to a local testnet Zebra node, JSON-RPC queries fail with HTTP status `401 Unauthorized`.

### Cause
By default, Zebra automatically enables cookie authentication on testnet and mainnet, generating a random credential file (`.cookie`) on startup containing `username:password`. Unauthenticated HTTP requests are rejected.

### Solution
- **Cookie Location**:
  - macOS: `~/Library/Caches/zebra/.cookie`
  - Linux: `~/.cache/zebra/.cookie`
- **Configure Cookie Path**: Set `ZCASH_ZEBRA_COOKIE_PATH` or use `--cookie-path` when starting helper services:
  ```bash
  zcash-dev testnet lightwalletd --cookie-path ~/Library/Caches/zebra/.cookie
  ```
- **Dashboard Support**: The dashboard automatically inspects standard cookie cache paths via [`packages/dashboard/src/app/api/explorer/backend.ts`](https://github.com/Ultra-Tech-code/create-zcash-app/blob/main/packages/dashboard/src/app/api/explorer/backend.ts) (`parseZebraCookie`), authenticating requests automatically.

---

## 6. Docker Daemon Not Running

### Symptom
Running `zcash-dev regtest up` fails with:
```text
failed to connect to the docker API at unix:///var/run/docker.sock: connect: no such file or directory
```

### Cause
The local Docker daemon (Docker Desktop or OrbStack) is stopped or the active docker context is misconfigured.

### Solution
1. Start your container runtime:
   - OrbStack: `orbctl start`
   - Docker Desktop: `open -a Docker`
2. Verify Docker is responding:
   ```bash
   docker ps
   ```
3. Re-run `zcash-dev regtest up --stack nu7`.

---

## 7. Coinbase Maturity (100-Block Confirmation Rule)

### Symptom
Attempting to spend newly mined coinbase funds on regtest fails with:
```text
Error: Premature coinbase spend: coinbase transaction outputs require 100 confirmations before they become spendable
```

### Cause
In Zcash consensus rules, coinbase transactions (blocks mined by proof-of-work) cannot be spent until they have matured with at least 100 confirmations. This prevents chain reorganizations from invalidating spent block rewards.

### Solution
- Mine at least 100 confirmation blocks after generating funds:
  ```bash
  zcash-dev mine 100
  ```
- The `zcash-dev fund` command automatically handles coinbase maturity and note shielding behind the scenes.

---

## 8. Endpoint Format Errors

### Symptom
SDK or CLI operations fail with:
```text
Error: Invalid endpoint format: expected "host:port", received "http://127.0.0.1:39067"
```

### Cause
gRPC clients in `@zcash-app/sdk` use HTTP/2 transport and expect bare `host:port` string representations (e.g. `127.0.0.1:39067` or `testnet.zec.rocks:443`). Prepending URL schemes (such as `http://` or `https://`) or omitting the port will cause socket resolution errors.

### Solution
- **gRPC Endpoints**: Always supply `host:port` without protocol schemes (e.g. `ZCASH_ENDPOINT=127.0.0.1:39067`).
- **JSON-RPC Endpoints**: Consist of full HTTP URLs (e.g. `ZCASH_ZEBRA_RPC=http://127.0.0.1:39232`).
- **Dashboard Allowlist**: The dashboard rejects non-standard endpoints unless `ZCASH_ALLOW_CUSTOM_ENDPOINT=1` is exported in the server environment.
