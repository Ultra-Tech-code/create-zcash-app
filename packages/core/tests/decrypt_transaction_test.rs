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
use zcash_protocol::value::{ZatBalance, Zatoshis};
use zcash_primitives::transaction::{Authorized, TransactionData};
use zcash_transparent::address::Script;
use zcash_transparent::bundle::{Bundle as TransparentBundle, OutPoint, TxIn, TxOut, Authorized as TransparentAuth};

use zcash_core::decrypted_tx::internal_decrypt_transaction;
use zcash_core::regtest_params;
use zcash_core::transaction::{
    build_and_prove_v6_ironwood_tx, BuiltTransaction, OutputSpec, OvkPolicy, SpendInput, TransactionConfig,
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

pub const TEST_MEMO_TEXT: &str = "Ironwood transfer from Sender to Recipient";

struct TestFixture {
    ufvk_sender_str: String,
    ufvk_recipient_str: String,
    ufvk_stranger_str: String,
    expected_recipient_ua: String,
    tx1_sender_fvk: BuiltTransaction,
    tx2_ovk_none: BuiltTransaction,
}

static FIXTURE: OnceLock<TestFixture> = OnceLock::new();

fn get_fixture() -> &'static TestFixture {
    FIXTURE.get_or_init(|| {
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
        let mut memo_bytes = [0u8; 512];
        memo_bytes[..TEST_MEMO_TEXT.len()].copy_from_slice(TEST_MEMO_TEXT.as_bytes());

        let out_recipient = OutputSpec::with_memo(recipient_addr, NoteValue::from_raw(600_000), memo_bytes)
            .with_ovk_policy(OvkPolicy::SenderFvk);

        let sender_change_addr = orchard_fvk_sender.address_at(0u32, Scope::Internal);
        let out_change = OutputSpec::new(sender_change_addr, NoteValue::from_raw(390_000))
            .with_ovk_policy(OvkPolicy::SenderFvk);

        let tip = BlockHeight::from_u32(100);
        let config = TransactionConfig::new(BranchId::Nu6_3, anchor, tip, None);
        let pk = get_shared_proving_key();

        println!("  Building transaction 1 with OvkPolicy::SenderFvk...");
        let tx1_sender_fvk = build_and_prove_v6_ironwood_tx(
            orchard_sk_sender,
            vec![spend1],
            vec![out_recipient, out_change],
            &config,
            pk,
        )
        .expect("build tx1 with SenderFvk");

        // 4. Build Transaction 2 with OvkPolicy::None
        println!("  Building transaction 2 with OvkPolicy::None...");
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
        let tx2_ovk_none = build_and_prove_v6_ironwood_tx(
            orchard_sk_sender,
            vec![spend2],
            vec![out_recipient_no_ovk, out_change2],
            &config2,
            pk,
        )
        .expect("build tx2 with OvkPolicy::None");

        TestFixture {
            ufvk_sender_str,
            ufvk_recipient_str,
            ufvk_stranger_str,
            expected_recipient_ua,
            tx1_sender_fvk,
            tx2_ovk_none,
        }
    })
}

#[test]
fn test_sender_ovk_recovers_outgoing_and_internal_change() {
    let f = get_fixture();
    let dec = internal_decrypt_transaction(&f.ufvk_sender_str, "regtest", &f.tx1_sender_fvk.raw_bytes, 100)
        .expect("decrypt with sender UFVK");

    assert_eq!(dec.txid, f.tx1_sender_fvk.txid.to_string());
    assert_eq!(dec.fee, Some(10_000));
    assert_eq!(dec.expiry_height, 141);
    assert_eq!(dec.consensus_branch_id, "37a5165b");

    // Recover outgoing payment to recipient
    assert_eq!(dec.outgoing.len(), 1, "Sender must recover exactly 1 outgoing output");
    let out0 = &dec.outgoing[0];
    assert_eq!(out0.value, 600_000);
    assert_eq!(out0.recipient, f.expected_recipient_ua);
    assert_eq!(out0.memo.text, Some(TEST_MEMO_TEXT.to_string()));
    assert_eq!(out0.memo.hex, hex::encode(TEST_MEMO_TEXT));

    // Recover internal change note
    assert_eq!(dec.incoming.len(), 1, "Sender must recover exactly 1 incoming (internal change) note");
    let in0 = &dec.incoming[0];
    assert_eq!(in0.value, 390_000);
    assert!(in0.is_change, "Internal note must have is_change == true");
    assert!(in0.is_internal, "Internal note must have is_internal == true");
}

#[test]
fn test_recipient_ivk_decrypts_incoming_note_and_memo() {
    let f = get_fixture();
    let dec = internal_decrypt_transaction(&f.ufvk_recipient_str, "regtest", &f.tx1_sender_fvk.raw_bytes, 100)
        .expect("decrypt with recipient UFVK");

    assert_eq!(dec.txid, f.tx1_sender_fvk.txid.to_string());
    assert_eq!(dec.incoming.len(), 1, "Recipient must decrypt exactly 1 incoming note");
    let rec_in = &dec.incoming[0];
    assert_eq!(rec_in.value, 600_000);
    assert_eq!(rec_in.recipient, f.expected_recipient_ua);
    assert_eq!(rec_in.memo.text, Some(TEST_MEMO_TEXT.to_string()));
    assert_eq!(rec_in.memo.hex, hex::encode(TEST_MEMO_TEXT));
    assert!(!rec_in.is_change, "Recipient payment note must have is_change == false");
    assert!(!rec_in.is_internal, "Recipient payment note must have is_internal == false");
    assert!(dec.outgoing.is_empty(), "Recipient UFVK must see 0 outgoing notes");
}

