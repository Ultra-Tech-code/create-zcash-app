use std::os::unix::fs::PermissionsExt;
use zcash_core::{
    get_nu6_3_activation_height, get_nu6_3_branch_id, metadata_keys, WalletDb, WalletDbError,
};

#[test]
fn test_nu6_3_activation_heights_from_consensus() {
    println!("\n=== TEST: NU6.3 ACTIVATION HEIGHTS & BRANCH ID FROM CONSENSUS ===");

    let mainnet_height = get_nu6_3_activation_height("mainnet").expect("mainnet activation height");
    let testnet_height = get_nu6_3_activation_height("testnet").expect("testnet activation height");
    let regtest_height = get_nu6_3_activation_height("regtest").expect("regtest activation height");
    let branch_id = get_nu6_3_branch_id();

    println!("  Mainnet NU6.3 Activation Height: {}", mainnet_height);
    println!("  Testnet NU6.3 Activation Height: {}", testnet_height);
    println!("  Regtest NU6.3 Activation Height: {}", regtest_height);
    println!("  NU6.3 Consensus Branch ID:       0x{:08x}", branch_id);

    assert_eq!(mainnet_height, 3_428_143, "Mainnet NU6.3 must equal 3,428,143");
    assert_eq!(testnet_height, 4_134_000, "Testnet NU6.3 must equal 4,134,000");
    assert_eq!(regtest_height, 2, "Regtest NU6.3 must equal 2 (matching Zebra regtest schedule)");
    assert_eq!(branch_id, 0x37a5_165b, "NU6.3 BranchId must equal 0x37a5165b");
}

#[test]
fn test_schema_initialization_and_permissions() {
    println!("\n=== TEST: SCHEMA INITIALIZATION & PERMISSIONS ENFORCEMENT ===");
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let db_path = temp_dir.path().join("wallet_sub").join("wallet.db");

    let db = WalletDb::open_or_create(&db_path, "regtest", "ufvk_fp_12345", Some(2))
        .expect("open_or_create");

    // Check parent directory permissions (0700)
    let parent = db_path.parent().expect("parent dir");
    let parent_mode = std::fs::metadata(parent).expect("metadata").permissions().mode() & 0o777;
    println!("  Parent directory mode: 0o{:o} (expected 0o700)", parent_mode);
    assert_eq!(parent_mode, 0o700, "Directory permissions must be 0700");

    // Check database file permissions (0600)
    let file_mode = std::fs::metadata(&db_path).expect("metadata").permissions().mode() & 0o777;
    println!("  Database file mode:    0o{:o} (expected 0o600)", file_mode);
    assert_eq!(file_mode, 0o600, "Database file permissions must be 0600");

    // Check metadata keys
    assert_eq!(
        db.get_metadata(metadata_keys::SCHEMA_VERSION).expect("meta"),
        Some("2".to_string())
    );
    assert_eq!(
        db.get_metadata(metadata_keys::NETWORK).expect("meta"),
        Some("regtest".to_string())
    );
    assert_eq!(
        db.get_metadata(metadata_keys::UFVK_FINGERPRINT).expect("meta"),
        Some("ufvk_fp_12345".to_string())
    );
    assert_eq!(
        db.get_metadata(metadata_keys::BIRTHDAY).expect("meta"),
        Some("2".to_string())
    );
    assert_eq!(
        db.get_metadata(metadata_keys::TREE_VALID).expect("meta"),
        Some("true".to_string())
    );

    // Verify all required tables exist in sqlite_master
    let conn = db.conn();
    let expected_tables = vec![
        "schema_migrations",
        "wallet_metadata",
        "scanned_blocks",
        "received_notes",
        "pending_spends",
        "ironwood_tree_shards",
        "ironwood_tree_cap",
        "ironwood_tree_checkpoints",
        "ironwood_tree_checkpoint_marks_removed",
    ];

    for table in expected_tables {
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                rusqlite::params![table],
                |row| row.get(0),
            )
            .expect("check table existence");
        assert_eq!(count, 1, "Table '{}' must exist in database", table);
        println!("  Table verified: {}", table);
    }
}

