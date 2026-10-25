# Core test fixtures

The `.bin` files here are **committed** because `cargo test` reads them: a fresh clone or a CI
runner must be able to run the suite without a live node. They are public regtest chain data
(no keys, no secrets) captured from the local Z3 regtest stack described in `SESSION_HANDOFF.md`
with the commands below. Earlier revisions of this file called them "gitignored on purpose",
which is what broke the GitHub Actions matrix; they are now tracked.

## Capture a block

`scripts/capture_real_block.mjs` requests `GetBlockRange` from Zaino through a raw
`@grpc/grpc-js` identity deserializer, so the bytes are the `CompactBlock` protobuf exactly as
the indexer sent it (no protobufjs re-encoding).

```bash
# any block after NU6.3 activation (height >= 2) contains one Ironwood coinbase action
node scripts/capture_real_block.mjs 2 real_regtest_block.bin

# a funding block: capture the block that contains a dev.fund transaction
node scripts/capture_real_block.mjs 108 real_funding_block.bin
```

Arguments: `<height> [outputFileName]`. The default output name is `real_regtest_block.bin`;
files are written to this directory. Requires the Z3 regtest stack with Zaino on
`127.0.0.1:28137` (override with `ZCASH_ENDPOINT`).

## Files and the tests that use them

| File | Captured at | Consumed by |
|:--|:--|:--|
| `real_regtest_block.bin` | regtest height 2 (first Ironwood-activation block) | `full_suite_test.rs::test_decode_real_regtest_compact_block_and_missing_field_rejection` — asserts height 2, `ironwoodCommitmentTreeSize = 1`, 1 Ironwood action, 0 Orchard actions, and that a block with `chainMetadata` stripped is rejected with `MissingIronwoodField`. |
| `real_funding_block.bin` | regtest height 108 (coinbase + a `dev.fund` transaction) | `full_suite_test.rs::test_decode_real_regtest_funding_block_with_ironwood_actions` — asserts height 108, `ironwoodCommitmentTreeSize = 109`, 2 transactions, 1 Ironwood action in the coinbase and 2 in the funding tx, 0 Orchard actions, and 32-byte nullifier/cmx/ephemeral keys per action. |
| `test_cmxs.json` | 193-action commitment dump from the same regtest chain | `transaction_test.rs::test_c_live_regtest_broadcast_and_mine` (an `#[ignore]`d live test — no default `cargo test` target reads this file). |

Both `full_suite_test.rs` tests assert the exact captured height and tree size, so a fresh
capture from a different chain must update those constants together with the fixture.

Sizes and SHA-256 of the committed files:

```text
278 B    6611676fc0473c098c1d6db18454eb30e3b16b66d50406fea742a508257defad  real_regtest_block.bin
635 B    eb3750578e744855f3ed620d5a0d448a3489e668d22832409d40c0dba725cb22  real_funding_block.bin
22,108 B d963de3c643b664c6627724f9743d79259717693616da6e6d39c198a6871f6d7  test_cmxs.json
```
