<!-- Generated automatically by pnpm docs:gen. Do not edit directly. -->

# RPC & Protocol Reference

This table enumerates every RPC method (Zebra JSON-RPC, lightwalletd gRPC, and Zallet RPC) invoked across the repository, identifying the calling module, its function, and the authoritative upstream specification.

| Protocol | Method | Calling File / Module | Purpose | Upstream Specification |
| :--- | :--- | :--- | :--- | :--- |
| Zebra JSON-RPC | `getblockchaininfo` | `packages/dashboard/src/app/api/status/sync.ts`, `packages/sdk/src/jsonrpc.ts`, `packages/dev/src/cli.ts` | Inspect chain tip, block count, headers, verification progress, and consensus branch ID | [Zebra RPC getblockchaininfo](https://zebra.zfnd.org/user/rpc.html#getblockchaininfo) |
| Zebra JSON-RPC | `getblockcount` | `packages/dev/src/cli.ts` (regtest setup), `packages/dashboard/src/app/api/explorer/backend.ts` | Obtain the current chain height / block count | [Zebra RPC getblockcount](https://zebra.zfnd.org/user/rpc.html#getblockcount) |
| Zebra JSON-RPC | `getblock` | `packages/dashboard/src/app/api/explorer/backend.ts` | Fetch block details by height or hash with verbosity level | [Zebra RPC getblock](https://zebra.zfnd.org/user/rpc.html#getblock) |
| Zebra JSON-RPC | `getrawtransaction` | `packages/dashboard/src/app/api/explorer/backend.ts`, `packages/core/tests/transaction_test.rs` | Fetch raw transaction hex or decoded verbose transaction data | [Zebra RPC getrawtransaction](https://zebra.zfnd.org/user/rpc.html#getrawtransaction) |
| Zebra JSON-RPC | `sendrawtransaction` | `packages/sdk/src/send.ts` (`JsonRpcVerifier`), `packages/core/tests/transaction_test.rs` | Submit serialized raw transaction hex directly to the node mempool | [Zebra RPC sendrawtransaction](https://zebra.zfnd.org/user/rpc.html#sendrawtransaction) |
| Zebra JSON-RPC | `getstandardfee` | `packages/core/tests/transaction_test.rs` | Query standard ZIP-317 fee accepted by node | [ZIP 317 Fee Mechanism](https://zips.z.cash/zip-0317) |
| Zebra JSON-RPC | `generate` | `packages/dev/src/cli.ts`, `packages/dashboard/src/app/api/mine/route.ts`, `docker/*/regtest-init.sh` | Mine N blocks on regtest chain immediately | [Zebra Mining RPC](https://zebra.zfnd.org/user/mining.html) |
| Zebra JSON-RPC | `z_gettreestate` | `packages/sdk/src/jsonrpc.ts`, `packages/core/tests/shard_store_test.rs` | Fetch commitment tree state and final root for Sapling, Orchard, and Ironwood | [Zebra RPC z_gettreestate](https://zebra.zfnd.org/user/rpc.html#z_gettreestate) |
| Zallet RPC | `listaddresses` | `packages/dev/src/cli.ts` (Z3 regtest setup & wipe) | Query active accounts and addresses managed by Zallet in NU6.3 regtest | [Zallet Repository](https://github.com/zcash/zallet) |
| Zallet RPC | `z_getnewaccount` | `packages/dev/src/cli.ts` (Z3 regtest setup & wipe) | Derive a new spending account in Zallet | [Zallet Repository](https://github.com/zcash/zallet) |
| lightwalletd gRPC | `GetLightdInfo` | `packages/sdk/src/client.ts` (`getInfo`, `verifyConsensusBranch`), `packages/dashboard/src/app/api/status/route.ts` | Retrieve indexer version, vendor, consensus branch ID, block height, and network name | [lightwalletd service.proto](https://github.com/zcash/lightwalletd/blob/master/pkg/rpc/service.proto) |
| lightwalletd gRPC | `GetLatestBlock` | `packages/sdk/src/client.ts`, `packages/dashboard/src/app/api/status/sync.ts` | Fetch compact header of the current chain tip | [lightwalletd service.proto](https://github.com/zcash/lightwalletd/blob/master/pkg/rpc/service.proto) |
| lightwalletd gRPC | `GetBlockRange` | `packages/sdk/src/client.ts` (`getBlockRange`, `getRawBlockRange`), `packages/sdk/src/sync.ts` | Stream compact blocks across height range for note detection and wallet sync | [lightwalletd service.proto](https://github.com/zcash/lightwalletd/blob/master/pkg/rpc/service.proto) |
| lightwalletd gRPC | `GetBlock` | `packages/sdk/src/client.ts` (`getBlock`), `packages/dashboard/src/app/api/explorer/backend.ts` | Fetch single compact block by height | [lightwalletd service.proto](https://github.com/zcash/lightwalletd/blob/master/pkg/rpc/service.proto) |
| lightwalletd gRPC | `GetTreeState` | `packages/sdk/src/client.ts` (`getTreeState`), `packages/sdk/src/sync.ts` | Fetch commitment tree frontier state and pool roots at height | [lightwalletd service.proto](https://github.com/zcash/lightwalletd/blob/master/pkg/rpc/service.proto) |
| lightwalletd gRPC | `SendTransaction` | `packages/sdk/src/client.ts` (`sendTransaction`), `packages/sdk/src/send.ts` | Broadcast serialized transaction to the network via lightwalletd | [lightwalletd service.proto](https://github.com/zcash/lightwalletd/blob/master/pkg/rpc/service.proto) |
| lightwalletd gRPC | `GetAddressUtxos` | `packages/sdk/src/client.ts` (`getAddressUtxos`), `packages/sdk/src/sync.ts` | Fetch transparent unspent transaction outputs (UTXOs) | [lightwalletd service.proto](https://github.com/zcash/lightwalletd/blob/master/pkg/rpc/service.proto) |
| lightwalletd gRPC | `GetTaddressTxids` | `packages/sdk/src/client.ts` (`getTaddressTxids`) | Retrieve list of transaction IDs affecting transparent address | [lightwalletd service.proto](https://github.com/zcash/lightwalletd/blob/master/pkg/rpc/service.proto) |
| lightwalletd gRPC | `GetMempoolTx` | `packages/sdk/src/client.ts` (`getMempoolTx`) | Stream unconfirmed transactions from memory pool | [lightwalletd service.proto](https://github.com/zcash/lightwalletd/blob/master/pkg/rpc/service.proto) |

