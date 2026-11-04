# Security & Key Hygiene

Shielded applications on Zcash rely on zero-knowledge cryptography to protect financial privacy. However, protocol privacy guarantees depend on rigorous client-side key hygiene and secure environment practices.

This guide details the security model enforced across `create-zcash-app`, the TypeScript SDK, and the `zcash-dev` CLI.

---

## 1. Key Authority Separation: Spending vs. Viewing

The Zcash protocol ([ZIP 316](https://zips.z.cash/zip-0316)) strictly decouples the authority to spend funds from the authority to view activity:

- **Spending Key / BIP-39 Mnemonic**: Grants absolute custody over funds. Required to sign transactions and author spend proofs.
- **Unified Full Viewing Key (UFVK)**: Grants visibility to decrypt incoming and outgoing notes, compute confirmed pool balances, and decode encrypted payment memos, but **cannot spend or transfer funds**.

### Enforcing Watch-Only Architecture in Production
For backend services (such as e-commerce checkouts, donation monitors, and accounting ledgers), **never deploy spending keys to internet-facing servers**. Deploy exclusively with the UFVK using `accountFromUfvk`:

```typescript
import { accountFromUfvk, createClient, detectIncoming } from '@zcash-app/sdk';

// Initialize watch-only account - zero custody risk
const account = accountFromUfvk(process.env.ZCASH_UFVK!, 'testnet');

// The server can safely derive addresses and detect deposits without holding spend keys
const depositAddress = account.getUnifiedAddress(orderNumber);
```

- **SDK Enforcement**: Implemented in [`packages/sdk/src/keys.ts`](https://github.com/Ultra-Tech-code/create-zcash-app/blob/main/packages/sdk/src/keys.ts#L40-L55). A `WatchOnlyAccount` object exposes no `spendHandle` and cannot author spends.
- **Dashboard Enforcement**: Implemented in [`packages/dashboard/src/app/api/account/route.ts`](https://github.com/Ultra-Tech-code/create-zcash-app/blob/main/packages/dashboard/src/app/api/account/route.ts#L32-L65). On testnet and mainnet, the dashboard operates strictly in watch-only mode and refuses to derive accounts from test mnemonics.

---

## 2. On-Disk Key Storage Policies

### Testnet vs. Mainnet Policies
- **Regtest / Testnet**: For rapid local development, the scaffolder can write keys into `.env.local`.
- **Mainnet (Never on Disk by Default)**: The scaffolder strictly refuses to write mainnet private spending keys to disk by default.
  - **Code Enforcement**: Implemented in [`packages/cli/src/index.ts`](https://github.com/Ultra-Tech-code/create-zcash-app/blob/main/packages/cli/src/index.ts#L408-L433).
  - When `--network mainnet` is selected, `shouldWriteKeyToDisk` is set to `false`. Private keys must be injected via runtime environment variables (`ZCASH_MNEMONIC`) or a dedicated secret manager (e.g. AWS Secrets Manager, HashiCorp Vault).
  - To override this guard, an operator must supply `--allow-mainnet-key-on-disk` and explicitly type `"I UNDERSTAND THE RISKS"` in the interactive prompt.

### The `.gitignore` Guard
Accidental commits of `.env` files to source control represent the single most common cause of cryptocurrency credential leaks.

- **Code Enforcement**: Implemented in [`packages/cli/src/index.ts`](https://github.com/Ultra-Tech-code/create-zcash-app/blob/main/packages/cli/src/index.ts#L465-L473).
- Before creating `.env.local`, the scaffolder executes `verifyGitignoreProtectsEnvLocal(targetDir)`.
- If the project `.gitignore` does not explicitly match and ignore `.env.local`, the scaffolder immediately aborts with a fatal error:
  ```text
  Security Error: Generated project .gitignore does not ignore .env.local. Refusing to write keys.
  ```

### File Permission Hardening (`0600`)
- **Code Enforcement**: Implemented in [`packages/cli/src/index.ts`](https://github.com/Ultra-Tech-code/create-zcash-app/blob/main/packages/cli/src/index.ts#L474-L505).
- Whenever `.env.local` is written, it is created with strict POSIX file mode `0600` (`-rw-------`) and explicitly verified via `fs.chmodSync(envLocalPath, 0o600)`.
- This ensures that only the local operating system user who created the file can read or write it, preventing unauthorized access by other local processes or user accounts.

---

## 3. Ban on Known Test Mnemonics on Mainnet

The development environment includes standard deterministic test accounts for regtest fixtures.

- **Code Enforcement**: Implemented in [`packages/sdk/src/keys.ts`](https://github.com/Ultra-Tech-code/create-zcash-app/blob/main/packages/sdk/src/keys.ts#L15-L23).
- If `accountFromMnemonic()` is invoked with `network: 'mainnet'`, the SDK normalizes the mnemonic and cross-checks it against `KNOWN_TEST_MNEMONICS`.
- If a match is detected, the SDK throws a fatal error:
  ```text
  Security Error: Using known test fixture mnemonics on mainnet is strictly prohibited to prevent fund loss.
  ```

---

## 4. CLI Execution Safety

### No Secrets via Command-Line Arguments (`argv`)
- **Code Enforcement**: Implemented in [`packages/dev/src/cli.ts`](https://github.com/Ultra-Tech-code/create-zcash-app/blob/main/packages/dev/src/cli.ts#L351-L380).
- The `zcash-dev send`, `address`, and `balance` commands **never accept keys or mnemonics as CLI flags**.
- Passing secrets via flags (e.g. `--mnemonic "..."`) exposes sensitive credentials to:
  1. Plaintext shell history files (`~/.bash_history`, `~/.zsh_history`).
  2. Operating system process listings accessible to any unprivileged user (`ps aux`, `/proc`).
  3. System monitoring and crash-reporting tools.
- Secrets are read exclusively from environment variables or permission-hardened `.env.local` files loaded via `loadProjectEnv()`.

### Dry-Run Default for Transactions
- **Code Enforcement**: Implemented in [`packages/dev/src/cli.ts`](https://github.com/Ultra-Tech-code/create-zcash-app/blob/main/packages/dev/src/cli.ts#L162-L171) and [`packages/dev/src/cli.ts`](https://github.com/Ultra-Tech-code/create-zcash-app/blob/main/packages/dev/src/cli.ts#L355).
- Running `zcash-dev send` without the explicit `--yes` flag will **never broadcast a transaction**.
- By default, it performs a dry-run simulation: verifying the recipient address format, selecting spendable notes, estimating ZIP-317 fees, and reporting transaction parameters to the developer.

### Explicit `--mainnet` Safety Flag
- **Code Enforcement**: Implemented in [`packages/dev/src/cli.ts`](https://github.com/Ultra-Tech-code/create-zcash-app/blob/main/packages/dev/src/cli.ts#L173-L175).
- When operating against mainnet, passing `--yes` alone is rejected:
  ```text
  Error: Sending on mainnet requires the explicit --mainnet flag.
  ```
- Broadcasting real funds requires both `--yes` and `--mainnet`, preventing catastrophic accidental broadcasts caused by misconfigured shell scripts or copy-pasted test commands.

---

## 5. URL and Credential Redaction

Connection strings to JSON-RPC consensus nodes or secondary verification nodes often contain embedded HTTP Basic authentication credentials (such as username and passwords).

- **Code Enforcement**: Implemented in [`packages/cli/src/index.ts`](https://github.com/Ultra-Tech-code/create-zcash-app/blob/main/packages/cli/src/index.ts#L9) and [`packages/dashboard/src/app/api/explorer/backend.ts`](https://github.com/Ultra-Tech-code/create-zcash-app/blob/main/packages/dashboard/src/app/api/explorer/backend.ts).
- All endpoints containing credentials pass through URL sanitization before being rendered in terminal outputs, dashboard UI elements, or error traces.
- Password components are replaced with redacted placeholders (`http://user:***@host:port`), preventing credential leaks in logs or screenshots.
