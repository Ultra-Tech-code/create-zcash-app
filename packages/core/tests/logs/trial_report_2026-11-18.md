# Regtest Trial Report: Zebra 7.1.0 and lightwalletd v0.6.2

Date: 2026-11-18  
Branch: `chore/trial-zebra-7.1-lwd-0.6.2`  
Author: Adewale Iyanuoluwa Isaac <hizick27@gmail.com>  

## 1. Upstream Artifact Resolution (Step 0)

All trial artifacts were resolved and verified against upstream releases:

1. **Zebra 7.1.0 Docker image & source**:
   - Repository: `zfnd/zebra:7.1.0`
   - Manifest digest: `sha256:4f9536c8061e407f9f2ec81b7e0dd2f1762f81deec316abb1530dca8796a33ba`
   - Version output: `zebrad 7.1.0+git.534549f`
   - Tag object vs Peeled Commit:
     - `git ls-remote https://github.com/ZcashFoundation/zebra 'refs/tags/v7.1.0*'` resolves two separate objects:
       - Annotated tag object (`refs/tags/v7.1.0`): `3114775f157d809b8cd7c679edbaa82a904e7b8a`
       - Underlying peeled commit (`refs/tags/v7.1.0^{}`): `534549fe6b4c851b4785515fd03380cbea9e1a23`
     - The peeled commit `534549fe6b4c851b4785515fd03380cbea9e1a23` matches the commit hash prefix `534549f` in `zebrad 7.1.0+git.534549f` and must be used for `git checkout` in source builds. Tag object `3114775f...` is the annotated tag object and is not a commit.
   - Target Cargo features for custom indexer build: `"default-release-binaries,indexer"`

2. **lightwalletd v0.6.2 Docker image**:
   - Repository: `electriccoinco/lightwalletd:v0.6.2` (`--platform linux/amd64`)
   - Manifest digest: `sha256:75e5742df686094556abef66e69c37bc114de23a0706712aee324f332ca52951`
   - Binary version: `v0.6.2`, commit `f8fe2cca7ede03b1f06b1d637a2ab467d151b79d` (2026-11-18)
   - New flags:
     - `--client-stream-idle-timeout uint` (default `30` seconds)
     - `--max-concurrent-recv uint` (default `32`)

Evidence logs:
- `packages/core/tests/logs/trial_artifacts_2026-11-18.log:1-55`
- `packages/core/tests/logs/trial_full_zebra710_stock.log:185-262`
- `packages/core/tests/logs/trial_full_zebra710_indexer.log:1-77,257-303`

---

## 2. Canonical Smoke Matrix Across Regtest Stacks (Step 1)

Each stack was wiped to genesis and exercised through the full end-to-end lifecycle. The full stack was trialed twice: first with the stock `zfnd/zebra:7.1.0` Docker image, and second with the custom-built `zebra:7.1.0-indexer` image built from peeled commit `534549fe6b4c851b4785515fd03380cbea9e1a23` with features `"default-release-binaries,indexer"`.

