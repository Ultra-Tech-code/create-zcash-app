# skills.md — create-zcash-app (agent playbook)

You are building **create-zcash-app**: a scaffolder + TypeScript SDK + Rust crypto core + dev dashboard that lets web developers build shielded Zcash apps on the **Z3** stack (Zebra + Zaino + Zallet). Read this file fully before writing code. When this file and your assumptions disagree, this file wins; when this file and a live test disagree, the live test wins and you update this file.

---

## 1. Ground rules

1. **Verify, don't assume.** Every claim about Zcash behavior (Ironwood, ZIPs, RPC shapes) must be checked against the running regtest stack or the source before you build on it. If you can't verify it, mark it `UNVERIFIED` in code comments and in the final report.
2. **Server-side by default.** Spending keys, the native crypto addon, and gRPC calls run on the server. The browser never holds a spending key (only exception: an explicit self-custody wallet template).
3. **Values are `bigint` zatoshis.** Never floats. 1 ZEC = 100,000,000 zatoshis.
4. **Both pools, always.** Reads span Orchard and Ironwood. Callers rarely think about pools.
5. **Never log or render** mnemonics, spending keys, or `spendHandle`s outside regtest fixtures. The dashboard shows addresses and viewing keys only.
6. **Small, stable public surface.** Don't add exports to `@zcash-app/sdk` without a reason written in the PR/commit message.
7. **Report honestly.** At the end of every task say what you ran, what passed, what you didn't test.

---

## 2. Stack and pinned versions

| Component | Version / note |
|---|---|
| Z3 | github.com/ZcashFoundation/z3 — Docker Compose: Zebra + Zaino + Zallet. Networks: regtest, testnet, mainnet |
| Zebra | `zebrad 6.2.3` verified (NU6.3 active at height 2 on regtest) |
| **Zaino** | **MUST override Z3's default pin.** Default `0.6.0` rejects Ironwood `GetSubtreeRoots`. Use `Z3_ZAINO_IMAGE=zingodevops/zainod:0.10.0` (tested: `0.10.0-no-tls`) or newer |
| Zallet | `v0.1.0-beta.1` — beta, RPC has quirks (see §5) |
| librustzcash | `orchard` 0.15, `zcash_primitives` 0.29, `zcash_keys` 0.15, `zcash_address` 0.13, `zcash_protocol` 0.10, `zcash_client_backend` — pin exact patch versions at build time |
| Indexer protocol | lightwalletd-compatible gRPC (`CompactTxStreamer`) |

Zaino image is `linux/amd64` only. On Apple Silicon it runs under emulation; expect it to be slower, not broken.

Local ports come from `.env.regtest` (e.g. `Z3_ZAINO_HOST_GRPC_PORT`). Zebra JSON-RPC on regtest is `127.0.0.1:8181` with basic auth `zebra:zebra`. Always read ports from the env file instead of hardcoding.

---

## 3. Networks

The same app must run on all three with only config changing.

| Network | Use | Funding | Notes |
|---|---|---|---|
| `regtest` | local dev, tests, workshop | `zcash-dev fund` (mine + send) | NU6.3 active from height 2; instant blocks via on-demand mining |
| `testnet` | staging against public infra | **ztap** faucet (`dev.faucet`) | Self-hosted ztap, browser proof-of-work; no central faucet exists |
| `mainnet` | production | real ZEC | Never auto-fund, never default to it |

Rules: `network` is always explicit in config. Default for scaffolded projects is `regtest`. Addresses are network-specific, so the dashboard must label every address with its network and never mix them.

---

## 4. Repo layout (target)

```
packages/
  sdk/            @zcash-app/sdk        TypeScript public API
  core/           @zcash-app/core       Rust crate: napi-rs (Node) + wasm-bindgen (browser)
  cli/            create-zcash-app      scaffolder
  dev/            zcash-dev             regtest helper CLI (mine/fund/send/reset), wraps sdk.dev
  dashboard/      @zcash-app/dashboard  dev dashboard (see §7)
templates/        nextjs-fullstack (flagship), express-api, checkout, wallet-lite, ...
docs/             spec, workshop lab
```

SDK public surface (signatures are in the spec; summary):

- `createClient({ endpoint, network, transport? })`
- `generateMnemonic()`, `accountFromMnemonic()`, `accountFromUfvk()`, `Account.getUnifiedAddress()`, `getUnifiedFullViewingKey()`
- `getBalance()`, `sync()`, `detectIncoming()`, `watch()`
- `send()`, `migrateOrchardToIronwood()` (ZIP-318, advanced)
- `buildPaymentRequest()` / `parsePaymentRequest()` (ZIP-321)
- `dev.mine / fund / reset / faucet / fixtures`
- `testkit.withRegtest()`

