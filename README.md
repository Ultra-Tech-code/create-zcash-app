# create-zcash-app

A scaffolder, TypeScript SDK, Rust crypto core, and developer dashboard for building shielded Zcash applications on the **Z3** stack (**Zebra** + **Zaino** + **Zallet**).

Covers both the **Orchard** and post-NU6.3 **Ironwood** pools with deterministic key derivation, compact action trial-decryption, and local regtest developer tooling.

---

## Architecture & Monorepo Overview

This repository is structured as a pnpm + Cargo monorepo:

```
zcash_scafolder/
├── packages/
│   ├── core/         # @zcash-app/core: Rust crypto core (napi-rs native addon)
│   ├── sdk/          # @zcash-app/sdk: TypeScript public SDK & gRPC client
│   ├── dev/          # zcash-dev: Regtest helper CLI (info, mine, fund, fixtures)
│   ├── dashboard/    # @zcash-app/dashboard: Next.js dev dashboard (App Router)
│   └── cli/          # create-zcash-app: Interactive project scaffolder CLI
├── templates/
│   └── nextjs-fullstack/
├── pnpm-workspace.yaml
├── package.json
└── Cargo.toml
```

---

## Core Packages

### 1. `@zcash-app/core` (Rust Crypto Core)
- Built with `napi-rs` to provide native Node.js bindings.
- Pinned to the **NU6.3** cohort (`orchard` 0.15, `zcash_keys` 0.16, `zcash_address` 0.13, `zcash_protocol` 0.10).
- **Features**:
  - `deriveAccountFromMnemonic`: Derives Unified Address (`uregtest1...`, `utest1...`) and UFVK (`uviewregtest1...`).
  - `getAddressFromUfvk`: Derives default and diversified addresses.
  - `tryDecryptAction`: Scans both Orchard actions and NU6.3 quantum-recoverable `ironwoodActions` (lead byte `0x03`).
  - Spending authority is held as an opaque `spendHandle` Rust-side and is never serialized to JavaScript.

### 2. `@zcash-app/sdk` (TypeScript SDK)
- Standard client factory and high-level Zcash payment APIs:
  - `createClient({ endpoint, network })`: Connects directly to Zaino gRPC (`CompactTxStreamer`).
  - `accountFromMnemonic(mnemonic, accountIndex?, network?)`: Deterministic account management.
  - `detectIncoming(client, key, opts?)`: Scans compact blocks for incoming notes across both Orchard and Ironwood pools.
  - `getBalance(client, key)`: Computes balances strictly in `bigint` zatoshis (never floating-point ZEC).
  - `buildPaymentRequest` & `parsePaymentRequest`: Full ZIP-321 URI support.
  - `dev.fixtures`, `dev.mine`, `dev.fund`, and `testkit.withRegtest()`.

### 3. `zcash-dev` (CLI Tooling)
Convenience CLI for working with a local Z3 regtest stack:
```bash
# View Zaino and Zebra node status
zcash-dev info

# Display deterministic fixture accounts (safe for testing)
zcash-dev fixtures

# Mine blocks on demand
zcash-dev mine 1

# Fund a Unified Address with regtest ZEC (requires Zallet funded account or miner address assignment)
zcash-dev fund <UNIFIED_ADDRESS> 1.0
```

> [!NOTE]
> `zcash-dev mine` generates coinbase rewards via Zebra. Note that `zcash-dev fund` (via `z_sendmany`) requires 100 blocks of coinbase maturity and an active Zallet account with spendable balance.


### 4. `@zcash-app/dashboard` (Developer Dashboard)
A glassmorphic Next.js App Router UI providing real-time visibility into your local Zcash stack:
- **Overview**: Live total balance and per-pool breakdown (Ironwood vs. Orchard).
- **Addresses**: Unified Address (ZIP-316), diversified addresses, and view-only UFVK with copy buttons.
- **Transactions**: Live list of incoming notes detected by trial-decryption.
- **Faucet / Fund**: Instant funding and block generation triggers.
- **Health / Logs**: Zaino gRPC connection status, version pin verification (≥ 0.10.0), and active network upgrade (`NU6.3`).

