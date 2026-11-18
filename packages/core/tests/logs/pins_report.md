# Pin Bump & Custom Zebra Build Removal Report

**Date**: 2026-11-18  
**Branch**: `chore/pin-zebra-7.1-lwd-0.6.2`  
**Base**: `origin/chore/trial-zebra-7.1-lwd-0.6.2` (commit `66686f4`)  

---

## 1. Summary of Changes

This PR branch bumps the default image pins across all three regtest devnet stacks and eliminates the custom local Zebra build requirement for Tier 3 (Full stack):

1. **Zebra 7.1.0 Pin**:
   - Pinned official `zfnd/zebra:7.1.0` (digest `sha256:4f9536c8061e407f9f2ec81b7e0dd2f1762f81deec316abb1530dca8796a33ba`) across all three stack compose files (`packages/dev/docker/stacks/{lightwalletd,zaino,full}/docker-compose.yml`) and CLI scaffolding templates (`packages/cli/src/index.ts`).
   - Retained `${ZEBRA_IMAGE:-zfnd/zebra:7.1.0}` environment override pattern across all stacks.
2. **Lightwalletd v0.6.2 Pin**:
   - Pinned official `electriccoinco/lightwalletd` v0.6.2 (digest `sha256:75e5742df686094556abef66e69c37bc114de23a0706712aee324f332ca52951`) across regtest stacks using Lightwalletd (`lightwalletd` and `full`).
3. **Full Stack Custom Zebra Build Removal**:
   - Deleted `packages/dev/docker/stacks/full/Dockerfile` (which previously compiled Zebra `v7.0.0` from source with Cargo features `default-release-binaries,indexer`).
   - Removed the inline image build block from `packages/dev/src/cli.ts` and compose service definition.
   - Fixed the stale `Starting Zebra 7.0.0 (indexer)` echo in `packages/dev/docker/stacks/full/regtest-init.sh` and other init scripts.
   - Retained `scripts/Dockerfile.zebra-7.1.0-indexer` as trial evidence.
4. **Known Issues & Documentation Updates**:
   - Replaced stale indexer and ~8-minute custom build items in `KNOWN_ISSUES.md` with a single measured item on stock `zfnd/zebra:7.1.0` feature omission and measured regtest equivalence.
   - Updated Zallet #794 item with PR #943 merge info (merged 2026-11-16) and latest tag check (`v0.1.0-beta.4`, checked 2026-11-18).
   - Updated Zaino item upstream checked date to 2026-11-18 after verifying SHAs (`dev` @ `84e115af…`, `feat/nu7` @ `aaf8122a…`).
   - Updated ports reference, quickstart guide, concepts, troubleshooting guide, README, and CHANGELOG `[Unreleased]` section.

---

## 2. Git Diff Stat

```text
 CHANGELOG.md                                       |  7 +++++
 KNOWN_ISSUES.md                                    |  9 +++---
 README.md                                          |  6 ++--
 docs/dev/nu7-stack-inventory.md                    |  6 ++--
 docs/src/ch02-quickstart.md                        |  4 +--
 docs/src/ch03-concepts.md                          | 10 +++---
 docs/src/guides/troubleshooting.md                 |  2 +-
 docs/src/known-issues.md                           |  9 +++---
 docs/src/reference/ports.md                        |  6 ++--
 packages/cli/src/index.ts                          |  8 ++---
 packages/dev/docker/stacks/full/Dockerfile         | 36 ----------------------
 packages/dev/docker/stacks/full/docker-compose.yml |  8 ++---
 packages/dev/docker/stacks/full/regtest-init.sh    |  2 +-
 packages/dev/docker/stacks/full/zebra.toml         |  2 +-
 .../docker/stacks/lightwalletd/docker-compose.yml  |  5 +--
 .../dev/docker/stacks/lightwalletd/regtest-init.sh |  2 +-
 packages/dev/docker/stacks/lightwalletd/zebra.toml |  2 +-
 .../dev/docker/stacks/zaino/docker-compose.yml     |  3 +-
 packages/dev/docker/stacks/zaino/regtest-init.sh   |  2 +-
 packages/dev/src/cli.ts                            | 12 --------
 packages/dev/test/keys-and-cli.test.mjs            |  2 +-
 21 files changed, 50 insertions(+), 93 deletions(-)
```

