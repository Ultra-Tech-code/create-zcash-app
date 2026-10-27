#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use rusqlite::{Connection, OptionalExtension, Transaction};
use thiserror::Error;

pub const CURRENT_SCHEMA_VERSION: u32 = 3;

pub mod metadata_keys {
    pub const NETWORK: &str = "network";
    pub const UFVK_FINGERPRINT: &str = "ufvk_fingerprint";
    pub const FIRST_SCANNED_HEIGHT: &str = "first_scanned_height";
    pub const FIRST_SCANNED_HASH: &str = "first_scanned_hash";
    pub const BIRTHDAY: &str = "birthday";
    pub const TREE_VALID: &str = "tree_valid";
    pub const SCHEMA_VERSION: &str = "schema_version";
}

#[derive(Error, Debug)]
pub enum SchemaError {
    #[error("Database error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("Invalid schema version: expected {expected}, found {found}")]
    InvalidVersion { expected: u32, found: u32 },
}

pub fn initialize_schema(conn: &mut Connection) -> Result<(), SchemaError> {
    let tx = conn.transaction()?;

    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at INTEGER NOT NULL
        );",
    )?;

    let current_version: Option<u32> = tx
        .query_row(
            "SELECT MAX(version) FROM schema_migrations",
            [],
            |row| row.get::<_, Option<u32>>(0),
        )
        .optional()?
        .flatten();

    let version = current_version.unwrap_or(0);
    if version < 1 {
        apply_migration_v1(&tx)?;
    }
    if version < 2 {
        apply_migration_v2(&tx)?;
    }
    if version < 3 {
        apply_migration_v3(&tx)?;
    }

    tx.commit()?;
    Ok(())
}