### 5. `create-zcash-app` (Scaffolder CLI)
Scaffold new shielded applications with guided network and indexer configuration:
```bash
npx create-zcash-app my-shielded-app
```

**Interactive Prompts**:
1. **Network**: `regtest` (instant local chain & faucet), `testnet` (staging with TAZ), or `mainnet` (production).
2. **Connection Mode** (for testnet/mainnet):
   - 🌐 **Remote Public RPC** (e.g. `zcash-testnet.zec.rocks:443`) — Zero-install, no node required.
   - 🐳 **Local Z3 Node** (`127.0.0.1:8137`) — Self-hosted privacy stack (generates `docker-compose.yml`).

### 6. Network Switcher CLI (`zcash-dev switch`)
Switch an existing project between networks at any time:
```bash
# Interactive selection
npx zcash-dev switch

# Or switch directly
npx zcash-dev switch testnet --remote
npx zcash-dev switch mainnet --remote
npx zcash-dev switch regtest
```
Automatically updates `.env.local` and `zcash.config.json`. The developer dashboard instantly hot-reloads and reflects the new network!

---

## Prerequisites

1. **Rust / Cargo**: `1.85+` (verified with `cargo 1.95.0`).
2. **Node.js**: `v20+` (verified with `v22.22.2`).
3. **pnpm**: `v9+` or `v11+` (`corepack enable`).
4. **Node & Indexer (Optional for Remote Mode)**:
   - **Remote Mode (testnet / mainnet)**: No local node required. Connects directly over TLS to public indexers (`testnet.zec.rocks:443`, `zec.rocks:443`).
   - **Local Regtest Mode (Z3 Stack)**:
     - **Zebra Node**: Pinned to official stable release `zfnd/zebra:6.4.2` on JSON-RPC `127.0.0.1:8181` (or `18232`).
     - **Zaino Indexer**: Pinned to image `zingodevops/zainod:0.10.0-no-tls` on gRPC port `127.0.0.1:8137`.

> [!IMPORTANT]
> - **Zebra pin**: Must use `zfnd/zebra:6.4.2` (recalled versions 6.4.0/6.4.1 contain pre-NU6.3 branch ID re-serialization DoS GHSA-h5rr-8pqv-grp9). Do not move to pre-release `7.0.0-rc.0` for regtest/mainnet.
> - **Zaino pin**: Must use `zingodevops/zainod:0.10.0-no-tls` (≥ 0.10.0). Earlier versions like Z3's default (`0.6.0`) reject Ironwood `GetSubtreeRoots` queries.

---

## Quickstart

### 1. Install & Build Monorepo

```bash
# Clone the repository
git clone https://github.com/Ultra-Tech-code/create-zcash-app.git
cd create-zcash-app

# Install all workspace dependencies
pnpm install

# Build the Rust native addon (debug or release)
pnpm --filter @zcash-app/core run build

# Build the TypeScript SDK, CLI, and Dashboard
pnpm --filter @zcash-app/sdk run build
pnpm --filter zcash-dev run build
pnpm --filter create-zcash-app run build
pnpm --filter dashboard run build
```

### 2. Run SDK Smoke Test

With local Zaino running on `127.0.0.1:8137` (or against testnet/mainnet):
```bash
node packages/sdk/test-e2e.mjs
```

### 3. Launch the Developer Dashboard

```bash
# Launch directly via zcash-dev:
npx zcash-dev dashboard

# Or from the dashboard package:
cd packages/dashboard
pnpm dev
```
Open [http://localhost:3050](http://localhost:3050) to view chain state, inspect balances across pools (Orchard + Ironwood), and perform developer actions.

---

## Verified Ironwood & Regtest Facts

- **Unified Address receivers**: There is **no distinct Ironwood receiver type** in a Unified Address. An ordinary Orchard receiver routes outputs into the Ironwood pool automatically after NU6.3 activation.
- **Values**: All balance values in `@zcash-app/sdk` are represented as `bigint` zatoshis (`1 ZEC = 100,000,000 zatoshis`).
- **Server-side Security**: Spending keys and native crypto addons remain strictly server-side. The dashboard and browser clients communicate only with backend API routes and only handle view keys or addresses.

---

## License

MIT