#[test]
fn test_metadata_binding_and_mismatch() {
    println!("\n=== TEST: METADATA BINDING AND MISMATCH ENFORCEMENT ===");
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let db_path = temp_dir.path().join("wallet.db");

    // Initialize with regtest and fingerprint A
    {
        let _ = WalletDb::open_or_create(&db_path, "regtest", "fingerprint_A", Some(10))
            .expect("create first");
    }

    // Reopening with same network and fingerprint succeeds
    {
        let reopened = WalletDb::open_or_create(&db_path, "regtest", "fingerprint_A", None);
        assert!(reopened.is_ok(), "Reopening with matching metadata must succeed");
    }

    // Reopening with different network fails with MetadataMismatch
    {
        let mismatch_net = WalletDb::open_or_create(&db_path, "mainnet", "fingerprint_A", None);
        match mismatch_net {
            Err(WalletDbError::MetadataMismatch { key, expected, found }) => {
                println!(
                    "  Correctly rejected network mismatch! key: {}, expected: {}, found: {}",
                    key, expected, found
                );
                assert_eq!(key, "network");
                assert_eq!(expected, "mainnet");
                assert_eq!(found, "regtest");
            }
            other => panic!("Expected MetadataMismatch error, got {:?}", other),
        }
    }

    // Reopening with different fingerprint fails with MetadataMismatch
    {
        let mismatch_fp = WalletDb::open_or_create(&db_path, "regtest", "fingerprint_B", None);
        match mismatch_fp {
            Err(WalletDbError::MetadataMismatch { key, expected, found }) => {
                println!(
                    "  Correctly rejected fingerprint mismatch! key: {}, expected: {}, found: {}",
                    key, expected, found
                );
                assert_eq!(key, "ufvk_fingerprint");
                assert_eq!(expected, "fingerprint_B");
                assert_eq!(found, "fingerprint_A");
            }
            other => panic!("Expected MetadataMismatch error, got {:?}", other),
        }
    }
}

#[test]
fn test_notes_unique_txid_action_constraint() {
    println!("\n=== TEST: RECEIVED_NOTES UNIQUE(txid, action_index) CONSTRAINT ===");
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let db_path = temp_dir.path().join("wallet.db");

    let db = WalletDb::open_or_create(&db_path, "regtest", "fp", None).expect("open db");
    let conn = db.conn();

    let txid = [1u8; 32];
    let nf1 = [10u8; 32];
    let nf2 = [11u8; 32];
    let dummy32 = [0u8; 32];

    // Insert first action for txid at action_index 0
    let res1 = conn.execute(
        "INSERT INTO received_notes (
            account_id, pool, txid, action_index, height, recipient, value_zatoshis,
            nullifier, rho, rseed, cmx, tree_position, scope
        ) VALUES (
            'acc0', 'ironwood', ?1, 0, 10, 'ua_test', 100000,
            ?2, ?3, ?3, ?3, 0, 'external'
        )",
        rusqlite::params![txid.as_slice(), nf1.as_slice(), dummy32.as_slice()],
    );
    assert!(res1.is_ok(), "First note insertion must succeed");

    // Attempt to insert duplicate (txid, action_index = 0) with distinct nullifier
    let res2 = conn.execute(
        "INSERT INTO received_notes (
            account_id, pool, txid, action_index, height, recipient, value_zatoshis,
            nullifier, rho, rseed, cmx, tree_position, scope
        ) VALUES (
            'acc0', 'ironwood', ?1, 0, 10, 'ua_test', 100000,
            ?2, ?3, ?3, ?3, 1, 'external'
        )",
        rusqlite::params![txid.as_slice(), nf2.as_slice(), dummy32.as_slice()],
    );

    assert!(res2.is_err(), "Duplicate (txid, action_index) must be rejected");
    println!("  Successfully rejected duplicate (txid, action_index) via UNIQUE constraint");
}

