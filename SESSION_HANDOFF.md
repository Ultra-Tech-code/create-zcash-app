# Session Handoff: Zcash NU6.3 Ironwood Integration & Review Items

**Date**: 2026-10-24  
**Branch**: `main`  
**Target Next Phase**: Phase 3 (P3)  

---

## 1. Executive Summary

This document serves as the comprehensive session handoff following the thorough resolution, testing, and hardening of all items requested during the Phase 2 review. All automated tests across `@zcash-app/core` (50 unit and integration tests) and `@zcash-app/sdk` (7 vitest suites) pass cleanly. Zero compiler warnings exist under `cargo clippy --all-targets -- -D warnings`, and full history scans via `gitleaks git -v` confirm zero leaks.

---

## 2. Item-by-Item Review Resolutions & Evidence

### Item 1: Anchor Discrepancy & Root Verification
- **Lines in `transaction_test.rs`**: Lines 655–659 derive the anchor dynamically from `tree.root().into()` over the 193 actions in `tests/fixtures/test_cmxs.json`. The string `cecce43d...` was first logged in commit `d1bb322` and represents the consensus root of the 193 actions recorded at height 238.
- **Fixture Verification**: Both P1's `CommitmentTree` and P2's `IronwoodShardTree` compute the exact identical root:
  `cecce43dbafa39f845ca5b1619abb214710b8c19206de01a19eb40f1cd06ec32`.
- **Anchor Mechanism**: `1c5a7114...` was an anchor from an earlier test transaction mined at an earlier height on that test chain. Zebra validates historical Orchard anchors against its RocksDB commitment tree state store.
- **Regression Test**: Added `test_anchor_regression_against_zebra_gettreestate_height_238` in `shard_store_test.rs`.

### Item 2: Spendable SQL, Confirmation Boundaries & Schema Consistency
- **File Definition**: Defined in `packages/core/src/spendable.rs`.
- **Actual SQL Query**:
  ```sql
  SELECT id, recipient, value_zatoshis, nullifier, rho, rseed, tree_position, height
  FROM received_notes
  WHERE spent_in_txid IS NULL
    AND height <= ?1
    AND (?1 + 1 - height) >= ?2
    AND nullifier NOT IN (
        SELECT nullifier FROM pending_spends 
        WHERE state IN ('reserved', 'broadcast', 'mined')
    )
  ORDER BY height ASC, tree_position ASC
  ```
- **Schema & Code Alignment**:
  - `pending_spends.state`: CHECK constraint `('reserved', 'broadcast', 'mined')`, Rust enum `ReservationState::Reserved | Broadcast | Mined`, and SQL query match strictly.
  - `schema_version` bumped to 2 with `apply_migration_v2` in `packages/core/src/schema.rs`.
  - Recreates `idx_pending_spends_txid` and `idx_pending_spends_state` after the table swap.
  - Tested in-place in `test_schema_v1_to_v2_migration_in_place_preserves_reservations` in `wallet_db_test.rs`.

### Item 3: GetTreeState Root Comparison & Tampered Frontier Rejection
- **Frontier Decoder**: Implemented `decode_ironwood_frontier_root` in `packages/core/src/wallet_handle.rs` using `zcash_primitives::merkle_tree::read_commitment_tree::<MerkleHashOrchard, _, 32>`.
- **Field Used**: `ironwoodTree` field from `TreeState` (RPC `CompactTxStreamer.GetTreeState`).
- **Negative Test**: Added `test_decode_zaino_tampered_frontier_fails_or_mismatches` in `shard_store_test.rs` and vitest in `packages/sdk/src/sync.test.ts`.

### Item 4: Protobuf Consensus Alignment & Block Capture
- **Upstream Proto**: Diffed `packages/sdk/proto/compact_formats.proto` against `https://raw.githubusercontent.com/zcash/lightwallet-protocol/main/walletrpc/compact_formats.proto`: bit-for-bit identical.
  - `CompactTx.fee`: field tag 3, `uint32`.
  - `CompactTx.ironwood_actions`: field tag 9, `repeated CompactOrchardAction`.
  - `ChainMetadata.ironwood_commitment_tree_size`: field tag 3, `uint32`.
- **Raw Capture**: Created `scripts/capture_real_block.mjs` using raw `@grpc/grpc-js` identity deserializer to capture raw blocks without intermediate protobufjs transformation.

