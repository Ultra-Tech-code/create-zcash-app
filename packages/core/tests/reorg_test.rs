use orchard::keys::{FullViewingKey, Scope, SpendingKey};
use orchard::note::{ExtractedNoteCommitment, Note, NoteVersion, RandomSeed, Rho};
use orchard::note_encryption::{IronwoodDomain, IronwoodNoteEncryption};
use orchard::value::NoteValue;
use rusqlite::OptionalExtension;
use zcash_core::{
    regtest_params, ChainMetadata, CompactBlock, CompactOrchardAction, CompactTx, DynamicNetwork,
    ScanResult, Scanner, WalletDb, WalletError,
};
use zcash_note_encryption::Domain;

fn create_encrypted_action(
    fvk: &FullViewingKey,
    scope: Scope,
    value: u64,
    seed: u8,
) -> (CompactOrchardAction, [u8; 32], [u8; 32]) {
    let recipient = fvk.address_at(seed as u32, scope);

    let mut nf_bytes = [0u8; 32];
    nf_bytes[0] = seed;
    nf_bytes[1] = 0x77;
    let rho = Rho::from_bytes(&nf_bytes).into_option().expect("valid rho");

    let mut rseed_bytes = [0u8; 32];
    rseed_bytes[0] = seed;
    rseed_bytes[1] = 0x88;
    let rseed = RandomSeed::from_bytes(rseed_bytes, &rho).into_option().expect("valid rseed");

    let note = Note::from_parts(
        recipient,
        NoteValue::from_raw(value),
        rho,
        rseed,
        NoteVersion::V3,
    )
    .expect("valid note");

    let memo = [0u8; 512];
    let encryptor = IronwoodNoteEncryption::new(Some(fvk.to_ovk(scope)), note, memo);
    let epk_bytes = IronwoodDomain::epk_bytes(encryptor.epk()).0;
    let enc_ciphertext = encryptor.encrypt_note_plaintext();

    let cmx = ExtractedNoteCommitment::from(note.commitment()).to_bytes();
    let nullifier = note.nullifier(fvk).to_bytes();

    let action = CompactOrchardAction {
        nullifier: nf_bytes.to_vec(),
        cmx: cmx.to_vec(),
        ephemeral_key: epk_bytes.to_vec(),
        ciphertext: enc_ciphertext[..52].to_vec(),
    };

    (action, cmx, nullifier)
}

#[test]
fn test_chain_identity_reset_error() {
    println!("\n=== TEST: CHAIN IDENTITY RESET DETECTION ===");
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let db_path = temp_dir.path().join("wallet_reset.db");
    let mut db = WalletDb::open_or_create(&db_path, "regtest", "fp_reset", Some(2)).expect("db open");

    let sk = SpendingKey::from_bytes([1u8; 32]).expect("valid sk");
    let fvk = FullViewingKey::from(&sk);
    let network = DynamicNetwork::Regtest(regtest_params());

    // First scan of Block 2 with Hash A
    let block2_a = CompactBlock {
        height: 2,
        hash: vec![0x0A; 32],
        prev_hash: vec![0x00; 32],
        time: 1000,
        header: vec![],
        vtx: vec![],
        chain_metadata: Some(ChainMetadata {
            sapling_commitment_tree_size: 0,
            orchard_commitment_tree_size: 0,
            ironwood_commitment_tree_size: 0,
        }),
    };
    Scanner::scan_block_batch(db.conn_mut(), "acct0", &fvk, &network, &[block2_a]).expect("scan first");

    // Close and reopen db simulating daemon restart
    drop(db);
    let mut db_reopened = WalletDb::open_or_create(&db_path, "regtest", "fp_reset", Some(2)).expect("reopen");

    // Clear scanned_blocks to simulate a fresh rescan from activation, but wallet_metadata has first_scanned_hash
    db_reopened.conn_mut().execute("DELETE FROM scanned_blocks", []).expect("clear scanned");

    // Node now presents Block 2 with different Hash B (different genesis/chain reset)
    let block2_b = CompactBlock {
        height: 2,
        hash: vec![0x0B; 32], // Hash mismatch!
        prev_hash: vec![0x00; 32],
        time: 1000,
        header: vec![],
        vtx: vec![],
        chain_metadata: Some(ChainMetadata {
            sapling_commitment_tree_size: 0,
            orchard_commitment_tree_size: 0,
            ironwood_commitment_tree_size: 0,
        }),
    };

    let res = Scanner::scan_block_batch(db_reopened.conn_mut(), "acct0", &fvk, &network, &[block2_b]);
    match res {
        Err(WalletError::ChainReset { expected, actual, height }) => {
            println!("  Correctly detected ChainReset error: expected {}, actual {}, height {}", expected, actual, height);
            assert_eq!(expected, hex::encode(vec![0x0A; 32]));
            assert_eq!(actual, hex::encode(vec![0x0B; 32]));
            assert_eq!(height, 2);
        }
        other => panic!("Expected ChainReset error, got {:?}", other),
    }
}

