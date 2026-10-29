# @zcash-app/dashboard

Developer dashboard and real-time explorer for shielded Zcash applications on the Z3 stack.

## Getting Started

Run the development server:

```bash
pnpm dev
```

Open [http://localhost:3050](http://localhost:3050) with your browser to view the dashboard.

## Security & Storage Architecture

> [!WARNING]
> **Plaintext Memo & Counterparty Storage**:
> Decrypted transaction memos and counterparties are stored in **plaintext** in the SQLite wallet database (`wallet_transactions` table) to support local search, history inspection, and accounting.
> 
> To protect user privacy:
> - Persisted databases are stored under `~/.zcash-app/dashboard/`.
> - Directory permissions are strictly enforced to `0700` (read, write, execute by owner only).
> - SQLite database files are strictly enforced to `0600` (read and write by owner only).
> - Spending keys are never persisted in the dashboard database; only view keys and public metadata are stored.

## Background Synchronization & API

The dashboard uses non-blocking background synchronization with the indexer via `@zcash-app/sdk`:

- **`/api/sync/status`**: Returns immediate sync status without blocking (`status`, `scanned`, `target`, `notesFound`, `pendingFetches`, `failedFetches`). Responses always return in under 5 seconds (typically < 50ms).
- **Batch Transaction Fetching**: For each transaction touching the wallet (new note or spent nullifier), the full transaction is fetched, decrypted, and upserted idempotently into `wallet_transactions` (keyed by `txid + action_index + direction`).
- **Chain Reorganization**: On reorg detection, `resolveReorg` rolls back commitment trees and deletes orphaned rows in `wallet_transactions` at `height >= fromHeight`.
