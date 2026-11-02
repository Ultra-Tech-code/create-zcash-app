# Chapter 5: Keys & Configuration

Secure configuration and key hygiene are vital for any cryptocurrency application. This chapter covers the environment variables, redaction pipelines, watch-only modes, and network distinctions used by `create-zcash-app`.

---

## 1. Environment Variables Reference

Applications scaffolded by `create-zcash-app` manage their environment configuration via `.env.local`. The table below lists all supported variables:

| Variable | Description | Example Values | Format / Constraints |
| :--- | :--- | :--- | :--- |
| `ZCASH_NETWORK` | Target Zcash network | `regtest`, `testnet`, `mainnet` | Case-insensitive; defaults to `regtest` |
| `ZCASH_ENDPOINT` | gRPC service endpoint for lightwalletd or Zaino | `127.0.0.1:28137`, `testnet.zec.rocks:443` | Must be `host:port`. **Must NOT contain `://`** |
| `ZCASH_ZEBRA_RPC` | JSON-RPC URL for Zebra full node | `http://127.0.0.1:18232`, `https://rpc.example.com/TOKEN` | Valid `http:` or `https:` URL |
| `ZCASH_BIRTHDAY` | Wallet birthday block height | `4465026` (testnet NU7), `3543405` (mainnet) | Non-negative integer. Optimization checkpoint |
| `ZCASH_BIRTHDAY_HEIGHT`| Supported alias for `ZCASH_BIRTHDAY` | `4465026` | Non-negative integer |
| `ZCASH_MNEMONIC` | BIP-39 mnemonic seed phrase (spending key) | `word1 word2 ... word24` | 12 or 24 words from standard BIP-39 wordlist |
| `ZCASH_UFVK` | Unified Full Viewing Key (watch-only) | `uview1...`, `uviewregtest1...` | Valid ZIP-316 Bech32 string |
| `ZCASH_ACCOUNT_INDEX` | BIP-44 account derivation index | `0`, `1`, `2` | Non-negative integer; defaults to `0` |

---

## 2. Redaction Pipeline & Secret Protection

To prevent credentials from leaking into log outputs, git repositories, or public API responses, `create-zcash-app` enforces automated redaction:

### Secret URL Redaction (`redactSecretUrl`)
Remote RPC providers frequently incorporate authentication secrets directly into URL paths or credentials (e.g. `https://zcash-mainnet.example.com/SECRET_TOKEN/`).
- `redactSecretUrl()` strips authentication credentials, URL path segments, and query parameters:
  - `https://user:password@example.com/v1/auth?token=xyz` &rarr; `https://user:***@example.com/v1/auth***`
- The unredacted URL is stored **only** in `.env.local`.
- The public `zcash.config.json` stores only the sanitized output of `redactSecretUrl()`.
- Dashboard API responses (such as `GET /api/account` and `GET /api/status`) always run endpoints through `redactSecretUrl()`.

### Error Sanitization (`sanitizeError`)
When exceptions occur in CLI actions or API routes:
- Error messages are scanned for URL patterns and redacted.
- If a configured mnemonic is present in memory, any occurrence of that mnemonic or its individual words is stripped from the error message before displaying to the terminal or returning to an HTTP client.

---

## 3. Watch-Only Operations (`ZCASH_UFVK`)

For production web servers, e-commerce stores, and deposit-monitoring services, storing private spending keys (`ZCASH_MNEMONIC`) on disk presents unnecessary financial risk. `create-zcash-app` provides native support for **Watch-Only** mode:

```bash
# In .env.local:
ZCASH_NETWORK=testnet
ZCASH_ENDPOINT=testnet.zec.rocks:443
ZCASH_UFVK=uviewtest1...
# ZCASH_MNEMONIC is left unset
```

### Capabilities in Watch-Only Mode:
- **Scan Blocks**: The application scans compact blocks from `ZCASH_BIRTHDAY`.
- **Decrypt Incoming Notes**: When a customer deposits funds, the service detects the note and decodes the transaction memo (e.g., invoice ID).
- **Calculate Confirmed Balances**: `zcash-dev balance` displays the account's total, confirmed, and per-pool balances.
- **Spending Protection**: Any attempt to broadcast a transaction (e.g. `zcash-dev send --yes`) is immediately rejected:
  ```text
  Error: Cannot send from a watch-only account (UFVK). A spending key (mnemonic) is required.
  ```

---

## 4. Testnet vs. Mainnet Differences

Moving an application from local development to testnet and mainnet involves key structural differences:

| Property | Testnet | Mainnet |
| :--- | :--- | :--- |
| **Address Prefixes** | `utest1...` (UA), `tm...` (transparent) | `u1...` (UA), `t1...` (transparent) |
| **Default Remote Indexer** | `testnet.zec.rocks:443` | `zec.rocks:443` |
| **NU7 Activation Height** | `4,465,026` (activated) | `3,543,405` (expected Nov 5-6, 2026 UTC) |
| **Consensus Branch ID** | `0x77190ad9` | `0x77190ad9` (at NU7) |
| **Scaffolder Guard** | Default configuration permitted | Requires `--allow-mainnet-key-on-disk` to write spending key |
| **Broadcast Guard** | `zcash-dev send --yes` | Requires `zcash-dev send --yes --mainnet` |

### Testnet Chain Verification
The `ZcashClient` includes active protection against syncing against old or reorged testnet forks. It verifies that block `4,465,026` matches canonical NU7 activation block hash `000089ba27100beede16d64b34e3d1b626b428cb7ee9fe6dcfdc217ce24e78af`. If connected to a deprecated fork, it raises `ChainIdentityError` and halts before storing corrupted wallet state.