#[test]
fn test_reorg_detection_and_resolution_walkback() {
    println!("\n=== TEST: REORG DETECTION AND RESOLUTION WALKBACK ===");
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let db_path = temp_dir.path().join("wallet_reorg.db");
    let mut db = WalletDb::open_or_create(&db_path, "regtest", "fp_reorg", Some(2)).expect("db open");

    let sk = SpendingKey::from_bytes([2u8; 32]).expect("valid sk");
    let fvk = FullViewingKey::from(&sk);
    let network = DynamicNetwork::Regtest(regtest_params());

    // 1. Block 2: receive Note 1 (height 2)
    let (act1, _, nf1) = create_encrypted_action(&fvk, Scope::External, 1_000_000, 10);
    let hash_b2 = vec![0x02; 32];
    let block2 = CompactBlock {
        height: 2,
        hash: hash_b2.clone(),
        prev_hash: vec![0x00; 32],
        time: 2000,
        header: vec![],
        vtx: vec![CompactTx {
            index: 0,
            txid: vec![0x22; 32],
            fee: 10_000,
            actions: vec![],
            ironwood_actions: vec![act1],
        }],
        chain_metadata: Some(ChainMetadata {
            sapling_commitment_tree_size: 0,
            orchard_commitment_tree_size: 0,
            ironwood_commitment_tree_size: 1,
        }),
    };
    Scanner::scan_block_batch(db.conn_mut(), "acct0", &fvk, &network, &[block2]).expect("scan b2");

    // 2. Block 3 (Fork A): receive Note 2 (height 3) and spend Note 1
    let (act2, _, nf2) = create_encrypted_action(&fvk, Scope::Internal, 400_000, 20);
    let mut dummy_cmx = [0u8; 32];
    dummy_cmx[0] = 42;
    let spend_act = CompactOrchardAction {
        nullifier: nf1.to_vec(),
        cmx: dummy_cmx.to_vec(),
        ephemeral_key: vec![0u8; 32],
        ciphertext: vec![0u8; 52],
    };
    let hash_b3_fork_a = vec![0x3A; 32];
    let txid_spend_b3 = vec![0x33; 32];
    let block3_fork_a = CompactBlock {
        height: 3,
        hash: hash_b3_fork_a.clone(),
        prev_hash: hash_b2.clone(),
        time: 3000,
        header: vec![],
        vtx: vec![CompactTx {
            index: 0,
            txid: txid_spend_b3.clone(),
            fee: 10_000,
            actions: vec![],
            ironwood_actions: vec![act2, spend_act],
        }],
        chain_metadata: Some(ChainMetadata {
            sapling_commitment_tree_size: 0,
            orchard_commitment_tree_size: 0,
            ironwood_commitment_tree_size: 3,
        }),
    };

    // Note 1 had an in-flight spend reservation that was confirmed in b3
    let note1_id: i64 = db.conn().query_row("SELECT id FROM received_notes WHERE height = 2", [], |r| r.get(0)).expect("note1_id");
    db.conn().execute(
        "INSERT INTO pending_spends (nullifier, note_id, txid, created_at, expiry_height, state, owner_pid, heartbeat_at)
         VALUES (?1, ?2, ?3, 2000, 100, 'reserved', 1234, 2000)",
        rusqlite::params![&nf1[..], note1_id, &txid_spend_b3],
    ).expect("insert spend note 1");

    Scanner::scan_block_batch(db.conn_mut(), "acct0", &fvk, &network, &[block3_fork_a]).expect("scan b3 fork a");

    // Verify state at end of Fork A:
    // Note 1 is confirmed spent
    let note1_spent: Option<Vec<u8>> = db.conn().query_row("SELECT spent_in_txid FROM received_notes WHERE id = ?1", [note1_id], |r| r.get(0)).expect("note1 spent");
    assert_eq!(note1_spent, Some(txid_spend_b3.clone()));

    // Note 2 exists at height 3
    let note2_id: i64 = db.conn().query_row("SELECT id FROM received_notes WHERE height = 3", [], |r| r.get(0)).expect("note2_id");

    // Add in-flight reservation for Note 2 as well
    db.conn().execute(
        "INSERT INTO pending_spends (nullifier, note_id, txid, created_at, expiry_height, state, owner_pid, heartbeat_at)
         VALUES (?1, ?2, ?3, 3000, 100, 'reserved', 1234, 3000)",
        rusqlite::params![&nf2[..], note2_id, vec![0x55u8; 32]],
    ).expect("insert spend note 2");

    println!("  State before reorg: Note 1 spent at height 3, Note 2 received at height 3");

    // 3. Reorg occurs: Node serves Block 4 from Fork B whose prev_hash is hash_b3_fork_b (not Fork A!)
    let hash_b3_fork_b = vec![0x3B; 32];
    let block4_fork_b = CompactBlock {
        height: 4,
        hash: vec![0x4B; 32],
        prev_hash: hash_b3_fork_b.clone(), // Fork!
        time: 4000,
        header: vec![],
        vtx: vec![],
        chain_metadata: Some(ChainMetadata {
            sapling_commitment_tree_size: 0,
            orchard_commitment_tree_size: 0,
            ironwood_commitment_tree_size: 2,
        }),
    };

    let scan_res = Scanner::scan_block_batch(db.conn_mut(), "acct0", &fvk, &network, &[block4_fork_b]).expect("scan detect reorg");
    match scan_res {
        ScanResult::NeedAncestorHashes { from_height, count } => {
            println!("  Scanner correctly triggered NeedAncestorHashes: from_height {}, count {}", from_height, count);
            assert_eq!(from_height, 3);
            assert_eq!(count, 10);
        }
        other => panic!("Expected NeedAncestorHashes, got {:?}", other),
    }

    // 4. Resolve reorg: Node supplies hashes walking back: [hash_b3_fork_b, hash_b2]
    let ancestor_hashes = vec![
        [0x3Bu8; 32], // height 3 on new chain (different from our 0x3A)
        [0x02u8; 32], // height 2 on both chains (common ancestor!)
    ];

    println!("  Resolving reorg back to common ancestor...");
    let fork_h = Scanner::resolve_reorg(db.conn_mut(), 3, &ancestor_hashes).expect("resolve reorg");
    assert_eq!(fork_h, 2, "Common ancestor must be height 2");
    println!("  Reorg successfully resolved to fork height {}", fork_h);

    // 5. Assertions on post-reorg state:
    // a) Note 2 (mined on orphan chain at height 3) was deleted
    let note2_count: i64 = db.conn().query_row("SELECT COUNT(*) FROM received_notes WHERE height = 3", [], |r| r.get(0)).expect("count note 2");
    assert_eq!(note2_count, 0, "Note 2 mined on orphaned chain must be deleted");

    // b) Note 2's pending_spends row was CASCADE deleted
    let pending_note2_count: i64 = db.conn().query_row("SELECT COUNT(*) FROM pending_spends WHERE nullifier = ?1", rusqlite::params![&nf2[..]], |r| r.get(0)).expect("count pending 2");
    assert_eq!(pending_note2_count, 0, "Pending spend for orphaned note 2 must be cascade deleted");

    // c) Note 1's spend was rolled back (spent_in_txid and spent_at_height are reset to NULL)
    let (note1_spent_after, note1_height_after): (Option<Vec<u8>>, Option<i64>) = db.conn().query_row(
        "SELECT spent_in_txid, spent_at_height FROM received_notes WHERE id = ?1",
        [note1_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    ).expect("query note 1 after reorg");
    assert!(note1_spent_after.is_none(), "Note 1 spend must be rolled back to unspent");
    assert!(note1_height_after.is_none(), "Note 1 spent_at_height must be NULL");
    println!("  Note 1 confirmed rolled back to unspent status");

    // d) Note 1's pending spend reverted from 'mined' back to 'broadcast'
    let pending1_state: String = db.conn().query_row(
        "SELECT state FROM pending_spends WHERE nullifier = ?1",
        rusqlite::params![&nf1[..]],
        |r| r.get(0),
    ).expect("query pending 1");
    assert_eq!(pending1_state, "broadcast", "Pending spend for valid note must revert to 'broadcast'");
    println!("  Pending spend for Note 1 reverted to 'broadcast' as expected");

    // e) scanned_blocks for height 3 was deleted; tip is height 2
    let tip_h: u32 = db.conn().query_row("SELECT height FROM scanned_blocks ORDER BY height DESC LIMIT 1", [], |r| r.get(0)).expect("tip");
    assert_eq!(tip_h, 2, "Tip of scanned_blocks must be height 2 after reorg");
}

#[test]
fn test_reorg_preserves_in_flight_reservation_on_valid_note() {
    println!("\n=== TEST: REORG CANNOT SILENTLY DROP IN-FLIGHT RESERVATION ===");
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let db_path = temp_dir.path().join("wallet_reservation_safety.db");
    let mut db = WalletDb::open_or_create(&db_path, "regtest", "fp_safe", Some(2)).expect("db open");

    let sk = SpendingKey::from_bytes([3u8; 32]).expect("valid sk");
    let fvk = FullViewingKey::from(&sk);
    let network = DynamicNetwork::Regtest(regtest_params());

    // 1. Scan Block 2: receive Note 1
    let (act1, _, nf1) = create_encrypted_action(&fvk, Scope::External, 500_000, 50);
    let block2 = CompactBlock {
        height: 2,
        hash: vec![0x02; 32],
        prev_hash: vec![0x00; 32],
        time: 2000,
        header: vec![],
        vtx: vec![CompactTx {
            index: 0,
            txid: vec![0x22; 32],
            fee: 10_000,
            actions: vec![],
            ironwood_actions: vec![act1],
        }],
        chain_metadata: Some(ChainMetadata {
            sapling_commitment_tree_size: 0,
            orchard_commitment_tree_size: 0,
            ironwood_commitment_tree_size: 1,
        }),
    };
    Scanner::scan_block_batch(db.conn_mut(), "acct0", &fvk, &network, &[block2]).expect("scan b2");

    // 2. Scan Block 3 (no note changes)
    let block3 = CompactBlock {
        height: 3,
        hash: vec![0x03; 32],
        prev_hash: vec![0x02; 32],
        time: 3000,
        header: vec![],
        vtx: vec![],
        chain_metadata: Some(ChainMetadata {
            sapling_commitment_tree_size: 0,
            orchard_commitment_tree_size: 0,
            ironwood_commitment_tree_size: 1,
        }),
    };
    Scanner::scan_block_batch(db.conn_mut(), "acct0", &fvk, &network, &[block3]).expect("scan b3");

    // 3. User places an in-flight reservation on Note 1 (state 'reserved')
    let note1_id: i64 = db.conn().query_row("SELECT id FROM received_notes WHERE height = 2", [], |r| r.get(0)).expect("note1_id");
    db.conn().execute(
        "INSERT INTO pending_spends (nullifier, note_id, txid, created_at, expiry_height, state, owner_pid, heartbeat_at)
         VALUES (?1, ?2, ?3, 3000, 100, 'reserved', 7777, 3000)",
        rusqlite::params![&nf1[..], note1_id, vec![0x77u8; 32]],
    ).expect("reserve note 1");

    // 4. A 1-block reorg occurs at height 3, rewinding to height 2
    let ancestor_hashes = vec![
        [0x99u8; 32], // height 3 orphan
        [0x02u8; 32], // height 2 common ancestor
    ];
    let fork_h = Scanner::resolve_reorg(db.conn_mut(), 3, &ancestor_hashes).expect("resolve reorg");
    assert_eq!(fork_h, 2);

    // 5. Verify: Note 1's in-flight reservation ('reserved') was NOT dropped!
    let reservation: Option<(String, i64)> = db.conn().query_row(
        "SELECT state, owner_pid FROM pending_spends WHERE nullifier = ?1",
        rusqlite::params![&nf1[..]],
        |r| Ok((r.get(0)?, r.get(1)?)),
    ).optional().expect("query reservation");

    assert!(reservation.is_some(), "In-flight reservation must NOT be dropped by reorg above note height");
    let (state, pid) = reservation.expect("reservation exists");
    assert_eq!(state, "reserved");
    assert_eq!(pid, 7777);
    println!("  In-flight reservation on valid note preserved with intact 'reserved' state and PID 7777!");
}
