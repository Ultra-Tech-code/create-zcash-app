# create-zcash-app SDK — Surface Specification (draft)

The public contract the templates and the workshop lab are built against. TypeScript signatures are the source of truth; the Rust crypto core sits behind them. This is a design draft. Indexer support for Ironwood (deposit detection and spend-proving) has been verified end-to-end against a live regtest stack — see §7. The remaining **Open questions** are narrower: ZIP-318's exact construction and the browser grpc-web proxy path, both to confirm before the API is frozen.

---

## 1. Design principles

- **Server-side by default.** Spending keys, the native crypto addon, and gRPC calls run on the server. The browser never holds a spending key unless the app is an explicit self-custody wallet (the wallet-lite case).
- **Small, stable surface.** A handful of functions cover the 90% path (address → detect → send). Advanced surface (raw notes, tx plans) is opt-in.
- **Both pools, always.** Every read spans Orchard and Ironwood; the caller rarely thinks about which pool a note is in.
- **The Rust core is hidden.** Trial-decryption, key derivation, note selection, and proving live in Rust. TypeScript is the ergonomic wrapper plus the gRPC client.
- **Values are `bigint` zatoshis.** Never floating-point ZEC in the API. 1 ZEC = 100,000,000 zatoshis.

---

## 2. Package layout

```
@zcash-app/sdk        TypeScript public API (this document)
@zcash-app/core       Rust crypto core — napi-rs native build + wasm-bindgen browser build
create-zcash-app      the scaffolder CLI
zcash-dev             the regtest helper CLI (mine/fund/send/reset), thin wrapper over sdk.dev
```

`@zcash-app/core` is one Rust crate compiled two ways: a native Node addon (napi-rs) for the server, and WASM (wasm-bindgen) for the browser. The TypeScript SDK loads whichever is available for the runtime.

---

## 3. The server / browser boundary

| Capability | Server (native) | Browser (WASM) |
|---|---|---|
| Key derivation, spending keys | ✅ | ⚠️ self-custody wallet only |
| Trial-decryption / note management | ✅ | ✅ |
| Transaction build + prove | ✅ | ✅ (heavier; acceptable for a single-user wallet) |
| Network transport | native gRPC (HTTP/2) | **grpc-web** (needs a proxy in front of lightwalletd/Zaino) |

The transport difference is the sharp edge: browsers cannot speak raw gRPC, so the browser path requires a grpc-web proxy (Envoy, or a Zaino/lightwalletd deployment that fronts grpc-web). The `createClient` factory abstracts this — `transport` auto-selects `grpc` on Node and `grpc-web` in the browser — but the wallet-lite template must document the proxy requirement.

---

## 4. Public API

### 4.1 Client

```ts
type Network = 'regtest' | 'testnet' | 'mainnet';

interface ClientConfig {
  endpoint: string;                 // lightwalletd / Zaino gRPC URL (grpc-web URL in browser)
  network: Network;
  transport?: 'grpc' | 'grpc-web';  // default: grpc on Node, grpc-web in browser
}

function createClient(config: ClientConfig): ZcashClient;

interface ZcashClient {
  getInfo(): Promise<{ chainHeight: number; branchId: string; network: Network }>;
  close(): Promise<void>;
}
```

### 4.2 Keys & addresses (server-side)

```ts
function generateMnemonic(): string;                        // BIP-39

function accountFromMnemonic(
  mnemonic: string,
  accountIndex?: number                                     // default 0
): Account;

interface Account {
  /** Unified Address (ZIP-316). Optionally diversified. */
  getUnifiedAddress(diversifierIndex?: number): string;
  /** Unified Full Viewing Key — safe to pass to the detection layer; cannot spend. */
  getUnifiedFullViewingKey(): Ufvk;
  // spending capability is held internally and never serialized out
}

type Ufvk = string;

/** Watch-only handle for deposit detection — no spend authority. */
function accountFromUfvk(ufvk: Ufvk): WatchOnlyAccount;

interface WatchOnlyAccount {
  getUnifiedFullViewingKey(): Ufvk;
}
```

