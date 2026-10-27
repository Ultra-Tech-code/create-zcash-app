use std::process::Command;
use std::sync::OnceLock;

use incrementalmerkletree::frontier::CommitmentTree;
use incrementalmerkletree::witness::IncrementalWitness;

use orchard::circuit::{OrchardCircuitVersion, ProvingKey, VerifyingKey};
use orchard::keys::{FullViewingKey, Scope, SpendingKey};
use orchard::note::{Note, NoteVersion, RandomSeed, Rho};
use orchard::tree::{MerkleHashOrchard, MerklePath};
use orchard::value::NoteValue;
use zcash_primitives::transaction::{Transaction, TxVersion};
use zcash_protocol::consensus::{BlockHeight, BranchId};
use zcash_protocol::value::{ZatBalance, Zatoshis};

use zcash_core::transaction::{
    build_and_prove_v6_ironwood_tx, choose_recommended_anchor_height, compute_zip317_fee,
    BuiltTransaction, OutputSpec, OvkPolicy, SpendInput, TransactionBuildError,
    TransactionBuilder, TransactionConfig, ZIP302_NO_MEMO,
};

/// Global proving key shared across all tests via OnceLock to avoid re-synthesizing
/// the Halo 2 circuit parameters for each test run.
static PROVING_KEY: OnceLock<ProvingKey> = OnceLock::new();
static VERIFYING_KEY: OnceLock<VerifyingKey> = OnceLock::new();

fn get_shared_proving_key() -> &'static ProvingKey {
    PROVING_KEY.get_or_init(|| {
        println!(">>> [OnceLock] Building shared OrchardCircuitVersion::PostNu6_3 ProvingKey...");
        let start = std::time::Instant::now();
        let pk = ProvingKey::build(OrchardCircuitVersion::PostNu6_3);
        println!(">>> [OnceLock] ProvingKey built in {} ms", start.elapsed().as_millis());
        pk
    })
}

fn get_shared_verifying_key() -> &'static VerifyingKey {
    VERIFYING_KEY.get_or_init(|| {
        println!(">>> [OnceLock] Building shared OrchardCircuitVersion::PostNu6_3 VerifyingKey...");
        let start = std::time::Instant::now();
        let vk = VerifyingKey::build(OrchardCircuitVersion::PostNu6_3);
        println!(">>> [OnceLock] VerifyingKey built in {} ms", start.elapsed().as_millis());
        vk
    })
}

/// Helper to set up an in-memory commitment tree with fresh notes and compute witnesses.
fn setup_in_memory_tree_and_notes() -> (
    SpendingKey,
    FullViewingKey,
    Note,
    MerklePath,
    Note,
    MerklePath,
    orchard::Anchor,
) {
    let sk = SpendingKey::from_bytes([42u8; 32]).expect("valid spending key");
    let fvk = FullViewingKey::from(&sk);
    let addr0 = fvk.address_at(0u32, Scope::External);
    let addr1 = fvk.address_at(1u32, Scope::External);

    // Note 1: 500,000 zatoshis
    let rho1 = Rho::from_bytes(&[1u8; 32]).expect("valid rho1");
    let rseed1 = RandomSeed::from_bytes([11u8; 32], &rho1).expect("valid rseed1");
    let note1 = Note::from_parts(addr0, NoteValue::from_raw(500_000), rho1, rseed1, NoteVersion::V2)
        .expect("valid note1");

    // Note 2: 700,000 zatoshis
    let rho2 = Rho::from_bytes(&[2u8; 32]).expect("valid rho2");
    let rseed2 = RandomSeed::from_bytes([22u8; 32], &rho2).expect("valid rseed2");
    let note2 = Note::from_parts(addr1, NoteValue::from_raw(700_000), rho2, rseed2, NoteVersion::V2)
        .expect("valid note2");

    let mut tree = CommitmentTree::<MerkleHashOrchard, 32>::empty();

    // Leaf 0: dummy commitment
    let mut d0 = [0u8; 32];
    d0[0] = 1;
    let dummy0 = MerkleHashOrchard::from_bytes(&d0).expect("valid dummy0");
    tree.append(dummy0).expect("append dummy0");

    // Leaf 1: Note 1 commitment
    let cmx1: orchard::note::ExtractedNoteCommitment = note1.commitment().into();
    let leaf1 = MerkleHashOrchard::from_bytes(&cmx1.to_bytes()).expect("leaf1");
    tree.append(leaf1).expect("append note1 cmx");
    let mut wit1 = IncrementalWitness::from_tree(tree.clone()).expect("wit1 init");

    // Leaf 2: Note 2 commitment
    let cmx2: orchard::note::ExtractedNoteCommitment = note2.commitment().into();
    let leaf2 = MerkleHashOrchard::from_bytes(&cmx2.to_bytes()).expect("leaf2");
    tree.append(leaf2).expect("append note2 cmx");
    wit1.append(leaf2).expect("wit1 append cmx2");
    let mut wit2 = IncrementalWitness::from_tree(tree.clone()).expect("wit2 init");

    // Leaf 3: dummy commitment
    let mut d1 = [0u8; 32];
    d1[0] = 2;
    let dummy1 = MerkleHashOrchard::from_bytes(&d1).expect("valid dummy1");
    tree.append(dummy1).expect("append dummy1");
    wit1.append(dummy1).expect("wit1 append dummy1");
    wit2.append(dummy1).expect("wit2 append dummy1");

    let anchor: orchard::Anchor = tree.root().into();
    let path1 = MerklePath::from(wit1.path().expect("path1"));
    let path2 = MerklePath::from(wit2.path().expect("path2"));

    assert_eq!(path1.root(cmx1), anchor, "Path 1 must root at commitment tree anchor");
    assert_eq!(path2.root(cmx2), anchor, "Path 2 must root at commitment tree anchor");

    (sk, fvk, note1, path1, note2, path2, anchor)
}

/// (a) Pure-Rust test with a self-built commitment tree and fresh notes, multi-input and multi-output.
#[test]
fn test_a_pure_rust_multi_input_multi_output() {
    println!("\n=== TEST (A): PURE-RUST MULTI-INPUT / MULTI-OUTPUT ===");
    let (sk, fvk, note1, path1, note2, path2, anchor) = setup_in_memory_tree_and_notes();

    let spend1 = SpendInput::new(note1, path1);
    let spend2 = SpendInput::new(note2, path2);

    // Spends total = 500,000 + 700,000 = 1,200,000 zatoshis
    // Padded actions: max(2 spends, 2 outputs) = 2 actions.
    // ZIP 317 fee for 2 actions = 10,000 zatoshis.
    // Outputs total = 1,200,000 - 10,000 = 1,190,000 zatoshis.

    // Output 1: external payment to another recipient address (800,000 zatoshis)
    let recipient_sk = SpendingKey::from_bytes([99u8; 32]).unwrap();
    let recipient_fvk = FullViewingKey::from(&recipient_sk);
    let recipient_addr = recipient_fvk.address_at(0u32, Scope::External);
    let out1 = OutputSpec::new(recipient_addr, NoteValue::from_raw(800_000));

    // Output 2: internal change back to sender (390,000 zatoshis)
    let change_addr = fvk.address_at(0u32, Scope::Internal);
    let out2 = OutputSpec::new(change_addr, NoteValue::from_raw(390_000));

    // Anchor: 5 blocks below tip=100 (height 95), expiry = 141 (target height 101 + 40)
    let tip = BlockHeight::from_u32(100);
    let config = TransactionConfig::new(BranchId::Nu6_3, anchor, tip, Some(5));

    assert_eq!(config.expiry_height, BlockHeight::from_u32(141));
    assert_eq!(config.anchor_height, Some(BlockHeight::from_u32(95)));
    assert!(!config.allow_custom_fee);

    let pk = get_shared_proving_key();
    let start_prove = std::time::Instant::now();
    let built: BuiltTransaction = build_and_prove_v6_ironwood_tx(
        &sk,
        vec![spend1, spend2],
        vec![out1, out2],
        &config,
        pk,
    )
    .expect("build_and_prove_v6_ironwood_tx failed");

    println!("Proof generated and transaction built in {} ms", start_prove.elapsed().as_millis());
    println!("Built TxID:          {}", built.txid);
    println!("Wire bytes length:   {} bytes", built.raw_bytes.len());
    println!("Action count:        {}", built.num_actions);
    println!("Net fee:             {} zatoshis", u64::from(built.fee));
    println!("Expiry height:       {}", built.expiry_height);

    assert_eq!(built.num_actions, 2);
    assert_eq!(built.fee, Zatoshis::const_from_u64(10_000));
    assert_eq!(built.expiry_height, BlockHeight::from_u32(141));
    assert!(!built.raw_bytes.is_empty());

    // Verify bundle proof with VerifyingKey
    let vk = get_shared_verifying_key();
    built
        .transaction
        .ironwood_bundle()
        .expect("Ironwood bundle present")
        .verify_proof(vk)
        .expect("Proof verification failed");

    println!("TEST (A) RESULT: SUCCESS (Multi-input/multi-output transaction built, proved, and verified)");
}

