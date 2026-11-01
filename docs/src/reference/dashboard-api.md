<!-- Generated automatically by pnpm docs:gen. Do not edit directly. -->

# Developer Dashboard API Reference

The Zcash Developer Dashboard runs as a Next.js App Router service on port 3050 (default) and provides administrative, monitoring, and RPC endpoints for local and staging development.

## Security Model

- **Origin Verification (`verifySameOrigin`)**: All state-modifying POST endpoints require valid matching `Origin` and `Host` headers to mitigate Cross-Site Request Forgery (CSRF).
- **Endpoint Allowlisting (`resolveAllowedEndpoint`)**: Endpoints queried through proxy routes must exist in the recognized preset allowlist or match loopback/private ranges.
- **Secret Redaction (`redactSecretUrl`)**: JSON responses redact sensitive tokens in RPC URLs and sanitize errors to never echo mnemonics or credentials.

## API Endpoints

### `GET /api/status`

Fetches node status, indexer status, tip height, consensus branch ID, and Zebra sync progress.

**Parameters**: `preset`: Preset identifier (`regtest`, `testnet`, `mainnet`).

**Example Response**:

```json
{
  "online": true,
  "network": "testnet",
  "height": 4542500,
  "consensusBranchId": "77190ad9",
  "upgradeName": "NU7",
  "vendor": "Zebra",
  "version": "7.0.0",
  "sync": {
    "blocks": 4542490,
    "headers": 4542500,
    "estimatedHeight": 4542500,
    "verificationProgress": 0.9999,
    "syncPercent": 99.99,
    "syncState": "synced"
  }
}
```

---

### `GET /api/account`

Returns configured account keys, addresses, birthday height, and watch-only status.

**Parameters**: None (reads project `.env.local`).

**Example Response**:

```json
{
  "network": "regtest",
  "unifiedAddress": "uregtest1...",
  "transparentAddress": "tm...",
  "ufvk": "uviewregtest1...",
  "hasMnemonic": true,
  "isWatchOnly": false,
  "birthdayHeight": 1,
  "accountIndex": 0,
  "endpoint": "127.0.0.1:28137"
}
```

---

### `POST /api/account/import-key`

Imports a 12- or 24-word BIP-39 mnemonic or UFVK into the project configuration.

**Parameters**: JSON body: `{ "mnemonic": "word1 ... word24" }` or `{ "ufvk": "uview..." }`

**Example Response**:

```json
{ "success": true, "address": "uregtest1..." }
```

---

### `POST /api/account/forget-key`

Clears mnemonic and UFVK from local project configuration, reverting to keyless or fixture state.

**Parameters**: None.

**Example Response**:

```json
{ "success": true }
```

---

### `GET | POST /api/config`

Reads or updates project settings in `zcash.config.json` and `.env.local`.

**Parameters**: GET: none. POST: `{ "network": "testnet", "endpoint": "testnet.zec.rocks:443" }`

**Example Response**:

```json
{ "network": "testnet", "endpoint": "testnet.zec.rocks:443" }
```

---

### `POST /api/mine`

Mines blocks on a regtest chain (Z3 or NU7).

**Parameters**: JSON body: `{ "blocks": 1 }`

**Example Response**:

```json
{ "success": true, "mined": 1 }
```

---

### `POST /api/fund`

Funds a regtest address using the test faucet.

**Parameters**: JSON body: `{ "address": "uregtest1...", "amount": "10.0" }`

**Example Response**:

```json
{ "success": true, "txid": "e1850e719..." }
```

---

### `GET /api/sync/status`

Returns real-time wallet scanning progress and scanned block counts.

**Parameters**: None.

**Example Response**:

```json
{
  "status": "synced",
  "scannedBlocks": 105,
  "targetHeight": 105,
  "syncPercent": 100,
  "inProgress": false
}
```

---

### `GET /api/transactions`

Lists decrypted incoming and outgoing transactions for the configured account.

**Parameters**: None.

**Example Response**:

```json
[
  {
    "txid": "ac7604a82...",
    "height": 102,
    "value": 100000000,
    "direction": "incoming",
    "memo": "First payment"
  }
]
```

---

### `GET /api/explorer`

Searches transactions, blocks, or addresses across the configured network node.

**Parameters**: `q`: Query string (txid, block hash, block height, or address). `network`: network name.

**Example Response**:

```json
{ "kind": "tx", "txid": "ac7604a82...", "blockHeight": 102, ... }
```

---

