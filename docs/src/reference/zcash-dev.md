<!-- Generated automatically by pnpm docs:gen. Do not edit directly. -->

# zcash-dev CLI Reference

`zcash-dev` is the developer harness, regtest orchestrator, and operational CLI for shielded Zcash applications.

**CLI Version**: `0.1.0-alpha.1` (as of November 2026)

## Overview of Commands

| Command | Description |
| :--- | :--- |
| [`zcash-dev info`](#info) | Get node & indexer status |
| [`zcash-dev address`](#address) | Display the derived address for the configured account |
| [`zcash-dev balance`](#balance) | Check balance for the configured account |
| [`zcash-dev send`](#send) | Send ZEC or perform a transaction dry run |
| [`zcash-dev mine`](#mine) | Mine blocks on regtest |
| [`zcash-dev fund`](#fund) | Fund a Unified Address on regtest |
| [`zcash-dev fixtures`](#fixtures) | Display deterministic fixture accounts |
| [`zcash-dev switch`](#switch) | Switch project network (regtest \| testnet \| mainnet) |
| [`zcash-dev dashboard`](#dashboard) | Launch the Zcash Developer Dashboard |
| [`zcash-dev testnet`](#testnet) | Testnet developer helper tools |
| [`zcash-dev regtest`](#regtest) | Regtest environment management commands |

---

## `info`

Get node & indexer status

### Options

| Option | Description | Default |
| :--- | :--- | :--- |
| `-e, --endpoint <endpoint>` | Zaino gRPC endpoint | `127.0.0.1:28137` |
| `-n, --network <network>` | Network (regtest \| testnet \| mainnet) | `regtest` |
| `--nu7` | Opt-in to NU7 consensus branch expectations on regtest | None |

---

## `address`

Display the derived address for the configured account

### Options

| Option | Description | Default |
| :--- | :--- | :--- |
| `-i, --index <n>` | Account index | None |

---

## `balance`

Check balance for the configured account

### Options

| Option | Description | Default |
| :--- | :--- | :--- |
| `-e, --endpoint <endpoint>` | Zaino / lightwalletd gRPC endpoint | None |

---

## `send`

Send ZEC or perform a transaction dry run

### Options

| Option | Description | Default |
| :--- | :--- | :--- |
| `--to <address>` | Recipient address (unified, sapling, or transparent) | None |
| `--amount <zec>` | Amount to send in ZEC | None |
| `--memo <memo>` | Optional memo for shielded recipient | None |
| `--yes` | Broadcast the transaction (without --yes, runs in dry-run mode) | None |
| `--mainnet` | Safety confirmation flag required when broadcasting on mainnet | None |
| `-e, --endpoint <endpoint>` | Zaino / lightwalletd gRPC endpoint | None |

---

## `mine`

Mine blocks on regtest

### Arguments

| Argument | Description | Required |
| :--- | :--- | :--- |
| `blocks` | Number of blocks to mine | No |

### Options

| Option | Description | Default |
| :--- | :--- | :--- |
| `-e, --endpoint <endpoint>` | Zebra RPC or Zaino endpoint | None |
| `--stack <stack>` | Regtest stack (nu7 \| z3) | None |

---

## `fund`

Fund a Unified Address on regtest

### Arguments

| Argument | Description | Required |
| :--- | :--- | :--- |
| `address` | Recipient Unified Address | Yes |
| `amount` | Amount in ZEC | No |

### Options

| Option | Description | Default |
| :--- | :--- | :--- |
| `-e, --endpoint <endpoint>` | Zaino / lightwalletd gRPC endpoint | None |
| `--stack <stack>` | Regtest stack (nu7 \| z3) | None |

---

## `fixtures`

Display deterministic fixture accounts

### Options

| Option | Description | Default |
| :--- | :--- | :--- |
| `-n, --network <network>` | Network (regtest \| testnet) | `regtest` |

---

## `switch`

Switch project network (regtest | testnet | mainnet)

### Arguments

| Argument | Description | Required |
| :--- | :--- | :--- |
| `target-network` | Target network: regtest, testnet, or mainnet | No |

### Options

| Option | Description | Default |
| :--- | :--- | :--- |
| `--remote` | Use remote public indexer | None |
| `--local` | Use local Z3 node on 127.0.0.1:8137 | None |

---

## `dashboard`

Launch the Zcash Developer Dashboard

### Options

| Option | Description | Default |
| :--- | :--- | :--- |
| `-p, --port <port>` | Port to run dashboard on | `3050` |

---

## `testnet`

Testnet developer helper tools

### Subcommands

#### `zcash-dev testnet lightwalletd`

Start local testnet lightwalletd connected to local Zebra testnet node

**Options**:

| Option | Description | Default |
| :--- | :--- | :--- |
| `--cookie-path <path>` | Path to Zebra .cookie file | `~/Library/Caches/zebra/.cookie` |
| `--binary <path>` | Path to lightwalletd binary | `/tmp/lightwalletd` |
| `--rpchost <host>` | Zebra testnet RPC host | `127.0.0.1` |
| `--rpcport <port>` | Zebra testnet RPC port | `18232` |
| `--grpc-bind-addr <addr>` | gRPC bind address | `127.0.0.1:39167` |
| `--http-bind-addr <addr>` | HTTP bind address | `127.0.0.1:39168` |
| `--data-dir <dir>` | Lightwalletd cache/data dir | `~/.zcash-app-testnet/lightwalletd-data` |
| `--dry-run` | Validate configuration and build arguments without launching process | None |

---

## `regtest`

Regtest environment management commands

### Subcommands

#### `zcash-dev regtest up`

Configure and initialize regtest stack (default: z3 nu6, or --stack nu7)

**Alias**: `setup`

**Options**:

| Option | Description | Default |
| :--- | :--- | :--- |
| `--stack <stack>` | Regtest stack to run (nu6 \| nu7) | `nu6` |
| `--regtest-path <path>` | Path to regtest docker directory | `` |
| `--z3-path <path>` | Deprecated alias for --regtest-path | `` |

#### `zcash-dev regtest wipe`

Wipe and reset the regtest blockchain, indexer, and wallet data

**Alias**: `reset`

**Options**:

| Option | Description | Default |
| :--- | :--- | :--- |
| `--stack <stack>` | Regtest stack to wipe (nu6 \| nu7) | `nu6` |
| `--regtest-path <path>` | Path to regtest docker directory | `` |
| `--z3-path <path>` | Deprecated alias for --regtest-path | `` |
| `-y, --yes` | Confirm wiping regtest blockchain without interactive prompt | None |
| `--dry-run` | Derive and print exact volumes/containers to be wiped without executing | None |

---

