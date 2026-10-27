// POSIX permission bits only exist on Unix; the mode assertions below are gated the same way.
#[cfg(unix)]
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
fn test_consensus_branch_id_derivation() {
    use zcash_core::consensus::BranchId;
    use zcash_core::get_consensus_branch_id_for_height;

    // Verify crate BranchId enum variants
    assert_eq!(u32::from(BranchId::Nu6_3), 0x37a5_165b, "NU6.3 branch ID must equal 0x37a5165b");
    assert_eq!(u32::from(BranchId::Nu7), 0x7719_0ad9, "NU7 branch ID must equal 0x77190ad9");

    // Testnet pre-NU7 (NU6.3): height 4,465,025 -> 0x37a5165b
    let testnet_pre_nu7 = get_consensus_branch_id_for_height("testnet", 4_465_025).expect("branch");
    assert_eq!(testnet_pre_nu7, 0x37a5_165b, "Testnet 4,465,025 must derive Nu6_3 (0x37a5165b)");

    // Testnet post-NU7: height 4,465,026 -> 0x77190ad9
    let testnet_nu7 = get_consensus_branch_id_for_height("testnet", 4_465_026).expect("branch");
    assert_eq!(testnet_nu7, 0x7719_0ad9, "Testnet 4,465,026 must derive Nu7 (0x77190ad9)");

    // Mainnet pre-NU7 (NU6.3): height 3,428,143 -> 0x37a5165b
    let mainnet_nu6_3 = get_consensus_branch_id_for_height("mainnet", 3_428_143).expect("branch");
    assert_eq!(mainnet_nu6_3, 0x37a5_165b, "Mainnet 3,428,143 must derive Nu6_3 (0x37a5165b)");

    // Mainnet post-NU7: height 3,543,405 -> 0x77190ad9
    let mainnet_nu7 = get_consensus_branch_id_for_height("mainnet", 3_543_405).expect("branch");
    assert_eq!(mainnet_nu7, 0x7719_0ad9, "Mainnet 3,543,405 must derive Nu7 (0x77190ad9)");

    // Regtest at height 2 -> 0x37a5165b (NU6.3 default)
    let regtest_branch = get_consensus_branch_id_for_height("regtest", 2).expect("branch");
    assert_eq!(regtest_branch, 0x37a5_165b, "Regtest default at height 2 must derive Nu6_3 (0x37a5165b)");

    // Regtest opt-in at height 2 -> 0x77190ad9 (NU7)
    let regtest_nu7_branch = get_consensus_branch_id_for_height("regtest-nu7", 2).expect("branch");
    assert_eq!(regtest_nu7_branch, 0x7719_0ad9, "Regtest opt-in at height 2 must derive Nu7 (0x77190ad9)");
}

