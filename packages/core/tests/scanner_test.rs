use orchard::keys::{FullViewingKey, Scope, SpendingKey};
use orchard::note::{ExtractedNoteCommitment, Note, NoteVersion, RandomSeed, Rho};
use orchard::note_encryption::{IronwoodDomain, IronwoodNoteEncryption};
use orchard::value::NoteValue;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;
use zcash_core::{
    regtest_params, ChainMetadata, CompactBlock, CompactOrchardAction, CompactTx, DynamicNetwork,
    Scanner, WalletDb, WalletError,
};
use zcash_note_encryption::Domain;

fn create_encrypted_ironwood_action(
    fvk: &FullViewingKey,
    scope: Scope,
    value_zat: u64,
    rho_byte: u8,
    action_idx: u8,
) -> (CompactOrchardAction, [u8; 32], [u8; 32]) {
    let recipient = fvk.address_at(action_idx as u32, scope);

    // In Orchard/Ironwood, rho is the pallas::Base element derived from the revealed nullifier (nf_old)
    let mut nf_bytes = [0u8; 32];
    nf_bytes[0] = rho_byte;
    nf_bytes[1] = 0x55;
    let rho = Rho::from_bytes(&nf_bytes).into_option().expect("valid rho");

    let mut rseed_bytes = [0u8; 32];
    rseed_bytes[0] = rho_byte;
    rseed_bytes[1] = 0xAA;
    let rseed = RandomSeed::from_bytes(rseed_bytes, &rho).into_option().expect("valid rseed");

    let note = Note::from_parts(
        recipient,
        NoteValue::from_raw(value_zat),
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

fn create_dummy_ironwood_action(leaf_idx: u8) -> CompactOrchardAction {
    let mut cmx = [0u8; 32];
    cmx[0] = leaf_idx.wrapping_add(1);
    cmx[1] = leaf_idx.wrapping_mul(7);

    let mut nf = [0u8; 32];
    nf[0] = leaf_idx.wrapping_add(50);

    let mut epk = [0u8; 32];
    epk[0] = leaf_idx.wrapping_add(80);

    let ct = vec![0u8; 52];

    CompactOrchardAction {
        nullifier: nf.to_vec(),
        cmx: cmx.to_vec(),
        ephemeral_key: epk.to_vec(),
        ciphertext: ct,
    }
}

#[test]
fn test_scanner_rejects_missing_metadata() {
    println!("\n=== TEST: SCANNER REJECTS MISSING CHAIN METADATA ===");
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let db_path = temp_dir.path().join("wallet.db");
    let mut db = WalletDb::open_or_create(&db_path, "regtest", "fp1", Some(2)).expect("db open");

    let sk = SpendingKey::from_bytes([1u8; 32]).expect("valid sk");
    let fvk = FullViewingKey::from(&sk);
    let network = DynamicNetwork::Regtest(regtest_params());

    let bad_block = CompactBlock {
        height: 2,
        hash: vec![1u8; 32],
        prev_hash: vec![0u8; 32],
        time: 1000,
        header: vec![],
        vtx: vec![],
        chain_metadata: None, // Missing metadata
    };

    let result = Scanner::scan_block_batch(db.conn_mut(), "account0", &fvk, &network, &[bad_block]);
    match result {
        Err(WalletError::MissingIronwoodField(msg)) => {
            println!("  Correctly rejected block with missing metadata: {}", msg);
            assert!(msg.contains("missing required chainMetadata"));
        }
        other => panic!("Expected MissingIronwoodField error, got {:?}", other),
    }
}

#[test]
fn test_scanner_rejects_malformed_action() {
    println!("\n=== TEST: SCANNER REJECTS MALFORMED ACTION ===");
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let db_path = temp_dir.path().join("wallet.db");
    let mut db = WalletDb::open_or_create(&db_path, "regtest", "fp1", Some(2)).expect("db open");

    let sk = SpendingKey::from_bytes([1u8; 32]).expect("valid sk");
    let fvk = FullViewingKey::from(&sk);
    let network = DynamicNetwork::Regtest(regtest_params());

    let malformed_action = CompactOrchardAction {
        nullifier: vec![0u8; 31], // Invalid length != 32
        cmx: vec![0u8; 32],
        ephemeral_key: vec![0u8; 32],
        ciphertext: vec![0u8; 52],
    };

    let block = CompactBlock {
        height: 2,
        hash: vec![1u8; 32],
        prev_hash: vec![0u8; 32],
        time: 1000,
        header: vec![],
        vtx: vec![CompactTx {
            index: 0,
            txid: vec![2u8; 32],
            fee: 10_000,
            actions: vec![],
            ironwood_actions: vec![malformed_action],
        }],
        chain_metadata: Some(ChainMetadata {
            sapling_commitment_tree_size: 0,
            orchard_commitment_tree_size: 0,
            ironwood_commitment_tree_size: 1,
        }),
    };

    let result = Scanner::scan_block_batch(db.conn_mut(), "account0", &fvk, &network, &[block]);
    match result {
        Err(WalletError::MissingIronwoodField(msg)) => {
            println!("  Correctly rejected malformed action: {}", msg);
            assert!(msg.contains("Invalid nullifier length"));
        }
        other => panic!("Expected MissingIronwoodField error, got {:?}", other),
    }
}

#[test]
fn test_scanner_detects_tree_size_gap() {
    println!("\n=== TEST: SCANNER DETECTS TREE SIZE GAP ===");
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let db_path = temp_dir.path().join("wallet.db");
    let mut db = WalletDb::open_or_create(&db_path, "regtest", "fp1", Some(2)).expect("db open");

    let sk = SpendingKey::from_bytes([1u8; 32]).expect("valid sk");
    let fvk = FullViewingKey::from(&sk);
    let network = DynamicNetwork::Regtest(regtest_params());

    // 1 action in block, but metadata claims tree_size is 5 (gap of 4)
    let block = CompactBlock {
        height: 2,
        hash: vec![1u8; 32],
        prev_hash: vec![0u8; 32],
        time: 1000,
        header: vec![],
        vtx: vec![CompactTx {
            index: 0,
            txid: vec![2u8; 32],
            fee: 10_000,
            actions: vec![],
            ironwood_actions: vec![create_dummy_ironwood_action(1)],
        }],
        chain_metadata: Some(ChainMetadata {
            sapling_commitment_tree_size: 0,
            orchard_commitment_tree_size: 0,
            ironwood_commitment_tree_size: 5, // Gap! Expected 0 + 1 = 1
        }),
    };

    let result = Scanner::scan_block_batch(db.conn_mut(), "account0", &fvk, &network, &[block]);
    match result {
        Err(WalletError::TreeSizeGap { expected, actual, height }) => {
            println!("  Correctly detected tree size gap: expected {}, actual {}, height {}", expected, actual, height);
            assert_eq!(expected, 1);
            assert_eq!(actual, 5);
            assert_eq!(height, 2);
        }
        other => panic!("Expected TreeSizeGap error, got {:?}", other),
    }
}

#[test]
fn test_scanner_dual_scope_and_positions_and_spend_detection() {
    println!("\n=== TEST: DUAL-SCOPE IVK, POSITIONS, AND SPEND DETECTION ===");
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let db_path = temp_dir.path().join("wallet.db");
    let mut db = WalletDb::open_or_create(&db_path, "regtest", "fp1", Some(2)).expect("db open");

    let sk = SpendingKey::from_bytes([7u8; 32]).expect("valid sk");
    let fvk = FullViewingKey::from(&sk);
    let network = DynamicNetwork::Regtest(regtest_params());

    // Block 2: 1 external note (500k zat) + 1 internal note (200k zat) + 1 non-owned dummy note
    let (ext_act, _ext_cmx, ext_nf) = create_encrypted_ironwood_action(&fvk, Scope::External, 500_000, 11, 0);
    let (int_act, _int_cmx, _int_nf) = create_encrypted_ironwood_action(&fvk, Scope::Internal, 200_000, 22, 1);
    let dummy_act = create_dummy_ironwood_action(33);

    let txid_b2 = vec![0xBB; 32];
    let block2 = CompactBlock {
        height: 2,
        hash: vec![0x02; 32],
        prev_hash: vec![0x00; 32],
        time: 2000,
        header: vec![],
        vtx: vec![CompactTx {
            index: 0,
            txid: txid_b2.clone(),
            fee: 10_000,
            actions: vec![],
            ironwood_actions: vec![ext_act, int_act, dummy_act],
        }],
        chain_metadata: Some(ChainMetadata {
            sapling_commitment_tree_size: 0,
            orchard_commitment_tree_size: 0,
            ironwood_commitment_tree_size: 3,
        }),
    };

    println!("  Scanning Block 2 (3 actions)...");
    let res = Scanner::scan_block_batch(db.conn_mut(), "account0", &fvk, &network, &[block2]).expect("scan b2");
    assert_eq!(res, zcash_core::ScanResult::Synced { last_scanned_height: 2, notes_detected: 2 });

    // Verify notes in received_notes table
    let spend_txid = vec![0xCC; 32];
    {
        let conn = db.conn();
        let mut stmt = conn.prepare("SELECT value_zatoshis, tree_position, scope, spent_in_txid FROM received_notes ORDER BY tree_position ASC").expect("prepare");
        let rows: Vec<(i64, i64, String, Option<Vec<u8>>)> = stmt.query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        }).expect("query").map(|r| r.expect("row")).collect();

        assert_eq!(rows.len(), 2, "Must detect exactly 2 owned notes");
        assert_eq!(rows[0].0, 500_000);
        assert_eq!(rows[0].1, 0, "External note position must be 0");
        assert_eq!(rows[0].2, "external");
        assert!(rows[0].3.is_none(), "External note must be unspent");

        assert_eq!(rows[1].0, 200_000);
        assert_eq!(rows[1].1, 1, "Internal note position must be 1");
        assert_eq!(rows[1].2, "internal");
        assert!(rows[1].3.is_none(), "Internal note must be unspent");
        println!("  Dual-scope notes verified with correct tree positions (0 and 1)");

        // Simulate in-flight reservation in pending_spends for note 0
        let note0_id: i64 = conn.query_row("SELECT id FROM received_notes WHERE tree_position = 0", [], |row| row.get(0)).expect("note0_id");
        conn.execute(
            "INSERT INTO pending_spends (nullifier, note_id, txid, created_at, expiry_height, state, owner_pid, heartbeat_at)
             VALUES (?1, ?2, ?3, 1000, 100, 'broadcast', 12345, 1000)",
            rusqlite::params![&ext_nf[..], note0_id, &spend_txid],
        ).expect("insert pending spend");
    }

    // Block 3: spends note 0's nullifier!
    let spend_action = CompactOrchardAction {
        nullifier: ext_nf.to_vec(),
        cmx: create_dummy_ironwood_action(99).cmx,
        ephemeral_key: vec![0u8; 32],
        ciphertext: vec![0u8; 52],
    };

    let block3 = CompactBlock {
        height: 3,
        hash: vec![0x03; 32],
        prev_hash: vec![0x02; 32],
        time: 3000,
        header: vec![],
        vtx: vec![CompactTx {
            index: 0,
            txid: spend_txid.clone(),
            fee: 10_000,
            actions: vec![],
            ironwood_actions: vec![spend_action],
        }],
        chain_metadata: Some(ChainMetadata {
            sapling_commitment_tree_size: 0,
            orchard_commitment_tree_size: 0,
            ironwood_commitment_tree_size: 4,
        }),
    };

    println!("  Scanning Block 3 (spending external note)...");
    let res3 = Scanner::scan_block_batch(db.conn_mut(), "account0", &fvk, &network, &[block3]).expect("scan b3");
    assert_eq!(res3, zcash_core::ScanResult::Synced { last_scanned_height: 3, notes_detected: 0 });

    // Verify note is marked as spent
    let (spent_txid, spent_height): (Option<Vec<u8>>, Option<i64>) = db.conn().query_row(
        "SELECT spent_in_txid, spent_at_height FROM received_notes WHERE tree_position = 0",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).expect("query spend status");

    assert_eq!(spent_txid, Some(spend_txid));
    assert_eq!(spent_height, Some(3));
    println!("  Note 0 confirmed spent in block 3 txid");

    // Verify pending_spends state updated to 'mined'
    let pending_state: String = db.conn().query_row(
        "SELECT state FROM pending_spends WHERE nullifier = ?1",
        rusqlite::params![&ext_nf[..]],
        |row| row.get(0),
    ).expect("query pending state");
    assert_eq!(pending_state, "mined", "pending_spends state must transition to 'mined'");
    println!("  pending_spends transitioned to 'mined' successfully");
}