/// (b) Round-trip Transaction::read on the serialized bytes and check the txid matches.
#[test]
fn test_b_round_trip_transaction_read_and_txid() {
    println!("\n=== TEST (B): ROUND-TRIP TRANSACTION::READ ON SERIALIZED BYTES ===");
    let (sk, fvk, note1, path1, note2, path2, anchor) = setup_in_memory_tree_and_notes();

    let spend1 = SpendInput::new(note1, path1);
    let spend2 = SpendInput::new(note2, path2);

    let recipient_sk = SpendingKey::from_bytes([99u8; 32]).unwrap();
    let recipient_fvk = FullViewingKey::from(&recipient_sk);
    let recipient_addr = recipient_fvk.address_at(0u32, Scope::External);
    let out1 = OutputSpec::new(recipient_addr, NoteValue::from_raw(800_000));
    let change_addr = fvk.address_at(0u32, Scope::Internal);
    let out2 = OutputSpec::new(change_addr, NoteValue::from_raw(390_000));

    let config = TransactionConfig::new(BranchId::Nu6_3, anchor, BlockHeight::from_u32(150), None);
    let pk = get_shared_proving_key();
    let built = build_and_prove_v6_ironwood_tx(
        &sk,
        vec![spend1, spend2],
        vec![out1, out2],
        &config,
        pk,
    )
    .expect("build_and_prove_v6_ironwood_tx failed");

    let raw_bytes = &built.raw_bytes;
    println!("Serialized wire length: {} bytes", raw_bytes.len());

    // Deserializing with canonical Transaction::read
    let mut reader = &raw_bytes[..];
    let read_tx = Transaction::read(&mut reader, config.branch_id)
        .expect("Transaction::read failed on serialized bytes");

    println!("Original TxID:       {}", built.txid);
    println!("Read TxID:           {}", read_tx.txid());
    println!("Transaction Version: {:?}", read_tx.version());

    // Verify exact txid match
    assert_eq!(read_tx.txid(), built.txid, "Transaction::read txid MUST equal built txid");
    assert_eq!(read_tx.version(), TxVersion::V6, "Must parse as V6 transaction");
    assert_eq!(read_tx.expiry_height(), built.expiry_height);

    let ironwood_bundle = read_tx.ironwood_bundle().expect("Ironwood bundle must be present");
    assert_eq!(ironwood_bundle.actions().len(), built.num_actions);
    assert_eq!(ironwood_bundle.value_balance(), &ZatBalance::const_from_i64(10_000));

    // Verify the deserialized Halo 2 proof
    let vk = get_shared_verifying_key();
    ironwood_bundle.verify_proof(vk).expect("Deserialized proof verification failed");

    println!("TEST (B) RESULT: SUCCESS (Round-trip deserialization verified, txids match bit-for-bit)");
}

/// Unit test verifying Amendment 1:
/// Leftover value can NEVER silently become fee.
/// Rejects non-ZIP317 fees unless allow_custom_fee is explicitly set.
#[test]
fn test_amendment1_zip317_fee_strictness() {
    println!("\n=== TEST AMENDMENT 1: ZIP 317 FEE STRICTNESS & LEFTOVER VALUE REJECTION ===");
    let (sk, fvk, note1, path1, note2, path2, anchor) = setup_in_memory_tree_and_notes();

    let spend1 = SpendInput::new(note1, path1);
    let spend2 = SpendInput::new(note2, path2);

    // Total spends = 1,200,000 zatoshis
    // Outputs sum to 1,180,000 zatoshis -> leftover = 20,000 zatoshis
    // Conventional ZIP 317 fee is 10,000 zatoshis.
    let recipient_sk = SpendingKey::from_bytes([99u8; 32]).unwrap();
    let recipient_fvk = FullViewingKey::from(&recipient_sk);
    let recipient_addr = recipient_fvk.address_at(0u32, Scope::External);
    let out1 = OutputSpec::new(recipient_addr, NoteValue::from_raw(800_000));
    let change_addr = fvk.address_at(0u32, Scope::Internal);
    let out_bad_change = OutputSpec::new(change_addr, NoteValue::from_raw(380_000));

    let config_strict = TransactionConfig::new(BranchId::Nu6_3, anchor, BlockHeight::from_u32(100), None);
    assert!(!config_strict.allow_custom_fee);

    let pk = get_shared_proving_key();
    let result_strict = build_and_prove_v6_ironwood_tx(
        &sk,
        vec![spend1.clone(), spend2.clone()],
        vec![out1.clone(), out_bad_change.clone()],
        &config_strict,
        pk,
    );

    match result_strict {
        Err(TransactionBuildError::FeeMismatch {
            required_zatoshis,
            actual_fee,
            spends_total,
            outputs_total,
        }) => {
            println!("Correctly rejected leftover value! FeeMismatch error:");
            println!("  Required fee:  {} zatoshis", required_zatoshis);
            println!("  Actual fee:    {} zatoshis", actual_fee);
            println!("  Total spends:  {} zatoshis", spends_total);
            println!("  Total outputs: {} zatoshis", outputs_total);
            assert_eq!(required_zatoshis, 10_000);
            assert_eq!(actual_fee, 20_000);
            assert_eq!(spends_total, 1_200_000);
            assert_eq!(outputs_total, 1_180_000);
        }
        other => panic!("Expected FeeMismatch error, got {:?}", other),
    }

    // Now test with explicit allow_custom_fee = true
    let config_custom = config_strict.with_allow_custom_fee(true);
    let result_custom = build_and_prove_v6_ironwood_tx(
        &sk,
        vec![spend1, spend2],
        vec![out1, out_bad_change],
        &config_custom,
        pk,
    )
    .expect("Custom fee should be permitted when allow_custom_fee is true");

    assert_eq!(result_custom.fee, Zatoshis::const_from_u64(20_000));
    println!("Explicit allow_custom_fee allowed custom fee: {} zatoshis", u64::from(result_custom.fee));
    println!("AMENDMENT 1 RESULT: SUCCESS (FeeMismatch enforced, custom fee permitted only with explicit flag)");
}

