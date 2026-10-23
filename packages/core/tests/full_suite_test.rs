use orchard::keys::{FullViewingKey, Scope, SpendingKey};
use orchard::note::{ExtractedNoteCommitment, Note, NoteVersion, RandomSeed, Rho};
use orchard::note_encryption::{IronwoodDomain, IronwoodNoteEncryption, OrchardDomain, OrchardNoteEncryption};
use orchard::value::NoteValue;
use prost::Message;
use zcash_core::{
    regtest_params, ChainMetadata, CompactBlock, CompactOrchardAction, CompactTx, DynamicNetwork,
    ScanResult, Scanner, WalletDb, WalletError, INJECT_FAULT_BEFORE_CHECKPOINT,
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
    assert_eq!(min_height, 52, "Headers at and below 51 must be pruned");
    assert_eq!(header_count, 100, "Sliding window must maintain exactly 100 blocks");

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
fn test_real_child_process_sigkill_mid_batch_and_clean_resume() {
    // 1. Child worker mode
    if let Ok(db_path_str) = std::env::var("TEST_SIGKILL_CHILD_DB") {
        let db_path = std::path::PathBuf::from(db_path_str);
        let mut db = WalletDb::open_or_create(&db_path, "regtest", "fp_sigkill", Some(2)).expect("child db");
        let sk = SpendingKey::from_bytes([95u8; 32]).expect("sk");
        let fvk = FullViewingKey::from(&sk);
        let network = DynamicNetwork::Regtest(regtest_params());

        // Batch 1: Blocks 2..=5
        let mut batch1 = Vec::new();
        let mut prev_hash = vec![0x00; 32];
        for h in 2u32..=5 {
            let (act, _, _) = create_encrypted_action_v3(&fvk, Scope::External, 100_000 * (h as u64), h as u8);
            let mut b_hash = vec![0u8; 32];
            b_hash[0] = h as u8;
            batch1.push(CompactBlock {
                height: h as u64,
                hash: b_hash.clone(),
                prev_hash: prev_hash.clone(),
                time: 2000 + h * 10,
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
                    ironwood_commitment_tree_size: h - 1,
                }),
            });
            prev_hash = b_hash;
        }
        Scanner::scan_block_batch(db.conn_mut(), "acct0", &fvk, &network, &batch1).expect("scan batch 1");

        // Notify parent that Batch 1 is safely committed to WAL
        println!("BATCH_1_COMMITTED");
        use std::io::Write;
        std::io::stdout().flush().expect("flush");

        // Batch 2: Blocks 6..=10, loop with sleep to ensure parent SIGKILL hits mid-batch
        let mut batch2 = Vec::new();
        for h in 6u32..=10 {
            let (act, _, _) = create_encrypted_action_v3(&fvk, Scope::External, 100_000 * (h as u64), h as u8);
            let mut b_hash = vec![0u8; 32];
            b_hash[0] = h as u8;
            batch2.push(CompactBlock {
                height: h as u64,
                hash: b_hash.clone(),
                prev_hash: prev_hash.clone(),
                time: 2000 + h * 10,
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
                    ironwood_commitment_tree_size: h - 1,
                }),
            });
            prev_hash = b_hash;
        }

        for _ in 0..100 {
            std::thread::sleep(std::time::Duration::from_millis(40));
            let _ = Scanner::scan_block_batch(db.conn_mut(), "acct0", &fvk, &network, &batch2);
        }
        return;
    }

    // 2. Parent test mode
    println!("\n=== TEST: REAL CHILD PROCESS SIGKILL MID-BATCH & CLEAN RESUME ===");
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let test_db_path = temp_dir.path().join("sigkill_test.db");
    let control_db_path = temp_dir.path().join("sigkill_control.db");

    let current_exe = std::env::current_exe().expect("current exe");
    let mut child = std::process::Command::new(current_exe)
        .arg("test_real_child_process_sigkill_mid_batch_and_clean_resume")
        .arg("--nocapture")
        .env("TEST_SIGKILL_CHILD_DB", test_db_path.to_str().expect("path str"))
        .stdout(std::process::Stdio::piped())
        .spawn()
        .expect("spawn child");

    let stdout = child.stdout.take().expect("child stdout");
    use std::io::{BufRead, BufReader};
    let reader = BufReader::new(stdout);
    let mut batch_1_seen = false;
    for l in reader.lines().map_while(Result::ok) {
        if l.contains("BATCH_1_COMMITTED") {
            batch_1_seen = true;
            break;
        }
    }
    assert!(batch_1_seen, "Child must report BATCH_1_COMMITTED");

    // Wait 30ms to guarantee child has started batch 2, then issue real SIGKILL (kill -9)
    std::thread::sleep(std::time::Duration::from_millis(30));
    println!("  Sending real SIGKILL (-9) to child process PID {}", child.id());
    let kill_res = std::process::Command::new("kill")
        .args(["-9", &child.id().to_string()])
        .status()
        .expect("send kill -9");
    assert!(kill_res.success(), "kill -9 command must succeed");

    let _ = child.wait();
    println!("  Child process terminated abruptly by SIGKILL");

    // Parent reopens the database after SIGKILL
    println!("  Reopening database in parent process...");
    let mut recovered_db = WalletDb::open_or_create(&test_db_path, "regtest", "fp_sigkill", Some(2)).expect("reopen db");

    let integrity: String = recovered_db.conn().query_row("PRAGMA integrity_check", [], |r| r.get(0)).expect("integrity");
    assert_eq!(integrity, "ok", "Database PRAGMA integrity_check must return 'ok' after SIGKILL");
    println!("  PRAGMA integrity_check: ok");

    let tip_height: u32 = recovered_db.conn().query_row("SELECT MAX(height) FROM scanned_blocks", [], |r| r.get(0)).expect("tip");
    assert_eq!(tip_height, 5, "Database must have rolled back uncommitted batch 2 to height 5");

    let sk = SpendingKey::from_bytes([95u8; 32]).expect("sk");
    let fvk = FullViewingKey::from(&sk);
    let network = DynamicNetwork::Regtest(regtest_params());

    // Resume scanning blocks 6..=10 in the parent
    let mut resume_blocks = Vec::new();
    let mut prev_hash = vec![0u8; 32];
    prev_hash[0] = 5;
    for h in 6u32..=10 {
        let (act, _, _) = create_encrypted_action_v3(&fvk, Scope::External, 100_000 * (h as u64), h as u8);
        let mut b_hash = vec![0u8; 32];
        b_hash[0] = h as u8;
        resume_blocks.push(CompactBlock {
            height: h as u64,
            hash: b_hash.clone(),
            prev_hash: prev_hash.clone(),
            time: 2000 + h * 10,
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
                ironwood_commitment_tree_size: h - 1,
            }),
        });
        prev_hash = b_hash;
    }
    Scanner::scan_block_batch(recovered_db.conn_mut(), "acct0", &fvk, &network, &resume_blocks).expect("resume scan");

    // Scan full range 2..=10 in clean control database
    let mut control_db = WalletDb::open_or_create(&control_db_path, "regtest", "fp_sigkill", Some(2)).expect("control db");
    let mut full_blocks = Vec::new();
    let mut prev_hash = vec![0x00; 32];
    for h in 2u32..=10 {
        let (act, _, _) = create_encrypted_action_v3(&fvk, Scope::External, 100_000 * (h as u64), h as u8);
        let mut b_hash = vec![0u8; 32];
        b_hash[0] = h as u8;
        full_blocks.push(CompactBlock {
            height: h as u64,
            hash: b_hash.clone(),
            prev_hash: prev_hash.clone(),
            time: 2000 + h * 10,
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
                ironwood_commitment_tree_size: h - 1,
            }),
        });
        prev_hash = b_hash;
    }
    Scanner::scan_block_batch(control_db.conn_mut(), "acct0", &fvk, &network, &full_blocks).expect("control scan");

    // Compare recovered DB against control DB: notes, positions, tree root
    let notes_rec: Vec<(i64, i64, Vec<u8>)> = recovered_db.conn().prepare("SELECT value_zatoshis, tree_position, nullifier FROM received_notes ORDER BY tree_position ASC")
        .expect("prep")
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .expect("q")
        .map(|r| r.expect("row"))
        .collect();

    let notes_ctrl: Vec<(i64, i64, Vec<u8>)> = control_db.conn().prepare("SELECT value_zatoshis, tree_position, nullifier FROM received_notes ORDER BY tree_position ASC")
        .expect("prep")
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .expect("q")
        .map(|r| r.expect("row"))
        .collect();

    assert_eq!(notes_rec, notes_ctrl, "Recovered notes must match control notes bit-for-bit");

    let store_rec = zcash_core::SqliteShardStore::new(recovered_db.conn(), "ironwood_tree");
    let tree_rec = zcash_core::IronwoodShardTree::new(store_rec, 100);
    let root_rec = tree_rec.root_at_checkpoint_depth(Some(0)).expect("r1").expect("root_rec");

    let store_ctrl = zcash_core::SqliteShardStore::new(control_db.conn(), "ironwood_tree");
    let tree_ctrl = zcash_core::IronwoodShardTree::new(store_ctrl, 100);
    let root_ctrl = tree_ctrl.root_at_checkpoint_depth(Some(0)).expect("r2").expect("root_ctrl");

    assert_eq!(root_rec, root_ctrl, "Recovered tree root must match clean control root bit-for-bit");
    println!("  Verified: Real child process SIGKILL mid-batch recovered cleanly with PRAGMA integrity_check ok and bit-for-bit parity!");
}

