# Known Issues Diagnostic & Evidence Archive

This document preserves detailed diagnostic transcripts, consensus citations, and historical spike notes moved from `KNOWN_ISSUES.md` during documentation shortening.

---

## 1. Orchard-to-Ironwood Funding & ZIP 258 Consensus Rules

Verified: the Orchard pool chain value is 0 and the Orchard tree `finalState` is `000000` at heights 2, 3, and 113 (`packages/core/tests/logs/p4_followup_orchard_funding.log`).

Under ZIP 258 ("Consensus rules from NU6.3 activation", Status: Final; quote verified line 101 in `zcash/zips`):
> "No new value may enter the Orchard pool: for every transaction, vOrchardPoolBalance >= 0 (so the encoded valueBalanceOrchard is nonnegative)" and "A coinbase transaction MUST NOT contain any Orchard-pool Actions; that is, its Orchard component MUST be empty."

A funding attempt to an Orchard-only receiver produced 0 Orchard actions and 2 Ironwood actions (`z_sendmany` txid `e1850e719a5fa823c703e361899da40148c246165bfcd19eef4aa7796b001f62`).

A real Orchard-note test needs both a Zebra activation-height change (so blocks mined before activation can fund an Orchard receiver and be spent across the turnstile afterwards) AND a change to `packages/core/src/consensus.rs` `regtest_consensus_params` (where `nu6_3` is hardcoded to height 2).

---

## 2. Empty Ironwood Tree Root Verification

`ironwood_empty_tree_root()` returns `ae2935f1dfd8a24aed7c70df7de3a668eb7a49b1319880dde2bbd9031ae5d82f` (`orchard::Anchor::empty_tree()`).

Zebra's `z_gettreestate` reports no `ironwood` section at heights 0–1 (pre-NU6.3) and a non-empty Ironwood tree at every height from 2 onward, because the first post-activation coinbase already carries an Ironwood action. The node therefore never prints an empty Ironwood `finalRoot` on this chain, so the equality is unverified by direct observation; the empty-node branch of `send()` is covered only by mocked tests.

Indirect control: Zebra reports the empty Orchard tree at height 2 as `finalState 000000, finalRoot ae2935f1...`, byte-identical to the helper (`packages/core/tests/logs/ironwood_empty_root.log`).

---

## 3. Zaino `feat/nu7` Upstream Status & Direct Mode Spike

Zaino's published crates and upstream `dev` branch still carry placeholder branch ID `0xfffffffe` and `feat/nu7` is not merged into `dev`; no release has been published after 0.10.2 (checked 2026-11-18). Branch `feat/nu7` supports NU7 consensus branch ID `0x77190ad9` (built on `zebra-chain 15 / zebra-state 16 / zebra-rpc 19`), but is unreleased upstream.

Running `zcash-dev regtest up --stack zaino` compiles Zaino from source in Docker using Rust 1.96.0, taking 524.8 s (8.7 minutes) on initial build (`packages/core/tests/logs/regtest_zaino_live.log`). The stack runs in RPC backend mode only (connecting to Zebra's JSON-RPC) with plain-text unencrypted gRPC (`no_tls_use_unencrypted_traffic`), bound to `127.0.0.1:38137` on the host. It is strictly experimental, REGTEST ONLY, and never the default.

Active regtest stacks run Zaino in RPC mode (`backend = "rpc"`). Direct RocksDB state-reader mode (`backend = "direct"`) was tested only in the exploratory spike (`packages/dev/docker/spikes/nu7-stack/zainod-direct.toml`, `packages/core/tests/logs/zaino_nu7_spike_direct.log`, `packages/core/tests/logs/zainod_startup_direct.log`) and is not offered in the CLI `zcash-dev` stacks.

---

## 4. Zallet Upstream Architecture & Standalone Spike Details

Upstream Zallet removed the experimental `zaino` backend driver in v0.1.0-beta.4; Zallet now interfaces with Zebra directly via RocksDB secondary state access and the Zebra indexer socket.

Details of running Zallet v0.1.0-beta.4 paired directly with Zebra 7.0.0 on NU7 regtest (`zodlinc/zallet@sha256:682ba6f9…`, `--tmpfs /tmp`, `--user 0:0`, txid `30c108ab1881fc8c945f37fb96d4c478230d25c6e951fc402d3b33961769b558`) are documented in `packages/dev/docker/spikes/zallet-beta4/README.md` (lines 14, 30–40, 67).

---

## 5. Full Stack Indexer Reference

In Tier 3 (`zcash-dev regtest up --stack full`), the light-client gRPC indexer on port 39067 is `electriccoinco/lightwalletd@sha256:75e5742df686094556abef66e69c37bc114de23a0706712aee324f332ca52951` (reports v0.6.2 via GetLightdInfo), not Zaino. Zebra runs on 39232 and Zallet runs on 8182. Coexistence verification (`packages/core/tests/logs/regtest_full_live.log`) asserts `EXPECTED_INDEXER_VENDOR="ECC LightWalletD"` via `GetLightdInfo`.

This is also documented in `docs/src/reference/ports.md:15,101-103` and `docs/src/ch03-concepts.md:43,49`.