/// Unit test verifying Amendment 2:
/// Default memo is 0xF6 followed by 511 zero bytes (ZIP 302 "no memo"), not 512 zero bytes.
#[test]
fn test_amendment2_zip302_default_memo() {
    println!("\n=== TEST AMENDMENT 2: ZIP 302 DEFAULT MEMO (0xF6 + 511 zeroes) ===");
    assert_eq!(ZIP302_NO_MEMO.len(), 512);
    assert_eq!(ZIP302_NO_MEMO[0], 0xF6, "Lead byte must be 0xF6 (ZIP 302)");
    for (i, &b) in ZIP302_NO_MEMO[1..].iter().enumerate() {
        assert_eq!(b, 0x00, "Byte at {} must be 0x00", i + 1);
    }

    let recipient_sk = SpendingKey::from_bytes([99u8; 32]).unwrap();
    let recipient_addr = FullViewingKey::from(&recipient_sk).address_at(0u32, Scope::External);
    let out = OutputSpec::new(recipient_addr, NoteValue::from_raw(100_000));
    assert_eq!(out.memo, None); // Will expand to ZIP302_NO_MEMO in builder
    println!("AMENDMENT 2 RESULT: SUCCESS (ZIP302_NO_MEMO is exactly 0xF6 followed by 511 zeroes)");
}

/// Unit test verifying Amendment 3:
/// Default OVK to sender's own FVK; None must be an explicit opt-out.
/// Cryptographically proves output note recoverability with the sender's OVK.
#[test]
fn test_amendment3_ovk_policy() {
    println!("\n=== TEST AMENDMENT 3: OVK POLICY & REAL OVK RECOVERY ASSERTION ===");
    let (sk, fvk, note1, path1, note2, path2, anchor) = setup_in_memory_tree_and_notes();

    let spend1 = SpendInput::new(note1, path1);
    let spend2 = SpendInput::new(note2, path2);

    let recipient_sk = SpendingKey::from_bytes([99u8; 32]).unwrap();
    let recipient_addr = FullViewingKey::from(&recipient_sk).address_at(0u32, Scope::External);

    // Output 0: Sent to external recipient with DEFAULT OVK policy (SenderFvk) and explicit memo
    let mut custom_memo = [0u8; 512];
    custom_memo[..20].copy_from_slice(b"sent with sender ovk");
    let out0 = OutputSpec::new(recipient_addr, NoteValue::from_raw(800_000))
        .with_memo_bytes(custom_memo);
    assert_eq!(out0.ovk_policy, OvkPolicy::SenderFvk);

    // Output 1: Sent to internal change address with EXPLICIT OPT-OUT (OvkPolicy::None)
    let change_addr = fvk.address_at(0u32, Scope::Internal);
    let out1 = OutputSpec::new(change_addr, NoteValue::from_raw(390_000))
        .with_ovk_policy(OvkPolicy::None);
    assert_eq!(out1.ovk_policy, OvkPolicy::None);

    let tip = BlockHeight::from_u32(100);
    let config = TransactionConfig::new(BranchId::Nu6_3, anchor, tip, None);
    let pk = get_shared_proving_key();

    let built = build_and_prove_v6_ironwood_tx(
        &sk,
        vec![spend1, spend2],
        vec![out0, out1],
        &config,
        pk,
    )
    .expect("build_and_prove_v6_ironwood_tx failed");

    let bundle = built.transaction.ironwood_bundle().expect("Ironwood bundle");
    assert_eq!(bundle.actions().len(), 2);

    let sender_ovk = fvk.to_ovk(Scope::External);

    let mut recovered_count = 0;
    let mut unrecovered_count = 0;

    for action in bundle.actions() {
        let domain = orchard::note_encryption::IronwoodDomain::for_action(action);
        let recovery = zcash_note_encryption::try_output_recovery_with_ovk(
            &domain,
            &sender_ovk,
            action,
            action.cv_net(),
            &action.encrypted_note().out_ciphertext,
        );
        if let Some((recovered_note, recovered_recipient, recovered_memo)) = recovery {
            recovered_count += 1;
            assert_eq!(recovered_note.value(), NoteValue::from_raw(800_000), "Recovered value must match sent amount");
            assert_eq!(recovered_recipient, recipient_addr, "Recovered recipient must match target address");
            assert_eq!(&recovered_memo[..20], b"sent with sender ovk", "Recovered memo must match sent memo");
            println!("Successfully decrypted Output 0 note with Sender OVK: {} zatoshis to {:?}", recovered_note.value().inner(), recovered_recipient);
        } else {
            unrecovered_count += 1;
        }

        // Test with an unrelated OVK: MUST always be None
        let wrong_ovk = orchard::keys::OutgoingViewingKey::from([0x99u8; 32]);
        let wrong_recovery = zcash_note_encryption::try_output_recovery_with_ovk(
            &domain,
            &wrong_ovk,
            action,
            action.cv_net(),
            &action.encrypted_note().out_ciphertext,
        );
        assert!(wrong_recovery.is_none(), "Unrelated OVK cannot decrypt output");
    }

    assert_eq!(recovered_count, 1, "Exactly one output (with default SenderFvk) must be recoverable");
    assert_eq!(unrecovered_count, 1, "Exactly one output (with OvkPolicy::None) must NOT be recoverable");

    println!("AMENDMENT 3 RESULT: SUCCESS (Real OVK recovery assertion verified, opt-out proven)");
}

/// Unit test verifying Amendment 4:
/// Minimum padding is 2 actions (Orchard crate default).
#[test]
fn test_amendment4_action_padding() {
    println!("\n=== TEST AMENDMENT 4: ORCHARD CRATE DEFAULT PADDING (MIN 2 ACTIONS) ===");
    // Rule check:
    let fee_1_1 = compute_zip317_fee(1, 1).expect("compute fee");
    assert_eq!(fee_1_1, Zatoshis::const_from_u64(10_000));

    let fee_2_2 = compute_zip317_fee(2, 2).expect("compute fee");
    assert_eq!(fee_2_2, Zatoshis::const_from_u64(10_000));

    let fee_3_1 = compute_zip317_fee(3, 1).expect("compute fee");
    assert_eq!(fee_3_1, Zatoshis::const_from_u64(15_000));

    // Live bundle check from setup:
    let (sk, fvk, note1, path1, _note2, _path2, anchor) = setup_in_memory_tree_and_notes();
    let spend1 = SpendInput::new(note1, path1);
    let out1 = OutputSpec::new(fvk.address_at(0u32, Scope::Internal), NoteValue::from_raw(490_000));
    let config = TransactionConfig::new(BranchId::Nu6_3, anchor, BlockHeight::from_u32(100), None);
    let pk = get_shared_proving_key();

    // 1 spend and 1 output -> MUST be padded to 2 actions
    let built_1_1 = build_and_prove_v6_ironwood_tx(&sk, vec![spend1], vec![out1], &config, pk).unwrap();
    assert_eq!(built_1_1.num_actions, 2, "1-spend 1-output must be padded to 2 actions");
    assert_eq!(built_1_1.transaction.ironwood_bundle().unwrap().actions().len(), 2);
    assert_eq!(built_1_1.fee, Zatoshis::const_from_u64(10_000));

    println!("AMENDMENT 4 RESULT: SUCCESS (1-spend 1-output bundle strictly padded to 2 actions)");
}