### 4.3 Balance & sync

```ts
interface PoolBalances {
  orchard: bigint;
  ironwood: bigint;
  sapling: bigint;       // legacy notes, read-only
  transparent: bigint;
  total: bigint;         // zatoshis
}

function getBalance(
  client: ZcashClient,
  key: Ufvk | WatchOnlyAccount | Account
): Promise<PoolBalances>;

/** Scan from `sinceHeight` (or last-synced), trial-decrypt via the core, return what changed. */
function sync(
  client: ZcashClient,
  key: Ufvk | WatchOnlyAccount | Account,
  opts?: { sinceHeight?: number }
): Promise<SyncResult>;

interface SyncResult {
  syncedHeight: number;
  newNotes: Note[];
  balances: PoolBalances;
}

interface Note {
  pool: 'orchard' | 'ironwood' | 'sapling';
  value: bigint;
  memo?: string;
  txid: string;
  height: number;
  spent: boolean;
}
```

### 4.4 Deposit detection (the primary onboarding path)

```ts
interface IncomingNote {
  pool: 'orchard' | 'ironwood';
  value: bigint;
  memo?: string;
  txid: string;
  height: number;
}

function detectIncoming(
  client: ZcashClient,
  key: Ufvk | WatchOnlyAccount | Account,
  opts?: { sinceHeight?: number }
): Promise<IncomingNote[]>;

/** Poll-based watcher; returns an unsubscribe handle. */
function watch(
  client: ZcashClient,
  key: Ufvk | WatchOnlyAccount | Account,
  onNote: (note: IncomingNote) => void,
  opts?: { pollMs?: number }        // default 15000
): () => void;
```

### 4.5 Send (server-side; requires spend authority)

```ts
interface SendRequest {
  to: string;                        // UA / Sapling / transparent address
  value: bigint;                     // zatoshis
  memo?: string;                     // shielded recipients only
  fromPool?: 'orchard' | 'ironwood'; // default: SDK selects, preferring Ironwood
}

function send(
  client: ZcashClient,
  account: Account,                  // must carry spend authority
  req: SendRequest
): Promise<TxResult>;                // build → prove → broadcast

interface TxResult {
  txid: string;
  fee: bigint;                       // ZIP-317
}
```

### 4.6 Migration — ZIP-318 (Orchard → Ironwood)

```ts
/**
 * Construct and broadcast a ZIP-318 migration: a v6 transaction that moves
 * value out of the sealed Orchard pool into Ironwood through the turnstile.
 */
function migrateOrchardToIronwood(
  client: ZcashClient,
  account: Account,
  opts?: { value?: bigint }          // default: migrate the full spendable Orchard balance
): Promise<TxResult>;
```

### 4.7 Dev / network helpers (back the `zcash-dev` CLI)

```ts
namespace dev {
  function mine(client: ZcashClient, blocks: number): Promise<void>;          // regtest only
  function fund(client: ZcashClient, to: string, value: bigint): Promise<TxResult>;  // regtest
  function reset(client: ZcashClient): Promise<void>;                         // regtest only

  /** Testnet staging: request TAZ from a ztap instance (solves browser PoW), or deep-link the PoW page. */
  function faucet(address: string, opts?: { ztapUrl?: string }):
    Promise<{ status: 'sent' | 'open-url'; txid?: string; url?: string }>;

  /** Deterministic accounts seeded from fixed mnemonics — stable across runs, for tests and labs. */
  const fixtures: {
    mnemonics: string[];
    account(index: number): Account;
  };
}
```

`mine`/`fund`/`reset` back the regtest side of the `zcash-dev` CLI — a thin convenience wrapper over Z3's own regtest tooling (Z3 already mines on demand via `generate` and funds through Zallet), not a reimplementation. `faucet` backs the **testnet** rung: it requests TAZ from **ztap**, our self-hostable, self-mining, Ironwood-capable faucet with browser proof-of-work, so a developer moves along the same regtest → testnet → mainnet path a real app ships along. Teams run their own ztap instance; no faucet service is operated centrally. ztap shares this SDK's crypto core, so Ironwood drips reuse the same v6-aware stack — it is specified separately.

