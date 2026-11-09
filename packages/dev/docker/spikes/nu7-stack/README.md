# NU7-Only Stack Spike: Zaino `feat/nu7` + Zallet v0.1.0-beta.4 + Zebra 7.0.0

> **STATUS: EXPERIMENTAL RESEARCH SPIKE (PHASE A)**  
> This directory contains research configurations and verification procedures for an NU7-only stack.  
> Zaino `feat/nu7` is **unreleased experimental software** and is **not** part of any shipping release or default preset.

---

## 1. Overview & Objectives

This spike evaluates the modern, NU7-native backend ecosystem on a clean regtest network:
1. **Zebra 7.0.0** compiled with Cargo feature `indexer` (`zebra:7.0.0-indexer`) providing consensus, mining, JSON-RPC, and indexer gRPC.
2. **Zaino `feat/nu7`** operating as the light client gRPC service in both:
   - **RPC-only mode**: Connecting over HTTP JSON-RPC to a potentially remote Zebra node without requiring filesystem or state volume access.
   - **Direct mode**: Accessing Zebra's RocksDB database directly for high-throughput reads alongside Zebra's indexer gRPC.
3. **Zallet v0.1.0-beta.4** co-located with Zebra, sharing the RocksDB state directory as a read-only secondary database.
4. **TypeScript SDK** verification through Zaino gRPC (sync, deposit detection, fee calculation, transaction construction, Halo 2 proving, mempool admission, and block settlement).

---

## 2. Pinned Upstreams

| Component | Repository | Pinned Ref / Commit | Toolchain / Image | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Zebra** | `github.com/ZcashFoundation/zebra` | Tag `v7.0.0` (`e8db87eb69254e0d4eedd058eadd48bdfa09065a`) | Custom Docker with `--features default-release-binaries,indexer` | Official release, custom build for `indexer` feature |
| **Zaino** | `github.com/zingolabs/zaino` | Branch `feat/nu7` (`03f015c781fb1b83872064fba5721fdda8fbeeb9` / merge tip `aaf8122a703704e05147d984f08ff82c789860ad`) | Rust `1.96.0` (`cargo +1.96.0 build --release -p zainod`) | **UNRELEASED / EXPERIMENTAL** |
| **Zallet** | `github.com/zcash/zallet` | Tag `v0.1.0-beta.4` | `zodlinc/zallet@sha256:682ba6f9a9931ac25f6a2eb2218f39e0bf5295c3cbe4d8dfa3fc275c34559506` | Official Latest beta release |

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
git checkout 03f015c781fb1b83872064fba5721fdda8fbeeb9
cargo +1.96.0 build --release -p zainod
# Binary will be at /tmp/zaino/target/release/zainod
```

### Step 3: Start Zebra 7.0.0
Create an isolated Docker network and start Zebra:
```bash
docker network create nu7-net

docker run -d --name zebra-nu7 --network nu7-net \
  -v $(pwd)/packages/dev/docker/spikes/nu7-stack/zebra.toml:/etc/zebrad/zebrad.toml:ro \
  -v /tmp/zebra-cache:/home/zebra/.cache/zebra \
  -p 127.0.0.1:49232:18232 \
  -p 127.0.0.1:48230:8230 \
  zebra:7.0.0-indexer zebrad start
```

### Step 4: Run Zaino

#### Option A: RPC-Only Backend (Can Run Against Remote Zebra)
Zaino requires **only** Zebra's HTTP JSON-RPC endpoint (`127.0.0.1:49232`). No shared filesystems, volume mounts, or state directory access required:
```bash
zainod -c packages/dev/docker/spikes/nu7-stack/zainod-rpc.toml start
```

#### Option B: Direct State Reader Backend
Zaino reads Zebra's local RocksDB state directly for maximum performance, synchronizing with Zebra indexer gRPC:
```bash
zainod -c packages/dev/docker/spikes/nu7-stack/zainod-direct.toml start
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
Mine 105 blocks to reach maturity, then run the end-to-end verification script:
```bash
# Generate initial blocks:
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"generate","params":[105],"id":1}' \
  http://127.0.0.1:49232

# Run full TypeScript SDK test suite against Zaino:
node scripts/zaino_nu7_spike.mjs
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

1. **Consensus Branch ID Negotiation**:
   - `lightwalletd` relies on static branch ID tables or hardcoded activation heights.
   - Zaino negotiates the active consensus branch dynamically from Zebra (`77190ad9` for NU7) without patching or hardcoded schedules.
2. **Ironwood & V6 Support**:
   - Zaino `feat/nu7` implements `ironwoodActions` within compact blocks and serializes `ironwoodTree` roots in `GetTreeState`.
3. **Block Height Reporting Semantics**:
   - In Zaino, `GetLightdInfo.block_height` immediately reflects Zebra's full node tip (`blockchain_info.blocks`).
   - Compact block indexing in Zaino operates asynchronously on an internal 1-second interval loop. Clients querying compact blocks immediately upon mining must check `getBlockHeader(height)` to ensure Zaino has caught up before streaming.
4. **Backend Architecture**:
   - `lightwalletd` is exclusively an RPC-to-gRPC translator that creates an on-disk cache database.
   - Zaino supports both an RPC-only translator mode and a direct RocksDB secondary reader mode.

---

## 6. Known Upstream Issues

1. **Zallet `z_listtransactions` UTF-8 Memo Bug**:
   - In Zallet v0.1.0-beta.4, `z_listtransactions` fails with:
     ```json
     {
       "code": -20,
       "message": "Data DB is corrupted: Invalid memo data: InvalidUtf8(Utf8Error { valid_up_to: 1, error_len: Some(1) })"
     }
     ```
   - Caused by attempting to decode arbitrary non-UTF-8 memo bytes (coinbase memos and standard ZIP-302 empty memo `0xf6...` change outputs) as UTF-8. While `z_listunspent` omits non-UTF-8 memos gracefully (via PR #866), `z_listtransactions` aborts the call.
2. **Zaino Upstream Docker Build Pinning**:
   - Upstream Zaino's `Dockerfile` pins `ca-certificates=20250419~deb12u1`, which fails on Debian repositories. Host binary compilation with `cargo +1.96.0` succeeds.
3. **Zaino Dev Branch NU7 Support**:
   - Upstream Zaino `dev` branch contains placeholder NU7 branch ID `0xfffffffe` and fails. Full NU7 support is located exclusively in the unreleased `feat/nu7` branch (commit `03f015c781fb1b83872064fba5721fdda8fbeeb9` / merge `aaf8122a703704e05147d984f08ff82c789860ad`).

---

## 7. Primary Evidence Logs

- **Zaino NU7 Verification Log**: `packages/core/tests/logs/zaino_nu7_spike.log`  
  SHA-256: `4f3199d36e19b4ed7b2c0fb0399ae3209cfaaa2a844f583c2152817a1706eddf`
- **Zallet NU7 Verification Log**: `packages/core/tests/logs/zallet_nu7_spike.log`  
  SHA-256: `ab7fdd6249c6cae4c9e3282903af83e6c14224f1af01c0280377a14d765ddeca`