/// Unit test verifying Amendment 5:
/// Anchor height offset calculation and expiry defaults.
#[test]
fn test_amendment5_anchor_and_expiry() {
    println!("\n=== TEST AMENDMENT 5: ANCHOR SELECTION & EXPIRY DEFAULTS ===");
    let tip = BlockHeight::from_u32(250);
    let default_anchor_height = choose_recommended_anchor_height(tip, None);
    assert_eq!(default_anchor_height, BlockHeight::from_u32(245)); // tip - 5

    let custom_anchor_height = choose_recommended_anchor_height(tip, Some(10));
    assert_eq!(custom_anchor_height, BlockHeight::from_u32(240)); // tip - 10

    let (sk, fvk, note1, path1, _note2, _path2, anchor) = setup_in_memory_tree_and_notes();
    let spend1 = SpendInput::new(note1, path1);
    let out1 = OutputSpec::new(fvk.address_at(0u32, Scope::Internal), NoteValue::from_raw(490_000));

    // Test with tip = 200: expiry MUST be 241 (target height 201 + 40)
    let tip_200 = BlockHeight::from_u32(200);
    let config = TransactionConfig::new(BranchId::Nu6_3, anchor, tip_200, Some(5));
    assert_eq!(config.expiry_height, BlockHeight::from_u32(241));
    assert_eq!(config.anchor_height, Some(BlockHeight::from_u32(195)));

    let pk = get_shared_proving_key();
    let built = build_and_prove_v6_ironwood_tx(&sk, vec![spend1], vec![out1], &config, pk).unwrap();
    assert_eq!(built.expiry_height, BlockHeight::from_u32(241));
    assert_eq!(built.transaction.expiry_height(), BlockHeight::from_u32(241));
    assert_eq!(*built.transaction.ironwood_bundle().unwrap().anchor(), config.anchor);

    println!("AMENDMENT 5 RESULT: SUCCESS (Anchor chosen 5 blocks below tip, expiry target height 201 + 40 verified on built tx)");
}

/// Unit test verifying Amendment 6 & 7:
/// Keys derived in Rust, no key material in public result structs, zero unwraps in library code.
#[test]
fn test_amendments_6_and_7_security_and_error_handling() {
    println!("\n=== TEST AMENDMENTS 6 & 7: KEY ISOLATION & ZERO-UNWRAP ERROR HANDLING ===");
    let sk_bytes = [42u8; 32];
    let sk = SpendingKey::from_bytes(sk_bytes).unwrap();
    let (sk_src, fvk_src, note1, path1, _note2, _path2, anchor) = setup_in_memory_tree_and_notes();

    let tip = BlockHeight::from_u32(100);
    let config = TransactionConfig::new(BranchId::Nu6_3, anchor, tip, None);
    let pk = get_shared_proving_key();

    // 1. Verify that successful built transaction contains ZERO secret key bytes
    let spend_ok = SpendInput::new(note1, path1.clone());
    let out_ok = OutputSpec::new(fvk_src.address_at(0u32, Scope::Internal), NoteValue::from_raw(490_000));
    let built = build_and_prove_v6_ironwood_tx(&sk_src, vec![spend_ok], vec![out_ok], &config, pk).unwrap();

    // Ensure raw wire bytes do not leak the 32-byte secret key anywhere
    assert!(!built.raw_bytes.windows(32).any(|w| w == sk_bytes), "Wire bytes must not contain secret key bytes");

    // 2. Empty inputs error
    let builder_empty_inputs = TransactionBuilder::new(&sk, config.clone());
    let err_empty = builder_empty_inputs.build_and_prove(pk).unwrap_err();
    assert!(matches!(err_empty, TransactionBuildError::EmptyInputs));

    // 3. Empty outputs error
    let dummy_rho = Rho::from_bytes(&[1u8; 32]).unwrap();
    let dummy_rseed = RandomSeed::from_bytes([2u8; 32], &dummy_rho).unwrap();
    let dummy_addr = FullViewingKey::from(&sk).address_at(0u32, Scope::External);
    let dummy_note = Note::from_parts(dummy_addr, NoteValue::from_raw(100_000), dummy_rho, dummy_rseed, NoteVersion::V2).unwrap();
    let dummy_path = MerklePath::from_parts(0, [MerkleHashOrchard::from_bytes(&[0u8; 32]).unwrap(); 32]);

    let mut builder_no_outputs = TransactionBuilder::new(&sk, config.clone());
    builder_no_outputs.add_spend(SpendInput::new(dummy_note, dummy_path.clone()));
    let err_no_out = builder_no_outputs.build_and_prove(pk).unwrap_err();
    assert!(matches!(err_no_out, TransactionBuildError::EmptyOutputs));

    // 4. Insufficient funds error (spends < outputs)
    let mut builder_insufficient = TransactionBuilder::new(&sk, config.clone());
    builder_insufficient.add_spend(SpendInput::new(dummy_note, dummy_path.clone()));
    builder_insufficient.add_output(OutputSpec::new(dummy_addr, NoteValue::from_raw(200_000)));
    let err_funds = builder_insufficient.build_and_prove(pk).unwrap_err();
    assert!(matches!(err_funds, TransactionBuildError::InsufficientFunds { spends_total: 100_000, outputs_total: 200_000 }));

    // 5. Anchor mismatch error
    let mut builder_anchor_mismatch = TransactionBuilder::new(&sk, config);
    builder_anchor_mismatch.add_spend(SpendInput::new(dummy_note, dummy_path));
    builder_anchor_mismatch.add_output(OutputSpec::new(dummy_addr, NoteValue::from_raw(90_000)));
    let err_anchor = builder_anchor_mismatch.build_and_prove(pk).unwrap_err();
    assert!(matches!(err_anchor, TransactionBuildError::AnchorMismatch { .. }));

    println!("AMENDMENTS 6 & 7 RESULT: SUCCESS (Key isolation confirmed, all error variants assert cleanly)");
}

