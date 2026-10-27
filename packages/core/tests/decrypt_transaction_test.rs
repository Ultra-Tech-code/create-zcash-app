use std::sync::OnceLock;

use bip0039::{English, Mnemonic};
use incrementalmerkletree::frontier::CommitmentTree;
use incrementalmerkletree::witness::IncrementalWitness;
use orchard::circuit::{OrchardCircuitVersion, ProvingKey};
use orchard::keys::Scope;
use orchard::note::{Note, NoteVersion, RandomSeed, Rho};
use orchard::tree::{MerkleHashOrchard, MerklePath};
use orchard::value::NoteValue;
use zcash_keys::address::UnifiedAddress;
use zcash_keys::keys::UnifiedSpendingKey;
use zcash_protocol::consensus::{BlockHeight, BranchId};

use zcash_core::decrypted_tx::internal_decrypt_transaction;
use zcash_core::regtest_params;
use zcash_core::transaction::{
    build_and_prove_v6_ironwood_tx, OutputSpec, OvkPolicy, SpendInput, TransactionConfig,
};

static PROVING_KEY: OnceLock<ProvingKey> = OnceLock::new();

fn get_shared_proving_key() -> &'static ProvingKey {
    PROVING_KEY.get_or_init(|| {
        println!(">>> [OnceLock] Building shared OrchardCircuitVersion::PostNu6_3 ProvingKey...");
        let start = std::time::Instant::now();
        let pk = ProvingKey::build(OrchardCircuitVersion::PostNu6_3);
        println!(">>> [OnceLock] ProvingKey built in {} ms", start.elapsed().as_millis());
        pk
    })
}

pub const KNOWN_TEST_MNEMONICS: [&str; 3] = [
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
    "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong",
    "legal winner thank year wave sausage worth useful legal winner thank yellow",
];

