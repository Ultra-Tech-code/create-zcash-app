# Human-Readable Zebra RPC (Pretty Mode)

`zcash-dev` provides a human-readable ("prettify") inspection suite for Zebra JSON-RPC endpoints. While raw JSON responses from `zebrad` are essential for programmatic clients, reviewing large transaction objects, value pool balances, and block commitment trees directly in terminal logs can be tedious and prone to manual calculation errors.

The `zcash-dev` pretty mode translates low-level JSON-RPC data structures into cleanly formatted, color-coded terminal tables with deterministic decimal precision.

> [!NOTE]
> **Credits & Attribution**:
> The `zcash-dev` pretty formatters are inspired by the open-source [`zebraUtilities`](https://github.com/dismad/zebraUtilities) toolset by [dismad](https://github.com/dismad) (MIT License, (c) dismad).
> `create-zcash-app` reimplements these capabilities natively in TypeScript without dependencies on bash, `curl`, `jq`, `bc`, or GNU `date`. All calculations use `BigInt` zatoshis to eliminate floating-point rounding errors.

---

## Key Improvements Over Raw JSON & Shell Scripts

1. **BigInt Precision End-to-End**: All satoshi and zatoshi values (`chainValueZat`, `valueBalanceZat`, `valueZat`) are handled as native JavaScript `BigInt`s. No floating-point arithmetic or scientific notation truncation (`1e-8`) is performed. Values are converted to decimal ZEC strings only at the final display layer.
2. **ID-Based Value Pool Resolution**: Consensus value pools in `getblockchaininfo.valuePools` are matched strictly by pool identifier (`transparent`, `sprout`, `sapling`, `orchard`, `lockbox`, `ironwood`), never by array index. Any future or unknown pools are discovered dynamically and rendered cleanly.
3. **Comprehensive Shielded Pool Support**: Full detection and display across Transparent, Sprout, Sapling, Orchard, and NU7 Ironwood actions.
4. **Accurate Transaction Fee Calculation**:
   - For shielded and standard transactions: `fee = transparent_inputs - transparent_outputs + valueBalanceSapling + valueBalanceOrchard + valueBalanceIronwood`.
   - If transparent inputs cannot be resolved (e.g. absent `txindex`), the CLI reports `fee: n/a (transparent inputs not resolved)` rather than crashing or displaying an erroneous number.
   - For coinbase transactions: fee reward is computed as `subsidy - outputs`, fetching the exact block subsidy from `getblocksubsidy` for the block height rather than assuming hardcoded activation heights.
5. **Mined vs. Mempool Handling**: Inspects both mined transactions (reporting height, block hash, and confirmations) and pending mempool transactions (`In mempool (0 confirmations)`) without missing field errors.
6. **Cross-Platform Time Formatting**: Timestamps are formatted as UTC ISO-8601 (`YYYY-MM-DDTHH:mm:ssZ`) by default. Passing `--local` formats in the local system timezone using native Node.js `Intl` and `Date` APIs.
7. **Clean Column Alignment with Color Guards**: Table columns are aligned using visual character width (`stripAnsi`), preventing ANSI color escape sequences from misaligning tabular output. Passing `--no-color` or setting the standard `NO_COLOR` environment variable disables all color codes.

---

## Commands & Usage

### 1. `zcash-dev supply`

Queries `getblockchaininfo` and displays the total coin supply, total shielded supply, and a pool-by-pool breakdown.

```bash
zcash-dev supply
```

**Example Output:**

```text
Chain: test (tip height: 112)
Total Chain supply:    237.49969963 ZEC (23,749,969,963 zatoshis)
Total Shielded supply: 237.49969963 ZEC (23,749,969,963 zatoshis)
──────────────────────────────────────────────────────────────────────────
Pool               Balance (ZEC)      Balance (Zatoshis)   Monitored
──────────────────────────────────────────────────────────────────────────
Transparent           0.00000000                       0          no
Sprout                0.00000000                       0          no
Sapling               6.25000000             625,000,000         yes
Orchard               0.00000000                       0          no
Lockbox               0.00000000                       0          no
Ironwood            231.24969963          23,124,969,963         yes
──────────────────────────────────────────────────────────────────────────
```

To view the raw unformatted JSON:
```bash
zcash-dev supply --json
```

---

### 2. `zcash-dev block <height|hash>`

Queries `getblock` (verbosity 1) to inspect header metadata, confirmation count, transaction list, chain supply, value pool deltas, and commitment tree sizes.

```bash
zcash-dev block 108
```

**Example Output:**

```text
Block Height:     108
Block Hash:       602b4fd7661af844d664bca0538b9ebdfd28fa95e89732fbabb8458de4cdab11
Confirmations:    5
Timestamp:        2011-02-02T23:17:02Z (UTC)
Size:             16,746 bytes
Version:          4
Merkle Root:      a8b8b97e2d12ced9d522c6839dac8e3d94e01b3442208557c8641ea64effb2ad
Commitments Root: b56ea6603a44e9603bf5784cdc07ef844f30f88e026364813fd5486ca5a8b270
Transactions:     2 tx(s)
  [0] 8a83c773e57749c0848726b77d4c11768430fe46d4b7bb27394105377fa109ce (coinbase)
  [1] 93a787dbf6fdafee5da89168044b787bf515ee89b2b39467e275de8734d2b9d0
Chain Supply:     229.16660631 ZEC (22,916,660,631 zatoshis)

Value Pools:
──────────────────────────────────────────────────────────────────────────
Pool                   Delta (ZEC)           Balance (ZEC)   Monitored
──────────────────────────────────────────────────────────────────────────
Transparent             0.00000000              0.00000000          no
Sprout                  0.00000000              0.00000000          no
Sapling                 0.00000000              6.25000000         yes
Orchard                 0.00000000              0.00000000          no
Lockbox                 0.00000000              0.00000000          no
Ironwood               +2.08327333            222.91660631         yes
──────────────────────────────────────────────────────────────────────────

Commitment Trees:
  Sapling Tree Size: 1
  Ironwood Tree Size: 109
```

---

### 3. `zcash-dev tx <txid>`

Queries `getrawtransaction` (verbosity 1) to inspect transaction status, pool composition, input/output counts, value balances, and fee breakdown.

#### Mined Shielded Transaction Example:

```bash
zcash-dev tx 93a787dbf6fdafee5da89168044b787bf515ee89b2b39467e275de8734d2b9d0
```

**Example Output:**

```text
Transaction ID: 93a787dbf6fdafee5da89168044b787bf515ee89b2b39467e275de8734d2b9d0
Status:         Mined in block 108 (5 confirmations)
Block Hash:     602b4fd7661af844d664bca0538b9ebdfd28fa95e89732fbabb8458de4cdab11
Timestamp:      2011-02-02T23:17:02Z (UTC)
Type:           Standard (Version 6, Overwintered)
Pools:          Ironwood
Fee:            0.00010000 ZEC (10,000 zatoshis)

Pool Details:
──────────────────────────────────────────────────────────────────────────
  Ironwood:       2 action(s), value balance: +0.00010000 ZEC (+10,000 zatoshis)
──────────────────────────────────────────────────────────────────────────
```

#### Mined Coinbase Transaction Example:

```bash
zcash-dev tx 8a83c773e57749c0848726b77d4c11768430fe46d4b7bb27394105377fa109ce
```

**Example Output:**

```text
Transaction ID: 8a83c773e57749c0848726b77d4c11768430fe46d4b7bb27394105377fa109ce
Status:         Mined in block 108 (5 confirmations)
Block Hash:     602b4fd7661af844d664bca0538b9ebdfd28fa95e89732fbabb8458de4cdab11
Timestamp:      2011-02-02T23:17:02Z (UTC)
Type:           Coinbase (Version 6, Overwintered)
Pools:          Ironwood
Fee:            -0.00004000 ZEC (-4,000 zatoshis)

Pool Details:
──────────────────────────────────────────────────────────────────────────
  Transparent:    coinbase input, 0 output(s) (0.00000000 ZEC)
  Ironwood:       1 action(s), value balance: -2.08337333 ZEC (-208,337,333 zatoshis)
──────────────────────────────────────────────────────────────────────────
```

---

### 4. `zcash-dev peers`

Queries `getpeerinfo` and displays connected node IP addresses, direction (inbound/outbound), protocol version, user agent string, and connection time.

```bash
zcash-dev peers
```

**Example Output:**

```text
──────────────────────────────────────────────────────────────────────────
No connected peers found.
──────────────────────────────────────────────────────────────────────────

Your Zebrad node has 0 ip('s) connected.
```

---

### 5. `zcash-dev mempool`

Queries `getrawmempool` and displays pending transactions awaiting block inclusion.

```bash
zcash-dev mempool
```

**Example Output:**

```text
──────────────────────────────────────────────────────────────────────────
Mempool status: 0 transaction(s) pending
──────────────────────────────────────────────────────────────────────────
(mempool is empty)
──────────────────────────────────────────────────────────────────────────
```

---

### 6. `zcash-dev rpc <method> [params...]`

Executes an arbitrary JSON-RPC method against the Zebra daemon. By default, raw JSON is output to standard output. Passing `--pretty` routes known methods through their respective formatters, or pretty-indents standard responses.

```bash
# Query block count (raw JSON default)
zcash-dev rpc getblockcount

# Query chain info with human-readable formatting
zcash-dev rpc getblockchaininfo --pretty

# Query block with parameters
zcash-dev rpc getblock 108 1 --pretty
```

---

## Differences vs. Raw JSON

| Feature | Raw Zebra JSON-RPC | `zcash-dev` Pretty Mode |
| :--- | :--- | :--- |
| **Number Format** | Mixed floats (`237.49969963`) and integers (`23749969963`) | End-to-end `BigInt` zatoshis with formatted ZEC decimals and thousand separators |
| **Value Pools** | Array in node-dependent order | Sorted, named pool list matched strictly by pool `id` with monitored flags |
| **Timestamps** | Raw Unix integer seconds (`1296688622`) | Standardized ISO-8601 UTC string (`2011-02-02T23:17:02Z`) or local time with `--local` |
| **Transaction Fees** | Must be manually computed by subtracting outputs from inputs | Automatically computed across all active shielded and transparent pools |
| **Pool Detection** | Requires inspecting `vjoinsplit`, `vShieldedSpend`, `orchard.actions`, and `ironwood.actions` | Summary list of all participating pools (`Transparent`, `Sapling`, `Orchard`, `Ironwood`) |
| **Error Messages** | Unhandled stack traces or raw JSON-RPC error codes | Redacted URLs and sanitized error messages protecting secrets |

