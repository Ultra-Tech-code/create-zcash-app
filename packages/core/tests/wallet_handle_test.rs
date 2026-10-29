use napi::bindgen_prelude::*;
use orchard::keys::{FullViewingKey, Scope};
use orchard::note::{ExtractedNoteCommitment, Note, NoteVersion, RandomSeed, Rho};
use orchard::note_encryption::{IronwoodDomain, IronwoodNoteEncryption};
use orchard::value::NoteValue;
use prost::Message;
use zcash_core::{
    ChainMetadata, CompactBlock, CompactOrchardAction, CompactTx, DynamicNetwork, WalletHandle,
};
use zcash_note_encryption::Domain;

fn create_encrypted_action(
    fvk: &FullViewingKey,
    scope: Scope,
    value: u64,
    seed: u8,
) -> CompactOrchardAction {
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

    CompactOrchardAction {
        nullifier: nf_bytes.to_vec(),
        cmx: cmx.to_vec(),
        ephemeral_key: epk_bytes.to_vec(),
        ciphertext: enc_ciphertext.as_ref()[..52].to_vec(),
    }
}

#[test]
fn test_wallet_handle_lifecycle_and_async_scan() {
    println!("\n=== TEST: WALLET HANDLE NAPI LIFECYCLE & ASYNC SCAN ===");
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let db_path = temp_dir.path().join("napi_wallet.db").to_string_lossy().to_string();

    let phrase = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    let acct = zcash_core::internal_derive_account_from_mnemonic(phrase, 0, "regtest").expect("acct");
    let ufvk_str = acct.ufvk;
    let network = DynamicNetwork::Regtest(zcash_core::regtest_params());
    let ufvk = zcash_keys::keys::UnifiedFullViewingKey::decode(&network, &ufvk_str).expect("ufvk decode");
    let fvk = ufvk.orchard().expect("orchard fvk").clone();

    // 1. Initialize WalletHandle
    println!("  Opening WalletHandle on {}...", db_path);
    let wallet = WalletHandle::open(
        db_path,
        "regtest".to_string(),
        ufvk_str,
        Some("account0".to_string()),
        None,
    ).expect("open wallet handle");

    let summary0 = wallet.get_wallet_summary().expect("summary0");
    assert_eq!(summary0.last_scanned_height, 0);
    assert_eq!(summary0.total_balance_zatoshis, 0);
    assert_eq!(summary0.spendable_balance_zatoshis, 0);
    println!("  WalletHandle opened with clean initial summary");

    // 2. Prepare raw protobuf CompactBlock bytes
    let act1 = create_encrypted_action(&fvk, Scope::External, 750_000, 1);
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

    let mut raw_bytes = Vec::new();
    block2.encode(&mut raw_bytes).expect("encode proto");

    // 3. Execute scan_blocks sync computation
    println!("  Executing scan_blocks_sync with raw protobuf bytes...");
    let scan_res = wallet.scan_blocks_sync(vec![raw_bytes]).expect("scan blocks sync");
    match scan_res {
        zcash_core::ScanResult::Synced { last_scanned_height, notes_detected } => {
            println!("  Scan computed: synced at height {}, detected {} notes", last_scanned_height, notes_detected);
            assert_eq!(last_scanned_height, 2);
            assert_eq!(notes_detected, 1);
        }
        other => panic!("Expected Synced, got {:?}", other),
    }

    // 4. Verify post-scan summary
    let summary1 = wallet.get_wallet_summary().expect("summary1");
    assert_eq!(summary1.last_scanned_height, 2);
    assert_eq!(summary1.total_balance_zatoshis, 750_000);
    assert_eq!(summary1.spendable_balance_zatoshis, 750_000);
    assert_eq!(summary1.unspent_notes_count, 1);
    println!("  Summary reflects scanned balance: 750,000 zatoshis");

    // 5. Query spendable notes via NAPI
    let spendable_notes = wallet.query_spendable_notes(2, 1).expect("query spendable");
    assert_eq!(spendable_notes.len(), 1);
    let note = &spendable_notes[0];
    assert_eq!(note.value_zatoshis, 750_000);
    assert_eq!(note.height, 2);
    println!("  NAPI querySpendableNotes returned confirmed note id {}", note.id);

    // 6. Test in-flight reservation via NAPI
    let txid_bytes = vec![0xAAu8; 32];
    println!("  Reserving note id {} for send txid...", note.id);
    wallet.reserve_notes(vec![note.id], Buffer::from(txid_bytes.clone()), 100).expect("reserve notes");

    // Spendable balance should now be 0 while total balance remains 750,000
    let summary2 = wallet.get_wallet_summary().expect("summary2");
    assert_eq!(summary2.total_balance_zatoshis, 750_000);
    assert_eq!(summary2.spendable_balance_zatoshis, 0, "Spendable balance must drop to 0 during reservation");
    println!("  Reservation confirmed: spendable balance accurately deducted");

    // Mark broadcast
    let broadcast_updated = wallet.mark_broadcast(Buffer::from(txid_bytes.clone())).expect("broadcast");
    assert_eq!(broadcast_updated, 1);

    // Cancel reservation returns status
    let cancelled = wallet.cancel_reservation(Buffer::from(txid_bytes)).expect("cancel");
    println!("  Reservation cancel returned status {}", cancelled);
}