### 4.8 App-layer surface

The layer that makes this more than a thin client — none of it exists upstream. Payment requests, deposit watching, and framework glue are what turn a web developer into a Zcash developer.

```ts
// ZIP-321 payment requests (checkout flows)
function buildPaymentRequest(req: {
  to: string; value: bigint; memo?: string; label?: string;
}): string;                                          // returns a zcash: URI
function parsePaymentRequest(uri: string): { to: string; value?: bigint; memo?: string };

// React hooks & components (browser or full-stack client)
function useShieldedDeposit(opts: {
  address: string; pollMs?: number;
}): { deposits: IncomingNote[]; status: 'idle' | 'watching' | 'error' };

// <PayWithZec amount={...} to={...} onPaid={(txid) => ...} /> — drop-in component

// Framework adapters
//   next:    createZcashRouteHandlers(config)  -> Next.js server actions / route handlers
//   express: zcashMiddleware(config)           -> Express / Fastify middleware
```

### 4.9 Testing utilities

```ts
// vitest / jest helpers for app developers testing against a Z3 regtest chain
const testkit: {
  withRegtest(fn: (ctx: { client: ZcashClient; fund: typeof dev.fund }) => Promise<void>): Promise<void>;
  fixtures: typeof dev.fixtures;
};
```

---

## 5. Rust crypto core (`@zcash-app/core`)

The addon is broader than trial-decryption — it is the whole crypto core, because every key-and-proof operation needs librustzcash. TypeScript orchestrates; Rust does the cryptography.

```
// exposed via napi-rs (native) and wasm-bindgen (browser)
deriveAccount(seedBytes, accountIndex) -> { ufvk, addressFactory, spendHandle }
tryDecrypt(compactBlocks, ivk, pool)   -> DecryptedNote[]     // the hot path
selectNotes(notes, target, fromPool)   -> NoteSelection
buildAndProve(txPlan, spendHandle)     -> rawTxBytes          // v6 for Ironwood/migration
```

`spendHandle` is an opaque, in-process reference to spending material held Rust-side; it is never serialized to JavaScript or sent over the wire. Underlying crates (NU6.3 cohort): `orchard` 0.15 (carries the NU6.3/Ironwood circuit), `zcash_primitives` 0.29, `zcash_keys` 0.15, `zcash_address` 0.13, `zcash_protocol` 0.10, `zcash_client_backend` — pin exact patch versions from the current librustzcash release. Indexer dependency: Zaino ≥ 0.10.0 (see §7.3) — Z3's default pin (0.6.0) lacks Ironwood `GetSubtreeRoots` support needed for note selection and witness construction.

---

## 6. Workshop lab ↔ SDK mapping

The lab is the SDK surface walked one call at a time; each checkpoint is one function, so the lab and the API share a skeleton.

- **Checkpoint 1 — Environment.** `npx create-zcash-app` → `docker compose up` (Z3 regtest live). No SDK call yet.
- **Checkpoint 2 — Identity.** `accountFromMnemonic` → `getUnifiedAddress`. "Here is your shielded address."
- **Checkpoint 3 — Fund.** `zcash-dev fund <ua>` (→ `dev.fund` + `dev.mine`). "You now have test ZEC."
- **Checkpoint 4 — Detect.** `detectIncoming` / `watch`. "Your app saw the shielded deposit." ← the payoff moment.
- **Checkpoint 5 — Send.** `send`. "You sent a private payment; watch it land."
- **Checkpoint 6 — Migrate (advanced).** `migrateOrchardToIronwood`. "Move funds across the turnstile."
- **Checkpoint 7 — Stage on testnet (advanced).** switch the app to `network: 'testnet'`, `dev.faucet(address)` for TAZ, then repeat detect/send against public infrastructure. "Your app runs on the real test network."

A facilitator can run checkpoints 1–5 in one session; checkpoints 6–7 are the stretch for the advanced track (7 introduces the regtest → testnet → mainnet progression a real app follows).

---

## 7. Open questions (verify before freezing the API)

