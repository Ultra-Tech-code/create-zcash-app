# Zallet v0.1.0-beta.4 + Zebra 7.0.0 Spike (NU7 Regtest)

> **NOTE**: This directory contains an experimental research spike. It is **NOT** wired into the default `create-zcash-app` shipping stack. The shipping NU7 development stack uses standalone Zebra 7.0.0 + `lightwalletd`.

## Overview

This spike evaluates running [Zallet v0.1.0-beta.4](https://github.com/zcash/zallet/releases/tag/v0.1.0-beta.4) directly against a co-located [Zebra 7.0.0](https://github.com/ZcashFoundation/zebra/releases/tag/v7.0.0) consensus node on an NU7-activated regtest chain without Zaino or lightwalletd.

The raw session transcript for this spike is preserved in `packages/core/tests/logs/zallet_nu7_spike.log` (SHA-256: `ab7fdd6249c6cae4c9e3282903af83e6c14224f1af01c0280377a14d765ddeca`).

## Pinned Container Images

- **Zebra Consensus Node**: `zfnd/zebra:7.0.0`
- **Zallet Wallet Daemon**: `zodlinc/zallet@sha256:682ba6f9a9931ac25f6a2eb2218f39e0bf5295c3cbe4d8dfa3fc275c34559506`

### Note on Zebra `indexer` Cargo Feature vs. Stock Docker Image
Zebra's documentation ([Running Zallet with Zebra](https://zebra.zfnd.org/user/zallet.html)) notes that official release binaries and published Docker images (`zfnd/zebra:7.0.0`) are built with:
```text
features: default,default_release_binaries,howudoin,indicatif,metrics_exporter_prometheus,opentelemetry,progress_bar,prometheus,release_max_level_info,sentry
```
The Cargo `indexer` feature is **not** compiled into the stock release image.
- When `indexer_listen_addr = "0.0.0.0:8230"` is provided in `zebrad.toml`, Zebra successfully spawns the indexer gRPC server (`zebra_rpc::indexer::server: Opened RPC endpoint at 0.0.0.0:8230`), which Zallet uses to follow chain tip changes and non-finalized blocks.
- However, because the database was compiled without the `indexer` feature, Zebra does not populate the spending-transaction index on disk.
- **Consequence for Spend Detection**: Zallet reads an empty spending-transaction index from Zebra's disk cache, meaning transparent spend tracking (mapping UTXOs to their spending transactions) is non-functional with the stock image. Shielded state (note commitment trees and nullifiers) is part of Zebra's standard consensus state (v29.0.0), which is why shielded Ironwood note detection (`z_listunspent`) and v6 spending (`z_sendmany`) succeed cleanly in this spike. Fully functional transparent spend tracking in Zallet requires custom-building Zebra from source with `--features "default-release-binaries indexer"`.

## Required Workarounds

Running Zallet beta.4 directly with Zebra's local state cache requires two specific runtime workarounds:

### 1. Volume Sharing & `--user 0:0` (Filesystem Permissions)
- **Problem**: In the official Docker images, `zebrad` runs as UID 10001 and writes its RocksDB database cache to `/home/zebra/.cache/zebra` with mode `0700`. Zallet's distroless container runs by default as UID 1000. When Zallet attempts to open Zebra's state cache as read-only secondary state at `/zebra-cache`, it encounters `Permission denied (os error 13)`.
- **Workaround**: Run the Zallet container with `--user 0:0` (root) so it has read access to Zebra's shared state volume.

### 2. `--tmpfs /tmp` (Missing Temp Directory in Distroless Image)
- **Problem**: Zallet runs inside a minimal distroless container that lacks a pre-created `/tmp` directory. When opening Zebra's RocksDB state in secondary mode, the RocksDB driver calls `std::env::temp_dir()` to create a secondary state lock/directory at `/tmp/zebra-secondary_state-v29-regtest-...`. Because `/tmp` does not exist, Zallet panics immediately on startup:
  ```text
  panicked at /cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tempfile-3.14.0/src/dir.rs:242:14:
  temporary directory is created successfully: Custom { kind: NotFound, error: PathError { path: "/tmp/zebra-secondary_state-v29-regtest-...", err: Os { code: 2, kind: NotFound } } }
  ```
- **Workaround**: Supply `--tmpfs /tmp` to `docker run` or configure `tmpfs: [/tmp]` in `docker-compose.yml`.

## How to Reproduce

You can run the automated script:
```bash
./packages/dev/docker/spikes/zallet-beta4/run-spike.sh
```

Or run with Docker Compose:
```bash
cd packages/dev/docker/spikes/zallet-beta4
docker compose up -d zebra
# Wait for Zebra to start, then mine blocks:
curl -s -X POST -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","method":"generate","params":[10],"id":1}' http://127.0.0.1:49232
# Initialize keystore in zallet-data volume:
docker compose run --rm zallet -d /data generate-encryption-identity
docker compose run --rm zallet -d /data init-wallet-encryption
# Start Zallet:
docker compose up -d zallet
```

## Observed Capabilities & Issues

1. **NU7 Shielded Support**:
   - `getwalletinfo` returns account-level balances cleanly.
   - `z_listunspent` correctly recognizes mature NU7 Ironwood-pool notes (`pool: "ironwood"`, value `2.08333333` ZEC).
   - `z_sendmany` successfully constructs, performs Halo 2 proving, and broadcasts version 6 (v6) Ironwood shielded transactions (verified in block 116, txid `30c108ab1881fc8c945f37fb96d4c478230d25c6e951fc402d3b33961769b558`).
2. **Upstream `z_listtransactions` Crash**:
   - Calling `z_listtransactions` fails with:
     ```json
     {
       "code": -20,
       "message": "Data DB is corrupted: Invalid memo data: InvalidUtf8(Utf8Error { valid_up_to: 2, error_len: Some(1) })"
     }
     ```
   - This occurs because Zallet's compact transaction parser treats raw coinbase memo bytes as UTF-8. While [Zallet PR #866](https://github.com/zcash/zallet/pull/866) fixed this for `z_listunspent` by omitting unreadable memos, `z_listtransactions` was not updated and still aborts the entire call (tracked under open [Zallet Issue #794](https://github.com/zcash/zallet/issues/794)).
   - **Drafted Upstream Issue Text** (ready for filing if requested):
     ```markdown
     Title: rpc: z_listtransactions aborts with InvalidUtf8 error when notes contain arbitrary memo bytes (e.g. coinbase outputs)

     Environment:
     - Zallet version: v0.1.0-beta.4 (zodlinc/zallet@sha256:682ba6f9a9931ac25f6a2eb2218f39e0bf5295c3cbe4d8dfa3fc275c34559506)
     - Backend: zebra (co-located stock zfnd/zebra:7.0.0 with indexer_listen_addr enabled)
     - Network: Regtest (NU7 activated at height 2)

     Description:
     Calling z_listtransactions on an account that received coinbase outputs (or outputs with arbitrary non-UTF-8 memo data) fails with:
     {
       "jsonrpc": "2.0",
       "error": {
         "code": -20,
         "message": "Data DB is corrupted: Invalid memo data: InvalidUtf8(Utf8Error { valid_up_to: 2, error_len: Some(1) })"
       },
       "id": 1
     }

     Expected Behavior:
     In PR #866 (closing #695), z_listunspent was updated to omit memo fields when a note's memo cannot be decoded as UTF-8 rather than failing the entire request.
     z_listtransactions should implement the same error handling so that a single note with non-UTF-8 memo bytes does not crash the entire transaction list retrieval.
     ```

3. **Missing `listtransactions`**:
   - Standard Bitcoin/zcashd RPC `listtransactions` does not exist in Zallet.
