# Core test fixtures

The `.bin` files here are **gitignored on purpose**: they are raw captures from a running
regtest stack and can be reproduced byte-for-byte with the commands below. The tests that
consume them are committed and assert exact contents.

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
| `test_cmxs.json` | 193-action commitment fixture (committed at `scripts` time, gitignored here) | `transaction_test.rs` transaction/anchor tests. |

Both `full_suite_test.rs` tests assert the exact captured height, so a fresh capture from a
different chain must update those constants together with the fixture.