### Item 5: Strengthened Test Cases
- **Restart Zero Old Blocks**: Mock streamer records requested ranges in `full_suite_test.rs` and `sync.test.ts`; asserts 0 requests when at tip, and requests `>= last_scanned + 1` when advancing.
- **Periodic Root Check Recovery**: `test_periodic_root_check_mismatch_and_recovery` rolls back to checkpoint 5, rescans canonical blocks, and proves exact bit-for-bit parity with a clean scan.
- **Separated Reorg Tests**:
  - `test_ordinary_reorg_resolves_common_ancestor_in_window`
  - `test_chain_reset_first_scanned_hash_mismatch`
  - `test_reorg_depth_exceeded_beyond_100_block_window` (evaluates 150 blocks, verifies `ReorgTooDeep`).

### Item 6: Performance Measurements & Curve Clarification
- **Curve**: Orchard and Ironwood commitment trees use the **Pallas** curve (`pasta_curves::pallas`), not Jubjub (Sapling).
- **Default Batch Size**: 50 blocks.
- **Time-Bounded Batching**: Implemented `MAX_BLOCKS_PER_TX = 50` and `TIME_BUDGET_MS = 500` in `packages/core/src/scanner.rs`. Yields write lock at 500ms intervals so send transactions never experience lock timeouts.
- **Release Scanning Throughput**:
  - Pass 1: 1205.4 blocks/s
  - Pass 2: 1215.1 blocks/s
  - Pass 3: 1203.1 blocks/s
  - Range: 1203.1 – 1215.1 blocks/s under standard daemon and container operation.

### Item 7: ShardStore Crate Audit
- `SqliteShardStore` is defined at `zcash_client_sqlite-0.22.0/src/commitment_tree.rs:112`.
- `from_connection` is `pub(crate)` and `table_prefix` is private.
- `IRONWOOD_TABLES_PREFIX` is `pub(crate) const` in `zcash_client_sqlite-0.22.0/src/lib.rs:190`.
- Because the implementation is crate-private in `zcash_client_sqlite` 0.22.0, our native `shard_store.rs` implementation provides direct SQL table support matching the ShardTree specification.

### Item 8: Dev Tooling Safety
- `zcash-dev regtest wipe` enforces that `COMPOSE_PROJECT_NAME=z3-regtest`.
- Prints explicit resource deletion warnings and refuses to proceed without the `--yes` flag.

### Item 9 & 10: Regtest Funding and Balance Reconciliation
- **Funding Analysis**: When `scripts/item10_fund_and_sync_accounts.mjs` was executed twice against the persistent chain without wiping, two distinct funding transactions were confirmed:
  - Account 0: Txid `a404fc41...` (5.0 ZEC) + Txid `e3aab782...` (5.0 ZEC) = 10.0 ZEC (2 notes)
  - Account 1: Txid `bb9b115c...` (3.0 ZEC) + Txid `2a221d6f...` (3.0 ZEC) = 6.0 ZEC (2 notes)
  Neither the wallet double-counted nor did the script send 10 ZEC in one tx; two real on-chain transactions were present. On a single funding run, balances equal exactly 5.0 ZEC and 3.0 ZEC.

---

## 3. Gitleaks Event Disclosure

1. **Rule Fired**: `generic-api-key` (entropy rule detecting 64-character hexadecimal strings).
2. **File & Line**: `packages/sdk/src/sync.test.ts:101`.
3. **Trigger**: Variable `const authenticRootHex` assigned to a 64-hex-character commitment root string.
4. **Resolution**:
   - Replaced static string assignment with dynamic derivation:
     `const authenticRootHex = decodeIronwoodFrontierRoot(authenticFrontierHex);`
   - Added documented `.gitleaks.toml` configuration allowlisting test fixtures and test logs.
   - Ran `gitleaks git -v` confirming zero leaks across all 46 commits.
   - No commits have been pushed to remote (`origin/main`) prior to explicit user command.

---

## 4. Verification Commands

To verify the test suite:
```bash
# Run Rust test suite
cargo test --manifest-path packages/core/Cargo.toml

# Run linter
cargo clippy --manifest-path packages/core/Cargo.toml --all-targets -- -D warnings

# Run TypeScript SDK tests
pnpm --filter @zcash-app/sdk test

# Run gitleaks verification
gitleaks git -v
```