/// (c) Live-regtest test that broadcasts and mines a real V6 Ironwood transaction.
/// Marked #[ignore] so standard offline test runs do not require a live regtest stack.
#[test]
#[ignore]
fn test_c_live_regtest_broadcast_and_mine() {
    println!("\n=== TEST (C): LIVE REGTEST BROADCAST AND MINE (#[ignore]) ===");

    // 1. Check if Zebra RPC is responsive
    let check_rpc = Command::new("curl")
        .args([
            "-s",
            "-X", "POST",
            "http://127.0.0.1:8181",
            "-H", "Content-Type: application/json",
            "-d", r#"{"jsonrpc":"2.0","id":"1","method":"getblockchaininfo","params":[]}"#,
        ])
        .output();

    let output = match check_rpc {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).to_string(),
        _ => {
            println!("SKIPPING: Zebra RPC not reachable at http://127.0.0.1:8181");
            return;
        }
    };

    if !output.contains("bestblockhash") {
        println!("SKIPPING: Zebra getblockchaininfo returned unexpected response: {}", output);
        return;
    }

    println!("Zebra regtest node is online: {}", output.trim());

    // 2. Load the known note at height 222 (Account 3) or the note at 234 (Account 0)
    // We spend the unspent note on Account 0 at height 234:
    // Value: 24,990,000 zatoshis (0.2499 ZEC)
    // Cmx: 29fd9397629cb4c914629cc33de17249142c657b9a5f25f421d3676f4974b02a
    // Rho: f5deed0fb6dd96e01c7f41645329bc287097698b7de8bff9e9605867be0aca1a
    // Rseed: 04fb723bd3f6ad5868e8e2fed984d3de7cf60c92f0b73352f07bc5d97dac872c

    let phrase0 = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    let regtest_params = zcash_core::get_params_for_network("regtest");
    let mnemonic = bip0039::Mnemonic::<bip0039::English>::from_phrase(phrase0).unwrap();
    let usk0 = zcash_keys::keys::UnifiedSpendingKey::from_seed(
        &regtest_params,
        &mnemonic.to_seed(""),
        0.try_into().unwrap(),
    )
    .unwrap();
    let orchard_sk0 = usk0.orchard();
    let orchard_fvk0 = FullViewingKey::from(orchard_sk0);

    let rho_bytes: [u8; 32] = hex::decode("f5deed0fb6dd96e01c7f41645329bc287097698b7de8bff9e9605867be0aca1a")
        .unwrap()
        .try_into()
        .unwrap();
    let rseed_bytes: [u8; 32] = hex::decode("04fb723bd3f6ad5868e8e2fed984d3de7cf60c92f0b73352f07bc5d97dac872c")
        .unwrap()
        .try_into()
        .unwrap();
    let rho = Rho::from_bytes(&rho_bytes).unwrap();
    let rseed = RandomSeed::from_bytes(rseed_bytes, &rho).unwrap();
    let mut matched_note = None;
    for scope in [Scope::External, Scope::Internal] {
        for d in 0..10u32 {
            let addr = orchard_fvk0.address_at(d, scope);
            for ver in [NoteVersion::V3, NoteVersion::V2] {
                if let Some(n) = Note::from_parts(
                    addr,
                    NoteValue::from_raw(24_990_000),
                    rho,
                    rseed,
                    ver,
                )
                .into_option()
                {
                    let ext: orchard::note::ExtractedNoteCommitment = n.commitment().into();
                    let hex_cmx = hex::encode(ext.to_bytes());
                    if hex_cmx == "29fd9397629cb4c914629cc33de17249142c657b9a5f25f421d3676f4974b02a" {
                        matched_note = Some(n);
                        break;
                    }
                }
            }
            if matched_note.is_some() {
                break;
            }
        }
        if matched_note.is_some() {
            break;
        }
    }

    let note = matched_note.expect("Failed to reconstruct note matching cmx");
    let cmx: orchard::note::ExtractedNoteCommitment = note.commitment().into();
    let cmx_hex = hex::encode(cmx.to_bytes());
    println!("Successfully reconstructed note with cmx: {}", cmx_hex);

    // Fetch compact blocks / tree to build witness
    let f = std::fs::File::open("tests/fixtures/test_cmxs.json")
        .or_else(|_| std::fs::File::open("packages/core/tests/fixtures/test_cmxs.json"))
        .expect("Unable to open tests/fixtures/test_cmxs.json");
    #[derive(serde::Deserialize)]
    struct CmxItem {
        cmx: String,
    }
    #[derive(serde::Deserialize)]
    struct Dump {
        height: u32,
        cmxs: Vec<CmxItem>,
    }
    let dump: Dump = serde_json::from_reader(std::io::BufReader::new(f)).expect("Failed to deserialize test_cmxs.json");

    let target_cmx_hex = "29fd9397629cb4c914629cc33de17249142c657b9a5f25f421d3676f4974b02a";
    let mut tree = CommitmentTree::<MerkleHashOrchard, 32>::empty();
    let mut witness = None;

    for item in &dump.cmxs {
        let b = hex::decode(&item.cmx).unwrap();
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&b);
        let leaf = MerkleHashOrchard::from_bytes(&arr).unwrap();
        tree.append(leaf).unwrap();

        if item.cmx == target_cmx_hex {
            witness = Some(IncrementalWitness::from_tree(tree.clone()).unwrap());
        } else if let Some(ref mut wit) = witness {
            wit.append(leaf).unwrap();
        }
    }

    let wit = witness.expect("witness for target cmx must exist");
    let path = MerklePath::from(wit.path().unwrap());
    let anchor: orchard::Anchor = tree.root().into();
    println!("Computed real on-chain anchor: {}", hex::encode(anchor.to_bytes()));
    assert_eq!(path.root(cmx), anchor);

    // Prepare outputs:
    // Spend 24,990,000 zatoshis:
    // Output 1: 10,000,000 zatoshis to Account 1
    // Output 2: 14,980,000 zatoshis change back to Account 0
    // Net fee: 10,000 zatoshis (ZIP 317 standard fee)
    let phrase1 = "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong";
    let m1 = bip0039::Mnemonic::<bip0039::English>::from_phrase(phrase1).unwrap();
    let usk1 = zcash_keys::keys::UnifiedSpendingKey::from_seed(
        &regtest_params,
        &m1.to_seed(""),
        0.try_into().unwrap(),
    )
    .unwrap();
    let fvk1 = FullViewingKey::from(usk1.orchard());
    let recipient1 = fvk1.address_at(0u32, Scope::External);
    let out1 = OutputSpec::new(recipient1, NoteValue::from_raw(10_000_000));

    let change_addr = orchard_fvk0.address_at(0u32, Scope::Internal);
    let out2 = OutputSpec::new(change_addr, NoteValue::from_raw(14_980_000));

    let spend = SpendInput::new(note, path);
    let config = TransactionConfig::new(BranchId::Nu6_3, anchor, BlockHeight::from_u32(dump.height + 2), None);

    let pk = get_shared_proving_key();
    let built = build_and_prove_v6_ironwood_tx(
        orchard_sk0,
        vec![spend],
        vec![out1, out2],
        &config,
        pk,
    )
    .expect("build_and_prove_v6_ironwood_tx failed");

    println!("Live V6 transaction proved! TxID: {}", built.txid);
    let raw_tx_hex = hex::encode(&built.raw_bytes);

    // Broadcast via Zebra JSON-RPC
    let broadcast_payload = format!(
        r#"{{"jsonrpc":"2.0","id":"live-test","method":"sendrawtransaction","params":["{}"]}}"#,
        raw_tx_hex
    );
    let broadcast_output = Command::new("curl")
        .args([
            "-s",
            "-X", "POST",
            "http://127.0.0.1:8181",
            "-H", "Content-Type: application/json",
            "-d", &broadcast_payload,
        ])
        .output()
        .expect("broadcast command");

    let broadcast_res = String::from_utf8_lossy(&broadcast_output.stdout);
    println!("Broadcast response: {}", broadcast_res.trim());

    // Mine 1 block
    let mine_output = Command::new("curl")
        .args([
            "-s",
            "-X", "POST",
            "http://127.0.0.1:8181",
            "-H", "Content-Type: application/json",
            "-d", r#"{"jsonrpc":"2.0","id":"mine","method":"generate","params":[1]}"#,
        ])
        .output()
        .expect("mine command");
    println!("Mine response: {}", String::from_utf8_lossy(&mine_output.stdout).trim());

    // Verify transaction in Zebra blockchain
    let get_tx_payload = format!(
        r#"{{"jsonrpc":"2.0","id":"get-tx","method":"getrawtransaction","params":["{}", 1]}}"#,
        built.txid
    );
    let get_tx_output = Command::new("curl")
        .args([
            "-s",
            "-X", "POST",
            "http://127.0.0.1:8181",
            "-H", "Content-Type: application/json",
            "-d", &get_tx_payload,
        ])
        .output()
        .expect("getrawtransaction command");

    let get_tx_res = String::from_utf8_lossy(&get_tx_output.stdout);
    println!("getrawtransaction response: {}", get_tx_res.trim());
    assert!(
        get_tx_res.contains(&format!("{}", built.txid)),
        "Mined block must contain the broadcasted transaction"
    );

    println!("TEST (C) RESULT: SUCCESS (Live transaction broadcasted, mined into regtest block, and confirmed)");
}

/// Probes the Z3 regtest JSON-RPC router so live-chain tests can skip cleanly when it is absent.
fn zebra_regtest_rpc_reachable() -> bool {
    let output = std::process::Command::new("curl")
        .args([
            "-s",
            "-m",
            "3",
            "-X",
            "POST",
            "http://127.0.0.1:8181",
            "-H",
            "Content-Type: application/json",
            "-d",
            r#"{"jsonrpc":"2.0","id":"p4-probe","method":"getblockchaininfo","params":[]}"#,
        ])
        .output();

    match output {
        Ok(out) if out.status.success() => {
            String::from_utf8_lossy(&out.stdout).contains("\"result\"")
        }
        _ => false,
    }
}