1. **Ironwood UA receivers (resolved).** There is no distinct Ironwood receiver type. Per the Ironwood design spec's Wallet Routing section, a Unified Address's Orchard receiver serves both pools: pre-NU6.3 it produces Orchard-pool outputs, post-activation the identical receiver produces Ironwood-pool outputs (quantum-recoverable note plaintext format, ZIP 2005 lead byte `0x03`), selected by consensus height rather than by address construction. Confirmed directly on regtest: sending to an ordinary Orchard-receiver UA after NU6.3 activation lands the output in the Ironwood pool. `getUnifiedAddress` needs no Ironwood-specific receiver logic; the SDK's job on the read side is pool *classification* (by note plaintext format / by Zaino's `ironwoodActions` vs. Orchard action fields), not pool *selection* on the address side.
2. **ZIP-318 exact construction.** Confirm the migration transaction shape against the published ZIP-318 (v6 tx; Orchard value balance positive, Ironwood negative) rather than the tracker summary used here.
3. **Indexer support (resolved, pin override required).** Zaino's serve layer is fully Ironwood-aware, verified end-to-end against Z3 regtest (`zebrad 6.2.3`, NU6.3 active at height 2):
   - `GetLightdInfo`: reports the correct `consensusBranchId` and `upgradeName: Nu6_3`.
   - `GetBlockRange`: serves Ironwood-pool actions as a distinct `ironwoodActions` array, structurally separate from Orchard actions — confirmed with a real Ironwood transaction (mined coinbase to an Orchard-receiver UA post-activation, which routes automatically to Ironwood; see #1).
   - `GetTreeState` / `GetLatestTreeState`: returns valid `ironwoodTree` state.
   - `GetSubtreeRoots`: **Z3's default Zaino pin (0.6.0) does not support this for Ironwood** — the `ShieldedProtocol` enum lacks an `ironwood` variant and the RPC returns `InvalidArgument`. This is fixed in Zaino ≥ 0.10.0 (`ironwood = 2` added to the enum; confirmed present in `zaino-proto/lightwallet-protocol/walletrpc/service.proto`). Verified functional via a matched-condition control: querying `GetSubtreeRoots` for both Orchard (known-mature) and Ironwood on the same chain, below the 65,536-note subtree boundary, returns identical (empty, clean-exit) behavior for both pools — consistent with correctly-wired logic rather than a stub.
   - **Action:** `create-zcash-app` overrides Z3's default pin: `Z3_ZAINO_IMAGE=zingodevops/zainod:0.10.0` (or newer). Filed as a documentation gap upstream against Z3 (README's Indexer section only documents the Zebra-version compatibility direction, not the Zaino-version floor needed for Ironwood spend-proving support). Legacy lightwalletd does not serve Ironwood at all — use it only for Orchard/Sapling.
4. **grpc-web proxy.** Confirm the supported grpc-web front for the browser path (Zaino built-in vs. Envoy), and document it in the wallet-lite template.
5. **Sapling.** Decide whether the SDK reads legacy Sapling notes (balance only) or ignores them; sends target Orchard/Ironwood only. If Sapling proving is ever needed, it requires the Sapling parameters.
6. **Binding to librustzcash.** Decide whether the core wraps `zcash_client_backend` wallet primitives directly or reimplements selection in Rust; the former is less code and tracks upstream, the latter is more control.
7. **ztap faucet (decided — building it).** Public faucets were tested and found non-functional, so we ship **ztap**: a self-hostable, self-mining, Ironwood-capable testnet faucet with browser proof-of-work (MIT), specified separately. It shares this SDK's crypto core (zainod ≥ 0.6.0, v6-aware) so Ironwood drips reuse the same stack. Teams self-host; no central service is operated. Remaining details to settle in the ztap spec: PoW difficulty tuning and per-address drip rate limits.

---

*Scope note: this spec covers the SDK surface only. The scaffolder templates and CI recipe consume this API; they're covered at the roadmap level in the ZCG proposal (Milestones 1, 3, 4), not re-specified here. A matching engineering-level spec for them is future work, not a Milestone-0 blocker.*
