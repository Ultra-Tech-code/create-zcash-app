# Changelog

All notable changes to `create-zcash-app` and its workspace packages will be documented in this file.

## [0.1.0-alpha.2] - 2026-11-02

### Scaffolder (`create-zcash-app`)
- **Key & Account Configuration**: Added `--key-source <generate|import|ufvk|none>`, `--birthday <height>`, and `--account-index <idx>`. Supported non-interactive mnemonic input via `ZCASH_MNEMONIC` environment variable or standard input. Added BIP-39 word count, wordlist, and checksum validation.
- **Endpoint & RPC Configuration**: Added `--endpoint <host:port>` (defaults: `127.0.0.1:39067` for NU7, `127.0.0.1:28137` for Z3) with strict `host:port` format validation and `--zebra-rpc <url>` (defaults: `http://127.0.0.1:39232` for NU7, `http://127.0.0.1:18232` for Z3).
- **Regtest Stack Selection**: Added `--regtest-stack <nu7|z3>` (default: `nu7`) to scaffold projects with the corresponding compose configuration and endpoint defaults.
- **Security Protections**: Enforced `.gitignore` verification before writing `.env.local` (file mode `0600`). Committed `.env.example` template without secrets. Implemented secret URL redaction for credentials in `zcash.config.json` and CLI errors. Added mainnet protection refusing to write secret keys to disk.
- **Template Enhancements**: Supported watch-only Unified Full Viewing Key (UFVK) accounts in Next.js `app/api/account/route.ts` with sanitized error responses.

### Developer CLI (`zcash-dev`)
- **Address Command**: Added `zcash-dev address [-i, --index <n>]` to display the derived Unified Address and Transparent address for mnemonic, UFVK, or regtest default fixtures.
- **Balance Command**: Added `zcash-dev balance [-e, --endpoint <endpoint>]` to display verified, unverified/pending, and total shielded balances.
- **Send Command**: Added `zcash-dev send --to <address> --amount <zec> [--memo <memo>] [--yes] [--mainnet] [-e, --endpoint <endpoint>]`. Runs in dry-run mode by default calculating ZIP-317 fees without broadcasting; requires `--yes` to sign and broadcast the transaction, and `--mainnet` when broadcasting on mainnet.
- **Fund Command**: Added `zcash-dev fund <address> [amount] [--endpoint <endpoint>] [--stack <nu7|z3>]`. On the NU7 stack, funds target address directly from Account 0 miner block rewards using `@zcash-app/sdk` client; on the Z3 stack, routes to Zallet on port `8181`.
- **Regtest Stack Orchestration**: Added `--stack <nu7|z3>` support to `zcash-dev regtest up` to launch the NU7 stack or legacy Z3 stack.
- **Startup Resilience**: Added retry loop in `regtest-init.sh` waiting for Zebra block generation before mining initial blocks. Added clean error reporting on init script failure without Node stack traces.
- **Environment & Redaction**: Automatically loads `.env.local` and `.env` and redacts secret URL credentials in command output and logs.

### TypeScript SDK (`@zcash-app/sdk`)
- **NU7 Regtest Support**: Added `'regtest-nu7'` network support to `dev.fixtures.account` and updated `dev.mine` to target Zebra RPC on port `39232` when operating against the NU7 stack.
- **Loopback Origin Tagging**: Added loopback host detection in JSON-RPC and indexer clients to distinguish local test endpoints from remote third-party servers in connection logs.

### Native Core (`@zcash-app/core`)
- **Version Alignment**: Bumped core package and all 5 platform packages (`darwin-arm64`, `darwin-x64`, `linux-arm64-gnu`, `linux-x64-gnu`, `win32-x64-msvc`) to `0.1.0-alpha.2`.
- **Version Check Assertions**: Aligned runtime native addon version check assertions to expect `0.1.0-alpha.2`.

### Documentation
- **mdBook Documentation Book**: Introduced Stage 1 documentation book in `docs/` with chapters covering Introduction, Quickstart, Concepts, and Reference manuals for CLI and SDK interfaces.
- **Automated Drift & Link Verification**: Added `pnpm docs:gen` and `pnpm docs:check` to prevent CLI option drift, ensure path portability, and validate internal markdown links.
- **Machine-Independent Paths**: Normalized all generated reference documentation and command examples to eliminate machine-specific home paths.
- **Badges**: Added DeepWiki badge to repository `README.md`.

### Regtest / Stacks
- **NU7 Regtest Stack**: Added Zebra 7.0.0 (`zfnd/zebra:7.0.0`) + Lightwalletd Docker Compose stack on gRPC port `39067` and Zebra RPC port `39232`.
- **Z3 Regtest Stack**: Maintained Zaino 0.10.0 + Zebra + Zallet stack on gRPC port `28137`.
- **Initialization Script**: Added retry loop with 60-second timeout and detailed failure logging to `regtest-init.sh`.

### Dashboard (`dashboard`)
- **Node Sync Tracking**: Implemented real-time Zebra block height and synchronization percentage calculation from `getblockchaininfo`.
- **Verification Progress**: Added node verification progress bar.
- **Theme**: Applied dark cypherpunk-industrial theme styling.

---

## [0.1.0-alpha.1] - 2026-11-01

- Initial alpha release of `create-zcash-app`, `@zcash-app/sdk`, `zcash-dev`, and `@zcash-app/core`.
- Configured npm trusted publishing (OIDC) workflow and 9-tarball packaging pipeline.
- Scaffold Next.js shielded application template with App Router.
- Basic regtest developer harness and local Docker Compose stack.