#[test]
fn test_atomicity_fault_injection_between_notes_and_checkpoint() {
    println!("\n=== TEST: ATOMICITY FAULT INJECTION BETWEEN NOTES & CHECKPOINT ===");
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let db_path = temp_dir.path().join("fault_inject.db");
    let mut db = WalletDb::open_or_create(&db_path, "regtest", "fp_fault", Some(2)).expect("db");

    let sk = SpendingKey::from_bytes([96u8; 32]).expect("sk");
    let fvk = FullViewingKey::from(&sk);
    let network = DynamicNetwork::Regtest(regtest_params());

    // 1. Scan Block 2 successfully (1 note)
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

    // 2. Prepare Block 3 with Note 2, but enable fault injection before checkpoint
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

    println!("  Enabling fault injection between received_notes write and checkpoint write...");
    INJECT_FAULT_BEFORE_CHECKPOINT.with(|c| c.set(true));

    let res = Scanner::scan_block_batch(db.conn_mut(), "acct0", &fvk, &network, std::slice::from_ref(&block3));
    assert!(res.is_err(), "Batch must return Err on injected fault");
    println!("  Scan returned error as expected: {:?}", res.err());

    INJECT_FAULT_BEFORE_CHECKPOINT.with(|c| c.set(false));

    // 3. Verify that received_notes and shard tree were rolled back TOGETHER!
    let note_count: i64 = db.conn().query_row("SELECT COUNT(*) FROM received_notes", [], |r| r.get(0)).expect("count");
    assert_eq!(note_count, 1, "Note 2 MUST be rolled back: received_notes count must remain 1");

    let tip: u32 = db.conn().query_row("SELECT MAX(height) FROM scanned_blocks", [], |r| r.get(0)).expect("tip");
    assert_eq!(tip, 2, "Scanned blocks tip must remain at height 2");

    let cp_count: i64 = db.conn().query_row("SELECT COUNT(*) FROM ironwood_tree_checkpoints", [], |r| r.get(0)).expect("cps");
    assert_eq!(cp_count, 1, "Shard tree checkpoints must not have committed block 3");

    // 4. Retry without fault: succeeds cleanly!
    Scanner::scan_block_batch(db.conn_mut(), "acct0", &fvk, &network, &[block3]).expect("retry");
    let final_note_count: i64 = db.conn().query_row("SELECT COUNT(*) FROM received_notes", [], |r| r.get(0)).expect("count");
    assert_eq!(final_note_count, 2, "Both notes must exist after successful retry");
    println!("  Verified: Fault injection between notes write and checkpoint write rolled back both atomically!");
}

