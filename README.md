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

# Fund a Unified Address with regtest ZEC
zcash-dev fund <UNIFIED_ADDRESS> 1.0
```

### 4. `@zcash-app/dashboard` (Developer Dashboard)
A glassmorphic Next.js App Router UI providing real-time visibility into your local Zcash stack:
- **Overview**: Live total balance and per-pool breakdown (Ironwood vs. Orchard).
- **Addresses**: Unified Address (ZIP-316), diversified addresses, and view-only UFVK with copy buttons.
- **Transactions**: Live list of incoming notes detected by trial-decryption.
- **Faucet / Fund**: Instant funding and block generation triggers.
- **Health / Logs**: Zaino gRPC connection status, version pin verification (≥ 0.10.0), and active network upgrade (`NU6.3`).

### 5. `create-zcash-app` (Scaffolder CLI)
Scaffold new shielded applications ready to run against local Z3:
```bash
npx create-zcash-app my-shielded-app
```

---

## Prerequisites

1. **Rust / Cargo**: `1.85+` (verified with `cargo 1.95.0`).
2. **Node.js**: `v20+` (verified with `v22.22.2`).
3. **pnpm**: `v9+` or `v11+` (`corepack enable`).
4. **Running Z3 Stack (Zebra + Zaino)**:
   - **Zebra**: Listening on JSON-RPC `127.0.0.1:8181` (or regtest default `18232`).
   - **Zaino**: Image `zingodevops/zainod:0.10.0` or newer listening on gRPC port `127.0.0.1:8137`.

> [!IMPORTANT]
> Zaino version must be **≥ 0.10.0**. Z3's default pin (`0.6.0`) rejects Ironwood `GetSubtreeRoots` queries.

---

## Quickstart

### 1. Install & Build Monorepo

```bash
# Clone the repository
git clone https://github.com/your-org/create-zcash-app.git
cd create-zcash-app

# Install all workspace dependencies
pnpm install

# Build the Rust native addon
pnpm --filter @zcash-app/core run build:debug

# Build the TypeScript SDK, CLI, and Dashboard
pnpm --filter @zcash-app/sdk run build
pnpm --filter zcash-dev run build
pnpm --filter create-zcash-app run build
pnpm --filter dashboard run build
```

### 2. Run SDK Smoke Test

With Zaino running on `127.0.0.1:8137`, test the connection, key derivation, and ZIP-321 encoding:
```bash
node packages/sdk/test-e2e.mjs
```

### 3. Launch the Developer Dashboard

```bash
cd packages/dashboard
pnpm dev
```
Open [http://localhost:3000](http://localhost:3000) to view chain state, inspect fixture balances, and trigger on-demand mining.

---

## Verified Ironwood & Regtest Facts

- **Unified Address receivers**: There is **no distinct Ironwood receiver type** in a Unified Address. An ordinary Orchard receiver routes outputs into the Ironwood pool automatically after NU6.3 activation.
- **Values**: All balance values in `@zcash-app/sdk` are represented as `bigint` zatoshis (`1 ZEC = 100,000,000 zatoshis`).
- **Server-side Security**: Spending keys and native crypto addons remain strictly server-side. The dashboard and browser clients communicate only with backend API routes and only handle view keys or addresses.

---

## License

MIT