Rust core (`@zcash-app/core`) exposes `deriveAccount`, `tryDecrypt`, `selectNotes`, `buildAndProve`. `spendHandle` is an opaque Rust-side reference and is never serialized to JS.

---

## 5. Verified facts and gotchas (do not relearn these the hard way)

**Ironwood addressing and routing**
- There is **no separate Ironwood receiver type** in a Unified Address. Zallet correctly rejects `"ironwood"` as a receiver type (valid: `p2pkh`, `sapling`, `orchard`).
- After NU6.3 activation, an ordinary **Orchard receiver produces Ironwood-pool outputs**. Pool is decided by consensus height, not by the address. So `getUnifiedAddress` needs no Ironwood logic.
- Pool classification happens on the **read side**: Zaino serves Ironwood notes in a separate `ironwoodActions` array in `GetBlockRange` compact blocks, distinct from Orchard actions. Ironwood notes use the quantum-recoverable plaintext format (lead byte `0x03`).

**Zaino (≥ 0.10.0)**
- `GetLightdInfo` reports `consensusBranchId` and `upgradeName: Nu6_3` correctly.
- `GetBlockRange` serves `ironwoodActions` (nullifier, cmx, ephemeralKey, ciphertext). Verified with a real tx.
- `GetTreeState` / `GetLatestTreeState` return `ironwoodTree`. `chainMetadata.ironwoodCommitmentTreeSize` is present.
- `GetSubtreeRoots` accepts `shieldedProtocol: 2` (`ironwood`) on ≥ 0.10.0. On 0.6.0 it returns `InvalidArgument`. Below 65,536 notes it returns an empty stream for both Orchard and Ironwood. That is normal, not an error.
- Zaino does **not** expose gRPC reflection. Use `.proto` files with `grpcurl -import-path ... -proto service.proto`. The proto lives at `packages/zaino-proto/lightwallet-protocol/walletrpc/service.proto` in the Zaino repo.
- Legacy lightwalletd does not serve Ironwood. Use it only for Orchard/Sapling.

**Funding Ironwood on regtest (the working recipe)**
1. `z_getnewaccount` then `z_getaddressforaccount` in Zallet (plain Orchard UA, no receiver-type override).
2. Point Zebra's `MINER_ADDRESS` at that UA, mine 101+ blocks to mature the coinbase.
3. `z_sendmany` from that account (e.g. to the same UA); mine one block to confirm.
4. The output lands in the Ironwood pool automatically.
The `zcash-dev fund` command should wrap this recipe so users never see it.

