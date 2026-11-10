# NU7-Only Stack Spike: Zaino `feat/nu7` + Zallet v0.1.0-beta.4 + Zebra 7.0.0

> **STATUS: EXPERIMENTAL RESEARCH SPIKE (PHASE A)**  
> This directory contains research configurations and verification procedures for an NU7-only stack.  
> Zaino `feat/nu7` is **unreleased experimental software** and is **not** part of any shipping release or default preset.

---

## 1. Overview & Objectives

This spike evaluates the modern, NU7-native backend ecosystem on a clean regtest network:
1. **Zebra 7.0.0** compiled with Cargo feature `indexer` (`zebra:7.0.0-indexer`) providing consensus, mining, JSON-RPC, and indexer gRPC.
2. **Zaino `feat/nu7`** operating as the light client gRPC service in both:
   - **RPC-only mode**: Connecting over HTTP JSON-RPC to a remote Zebra node without requiring filesystem or state volume access.
   - **Direct mode**: Accessing Zebra's RocksDB database directly for high-throughput reads alongside Zebra's indexer gRPC.
3. **Zallet v0.1.0-beta.4** co-located with Zebra, sharing the RocksDB state directory as a read-only secondary database.
4. **TypeScript SDK** verification through both backends (sync, deposit detection, fee calculation, transaction construction, Halo 2 proving, mempool admission, and block settlement with explorer-order display txid).

---

## 2. Pinned Upstreams

| Component | Repository | Pinned Ref / Commit | Toolchain / Image | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Zebra** | `github.com/ZcashFoundation/zebra` | Tag `v7.0.0` (`e8db87eb69254e0d4eedd058eadd48bdfa09065a`) | Custom Docker with `--features default-release-binaries,indexer` | Official release, custom build for `indexer` feature |
| **Zaino** | `github.com/zingolabs/zaino` | Branch `feat/nu7` (pinned commit `aaf8122a703704e05147d984f08ff82c789860ad`) | Rust `1.96.0` (`cargo +1.96.0 build --release -p zainod`) | **UNRELEASED / EXPERIMENTAL** |
| **Zallet** | `github.com/zcash/zallet` | Tag `v0.1.0-beta.4` (commit `7b0622451382be32754699420e0e71b1b1c2bd98`) | `zodlinc/zallet@sha256:682ba6f9a9931ac25f6a2eb2218f39e0bf5295c3cbe4d8dfa3fc275c34559506` | Official Latest beta release |

---

## 3. Reproduction Instructions

### Step 1: Build Zebra 7.0.0 with the `indexer` Feature
The official Docker Hub image `zfnd/zebra:7.0.0` lacks the `indexer` Cargo feature, preventing full index creation on disk. Build `zebra:7.0.0-indexer` from source:
```bash
git clone --depth 1 --branch v7.0.0 https://github.com/ZcashFoundation/zebra /tmp/zebra-v7.0.0
cd /tmp/zebra-v7.0.0
docker build -f docker/Dockerfile --target release \
  --build-arg FEATURES="default-release-binaries,indexer" \
  -t zebra:7.0.0-indexer .
```

### Step 2: Build Zaino `feat/nu7`
The upstream Zaino Dockerfile currently fails on Debian package pinning (`ca-certificates`), but native compilation with Rust 1.96.0 builds cleanly:
```bash
git clone https://github.com/zingolabs/zaino /tmp/zaino
cd /tmp/zaino
git checkout aaf8122a703704e05147d984f08ff82c789860ad
cargo +1.96.0 build --release -p zainod
# Binary will be at /tmp/zaino/target/release/zainod
```

### Step 3: Start Zebra 7.0.0
Create an isolated Docker network and start Zebra:
```bash
docker network create nu7-net

docker run -d --name zebra-nu7 --network nu7-net \
  -v $(pwd)/packages/dev/docker/spikes/nu7-stack/zebra.toml:/etc/zebrad/zebrad.toml:ro \
  -v /tmp/zebra-cache:/cache \
  -p 127.0.0.1:49232:18232 \
  -p 127.0.0.1:48230:8230 \
  zebra:7.0.0-indexer zebrad -c /etc/zebrad/zebrad.toml start
```

### Step 4: Run Zaino