#[test]
fn test_schema_v1_to_v2_migration_in_place_preserves_reservations() {
    println!("\n=== TEST: IN-PLACE SCHEMA MIGRATION V1 -> V2 PRESERVES RESERVATIONS ===");
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let db_path = temp_dir.path().join("wallet_v1_to_v2.db");

    // 1. Manually create v1 schema database with foreign keys ON
    let mut conn = rusqlite::Connection::open(&db_path).expect("open raw sqlite");
    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;").expect("pragmas");

    // Initialize v1 schema manually
    let tx = conn.transaction().expect("tx");
    tx.execute_batch(
        "
        CREATE TABLE schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at INTEGER NOT NULL
        );
        CREATE TABLE wallet_metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE scanned_blocks (
            height INTEGER PRIMARY KEY,
            block_hash BLOB NOT NULL,
            prev_hash BLOB NOT NULL,
            tree_size INTEGER NOT NULL,
            scanned_at INTEGER NOT NULL
        );
        CREATE TABLE received_notes (
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
        -- v1 pending_spends had note_id NOT NULL without ON DELETE SET NULL
        CREATE TABLE pending_spends (
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
        CREATE TABLE ironwood_tree_shards (
            shard_index INTEGER PRIMARY KEY,
            subtree_end_height INTEGER,
            root_hash BLOB,
            shard_data BLOB,
            contains_marked INTEGER,
            CONSTRAINT ironwood_shard_root_unique UNIQUE (root_hash)
        );
        CREATE TABLE ironwood_tree_cap (
            cap_id INTEGER PRIMARY KEY,
            cap_data BLOB NOT NULL
        );
        CREATE TABLE ironwood_tree_checkpoints (
            checkpoint_id INTEGER PRIMARY KEY,
            position INTEGER
        );
        CREATE TABLE ironwood_tree_checkpoint_marks_removed (
            checkpoint_id INTEGER NOT NULL,
            mark_removed_position INTEGER NOT NULL,
            PRIMARY KEY (checkpoint_id, mark_removed_position),
            FOREIGN KEY (checkpoint_id) REFERENCES ironwood_tree_checkpoints(checkpoint_id) ON DELETE CASCADE
        );
        INSERT INTO schema_migrations (version, applied_at) VALUES (1, unixepoch());
        INSERT INTO wallet_metadata (key, value) VALUES ('schema_version', '1');
        ",
    ).expect("v1 tables");
    tx.commit().expect("commit v1");

    // 2. Insert existing note and active reservation into v1 schema
    let nullifier = vec![0x77u8; 32];
    let txid = vec![0x88u8; 32];
    let dummy = vec![0x11u8; 32];

    conn.execute(
        "INSERT INTO received_notes (
            id, account_id, pool, txid, action_index, height, recipient, value_zatoshis,
            nullifier, rho, rseed, cmx, tree_position, scope
        ) VALUES (
            1, 'acct0', 'ironwood', ?1, 0, 5, 'ua_test_v1', 750000,
            ?2, ?3, ?3, ?3, 10, 'external'
        )",
        rusqlite::params![txid, nullifier, dummy],
    ).expect("insert v1 note");

    conn.execute(
        "INSERT INTO pending_spends (
            nullifier, note_id, txid, created_at, expiry_height, state, owner_pid, heartbeat_at
        ) VALUES (
            ?1, 1, ?2, 1000, 45, 'reserved', 9999, 1000
        )",
        rusqlite::params![nullifier, txid],
    ).expect("insert v1 reservation");

    println!("  Inserted v1 note (id=1) and active reservation (nullifier=0x77, note_id=1, state='reserved')");

    // 3. Run initialize_schema to perform in-place upgrade from v1 to v2
    println!("  Running initialize_schema(&mut conn) to trigger in-place v1 -> v2 migration...");
    zcash_core::initialize_schema(&mut conn).expect("run migration to v2");

    // 4. Assert schema_version is now bumped to 2
    let version_in_meta: String = conn.query_row(
        "SELECT value FROM wallet_metadata WHERE key = 'schema_version'",
        [],
        |r| r.get(0),
    ).expect("query schema_version");
    assert_eq!(version_in_meta, "2", "Schema metadata version must be bumped to 2");

    let max_mig_version: u32 = conn.query_row(
        "SELECT MAX(version) FROM schema_migrations",
        [],
        |r| r.get(0),
    ).expect("query schema_migrations");
    assert_eq!(max_mig_version, 2, "Latest applied schema migration must be 2");
    println!("  Confirmed database upgraded to schema_version 2 in-place");

    // 5. Assert reservation is preserved intact
    let (res_state, res_note_id, res_expiry): (String, Option<i64>, u32) = conn.query_row(
        "SELECT state, note_id, expiry_height FROM pending_spends WHERE nullifier = ?1",
        rusqlite::params![nullifier],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    ).expect("query preserved reservation");
    assert_eq!(res_state, "reserved");
    assert_eq!(res_note_id, Some(1));
    assert_eq!(res_expiry, 45);
    println!("  Existing reservation preserved: state='reserved', note_id=Some(1), expiry=45");

    // 6. Test ON DELETE SET NULL on nullable note_id (reorg note pruning)
    println!("  Deleting referenced note (id=1) from received_notes to test ON DELETE SET NULL...");
    conn.execute("DELETE FROM received_notes WHERE id = 1", []).expect("delete note");

    let (res_state_after, res_note_id_after): (String, Option<i64>) = conn.query_row(
        "SELECT state, note_id FROM pending_spends WHERE nullifier = ?1",
        rusqlite::params![nullifier],
        |r| Ok((r.get(0)?, r.get(1)?)),
    ).expect("query reservation after note delete");
    assert_eq!(res_state_after, "reserved", "State must remain reserved");
    assert_eq!(res_note_id_after, None, "note_id MUST be set to NULL via ON DELETE SET NULL");
    println!("  SUCCESS: note_id was set to NULL on delete, reservation remains active with nullifier intact!");
}