#[test]
fn test_address_equivalence_in_code() {
    use zcash_address::unified::{Address, Container, Encoding, Receiver};

    // Account A's full Unified Address (multi-receiver: Sapling + Orchard/Ironwood)
    let account_a_ua = "utest1ltxnvpwqcpfxzcu8z9xwvqrgdmwc4rmwwuvycyegqmtf45dreewn3mwl07nrspyfq5lvlm560lqys7h4420ecpealvry0hdvk73r0n9jjz67299hyrrz02hjf28tdlskkf3uwzwjptr335wkk66y9vwwsv6x5d29y6ap839yhtnpesa0qet8wmn03k95n0pxl3uwve3wu4jawsqywxk";
    // Note's decrypted Unified Address (single-receiver: Orchard/Ironwood)
    let note_ua = "utest1l4hez2arqx8xdvpl5nt334ak9ehu5k3yej9qprax9raak2ek50h3vg54f02mkl3le62gj2t4qsthqp583w2esx7zhc47hz7zsq0tfsx6";

    let (_net1, _rev1, parsed_acct_a) = Address::decode(account_a_ua).expect("valid account A UA");
    let (_net2, _rev2, parsed_note) = Address::decode(note_ua).expect("valid note UA");

    let mut acct_a_orchard_receiver: Option<[u8; 43]> = None;
    for r in parsed_acct_a.items() {
        if let Receiver::Orchard(bytes) = r {
            acct_a_orchard_receiver = Some(bytes);
        }
    }

    let mut note_orchard_receiver: Option<[u8; 43]> = None;
    for r in parsed_note.items() {
        if let Receiver::Orchard(bytes) = r {
            note_orchard_receiver = Some(bytes);
        }
    }

    assert!(acct_a_orchard_receiver.is_some(), "Account A must have an Orchard/Ironwood receiver");
    assert!(note_orchard_receiver.is_some(), "Note UA must have an Orchard/Ironwood receiver");

    let acct_bytes = acct_a_orchard_receiver.unwrap();
    let note_bytes = note_orchard_receiver.unwrap();

    println!("\n=== TEST: ADDRESS EQUIVALENCE IN CODE ===");
    println!("Account A Orchard Receiver: {}", hex::encode(acct_bytes));
    println!("Note UA Orchard Receiver:   {}", hex::encode(note_bytes));

    assert_eq!(
        acct_bytes,
        note_bytes,
        "Account A Orchard/Ironwood receiver bytes must exactly match note Orchard/Ironwood receiver bytes"
    );
}



#[test]
fn test_schema_initialization_and_permissions() {
    println!("\n=== TEST: SCHEMA INITIALIZATION & PERMISSIONS ENFORCEMENT ===");
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let db_path = temp_dir.path().join("wallet_sub").join("wallet.db");

    let db = WalletDb::open_or_create(&db_path, "regtest", "ufvk_fp_12345", Some(2))
        .expect("open_or_create");

    // Check parent directory permissions (0700) and database file permissions (0600).
    // Windows has no POSIX mode bits, so these two assertions are Unix-only by construction;
    // the schema and metadata assertions below run on every platform.
    #[cfg(unix)]
    {
        let parent = db_path.parent().expect("parent dir");
        let parent_mode = std::fs::metadata(parent).expect("metadata").permissions().mode() & 0o777;
        println!("  Parent directory mode: 0o{:o} (expected 0o700)", parent_mode);
        assert_eq!(parent_mode, 0o700, "Directory permissions must be 0700");

        let file_mode = std::fs::metadata(&db_path).expect("metadata").permissions().mode() & 0o777;
        println!("  Database file mode:    0o{:o} (expected 0o600)", file_mode);
        assert_eq!(file_mode, 0o600, "Database file permissions must be 0600");
    }

    // Check metadata keys
    assert_eq!(
        db.get_metadata(metadata_keys::SCHEMA_VERSION).expect("meta"),
        Some("3".to_string())
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
        "wallet_transactions",
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
    zcash_core::initialize_schema(&mut conn).expect("run migration to latest schema");

    // 4. Assert schema_version is now bumped to 3 (latest CURRENT_SCHEMA_VERSION)
    let version_in_meta: String = conn.query_row(
        "SELECT value FROM wallet_metadata WHERE key = 'schema_version'",
        [],
        |r| r.get(0),
    ).expect("query schema_version");
    assert_eq!(version_in_meta, "3", "Schema metadata version must be bumped to 3");

    let max_mig_version: u32 = conn.query_row(
        "SELECT MAX(version) FROM schema_migrations",
        [],
        |r| r.get(0),
    ).expect("query schema_migrations");
    assert_eq!(max_mig_version, 3, "Latest applied schema migration must be 3");
    println!("  Confirmed database upgraded to schema_version 3 in-place");

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

    // 7. Assert via sqlite_master that idx_pending_spends_txid and idx_pending_spends_state exist after migration
    let txid_idx_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_pending_spends_txid'",
        [],
        |r| r.get(0),
    ).expect("query idx_pending_spends_txid");
    assert_eq!(txid_idx_count, 1, "idx_pending_spends_txid must exist after v2 migration");

    let state_idx_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_pending_spends_state'",
        [],
        |r| r.get(0),
    ).expect("query idx_pending_spends_state");
    assert_eq!(state_idx_count, 1, "idx_pending_spends_state must exist after v2 migration");
    println!("  SUCCESS: Verified idx_pending_spends_txid and idx_pending_spends_state exist in sqlite_master after v2 migration!");
}