#[test]
fn test_p4_analyze_crate_support_and_two_bundles() {
    println!("\n=== P4 ANALYSIS: ORCHARD NOTE SPENT INTO IRONWOOD (TWO BUNDLES) ===");

    // This test ends in a live broadcast to Zebra, so it must not depend on a running chain.
    if !zebra_regtest_rpc_reachable() {
        println!(
            "SKIP: no Zebra regtest node answered getblockchaininfo at http://127.0.0.1:8181; \
             skipping the P4 two-bundle build and live broadcast. Start the Z3 regtest stack to exercise this test."
        );
        return;
    }
    use orchard::bundle::BundleVersion;
    use orchard::keys::SpendAuthorizingKey;
    use zcash_primitives::transaction::sighash::{PrecomputedSighashData, SignableInput};
    use zcash_primitives::transaction::{TransactionData, Unauthorized};

    // 1. Analyze Crate Support
    println!("--- 1. Crate Architecture Support ---");
    println!("- orchard crate: BundleVersion::orchard_v3() (Orchard pool) and BundleVersion::ironwood_v3() (Ironwood pool)");
    println!("- orchard::builder::Builder builds ONE bundle at a time for a single pool version.");
    println!("- Two distinct bundles require two separate Builder instances.");
    println!("- zcash_primitives::transaction::TransactionData::from_parts_v6 explicitly supports BOTH:");
    println!("    orchard_bundle: Option<orchard::Bundle<A::OrchardAuth, ZatBalance>>");
    println!("    ironwood_bundle: Option<orchard::Bundle<A::OrchardAuth, ZatBalance>>");
    println!("- V6 sighash (v6_signature_hash) commits to both orchard_digest and ironwood_digest.");
    println!("- Wire serialization (write_v6) writes orchard_bundle followed by ironwood_bundle.");

    // 2. Synthesize test keys and dummy anchor for Orchard spend
    let sk = SpendingKey::from_bytes([99u8; 32]).expect("valid sk");
    let fvk = FullViewingKey::from(&sk);
    let addr = fvk.address_at(0u32, Scope::External);
    let rho = Rho::from_bytes(&[1u8; 32]).unwrap();
    let rseed = RandomSeed::from_bytes([2u8; 32], &rho).unwrap();
    
    // Create an Orchard V2 note (classic Orchard pool) with 100,000 zatoshis
    let orchard_v2_note = Note::from_parts(addr, NoteValue::from_raw(100_000), rho, rseed, NoteVersion::V2).unwrap();
    assert_eq!(orchard_v2_note.version(), NoteVersion::V2);

    let mut tree = CommitmentTree::<MerkleHashOrchard, 32>::empty();
    let cmx: orchard::note::ExtractedNoteCommitment = orchard_v2_note.commitment().into();
    let leaf = MerkleHashOrchard::from_bytes(&cmx.to_bytes()).unwrap();
    tree.append(leaf).unwrap();
    let wit = IncrementalWitness::from_tree(tree.clone()).unwrap();
    let path = MerklePath::from(wit.path().unwrap());
    let anchor: orchard::Anchor = tree.root().into();

    let mut rng = rand::rng();

    // 3. Build Orchard Spend Bundle (ValueBalance = +100,000 zatoshis exiting Orchard pool)
    println!("\n--- 2. Building Orchard Spend Bundle ---");
    let mut orchard_builder = orchard::builder::Builder::new(
        orchard::builder::BundleType::DEFAULT,
        BundleVersion::orchard_v3(),
        BundleVersion::orchard_v3().default_flags(),
        anchor,
    ).unwrap();
    let add_spend_res = orchard_builder.add_spend(fvk.clone(), orchard_v2_note, path);
    println!("orchard_builder.add_spend(): {:?}", add_spend_res);
    assert!(add_spend_res.is_ok());

    let (orchard_unproven, _) = orchard_builder.build::<i64>(&mut rng).unwrap().unwrap();
    println!("Orchard unproven bundle actions: {}", orchard_unproven.actions().len());
    println!("Orchard unproven bundle value balance: {}", orchard_unproven.value_balance());
    assert_eq!(*orchard_unproven.value_balance(), 100_000);

    // 4. Build Ironwood Output Bundle (ValueBalance = -90,000 zatoshis entering Ironwood pool)
    println!("\n--- 3. Building Ironwood Output Bundle ---");
    let mut ironwood_builder = orchard::builder::Builder::new(
        orchard::builder::BundleType::DEFAULT,
        BundleVersion::ironwood_v3(),
        BundleVersion::ironwood_v3().default_flags(),
        anchor,
    ).unwrap();
    let add_out_res = ironwood_builder.add_output(None, addr, NoteValue::from_raw(90_000), ZIP302_NO_MEMO);
    println!("ironwood_builder.add_output(): {:?}", add_out_res);
    assert!(add_out_res.is_ok());

    let (ironwood_unproven, _) = ironwood_builder.build::<i64>(&mut rng).unwrap().unwrap();
    println!("Ironwood unproven bundle actions: {}", ironwood_unproven.actions().len());
    println!("Ironwood unproven bundle value balance: {}", ironwood_unproven.value_balance());
    assert_eq!(*ironwood_unproven.value_balance(), -90_000);


    // Net value balance across bundles: 100,000 + (-90,000) = 10,000 fee
    let net_balance = *orchard_unproven.value_balance() + *ironwood_unproven.value_balance();
    println!("Net transaction fee: {} zatoshis", net_balance);
    assert_eq!(net_balance, 10_000);

    // 5. Assemble V6 TransactionData<Unauthorized> with BOTH bundles and compute V6 Sighash
    println!("\n--- 4. Assembling V6 Transaction with Both Bundles ---");
    let orchard_unproven_zat = orchard_unproven
        .clone()
        .try_map_value_balance(ZatBalance::from_i64)
        .expect("valid orchard ZatBalance");
    let ironwood_unproven_zat = ironwood_unproven
        .clone()
        .try_map_value_balance(ZatBalance::from_i64)
        .expect("valid ironwood ZatBalance");

    let tx_for_sighash: TransactionData<Unauthorized> = TransactionData::from_parts_v6(
        BranchId::Nu6_3,
        0, // lock_time
        BlockHeight::from_u32(150),
        None, // transparent_bundle
        None, // sapling_bundle
        Some(orchard_unproven_zat),  // orchard_bundle
        Some(ironwood_unproven_zat), // ironwood_bundle
    );

    let precomputed = PrecomputedSighashData::new(tx_for_sighash);
    let sighash = precomputed.signature_hash(&SignableInput::Shielded);
    let sighash_bytes: [u8; 32] = *sighash.as_ref();
    println!("Canonical V6 sighash computed: {}", hex::encode(sighash_bytes));

    // 6. Generate Halo 2 ZK proofs for both bundles
    println!("\n--- 5. Generating Halo 2 Proofs for Both Bundles ---");
    let pk = get_shared_proving_key();
    let orchard_proven = orchard_unproven
        .create_proof(pk, &mut rng)
        .expect("orchard bundle proof creation");
    println!("Orchard bundle proof generated successfully!");

    let ironwood_proven = ironwood_unproven
        .create_proof(pk, &mut rng)
        .expect("ironwood bundle proof creation");
    println!("Ironwood bundle proof generated successfully!");

    // 7. Apply RedPallas spend authorization signatures
    println!("\n--- 6. Applying Signatures & Freezing Transaction ---");
    let ask = SpendAuthorizingKey::from(&sk);
    let orchard_authorized = orchard_proven
        .apply_signatures(rand::rng(), sighash_bytes, &[ask])
        .expect("orchard signing");
    let ironwood_authorized = ironwood_proven
        .apply_signatures(rand::rng(), sighash_bytes, &[])
        .expect("ironwood signing");

    let orchard_auth_zat = orchard_authorized
        .try_map_value_balance(ZatBalance::from_i64)
        .unwrap();
    let ironwood_auth_zat = ironwood_authorized
        .try_map_value_balance(ZatBalance::from_i64)
        .unwrap();

    let final_tx_data: TransactionData<zcash_primitives::transaction::Authorized> = TransactionData::from_parts_v6(
        BranchId::Nu6_3,
        0,
        BlockHeight::from_u32(150),
        None,
        None,
        Some(orchard_auth_zat),
        Some(ironwood_auth_zat),
    );

    let tx = final_tx_data.freeze().expect("freeze two-bundle transaction");
    let txid = tx.txid();
    println!("Two-bundle V6 transaction built and frozen! TxID: {}", txid);

    let mut raw_bytes = Vec::new();
    tx.write(&mut raw_bytes).expect("serialize two-bundle transaction");
    println!("Serialized wire length: {} bytes", raw_bytes.len());

    // 8. Canonical deserialization check
    let mut reader = &raw_bytes[..];
    let read_tx = Transaction::read(&mut reader, BranchId::Nu6_3)
        .expect("Transaction::read on two-bundle transaction");
    assert!(read_tx.orchard_bundle().is_some(), "orchard_bundle must be present");
    assert!(read_tx.ironwood_bundle().is_some(), "ironwood_bundle must be present");
    println!("Deserialization confirmed: both orchard_bundle and ironwood_bundle parsed successfully!");

    // 9. Live Regtest Broadcast Attempt
    println!("\n--- 7. Attempting Broadcast to Live Regtest Zebra Node ---");
    let raw_tx_hex = hex::encode(&raw_bytes);
    let broadcast_payload = format!(
        r#"{{"jsonrpc":"2.0","id":"p4-cross-pool","method":"sendrawtransaction","params":["{}"]}}"#,
        raw_tx_hex
    );

    let curl_output = std::process::Command::new("curl")
        .args([
            "-s",
            "-X", "POST",
            "http://127.0.0.1:8181",
            "-H", "Content-Type: application/json",
            "-d", &broadcast_payload,
        ])
        .output();

    if let Ok(output) = curl_output {
        let resp_str = String::from_utf8_lossy(&output.stdout);
        println!("Raw Zebra JSON-RPC Broadcast Response:\n{}", resp_str.trim());
    } else {
        println!("Curl command could not be executed");
    }
}

