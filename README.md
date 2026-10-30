# create-zcash-app

A scaffolder, TypeScript SDK, Rust crypto core, and developer dashboard for building shielded Zcash applications with **NU7** as the default network upgrade cohort.

Supports both the **Orchard** and post-NU6.3 **Ironwood** pools with deterministic key derivation, compact action trial-decryption, and local regtest developer tooling.

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
- Built with `napi-rs` to provide native Node.js bindings across macOS, Linux, and Windows.
- Implements NU7 / NU6.3 key derivation and decryption (`orchard` 0.15, `zcash_keys` 0.16, `zcash_address` 0.13, `zcash_protocol` 0.10).
- **Features**:
  - `deriveAccountFromMnemonic`: Derives Unified Address (`uregtest1...`, `utest1...`) and UFVK (`uviewregtest1...`).
  - `getAddressFromUfvk`: Derives default and diversified addresses.
  - `tryDecryptAction`: Scans both Orchard actions and quantum-recoverable `ironwoodActions` (lead byte `0x03`).
  - Spending authority is held as an opaque `spendHandle` Rust-side and is never serialized to JavaScript.

### 2. `@zcash-app/sdk` (TypeScript SDK)
- Standard client factory and high-level Zcash payment APIs:
  - `createClient({ endpoint, network })`: Connects directly to Lightwalletd or Zaino gRPC (`CompactTxStreamer`).
  - `accountFromMnemonic(mnemonic, accountIndex?, network?)`: Deterministic account management.
  - `detectIncoming(client, key, opts?)`: Scans compact blocks for incoming notes across both Orchard and Ironwood pools.
  - `getBalance(client, key)`: Computes balances strictly in `bigint` zatoshis (`1 ZEC = 100,000,000 zatoshis`).
  - `buildPaymentRequest` & `parsePaymentRequest`: Full ZIP-321 URI support.
  - `dev.fixtures`, `dev.mine`, `dev.fund`, and `testkit.withRegtest()`.

### 3. `zcash-dev` (CLI Tooling)
Convenience CLI for working with local regtest and testnet stacks:
```bash
# View node and indexer status
zcash-dev info

# Display deterministic fixture accounts (safe for testing)
zcash-dev fixtures

# Mine blocks on demand
zcash-dev mine 1

# Fund a Unified Address with regtest ZEC (regtest-only)
zcash-dev fund <UNIFIED_ADDRESS> 1.0
```

> [!NOTE]
> `zcash-dev mine` generates coinbase rewards via Zebra. Note that `zcash-dev fund` (via `z_sendmany`) requires 100 blocks of coinbase maturity and an active Zallet account with spendable balance.

### 4. `@zcash-app/dashboard` (Developer Dashboard)
A glassmorphic Next.js App Router UI providing real-time visibility into your Zcash stack:
- **Overview**: Live total balance and per-pool breakdown (Ironwood vs. Orchard).
- **Addresses**: Unified Address (ZIP-316), diversified addresses, and view-only UFVK with copy buttons.
- **Transactions**: Live list of incoming notes detected by trial-decryption, isolated by network preset.
- **Background Sync**: Non-blocking status API (`/api/sync/status`) responding in < 5s with scanned progress and pending/failed fetch metrics.
- **Security Notice**: Memos and counterparties are stored in plaintext in the SQLite wallet DB (`~/.zcash-app/dashboard/`); directory permissions are strictly 0700 and database file permissions are strictly 0600.
- **Explorer**: Integrated transaction and block inspector supporting NU7 consensus branches and local Zebra cookie authentication.
- **Running the Dashboard**: The developer dashboard is run from the cloned repository:
  ```bash
  pnpm --filter dashboard run dev
  # or: cd packages/dashboard && pnpm dev
  ```

### 5. `create-zcash-app` (Scaffolder CLI)
Scaffold new shielded applications with guided network and indexer configuration:
```bash
npx create-zcash-app my-shielded-app
```

**Interactive Prompts & Defaults**:
1. **Network**:
   - `regtest` (**Default** — instant standalone NU7 local chain on `127.0.0.1:39067`, 100% offline).
   - `testnet` (Public staging on `testnet.zec.rocks:443` with TAZ).
   - `mainnet` (⚠️ **Experimental** — production with real ZEC).