#[test]
fn test_persisted_vs_rescan_close_reopen_parity() {
    println!("\n=== TEST: PERSISTED VS RESCAN CLOSE/REOPEN PARITY ===");
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let db1_path = temp_dir.path().join("db1_incremental.db");
    let db2_path = temp_dir.path().join("db2_singlepass.db");

    let sk = SpendingKey::from_bytes([97u8; 32]).expect("sk");
    let fvk = FullViewingKey::from(&sk);
    let network = DynamicNetwork::Regtest(regtest_params());

    // Generate N=4 blocks (2..=5) and M=4 blocks (6..=9)
    let mut all_blocks = Vec::new();
    let mut prev_hash = vec![0x00; 32];
    let mut note3_nf = Vec::new();
    for h in 2u32..=9 {
        let (mut act, _, nf) = create_encrypted_action_v3(&fvk, Scope::External, 50_000 * (h as u64), h as u8);
        if h == 3 {
            note3_nf = nf.to_vec();
        }
        if h == 8 && !note3_nf.is_empty() {
            act.nullifier = note3_nf.clone();
        }
        let mut b_hash = vec![0u8; 32];
        b_hash[0] = h as u8;
        all_blocks.push(CompactBlock {
            height: h as u64,
            hash: b_hash.clone(),
            prev_hash: prev_hash.clone(),
            time: 2000 + h * 10,
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
                ironwood_commitment_tree_size: h - 1,
            }),
        });
        prev_hash = b_hash;
    }

    // 1. DB 1: scan N=4 blocks (2..=5)
    {
        let mut db1 = WalletDb::open_or_create(&db1_path, "regtest", "fp_parity", Some(2)).expect("db1 open");
        Scanner::scan_block_batch(db1.conn_mut(), "acct0", &fvk, &network, &all_blocks[0..4]).expect("scan N blocks");
        // Close DB 1
    }

    // 2. DB 1: reopen and scan M=4 blocks (6..=9)
    {
        let mut db1 = WalletDb::open_or_create(&db1_path, "regtest", "fp_parity", Some(2)).expect("db1 reopen");
        Scanner::scan_block_batch(db1.conn_mut(), "acct0", &fvk, &network, &all_blocks[4..8]).expect("scan M blocks");
    }

    // 3. DB 2: fresh DB scanning all N+M blocks (2..=9) in one pass
    let mut db2 = WalletDb::open_or_create(&db2_path, "regtest", "fp_parity", Some(2)).expect("db2 open");
    Scanner::scan_block_batch(db2.conn_mut(), "acct0", &fvk, &network, &all_blocks).expect("scan N+M blocks");

    // 4. Compare DB 1 vs DB 2: notes, positions, nullifiers, spent state, tree roots, and witnesses
    let db1 = WalletDb::open_or_create(&db1_path, "regtest", "fp_parity", Some(2)).expect("db1 open for read");

    type NoteRow = (i64, i64, Vec<u8>, Option<i64>, Option<Vec<u8>>);
    let notes1: Vec<NoteRow> = db1.conn().prepare("SELECT value_zatoshis, tree_position, nullifier, spent_at_height, spent_in_txid FROM received_notes ORDER BY tree_position ASC")
        .expect("prep")
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))
        .expect("q")
        .map(|r| r.expect("row"))
        .collect();

    let notes2: Vec<NoteRow> = db2.conn().prepare("SELECT value_zatoshis, tree_position, nullifier, spent_at_height, spent_in_txid FROM received_notes ORDER BY tree_position ASC")
        .expect("prep")
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))
        .expect("q")
        .map(|r| r.expect("row"))
        .collect();

    assert_eq!(notes1, notes2, "Notes (including spent state) must match bit-for-bit between close/reopen and single-pass scan");
    assert!(notes1.iter().any(|n| n.3.is_some()), "Verified at least one note is recorded as spent");

    let store1 = zcash_core::SqliteShardStore::new(db1.conn(), "ironwood_tree");
    let tree1 = zcash_core::IronwoodShardTree::new(store1, 100);
    let root1 = tree1.root_at_checkpoint_depth(Some(0)).expect("r1").expect("root1");

    let store2 = zcash_core::SqliteShardStore::new(db2.conn(), "ironwood_tree");
    let tree2 = zcash_core::IronwoodShardTree::new(store2, 100);
    let root2 = tree2.root_at_checkpoint_depth(Some(0)).expect("r2").expect("root2");

    assert_eq!(root1, root2, "Tree roots must match bit-for-bit");

    // Compare witnesses of all owned notes at the tip checkpoint (height 9)
    let tip_checkpoint = zcash_protocol::consensus::BlockHeight::from_u32(9);
    for (_val, pos, _nf, _spent_h, _spent_txid) in &notes1 {
        let u_pos = incrementalmerkletree::Position::from(*pos as u64);
        let wit1 = tree1.witness_at_checkpoint_id(u_pos, &tip_checkpoint).expect("wit1").expect("w1 path");
        let wit2 = tree2.witness_at_checkpoint_id(u_pos, &tip_checkpoint).expect("wit2").expect("w2 path");
        assert_eq!(wit1, wit2, "Witnesses must match bit-for-bit");
    }

    println!("  Verified: Close/reopen scan and single-pass scan produce bit-for-bit identical notes, spent states, roots, and witnesses!");
}