#### Option A: RPC-Only Backend (Can Run Against Remote Zebra)
Zaino requires **only** Zebra's HTTP JSON-RPC endpoint (`127.0.0.1:49232`). No shared filesystems, volume mounts, or state directory access required:
```bash
zainod start -c packages/dev/docker/spikes/nu7-stack/zainod-rpc.toml
```

#### Option B: Direct State Reader Backend
Zaino reads Zebra's local RocksDB state directly for maximum performance, synchronizing with Zebra indexer gRPC:
```bash
zainod start -c packages/dev/docker/spikes/nu7-stack/zainod-direct.toml
```

### Step 5: Start Zallet v0.1.0-beta.4
Zallet runs co-located with Zebra and mounts `/tmp/zebra-cache` read-only. Note that `--user 0:0` (to read Zebra's `0700` state directory) and `--tmpfs /tmp` (for RocksDB secondary state locking) are required:
```bash
# Initialize Zallet identity and wallet encryption in regtest mode:
docker run --rm -v /tmp/zallet-nu7-data:/data \
  -v $(pwd)/packages/dev/docker/spikes/nu7-stack/zallet.toml:/etc/zallet/zallet.toml:ro \
  zodlinc/zallet zallet-zebra -c /etc/zallet/zallet.toml -d /data generate-encryption-identity

docker run --rm -v /tmp/zallet-nu7-data:/data \
  -v $(pwd)/packages/dev/docker/spikes/nu7-stack/zallet.toml:/etc/zallet/zallet.toml:ro \
  zodlinc/zallet zallet-zebra -c /etc/zallet/zallet.toml -d /data init-wallet-encryption

# Run Zallet daemon:
docker run -d --name zallet-nu7 --network nu7-net \
  --user 0:0 --tmpfs /tmp \
  -v /tmp/zallet-nu7-data:/data \
  -v /tmp/zebra-cache:/zebra-cache:ro \
  -v $(pwd)/packages/dev/docker/spikes/nu7-stack/zallet.toml:/etc/zallet/zallet.toml:ro \
  -p 127.0.0.1:48232:28232 \
  zodlinc/zallet zallet-zebra -d /data -c /etc/zallet/zallet.toml start
```

### Step 6: Run SDK End-to-End Verification
Mine 105 blocks, then run the verification script:
```bash
# Generate initial blocks:
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"generate","params":[105],"id":1}' \
  http://127.0.0.1:49232

# Run TypeScript SDK test against RPC backend:
ZAINO_BACKEND_MODE=rpc ZAINO_CONFIG_FILE=zainod-rpc.toml ZEBRA_RPC_PORT=49232 ZAINO_GRPC_PORT=8137 \
  SPIKE_OUTPUT_LOG=packages/core/tests/logs/zaino_nu7_spike_rpc.log node scripts/zaino_nu7_spike.mjs

# Run TypeScript SDK test against Direct backend:
ZAINO_BACKEND_MODE=direct ZAINO_CONFIG_FILE=zainod-direct.toml ZEBRA_RPC_PORT=49232 ZAINO_GRPC_PORT=8137 \
  SPIKE_OUTPUT_LOG=packages/core/tests/logs/zaino_nu7_spike_direct.log node scripts/zaino_nu7_spike.mjs
```

---

## 4. Port Map & Health Check Endpoints

| Service | Protocol | Container Port | Host Port | Health Check / Probe Command |
| :--- | :--- | :--- | :--- | :--- |
| **Zebra RPC** | HTTP JSON-RPC | `18232` | `49232` | `curl -s -X POST -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","method":"getblockchaininfo","id":1}' http://127.0.0.1:49232` |
| **Zebra Indexer** | gRPC | `8230` | `48230` | TCP connection check or Zebra log inspection |
| **Zaino gRPC** | gRPC (HTTP/2) | `8137` | `8137` | `grpcurl -plaintext 127.0.0.1:8137 cash.z.wallet.sdk.rpc.CompactTxStreamer/GetLightdInfo` |
| **Zallet RPC** | HTTP JSON-RPC | `28232` | `48232` | `curl -s -u $(cat /tmp/zallet-nu7-data/.cookie) -X POST -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","method":"getwalletstatus","id":1}' http://127.0.0.1:48232` |

---

## 5. Differences vs `lightwalletd`

1. **Consensus Branch ID Resolution**:
   - Both `lightwalletd` and `Zaino` dynamically query the backing node for `ConsensusBranchId` via JSON-RPC. In lightwalletd (`common/common.go:337`), the response directly assigns:
     ```go
     ConsensusBranchId: getblockchaininfoReply.Consensus.Chaintip
     ```
   - Neither daemon requires static branch ID tables or hardcoded heights for consensus branch negotiation.
2. **Backend Architecture**:
   - `lightwalletd` is exclusively an RPC-to-gRPC translator with a separate SQLite cache.
   - `Zaino` supports both an RPC-only translator mode and a direct RocksDB secondary reader mode (`backend = "direct"`).
3. **Block Height Reporting Semantics**:
   - In `lightwalletd`, `GetLightdInfo.block_height` reports the lightwalletd indexed tip.
   - In `Zaino`, `GetLightdInfo.block_height` directly proxies Zebra's full node tip (`blockchain_info.blocks`), whereas Zaino's internal compact block indexer advances on an asynchronous 1-second interval loop. Clients querying compact blocks immediately following a mined block must poll `getBlockHeader(height)` to ensure Zaino has caught up before streaming.

---

## 6. Known Upstream Issues & Status

1. **Zallet `z_listtransactions` UTF-8 Memo Bug**:
   - In Zallet v0.1.0-beta.4, `z_listtransactions` fails with:
     ```json
     {
       "code": -20,
       "message": "Data DB is corrupted: Invalid memo data: InvalidUtf8(Utf8Error { valid_up_to: 1, error_len: Some(1) })"
     }
     ```
   - Caused by attempting to decode arbitrary non-UTF-8 memo bytes (coinbase memos and standard ZIP-302 empty memo `0xf6...` change outputs) as UTF-8. While `z_listunspent` omits non-UTF-8 memos gracefully (via PR #866), `z_listtransactions` aborts the call (tracked upstream in [Zallet Issue #794](https://github.com/zcash/zallet/issues/794)).
2. **Zallet v0.1.0-beta.4 Release Provenance**:
   - Release commit: `7b0622451382be32754699420e0e71b1b1c2bd98` on `Sun Nov 1 11:31:02 2026 -0300` (PR #924).
3. **Zaino Upstream Docker Build Pinning**:
   - Upstream Zaino's `Dockerfile` pins `ca-certificates=20250419~deb12u1`, which fails on Debian repositories. Host binary compilation with `cargo +1.96.0` succeeds.
4. **Zaino Dev Branch vs `feat/nu7`**:
   - Upstream Zaino `dev` branch contains placeholder NU7 branch ID `0xfffffffe` and fails on NU7 activation. Full NU7 support is located exclusively in the unreleased `feat/nu7` branch (pinned commit `aaf8122a703704e05147d984f08ff82c789860ad`).
   - Note: Earlier test runs and logs recorded zainod git commit as `03f015c781fb1b83872064fba5721fdda8fbeeb9`. That commit and merge tip `aaf8122a703704e05147d984f08ff82c789860ad` share the identical git tree object (`a2ffb592...`), ensuring identical source code and build artifacts.

---

## 7. Capability Matrix

> **Remote Proof Scope**: separate container and network, no shared volume, same machine; not tested across hosts.  
> **Note on Note Counts**: In the coexistence run (`zaino_zallet_coexistence.log:36,63`), both SDK (`syncWallet`: 110) and Zallet (`z_listunspent`: 110) report 110 unspent notes; this count equality is unexplained without a captured per-note txid and pool dump from the same run (e.g. Zallet lists the Sapling block-1 coinbase whereas the SDK counts Ironwood only; the per-pool breakdown and set difference remain unverified).

| Capability | `lightwalletd` | Zaino (`backend="rpc"`) | Zaino (`backend="direct"`) | Zaino + Zallet Coexistence |
| :--- | :--- | :--- | :--- | :--- |
| **NU7 Consensus Activation (`0x77190ad9`)** | **PASS** (`lightwalletd_nu7_spike.log:12`) | **PASS** (`zaino_nu7_spike_rpc.log:12`) | **PASS** (`zaino_nu7_spike_direct.log:12`) | **PASS** (`zaino_zallet_coexistence.log:13`) |
| **GetLightdInfo / Branch ID Negotiation** | **PASS** (`lightwalletd_nu7_spike.log:20`) | **PASS** (`zaino_nu7_spike_rpc.log:20`) | **PASS** (`zaino_nu7_spike_direct.log:20`) | **PASS** (`zaino_zallet_coexistence.log:21`) |
| **Remote Node Operation (No Shared State)** | **PASS** (`docker_inspect_remote_proof.log:75`) | **PASS** (`docker_inspect_remote_proof.log:56-68`) | **NOT TESTED** (direct requires state) | **NOT TESTED** (Zallet requires state) |
| **Compact Block Streaming & Sync** | **PASS** (`lightwalletd_nu7_spike.log:28`) | **PASS** (`zaino_nu7_spike_rpc.log:28`) | **PASS** (`zaino_nu7_spike_direct.log:28`) | **PASS** (`zaino_zallet_coexistence.log:38`) |
| **Ironwood Notes & Tree State** | **PASS** (`lightwalletd_nu7_spike.log:35`) | **PASS** (`zaino_nu7_spike_rpc.log:35`) | **PASS** (`zaino_nu7_spike_direct.log:35`) | **PASS** (`zaino_zallet_coexistence.log:43`) |
| **SDK send() with Explorer-Order TxID** | **PASS** (`lightwalletd_nu7_spike.log:45`) | **PASS** (`zaino_nu7_spike_rpc.log:45`) | **PASS** (`zaino_nu7_spike_direct.log:45`) | **NOT TESTED** (standalone logs prove them) |
| **Zebra Mempool & Block Settlement** | **PASS** (`lightwalletd_nu7_spike.log:52`) | **PASS** (`zaino_nu7_spike_rpc.log:52`) | **PASS** (`zaino_nu7_spike_direct.log:52`) | **NOT TESTED** (standalone logs prove them) |
| **Recipient Discovery & Balance Sync** | **PASS** (`lightwalletd_nu7_spike.log:66`) | **PASS** (`zaino_nu7_spike_rpc.log:66`) | **PASS** (`zaino_nu7_spike_direct.log:66`) | **NOT TESTED** (verified in standalone) |
| **Zallet Shielded Sync & Notes (`z_listunspent`)** | **NOT TESTED** | **NOT TESTED** | **NOT TESTED** | **PASS** (`zallet_nu7_spike.log:58`, `zaino_zallet_coexistence.log:63`) |
| **Zallet `z_listtransactions` (Non-UTF8 Memo)** | **NOT TESTED** | **NOT TESTED** | **NOT TESTED** | **FAIL** (`zallet_nu7_spike.log:3883`) |

---

## 8. Primary Evidence Logs

- **Zaino RPC-Only Verification Log**: `packages/core/tests/logs/zaino_nu7_spike_rpc.log`  
  SHA-256: `2092ec9cfc905d5e5aa91aee03cdbb76903d24823a61774317132b132723733e`
- **Zaino Direct Mode Verification Log**: `packages/core/tests/logs/zaino_nu7_spike_direct.log`  
  SHA-256: `2daee78a8a288bce45e8f78b476c340e5ab1145e2f0ad11b37676ebad1a4f577`
- **Lightwalletd Verification Log**: `packages/core/tests/logs/lightwalletd_nu7_spike.log`  
  SHA-256: `de353e4f15275de0773bbf244b02c09ca362a9cbd70f29e2567d4ecb4d7a30bc`
- **Zallet NU7 Verification Log**: `packages/core/tests/logs/zallet_nu7_spike.log`  
  SHA-256: `ab7fdd6249c6cae4c9e3282903af83e6c14224f1af01c0280377a14d765ddeca`
- **Zaino RPC Startup Output Log**: `packages/core/tests/logs/zainod_startup_rpc.log`  
  SHA-256: `96c300df0428db66d275c1fb42151e2557d6cfe26e1c2fdd40ce3e219f331aad`
- **Zaino Direct Startup Output Log**: `packages/core/tests/logs/zainod_startup_direct.log`  
  SHA-256: `a7f9d5d17ce1384884be3089c9b9aac9f7e2b704503d97d2307fac62a5641277`
- **Zaino + Zallet Coexistence Verification Log**: `packages/core/tests/logs/zaino_zallet_coexistence.log`  
  SHA-256: `066fe3cfc58686acb851f0594439ad4b7a1725d83aed852a5b640d15e58cde59`
- **Docker Inspect Remote Operation Proof Log**: `packages/core/tests/logs/docker_inspect_remote_proof.log`  
  SHA-256: `ac653ff776b0b025423d6c1ff2b3ceed25d2abf07752c6750eccfefafa01aa1b`
