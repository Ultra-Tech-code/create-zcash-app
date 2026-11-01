# Chapter 4: Operations by Stack

Different Zcash environments (local devnets, public testnet, and mainnet) support distinct operational capabilities. This chapter provides a definitive matrix of operations across all four stacks, citing the implementing codebase files and functions, and noting where an operation is not available.

---

## Operations Matrix

| Operation | Z3 NU6.3 Regtest | NU7 Regtest | Testnet | Mainnet | Implementing SDK / CLI Source |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Mine Blocks** | ✅ Supported | ✅ Supported | ❌ Not available (PoW) | ❌ Not available (PoW) | `zcash-dev mine`, `dev.mine()` in `packages/sdk/src/dev.ts` |
| **Account / Address Derivation** | ✅ Supported | ✅ Supported | ✅ Supported | ✅ Supported | `zcash-dev address`, `accountFromMnemonic()`, `accountFromUfvk()` in `packages/sdk/src/keys.ts` |
| **Balance Calculation** | ✅ Supported | ✅ Supported | ✅ Supported | ✅ Supported | `zcash-dev balance`, `getBalance()` in `packages/sdk/src/sync.ts` |
| **Testnet / Devnet Faucet Funding** | ✅ Supported | ⚠️ Coinbase rewards only | ❌ Not available via CLI | ❌ Not available (Real ZEC) | `zcash-dev fund`, `dev.fund()` in `packages/sdk/src/dev.ts` |
| **Send / Broadcast Transaction** | ✅ Supported | ✅ Supported | ✅ Supported | ✅ Supported (with `--mainnet`) | `zcash-dev send`, `send()` in `packages/sdk/src/send.ts` |
| **Decrypted Tx & Memo Inspection** | ✅ Supported | ✅ Supported | ✅ Supported | ✅ Supported | `decryptTransaction()`, `decodeTransaction()` in `packages/sdk/src/decrypted-tx.ts` |
| **Unified Full Viewing Keys (UFVK)** | ✅ Supported | ✅ Supported | ✅ Supported | ✅ Supported | `account.getUnifiedFullViewingKey()` in `packages/sdk/src/keys.ts` |
| **Partially Created Zcash Tx (PCZT)** | ⚠️ Zallet RPC only | ❌ Not available | ❌ Not available | ❌ Not available | Upstream Zallet RPC methods `pczt_create`; not yet exposed in `@zcash-app/sdk` v0.1.0 |
| **Encrypted Keystore on Disk** | ⚠️ Zallet backend only | ❌ Not available | ❌ Not available | ❌ Not available | Zallet `init-wallet-encryption`; `@zcash-app/sdk` stores keys in `.env.local` or environment variables |

---

## Detailed Operations Breakdown

### 1. Mining (`mine`)
- **Regtest**: Mining is available on both local devnet stacks by calling the node's JSON-RPC `generate` method (`dev.mine(client, blocks)` in `packages/sdk/src/dev.ts`). On regtest, blocks are mined instantaneously without proof-of-work difficulty delays.
- **Testnet & Mainnet**: Mining cannot be performed via the CLI or SDK because these chains use public Proof of Work (Equihash 200,9). Blocks arrive approximately every 75 seconds according to global network hash rate.

### 2. Account & Address Derivation (`address`)
- Implemented in `packages/sdk/src/keys.ts` via `accountFromMnemonic(mnemonic, accountIndex, network)` and `accountFromUfvk(ufvk, network)`.
- Derives ZIP-316 Unified Addresses containing transparent, Sapling, and Orchard receivers with appropriate human-readable prefixes (`uregtest1...`, `utest1...`, `u1...`).
- Supported identically across all four networks.

### 3. Balance Query (`balance`)
- Implemented in `packages/sdk/src/sync.ts` via `getBalance(client, account, options)`.
- Connects to the gRPC indexer (`lightwalletd` or `zainod`), scans compact blocks from the configured birthday height (`sinceHeight`), downloads commitment tree frontiers, and sums balances across transparent, Sapling, Orchard, and Ironwood pools.
- Identical behavior across all stacks.

### 4. Faucet & Funding (`fund`)
- **Z3 NU6.3 Regtest**: Supported via `zcash-dev fund <address> [amount]` and `dev.fund(client, address, zatoshis)` in `packages/sdk/src/dev.ts`. Funds are drawn from the pre-mined Zallet test account via `z_sendmany`.
- **NU7 Regtest**: The Zallet faucet is not available on the NU7 stack because Zallet beta.3 lacks NU7 support. Instead, Zebra automatically pays block rewards to the Account 0 miner address (`uregtest1...`). Developers fund accounts by mining 105 blocks for coinbase maturity, then sending funds from Account 0.
- **Testnet & Mainnet**: CLI faucet funding is not available. Testnet users must obtain TAZ from public community faucets (such as `https://faucet.zecpages.com`), while mainnet requires real ZEC.

### 5. Send & Transaction Broadcast (`send`)
- Implemented in `packages/sdk/src/send.ts` via `send(options)` and surfaced in `zcash-dev send`.
- **Dry-Run Mode**: When invoked without `--yes`, the CLI performs an offline dry run, deriving inputs, quoting ZIP-317 fees, and returning the estimated transaction structure without broadcasting.
- **Broadcast Mode**: When `--yes` is supplied, the SDK builds the transaction, generates zero-knowledge proofs via native `@zcash-app/core` Halo 2 provers, and submits the serialized transaction to the mempool via `SendTransaction` (gRPC) or `sendrawtransaction` (JSON-RPC).
- **Mainnet Safeguard**: Broadcasting on mainnet strictly requires passing `--mainnet` in addition to `--yes`.

### 6. Decrypted Transaction Inspection (`view tx`)
- Implemented in `packages/sdk/src/decrypted-tx.ts` via `decryptTransaction(rawTx, ufvk, network)` and `decodeTransaction(rawTx)`.
- Recovers note values, recipient diversification indices, nullifiers, and UTF-8 payment memos using the account's viewing key.
- Available across all stacks.

### 7. Unified Full Viewing Keys (`UFVK`)
- Implemented in `packages/sdk/src/keys.ts` via `account.getUnifiedFullViewingKey()` and `accountFromUfvk(ufvk, network)`.
- Enables watch-only account operation across all stacks without custody risk.

### 8. Partially Created Zcash Transactions (`PCZT`)
- **Status in v0.1.0**: Partially Created Zcash Transactions (ZIP 370 / PCZT) allow offline signers and hardware wallets to construct, inspect, and sign transactions in multi-party or air-gapped environments. While the upstream Zallet beta.3 backend includes RPC methods for PCZTs (`pczt_create`), the high-level `@zcash-app/sdk` client does not yet expose a standalone PCZT creation and combining pipeline. This is planned for Stage 2.

### 9. Encrypted Keystores on Disk
- **Status in v0.1.0**: Full node keystores like Zallet support on-disk encrypted keystores using Age encryption (`init-wallet-encryption`). The current `@zcash-app/sdk` application template relies on standard modern 12-factor application secrets management: sensitive keys reside in `.env.local` or process environment variables with strict file permissions (`0600`) and `.gitignore` drift checks.