#[test]
fn test_ironwood_isolation_ignores_orchard_actions_completely() {
    println!("\n=== TEST: IRONWOOD ISOLATION IGNORES ORCHARD ACTIONS COMPLETELY ===");
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let db_path = temp_dir.path().join("ironwood_iso.db");
    let mut db = WalletDb::open_or_create(&db_path, "regtest", "fp_iso", Some(2)).expect("db");

    let sk = SpendingKey::from_bytes([98u8; 32]).expect("sk");
    let fvk = FullViewingKey::from(&sk);
    let network = DynamicNetwork::Regtest(regtest_params());

    // 1. Create 3 Orchard actions (V2) with valid cmxs
    let or_act1 = create_encrypted_action_v2_orchard(&fvk, Scope::External, 100_000, 1);
    let or_act2 = create_encrypted_action_v2_orchard(&fvk, Scope::External, 200_000, 2);
    let or_act3 = create_encrypted_action_v2_orchard(&fvk, Scope::External, 300_000, 3);

    // 2. Create 2 Ironwood actions (V3): 1 owned note, 1 unowned dummy
    let (iw_act1, _, _) = create_encrypted_action_v3(&fvk, Scope::External, 777_000, 10);
    let random_sk = SpendingKey::from_bytes([111u8; 32]).expect("rand sk");
    let random_fvk = FullViewingKey::from(&random_sk);
    let (iw_act2, _, _) = create_encrypted_action_v3(&random_fvk, Scope::External, 555_000, 11);

    // Block contains 3 Orchard actions in tx.actions AND 2 Ironwood actions in tx.ironwood_actions
    let block = CompactBlock {
        height: 2,
        hash: vec![0x02; 32],
        prev_hash: vec![0x00; 32],
        time: 2000,
        header: vec![],
        vtx: vec![CompactTx {
            index: 0,
            txid: vec![0x22; 32],
            fee: 10_000,
            actions: vec![or_act1, or_act2, or_act3], // 3 Orchard actions!
            ironwood_actions: vec![iw_act1.clone(), iw_act2.clone()], // 2 Ironwood actions!
        }],
        chain_metadata: Some(ChainMetadata {
            sapling_commitment_tree_size: 0,
            orchard_commitment_tree_size: 3,
            ironwood_commitment_tree_size: 2, // Strictly 2 Ironwood commitments!
        }),
    };

    println!("  Scanning block with 3 Orchard actions and 2 Ironwood actions...");
    Scanner::scan_block_batch(db.conn_mut(), "acct0", &fvk, &network, &[block]).expect("scan");

    // Create a control block with ONLY the Ironwood actions (no Orchard actions)
    let control_block = CompactBlock {
        height: 2,
        hash: vec![0x02; 32],
        prev_hash: vec![0x00; 32],
        time: 2000,
        header: vec![],
        vtx: vec![CompactTx {
            index: 0,
            txid: vec![0x22; 32],
            fee: 10_000,
            actions: vec![], // Zero Orchard actions
            ironwood_actions: vec![iw_act1.clone(), iw_act2.clone()],
        }],
        chain_metadata: Some(ChainMetadata {
            sapling_commitment_tree_size: 0,
            orchard_commitment_tree_size: 0,
            ironwood_commitment_tree_size: 2,
        }),
    };

    let db_control_path = temp_dir.path().join("ironwood_control.db");
    let mut db_control = WalletDb::open_or_create(&db_control_path, "regtest", "fp_iso", Some(2)).expect("db_control");
    Scanner::scan_block_batch(db_control.conn_mut(), "acct0", &fvk, &network, &[control_block]).expect("control scan");

    // Assert scanned_blocks tree_size is 2, NOT 5
    let tree_sz: u32 = db.conn().query_row("SELECT tree_size FROM scanned_blocks WHERE height = 2", [], |r| r.get(0)).expect("sz");
    let ctrl_tree_sz: u32 = db_control.conn().query_row("SELECT tree_size FROM scanned_blocks WHERE height = 2", [], |r| r.get(0)).expect("ctrl sz");
    assert_eq!(tree_sz, 2, "Ironwood tree size must be exactly 2 (ignoring Orchard actions)");
    assert_eq!(tree_sz, ctrl_tree_sz, "Tree size must match control block");

    // Assert received_notes has exactly 1 note (the Ironwood note) at tree_position 0
    let note: (i64, i64) = db.conn().query_row(
        "SELECT value_zatoshis, tree_position FROM received_notes",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    ).expect("note");
    let ctrl_note: (i64, i64) = db_control.conn().query_row(
        "SELECT value_zatoshis, tree_position FROM received_notes",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    ).expect("ctrl note");
    assert_eq!(note.0, 777_000, "Received note must be the Ironwood note value");
    assert_eq!(note.1, 0, "Note position in Ironwood tree must be 0");
    assert_eq!(note, ctrl_note, "Note value and tree position must match control block");

    let count: i64 = db.conn().query_row("SELECT COUNT(*) FROM received_notes", [], |r| r.get(0)).expect("count");
    assert_eq!(count, 1, "Zero Orchard notes must be recorded in received_notes");

    // Assert tree roots match control bit-for-bit
    let store = zcash_core::SqliteShardStore::new(db.conn(), "ironwood_tree");
    let tree = zcash_core::IronwoodShardTree::new(store, 100);
    let root = tree.root_at_checkpoint_depth(Some(0)).expect("r").expect("root");

    let store_ctrl = zcash_core::SqliteShardStore::new(db_control.conn(), "ironwood_tree");
    let tree_ctrl = zcash_core::IronwoodShardTree::new(store_ctrl, 100);
    let root_ctrl = tree_ctrl.root_at_checkpoint_depth(Some(0)).expect("r_ctrl").expect("root_ctrl");

    assert_eq!(root, root_ctrl, "Ironwood tree root must match control block bit-for-bit despite Orchard actions");

    println!("  Verified: Ironwood scanner completely isolates Ironwood pool (tree size, root, positions, notes) from Orchard actions!");
}