2. **Template**: `nextjs-fullstack` (Next.js full-stack shielded application).
3. **Connection Mode** (for testnet/mainnet):
   - 🌐 **Remote Public Indexer** (e.g. `testnet.zec.rocks:443`, `zec.rocks:443`) — Zero-install, no node required.
   - 🐳 **Local Node** — Self-hosted privacy stack (generates `docker-compose.yml`).

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
Automatically updates `.env.local` and `zcash.config.json`.

### 7. Automated Regtest Setup CLI (`zcash-dev regtest setup`)
Automates the local Z3 regtest environment after a fresh clone or volume wipe:
```bash
npx zcash-dev regtest setup
```
- Sets `miner_address` in Zebra configuration to the Zallet wallet account's Unified Address.
- Sets `miner_memo = "regtest"` in `[mining]`.
- Creates the default Zallet account if missing.
- Mines initial blocks for coinbase maturity so funds are immediately spendable by `dev.fund`.

---

## Network Presets & Upgrade Support

| Preset | Network | Consensus / Upgrade | Status | Endpoint | Mining / RPC |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `regtest-nu7` | `regtest` | **NU7** (Default at block 1) | Active | `127.0.0.1:39067` | `http://127.0.0.1:39232` |
| `regtest-z3` | `regtest` | **NU6.3** | **Regtest-Only** | `127.0.0.1:28137` | `http://127.0.0.1:8181` |
| `testnet` | `testnet` | **NU7** | Active | `testnet.zec.rocks:443` | QuickNode / Secondary |
| `testnet-local` | `testnet` | **NU7** | Active (Local) | `127.0.0.1:39167` | `http://127.0.0.1:18232` (cookie auth) |
| `mainnet` | `mainnet` | **NU7** | ⚠️ **Experimental** | `zec.rocks:443` | Public indexer |

---

## Prerequisites

1. **Rust / Cargo**: `1.85+` (verified with `cargo 1.95.0`).
2. **Node.js**: `v20+` (verified with `v22.22.2`).
3. **pnpm**: `v9+` or `v11+` (`corepack enable`).
4. **Node & Indexer (Optional for Remote Mode)**:
   - **Remote Mode (testnet / mainnet)**: No local node required. Connects directly over TLS to public indexers (`testnet.zec.rocks:443`, `zec.rocks:443`).
   - **Local Regtest Mode**:
     - **NU7 Standalone (Default)**: Zebra 7.0.0 + Lightwalletd on `127.0.0.1:39067`.
     - **Z3 Stack (Regtest-Only)**: Zebra 7.0.0 on `127.0.0.1:8181` + Zaino on `127.0.0.1:28137` (NU6.3).

---

## Quickstart

### 1. Install & Build Monorepo

```bash
# Clone the repository
git clone https://github.com/0xblackadam/create-zcash-app.git
cd create-zcash-app

# Install all workspace dependencies
pnpm install

# Build the Rust native addon
pnpm --filter @zcash-app/core run build

# Build the TypeScript SDK, CLI, and Dashboard
pnpm --filter @zcash-app/sdk run build
pnpm --filter zcash-dev run build
pnpm --filter create-zcash-app run build
pnpm --filter dashboard run build
```

### 2. Launch the Developer Dashboard

The dashboard is run directly from the repository:
```bash
pnpm --filter dashboard run dev
# or:
cd packages/dashboard && pnpm dev
```
Open [http://localhost:3050](http://localhost:3050) to view chain state, inspect balances across pools (Orchard + Ironwood), and perform developer actions.

---

## Verified Ironwood & Regtest Facts

- **NU7 is the default**: All new projects and endpoints default to NU7.
- **Unified Address receivers**: There is **no distinct Ironwood receiver type** in a Unified Address. An ordinary Orchard receiver routes outputs into the Ironwood pool automatically.
- **Values**: All balance values in `@zcash-app/sdk` are represented as `bigint` zatoshis (`1 ZEC = 100,000,000 zatoshis`).
- **Server-side Security**: Spending keys and native crypto addons remain strictly server-side. The dashboard and browser clients communicate only with backend API routes and only handle view keys or addresses.

---

## License

MIT
