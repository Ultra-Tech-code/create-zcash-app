# NU7 Stack Restructure Inventory & Classification

This document classifies every file identified by:
```bash
grep -rIl -E -i "nu6_3|nu6\.3|nu6_4|nu6\.4|28137|:8181|29232|regtest-z3|z3-regtest|regtestNu7|regtest-nu7" . \
  --exclude-dir={node_modules,.git,target,.next,dist,logs} --exclude="pnpm-lock.yaml"
```
in preparation for the NU7-only stack restructure and three-tier regtest architecture in release `0.1.0-alpha.5`.

---

## 1. Core Rust Library (`packages/core`)

| File | Status | Classification & Action |
|------|--------|-------------------------|
| `src/consensus.rs` | Modified | Added `Nu7` branch ID (`0x77190ad9`) and activation height exports (`get_nu7_activation_height`, `get_nu7_branch_id`, `get_ironwood_activation_height`). Updated Regtest consensus parameters so NU7 activates at block 2 by default. Retained `Nu6_3` branch ID (`0x5b331005`) and `get_nu6_3_activation_height` / `get_nu6_3_branch_id` for backwards compatibility. |
| `src/lib.rs` | Modified | Exported `get_nu7_activation_height`, `get_nu7_branch_id`, and `get_ironwood_activation_height` via NAPI. Preserved `get_nu6_3_activation_height` and `get_nu6_3_branch_id`. |
| `src/wallet_handle.rs` | Preserved | Anchors wallet scan birthday height via `get_nu6_3_activation_height` (`wallet_handle.rs:385`). Preserved intact to prevent scanning from genesis on older accounts. |
| `src/transaction.rs` | Inspected / Preserved | Contains transaction builder consensus branch ID selection logic. On regtest, target height >= 2 correctly yields NU7 branch ID `0x77190ad9`. |
| `tests/wallet_db_test.rs` | Modified | Pinned Rust unit test assertions for mainnet, testnet, and regtest activation heights and branch IDs across both NU6.3 and NU7. |
| `tests/decrypt_transaction_test.rs` | Modified | Updated test fixture transaction builder to `BranchId::Nu7` and expected expiry height delta to 120 blocks (NU7 default). |
| `tests/transaction_test.rs` | Modified | Updated live node RPC target port from legacy 29232 to standard 39232. |
| `tests/shard_store_test.rs` | Inspected / Preserved | Tree and shard store unit tests using hardcoded test block heights and hashes; preserved. |
| `tests/spendable_test.rs` | Inspected / Preserved | Spendable note tracking tests across Sapling/Orchard/Ironwood note commitments; preserved. |
| `tests/fixtures/README.md` | Preserved | Documents static binary transaction fixtures and legacy test vectors. |

---

## 2. TypeScript SDK (`packages/sdk`)

| File | Status | Classification & Action |
|------|--------|-------------------------|
| `src/client.ts` | Modified | Network parameter defaults to `'regtest'` (activating NU7 at block 2). Accepts alias `'regtest-nu7'` with deprecation warning. Ignores deprecated option `regtestNu7` with deprecation warning. |
| `src/client.test.ts` | Modified | Added unit tests verifying alias mapping for `'regtest-nu7'` -> `'regtest'`, option warning for `regtestNu7`, and endpoint fallbacks. |
| `src/consensus.ts` | Modified | Exports `getNu7ActivationHeight`, `getNu7BranchId`, `getIronwoodActivationHeight`. Preserves `getNu6_3ActivationHeight` and `getNu6_3BranchId`. |
| `src/consensus.test.ts` | Modified | Pinned consensus unit tests for NU7 branch ID `0x77190ad9` and heights across networks. |
| `src/dev.ts` | Modified | `dev.fund` and helper functions use NU7 regtest defaults and Zebra JSON-RPC on port 39232. |
| `src/decrypted-tx.ts` | Inspected / Preserved | Transaction inspection and note decryption helpers across pools (Sapling, Orchard, Ironwood). |
| `src/types.ts` | Modified | JSDoc notes on `SendResult.txid` node/explorer display order; updated types for consensus branches. |
| `src/send.test.ts` | Modified | Updated default expiry delta assertions (+120 for NU7) and target consensus branch IDs. |
| `src/spend-tracking.test.ts` | Modified | Verified pending spend tracking and expiry height calculations for NU7. |
| `src/explorer.test.ts` | Modified | Verified transaction explorer decoding and block height queries. |
| `scripts/*` | Inspected / Retained | Internal SDK test scripts (`test-item1.mjs`, `test-item4.mjs`, `dump-ironwood-commitments.mjs`, etc.) retained for local developer execution. |

---

## 3. Developer Tooling & Docker Stacks (`packages/dev`)