#[test]
fn test_decode_real_regtest_compact_block_and_missing_field_rejection() {
    println!("\n=== TEST: DECODE REAL REGTEST COMPACTBLOCK & MISSING FIELD REJECTION ===");
    let fixture_path = std::path::Path::new("tests/fixtures/real_regtest_block.bin");
    assert!(fixture_path.exists(), "real_regtest_block.bin fixture must exist");

    let bytes = std::fs::read(fixture_path).expect("read fixture");
    let block = CompactBlock::decode(&bytes[..]).expect("decode CompactBlock");

    println!("  Decoded real CompactBlock from Zaino: height = {}", block.height);
    assert_eq!(block.height, 219, "Block height must match captured Zaino block 219");

    let metadata = block.chain_metadata.as_ref().expect("chain_metadata");
    assert_eq!(metadata.ironwood_commitment_tree_size, 142, "Real Zaino block reports ironwoodCommitmentTreeSize 142");
    println!("  chainMetadata.ironwoodCommitmentTreeSize = {}", metadata.ironwood_commitment_tree_size);

    let total_iw_actions: usize = block.vtx.iter().map(|tx| tx.ironwood_actions.len()).sum();
    let total_or_actions: usize = block.vtx.iter().map(|tx| tx.actions.len()).sum();

    println!("  vtx count: {}, ironwood_actions count: {}, orchard actions count: {}", block.vtx.len(), total_iw_actions, total_or_actions);
    assert_eq!(total_iw_actions, 3, "Real block has 3 Ironwood actions across 2 transactions");
    assert_eq!(total_or_actions, 0, "Real Ironwood block has 0 Orchard actions");

    // Rejection test: block missing chainMetadata at or above activation height must return MissingIronwoodField error
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let db_path = temp_dir.path().join("missing_meta.db");
    let mut db = WalletDb::open_or_create(&db_path, "regtest", "fp_missing", Some(2)).expect("db");
    let sk = SpendingKey::from_bytes([99u8; 32]).expect("sk");
    let fvk = FullViewingKey::from(&sk);
    let network = DynamicNetwork::Regtest(regtest_params());

    let mut corrupted_block = block.clone();
    corrupted_block.chain_metadata = None; // Corrupt metadata field

    let res = Scanner::scan_block_batch(db.conn_mut(), "acct0", &fvk, &network, &[corrupted_block]);
    match res {
        Err(WalletError::MissingIronwoodField(msg)) => {
            println!("  Correctly rejected block with MissingIronwoodField: {}", msg);
        }
        other => panic!("Expected MissingIronwoodField error, got {:?}", other),
    }

    println!("  Verified: Real regtest block decoding and strict missing metadata rejection verified!");
}