**Still UNVERIFIED (flag, don't assume)**
- Your Rust `tryDecrypt` actually decrypting `ironwoodActions` ciphertexts with a real IVK. This is Milestone 1's core task.
- A non-empty Ironwood `GetSubtreeRoots` result (needs ≥ 65,536 Ironwood notes). Ask whether Zaino's own tests cover it before grinding.
- ZIP-318 exact tx shape (v6; Orchard value balance positive, Ironwood negative). Read the published ZIP, not a summary.
- grpc-web front for the browser path (Zaino built-in vs Envoy).
- Whether `GetTreeState` alone can bootstrap an Ironwood witness (fallback if subtree roots misbehave).

---

## 6. Build order

Do these in order. Don't start a step until the previous one's check passes.

1. **Env.** `docker compose` brings up Z3 regtest with the Zaino pin override. Check: `GetLightdInfo` returns `Nu6_3`.
2. **Rust core skeleton.** napi-rs build loads from Node. Check: `deriveAccount` returns a UFVK and a UA from a fixed mnemonic, stable across runs.
3. **Orchard detection first.** `tryDecrypt` against Orchard compact blocks, `detectIncoming` end to end. Check: fund a UA via `zcash-dev fund`, SDK reports the note.
4. **Ironwood detection.** Extend `tryDecrypt` to `ironwoodActions` (lead byte `0x03`). Check: the same flow detects an Ironwood note and tags `pool: 'ironwood'`.
5. **Balance + sync + watch.** `PoolBalances` across pools, `watch()` poll loop.
6. **Send.** `selectNotes` + `buildAndProve` (v6). Needs Ironwood subtree roots / witnesses, so confirm the §5 unverified items first.
7. **`zcash-dev` CLI**, then the **dashboard** (§7), then the **scaffolder** and flagship template.
8. **Migration** (`migrateOrchardToIronwood`) and **testnet staging** (ztap faucet) are the advanced track. Do them last.

If step 4 or 6 hits an upstream gap, ship the earlier steps, document the gap, and stop. Do not fake support.

---

## 7. Dashboard (dev dashboard)

A local web UI that ships with every scaffolded project so developers can see what their app is doing without touching the CLI. It is a **dev tool first**: on regtest it may show fixture accounts; on testnet/mainnet it must never show secrets.

**Stack:** Next.js (App Router) with server-side calls to `@zcash-app/sdk`. The browser only talks to the dashboard's own API routes, never to Zaino directly and never with keys.

**Global**
- Network switcher: `regtest | testnet | mainnet`. Current network is always visible in the header with a color tag (mainnet gets a warning style). Switching networks swaps the client, endpoint, and address set.
- Status bar: chain height, synced height, branch ID / active upgrade (from `getInfo`), indexer reachability, Zaino version.

**Pages**
1. **Overview.** Total balance and per-pool balances (Orchard, Ironwood, Sapling read-only, transparent), last 5 transactions, sync state.
2. **Addresses.** For the active network: Unified Address (copy button, QR code), diversified addresses (generate next index), UFVK (copy, labeled "view-only, safe to share with your detection layer"), and a ZIP-321 payment-request builder (`buildPaymentRequest`). Every address row shows its network tag. Regtest and testnet addresses are different, so never display one under the other's tab.
3. **Transactions.** Live list driven by `watch()` / `detectIncoming()` and sent txs: direction, value (formatted from zatoshis), pool, memo, txid, height, confirmations, status (pending / confirmed). Click for detail. Auto-refresh with the `pollMs` default of 15000, faster on regtest.
4. **Faucet / Fund.**
   - regtest: "Fund this address" button calling `dev.fund` then `dev.mine`, amount input, plus a standalone "Mine N blocks" and "Reset chain" (confirm dialog; regtest only).
   - testnet: calls `dev.faucet(address, { ztapUrl })`. If it returns `open-url`, show the PoW page link. Show the ztap URL from config; if none configured, show instructions to self-host ztap.
   - mainnet: faucet page is disabled with an explanation.
5. **Send (regtest/testnet only).** Form: recipient, amount, memo. Calls `send()` server-side with the fixture/dev account. Show the resulting txid and fee (ZIP-317).
6. **Health / Logs.** Reachability of Zebra RPC, Zaino gRPC, Zallet RPC; last errors; the pin check (warn if Zaino < 0.10.0: "Ironwood spend-proving unsupported").

**Dashboard rules**
- Amounts: store and compute in `bigint`, format only at render time.
- Never display a mnemonic or spending key. Regtest fixtures show the fixture *index*, not the seed.
- Destructive actions (reset) require confirmation and are hidden outside regtest.
- Empty states matter: a fresh regtest chain has zero balance and zero txs. Show "fund this address" instead of a blank table.
- All data fetching errors surface in the UI with the underlying message, not a generic failure.

---

## 8. Testing

- Unit-test the Rust core with fixed vectors (fixed mnemonic → fixed UFVK/UA).
- Integration tests run against a real Z3 regtest via `testkit.withRegtest()`. No mocks for Zaino in integration tests.
- Required end-to-end tests before any milestone is "done":
  - fund a UA, `detectIncoming` sees it, correct pool and value
  - `send` between two fixture accounts, receiver sees it
  - dashboard smoke test: balances, addresses and tx list render for a funded regtest account
- Re-run the Zaino compatibility checks (§5) whenever the Zaino pin changes.
- Rust: `cargo clippy -- -D warnings`, `cargo test`. TS: strict mode, no `any` in the public API.

---

## 9. Don'ts

- Don't send to an `"ironwood"` receiver type. It doesn't exist.
- Don't rely on Z3's default Zaino pin.
- Don't use floating-point ZEC anywhere.
- Don't serialize `spendHandle` or any spending material to JS, logs, or HTTP.
- Don't claim Ironwood spend-proving works until a real send passes end to end.
- Don't call mainnet from templates by default.
- Don't reimplement what Z3 already provides (mining, node, wallet RPC). `zcash-dev` is a thin wrapper.
- Don't silently skip an unverified item. Mark it and move on.

---

## 10. Definition of done (per task)

1. Code builds and lints clean.
2. The relevant check from §6 passes on a fresh `docker compose up` regtest.
3. Tests from §8 pass.
4. Short report: what changed, what you ran, what's still UNVERIFIED.