#[test]
fn test_stranger_sees_nothing() {
    let f = get_fixture();
    let dec = internal_decrypt_transaction(&f.ufvk_stranger_str, "regtest", &f.tx1_sender_fvk.raw_bytes, 100)
        .expect("decrypt with stranger UFVK");

    assert_eq!(dec.txid, f.tx1_sender_fvk.txid.to_string());
    assert!(dec.incoming.is_empty(), "Stranger must see 0 incoming notes");
    assert!(dec.outgoing.is_empty(), "Stranger must see 0 outgoing notes");
}

#[test]
fn test_ovk_policy_none_prevents_sender_recovery() {
    let f = get_fixture();
    let dec_sender = internal_decrypt_transaction(&f.ufvk_sender_str, "regtest", &f.tx2_ovk_none.raw_bytes, 100)
        .expect("decrypt sender with OvkPolicy::None");

    assert!(
        dec_sender.outgoing.is_empty(),
        "With OvkPolicy::None, sender must recover zero outgoing notes"
    );
    assert_eq!(
        dec_sender.incoming.len(),
        1,
        "Sender still recovers its own change note via internal IVK"
    );

    // Recipient still decrypts incoming note even when sender opted out of OVK recovery
    let dec_rec = internal_decrypt_transaction(&f.ufvk_recipient_str, "regtest", &f.tx2_ovk_none.raw_bytes, 100)
        .expect("recipient decrypt tx with OvkPolicy::None");
    assert_eq!(dec_rec.incoming.len(), 1, "Recipient still decrypts incoming note with IVK");
    assert_eq!(dec_rec.incoming[0].value, 600_000);
}

#[test]
fn test_decrypt_transaction_fee_ironwood_only() {
    let f = get_fixture();
    let dec = internal_decrypt_transaction(&f.ufvk_sender_str, "regtest", &f.tx1_sender_fvk.raw_bytes, 100)
        .expect("decrypt transaction");

    // Net fee must be exactly Some(10_000), never null or 0
    assert_eq!(dec.fee, Some(10_000), "Pure Ironwood transaction fee must equal 10,000 zatoshis");
}

#[test]
fn test_decrypt_transaction_fee_with_transparent_part() {
    let f = get_fixture();

    // 1. Transaction with transparent INPUT:
    // Because transparent inputs only reference previous outpoints without recording their
    // amounts inside the raw transaction bytes, the fee cannot be computed without external
    // prevout lookups. The fee MUST be returned as None (null in JS), NEVER silently 0!
    let cursor = std::io::Cursor::new(&f.tx1_sender_fvk.raw_bytes);
    let orig_tx = zcash_primitives::transaction::Transaction::read(cursor, BranchId::Nu6_3).expect("read tx");

    let tx_in = TxIn::from_parts(OutPoint::new([1u8; 32], 0), Script::default(), 0xffffffff);
    let transparent_bundle_with_input = TransparentBundle {
        vin: vec![tx_in],
        vout: vec![],
        authorization: TransparentAuth,
    };

    let iw_bundle = orig_tx.ironwood_bundle().cloned().expect("ironwood bundle");
    let tx_data: TransactionData<Authorized> = TransactionData::from_parts_v6(
        BranchId::Nu6_3,
        0,
        BlockHeight::from_u32(141),
        Some(transparent_bundle_with_input),
        None,
        None,
        Some(iw_bundle.clone()),
    );
    let tx_frozen = tx_data.freeze().expect("freeze tx with transparent input");
    let mut raw_bytes_with_t_in = Vec::new();
    tx_frozen.write(&mut raw_bytes_with_t_in).expect("write tx");

    let dec_incomputable = internal_decrypt_transaction(&f.ufvk_sender_str, "regtest", &raw_bytes_with_t_in, 100)
        .expect("decrypt tx with transparent input");

    assert!(
        dec_incomputable.fee.is_none(),
        "Fee must return None (null in JS) when transparent inputs prevent computing overall balance"
    );

    // 2. Transaction with transparent OUTPUT and NO transparent inputs:
    // (e.g. deshielding from Ironwood pool to transparent address).
    // The transparent output amount is known (e.g. 5,000 zat).
    // Net Ironwood bundle balance = 10,000 + 5,000 = 15,000 zat.
    // Transparent balance = -5,000 zat.
    // Overall fee = 15,000 - 5,000 = 10,000 zat.
    // Fee is fully computable!
    let tx_out = TxOut::new(
        Zatoshis::from_u64(5_000).expect("valid zat"),
        Script::default(),
    );
    let transparent_bundle_output_only = TransparentBundle {
        vin: vec![],
        vout: vec![tx_out],
        authorization: TransparentAuth,
    };

    // Re-map ironwood bundle value balance to 15,000 zat
    let iw_bundle_mapped = iw_bundle
        .try_map_value_balance(|_| ZatBalance::from_i64(15_000))
        .expect("map value balance");

    let tx_data_t_out: TransactionData<Authorized> = TransactionData::from_parts_v6(
        BranchId::Nu6_3,
        0,
        BlockHeight::from_u32(141),
        Some(transparent_bundle_output_only),
        None,
        None,
        Some(iw_bundle_mapped),
    );
    let tx_frozen_t_out = tx_data_t_out.freeze().expect("freeze tx with transparent output");
    let mut raw_bytes_with_t_out = Vec::new();
    tx_frozen_t_out.write(&mut raw_bytes_with_t_out).expect("write tx");

    let dec_computable = internal_decrypt_transaction(&f.ufvk_sender_str, "regtest", &raw_bytes_with_t_out, 100)
        .expect("decrypt tx with transparent output");

    assert_eq!(
        dec_computable.fee,
        Some(10_000),
        "Fee must be computed as sum of transparent output (-5000) and Ironwood balance (+15000) = 10000"
    );
}