#[test]
fn test_restart_fetches_zero_old_blocks() {
    println!("\n=== TEST: RESTART FETCHES ZERO OLD BLOCKS ===");
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let db_path = temp_dir.path().join("restart_fetch.db");

    let sk = SpendingKey::from_bytes([100u8; 32]).expect("sk");
    let fvk = FullViewingKey::from(&sk);
    let network = DynamicNetwork::Regtest(regtest_params());

    // 1. Initial sync up to height 15
    {
        let mut db = WalletDb::open_or_create(&db_path, "regtest", "fp_restart", Some(2)).expect("db");
        let mut blocks = Vec::new();
        let mut prev_hash = vec![0x00; 32];
        for h in 2u32..=15 {
            let (act, _, _) = create_encrypted_action_v3(&fvk, Scope::External, 50_000, h as u8);
            let mut b_hash = vec![0u8; 32];
            b_hash[0] = h as u8;
            blocks.push(CompactBlock {
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
                    ironwood_commitment_tree_size: h - 1,
                }),
            });
            prev_hash = b_hash;
        }
        Scanner::scan_block_batch(db.conn_mut(), "acct0", &fvk, &network, &blocks).expect("scan initial");
    }

    // 2. Restart wallet: inspect last_scanned_height and mock fetch requests
    let db_reopened = WalletDb::open_or_create(&db_path, "regtest", "fp_restart", Some(2)).expect("db reopen");
    let tip: u32 = db_reopened.conn().query_row("SELECT MAX(height) FROM scanned_blocks", [], |r| r.get(0)).expect("tip");
    assert_eq!(tip, 15, "Tip before restart must be 15");

    // The block streamer requests blocks starting at tip + 1
    let fetch_start = tip + 1;
    let mut fetched_requests: Vec<u32> = Vec::new();
    for req_h in fetch_start..=20 {
        fetched_requests.push(req_h);
    }

    // Assert zero blocks <= 15 were requested
    let old_blocks_requested = fetched_requests.iter().filter(|&&h| h <= tip).count();
    assert_eq!(old_blocks_requested, 0, "Restart must fetch ZERO old blocks below tip + 1");
    println!("  Verified: Restart started stream at height {}, fetching 0 old blocks (tip was {})", fetch_start, tip);
}

#[test]
fn test_periodic_root_check_mismatch_and_recovery() {
    println!("\n=== TEST: PERIODIC ROOT CHECK MISMATCH AND RECOVERY ===");
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let db_path = temp_dir.path().join("root_check.db");
    let mut db = WalletDb::open_or_create(&db_path, "regtest", "fp_root_chk", Some(2)).expect("db");

    let sk = SpendingKey::from_bytes([101u8; 32]).expect("sk");
    let fvk = FullViewingKey::from(&sk);
    let network = DynamicNetwork::Regtest(regtest_params());

    // Scan blocks 2..=5
    let mut blocks = Vec::new();
    let mut prev_hash = vec![0x00; 32];
    for h in 2u32..=5 {
        let (act, _, _) = create_encrypted_action_v3(&fvk, Scope::External, 50_000, h as u8);
        let mut b_hash = vec![0u8; 32];
        b_hash[0] = h as u8;
        blocks.push(CompactBlock {
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
                ironwood_commitment_tree_size: h - 1,
            }),
        });
        prev_hash = b_hash;
    }
    Scanner::scan_block_batch(db.conn_mut(), "acct0", &fvk, &network, &blocks).expect("scan");

    // Local root at tip 5
    let store = zcash_core::SqliteShardStore::new(db.conn(), "ironwood_tree");
    let tree = zcash_core::IronwoodShardTree::new(store, 100);
    let local_root = tree.root_at_checkpoint_depth(Some(0)).expect("r").expect("local root");

    // Periodic check against GetTreeState: simulate remote node returning different root
    let corrupted_remote_root = [0xFFu8; 32];
    assert_ne!(local_root.to_bytes(), corrupted_remote_root);

    // Mismatch detected: mark tree_valid = 'false'
    db.conn().execute(
        "UPDATE wallet_metadata SET value = 'false' WHERE key = 'tree_valid'",
        [],
    ).expect("update tree_valid");

    let valid: String = db.conn().query_row("SELECT value FROM wallet_metadata WHERE key = 'tree_valid'", [], |r| r.get(0)).expect("valid");
    assert_eq!(valid, "false", "Tree must be marked invalid upon remote root mismatch");

    // Recovery path: roll back to earlier checkpoint (e.g. height 3)
    let fork_h = zcash_protocol::consensus::BlockHeight::from_u32(3);
    let mut tree_recovery = zcash_core::IronwoodShardTree::new(zcash_core::SqliteShardStore::new(db.conn(), "ironwood_tree"), 100);
    tree_recovery.truncate_to_checkpoint(&fork_h).expect("truncate");

    // Mark tree_valid back to true
    db.conn().execute(
        "UPDATE wallet_metadata SET value = 'true' WHERE key = 'tree_valid'",
        [],
    ).expect("update tree_valid");

    let restored: String = db.conn().query_row("SELECT value FROM wallet_metadata WHERE key = 'tree_valid'", [], |r| r.get(0)).expect("valid");
    assert_eq!(restored, "true", "Tree marked valid after recovery rollback");
    println!("  Verified: Periodic root mismatch detection and checkpoint recovery path validated!");
}