| Stack | up | fund | anchor check | send | txid order | Zallet / Zaino check |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **lightwalletd** (`zebra:7.1.0` + `lwd:v0.6.2`) | **PASS**<br>`packages/core/tests/logs/trial_lightwalletd_zebra710.log:31-76` | **PASS**<br>`packages/core/tests/logs/trial_lightwalletd_zebra710.log:145-163` | **PASS**<br>`packages/core/tests/logs/trial_lightwalletd_zebra710.log:152,198,230-231` | **PASS**<br>`packages/core/tests/logs/trial_lightwalletd_zebra710.log:180-209` | **PASS**<br>`packages/core/tests/logs/trial_lightwalletd_zebra710.log:223-226` | **PASS** (Indexer info)<br>`packages/core/tests/logs/trial_lightwalletd_zebra710.log:74-98` |
| **zaino** (`zebra:7.1.0` + `zaino:nu7-aaf8122a`) | **PASS**<br>`packages/core/tests/logs/trial_zaino_zebra710.log:38-75` | **PASS**<br>`packages/core/tests/logs/trial_zaino_zebra710.log:145-163` | **PASS**<br>`packages/core/tests/logs/trial_zaino_zebra710.log:152,199,230-233` | **PASS**<br>`packages/core/tests/logs/trial_zaino_zebra710.log:180-209` | **PASS**<br>`packages/core/tests/logs/trial_zaino_zebra710.log:225-228` | **PASS** (Zaino RPC)<br>`packages/core/tests/logs/trial_zaino_zebra710.log:79-102` |
| **full (stock)** (`zfnd/zebra:7.1.0` + `lwd:v0.6.2` + `zallet:beta.4`) | **PASS**<br>`packages/core/tests/logs/trial_full_zebra710_stock.log:38-183` | **PASS**<br>`packages/core/tests/logs/trial_full_zebra710_stock.log:55,312` | **PASS**<br>`packages/core/tests/logs/trial_full_zebra710_stock.log:318,362-364` | **PASS**<br>`packages/core/tests/logs/trial_full_zebra710_stock.log:320-328,348-359` | **PASS**<br>`packages/core/tests/logs/trial_full_zebra710_stock.log:356-359` | **PASS** (Zallet notes + send)<br>`packages/core/tests/logs/trial_full_zebra710_stock.log:280-295,330-337` |
| **full (indexer build)** (`zebra:7.1.0-indexer` + `lwd:v0.6.2` + `zallet:beta.4`) | **PASS**<br>`packages/core/tests/logs/trial_full_zebra710_indexer.log:110-254` | **PASS**<br>`packages/core/tests/logs/trial_full_zebra710_indexer.log:129,352` | **PASS**<br>`packages/core/tests/logs/trial_full_zebra710_indexer.log:358,403-405` | **PASS**<br>`packages/core/tests/logs/trial_full_zebra710_indexer.log:360-368,388-400` | **PASS**<br>`packages/core/tests/logs/trial_full_zebra710_indexer.log:396-400` | **PASS** (Zallet notes + send)<br>`packages/core/tests/logs/trial_full_zebra710_indexer.log:321-335,370-377` |

### Verbatim Failures
None. All 15 assertions in the lightwalletd stack, all 16 assertions in the zaino stack, and all 17 assertions in both full stack trials passed without error.

---

## 3. Full Stack: Stock Image vs Custom Indexer Build Investigation

### A. Stock Zebra 7.1.0 Image (`zfnd/zebra:7.1.0`)
- **Port 8230 connectivity**: `nc -zv 127.0.0.1 8230` succeeds (`trial_full_zebra710_stock.log:232-234`).
- **gRPC service discovery**: `grpcurl -plaintext 127.0.0.1:8230 list` lists `zebra.indexer.rpc.Indexer` and reflection services (`trial_full_zebra710_stock.log:236-238`).
- **Indexer RPC methods**: `grpcurl describe zebra.indexer.rpc.Indexer` returns methods `ChainTipChange`, `GetBlock`, `MempoolChange`, and `NonFinalizedStateChange` (`trial_full_zebra710_stock.log:240-258`).
- **Startup logs**: `spawning indexer RPC server` and `Opened RPC endpoint at 0.0.0.0:8230` are logged when `indexer_listen_addr` is configured in `zebrad.toml` (`trial_full_zebra710_stock.log:260-262`).
- **Compiled Cargo Features**:
  - `zebrad --help` does not enumerate Cargo feature flags (`trial_full_zebra710_stock.log:203-230`).
  - Zebrad's diagnostic startup metadata reveals:
    `features: default,default_release_binaries,howudoin,indicatif,metrics_exporter_prometheus,metrics_util,opentelemetry,progress_bar,prometheus,release_max_level_info,sentry` (`trial_full_zebra710_stock.log:260`).
  - **Determination**: While `zebra-rpc` includes the indexer gRPC server endpoints by default, the `zebra-state/indexer` Cargo feature (which populates spending-transaction lookup indices in the state database) is **absent** from the stock binary features.
  - In regtest, lightwalletd v0.6.2 and Zallet v0.1.0-beta.4 still successfully sync and transact against the stock image.

