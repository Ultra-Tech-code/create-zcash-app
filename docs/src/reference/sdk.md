<!-- Generated automatically by pnpm docs:gen. Do not edit directly. -->

# TypeScript SDK Reference (`@zcash-app/sdk`)

The `@zcash-app/sdk` package provides client connections, wallet synchronization, balance calculation, note decryption, and transaction construction for shielded Zcash applications.

**Package Version**: `0.1.0` (as of November 2026)

## Table of Contents

- [Classes](#classes)
- [Core Functions](#core-functions)
- [Interfaces](#interfaces)
- [Type Aliases](#type-aliases)
- [Constants](#constants)

## Classes

### `class ChainIdentityError`

**Members & Methods**:

| Member | Type / Description |
| :--- | :--- |
| `prototype` | `ChainIdentityError`  |

### `class ZcashClient`

**Members & Methods**:

| Member | Type / Description |
| :--- | :--- |
| `prototype` | `ZcashClient`  |

### `class AnchorVerificationError`

Thrown when the anchor cannot be checked against the node and no explicit override was given.

**Members & Methods**:

| Member | Type / Description |
| :--- | :--- |
| `prototype` | `AnchorVerificationError`  |

### `class ConsensusBranchMismatchError`

Thrown when the node's consensus branch does not match the crate's derived consensus branch.

**Members & Methods**:

| Member | Type / Description |
| :--- | :--- |
| `prototype` | `ConsensusBranchMismatchError`  |

### `class UpgradeBoundaryError`

Thrown when transaction building is attempted within one block before a network upgrade activation.

**Members & Methods**:

| Member | Type / Description |
| :--- | :--- |
| `prototype` | `UpgradeBoundaryError`  |

### `class JsonRpcVerifier`

**Members & Methods**:

| Member | Type / Description |
| :--- | :--- |
| `prototype` | `JsonRpcVerifier`  |
| `redactUrl` | `(urlStr: string) => string`  |

## Core Functions

### `createClient()`

```typescript
function createClient(config: ClientConfig): ZcashClient;
```

### `generateMnemonic()`

```typescript
function generateMnemonic(): string;
```

### `accountFromMnemonic()`

```typescript
function accountFromMnemonic(mnemonic: string, accountIndex?: number, network?: Network): Account;
```

### `accountFromUfvk()`

```typescript
function accountFromUfvk(ufvk: string, network?: Network): WatchOnlyAccount;
```

### `detectIncoming()`

```typescript
function detectIncoming(client: ZcashClient, key: string | Account | WatchOnlyAccount, opts?: { sinceHeight?: number; endHeight?: number; }): Promise<{ notes: IncomingNote[]; spentNullifiers: Set<...>; }>;
```

### `getBalance()`

```typescript
function getBalance(client: ZcashClient, key: string | Account | WatchOnlyAccount, opts?: { minConf?: number; sinceHeight?: number; endHeight?: number; }): Promise<...>;
```

### `sync()`

```typescript
function sync(client: ZcashClient, key: string | Account | WatchOnlyAccount, opts?: { sinceHeight?: number; }): Promise<SyncResult>;
```

### `watch()`

```typescript
function watch(client: ZcashClient, key: string | Account | WatchOnlyAccount, onNote: (note: IncomingNote) => void, opts?: { pollMs?: number; }): () => void;
```

### `buildPaymentRequest()`

```typescript
function buildPaymentRequest(req: { to: string; value: bigint; memo?: string; label?: string; }): string;
```

### `parsePaymentRequest()`

```typescript
function parsePaymentRequest(uri: string): { to: string; value?: bigint; memo?: string; label?: string; };
```

### `initWalletTreeFrontier()`

Initializes the wallet's commitment tree frontier from lightwalletd GetTreeState at height (birthday - 1).
Verified against lightwalletd v0.6.0 walletrpc/service.proto:L185 (TreeState.ironwoodTree = 7).

Verifies that the parsed frontier tree size equals CompactBlock ironwoodCommitmentTreeSize at height (birthday - 1),
inserting the starting checkpoint into ShardTree and recorded in scanned_blocks.

```typescript
function initWalletTreeFrontier(client: ZcashClient, wallet: WalletHandle, birthday: number): Promise<TreeFrontierInitResult>;
```

### `syncWallet()`

Synchronizes a WalletHandle against a live Zaino/Zcash indexer with streaming,
reorg resolution via resolveReorg, request throttling, exponential backoff,
and root verification against GetTreeState.

```typescript
function syncWallet(client: ZcashClient, wallet: WalletHandle, options?: SyncOptions): Promise<WalletSyncResult>;
```

### `reverseTxid()`

Converts a 32-byte hex transaction ID between internal byte order and node/explorer display order (byte-reversed).

```typescript
function reverseTxid(hexTxid: string): string;
```

### `quoteFee()`

Returns the standard ZIP 317 fee for a transaction with the given number of actions.

```typescript
function quoteFee(numActions: number): bigint;
```

### `warmupProver()`

Warms up the static circuit proving key in a background thread ahead of first send.

```typescript
function warmupProver(): void;
```

### `send()`

High-level atomic transaction send pipeline:
1. Checks tip & syncs wallet if needed.
2. Selects an anchor height (tip - 5, min 2) and verifies tree root against getTreeState.
3. Queries spendable notes and calculates ZIP-317 fee.
4. Places an in-flight reservation on selected notes.
5. Builds and Halo2-proves the V6 Ironwood transaction asynchronously.
6. Broadcasts raw transaction to network via lightd client.
7. Marks reservation as broadcast.
If building, proving, or broadcast fails, the reservation is canceled immediately.

```typescript
function send(opts: SendOptions): Promise<SendResult>;
```

### `normalizeBranchId()`

Normalizes a branch ID input (hex string, prefixed hex string, or u32 number)
into a standard 8-character lowercase hexadecimal string.

```typescript
function normalizeBranchId(branchId: string | number): string;
```

### `getUpgradeName()`

Maps a consensus branch ID to its official network upgrade name.
Returns "Unknown (0x...)" if the branch ID is not recognized.

```typescript
function getUpgradeName(branchId: string | number): string;
```

### `getExpectedBranchId()`

Retrieves the expected consensus branch ID for a network and block height.

```typescript
function getExpectedBranchId(network: string, height: number): string;
```

### `consensusBranchIdToUpgradeName()`

```typescript
function consensusBranchIdToUpgradeName(branchId: string | number): string;
```

### `decryptTransaction()`

Decrypts an Ironwood transaction wire serialization using a Unified Full Viewing Key.

Recovers incoming actions (external and internal scope, marked with isChange/isInternal)
and outgoing actions (via OVK recovery). Also returns txid, net fee (valueBalance),
expiry height, and consensus branch ID.

```typescript
function decryptTransaction(ufvk: string, network: string, rawTxBytes: any, height: number): DecryptedTransaction;
```

### `decodeTransaction()`

Parses and decodes raw transaction bytes locally using core crypto parsers.
Does not trust or rely on remote node's decoded JSON representation.

```typescript
function decodeTransaction(rawTxBytes: any, network?: string, height?: number): DecodedTransaction;
```

### `classifyExplorerQuery()`

Classifies an explorer search box input:
- Digits: block height
- 64-hex: txid or block hash (ambiguous when starting with leading zeros 0000...)
- Other: invalid format

```typescript
function classifyExplorerQuery(input: string): ClassifiedQuery;
```

### `clearDashboardWalletCache()`

```typescript
function clearDashboardWalletCache(): void;
```

### `getDashboardWalletDir()`

```typescript
function getDashboardWalletDir(): string;
```

### `getDashboardWalletPath()`

```typescript
function getDashboardWalletPath(network: string, accountId: string): string;
```

### `getDashboardWallet()`

Opens or retrieves a cached WalletHandle for the given (network, account)
persisted under ~/.zcash-app/dashboard/ with strict 0700 dir and 0600 file permissions.

```typescript
function getDashboardWallet(network: string, accountId: string, ufvk: string, birthday?: number): WalletHandle;
```

### `getDashboardSyncStatus()`

Returns the current background sync status immediately without blocking.

```typescript
function getDashboardSyncStatus(network: string, accountId: string, wallet?: WalletHandle): DashboardSyncStatus;
```

### `startDashboardSync()`

Initiates an asynchronous background synchronization job if one is not already running.
Returns immediately without blocking (< 50ms) so no API endpoint blocks.

```typescript
function startDashboardSync(client: ZcashClient, wallet: WalletHandle, options?: SyncOptions): DashboardSyncStatus;
```

## Interfaces

### `interface ClientConfig`

### `interface Account`

### `interface WatchOnlyAccount`

### `interface PoolBalances`

### `interface AccountBalance`

### `interface IncomingNote`

### `interface Note`

### `interface SyncResult`

### `interface SendRequest`

### `interface TxResult`

### `interface DecryptedMemo`

### `interface DecryptedActionIncoming`

### `interface DecryptedActionOutgoing`

### `interface DecryptedTransaction`

### `interface DecodedActionCounts`

### `interface DecodedAnchorPair`

### `interface DecodedAnchors`

### `interface DecodedTransaction`

### `interface LightdInfo`

### `interface TreeState`

### `interface ChainMetadata`

### `interface CompactBlock`

### `interface CompactTx`

### `interface CompactOrchardAction`

### `interface CheckpointVerification`

### `interface CheckpointResult`

### `interface SyncOptions`

### `interface WalletSyncResult`

### `interface TreeFrontierInitResult`

### `interface SendFromOptions`

### `interface SendOptions`

### `interface SendResult`

### `interface JsonRpcResponse`

### `interface JsonRpcBlockchainInfo`

### `interface JsonRpcTreeState`

### `interface ClassifiedQuery`

### `interface DashboardSyncStatus`

SECURITY NOTICE:
Memos and counterparties are stored in plaintext in the SQLite wallet database.
To protect user privacy, directory permissions are strictly enforced to 0700
and database files to 0600.

## Type Aliases

### `type Network`

```typescript
type Network = any;
```

### `type VerificationEndpoint`

```typescript
type VerificationEndpoint = any;
```

### `type Ufvk`

```typescript
type Ufvk = any;
```

### `type QueryKind`

```typescript
type QueryKind = any;
```

## Constants

### `WalletHandle`

### `PINNED_NU7_ACTIVATION_HEIGHT`

Type: `4465026`

### `PINNED_NU7_ACTIVATION_HASH`

Type: `"000089ba27100beede16d64b34e3d1b626b428cb7ee9fe6dcfdc217ce24e78af"`

### `DEPRECATED_OLD_CHAIN_HASH`

Type: `"0713a6429dc1cef50224668082022ca8881593e09a3170717e6a725491c03b96"`

### `dev`

### `testkit`

Type: `{ fixtures: { mnemonics: readonly string[]; account(index: number, network?: "regtest" | "testnet" | "mainnet" | "regtest-nu7"): Account; }; withRegtest(fn: (ctx: { client: ZcashClient; fund: (client: ZcashClient, to: string, value: bigint) => Promise<...>; }) => Promise<...>): Promise<...>; }`

### `KNOWN_TEST_MNEMONICS`

Shared test fixture mnemonics (BIP-39 english).
Publicly known seeds used exclusively for development and automated testing.
Strictly prohibited on mainnet.

Type: `readonly string[]`

### `decodeIronwoodFrontierRoot`

### `CONSENSUS_BRANCH_UPGRADES`

Known Zcash Consensus Branch IDs and their canonical Network Upgrade names.
Sourced from ZIP 200, ZIP 253, and zcash_protocol consensus definitions.

Type: `Readonly<Record<string, string>>`