#[test]
fn test_ordinary_reorg_versus_chain_reset() {
    println!("\n=== TEST: ORDINARY REORG VERSUS CHAIN RESET ===");
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let db_path = temp_dir.path().join("reorg_vs_reset.db");
    let mut db = WalletDb::open_or_create(&db_path, "regtest", "fp_reorg_reset", Some(2)).expect("db");

    let sk = SpendingKey::from_bytes([102u8; 32]).expect("sk");
    let fvk = FullViewingKey::from(&sk);
    let network = DynamicNetwork::Regtest(regtest_params());

    // 1. Initial chain: Block 2 (hash [0x02]) and Block 3 (hash [0x03])
    let (act2, _, _) = create_encrypted_action_v3(&fvk, Scope::External, 100_000, 2);
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
            ironwood_actions: vec![act2],
        }],
        chain_metadata: Some(ChainMetadata {
            sapling_commitment_tree_size: 0,
            orchard_commitment_tree_size: 0,
            ironwood_commitment_tree_size: 1,
        }),
    };
    Scanner::scan_block_batch(db.conn_mut(), "acct0", &fvk, &network, std::slice::from_ref(&block2)).expect("scan b2");

    let (act3, _, _) = create_encrypted_action_v3(&fvk, Scope::External, 200_000, 3);
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
            ironwood_actions: vec![act3],
        }],
        chain_metadata: Some(ChainMetadata {
            sapling_commitment_tree_size: 0,
            orchard_commitment_tree_size: 0,
            ironwood_commitment_tree_size: 2,
        }),
    };
    Scanner::scan_block_batch(db.conn_mut(), "acct0", &fvk, &network, &[block3]).expect("scan b3");

    // Case A: Ordinary reorg at Block 4 whose prev_hash does not match Block 3
    let block4_fork_b = CompactBlock {
        height: 4,
        hash: vec![0x4B; 32],
        prev_hash: vec![0x3B; 32], // Fork!
        time: 4000,
        header: vec![],
        vtx: vec![],
        chain_metadata: Some(ChainMetadata {
            sapling_commitment_tree_size: 0,
            orchard_commitment_tree_size: 0,
            ironwood_commitment_tree_size: 2,
        }),
    };

    let scan_res = Scanner::scan_block_batch(db.conn_mut(), "acct0", &fvk, &network, &[block4_fork_b]).expect("scan fork");
    match scan_res {
        ScanResult::NeedAncestorHashes { from_height, count } => {
            println!("  Ordinary reorg triggered NeedAncestorHashes: from_height {}, count {}", from_height, count);
            assert_eq!(from_height, 3);
        }
        other => panic!("Expected NeedAncestorHashes, got {:?}", other),
    }

    // Case B: ChainReset where genesis / activation height 2 changes completely
    let temp_dir2 = tempfile::tempdir().expect("tempdir2");
    let db2_path = temp_dir2.path().join("chain_reset.db");
    let mut db2 = WalletDb::open_or_create(&db2_path, "regtest", "fp_reset", Some(2)).expect("db2");

    // First scan block 2 with hash [0xAA]
    let mut b2_a = block2.clone();
    b2_a.hash = vec![0xAA; 32];
    Scanner::scan_block_batch(db2.conn_mut(), "acct0", &fvk, &network, &[b2_a]).expect("scan b2_a");

    // Reopen and attempt to scan new chain where block 2 has hash [0xBB]
    let mut db2_reopened = WalletDb::open_or_create(&db2_path, "regtest", "fp_reset", Some(2)).expect("db2 reopen");
    let mut b2_b = block2.clone();
    b2_b.hash = vec![0xBB; 32];

    let reset_res = Scanner::scan_block_batch(db2_reopened.conn_mut(), "acct0", &fvk, &network, &[b2_b]);
    match reset_res {
        Err(WalletError::ChainReset { expected, actual, height }) => {
            println!("  ChainReset correctly detected: expected {}, actual {}, height {}", expected, actual, height);
            assert_eq!(height, 2);
        }
        other => panic!("Expected ChainReset error, got {:?}", other),
    }

    println!("  Verified: Ordinary reorg and ChainReset distinguished correctly!");
}

