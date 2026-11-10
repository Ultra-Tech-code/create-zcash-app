# Changelog

All notable changes to `create-zcash-app` and its workspace packages will be documented in this file.

## [Unreleased]

### Breaking Changes
- **SDK `send()` Returns Display-Order TxID**: `send()` (`@zcash-app/sdk`) now returns `txid` in standard node/explorer display order (byte-reversed relative to internal Zcash wire format). This aligns with Zebra JSON-RPC (`getrawmempool`, `getblock`, `getrawtransaction`), block explorers, and user expectations. Previously, `send()` returned the internal wire-order byte string, requiring manual calls to `reverseTxid()`. Internal wallet functions (such as `markBroadcastWithReservation()`) continue to consume wire order as required by native core bindings.

## [0.1.0-alpha.4] - 2026-11-05

### Developer Dashboard (`@zcash-app/dashboard`)
- **Published Package**: Shipped the Developer Dashboard as `@zcash-app/dashboard` on npm, packaging production Next.js build artifacts (`.next`), public assets, `LICENSE`, and pure ESM `next.config.mjs` with development, diagnostics, and tracing caches pruned for clean tarball hygiene.
- **CLI Launch Integration**: Enabled `zcash-dev dashboard` to launch the packaged production dashboard via `next start` on port 3050 in scaffolded projects, while preserving the fallback to `next dev` inside the monorepo clone.
- **Port Strategy Resolution**: Added pure `resolveDashboardStrategy` helper with full test coverage for packaged, monorepo, and uninstalled failure scenarios.

### Scaffolder (`create-zcash-app`)
- **Scaffolded Dashboard Script**: Restored `"dashboard": "zcash-dev dashboard"` in `packages/cli/template/package.json.tmpl` and quickstart documentation so newly scaffolded projects can run `pnpm dashboard` immediately.

### Documentation & Reference
- **Ports Reference**: Added dedicated default network and ports reference page (`docs/src/reference/ports.md`) documenting all port allocations across the ecosystem (3000 scaffolded Next app, 3050 developer dashboard, 39067/39232 NU7 stack, 28137/8181/29232 Z3 stack).
- **Build Requirements**: Documented Google Fonts build-time download requirements (`next/font/google`) for `@zcash-app/dashboard` in `RELEASING.md`, `docs/src/reference/ports.md`, and `docs/src/reference/dashboard-api.md`.

## [0.1.0-alpha.3] - 2026-11-05

### TypeScript SDK (`@zcash-app/sdk`)
- **Watch-Only Spend Guard**: Added exported `WatchOnlySpendError` and exported `isWatchOnly(account)` helper function.
- **Pre-flight Send Guard**: Enforced synchronous watch-only checking in `send()` before network or consensus calls, immediately rejecting attempts to spend from viewing-only (UFVK) accounts with `WatchOnlySpendError`.

### Developer CLI (`zcash-dev`)
- **Pretty Zebra JSON-RPC Mode**: Added a human-readable CLI inspection mode inspired by dismad's `zebraUtilities` (reimplemented purely in TypeScript with zero shell, curl, jq, or bc dependencies, using BigInt zatoshis precision end-to-end and strict secret URL redaction).
- **RPC Command**: Added `zcash-dev rpc <method> [params...] [--pretty] [--json] [--no-color] [--local] [-e, --zebra-rpc <url>]` for executing raw or formatted Zebra JSON-RPC queries.
- **Transaction Inspection**: Added `zcash-dev tx <txid> [--json] [--no-color] [--local]` displaying block height, confirmations, lock time, transparent/shielded inputs and outputs, value pool balances (Sprout, Sapling, Orchard, Ironwood), and computed fees for both mined and mempool transactions.
- **Block Inspection**: Added `zcash-dev block <height|hash> [--json] [--no-color] [--local]` displaying block header metadata, height, hash, timestamp, size, and transaction list.
- **Supply Distribution**: Added `zcash-dev supply [--json] [--no-color] [--local]` displaying total chain supply across value pools looked up strictly by pool ID with formatted ZEC values.
- **Peer Information**: Added `zcash-dev peers [--json] [--no-color] [--local]` displaying connected Zebra peers, addresses, protocol versions, user agents, and ping latency.
- **Mempool Inspection**: Added `zcash-dev mempool [--json] [--no-color] [--local]` displaying pending unmined transactions in Zebra's memory pool.

### Native Core (`@zcash-app/core`)
- **Version Alignment**: Bumped core package and all 5 platform packages (`darwin-arm64`, `darwin-x64`, `linux-arm64-gnu`, `linux-x64-gnu`, `win32-x64-msvc`) to `0.1.0-alpha.3`.
- **Version Check Assertions**: Aligned runtime native addon version check assertions to expect `0.1.0-alpha.3`.

### Documentation (Stage 2)
- **Integration Recipes**: Added production-oriented recipes for Checkout & e-commerce payments (`docs/src/recipes/checkout.md`), Disbursement & Payroll (`docs/src/recipes/payroll.md`), and Watch-Only Account Monitoring (`docs/src/recipes/watch-only-monitor.md`), backed by executable examples in `examples/checkout/` and `examples/watch-only/`.
- **Advanced Guides**: Added comprehensive reference guides for Pretty RPC (`docs/src/guides/pretty-rpc.md`), Security & Redaction pipeline (`docs/src/guides/security.md`), Troubleshooting & Common Errors (`docs/src/guides/troubleshooting.md`), and Dashboard architecture (`docs/src/guides/dashboard.md`).
- **Vendored Mermaid Rendering**: Integrated mdBook Mermaid diagram support with vendored `mermaid.min.js` (v11.4.1) and zero external CDN dependencies, covered by automated Playwright verification (`pnpm docs:verify-mermaid`).
- **Credits**: Credited dismad (`dismad/zebraUtilities`) for the pretty-RPC concept in `docs/src/ch01-introduction.md` and `docs/src/guides/pretty-rpc.md`.

### Continuous Integration & Workflows
- **Offline Formatters Matrix**: Added `pretty-rpc-offline` matrix job in `.github/workflows/ci.yml` verifying TypeScript-only formatting tests across Ubuntu, macOS, and Windows without native Rust addon dependencies.
- **Tarball Download Hardening**: Hardened mdBook, mdbook-linkcheck2, and mdbook-mermaid downloads in `.github/workflows/ci.yml` and `.github/workflows/docs-pages.yml` with curl retry flags (`--retry 5 --retry-delay 3 --retry-all-errors`) and temporary file unpacking.

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