#[test]
fn test_decrypt_transaction_offline_ci_suite() {
    println!("\n=== TEST: OFFLINE FULL-TRANSACTION DECRYPTION (CI, REGTEST ONLY) ===");
    let params = regtest_params();

    // 1. Derive Account 0 for Sender (Mnemonic 0), Recipient (Mnemonic 1), and Stranger (Mnemonic 2)
    let seed_sender = Mnemonic::<English>::from_phrase(KNOWN_TEST_MNEMONICS[0]).unwrap().to_seed("");
    let usk_sender = UnifiedSpendingKey::from_seed(&params, &seed_sender, 0.try_into().unwrap()).unwrap();
    let ufvk_sender = usk_sender.to_unified_full_viewing_key();
    let ufvk_sender_str = ufvk_sender.encode(&params).unwrap();
    let orchard_sk_sender = usk_sender.orchard();
    let orchard_fvk_sender = ufvk_sender.orchard().expect("sender orchard fvk");

    let seed_recipient = Mnemonic::<English>::from_phrase(KNOWN_TEST_MNEMONICS[1]).unwrap().to_seed("");
    let usk_recipient = UnifiedSpendingKey::from_seed(&params, &seed_recipient, 0.try_into().unwrap()).unwrap();
    let ufvk_recipient = usk_recipient.to_unified_full_viewing_key();
    let ufvk_recipient_str = ufvk_recipient.encode(&params).unwrap();
    let orchard_fvk_recipient = ufvk_recipient.orchard().expect("recipient orchard fvk");
    let recipient_addr = orchard_fvk_recipient.address_at(0u32, Scope::External);
    let expected_recipient_ua = UnifiedAddress::from_receivers(Some(recipient_addr), None, None, None, None)
        .unwrap()
        .encode(&params);

    let seed_stranger = Mnemonic::<English>::from_phrase(KNOWN_TEST_MNEMONICS[2]).unwrap().to_seed("");
    let usk_stranger = UnifiedSpendingKey::from_seed(&params, &seed_stranger, 0.try_into().unwrap()).unwrap();
    let ufvk_stranger = usk_stranger.to_unified_full_viewing_key();
    let ufvk_stranger_str = ufvk_stranger.encode(&params).unwrap();

    // 2. Setup in-memory commitment tree with a 1,000,000 zat note for sender
    let sender_addr0 = orchard_fvk_sender.address_at(0u32, Scope::External);
    let rho = Rho::from_bytes(&[10u8; 32]).unwrap();
    let rseed = RandomSeed::from_bytes([20u8; 32], &rho).unwrap();
    let input_note = Note::from_parts(
        sender_addr0,
        NoteValue::from_raw(1_000_000),
        rho,
        rseed,
        NoteVersion::V2,
    )
    .unwrap();

    let mut tree = CommitmentTree::<MerkleHashOrchard, 32>::empty();
    let cmx: orchard::note::ExtractedNoteCommitment = input_note.commitment().into();
    let leaf = MerkleHashOrchard::from_bytes(&cmx.to_bytes()).unwrap();
    tree.append(leaf).unwrap();
    let wit = IncrementalWitness::from_tree(tree.clone()).unwrap();
    let anchor: orchard::Anchor = tree.root().into();
    let path = MerklePath::from(wit.path().unwrap());
    let spend1 = SpendInput::new(input_note, path);

    // 3. Build Transaction 1 with OvkPolicy::SenderFvk
    let test_memo_text = "Ironwood transfer from Sender to Recipient";
    let mut memo_bytes = [0u8; 512];
    memo_bytes[..test_memo_text.len()].copy_from_slice(test_memo_text.as_bytes());

    let out_recipient = OutputSpec::with_memo(recipient_addr, NoteValue::from_raw(600_000), memo_bytes)
        .with_ovk_policy(OvkPolicy::SenderFvk);

    let sender_change_addr = orchard_fvk_sender.address_at(0u32, Scope::Internal);
    let out_change = OutputSpec::new(sender_change_addr, NoteValue::from_raw(390_000))
        .with_ovk_policy(OvkPolicy::SenderFvk);

    let tip = BlockHeight::from_u32(100);
    let config = TransactionConfig::new(BranchId::Nu6_3, anchor, tip, None);
    let pk = get_shared_proving_key();

    println!("  Building transaction 1 with OvkPolicy::SenderFvk...");
    let built = build_and_prove_v6_ironwood_tx(
        orchard_sk_sender,
        vec![spend1],
        vec![out_recipient, out_change],
        &config,
        pk,
    )
    .expect("build tx1 with SenderFvk");

    let txid_expected = built.txid.to_string();
    println!("  Built TxID: {}", txid_expected);

    // --- (a) Sender UFVK recovers outgoing recipient / amount / memo AND internal change ---
    println!("  Testing (a): Sender UFVK recovery...");
    let dec_sender = internal_decrypt_transaction(&ufvk_sender_str, "regtest", &built.raw_bytes, 100)
        .expect("decrypt with sender UFVK");

    assert_eq!(dec_sender.txid, txid_expected);
    assert_eq!(dec_sender.fee, 10_000);
    assert_eq!(dec_sender.expiry_height, 141);
    assert_eq!(dec_sender.consensus_branch_id, "37a5165b");

    assert_eq!(dec_sender.outgoing.len(), 1, "Sender must recover exactly 1 outgoing output");
    let out0 = &dec_sender.outgoing[0];
    assert_eq!(out0.value, 600_000);
    assert_eq!(out0.recipient, expected_recipient_ua);
    assert_eq!(out0.memo.text, Some(test_memo_text.to_string()));
    assert_eq!(out0.memo.hex, hex::encode(test_memo_text));
    println!("    SUCCESS (a.1): Recovered outgoing value=600,000 zat, recipient match, memo match!");

    assert_eq!(dec_sender.incoming.len(), 1, "Sender must recover exactly 1 incoming (internal change) note");
    let in0 = &dec_sender.incoming[0];
    assert_eq!(in0.value, 390_000);
    assert!(in0.is_change, "Internal note must have is_change == true");
    assert!(in0.is_internal, "Internal note must have is_internal == true");
    println!("    SUCCESS (a.2): Recovered internal change note value=390,000 zat, marked is_change=true!");

    // --- (b) Recipient UFVK decrypts incoming note + memo ---
    println!("  Testing (b): Recipient UFVK decryption...");
    let dec_recipient = internal_decrypt_transaction(&ufvk_recipient_str, "regtest", &built.raw_bytes, 100)
        .expect("decrypt with recipient UFVK");

    assert_eq!(dec_recipient.txid, txid_expected);
    assert_eq!(dec_recipient.incoming.len(), 1, "Recipient must decrypt exactly 1 incoming note");
    let rec_in = &dec_recipient.incoming[0];
    assert_eq!(rec_in.value, 600_000);
    assert_eq!(rec_in.recipient, expected_recipient_ua);
    assert_eq!(rec_in.memo.text, Some(test_memo_text.to_string()));
    assert_eq!(rec_in.memo.hex, hex::encode(test_memo_text));
    assert!(!rec_in.is_change, "Recipient payment note must have is_change == false");
    assert!(!rec_in.is_internal, "Recipient payment note must have is_internal == false");
    assert!(dec_recipient.outgoing.is_empty(), "Recipient UFVK must see 0 outgoing notes");
    println!("    SUCCESS (b): Recipient decrypted incoming 600,000 zat with full memo text and hex!");

    // --- (c) Stranger UFVK sees nothing ---
    println!("  Testing (c): Stranger UFVK decryption...");
    let dec_stranger = internal_decrypt_transaction(&ufvk_stranger_str, "regtest", &built.raw_bytes, 100)
        .expect("decrypt with stranger UFVK");

    assert_eq!(dec_stranger.txid, txid_expected);
    assert!(dec_stranger.incoming.is_empty(), "Stranger must see 0 incoming notes");
    assert!(dec_stranger.outgoing.is_empty(), "Stranger must see 0 outgoing notes");
    println!("    SUCCESS (c): Stranger UFVK sees strictly zero incoming and zero outgoing notes!");

    // --- (d) OvkPolicy::None => sender sees no outgoing ---
    println!("  Testing (d): OvkPolicy::None (opt-out of sender recovery)...");
    let rho2 = Rho::from_bytes(&[30u8; 32]).unwrap();
    let rseed2 = RandomSeed::from_bytes([40u8; 32], &rho2).unwrap();
    let input_note2 = Note::from_parts(
        sender_addr0,
        NoteValue::from_raw(1_000_000),
        rho2,
        rseed2,
        NoteVersion::V2,
    )
    .unwrap();

    let mut tree2 = CommitmentTree::<MerkleHashOrchard, 32>::empty();
    let cmx2: orchard::note::ExtractedNoteCommitment = input_note2.commitment().into();
    let leaf2 = MerkleHashOrchard::from_bytes(&cmx2.to_bytes()).unwrap();
    tree2.append(leaf2).unwrap();
    let wit2 = IncrementalWitness::from_tree(tree2.clone()).unwrap();
    let anchor2: orchard::Anchor = tree2.root().into();
    let path2 = MerklePath::from(wit2.path().unwrap());
    let spend2 = SpendInput::new(input_note2, path2);

    let out_recipient_no_ovk = OutputSpec::with_memo(recipient_addr, NoteValue::from_raw(600_000), memo_bytes)
        .with_ovk_policy(OvkPolicy::None);

    let out_change2 = OutputSpec::new(sender_change_addr, NoteValue::from_raw(390_000))
        .with_ovk_policy(OvkPolicy::SenderFvk);

    let config2 = TransactionConfig::new(BranchId::Nu6_3, anchor2, tip, None);
    let built_no_ovk = build_and_prove_v6_ironwood_tx(
        orchard_sk_sender,
        vec![spend2],
        vec![out_recipient_no_ovk, out_change2],
        &config2,
        pk,
    )
    .expect("build tx with OvkPolicy::None");

    let dec_sender_no_ovk = internal_decrypt_transaction(&ufvk_sender_str, "regtest", &built_no_ovk.raw_bytes, 100)
        .expect("decrypt sender with OvkPolicy::None");

    assert!(
        dec_sender_no_ovk.outgoing.is_empty(),
        "With OvkPolicy::None, sender must recover zero outgoing notes"
    );
    assert_eq!(
        dec_sender_no_ovk.incoming.len(),
        1,
        "Sender still recovers its own change note via internal IVK"
    );
    println!("    SUCCESS (d): OvkPolicy::None strictly prevents sender from recovering outgoing output!");

    // Also verify recipient STILL decrypts the incoming note even when sender used OvkPolicy::None!
    let dec_rec_from_no_ovk = internal_decrypt_transaction(&ufvk_recipient_str, "regtest", &built_no_ovk.raw_bytes, 100)
        .expect("recipient decrypt tx with OvkPolicy::None");
    assert_eq!(dec_rec_from_no_ovk.incoming.len(), 1, "Recipient still decrypts incoming note with IVK");
    println!("    SUCCESS: Recipient IVK decryption succeeds regardless of sender OVK policy!");
}