#[test]
fn test_schema_v2_to_v3_migration_in_place() {
    println!("\n=== TEST: IN-PLACE SCHEMA MIGRATION V2 -> V3 (WALLET_TRANSACTIONS) ===");
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let db_path = temp_dir.path().join("wallet_v2_to_v3.db");

    // 1. Manually create a genuine v2 schema database
    let mut conn = rusqlite::Connection::open(&db_path).expect("open raw sqlite");
    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;").expect("pragmas");

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
        CREATE TABLE pending_spends (
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
        CREATE INDEX idx_pending_spends_txid ON pending_spends(txid);
        CREATE INDEX idx_pending_spends_state ON pending_spends(state);
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
        INSERT INTO schema_migrations (version, applied_at) VALUES (2, unixepoch());
        INSERT INTO wallet_metadata (key, value) VALUES ('schema_version', '2');
        ",
    ).expect("v2 tables");
    tx.commit().expect("commit v2");

    // 2. Insert existing v2 notes and pending reservations to verify backward compatibility
    let nullifier = vec![0x33u8; 32];
    let txid = vec![0x44u8; 32];
    let dummy = vec![0x55u8; 32];

    conn.execute(
        "INSERT INTO received_notes (
            id, account_id, pool, txid, action_index, height, recipient, value_zatoshis,
            nullifier, rho, rseed, cmx, tree_position, scope
        ) VALUES (
            1, 'acct0', 'ironwood', ?1, 0, 10, 'ua_test_v2', 1000000,
            ?2, ?3, ?3, ?3, 5, 'external'
        )",
        rusqlite::params![txid, nullifier, dummy],
    ).expect("insert v2 note");

    conn.execute(
        "INSERT INTO pending_spends (
            nullifier, note_id, txid, created_at, expiry_height, state, owner_pid, heartbeat_at
        ) VALUES (
            ?1, 1, ?2, 2000, 50, 'reserved', 1234, 2000
        )",
        rusqlite::params![nullifier, txid],
    ).expect("insert v2 reservation");

    // Verify initial v2 state
    let v2_meta: String = conn.query_row(
        "SELECT value FROM wallet_metadata WHERE key = 'schema_version'",
        [],
        |r| r.get(0),
    ).expect("query v2 version");
    assert_eq!(v2_meta, "2");

    // 3. Run initialize_schema to perform in-place upgrade from v2 to v3
    println!("  Running initialize_schema(&mut conn) to trigger in-place v2 -> v3 migration...");
    zcash_core::initialize_schema(&mut conn).expect("run migration to v3");

    // 4. Assert schema_version is now bumped to 3
    let v3_meta: String = conn.query_row(
        "SELECT value FROM wallet_metadata WHERE key = 'schema_version'",
        [],
        |r| r.get(0),
    ).expect("query schema_version");
    assert_eq!(v3_meta, "3", "Schema metadata version must be bumped to 3");

    let max_mig_version: u32 = conn.query_row(
        "SELECT MAX(version) FROM schema_migrations",
        [],
        |r| r.get(0),
    ).expect("query schema_migrations");
    assert_eq!(max_mig_version, 3, "Latest applied schema migration must be 3");

    // 5. Assert v2 existing data was preserved completely
    let (note_val, note_scope): (i64, String) = conn.query_row(
        "SELECT value_zatoshis, scope FROM received_notes WHERE id = 1",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    ).expect("query note");
    assert_eq!(note_val, 1000000);
    assert_eq!(note_scope, "external");

    let (spend_state, spend_expiry): (String, u32) = conn.query_row(
        "SELECT state, expiry_height FROM pending_spends WHERE nullifier = ?1",
        rusqlite::params![nullifier],
        |r| Ok((r.get(0)?, r.get(1)?)),
    ).expect("query spend");
    assert_eq!(spend_state, "reserved");
    assert_eq!(spend_expiry, 50);

    // 6. Test wallet_transactions table operations: insert and query
    conn.execute(
        "INSERT INTO wallet_transactions (
            txid, height, direction, value, fee, memo, counterparty, pool, created_at
        ) VALUES (
            'txid_out_123', 100, 'out', 1000000, 10000, 'Payment for services', 'uregtest1recipient', 'ironwood', 1700000000
        )",
        [],
    ).expect("insert outgoing wallet_transaction");

    conn.execute(
        "INSERT INTO wallet_transactions (
            txid, height, direction, value, fee, memo, counterparty, pool, created_at
        ) VALUES (
            'txid_in_456', 101, 'in', 500000, 0, NULL, NULL, 'ironwood', 1700000010
        )",
        [],
    ).expect("insert incoming wallet_transaction");

    conn.execute(
        "INSERT INTO wallet_transactions (
            txid, height, direction, value, fee, memo, counterparty, pool, created_at
        ) VALUES (
            'txid_out_123', 100, 'internal', 390000, 10000, NULL, NULL, 'ironwood', 1700000000
        )",
        [],
    ).expect("insert internal change wallet_transaction");

    let tx_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM wallet_transactions",
        [],
        |r| r.get(0),
    ).expect("count txs");
    assert_eq!(tx_count, 3, "Must have exactly 3 transaction rows");

    // Verify row retrieval
    let (txid_q, dir_q, val_q, fee_q, memo_q, cparty_q): (String, String, i64, i64, Option<String>, Option<String>) = conn.query_row(
        "SELECT txid, direction, value, fee, memo, counterparty FROM wallet_transactions WHERE direction = 'out'",
        [],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
    ).expect("query out tx");
    assert_eq!(txid_q, "txid_out_123");
    assert_eq!(dir_q, "out");
    assert_eq!(val_q, 1000000);
    assert_eq!(fee_q, 10000);
    assert_eq!(memo_q, Some("Payment for services".to_string()));
    assert_eq!(cparty_q, Some("uregtest1recipient".to_string()));

    // 7. Verify CHECK constraints on direction and pool
    let bad_dir = conn.execute(
        "INSERT INTO wallet_transactions (
            txid, height, direction, value, fee, memo, counterparty, pool, created_at
        ) VALUES ('bad_tx', 100, 'sideways', 100, 10, NULL, NULL, 'ironwood', 1000)",
        [],
    );
    assert!(bad_dir.is_err(), "Invalid direction must be rejected by CHECK constraint");

    let bad_pool = conn.execute(
        "INSERT INTO wallet_transactions (
            txid, height, direction, value, fee, memo, counterparty, pool, created_at
        ) VALUES ('bad_tx', 100, 'in', 100, 10, NULL, NULL, 'orchard', 1000)",
        [],
    );
    assert!(bad_pool.is_err(), "Invalid pool must be rejected by CHECK constraint");

    // 8. Verify indexes exist
    for idx in ["idx_wallet_transactions_txid", "idx_wallet_transactions_height", "idx_wallet_transactions_direction"] {
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = ?1",
            rusqlite::params![idx],
            |r| r.get(0),
        ).expect("check index");
        assert_eq!(count, 1, "Index '{}' must exist after v3 migration", idx);
        println!("  Index verified: {}", idx);
    }

    println!("  SUCCESS: In-place migration v2 -> v3 preserves existing v2 data and initializes wallet_transactions table!");
}