fn apply_migration_v1(tx: &Transaction) -> Result<(), SchemaError> {
    tx.execute_batch(
        "
        -- 1. Metadata: Network, account binding, chain identity, and sync state
        CREATE TABLE IF NOT EXISTS wallet_metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        -- 2. Scanned Blocks (Sliding Reorg Window: Last 100 Blocks)
        CREATE TABLE IF NOT EXISTS scanned_blocks (
            height INTEGER PRIMARY KEY,
            block_hash BLOB NOT NULL,
            prev_hash BLOB NOT NULL,
            tree_size INTEGER NOT NULL,
            scanned_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_scanned_blocks_hash ON scanned_blocks(block_hash);

        -- 3. Received Notes (Single source of truth for owned notes)
        -- Explicitly NO CASCADE on scanned_blocks: header pruning must never delete notes.
        CREATE TABLE IF NOT EXISTS received_notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id TEXT NOT NULL,
            pool TEXT NOT NULL CHECK(pool = 'ironwood'),
            txid BLOB NOT NULL,
            action_index INTEGER NOT NULL,
            height INTEGER NOT NULL,
            recipient TEXT NOT NULL,
            value_zatoshis INTEGER NOT NULL,
            nullifier BLOB NOT NULL UNIQUE,
            rho BLOB NOT NULL,
            rseed BLOB NOT NULL,
            cmx BLOB NOT NULL,
            tree_position INTEGER NOT NULL,
            scope TEXT NOT NULL CHECK(scope IN ('external', 'internal')),
            memo BLOB,
            spent_in_txid BLOB,
            spent_at_height INTEGER,
            CONSTRAINT uq_txid_action UNIQUE (txid, action_index)
        );
        CREATE INDEX IF NOT EXISTS idx_notes_nullifier ON received_notes(nullifier);
        CREATE INDEX IF NOT EXISTS idx_notes_unspent ON received_notes(spent_in_txid) WHERE spent_in_txid IS NULL;
        CREATE INDEX IF NOT EXISTS idx_notes_height ON received_notes(height);

        -- 4. Pending Spends (v1: note_id NOT NULL)
        CREATE TABLE IF NOT EXISTS pending_spends (
            nullifier BLOB PRIMARY KEY,
            note_id INTEGER NOT NULL,
            txid BLOB NOT NULL,
            created_at INTEGER NOT NULL,
            expiry_height INTEGER NOT NULL,
            state TEXT NOT NULL CHECK(state IN ('reserved', 'broadcast', 'mined')),
            owner_pid INTEGER NOT NULL,
            heartbeat_at INTEGER NOT NULL,
            FOREIGN KEY(note_id) REFERENCES received_notes(id)
        );
        CREATE INDEX IF NOT EXISTS idx_pending_spends_txid ON pending_spends(txid);
        CREATE INDEX IF NOT EXISTS idx_pending_spends_state ON pending_spends(state);

        -- 5. ShardTree Store Tables (Ironwood Commitment Tree Persistence)
        CREATE TABLE IF NOT EXISTS ironwood_tree_shards (
            shard_index INTEGER PRIMARY KEY,
            subtree_end_height INTEGER,
            root_hash BLOB,
            shard_data BLOB,
            contains_marked INTEGER,
            CONSTRAINT ironwood_shard_root_unique UNIQUE (root_hash)
        );

        CREATE TABLE IF NOT EXISTS ironwood_tree_cap (
            cap_id INTEGER PRIMARY KEY,
            cap_data BLOB NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ironwood_tree_checkpoints (
            checkpoint_id INTEGER PRIMARY KEY,
            position INTEGER
        );

        CREATE TABLE IF NOT EXISTS ironwood_tree_checkpoint_marks_removed (
            checkpoint_id INTEGER NOT NULL,
            mark_removed_position INTEGER NOT NULL,
            PRIMARY KEY (checkpoint_id, mark_removed_position),
            FOREIGN KEY (checkpoint_id) REFERENCES ironwood_tree_checkpoints(checkpoint_id) ON DELETE CASCADE
        );

        -- Record migration v1 completion
        INSERT INTO schema_migrations (version, applied_at)
        VALUES (1, unixepoch());

        INSERT OR REPLACE INTO wallet_metadata (key, value)
        VALUES ('schema_version', '1');
        ",
    )?;
    Ok(())
}

fn apply_migration_v2(tx: &Transaction) -> Result<(), SchemaError> {
    tx.execute_batch(
        "
        -- Migration v2: Make pending_spends.note_id nullable with ON DELETE SET NULL to preserve reservations across reorgs
        CREATE TABLE IF NOT EXISTS pending_spends_v2 (
            nullifier BLOB PRIMARY KEY,
            note_id INTEGER,
            txid BLOB NOT NULL,
            created_at INTEGER NOT NULL,
            expiry_height INTEGER NOT NULL,
            state TEXT NOT NULL CHECK(state IN ('reserved', 'broadcast', 'mined')),
            owner_pid INTEGER NOT NULL,
            heartbeat_at INTEGER NOT NULL,
            FOREIGN KEY(note_id) REFERENCES received_notes(id) ON DELETE SET NULL
        );

        INSERT OR IGNORE INTO pending_spends_v2 (nullifier, note_id, txid, created_at, expiry_height, state, owner_pid, heartbeat_at)
        SELECT nullifier, note_id, txid, created_at, expiry_height, state, owner_pid, heartbeat_at FROM pending_spends;

        DROP TABLE pending_spends;
        ALTER TABLE pending_spends_v2 RENAME TO pending_spends;

        CREATE INDEX IF NOT EXISTS idx_pending_spends_txid ON pending_spends(txid);
        CREATE INDEX IF NOT EXISTS idx_pending_spends_state ON pending_spends(state);

        INSERT INTO schema_migrations (version, applied_at)
        VALUES (2, unixepoch());

        INSERT OR REPLACE INTO wallet_metadata (key, value)
        VALUES ('schema_version', '2');
        ",
    )?;
    Ok(())
}

fn apply_migration_v3(tx: &Transaction) -> Result<(), SchemaError> {
    tx.execute_batch(
        "
        -- Migration v3: Add wallet_transactions table for full transaction history
        CREATE TABLE IF NOT EXISTS wallet_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            txid TEXT NOT NULL,
            height INTEGER NOT NULL,
            direction TEXT NOT NULL CHECK(direction IN ('in', 'out', 'internal')),
            value INTEGER NOT NULL,
            fee INTEGER NOT NULL,
            memo TEXT,
            counterparty TEXT,
            pool TEXT NOT NULL CHECK(pool = 'ironwood'),
            created_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_wallet_transactions_txid ON wallet_transactions(txid);
        CREATE INDEX IF NOT EXISTS idx_wallet_transactions_height ON wallet_transactions(height);
        CREATE INDEX IF NOT EXISTS idx_wallet_transactions_direction ON wallet_transactions(direction);

        INSERT INTO schema_migrations (version, applied_at)
        VALUES (3, unixepoch());

        INSERT OR REPLACE INTO wallet_metadata (key, value)
        VALUES ('schema_version', '3');
        ",
    )?;
    Ok(())
}