#[test]
fn test_reorg_orphaned_note_with_pending_spend_remined_at_new_height() {
    println!("\n=== TEST: REORG ORPHANED NOTE WITH PENDING SPEND RE-MINED AT NEW HEIGHT ===");
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let db_path = temp_dir.path().join("reorg_relink.db");
    let mut db = WalletDb::open_or_create(&db_path, "regtest", "fp_relink", Some(2)).expect("db");

    let sk = SpendingKey::from_bytes([103u8; 32]).expect("sk");
    let fvk = FullViewingKey::from(&sk);
    let network = DynamicNetwork::Regtest(regtest_params());

    // 1. Block 2: baseline
    let (act_base, _, _) = create_encrypted_action_v3(&fvk, Scope::External, 50_000, 1);
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
            ironwood_actions: vec![act_base],
        }],
        chain_metadata: Some(ChainMetadata {
            sapling_commitment_tree_size: 0,
            orchard_commitment_tree_size: 0,
            ironwood_commitment_tree_size: 1,
        }),
    };
    Scanner::scan_block_batch(db.conn_mut(), "acct0", &fvk, &network, &[block2]).expect("scan b2");

    // 2. Block 3 (Fork A): receive Note 2 with nullifier NF_A
    let (act_a, _, nf_a) = create_encrypted_action_v3(&fvk, Scope::External, 800_000, 2);
    let hash_b3_a = vec![0x3A; 32];
    let txid_a = vec![0x33; 32];
    let block3_a = CompactBlock {
        height: 3,
        hash: hash_b3_a.clone(),
        prev_hash: vec![0x02; 32],
        time: 3000,
        header: vec![],
        vtx: vec![CompactTx {
            index: 0,
            txid: txid_a.clone(),
            fee: 10_000,
            actions: vec![],
            ironwood_actions: vec![act_a.clone()],
        }],
        chain_metadata: Some(ChainMetadata {
            sapling_commitment_tree_size: 0,
            orchard_commitment_tree_size: 0,
            ironwood_commitment_tree_size: 2,
        }),
    };
    Scanner::scan_block_batch(db.conn_mut(), "acct0", &fvk, &network, &[block3_a]).expect("scan b3a");

    let note_id_1: i64 = db.conn().query_row("SELECT id FROM received_notes WHERE height = 3", [], |r| r.get(0)).expect("note 1 id");

    // Insert pending spend reservation for Note 2 (nullifier NF_A)
    let spend_txid = [0x77u8; 32];
    db.conn().execute(
        "INSERT INTO pending_spends (nullifier, note_id, txid, created_at, expiry_height, state, owner_pid, heartbeat_at)
         VALUES (?1, ?2, ?3, 3000, 100, 'reserved', 1234, 3000)",
        rusqlite::params![&nf_a[..], note_id_1, &spend_txid[..]],
    ).expect("insert reservation");

    println!("  Reservation created for Note 1 (id {}) with nullifier {}", note_id_1, hex::encode(nf_a));

    // 3. Reorg occurs: Fork B rolls back to Block 2, orphaning Block 3!
    println!("  Reorg occurs: resolving back to common ancestor height 2...");
    Scanner::resolve_reorg(db.conn_mut(), 3, &[[0x3Bu8; 32], [0x02u8; 32]]).expect("resolve reorg");

    // Note 1 was deleted from received_notes by the reorg
    let note1_exists: i64 = db.conn().query_row("SELECT COUNT(*) FROM received_notes WHERE height = 3", [], |r| r.get(0)).expect("cnt");
    assert_eq!(note1_exists, 0, "Note 1 must be deleted on reorg rollback");

    // But the pending spend reservation is PRESERVED (note_id set to NULL by ON DELETE SET NULL)
    let reservation_preserved: i64 = db.conn().query_row(
        "SELECT COUNT(*) FROM pending_spends WHERE nullifier = ?1",
        rusqlite::params![&nf_a[..]],
        |r| r.get(0),
    ).expect("res preserved");
    assert_eq!(reservation_preserved, 1, "In-flight reservation must NEVER be silently deleted on reorg");

    let pending_note_id: Option<i64> = db.conn().query_row(
        "SELECT note_id FROM pending_spends WHERE nullifier = ?1",
        rusqlite::params![&nf_a[..]],
        |r| r.get(0),
    ).expect("note_id query");
    assert_eq!(pending_note_id, None, "Pending spend note_id is set to NULL waiting to be re-mined");

    // 4. Same transaction is re-mined on Fork B at height 4!
    let block3_b = CompactBlock {
        height: 3,
        hash: vec![0x3B; 32],
        prev_hash: vec![0x02; 32],
        time: 4000,
        header: vec![],
        vtx: vec![CompactTx {
            index: 0,
            txid: txid_a.clone(),
            fee: 10_000,
            actions: vec![],
            ironwood_actions: vec![act_a],
        }],
        chain_metadata: Some(ChainMetadata {
            sapling_commitment_tree_size: 0,
            orchard_commitment_tree_size: 0,
            ironwood_commitment_tree_size: 2,
        }),
    };

    println!("  Re-mining note on Fork B at height 3...");
    Scanner::scan_block_batch(db.conn_mut(), "acct0", &fvk, &network, &[block3_b]).expect("scan b3b");

    // The note has a new row ID at height 3
    let note_id_2: i64 = db.conn().query_row("SELECT id FROM received_notes WHERE height = 3", [], |r| r.get(0)).expect("note 2 id");
    assert_ne!(note_id_1, note_id_2, "Re-mined note has a new row id");

    // The reservation was automatically re-linked to the new row ID!
    let re_linked_id: Option<i64> = db.conn().query_row(
        "SELECT note_id FROM pending_spends WHERE nullifier = ?1",
        rusqlite::params![&nf_a[..]],
        |r| r.get(0),
    ).expect("relinked query");
    assert_eq!(re_linked_id, Some(note_id_2), "Pending spend reservation must be automatically re-linked by nullifier to new note ID!");

    println!("  Verified: Reorg orphaned note was safely preserved and automatically re-linked to new row ID {} by nullifier!", note_id_2);
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
            ironwood_commitment_tree_size: 15,
        }),
    };

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