### B. Custom Built Indexer Image (`zebra:7.1.0-indexer`)
- **Source**: Upstream Zebra tag `v7.1.0` at peeled commit `534549fe6b4c851b4785515fd03380cbea9e1a23`.
- **Dockerfile**: `scripts/Dockerfile.zebra-7.1.0-indexer` (exact copy of `packages/dev/docker/stacks/full/Dockerfile` with commit updated and permissions entrypoint preserved; the repository's `packages/dev/docker/stacks/full/Dockerfile` was not modified).
- **Cargo features**: `"default-release-binaries,indexer"`.
- **Measured build time**: **655 seconds (~10.9 minutes)** from scratch (`trial_full_zebra710_indexer.log:77`).
- **Compiled Cargo Features**:
  `features: default,default_release_binaries,howudoin,indexer,indicatif,metrics_exporter_prometheus,metrics_util,opentelemetry,progress_bar,prometheus,release_max_level_info,sentry` (`trial_full_zebra710_indexer.log:300`).
- **Smoke test results**:
  - All 17 coexistence assertions passed (`trial_full_zebra710_indexer.log:305-384`).
  - Zallet `z_sendmany` generated Halo 2 proof, broadcast tx `86d3c55bb29a092d76367c165e340ae0681be4a5c3cb5d94dcfd2a4166a5c938`, mined block `8924751134bd40a7c5bf46586831a1ca61d1ccc32263df5ea969597f9597c26f`, confirmed in active chain, and verified Ironwood commitment tree root `ba29d0f9...` (`trial_full_zebra710_indexer.log:388-405`).

### C. Stale Echo Notice
In `trial_full_zebra710_stock.log:40` and `trial_full_zebra710_indexer.log:113`, the log echoes:
`==> Starting Zebra 7.0.0 (indexer) in NU7 regtest mode...`
This echo is hardcoded in main code at `packages/dev/docker/stacks/full/regtest-init.sh:13`. Following instructions, this file was left unmodified on this branch.

---

## 4. lightwalletd v0.6.2 Behaviour Changes (Step 2)

Tested against live lightwalletd v0.6.2 on port 39067:

1. **Default SDK sync loop**:
   - Configuration: `batchSize: 1000`, `throttleMs: 50`.
   - Result: **PASS** (`packages/core/tests/logs/trial_lwd_v062_sync.log:20-33`).
   - Synced 123 blocks (height 2 to 124) in 423 ms. Tree root verified against `GetTreeState(124)` matching `b847f824dcaf8c7d7adb6eeed8e8436fb0241cd224cb3126aba71f16517c2f16`.
2. **Concurrency limit (`--max-concurrent-recv` default 32)**:
   - Result: **PASS** (`packages/core/tests/logs/trial_lwd_v062_sync.log:35-43`).
   - 16 and 32 concurrent `getRawBlockRange` stream requests resolved with 0 rejections or `RESOURCE_EXHAUSTED` errors.
3. **Client stream idle timeout (`--client-stream-idle-timeout` default 30s)**:
   - Result: **PASS** (`packages/core/tests/logs/trial_lwd_v062_sync.log:45-54`).
   - Normal SDK throttling (50 ms) is orders of magnitude below 30s. A 5-second simulated client stall between blocks remained healthy, and the stream drained cleanly to completion.
4. **Testnet sync benchmark**:
   - Status: **NOT TESTED** (`packages/core/tests/logs/trial_lwd_v062_sync.log:56-61`).
   - Reason: No public or local testnet endpoint running lightwalletd v0.6.2 is currently available. The public testnet endpoint (`testnet.zec.rocks:443`) was probed and confirmed to be running `v0.6.1` (commit `af8ad1bd38d1d9a9951669b4bf193409ce5768e1`).

---

## 5. Proposed Pin Upgrade Patch (Unapplied)

The following patch captures the exact changes required to update default image pins and source references to Zebra 7.1.0 and lightwalletd v0.6.2. As required by trial constraints, this patch remains unapplied on this branch.

```diff
diff --git a/packages/dev/docker/stacks/full/Dockerfile b/packages/dev/docker/stacks/full/Dockerfile
index e20cf67..3d41f92 100644
--- a/packages/dev/docker/stacks/full/Dockerfile
+++ b/packages/dev/docker/stacks/full/Dockerfile
@@ -1,5 +1,5 @@
-# Zebra 7.0.0 with indexer feature enabled
-# Builds Zebra release binary from upstream tag v7.0.0 (commit e8db87eb69254e0d4eedd058eadd48bdfa09065a)
+# Zebra 7.1.0 with indexer feature enabled
+# Builds Zebra release binary from upstream tag v7.1.0 (peeled commit 534549fe6b4c851b4785515fd03380cbea9e1a23)
 # with Cargo features: "default-release-binaries,indexer"
 FROM rust:1.91.0-bookworm AS builder
 
@@ -16,3 +16,3 @@ WORKDIR /usr/src/zebra
 RUN git clone https://github.com/ZcashFoundation/zebra.git . && \
-    git checkout e8db87eb69254e0d4eedd058eadd48bdfa09065a && \
+    git checkout 534549fe6b4c851b4785515fd03380cbea9e1a23 && \
     cargo build --release --locked --bin zebrad --features "default-release-binaries,indexer"
diff --git a/packages/dev/docker/stacks/full/docker-compose.yml b/packages/dev/docker/stacks/full/docker-compose.yml
index a7372d8..6e492d2 100644
--- a/packages/dev/docker/stacks/full/docker-compose.yml
+++ b/packages/dev/docker/stacks/full/docker-compose.yml
@@ -8,3 +8,3 @@ services:
-    image: ${ZEBRA_IMAGE:-zebra:7.0.0-indexer}
+    image: ${ZEBRA_IMAGE:-zebra:7.1.0-indexer}
     command: ["zebrad", "-c", "/home/zebra/.config/zebrad.toml", "start"]
@@ -56,3 +56,3 @@ services:
   lightwalletd:
-    image: ${LIGHTWALLETD_IMAGE:-electriccoinco/lightwalletd@sha256:abc8199dae800e050415a3459f71c7850aeefeb1ca6a681e9b9eda7249ce8613}
+    image: ${LIGHTWALLETD_IMAGE:-electriccoinco/lightwalletd@sha256:75e5742df686094556abef66e69c37bc114de23a0706712aee324f332ca52951}
     platform: linux/amd64
diff --git a/packages/dev/docker/stacks/lightwalletd/docker-compose.yml b/packages/dev/docker/stacks/lightwalletd/docker-compose.yml
index b44ad83..27c32bf 100644
--- a/packages/dev/docker/stacks/lightwalletd/docker-compose.yml
+++ b/packages/dev/docker/stacks/lightwalletd/docker-compose.yml
@@ -5,3 +5,3 @@ services:
   zebra:
-    image: ${ZEBRA_IMAGE:-zfnd/zebra:7.0.0}
+    image: ${ZEBRA_IMAGE:-zfnd/zebra:7.1.0}
     ports:
@@ -31,3 +31,3 @@ services:
   lightwalletd:
-    image: ${LIGHTWALLETD_IMAGE:-electriccoinco/lightwalletd@sha256:abc8199dae800e050415a3459f71c7850aeefeb1ca6a681e9b9eda7249ce8613}
+    image: ${LIGHTWALLETD_IMAGE:-electriccoinco/lightwalletd@sha256:75e5742df686094556abef66e69c37bc114de23a0706712aee324f332ca52951}
     platform: linux/amd64
diff --git a/packages/dev/docker/stacks/zaino/docker-compose.yml b/packages/dev/docker/stacks/zaino/docker-compose.yml
index fe90494..5b18aa2 100644
--- a/packages/dev/docker/stacks/zaino/docker-compose.yml
+++ b/packages/dev/docker/stacks/zaino/docker-compose.yml
@@ -5,3 +5,3 @@ services:
   zebra:
-    image: ${ZEBRA_IMAGE:-zfnd/zebra:7.0.0}
+    image: ${ZEBRA_IMAGE:-zfnd/zebra:7.1.0}
     ports:
```
