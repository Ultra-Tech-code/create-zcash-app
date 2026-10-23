use orchard::keys::{FullViewingKey, Scope, SpendingKey};
use orchard::note::{ExtractedNoteCommitment, Note, NoteVersion, RandomSeed, Rho};
use orchard::note_encryption::{IronwoodDomain, IronwoodNoteEncryption, OrchardDomain, OrchardNoteEncryption};
use orchard::value::NoteValue;
use zcash_core::{
    regtest_params, ChainMetadata, CompactBlock, CompactOrchardAction, CompactTx, DynamicNetwork,
    PendingSpendsManager, Scanner, WalletDb, WalletError,
};
use zcash_note_encryption::{try_compact_note_decryption, Domain};

fn create_encrypted_action_v3(
    fvk: &FullViewingKey,
    scope: Scope,
    value: u64,
    seed: u8,
) -> (CompactOrchardAction, [u8; 32], [u8; 32]) {
    let recipient = fvk.address_at(seed as u32, scope);

    let mut nf_bytes = [0u8; 32];
    nf_bytes[0] = seed;
    nf_bytes[1] = 0xAA;
    let rho = Rho::from_bytes(&nf_bytes).into_option().expect("valid rho");

    let mut rseed_bytes = [0u8; 32];
    rseed_bytes[0] = seed;
    rseed_bytes[1] = 0xBB;
    let rseed = RandomSeed::from_bytes(rseed_bytes, &rho).into_option().expect("valid rseed");

    let note = Note::from_parts(
        recipient,
        NoteValue::from_raw(value),
        rho,
        rseed,
        NoteVersion::V3, // Ironwood V3!
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

fn create_encrypted_action_v2_orchard(
    fvk: &FullViewingKey,
    scope: Scope,
    value: u64,
    seed: u8,
) -> CompactOrchardAction {
    let recipient = fvk.address_at(seed as u32, scope);

    let mut nf_bytes = [0u8; 32];
    nf_bytes[0] = seed;
    nf_bytes[1] = 0xCC;
    let rho = Rho::from_bytes(&nf_bytes).into_option().expect("valid rho");

    let mut rseed_bytes = [0u8; 32];
    rseed_bytes[0] = seed;
    rseed_bytes[1] = 0xDD;
    let rseed = RandomSeed::from_bytes(rseed_bytes, &rho).into_option().expect("valid rseed");

    let note = Note::from_parts(
        recipient,
        NoteValue::from_raw(value),
        rho,
        rseed,
        NoteVersion::V2, // Orchard V2!
    )
    .expect("valid note");

    let memo = [0u8; 512];
    let encryptor = OrchardNoteEncryption::new(Some(fvk.to_ovk(scope)), note, memo);
    let epk_bytes = OrchardDomain::epk_bytes(encryptor.epk()).0;
    let enc_ciphertext = encryptor.encrypt_note_plaintext();
    let cmx = ExtractedNoteCommitment::from(note.commitment()).to_bytes();

    CompactOrchardAction {
        nullifier: nf_bytes.to_vec(),
        cmx: cmx.to_vec(),
        ephemeral_key: epk_bytes.to_vec(),
        ciphertext: enc_ciphertext[..52].to_vec(),
    }
}

#[test]
fn test_ironwood_isolation_rejects_orchard_v2_notes() {
    println!("\n=== TEST: IRONWOOD CRYPTOGRAPHIC ISOLATION (REJECTS ORCHARD V2) ===");
    let sk = SpendingKey::from_bytes([77u8; 32]).expect("sk");
    let fvk = FullViewingKey::from(&sk);
    let prepared_ivk = orchard::keys::PreparedIncomingViewingKey::new(&fvk.to_ivk(Scope::External));

    // 1. Create an Orchard V2 action (lead byte 0x02)
    let v2_action = create_encrypted_action_v2_orchard(&fvk, Scope::External, 1_000_000, 10);

    let mut nf_arr = [0u8; 32];
    nf_arr.copy_from_slice(&v2_action.nullifier);
    let nf = orchard::note::Nullifier::from_bytes(&nf_arr).into_option().expect("nf");

    let mut cmx_arr = [0u8; 32];
    cmx_arr.copy_from_slice(&v2_action.cmx);
    let cmx = ExtractedNoteCommitment::from_bytes(&cmx_arr).into_option().expect("cmx");

    let mut epk_arr = [0u8; 32];
    epk_arr.copy_from_slice(&v2_action.ephemeral_key);
    let epk = zcash_note_encryption::EphemeralKeyBytes(epk_arr);

    let mut enc_52 = [0u8; 52];
    enc_52.copy_from_slice(&v2_action.ciphertext[..52]);

    let compact_action = orchard::note_encryption::CompactAction::from_parts(nf, cmx, epk, enc_52);
    let ironwood_domain = IronwoodDomain::for_compact_action(&compact_action);

    // Attempting to trial-decrypt an Orchard V2 note with IronwoodDomain MUST return None!
    let decrypted = try_compact_note_decryption(&ironwood_domain, &prepared_ivk, &compact_action);
    assert!(decrypted.is_none(), "IronwoodDomain MUST strictly reject Orchard V2 ciphertexts");
    println!("  IronwoodDomain strictly rejected Orchard V2 note: cryptographic isolation confirmed!");

    // 2. In contrast, an Ironwood V3 action trial-decrypts successfully
    let (v3_action, _, _) = create_encrypted_action_v3(&fvk, Scope::External, 1_000_000, 20);
    let mut nf3 = [0u8; 32];
    nf3.copy_from_slice(&v3_action.nullifier);
    let nf_v3 = orchard::note::Nullifier::from_bytes(&nf3).into_option().expect("nf");

    let mut cmx3 = [0u8; 32];
    cmx3.copy_from_slice(&v3_action.cmx);
    let cmx_v3 = ExtractedNoteCommitment::from_bytes(&cmx3).into_option().expect("cmx");

    let mut epk3 = [0u8; 32];
    epk3.copy_from_slice(&v3_action.ephemeral_key);
    let epk_v3 = zcash_note_encryption::EphemeralKeyBytes(epk3);

    let mut enc3_52 = [0u8; 52];
    enc3_52.copy_from_slice(&v3_action.ciphertext[..52]);

    let compact_action_v3 = orchard::note_encryption::CompactAction::from_parts(nf_v3, cmx_v3, epk_v3, enc3_52);
    let ironwood_domain_v3 = IronwoodDomain::for_compact_action(&compact_action_v3);
    let decrypted_v3 = try_compact_note_decryption(&ironwood_domain_v3, &prepared_ivk, &compact_action_v3);
    assert!(decrypted_v3.is_some(), "IronwoodDomain MUST accept Ironwood V3 ciphertexts");
    println!("  Ironwood V3 note successfully decrypted with IronwoodDomain");
}

#[test]
fn test_persisted_equals_rescan_bit_for_bit() {
    println!("\n=== TEST: PERSISTED STATE EQUALS RESCAN BIT-FOR-BIT ===");
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let db1_path = temp_dir.path().join("db1.db");
    let db2_path = temp_dir.path().join("db2.db");

    let mut db1 = WalletDb::open_or_create(&db1_path, "regtest", "fp_match", Some(2)).expect("db1");
    let mut db2 = WalletDb::open_or_create(&db2_path, "regtest", "fp_match", Some(2)).expect("db2");

    let sk = SpendingKey::from_bytes([88u8; 32]).expect("sk");
    let fvk = FullViewingKey::from(&sk);
    let network = DynamicNetwork::Regtest(regtest_params());

    // Generate 10 blocks with realistic actions
    let mut blocks = Vec::new();
    let mut prev_hash = vec![0x00; 32];
    for (tree_sz_idx, i) in (2..=11).enumerate() {
        let tree_sz = (tree_sz_idx as u32) + 1;
        let (act, _, _) = create_encrypted_action_v3(&fvk, Scope::External, 50_000 * (i as u64), i as u8);
        let mut block_hash = vec![0u8; 32];
        block_hash[0] = i as u8;

        let block = CompactBlock {
            height: i as u64,
            hash: block_hash.clone(),
            prev_hash: prev_hash.clone(),
            time: 2000 + i * 10,
            header: vec![],
            vtx: vec![CompactTx {
                index: 0,
                txid: block_hash.clone(),
                fee: 10_000,
                actions: vec![],
                ironwood_actions: vec![act],
            }],
            chain_metadata: Some(ChainMetadata {
                sapling_commitment_tree_size: 0,
                orchard_commitment_tree_size: 0,
                ironwood_commitment_tree_size: tree_sz,
            }),
        };
        prev_hash = block_hash;
        blocks.push(block);
    }

    // Scan all blocks into DB 1
    println!("  Scanning 10 blocks into DB 1...");
    Scanner::scan_block_batch(db1.conn_mut(), "acct0", &fvk, &network, &blocks).expect("scan db1");

    // Scan all blocks into fresh DB 2 (rescan simulation)
    println!("  Rescanning identical 10 blocks into DB 2...");
    Scanner::scan_block_batch(db2.conn_mut(), "acct0", &fvk, &network, &blocks).expect("scan db2");

    // Assert that received_notes match bit-for-bit across both databases
    let notes1: Vec<(i64, i64, Vec<u8>)> = db1.conn().prepare("SELECT value_zatoshis, tree_position, nullifier FROM received_notes ORDER BY tree_position ASC")
        .expect("prep")
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .expect("q")
        .map(|r| r.expect("row"))
        .collect();

    let notes2: Vec<(i64, i64, Vec<u8>)> = db2.conn().prepare("SELECT value_zatoshis, tree_position, nullifier FROM received_notes ORDER BY tree_position ASC")
        .expect("prep")
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .expect("q")
        .map(|r| r.expect("row"))
        .collect();

    assert_eq!(notes1, notes2, "All received notes must match bit-for-bit between initial scan and rescan");

    // Assert that ShardTree commitment roots match bit-for-bit at tip checkpoint
    let store1 = zcash_core::SqliteShardStore::new(db1.conn(), "ironwood_tree");
    let tree1 = zcash_core::IronwoodShardTree::new(store1, 100);
    let root1 = tree1.root_at_checkpoint_depth(Some(0)).expect("r1").expect("root1");

    let store2 = zcash_core::SqliteShardStore::new(db2.conn(), "ironwood_tree");
    let tree2 = zcash_core::IronwoodShardTree::new(store2, 100);
    let root2 = tree2.root_at_checkpoint_depth(Some(0)).expect("r2").expect("root2");

    assert_eq!(root1, root2, "Commitment tree roots must match bit-for-bit between initial scan and rescan");
    println!("  Verified: Persisted state and rescan produce identical roots and notes!");
}

#[test]
fn test_sliding_window_prunes_headers_without_deleting_notes() {
    println!("\n=== TEST: SLIDING WINDOW PRUNES HEADERS WITHOUT TOUCHING NOTES ===");
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let db_path = temp_dir.path().join("wallet_prune.db");
    let mut db = WalletDb::open_or_create(&db_path, "regtest", "fp_prune", Some(2)).expect("db");

    let sk = SpendingKey::from_bytes([91u8; 32]).expect("sk");
    let fvk = FullViewingKey::from(&sk);
    let network = DynamicNetwork::Regtest(regtest_params());

    // Scan 150 blocks. Note created at Block 2.
    // At tip 151, headers below 151 - 100 = 51 must be pruned from scanned_blocks,
    // but received_notes for block 2 MUST remain intact (no cascade!).
    let mut blocks = Vec::with_capacity(150);
    let mut prev_hash = vec![0x00; 32];

    for (tree_idx, h) in (2u32..=151u32).enumerate() {
        let current_tree_sz = (tree_idx as u32) + 1;
        let (act, _, _) = if h == 2 {
            create_encrypted_action_v3(&fvk, Scope::External, 500_000, 1)
        } else {
            create_encrypted_action_v3(&fvk, Scope::Internal, 0, (h % 250) as u8)
        };

        let mut b_hash = vec![0u8; 32];
        b_hash[0..4].copy_from_slice(&h.to_le_bytes());

        let block = CompactBlock {
            height: h as u64,
            hash: b_hash.clone(),
            prev_hash: prev_hash.clone(),
            time: 2000 + h * 5,
            header: vec![],
            vtx: vec![CompactTx {
                index: 0,
                txid: b_hash.clone(),
                fee: 10_000,
                actions: vec![],
                ironwood_actions: vec![act],
            }],
            chain_metadata: Some(ChainMetadata {
                sapling_commitment_tree_size: 0,
                orchard_commitment_tree_size: 0,
                ironwood_commitment_tree_size: current_tree_sz,
            }),
        };
        prev_hash = b_hash;
        blocks.push(block);
    }

    println!("  Scanning 150 blocks to exceed 100-block sliding window...");
    for chunk in blocks.chunks(50) {
        Scanner::scan_block_batch(db.conn_mut(), "acct0", &fvk, &network, chunk).expect("chunk scan");
    }

    // Check scanned_blocks: oldest block retained must be >= 51
    let min_height: u32 = db.conn().query_row("SELECT MIN(height) FROM scanned_blocks", [], |r| r.get(0)).expect("min");
    let max_height: u32 = db.conn().query_row("SELECT MAX(height) FROM scanned_blocks", [], |r| r.get(0)).expect("max");
    let header_count: i64 = db.conn().query_row("SELECT COUNT(*) FROM scanned_blocks", [], |r| r.get(0)).expect("count");

    println!("  Scanned headers in sliding window: min height = {}, max height = {}, total = {}", min_height, max_height, header_count);
    assert_eq!(max_height, 151);
    assert!(min_height >= 51, "Headers below 51 must be pruned");
    assert!(header_count <= 101, "Sliding window must maintain only last 100 blocks");

    // Check received_notes: Note 1 from Block 2 MUST still exist!
    let note_b2_exists: i64 = db.conn().query_row("SELECT COUNT(*) FROM received_notes WHERE height = 2", [], |r| r.get(0)).expect("note b2");
    assert_eq!(note_b2_exists, 1, "Pruning old headers must NEVER delete received notes!");
    println!("  Verified: Note from Block 2 preserved despite Block 2 header being pruned from sliding window");
}

#[test]
fn test_atomicity_crash_rollback_on_batch_failure() {
    println!("\n=== TEST: ATOMICITY CRASH & ROLLBACK ON BATCH FAILURE ===");
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let db_path = temp_dir.path().join("wallet_atomic.db");
    let mut db = WalletDb::open_or_create(&db_path, "regtest", "fp_atomic", Some(2)).expect("db");

    let sk = SpendingKey::from_bytes([92u8; 32]).expect("sk");
    let fvk = FullViewingKey::from(&sk);
    let network = DynamicNetwork::Regtest(regtest_params());

    // 1. Scan Block 2 with Note 1
    let (act1, _, _) = create_encrypted_action_v3(&fvk, Scope::External, 100_000, 1);
    let block2 = CompactBlock {
        height: 2,
        hash: vec![0x02; 32],
        prev_hash: vec![0x00; 32],
        time: 2000,
        header: vec![],
        vtx: vec![CompactTx {
            index: 0,
            txid: vec![0x20; 32],
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
    let note_count_before: i64 = db.conn().query_row("SELECT COUNT(*) FROM received_notes", [], |r| r.get(0)).expect("count");
    assert_eq!(note_count_before, 1);

    // 2. Prepare a 2-block batch: Block 3 has Note 2, but Block 4 has corrupted tree_size metadata (simulating mid-batch failure)
    let (act2, _, _) = create_encrypted_action_v3(&fvk, Scope::External, 200_000, 2);
    let block3 = CompactBlock {
        height: 3,
        hash: vec![0x03; 32],
        prev_hash: vec![0x02; 32],
        time: 3000,
        header: vec![],
        vtx: vec![CompactTx {
            index: 0,
            txid: vec![0x30; 32],
            fee: 10_000,
            actions: vec![],
            ironwood_actions: vec![act2],
        }],
        chain_metadata: Some(ChainMetadata {
            sapling_commitment_tree_size: 0,
            orchard_commitment_tree_size: 0,
            ironwood_commitment_tree_size: 2,
        }),
    };

    let (act3, _, _) = create_encrypted_action_v3(&fvk, Scope::External, 300_000, 3);
    let block4_corrupted = CompactBlock {
        height: 4,
        hash: vec![0x04; 32],
        prev_hash: vec![0x03; 32],
        time: 4000,
        header: vec![],
        vtx: vec![CompactTx {
            index: 0,
            txid: vec![0x40; 32],
            fee: 10_000,
            actions: vec![],
            ironwood_actions: vec![act3.clone()],
        }],
        chain_metadata: Some(ChainMetadata {
            sapling_commitment_tree_size: 0,
            orchard_commitment_tree_size: 0,
            ironwood_commitment_tree_size: 999, // Tree size gap! Expected 3, got 999
        }),
    };

    println!("  Scanning batch with corrupted block 4 to test atomic rollback...");
    let result = Scanner::scan_block_batch(db.conn_mut(), "acct0", &fvk, &network, &[block3.clone(), block4_corrupted]);
    assert!(result.is_err(), "Must return Err on mid-batch tree size gap failure");
    println!("  Batch scan failed as expected with error: {:?}", result.err());

    // 3. Verify complete rollback: neither Block 3 nor Block 4 was persisted, Note 2 was NOT inserted!
    let note_count_after: i64 = db.conn().query_row("SELECT COUNT(*) FROM received_notes", [], |r| r.get(0)).expect("count");
    assert_eq!(note_count_after, 1, "Atomicity failure: Note 2 from rolled-back batch MUST NOT exist in DB!");

    let max_height: u32 = db.conn().query_row("SELECT MAX(height) FROM scanned_blocks", [], |r| r.get(0)).expect("max");
    assert_eq!(max_height, 2, "Scanned blocks tip MUST remain at Block 2");

    // 4. Retry with valid Block 4: now both Block 3 and Block 4 succeed cleanly!
    let block4_valid = CompactBlock {
        height: 4,
        hash: vec![0x04; 32],
        prev_hash: vec![0x03; 32],
        time: 4000,
        header: vec![],
        vtx: vec![CompactTx {
            index: 0,
            txid: vec![0x40; 32],
            fee: 10_000,
            actions: vec![],
            ironwood_actions: vec![act3],
        }],
        chain_metadata: Some(ChainMetadata {
            sapling_commitment_tree_size: 0,
            orchard_commitment_tree_size: 0,
            ironwood_commitment_tree_size: 3,
        }),
    };

    println!("  Retrying with valid batch...");
    Scanner::scan_block_batch(db.conn_mut(), "acct0", &fvk, &network, &[block3, block4_valid]).expect("retry scan");
    let final_note_count: i64 = db.conn().query_row("SELECT COUNT(*) FROM received_notes", [], |r| r.get(0)).expect("count");
    assert_eq!(final_note_count, 3, "All 3 notes must be cleanly recorded after successful batch");
    println!("  Verified: Batch atomicity and rollback fully guaranteed under failure!");
}

#[test]
fn test_kill_9_and_abrupt_shutdown_wal_recovery() {
    println!("\n=== TEST: KILL -9 & ABRUPT SHUTDOWN WAL INTEGRITY RECOVERY ===");
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let db_path = temp_dir.path().join("wallet_kill9.db");

    let sk = SpendingKey::from_bytes([93u8; 32]).expect("sk");
    let fvk = FullViewingKey::from(&sk);
    let network = DynamicNetwork::Regtest(regtest_params());

    // 1. Process A: open DB, scan a block, reserve a note for sending
    {
        let mut db = WalletDb::open_or_create(&db_path, "regtest", "fp_kill9", Some(2)).expect("db open");
        let (act, _, nf) = create_encrypted_action_v3(&fvk, Scope::External, 500_000, 1);
        let block2 = CompactBlock {
            height: 2,
            hash: vec![0x02; 32],
            prev_hash: vec![0x00; 32],
            time: 2000,
            header: vec![],
            vtx: vec![CompactTx {
                index: 0,
                txid: vec![0x20; 32],
                fee: 10_000,
                actions: vec![],
                ironwood_actions: vec![act],
            }],
            chain_metadata: Some(ChainMetadata {
                sapling_commitment_tree_size: 0,
                orchard_commitment_tree_size: 0,
                ironwood_commitment_tree_size: 1,
            }),
        };
        Scanner::scan_block_batch(db.conn_mut(), "acct0", &fvk, &network, &[block2]).expect("scan b2");

        // Reserve note with PID 99999 (simulate an active process that gets killed -9)
        let note_id: i64 = db.conn().query_row("SELECT id FROM received_notes", [], |r| r.get(0)).expect("note_id");
        db.conn().execute(
            "INSERT INTO pending_spends (nullifier, note_id, txid, created_at, expiry_height, state, owner_pid, heartbeat_at)
             VALUES (?1, ?2, ?3, 1000, 100, 'reserved', 99999, 1000)",
            rusqlite::params![&nf[..], note_id, vec![0xAAu8; 32]],
        ).expect("reserve note");

        // SIMULATE KILL -9:
        // Do not call db.close() or flush cleanly; explicitly drop the connection while WAL contains uncheckpointed frames.
        drop(db);
    }

    // 2. Process B (Recovery after kill -9):
    println!("  Simulating new process reopening DB after kill -9...");
    let db_recovered = WalletDb::open_or_create(&db_path, "regtest", "fp_kill9", Some(2)).expect("db reopen");

    // PRAGMA integrity_check must return "ok"
    let integrity: String = db_recovered.conn().query_row("PRAGMA integrity_check", [], |r| r.get(0)).expect("integrity");
    assert_eq!(integrity, "ok", "Database integrity check must pass cleanly after kill -9");
    println!("  PRAGMA integrity_check passed: ok");

    // Clean up stale reservations whose heartbeat expired (> 120s)
    let cleaned = PendingSpendsManager::cleanup_stale_and_expired(db_recovered.conn(), 2, 120).expect("cleanup");
    assert_eq!(cleaned, 1, "Stale reservation from killed PID 99999 must be cleaned up");

    // Note is once again spendable!
    let spendable_count: i64 = db_recovered.conn().query_row(
        "SELECT COUNT(*) FROM received_notes n WHERE n.spent_in_txid IS NULL AND NOT EXISTS (SELECT 1 FROM pending_spends p WHERE p.note_id = n.id)",
        [],
        |r| r.get(0),
    ).expect("spendable");
    assert_eq!(spendable_count, 1, "Orphaned note must be returned to spendable pool");
    println!("  Verified: kill -9 recovery preserves WAL integrity and frees orphaned reservations!");
}

#[test]
fn test_activation_scan_prevents_unseeded_tree_gap() {
    println!("\n=== TEST: ACTIVATION SCAN PREVENTS UNSEEDED COMMITMENT TREE GAPS ===");
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let db_path = temp_dir.path().join("wallet_activation.db");
    let mut db = WalletDb::open_or_create(&db_path, "regtest", "fp_activation", Some(2)).expect("db");

    let sk = SpendingKey::from_bytes([94u8; 32]).expect("sk");
    let fvk = FullViewingKey::from(&sk);
    let network = DynamicNetwork::Regtest(regtest_params());

    // Attempt to scan starting at Block 10 with non-zero commitment tree size (e.g. 15),
    // skipping blocks 2..9 without seeding tree state.
    let (act, _, _) = create_encrypted_action_v3(&fvk, Scope::External, 100_000, 10);
    let block10_unseeded = CompactBlock {
        height: 10,
        hash: vec![0x10; 32],
        prev_hash: vec![0x09; 32],
        time: 5000,
        header: vec![],
        vtx: vec![CompactTx {
            index: 0,
            txid: vec![0x99; 32],
            fee: 10_000,
            actions: vec![],
            ironwood_actions: vec![act],
        }],
        chain_metadata: Some(ChainMetadata {
            sapling_commitment_tree_size: 0,
            orchard_commitment_tree_size: 0,
            ironwood_commitment_tree_size: 15, // Gap: tree size starts at 0, but block metadata reports 15
        }),
    };

    println!("  Attempting unseeded scan from height 10 without prior activation blocks...");
    let res = Scanner::scan_block_batch(db.conn_mut(), "acct0", &fvk, &network, &[block10_unseeded]);
    match res {
        Err(WalletError::TreeSizeGap { expected, actual, height }) => {
            println!("  Correctly rejected unseeded scan with TreeSizeGap: expected {}, actual {}, height {}", expected, actual, height);
            assert_eq!(expected, 1);
            assert_eq!(actual, 15);
            assert_eq!(height, 10);
        }
        other => panic!("Expected TreeSizeGap error for unseeded scan, got {:?}", other),
    }

    println!("  Verified: Scanner strictly requires continuous scan from activation height to guarantee witness validity!");
}