| File | Status | Classification & Action |
|------|--------|-------------------------|
| `src/cli.ts` | Modified | Restructured to support three regtest tiers: `lightwalletd` (default), `zaino` (experimental), and `full`. Removed legacy Z3 router (`:8181`) and `28137` port mappings. Replaced `z3`/`nu6` with clear migration errors. Updated `fund`, `mine`, `wipe`, `address`, `balance`, `send`, `info` commands. |
| `docker/stacks/lightwalletd/*` | New | Tier 1 (Default): Zebra 7.0.0 (`39232:18232`, `38080:8080`) + Lightwalletd (`39067:9067`, `39068:9068`). |
| `docker/stacks/zaino/*` | New | Tier 2 (Experimental): Zebra 7.0.0 (`39232:18232`, `38080:8080`) + Zaino `feat/nu7` (pin `aaf8122a`, built from source, `38137:8137`). |
| `docker/stacks/full/*` | New | Tier 3 (Full): Zebra 7.0.0 indexer (`39232:18232`, `8230:8230`, `38080:8080`) + Zallet `v0.1.0-beta.4` (`8182:28232`) + Lightwalletd (`39067:9067`, `39068:9068`). |
| `docker/regtest/` | Deleted | Removed obsolete Z3 regtest stack (`docker-compose.yml`, `regtest-init.sh`, `zaino.toml`, `zallet.toml`, `zebra.toml`). |
| `docker/regtest-nu7/` | Preserved | Retained for backwards compatibility during migration. |
| `docker/spikes/*` | Preserved | Historical spike artifacts and evidence from Phase A retained intact in repository. |
| `test/unique-ports.test.mjs` | Modified | Validates host port non-overlap across all 3 tiers (`39232`, `38080`, `39067`, `39068`, `38137`, `8182`, `8230`) and testnet-local (`39167`, `39168`). |
| `test/keys-and-cli.test.mjs` | Modified | Validates scaffolder options for `lightwalletd`, `zaino`, `full`, rejection of `z3`, and `executeFund` execution across stacks. |
| `test/wipe-refusal.test.mjs` | Modified | Validates refusal guards across all three stack compose project names (`zcash-regtest-lightwalletd`, `zcash-regtest-zaino`, `zcash-regtest-full`). |
| `test/fixtures/blockchaininfo.json` | Preserved | Static test fixture for Zebra node info parsing. |

---

## 4. Scaffolder CLI (`packages/cli`)

| File | Status | Classification & Action |
|------|--------|-------------------------|
| `src/index.ts` | Modified | Updated default regtest endpoint to `127.0.0.1:39067` and Zebra RPC to `http://127.0.0.1:39232`. Updated `--regtest-stack` choices to `lightwalletd` (default), `zaino`, and `full`. Maps `nu7` alias to `lightwalletd`; rejects `z3`/`nu6`. Generates tier-specific `docker-compose.yml`. |
| `template/app/api/account/route.ts` | Modified | Updated default regtest endpoint from `127.0.0.1:28137` to `127.0.0.1:39067`. |

---

## 5. Developer Dashboard (`packages/dashboard`)

| File | Status | Classification & Action |
|------|--------|-------------------------|
| `src/app/endpoints.ts` | Modified | Defined presets `regtest-lightwalletd` (39067), `regtest-zaino` (38137), `regtest-full` (39067). Removed `regtest-z3` and port `28137`. Added `38137` to `ALLOWED_ENDPOINTS`. Kept `regtest-nu7` as alias. |
| `src/app/api/config/route.ts` | Modified | Defaults to `regtest-lightwalletd`. Detects `regtest-zaino` on port 38137. |
| `src/app/api/fund/route.ts` | Modified | Defaults to endpoint `127.0.0.1:39067`. Uses TypeScript SDK miner send pipeline. |
| `src/app/api/mine/route.ts` | Modified | Queries Zebra JSON-RPC directly on `http://127.0.0.1:39232`. |
| `src/app/api/status/route.ts` | Modified | Uses `derivationNetwork = 'regtest'` for branch expectation matching. |
| `src/app/api/sync/status/route.ts` | Modified | Removed legacy `regtest-z3` account mapping. |
| `src/app/api/transactions/route.ts` | Modified | Removed legacy `regtest-z3` account mapping. |
| `src/app/components/FaucetTab.tsx` | Modified | Displays Zallet faucet on `regtest-full`, and SDK miner send / coinbase mining on `regtest-lightwalletd` and `regtest-zaino`. |
| `src/app/components/NetworkSelector.tsx` | Modified | Defaults fallback to `regtest-lightwalletd`. |
| `src/app/components/OverviewTab.tsx` | Modified | Updated quick developer controls to work across all tiers. |
| `src/app/components/SendTab.tsx` | Modified | Directs user to `regtest-full` for Zallet funding proxy, or Faucet tab for other tiers. |
| `src/app/components/TransactionsTab.tsx` | Modified | Default preset set to `regtest-lightwalletd`. |
| `src/app/explorer/[txid]/page.tsx` | Modified | Default and fallback presets set to `regtest-lightwalletd`. |
| `src/app/page.tsx` | Modified | Default preset set to `regtest-lightwalletd`. |