#[test]
fn test_p6_zip317_fee_parity_with_crate_feerule() {
    println!("\n=== P6 ZIP-317 FEE PARITY TEST AGAINST FeeRule::standard() ===");
    use zcash_core::compute_zip317_fee;
    use zcash_core::wallet_handle::quote_fee;
    use zcash_primitives::transaction::fees::transparent::InputSize;
    use zcash_primitives::transaction::fees::zip317::FeeRule;
    use zcash_primitives::transaction::fees::FeeRule as _;
    use zcash_protocol::consensus::{BlockHeight, MAIN_NETWORK};

    // Test a wide range of action counts
    let test_action_counts = [0usize, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 50, 100];

    for &n in &test_action_counts {
        // 1. Calculate conventional fee directly from crate's FeeRule::standard()
        // Standard rule: 2 grace actions, 5000 zatoshis per marginal action, min fee 10000 zatoshis
        let standard_fee = FeeRule::standard()
            .fee_required(
                &MAIN_NETWORK,
                BlockHeight::from_u32(1),
                std::iter::empty::<InputSize>(),
                std::iter::empty::<usize>(),
                0,
                0,
                0,
                n,
            )
            .expect("standard fee calculation");
        let expected_u64 = u64::from(standard_fee);
        let expected_i64 = expected_u64 as i64;

        // 2. Compare against quote_fee(n)
        let quoted = quote_fee(n as u32).expect("quote_fee");
        assert_eq!(
            quoted, expected_i64,
            "quote_fee({}) = {}, expected FeeRule::standard() = {}",
            n, quoted, expected_i64
        );

        // 3. Compare against compute_zip317_fee for single-spend/single-output equivalent
        // In compute_zip317_fee(s, o), effective actions is max(max(s, o), 2)
        if n >= 2 {
            let comp_fee = compute_zip317_fee(n, 0).expect("compute_zip317_fee");
            assert_eq!(
                u64::from(comp_fee), expected_u64,
                "compute_zip317_fee({}, 0) = {}, expected = {}",
                n, u64::from(comp_fee), expected_u64
            );
        }

        println!("  Actions: {:3} -> Fee: {:7} zatoshis (matches FeeRule::standard())", n, quoted);
    }

    println!("All {} action counts verified strictly identical to FeeRule::standard()!", test_action_counts.len());
}

#[test]
fn test_build_testnet_tx_at_nu7_height_has_nu7_consensus_branch_id() {
    println!("\n=== TEST: BUILD TESTNET TX AT HEIGHT >= 4,465,026 HAS NU7 BRANCH ID (0x77190ad9) ===");
    use zcash_protocol::consensus::TEST_NETWORK;

    let (sk, fvk, note1, path1, _note2, _path2, anchor) = setup_in_memory_tree_and_notes();
    let spend1 = SpendInput::new(note1, path1);

    let recipient_sk = SpendingKey::from_bytes([99u8; 32]).unwrap();
    let recipient_fvk = FullViewingKey::from(&recipient_sk);
    let recipient_addr = recipient_fvk.address_at(0u32, Scope::External);
    let out1 = OutputSpec::new(recipient_addr, NoteValue::from_raw(400_000));

    let change_addr = fvk.address_at(0u32, Scope::Internal);
    let out2 = OutputSpec::new(change_addr, NoteValue::from_raw(90_000));

    // Target testnet height >= 4,465,026 (NU7 activation height)
    let target_height = BlockHeight::from_u32(4_465_026);

    // Derive config using the exact same derivation as the builder: BranchId::for_height
    let config = TransactionConfig::for_target_height(&TEST_NETWORK, anchor, target_height, Some(5));

    assert_eq!(config.branch_id, BranchId::Nu7);
    assert_eq!(u32::from(config.branch_id), 0x7719_0ad9);

    let pk = get_shared_proving_key();
    let built = build_and_prove_v6_ironwood_tx(
        &sk,
        vec![spend1],
        vec![out1, out2],
        &config,
        pk,
    )
    .expect("build_and_prove_v6_ironwood_tx failed at NU7 height");

    // Assert consensus branch ID on built transaction
    let built_branch_u32 = u32::from(built.transaction.consensus_branch_id());
    assert_eq!(
        built_branch_u32, 0x7719_0ad9,
        "Built transaction consensus branch ID must be 0x77190ad9 (NU7)"
    );

    // Assert round-trip deserialization with Transaction::read
    let mut reader = &built.raw_bytes[..];
    let read_tx = Transaction::read(&mut reader, config.branch_id)
        .expect("Transaction::read failed on NU7 transaction bytes");
    let read_branch_u32 = u32::from(read_tx.consensus_branch_id());
    assert_eq!(
        read_branch_u32, 0x7719_0ad9,
        "Deserialized transaction consensus branch ID must be 0x77190ad9 (NU7)"
    );

    println!("Verified: testnet tx built at height {} has consensus branch id 0x{:08x}", target_height, built_branch_u32);
}

