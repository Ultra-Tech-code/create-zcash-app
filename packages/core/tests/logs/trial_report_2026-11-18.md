# Regtest Trial Report: Zebra 7.1.0 and lightwalletd v0.6.2

Date: 2026-11-18  
Branch: `chore/trial-zebra-7.1-lwd-0.6.2`  
Author: Adewale Iyanuoluwa Isaac <hizick27@gmail.com>  

## 1. Upstream Artifact Resolution (Step 0)

All trial artifacts were resolved and verified against upstream releases:

1. **Zebra 7.1.0 Docker image**:
   - Repository: `zfnd/zebra:7.1.0`
   - Manifest digest: `sha256:4f9536c8061e407f9f2ec81b7e0dd2f1762f81deec316abb1530dca8796a33ba`
   - Version output: `zebrad 7.1.0+git.534549f`
   - Upstream tag commit (`refs/tags/v7.1.0`): `3114775f157d809b8cd7c679edbaa82a904e7b8a`
   - Target Cargo features for custom indexer build: `"default-release-binaries,indexer"`

2. **lightwalletd v0.6.2 Docker image**:
   - Repository: `electriccoinco/lightwalletd:v0.6.2` (`--platform linux/amd64`)
   - Manifest digest: `sha256:75e5742df686094556abef66e69c37bc114de23a0706712aee324f332ca52951`
   - Binary version: `v0.6.2`, commit `f8fe2cca7ede03b1f06b1d637a2ab467d151b79d` (2026-11-18)
   - New flags:
     - `--client-stream-idle-timeout uint` (default `30` seconds)
     - `--max-concurrent-recv uint` (default `32`)

Evidence log: `packages/core/tests/logs/trial_artifacts_2026-11-18.log:1-55`

---

## 2. Canonical Smoke Matrix Across Regtest Stacks (Step 1)

Each of the three regtest stacks was wiped to genesis, brought up on Zebra 7.1.0, and exercised through the full end-to-end lifecycle.

| Stack | up | fund | anchor check | send | txid order | Zallet / Zaino check |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **lightwalletd** (`zebra:7.1.0` + `lwd:v0.6.2`) | **PASS**<br>`packages/core/tests/logs/trial_lightwalletd_zebra710.log:31-76` | **PASS**<br>`packages/core/tests/logs/trial_lightwalletd_zebra710.log:145-163` | **PASS**<br>`packages/core/tests/logs/trial_lightwalletd_zebra710.log:152,198,230-231` | **PASS**<br>`packages/core/tests/logs/trial_lightwalletd_zebra710.log:180-209` | **PASS**<br>`packages/core/tests/logs/trial_lightwalletd_zebra710.log:223-226` | **PASS** (Indexer info)<br>`packages/core/tests/logs/trial_lightwalletd_zebra710.log:74-98` |
| **zaino** (`zebra:7.1.0` + `zaino:nu7-aaf8122a`) | **PASS**<br>`packages/core/tests/logs/trial_zaino_zebra710.log:38-75` | **PASS**<br>`packages/core/tests/logs/trial_zaino_zebra710.log:145-163` | **PASS**<br>`packages/core/tests/logs/trial_zaino_zebra710.log:152,199,230-233` | **PASS**<br>`packages/core/tests/logs/trial_zaino_zebra710.log:180-209` | **PASS**<br>`packages/core/tests/logs/trial_zaino_zebra710.log:225-228` | **PASS** (Zaino RPC)<br>`packages/core/tests/logs/trial_zaino_zebra710.log:79-102` |
| **full** (`zebra:7.1.0` + `lwd:v0.6.2` + `zallet:beta.4`) | **PASS**<br>`packages/core/tests/logs/trial_full_zebra710.log:40-186` | **PASS**<br>`packages/core/tests/logs/trial_full_zebra710.log:57,243-246` | **PASS**<br>`packages/core/tests/logs/trial_full_zebra710.log:250-255,300` | **PASS**<br>`packages/core/tests/logs/trial_full_zebra710.log:254-262,284-293` | **PASS**<br>`packages/core/tests/logs/trial_full_zebra710.log:294-295` | **PASS** (Zallet notes + send)<br>`packages/core/tests/logs/trial_full_zebra710.log:225-246,269-272,284-295` |

### Verbatim Failures
None. All 15 assertions in the lightwalletd stack, all 16 assertions in the zaino stack, and all 17 assertions in the full stack passed without error.

---

## 3. lightwalletd v0.6.2 Behaviour Changes (Step 2)

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

## 4. Proposed Pin Upgrade Patch (Unapplied)

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
+# Builds Zebra release binary from upstream tag v7.1.0 (commit 3114775f157d809b8cd7c679edbaa82a904e7b8a)
 # with Cargo features: "default-release-binaries,indexer"
 FROM rust:1.91.0-bookworm AS builder
 
@@ -16,3 +16,3 @@ WORKDIR /usr/src/zebra
 RUN git clone https://github.com/ZcashFoundation/zebra.git . && \
-    git checkout e8db87eb69254e0d4eedd058eadd48bdfa09065a && \
+    git checkout 3114775f157d809b8cd7c679edbaa82a904e7b8a && \
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

