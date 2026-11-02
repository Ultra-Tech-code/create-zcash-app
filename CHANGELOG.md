# Changelog

All notable changes to `create-zcash-app` and its workspace packages will be documented in this file.

## [0.1.0-alpha.2] - 2026-11-02

### Scaffolder (`create-zcash-app`)
- **Key & Account Configuration**: Added `--key-source <generate|import|ufvk|none>`, `--birthday <height>`, and `--account-index <idx>`. Supported non-interactive mnemonic input via `ZCASH_MNEMONIC` environment variable or standard input. Added BIP-39 wordlist checksum validation.
- **Endpoint & RPC Flags**: Added `--endpoint <host:port>` (defaults: `127.0.0.1:39067` for NU7, `127.0.0.1:28137` for Z3) and `--zebra-rpc <url>` (defaults: `http://127.0.0.1:39232` for NU7, `http://127.0.0.1:18232` for Z3).
- **Regtest Stack Selection**: Added `--regtest-stack <nu7|z3>` (default: `nu7`) to scaffold projects with the corresponding compose configuration and endpoint defaults.
- **Security Protections**: Enforced strict `.gitignore` verification before writing `.env.local` (mode `0600`). Committed safe `.env.example` template without secrets. Implemented secret URL redaction for credentials in `zcash.config.json` and CLI errors. Added mainnet protection refusing to write secret keys to disk.
- **Template Enhancements**: Supported watch-only Unified Full Viewing Key (UFVK) accounts in Next.js `app/api/account/route.ts` with sanitized error responses.

### Developer CLI (`zcash-dev`)
- **Wallet Commands**:
  - `zcash-dev address`: Displays current account unified address with receiver inspection (Orchard, Sapling, Transparent).
  - `zcash-dev balance`: Displays verified, unverified/pending, and total shielded balances.
  - `zcash-dev send <address> <amount>`: Transfers shielded funds with ZIP-317 fee calculation. Includes dry-run verification prompt by default; accepts `--yes` to proceed without interactive confirmation.
  - `zcash-dev fund`: Stack-aware funding helper. On NU7, funds target UA directly from Account 0 miner block rewards using `@zcash-app/sdk` without requiring Zallet. On Z3, routes to Zallet on port `8181`.
- **Regtest Stack Orchestration**: Added `--stack <nu7|z3>` support to `zcash-dev regtest up` to launch the NU7 stack or legacy Z3 stack.
- **Startup Resilience**: Added retry loop in `regtest-init.sh` waiting for Zebra block generation before mining initial blocks. Added clean error reporting on init script failure without Node stack traces.
- **Environment & Redaction**: Automatically loads `.env.local` and redacts secret URL credentials in command output and logs.

### TypeScript SDK (`@zcash-app/sdk`)
- **Regtest Funding Helpers**: Added Account 0 miner reward funding routines for the NU7 regtest stack.
- **Native Binding Stub**: Supported loader proxy stub allowing doc extractors and headless tools to run without native `.node` binaries present.
- **Canary Test Stability**: Adjusted timeouts for canary explorer listener tests.

### Native Core (`@zcash-app/core`)
- **Version Alignment**: Bumped core package and all 5 platform packages (`darwin-arm64`, `darwin-x64`, `linux-arm64-gnu`, `linux-x64-gnu`, `win32-x64-msvc`) to `0.1.0-alpha.2`.
- **Version Check Assertions**: Aligned runtime native addon version check assertions to expect `0.1.0-alpha.2`.

### Documentation
- **mdBook Documentation Book**: Introduced full documentation book in `docs/` with chapters covering Introduction, Quickstart, Concepts, Architecture, and Reference manuals.
- **Automated Drift & Link Verification**: Added `pnpm docs:gen`, `pnpm docs:check`, and `pnpm docs:check:external` to prevent CLI option drift, ensure path portability, and validate internal/external links.
- **Machine-Independent Paths**: Normalized all generated reference documentation and command examples to eliminate machine-specific home paths.
- **Badges**: Added DeepWiki badge to repository `README.md`.

### Regtest / Stacks
- **NU7 Regtest Stack**: Added Zebra 2.4.0 + Lightwalletd Docker Compose stack on gRPC port `39067` and Zebra RPC port `39232`.
- **Z3 Regtest Stack**: Maintained Zaino 0.10.0 + Zebra + Zallet stack on gRPC port `28137`.
- **Initialization Script**: Added retry loop with 60-second timeout and detailed failure logging to `regtest-init.sh`.

### Dashboard (`dashboard`)
- **Node Sync Tracking**: Implemented real-time Zebra block height and synchronization percentage calculation from `getblockchaininfo`.
- **Verification Progress**: Added node verification progress bar.
- **Theme & Styling**: Applied dark cypherpunk-industrial aesthetic and responsive layout.
- **Unit Tests**: Added automated tests for sync percentage logic (`packages/dashboard/test/sync.test.mjs`).

---

## [0.1.0-alpha.1] - 2026-11-01

- Initial alpha release of `create-zcash-app`, `@zcash-app/sdk`, `zcash-dev`, and `@zcash-app/core`.
- Configured npm trusted publishing (OIDC) workflow and 9-tarball packaging pipeline.
- Scaffold Next.js shielded application template with App Router and Tailwind CSS.
- Basic regtest developer harness and local Docker Compose stack.