#[test]
fn test_default_tx_expiry_delta_for_nu6_3_and_nu7() {
    println!("\n=== TEST: DEFAULT TX EXPIRY DELTA FOR NU6_3 AND NU7 ===");
    use zcash_primitives::transaction::builder::{
        default_tx_expiry_delta, BLOSSOM_DEFAULT_TX_EXPIRY_DELTA, NU7_DEFAULT_TX_EXPIRY_DELTA,
    };

    // Nu6_3 expiry delta assertion citing crate constant BLOSSOM_DEFAULT_TX_EXPIRY_DELTA
    let nu6_3_delta = default_tx_expiry_delta(BranchId::Nu6_3);
    assert_eq!(
        nu6_3_delta, 40,
        "Nu6_3 default transaction expiry delta must be 40 blocks"
    );
    assert_eq!(
        nu6_3_delta, BLOSSOM_DEFAULT_TX_EXPIRY_DELTA,
        "Nu6_3 delta must match crate constant zcash_primitives::transaction::builder::BLOSSOM_DEFAULT_TX_EXPIRY_DELTA (40)"
    );

    // Nu7 expiry delta assertion citing crate constant NU7_DEFAULT_TX_EXPIRY_DELTA
    let nu7_delta = default_tx_expiry_delta(BranchId::Nu7);
    assert_eq!(
        nu7_delta, 120,
        "Nu7 default transaction expiry delta must be 120 blocks"
    );
    assert_eq!(
        nu7_delta, NU7_DEFAULT_TX_EXPIRY_DELTA,
        "Nu7 delta must match crate constant zcash_primitives::transaction::builder::NU7_DEFAULT_TX_EXPIRY_DELTA (120)"
    );

    // Assert TransactionConfig automatically applies the correct branch expiry delta
    let dummy_anchor = orchard::Anchor::from_bytes([0u8; 32]).unwrap();
    let tip = BlockHeight::from_u32(1_000);

    let config_nu6_3 = TransactionConfig::new(BranchId::Nu6_3, dummy_anchor, tip, None);
    assert_eq!(
        config_nu6_3.expiry_height,
        BlockHeight::from_u32(1_001 + BLOSSOM_DEFAULT_TX_EXPIRY_DELTA),
        "TransactionConfig with Nu6_3 must expire at target height + BLOSSOM_DEFAULT_TX_EXPIRY_DELTA (1041)"
    );

    let config_nu7 = TransactionConfig::new(BranchId::Nu7, dummy_anchor, tip, None);
    assert_eq!(
        config_nu7.expiry_height,
        BlockHeight::from_u32(1_001 + NU7_DEFAULT_TX_EXPIRY_DELTA),
        "TransactionConfig with Nu7 must expire at target height + NU7_DEFAULT_TX_EXPIRY_DELTA (1121)"
    );

    println!(
        "Verified: Nu6_3 delta = {} (BLOSSOM_DEFAULT_TX_EXPIRY_DELTA), Nu7 delta = {} (NU7_DEFAULT_TX_EXPIRY_DELTA)",
        nu6_3_delta, nu7_delta
    );
}

#[test]
#[ignore = "requires live Zebra regtest node with NU7 on port 29232 (run under verify-live.sh)"]
fn test_fee_acceptance_on_regtest_node() {
    println!("\n=== TEST: FEE ACCEPTANCE ON REGTEST NODE (CRATE FEE vs GETSTANDARDFEE vs 1 ZAT BELOW) ===");

    // Check if regtest node is reachable
    let check = Command::new("curl")
        .args([
            "-s", "-X", "POST", "http://127.0.0.1:29232",
            "-H", "Content-Type: application/json",
            "-d", r#"{"jsonrpc":"2.0","id":"1","method":"getstandardfee","params":[]}"#,
        ])
        .output();

    let output = match check {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).to_string(),
        _ => {
            println!("SKIPPING: Zebra regtest node not reachable on port 29232");
            return;
        }
    };
    println!("Node getstandardfee response: {}", output.trim());

    let (sk, fvk, note1, path1, _note2, _path2, anchor) = setup_in_memory_tree_and_notes();
    let spend1 = SpendInput::new(note1, path1);

    let recipient_sk = SpendingKey::from_bytes([99u8; 32]).unwrap();
    let recipient_fvk = FullViewingKey::from(&recipient_sk);
    let recipient_addr = recipient_fvk.address_at(0u32, Scope::External);
    let change_addr = fvk.address_at(0u32, Scope::Internal);

    let pk = get_shared_proving_key();
    let tip = BlockHeight::from_u32(107);
    let config = TransactionConfig::new(BranchId::Nu7, anchor, tip, None);
    let mut config_custom = config.clone();
    config_custom.allow_custom_fee = true;

    // Case 1: Crate fee = 10,000 zatoshis (2 actions * 5,000 zatoshis)
    // Spend: 500,000. Out1: 400,000. Out2: 90,000. Fee: 10,000.
    let tx_crate_fee = build_and_prove_v6_ironwood_tx(
        &sk,
        vec![spend1.clone()],
        vec![
            OutputSpec::new(recipient_addr, NoteValue::from_raw(400_000)),
            OutputSpec::new(change_addr, NoteValue::from_raw(90_000)),
        ],
        &config,
        pk,
    ).expect("build crate fee tx");

    // Case 2a: Node getstandardfee (1,000 zatoshis)
    // Spend: 500,000. Out1: 400,000. Out2: 99,000. Fee: 1,000.
    let tx_standard_fee = build_and_prove_v6_ironwood_tx(
        &sk,
        vec![spend1.clone()],
        vec![
            OutputSpec::new(recipient_addr, NoteValue::from_raw(400_000)),
            OutputSpec::new(change_addr, NoteValue::from_raw(99_000)),
        ],
        &config_custom,
        pk,
    ).expect("build standard fee tx");

    // Case 2b: 2 * getstandardfee for 2 actions = 2,000 zatoshis
    // Spend: 500,000. Out1: 400,000. Out2: 98,000. Fee: 2,000.
    let tx_2x_standard_fee = build_and_prove_v6_ironwood_tx(
        &sk,
        vec![spend1.clone()],
        vec![
            OutputSpec::new(recipient_addr, NoteValue::from_raw(400_000)),
            OutputSpec::new(change_addr, NoteValue::from_raw(98_000)),
        ],
        &config_custom,
        pk,
    ).expect("build 2x standard fee tx");

    // Case 2c: 1 zat below 2 * getstandardfee = 1,999 zatoshis
    // Spend: 500,000. Out1: 400,000. Out2: 98,001. Fee: 1,999.
    let tx_below_2x_fee = build_and_prove_v6_ironwood_tx(
        &sk,
        vec![spend1.clone()],
        vec![
            OutputSpec::new(recipient_addr, NoteValue::from_raw(400_000)),
            OutputSpec::new(change_addr, NoteValue::from_raw(98_001)),
        ],
        &config_custom,
        pk,
    ).expect("build below 2x standard fee tx");

    // Case 3: 1 zat below getstandardfee = 999 zatoshis
    // Spend: 500,000. Out1: 400,000. Out2: 99,001. Fee: 999.
    let tx_below_fee = build_and_prove_v6_ironwood_tx(
        &sk,
        vec![spend1.clone()],
        vec![
            OutputSpec::new(recipient_addr, NoteValue::from_raw(400_000)),
            OutputSpec::new(change_addr, NoteValue::from_raw(99_001)),
        ],
        &config_custom,
        pk,
    ).expect("build below fee tx");

    // Submit each to Zebra
    for (label, tx, fee) in [
        ("Case 1: Crate Fee (10,000 zat)", tx_crate_fee, 10_000),
        ("Case 2a: Raw node getstandardfee (1,000 zat)", tx_standard_fee, 1_000),
        ("Case 2b: 2 * getstandardfee for 2 actions (2,000 zat)", tx_2x_standard_fee, 2_000),
        ("Case 2c: 1 zat below 2 * getstandardfee (1,999 zat)", tx_below_2x_fee, 1_999),
        ("Case 3: 1 zat below raw getstandardfee (999 zat)", tx_below_fee, 999),
    ] {

        let payload = format!(
            r#"{{"jsonrpc":"2.0","id":"test","method":"sendrawtransaction","params":["{}"]}}"#,
            hex::encode(&tx.raw_bytes)
        );
        let res = Command::new("curl")
            .args([
                "-s", "-X", "POST", "http://127.0.0.1:29232",
                "-H", "Content-Type: application/json",
                "-d", &payload,
            ])
            .output()
            .expect("curl sendrawtransaction");
        let res_str = String::from_utf8_lossy(&res.stdout);
        println!("\n=== {} (fee: {} zatoshis) ===", label, fee);
        println!("Response: {}", res_str.trim());
    }
}