---

## 3. Grep Hit List & Repository Audit

Audit of patterns `"7.0.0"`, `"7.0.0-indexer"`, `"~8 min"`, `"custom Zebra"`, and `"local image build"` across repository files:

### A. Fixed in this Branch
| File:Line | Description | Status |
|-----------|-------------|--------|
| `packages/dev/docker/stacks/lightwalletd/docker-compose.yml:5` | Pinned `zfnd/zebra:7.1.0` with digest comment | Fixed |
| `packages/dev/docker/stacks/lightwalletd/docker-compose.yml:32` | Pinned `lightwalletd` v0.6.2 with digest | Fixed |
| `packages/dev/docker/stacks/lightwalletd/regtest-init.sh:13` | Updated startup banner to Zebra 7.1.0 | Fixed |
| `packages/dev/docker/stacks/lightwalletd/zebra.toml:2` | Updated header comment to Zebra 7.1.0 | Fixed |
| `packages/dev/docker/stacks/zaino/docker-compose.yml:5` | Pinned `zfnd/zebra:7.1.0` with digest comment | Fixed |
| `packages/dev/docker/stacks/zaino/regtest-init.sh:13` | Updated startup banner to Zebra 7.1.0 | Fixed |
| `packages/dev/docker/stacks/full/Dockerfile` | Deleted custom Zebra source build Dockerfile | Removed |
| `packages/dev/docker/stacks/full/docker-compose.yml:4-9` | Removed build directive, pinned `zfnd/zebra:7.1.0` | Fixed |
| `packages/dev/docker/stacks/full/docker-compose.yml:57` | Pinned `lightwalletd` v0.6.2 with digest | Fixed |
| `packages/dev/docker/stacks/full/regtest-init.sh:13` | Updated startup banner to Zebra 7.1.0 | Fixed |
| `packages/dev/docker/stacks/full/zebra.toml:2` | Updated header comment to Zebra 7.1.0 | Fixed |
| `packages/dev/src/cli.ts:1283-1294` | Deleted full stack custom Docker build logic | Removed |
| `packages/cli/src/index.ts:568, 595, 641, 677` | Updated scaffolded compose templates to `zfnd/zebra:7.1.0` | Fixed |
| `packages/dev/test/keys-and-cli.test.mjs:877` | Updated test assertion to `zfnd/zebra:7.1.0` | Fixed |
| `README.md:168-170` | Updated regtest tiers to Zebra 7.1.0 and removed "indexer mode" | Fixed |
| `docs/src/ch02-quickstart.md:63, 84` | Updated quickstart output blocks to Zebra 7.1.0 | Fixed |
| `docs/src/ch03-concepts.md:41-49` | Updated concepts architecture overview and release link | Fixed |
| `docs/src/guides/troubleshooting.md:58` | Updated troubleshooting solution reference to Zebra 7.1.0 | Fixed |
| `docs/src/reference/ports.md:82, 91, 103` | Updated port references to Zebra 7.1.0 | Fixed |
| `docs/dev/nu7-stack-inventory.md:52-54` | Updated internal inventory document to Zebra 7.1.0 | Fixed |
| `KNOWN_ISSUES.md:20` | Updated Zallet #794 with PR #943 merge info and tag check | Fixed |
| `KNOWN_ISSUES.md:23-26` | Replaced 7.0.0 indexer / ~8 min build with scoped 7.1.0 item | Fixed |
| `CHANGELOG.md:5-12` | Added `[Unreleased]` Changed section documenting pin updates | Fixed |

### B. Preserved as Historical Records (Unmodified)
| File | Pattern | Reason for Preservation |
|------|---------|-------------------------|
| `packages/dev/docker/spikes/nu7-stack/README.md` | `zebra:7.0.0-indexer` | Historical spike documentation describing initial Phase A exploration |
| `packages/dev/docker/spikes/zallet-beta4/README.md` | `Zebra 7.0.0` | Historical spike documentation describing standalone Zallet spike |
| `CHANGELOG.md:25, 26, 27, 115` | `Zebra 7.0.0` | Historical changelog entries for past releases (`0.1.0-alpha.5` and `0.1.0-alpha.1`) |
| `scripts/Dockerfile.zebra-7.1.0-indexer` | `indexer` | Retained as trial evidence per user instructions |
| `scripts/trial_full_stock.sh` | `Zebra 7.0.0` | Historical trial automation script preserved for reproducibility |
| `scripts/trial_full_indexer.sh` | `Zebra 7.0.0` | Historical trial automation script preserved for reproducibility |
| `scripts/zaino_zallet_coexistence.mjs` | `Zebra 7.0.0` | Historical coexistence script comments preserved for reproducibility |
| `packages/core/tests/logs/*` | `7.0.0`, `7.0.0-indexer` | Committed test and trial execution logs preserved for historical audit |

