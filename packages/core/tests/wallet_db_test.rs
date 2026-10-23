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
        Some("1".to_string())
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