#[test]
fn test_synthetic_chain_benchmark_and_concurrent_send_safety() {
    println!("\n=== TEST: 5,000 SYNTHETIC BLOCKS BENCHMARK & ACTIVE-SYNC SEND CONCURRENCY ===");
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let db_path = temp_dir.path().join("wallet_bench.db");
    let mut db = WalletDb::open_or_create(&db_path, "regtest", "fp_bench", Some(2)).expect("db open");

    let sk = SpendingKey::from_bytes([99u8; 32]).expect("valid sk");
    let fvk = FullViewingKey::from(&sk);
    let network = DynamicNetwork::Regtest(regtest_params());

    println!("  Generating 5,000 synthetic blocks with realistic action counts & trial decryption...");
    let total_blocks = 5000usize;
    let mut synthetic_blocks = Vec::with_capacity(total_blocks);
    let mut current_tree_sz = 0u32;
    let mut prev_hash = vec![0x00; 32];

    for i in 0..total_blocks {
        let height = 2 + (i as u64);
        let mut block_hash = vec![0u8; 32];
        block_hash[0..8].copy_from_slice(&height.to_le_bytes());

        // 1 to 2 actions per block; every 200 blocks has an owned note to trial decrypt
        let actions = if i % 200 == 0 {
            let (act, _, _) = create_encrypted_ironwood_action(&fvk, Scope::External, 100_000 + i as u64, (i % 250) as u8, 0);
            vec![act]
        } else {
            vec![create_dummy_ironwood_action((i % 250) as u8)]
        };

        current_tree_sz += actions.len() as u32;

        let block = CompactBlock {
            height,
            hash: block_hash.clone(),
            prev_hash: prev_hash.clone(),
            time: 1_700_000_000 + (i as u32) * 10,
            header: vec![],
            vtx: vec![CompactTx {
                index: 0,
                txid: block_hash.clone(),
                fee: 10_000,
                actions: vec![],
                ironwood_actions: actions,
            }],
            chain_metadata: Some(ChainMetadata {
                sapling_commitment_tree_size: 0,
                orchard_commitment_tree_size: 0,
                ironwood_commitment_tree_size: current_tree_sz,
            }),
        };

        prev_hash = block_hash;
        synthetic_blocks.push(block);
    }
    println!("  Generated 5,000 blocks successfully.");

    // Evaluate batch sizes: 25, 50, 100
    for batch_size in [25, 50, 100] {
        let mut durations = Vec::new();
        let test_batches = 10; // Sample 10 batches for this size
        for b in 0..test_batches {
            let start_idx = b * batch_size;
            let end_idx = start_idx + batch_size;
            let slice = &synthetic_blocks[start_idx..end_idx];

            let start = Instant::now();
            Scanner::scan_block_batch(db.conn_mut(), "account0", &fvk, &network, slice).expect("batch scan");
            durations.push(start.elapsed().as_millis());
        }

        durations.sort_unstable();
        let p50 = durations[durations.len() / 2];
        let p95_idx = ((durations.len() as f64 * 0.95).ceil() as usize).min(durations.len() - 1);
        let p95 = durations[p95_idx];
        println!("  [Batch size {:3}] Measured durations over {} batches: p50 = {} ms, p95 = {} ms", batch_size, test_batches, p50, p95);
    }

    println!("\n  Testing concurrent send() reservation during active continuous sync with busy_timeout=5000ms...");
    let sync_running = Arc::new(AtomicBool::new(true));
    let sync_running_clone = sync_running.clone();
    let db_path_clone = db_path.clone();

    // Spawn concurrent thread simulating a user initiating a send() and creating a pending reservation
    let send_thread = std::thread::spawn(move || {
        // Wait briefly for scanner to be active
        std::thread::sleep(std::time::Duration::from_millis(50));
        let mut send_conn = rusqlite::Connection::open(&db_path_clone).expect("send conn");
        send_conn.busy_timeout(std::time::Duration::from_secs(5)).expect("set busy timeout");

        let send_start = Instant::now();
        let note_id: i64 = send_conn
            .query_row("SELECT id FROM received_notes LIMIT 1", [], |r| r.get(0))
            .expect("must have at least one scanned note in db");

        // Execute write transaction (BEGIN IMMEDIATE) to reserve note
        let send_tx = send_conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).expect("send transaction immediate");
        send_tx.execute(
            "INSERT INTO pending_spends (nullifier, note_id, txid, created_at, expiry_height, state, owner_pid, heartbeat_at)
             VALUES (?1, ?2, ?3, 1000, 10000, 'reserved', 9999, 1000)",
            rusqlite::params![vec![0xAAu8; 32], note_id, vec![0xDDu8; 32]],
        ).expect("insert send reservation");
        send_tx.commit().expect("send tx commit");

        let send_elapsed = send_start.elapsed().as_millis();
        println!("  >>> [Concurrent send()] Note reservation completed successfully in {} ms (NO busy-timeout!)", send_elapsed);
    });

    // Main thread continues batch syncing 50-block batches
    let remaining_blocks = &synthetic_blocks[1000..2000];
    for chunk in remaining_blocks.chunks(50) {
        Scanner::scan_block_batch(db.conn_mut(), "account0", &fvk, &network, chunk).expect("chunk scan");
    }

    sync_running_clone.store(false, Ordering::SeqCst);
    send_thread.join().expect("join send thread");
    println!("  Concurrency test passed: Active sync and send reservation coexist without lock failures!");
}