---

## 4. Verification Matrix

All tests executed using the **new default configuration only** (no environment variable image overrides or custom build flags):

| Stack Tier | Components & Verified Images | Verification Flow | Status | Evidence / Log Citation |
|---|---|---|---|---|
| **Tier 1: Lightwalletd** | `zfnd/zebra:7.1.0`<br>`electriccoinco/lightwalletd:v0.6.2` | Clean wipe (`regtest wipe --stack lightwalletd --yes`) &rarr; stack launch &rarr; `docker ps` &rarr; `GetLightdInfo` (reports `ECC LightWalletD v0.6.2`) &rarr; address derivation &rarr; fund 1.0 ZEC (`txid: b6389d4d...`) &rarr; mine 1 &rarr; balance (229.16660630 ZEC) &rarr; send 0.5 ZEC (`txid: 6b927d87...`) &rarr; mine 1 &rarr; balance (231.24987963 ZEC) &rarr; clean teardown | **PASS** | `packages/core/tests/logs/pins_lightwalletd_defaults.log` |
| **Tier 2: Zaino** | `zfnd/zebra:7.1.0`<br>`zaino:nu7-aaf8122a` (Rust 1.96.0) | Clean wipe (`regtest wipe --stack zaino --yes`) &rarr; stack launch &rarr; `docker ps` &rarr; `GetLightdInfo` (reports `ZingoLabs ZainoD v0.10.1`, NU7 `77190ad9`) &rarr; address derivation &rarr; fund 1.0 ZEC (`txid: 1ec5bdb5...`) &rarr; mine 1 &rarr; compact block sync check &rarr; balance (229.16660630 ZEC) &rarr; send 0.5 ZEC (`txid: 9e96577c...`) &rarr; mine 1 &rarr; compact block sync check &rarr; balance (231.24987963 ZEC) &rarr; clean teardown | **PASS** | `packages/core/tests/logs/pins_zaino_defaults.log` |
| **Tier 3: Full Stack** | `zfnd/zebra:7.1.0`<br>`electriccoinco/lightwalletd:v0.6.2`<br>`zodlinc/zallet:v0.1.0-beta.4` | Clean wipe (`regtest wipe --stack full --yes`) &rarr; stack launch (stock Zebra, no local compile) &rarr; `docker ps` &rarr; `GetLightdInfo` (reports `ECC LightWalletD v0.6.2`) &rarr; address derivation &rarr; fund 1.0 ZEC (`txid: 7d116025...`) &rarr; mine 1 &rarr; balance (229.16660630 ZEC) &rarr; send 0.5 ZEC (`txid: 242b1244...`) &rarr; mine 1 &rarr; balance (231.24987963 ZEC) &rarr; Zallet `z_listunspent` (110 unspent Ironwood notes) &rarr; Zallet `z_sendmany` 0.25 ZEC (`txid: 650fc7ff...`) &rarr; mine 1 on Zebra &rarr; Zebra active chain confirmation (`in_active_chain: true`, height 113) &rarr; clean teardown | **PASS** | `packages/core/tests/logs/pins_full_defaults.log` |
| **Full Stack Native macOS** | Native macOS host without Docker | Running Zebra and Zallet directly on macOS outside container filesystem abstraction | **NOT TESTED** | Scoped to Docker host environments (`KNOWN_ISSUES.md`) |
| **Testnet / Mainnet Stock Zebra Indexer** | Testnet / Mainnet | Transparent note spend detection on long chains with multiple accounts using stock Zebra image | **NOT TESTED** | Equivalence measured on regtest only (`KNOWN_ISSUES.md`) |