---

## 6. Examples (`examples/`)

| File | Status | Classification & Action |
|------|--------|-------------------------|
| `examples/checkout/checkout.mjs` | Modified | Updated network derivation from `regtest-nu7` alias to canonical `regtest`. |
| `examples/watch-only/monitor.mjs` | Modified | Updated network derivation from `regtest-nu7` alias to canonical `regtest`. |

---

## 7. Documentation (`docs/` & Root Docs)

| File | Status | Classification & Action |
|------|--------|-------------------------|
| `docs/src/reference/ports.md` | To update | Document host ports for all 3 stacks (`39232`, `38080`, `39067`, `39068`, `38137`, `8182`, `8230`) and testnet-local (`39167`, `39168`). Note that only one regtest stack runs at a time due to shared port 39232. |
| `docs/src/ch01-introduction.md` | To update | Reflect NU7-only regtest architecture and three tiers. |
| `docs/src/ch02-quickstart.md` | To update | Update getting started instructions for `lightwalletd` tier. |
| `docs/src/ch03-concepts.md` | To update | Clarify NU7 consensus branch ID `0x77190ad9` and activation at block 2. |
| `docs/src/ch04-operations-by-stack.md` | To update | Detail operational commands for `lightwalletd`, `zaino`, and `full` tiers. |
| `docs/src/ch05-keys-and-configuration.md`| To update | Update environment variables and endpoint references. |
| `docs/src/guides/dashboard.md` | To update | Update preset explanations and Faucet capabilities by tier. |
| `docs/src/guides/troubleshooting.md` | To update | Update port collision and stack diagnostics. |
| `docs/src/reference/rpc.md` | To update | Update RPC methods and endpoints for all tiers. |
| `docs/src/reference/dashboard-api.md` | To update | Document updated endpoints, query parameters, and presets. |
| `docs/src/reference/scaffolder.md` | To update | Document `--regtest-stack` options: `lightwalletd`, `zaino`, `full`. |
| `docs/src/reference/zcash-dev.md` | To update | Document CLI commands for the three tiers. |
| `docs/src/recipes/checkout.md` | To update | Update regtest instructions. |
| `docs/src/recipes/payroll.md` | To update | Update regtest instructions. |
| `docs/src/recipes/watch-only-monitor.md` | To update | Update regtest instructions. |
| `docs/src/known-issues.md` | To update | Remove Z3 NU6.3 regtest issue; document Zaino `feat/nu7` experimental status (pin `aaf8122a`, 3+ min build, Rust 1.96.0) and Zallet `z_listtransactions` InvalidUtf8 (`zallet#794`). |
| `KNOWN_ISSUES.md` | To update | Mirror changes from `docs/src/known-issues.md`. |
| `README.md` | To update | Reflect NU7 three-tier architecture and port mapping. |
| `CHANGELOG.md` | To update | Document all breaking changes in `[0.1.0-alpha.5]`. |

---

## 8. Standalone & Verification Scripts (`scripts/`)

| File | Status | Classification & Action |
|------|--------|-------------------------|
| `scripts/prove-release-pack-check.sh` | Modified | Updated to package `@zcash-app/dashboard` and verify 10 tarballs. |
| `scripts/prove-release-step-order.sh` | Verified | Verified release step order passes cleanly. |
| `scripts/zaino_nu7_spike.mjs` | Preserved | Phase A spike script retained as proof artifact. |
| `scripts/zaino_zallet_coexistence.mjs` | Preserved | Phase A coexistence proof script retained as proof artifact. |
| `scripts/item3_real_chain_wipe.mjs` | Preserved | Historical verification test script. |
| `scripts/item10_fund_and_sync_accounts.mjs`| Preserved | Historical integration script. |
| `scripts/item11_live_regtest_integration.mjs`| Preserved | Historical integration script. |
| `scripts/run_recipes_regtest.mjs` | Preserved | Recipe test runner. |
| `scripts/test_api_security.mjs` | Preserved | API security verification script. |
| `scripts/verify_testnet.mjs` | Preserved | Testnet verification script. |
| `scripts/verify-live.sh` | Preserved | Live verification script. |
| `scripts/docs-gen.mjs` | Preserved | Documentation generator script from source JSDoc. |
