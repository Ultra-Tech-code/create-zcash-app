use orchard::circuit::{OrchardCircuitVersion, ProvingKey};
use orchard::keys::{FullViewingKey, Scope, SpendingKey};
use orchard::note::{ExtractedNoteCommitment, Note, NoteVersion, RandomSeed, Rho};
use orchard::note_encryption::{IronwoodDomain, IronwoodNoteEncryption};
use orchard::value::NoteValue;
use zcash_core::{
    build_and_prove_v6_ironwood_tx, query_spendable_notes, regtest_params, ChainMetadata,
    CompactBlock, CompactOrchardAction, CompactTx, DynamicNetwork, OutputSpec, OvkPolicy, Scanner,
    SpendInput, TransactionConfig, WalletDb,
};
use zcash_note_encryption::Domain;
use zcash_protocol::consensus::BranchId;
use zcash_protocol::value::Zatoshis;

fn create_encrypted_action(
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
fn test_spendable_notes_confirmation_boundaries_and_anchor_filtering() {
    println!("\n=== TEST: SPENDABLE NOTES STRICT SQL, BOUNDARIES & ANCHOR FILTERING ===");
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let db_path = temp_dir.path().join("wallet_spendable.db");
    let mut db = WalletDb::open_or_create(&db_path, "regtest", "fp_spendable", Some(2)).expect("db open");

    let sk = SpendingKey::from_bytes([42u8; 32]).expect("valid sk");
    let fvk = FullViewingKey::from(&sk);
    let network = DynamicNetwork::Regtest(regtest_params());

    // Scan Block 2: Note 1 (100k zat)
    let (act1, _, nf1) = create_encrypted_action(&fvk, Scope::External, 100_000, 1);
    let b2 = CompactBlock {
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
    Scanner::scan_block_batch(db.conn_mut(), "acct0", &fvk, &network, &[b2]).expect("scan b2");

    // Scan Block 3: Note 2 (200k zat)
    let (act2, _, _nf2) = create_encrypted_action(&fvk, Scope::External, 200_000, 2);
    let b3 = CompactBlock {
        height: 3,
        hash: vec![0x03; 32],
        prev_hash: vec![0x02; 32],
        time: 3000,
        header: vec![],
        vtx: vec![CompactTx {
            index: 0,
            txid: vec![0x33; 32],
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
    Scanner::scan_block_batch(db.conn_mut(), "acct0", &fvk, &network, &[b3]).expect("scan b3");

    // Scan Block 4: Note 3 (300k zat)
    let (act3, _, _nf3) = create_encrypted_action(&fvk, Scope::External, 300_000, 3);
    let b4 = CompactBlock {
        height: 4,
        hash: vec![0x04; 32],
        prev_hash: vec![0x03; 32],
        time: 4000,
        header: vec![],
        vtx: vec![CompactTx {
            index: 0,
            txid: vec![0x44; 32],
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
    Scanner::scan_block_batch(db.conn_mut(), "acct0", &fvk, &network, &[b4]).expect("scan b4");

    // Scan Block 5: Note 4 (400k zat) - mined ABOVE anchor 4!
    let (act4, _, _nf4) = create_encrypted_action(&fvk, Scope::External, 400_000, 4);
    let b5 = CompactBlock {
        height: 5,
        hash: vec![0x05; 32],
        prev_hash: vec![0x04; 32],
        time: 5000,
        header: vec![],
        vtx: vec![CompactTx {
            index: 0,
            txid: vec![0x55; 32],
            fee: 10_000,
            actions: vec![],
            ironwood_actions: vec![act4],
        }],
        chain_metadata: Some(ChainMetadata {
            sapling_commitment_tree_size: 0,
            orchard_commitment_tree_size: 0,
            ironwood_commitment_tree_size: 4,
        }),
    };
    Scanner::scan_block_batch(db.conn_mut(), "acct0", &fvk, &network, &[b5]).expect("scan b5");

    let anchor = 4u32;

    // Test A: anchor=4, min_confs=1
    // Note 4 (height 5) is mined above anchor -> MUST be excluded
    // Note 3 (height 4) has confs 4+1-4 = 1 >= 1 -> spendable
    // Note 2 (height 3) has confs 4+1-3 = 2 >= 1 -> spendable
    // Note 1 (height 2) has confs 4+1-2 = 3 >= 1 -> spendable
    println!("  Querying spendable notes at anchor=4, min_confs=1...");
    let notes_conf1 = query_spendable_notes(db.conn(), anchor, 1).expect("query conf1");
    let heights_conf1: Vec<u32> = notes_conf1.iter().map(|n| n.height).collect();
    assert_eq!(heights_conf1, vec![2, 3, 4], "Must return notes at heights 2, 3, 4; Note at height 5 (above anchor) strictly excluded");
    println!("  Note 4 (height 5) correctly excluded because height > anchor");

    // Test B: anchor=4, min_confs=2
    // Note 3 has confs 1 < 2 -> MUST be excluded
    // Notes 1 & 2 have confs >= 2 -> spendable
    println!("  Querying spendable notes at anchor=4, min_confs=2...");
    let notes_conf2 = query_spendable_notes(db.conn(), anchor, 2).expect("query conf2");
    let heights_conf2: Vec<u32> = notes_conf2.iter().map(|n| n.height).collect();
    assert_eq!(heights_conf2, vec![2, 3], "Must return only notes with >= 2 confirmations at anchor");
    println!("  Min_confs boundary (2) strictly enforced");

    // Test C: anchor=4, min_confs=3
    // Only Note 1 has confs 4+1-2 = 3 >= 3
    println!("  Querying spendable notes at anchor=4, min_confs=3...");
    let notes_conf3 = query_spendable_notes(db.conn(), anchor, 3).expect("query conf3");
    let heights_conf3: Vec<u32> = notes_conf3.iter().map(|n| n.height).collect();
    assert_eq!(heights_conf3, vec![2]);

    // Test D: Reservation exclusion
    // Place in-flight reservation on Note 1
    println!("  Placing in-flight reservation on Note 1...");
    let note1_id: i64 = db.conn().query_row("SELECT id FROM received_notes WHERE height = 2", [], |r| r.get(0)).expect("note1_id");
    db.conn().execute(
        "INSERT INTO pending_spends (nullifier, note_id, txid, created_at, expiry_height, state, owner_pid, heartbeat_at)
         VALUES (?1, ?2, ?3, 2000, 100, 'reserved', 1234, 2000)",
        rusqlite::params![&nf1[..], note1_id, vec![0x99u8; 32]],
    ).expect("reserve note 1");

    let notes_after_res = query_spendable_notes(db.conn(), anchor, 1).expect("query after res");
    let heights_after_res: Vec<u32> = notes_after_res.iter().map(|n| n.height).collect();
    assert_eq!(heights_after_res, vec![3, 4], "Note 1 must be excluded while in pending_spends reservation");
    println!("  Reserved note strictly excluded from spendable query");
}

#[test]
fn test_builder_integration_with_spendable_notes() {
    println!("\n=== TEST: BUILDER INTEGRATION WITH SPENDABLE NOTES & MERKLE PATHS ===");
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let db_path = temp_dir.path().join("wallet_builder_integ.db");
    let mut db = WalletDb::open_or_create(&db_path, "regtest", "fp_integ", Some(2)).expect("db open");

    let sk = SpendingKey::from_bytes([55u8; 32]).expect("valid sk");
    let fvk = FullViewingKey::from(&sk);
    let network = DynamicNetwork::Regtest(regtest_params());

    // Scan Block 2: Note 1 (600,000 zatoshis)
    let (act1, _, _nf1) = create_encrypted_action(&fvk, Scope::External, 600_000, 10);
    let b2 = CompactBlock {
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
    Scanner::scan_block_batch(db.conn_mut(), "acct0", &fvk, &network, &[b2]).expect("scan b2");

    // Query spendable note at anchor 2
    let spendable_list = query_spendable_notes(db.conn(), 2, 1).expect("query spendable");
    assert_eq!(spendable_list.len(), 1);
    let spendable = &spendable_list[0];
    assert_eq!(spendable.value_zatoshis, 600_000);

    // Build SpendInput from spendable note
    let spend_input = SpendInput::from(spendable);

    // Output recipient (recipient address 0 from sk)
    let recipient_addr = fvk.address_at(0u32, Scope::External);
    let outputs = vec![OutputSpec {
        recipient: recipient_addr,
        value: NoteValue::from_raw(500_000),
        memo: None,
        ovk_policy: OvkPolicy::SenderFvk,
    }];

    // ZIP 317 fee for 2 actions (1 spend + 1 output with default 2 padding) is 10,000 zatoshis
    let change_value = 600_000 - 500_000 - 10_000; // 90,000 zatoshis change
    let change_output = OutputSpec {
        recipient: fvk.address_at(1u32, Scope::Internal),
        value: NoteValue::from_raw(change_value),
        memo: None,
        ovk_policy: OvkPolicy::SenderFvk,
    };
    let mut all_outputs = outputs;
    all_outputs.push(change_output);

    // Build, prove, and sign v6 Ironwood transaction
    let cmx = ExtractedNoteCommitment::from(spendable.note.commitment());
    let anchor = spendable.merkle_path.root(cmx);
    let tip = zcash_protocol::consensus::BlockHeight::from_u32(100);
    let config = TransactionConfig::new(BranchId::Nu6_3, anchor, tip, Some(5));

    println!("  Building, proving and signing v6 transaction with spendable note...");
    let pk = ProvingKey::build(OrchardCircuitVersion::PostNu6_3);
    let built_tx = build_and_prove_v6_ironwood_tx(
        &sk,
        vec![spend_input],
        all_outputs,
        &config,
        &pk,
    ).expect("build v6 tx");

    assert_eq!(built_tx.fee, Zatoshis::const_from_u64(10_000));
    assert_eq!(built_tx.num_actions, 2);
    println!("  Built v6 transaction successfully! TxID: {}", hex::encode(built_tx.txid.as_ref()));
}

#[test]
fn test_reorg_orphaned_reservation_blocks_spending_before_relink() {
    println!("\n=== TEST: ORPHANED RESERVATION BLOCKS SPENDING BEFORE RELINK ===");
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let db_path = temp_dir.path().join("orphaned_reservation.db");
    let mut db = WalletDb::open_or_create(&db_path, "regtest", "fp_spend_orphaned", Some(2)).expect("db");

    let sk = SpendingKey::from_bytes([91u8; 32]).expect("sk");
    let fvk = FullViewingKey::from(&sk);
    let network = DynamicNetwork::Regtest(regtest_params());

    // 1. Scan block 2 (empty) and block 3 (Fork A containing note A)
    let b2 = CompactBlock {
        height: 2,
        hash: vec![0x02; 32],
        prev_hash: vec![0x01; 32],
        time: 1000,
        header: vec![],
        vtx: vec![],
        chain_metadata: Some(ChainMetadata {
            sapling_commitment_tree_size: 0,
            orchard_commitment_tree_size: 0,
            ironwood_commitment_tree_size: 0,
        }),
    };

    let (act_a, _, nf_a) = create_encrypted_action(&fvk, Scope::External, 500_000, 1);
    let b3_a = CompactBlock {
        height: 3,
        hash: vec![0x3A; 32],
        prev_hash: vec![0x02; 32],
        time: 2000,
        header: vec![],
        vtx: vec![CompactTx {
            index: 0,
            txid: vec![0xAA; 32],
            fee: 10_000,
            actions: vec![],
            ironwood_actions: vec![act_a.clone()],
        }],
        chain_metadata: Some(ChainMetadata {
            sapling_commitment_tree_size: 0,
            orchard_commitment_tree_size: 0,
            ironwood_commitment_tree_size: 1,
        }),
    };

    Scanner::scan_block_batch(db.conn_mut(), "acct0", &fvk, &network, &[b2, b3_a]).expect("scan b2, b3a");

    // Spendable notes at anchor 3 should return 1 note
    let initial_spendable = query_spendable_notes(db.conn(), 3, 1).expect("query spendable");
    assert_eq!(initial_spendable.len(), 1);
    let note_id_1: i64 = db.conn().query_row("SELECT id FROM received_notes WHERE height = 3", [], |r| r.get(0)).expect("note 1 id");

    // 2. Reserve note A: pending_spends row with note_id_1 and nf_a
    db.conn().execute(
        "INSERT INTO pending_spends (nullifier, note_id, txid, created_at, expiry_height, state, owner_pid, heartbeat_at)
         VALUES (?1, ?2, ?3, 1000, 50, 'reserved', 1234, 1000)",
        rusqlite::params![&nf_a[..], note_id_1, &[0x55u8; 32][..]],
    ).expect("insert reservation");

    // Spendable notes now excludes note A
    let spendable_reserved = query_spendable_notes(db.conn(), 3, 1).expect("query spendable");
    assert_eq!(spendable_reserved.len(), 0, "Reserved note must be excluded");

    // 3. Reorg at fork height 2 (orphans block 3_a)
    Scanner::resolve_reorg(db.conn_mut(), 2, &[[0x02; 32]]).expect("resolve reorg");

    let orphaned_note_id: Option<i64> = db.conn().query_row(
        "SELECT note_id FROM pending_spends WHERE nullifier = ?1",
        rusqlite::params![&nf_a[..]],
        |r| r.get(0),
    ).expect("query note_id");
    assert_eq!(orphaned_note_id, None, "Reservation preserved with note_id = NULL");

    // 4. Re-mine the note on Fork B at height 3
    let b3_b = CompactBlock {
        height: 3,
        hash: vec![0x3B; 32],
        prev_hash: vec![0x02; 32],
        time: 2100,
        header: vec![],
        vtx: vec![CompactTx {
            index: 0,
            txid: vec![0xBB; 32],
            fee: 10_000,
            actions: vec![],
            ironwood_actions: vec![act_a],
        }],
        chain_metadata: Some(ChainMetadata {
            sapling_commitment_tree_size: 0,
            orchard_commitment_tree_size: 0,
            ironwood_commitment_tree_size: 1,
        }),
    };

    Scanner::scan_block_batch(db.conn_mut(), "acct0", &fvk, &network, &[b3_b]).expect("scan b3b");
    let note_id_2: i64 = db.conn().query_row("SELECT id FROM received_notes WHERE height = 3", [], |r| r.get(0)).expect("note 2 id");
    assert_ne!(note_id_1, note_id_2, "Re-mined note has a new row id");

    // Deliberately set note_id to NULL to represent state BEFORE relink runs!
    db.conn().execute("UPDATE pending_spends SET note_id = NULL WHERE nullifier = ?1", rusqlite::params![&nf_a[..]]).expect("reset note_id to null");

    let verify_null: Option<i64> = db.conn().query_row(
        "SELECT note_id FROM pending_spends WHERE nullifier = ?1",
        rusqlite::params![&nf_a[..]],
        |r| r.get(0),
    ).expect("query note_id");
    assert_eq!(verify_null, None, "Testing state strictly BEFORE relink runs (note_id IS NULL)");

    // 5. Query spendable notes at anchor 3 with min_confs 1
    // MUST STILL EXCLUDE NOTE A by nullifier, even though note_id is NULL!
    let spendable_before_relink = query_spendable_notes(db.conn(), 3, 1).expect("query spendable");
    assert_eq!(
        spendable_before_relink.len(),
        0,
        "Orphaned reservation with note_id = NULL MUST STILL block spending of re-mined note by nullifier!"
    );

    // 6. Now verify relink re-links to note_id_2
    let tx = db.conn_mut().transaction().expect("tx");
    let relinked_count = zcash_core::PendingSpendsManager::relink_reservations(&tx).expect("relink");
    tx.commit().expect("commit");
    assert_eq!(relinked_count, 1);

    let re_linked_id: Option<i64> = db.conn().query_row(
        "SELECT note_id FROM pending_spends WHERE nullifier = ?1",
        rusqlite::params![&nf_a[..]],
        |r| r.get(0),
    ).expect("query note_id");
    assert_eq!(re_linked_id, Some(note_id_2));

    println!("  Verified: Orphaned reservation strictly blocks spending before relink runs by nullifier matching!");
}
