<!-- Generated automatically by pnpm docs:gen. Do not edit directly. -->

# Scaffolder CLI Reference (`create-zcash-app`)

The `create-zcash-app` CLI bootstraps new production-ready shielded Zcash applications with Next.js App Router, Tailwind CSS, TypeScript, and the `@zcash-app/sdk`.

**CLI Version**: `0.1.0-alpha.1` (as of November 2026)

## Synopsis

```bash
npx create-zcash-app [project-name] [options]
```

## Arguments

| Argument | Description | Default |
| :--- | :--- | :--- |
| `[project-name]` | Name of the directory to create and initialize | Prompts interactively (default: `my-zcash-app`) |

## Options & Flags

| Option | Description | Default / Fallback |
| :--- | :--- | :--- |
| `-t, --template <template>` | Template to use (nextjs-fullstack) | `nextjs-fullstack` |
| `-n, --network <network>` | Network (regtest \| testnet \| mainnet) | None (interactive prompt) |
| `--remote` | Use remote public RPC indexer without local node | None (interactive prompt) |
| `--key-source <source>` | Key source (generate \| import \| ufvk \| none) | None (interactive prompt) |
| `--ufvk <ufvk>` | Unified Full Viewing Key for watch-only account | None (interactive prompt) |
| `--endpoint <endpoint>` | lightwalletd/Zaino gRPC endpoint (host:port) | None (interactive prompt) |
| `--zebra-rpc <url>` | Zebra JSON-RPC URL (http://host:port) | None (interactive prompt) |
| `--birthday <height>` | Wallet birthday block height | None (interactive prompt) |
| `--account-index <index>` | BIP-44 account index | `0` |
| `--allow-mainnet-key-on-disk` | Explicitly allow writing mainnet private key to disk (dangerous) | None (interactive prompt) |

## Default Network Endpoints

When options are omitted, `create-zcash-app` defaults to the following endpoints based on selected network:

| Network | Default gRPC Endpoint (`ZCASH_ENDPOINT`) | Default Zebra JSON-RPC (`ZCASH_ZEBRA_RPC`) |
| :--- | :--- | :--- |
| `regtest` | `127.0.0.1:28137` | `http://127.0.0.1:18232` |
| `testnet` | `testnet.zec.rocks:443` | `http://127.0.0.1:18232` |
| `mainnet` | `zec.rocks:443` | `http://127.0.0.1:18232` |

## Key Management Rules & Redaction

- **No Secret URLs in Public Config**: `zcash.config.json` stores only redacted URLs (via `redactSecretUrl`). Unredacted RPC URLs with secret tokens are stored strictly in `.env.local`.
- **BIP-39 Validation**: Any mnemonic provided via stdin or `ZCASH_MNEMONIC` is strictly validated with `validateMnemonic` (checking 12/24 word count, valid BIP-39 wordlist, and valid SHA-256 checksum) before any project directory or configuration is written.
- **Mainnet Safety Boundary**: Writing a mainnet private spending key to disk requires passing `--allow-mainnet-key-on-disk`. Otherwise, mainnet scaffolding defaults to watch-only UFVK mode or interactive keyless setup.
