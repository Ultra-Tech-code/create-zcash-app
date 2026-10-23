use bip0039::{English, Mnemonic};
use orchard::builder::{Builder, BundleType};
use orchard::bundle::{Authorized, BundleVersion, Flags};
use orchard::circuit::ProvingKey;
use orchard::keys::{FullViewingKey, Scope, SpendAuthorizingKey};
use orchard::note::{Note, NoteVersion, RandomSeed, Rho};
use orchard::tree::{MerkleHashOrchard, MerklePath};
use orchard::value::NoteValue;
use rand::rngs::OsRng;
use zcash_keys::keys::UnifiedSpendingKey;
use zcash_protocol::consensus::Network;

use crate::DynamicNetwork;

pub struct SpikeHarness {
    pub usk: UnifiedSpendingKey,
    pub orchard_fvk: FullViewingKey,
    pub orchard_ask: SpendAuthorizingKey,
    pub note: Note,
    pub merkle_path: MerklePath,
    pub anchor: orchard::Anchor,
}

impl SpikeHarness {
    pub fn new() -> Self {
        let testnet_params = DynamicNetwork::Test(Network::TestNetwork);
        let phrase = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
        let mnemonic = Mnemonic::<English>::from_phrase(phrase).unwrap();
        let seed = mnemonic.to_seed("");
        let usk = UnifiedSpendingKey::from_seed(&testnet_params, &seed, 0.try_into().unwrap()).unwrap();
        
        let orchard_sk = usk.orchard();
        let orchard_fvk = FullViewingKey::from(orchard_sk);
        let orchard_ask = SpendAuthorizingKey::from(orchard_sk);

        let recipient = orchard_fvk.address_at(0u32, Scope::External);
        let rho = Rho::from_bytes(&[4u8; 32]).unwrap();
        let rseed = RandomSeed::from_bytes([5u8; 32], &rho).unwrap();
        let note = Note::from_parts(
            recipient,
            NoteValue::from_raw(500_000),
            rho,
            rseed,
            NoteVersion::V2,
        )
        .unwrap();

        let cmx = note.commitment().into();
        let dummy_hash = MerkleHashOrchard::from_bytes(&[0u8; 32]).unwrap();
        let auth_path = [dummy_hash; 32];
        let merkle_path = MerklePath::from_parts(0, auth_path);
        let anchor = merkle_path.root(cmx);

        Self {
            usk,
            orchard_fvk,
            orchard_ask,
            note,
            merkle_path,
            anchor,
        }
    }
}

pub fn run_stage1_builder() -> (
    orchard::Bundle<orchard::builder::InProgress<orchard::builder::Unproven, orchard::builder::Unauthorized>, i64>,
    SpendAuthorizingKey,
) {
    let harness = SpikeHarness::new();

    let mut builder = Builder::new(
        BundleType::Transactional {
            bundle_required: true,
            pad_to_minimum: None,
        },
        BundleVersion::ironwood_v3(),
        Flags::ENABLED,
        harness.anchor,
    )
    .expect("Failed to initialize builder");

    // Spend 500,000 zatoshis
    builder
        .add_spend(harness.orchard_fvk.clone(), harness.note, harness.merkle_path)
        .expect("Failed to add spend");

    // Output 1: 400,000 zatoshis payment
    let target_recipient = harness.orchard_fvk.address_at(1u32, Scope::External);
    builder
        .add_output(None, target_recipient, NoteValue::from_raw(400_000), [0u8; 512])
        .expect("Failed to add payment output");

    // Output 2: 90,000 zatoshis change
    let change_recipient = harness.orchard_fvk.address_at(0u32, Scope::Internal);
    builder
        .add_output(None, change_recipient, NoteValue::from_raw(90_000), [0u8; 512])
        .expect("Failed to add change output");

    let mut rng = OsRng;
    let (unproven_bundle, _meta) = builder
        .build::<i64>(&mut rng)
        .expect("Build failed")
        .expect("Bundle missing");

    (unproven_bundle, harness.orchard_ask)
}

pub fn run_stage2_proving(
    unproven_bundle: orchard::Bundle<orchard::builder::InProgress<orchard::builder::Unproven, orchard::builder::Unauthorized>, i64>,
    pk: &ProvingKey,
) -> orchard::Bundle<orchard::builder::InProgress<orchard::Proof, orchard::builder::Unauthorized>, i64> {
    let mut rng = OsRng;
    unproven_bundle
        .create_proof(pk, &mut rng)
        .expect("Proof generation failed")
}

pub fn run_stage3_signing(
    proven_bundle: orchard::Bundle<orchard::builder::InProgress<orchard::Proof, orchard::builder::Unauthorized>, i64>,
    orchard_ask: &SpendAuthorizingKey,
    sighash: [u8; 32],
) -> orchard::Bundle<Authorized, i64> {
    let mut rng = OsRng;
    proven_bundle
        .apply_signatures(&mut rng, sighash, &[orchard_ask.clone()])
        .expect("Signing failed")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stage1_action_construction() {
        println!("\n=======================================================");
        println!("=== STAGE S1: ACTION CONSTRUCTION & BUILDER SYNTHESIS ===");
        println!("=======================================================");
        let (bundle, _) = run_stage1_builder();

        println!("Bundle Version: {:?}", bundle.bundle_version());
        println!("Actions count: {}", bundle.actions().len());
        println!("Flags: {:?}", bundle.flags());
        println!("Anchor: {}", hex::encode(bundle.anchor().to_bytes()));
        println!("Value Balance (fee zatoshis): {}", bundle.value_balance());

        assert_eq!(bundle.actions().len(), 2);
        assert_eq!(*bundle.flags(), Flags::ENABLED);
        assert_eq!(*bundle.value_balance(), 10_000); // 500k in - 400k out - 90k change = 10k fee
        println!("STAGE S1 RESULT: SUCCESS (Unproven bundle constructed with matching value balance)");
    }

    #[test]
    fn test_stage2_halo2_proving() {
        println!("\n=======================================================");
        println!("=== STAGE S2: HALO 2 ZERO-KNOWLEDGE PROOF GENERATION ===");
        println!("=======================================================");
        let (unproven_bundle, _) = run_stage1_builder();

        println!("Building circuit ProvingKey for PostNu6_3 (Ironwood)...");
        let pk_start = Instant::now();
        let pk = ProvingKey::build(OrchardCircuitVersion::PostNu6_3);
        println!("ProvingKey built in {} ms", pk_start.elapsed().as_millis());

        println!("Generating zero-knowledge Halo 2 proof for 2 actions...");
        let prove_start = Instant::now();
        let proven_bundle = run_stage2_proving(unproven_bundle, &pk);
        let prove_duration = prove_start.elapsed();

        assert_eq!(proven_bundle.actions().len(), 2);
        println!("Halo 2 Proof generated in {} ms", prove_duration.as_millis());
        println!("STAGE S2 RESULT: SUCCESS (Zero-knowledge proof generated for InProgress bundle)");
    }

    #[test]
    fn test_stage3_authorization_and_signing() {
        println!("\n=======================================================");
        println!("=== STAGE S3: SPEND AUTHORIZATION SIGNING & BUNDLE COMPLETION ===");
        println!("=======================================================");
        let (unproven_bundle, orchard_ask) = run_stage1_builder();

        let pk = ProvingKey::build(OrchardCircuitVersion::PostNu6_3);
        let proven_bundle = run_stage2_proving(unproven_bundle, &pk);

        // 32-byte simulated transaction sighash
        let sighash = [0x5au8; 32];
        println!("Applying RedPallas spend authorization signatures (sighash: {})...", hex::encode(sighash));

        let authorized_bundle = run_stage3_signing(proven_bundle, &orchard_ask, sighash);

        println!("Authorized Bundle actions count: {}", authorized_bundle.actions().len());
        for (i, action) in authorized_bundle.actions().iter().enumerate() {
            let sig_bytes: [u8; 64] = (&(*action.authorization())).into();
            println!("  Action #{}: Spend authorization signature: {} (64 bytes)", i, hex::encode(sig_bytes));
        }

        let bsig = authorized_bundle.authorization().binding_signature();
        let bsig_bytes: [u8; 64] = (&(*bsig)).into();
        println!("Bundle Binding signature: {} (64 bytes)", hex::encode(bsig_bytes));

        let proof_bytes = authorized_bundle.authorization().proof().as_ref();
        println!("Halo 2 Proof length on authorized bundle: {} bytes", proof_bytes.len());

        println!("Verifying proof against VerifyingKey...");
        let vk = VerifyingKey::build(OrchardCircuitVersion::PostNu6_3);
        authorized_bundle.verify_proof(&vk).expect("Proof verification failed");
        println!("Proof verification: VALID");

        println!("STAGE S3 RESULT: SUCCESS (Fully authorized Ironwood bundle signed and verified)");
    }

    #[test]
    fn test_stage1_real_ironwood_witness_and_root() {
        println!("\n=======================================================");
        println!("=== STAGE S1: REAL IRONWOOD WITNESS & MERKLE ROOT ===");
        println!("=======================================================");

        use incrementalmerkletree::frontier::CommitmentTree;
        use incrementalmerkletree::witness::IncrementalWitness;
        use std::fs::File;
        use std::io::BufReader;
        use serde::Deserialize;

        #[derive(Deserialize)]
        struct CmxItem {
            height: u32,
            cmx: String,
        }

        #[derive(Deserialize)]
        struct Dump {
            height: u32,
            cmxs: Vec<CmxItem>,
        }

        let f = File::open("src/test_cmxs.json").expect("Unable to open test_cmxs.json");
        let dump: Dump = serde_json::from_reader(BufReader::new(f)).expect("Failed to deserialize test_cmxs.json");
        println!("Loaded {} commitments from compact blocks up to height {}", dump.cmxs.len(), dump.height);

        let mut tree = CommitmentTree::<MerkleHashOrchard, 32>::empty();
        let target_note_pos = 150usize; // Note on Account 3 at height 222
        let target_cmx_hex = "a3ccb871f661c6dd3bf1f77818759cff757f990befaca71334675d1f72a2b01d";
        let mut witness: Option<IncrementalWitness<MerkleHashOrchard, 32>> = None;

        for (idx, item) in dump.cmxs.iter().enumerate() {
            let cmx_bytes = hex::decode(&item.cmx).expect("invalid hex");
            let mut arr = [0u8; 32];
            arr.copy_from_slice(&cmx_bytes);
            let leaf = MerkleHashOrchard::from_bytes(&arr).unwrap();
            tree.append(leaf).expect("failed to append leaf");

            if idx == target_note_pos {
                assert_eq!(item.cmx, target_cmx_hex);
                witness = Some(IncrementalWitness::from_tree(tree.clone()).expect("failed to create witness"));
            } else if let Some(ref mut wit) = witness {
                wit.append(leaf).expect("failed to append to witness");
            }
        }

        let computed_tree_root = tree.root();
        let computed_root_hex = hex::encode(computed_tree_root.to_bytes());
        println!("Computed tree root at height {}: {}", dump.height, computed_root_hex);

        let wit = witness.expect("witness should exist");
        let inc_path = wit.path().expect("path should exist");
        let orchard_path = MerklePath::from(inc_path);
        
        let target_cmx_arr: [u8; 32] = hex::decode(target_cmx_hex).unwrap().try_into().unwrap();
        let ext_cmx = orchard::note::ExtractedNoteCommitment::from_bytes(&target_cmx_arr).unwrap();
        let path_root = orchard_path.root(ext_cmx);
        let path_root_hex = hex::encode(path_root.to_bytes());
        println!("Computed root from MerklePath for note at pos {}: {}", target_note_pos, path_root_hex);

        assert_eq!(computed_root_hex, path_root_hex);

        // Expected finalRoot from Zebra/Zaino at height 233
        let zaino_final_root = "2fa352eb6d103980b5b8ba6cd51ed45900124bcac8ba0aa9fa12b7f2aeacdd10";
        println!("Zaino / Zebra ironwoodTree finalRoot:            {}", zaino_final_root);

        assert_eq!(computed_root_hex, zaino_final_root);
        println!("MATCH! Computed root equals Zaino ironwoodTree root exactly!");
        println!("STAGE S1 RESULT: SUCCESS (Witness built and verified against live Zaino tree root)");
    }

    #[test]
    fn test_stage2_real_transaction_build_and_prove() {
        println!("\n=======================================================");
        println!("=== STAGE S2: REAL V6 IRONWOOD TRANSACTION BUILD & PROVE ===");
        println!("=======================================================");

        use incrementalmerkletree::frontier::CommitmentTree;
        use incrementalmerkletree::witness::IncrementalWitness;
        use std::fs::File;
        use std::io::BufReader;
        use serde::Deserialize;
        use zcash_protocol::consensus::{BlockHeight, BranchId};
        use zcash_protocol::value::ZatBalance;
        use zcash_primitives::transaction::{
            sighash::SignableInput,
            sighash_v6::v6_signature_hash,
            txid::TxIdDigester,
            TransactionData,
        };

        #[derive(Deserialize)]
        struct CmxItem {
            height: u32,
            cmx: String,
        }

        #[derive(Deserialize)]
        struct Dump {
            height: u32,
            cmxs: Vec<CmxItem>,
        }

        let f = File::open("src/test_cmxs.json").expect("Unable to open test_cmxs.json");
        let dump: Dump = serde_json::from_reader(BufReader::new(f)).expect("Failed to deserialize test_cmxs.json");

        // 1. Reconstruct Account 3 keys
        let regtest_params = crate::get_params_for_network("regtest");
        let phrase = "coast same leader clip mail imitate place never place disease gold endless";
        let mnemonic = Mnemonic::<English>::from_phrase(phrase).unwrap();
        let seed = mnemonic.to_seed("");
        let usk = UnifiedSpendingKey::from_seed(&regtest_params, &seed, 0.try_into().unwrap()).unwrap();
        let orchard_sk = usk.orchard();
        let orchard_fvk = FullViewingKey::from(orchard_sk);
        let orchard_ask = SpendAuthorizingKey::from(orchard_sk);

        // 2. Reconstruct the real note at height 222 (tree position 150)
        let rho_bytes: [u8; 32] = hex::decode("c668f77a12f719c9b19c8bc1304b5f183b3fdc5b3d81fe1ede25268e1df33b0e").unwrap().try_into().unwrap();
        let rseed_bytes: [u8; 32] = hex::decode("38da1e25323dfdc51a4a0d19384307143a1dc99687a6563465e10f0610c8bc74").unwrap().try_into().unwrap();
        let expected_cmx_hex = "a3ccb871f661c6dd3bf1f77818759cff757f990befaca71334675d1f72a2b01d";
        let expected_nf_hex = "0a094e4307783c87445915b8869aca5e1ffaabb8510da765398904b5d377c00f";

        let rho = Rho::from_bytes(&rho_bytes).unwrap();
        let rseed = RandomSeed::from_bytes(rseed_bytes, &rho).unwrap();

        use zcash_keys::address::UnifiedAddress;
        use zcash_keys::encoding::AddressCodec;
        let ua_str = "uregtest1kpzkz5yz4pgddlr73j26sapd0cqe2m0arxnwnc4hrd4l4krhdtuvyh4ck6vwncljwv5yfk00j5wh0m8224mahh6qcfzxqlg7uvm6mm0922rxhfyyv6932aglnqjyevse220ptn2xtx7cq9zwdqsvle9qvgrxh3cgllzjdx0c45ekhwugu8cdm5jpt6t5lz2m4h4q6fa9srfzqcgx9fd";
        let ua = UnifiedAddress::decode(&regtest_params, ua_str).expect("Failed to decode UA");
        let recipient = ua.orchard().copied().expect("Orchard receiver missing");

        let mut maybe_note = None;
        for ver in [NoteVersion::V3, NoteVersion::V2] {
            if let Some(n) = Note::from_parts(recipient, NoteValue::from_raw(25_000_000), rho, rseed, ver).into_option() {
                let ext_cmx: orchard::note::ExtractedNoteCommitment = n.commitment().into();
                if hex::encode(ext_cmx.to_bytes()) == expected_cmx_hex {
                    println!("MATCHED note with version {:?}", ver);
                    maybe_note = Some(n);
                    break;
                }
            }
        }

        let note = maybe_note.expect("Failed to match note commitment");
        let ext_cmx: orchard::note::ExtractedNoteCommitment = note.commitment().into();
        let cmx_bytes: [u8; 32] = ext_cmx.to_bytes();
        assert_eq!(hex::encode(cmx_bytes), expected_cmx_hex);
        println!("Note commitment reconstructed & verified: {}", expected_cmx_hex);

        let nf = note.nullifier(&orchard_fvk);
        let nf_bytes: [u8; 32] = nf.to_bytes();
        assert_eq!(hex::encode(nf_bytes), expected_nf_hex);
        println!("Note nullifier verified:                  {}", expected_nf_hex);

        // 3. Build Merkle path and Anchor from the compact block tree
        let mut tree = CommitmentTree::<MerkleHashOrchard, 32>::empty();
        let target_note_pos = 150usize;
        let mut witness: Option<IncrementalWitness<MerkleHashOrchard, 32>> = None;

        for (idx, item) in dump.cmxs.iter().enumerate() {
            let cmx_b = hex::decode(&item.cmx).unwrap();
            let mut arr = [0u8; 32];
            arr.copy_from_slice(&cmx_b);
            let leaf = MerkleHashOrchard::from_bytes(&arr).unwrap();
            tree.append(leaf).unwrap();

            if idx == target_note_pos {
                witness = Some(IncrementalWitness::from_tree(tree.clone()).unwrap());
            } else if let Some(ref mut wit) = witness {
                wit.append(leaf).unwrap();
            }
        }

        let wit = witness.unwrap();
        let orchard_path = MerklePath::from(wit.path().unwrap());
        let anchor = orchard_path.root(ext_cmx);
        println!("Ironwood Anchor:                          {}", hex::encode(anchor.to_bytes()));

        // 4. Build Ironwood bundle (spend 25,000,000, output 24,990,000 to Account 0, net fee = 10,000)
        let mut rng = OsRng;
        let mut builder = Builder::new(
            BundleType::Transactional {
                bundle_required: true,
                pad_to_minimum: None,
            },
            BundleVersion::ironwood_v3(),
            Flags::ENABLED,
            anchor,
        ).expect("Failed to initialize builder");

        builder.add_spend(orchard_fvk, note, orchard_path).unwrap();

        // Recipient: Account 0 Orchard address
        let phrase0 = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
        let m0 = Mnemonic::<English>::from_phrase(phrase0).unwrap();
        let usk0 = UnifiedSpendingKey::from_seed(&regtest_params, &m0.to_seed(""), 0.try_into().unwrap()).unwrap();
        let fvk0 = FullViewingKey::from(usk0.orchard());
        let recipient_out = fvk0.address_at(0u32, Scope::External);

        builder.add_output(None, recipient_out, NoteValue::from_raw(24_990_000), [0u8; 512]).unwrap();

        let (unproven_bundle, _) = builder.build::<i64>(&mut rng).unwrap().unwrap();
        assert_eq!(*unproven_bundle.value_balance(), 10_000); // 10,000 zatoshis ZIP-317 fee
        println!("Unproven Ironwood bundle built with value balance: {} zatoshis", unproven_bundle.value_balance());

        // 5. Assemble V6 TransactionData<Unauthorized> to compute canonical V6 sighash
        let unproven_bundle_zat = unproven_bundle.clone().try_map_value_balance(ZatBalance::from_i64).unwrap();
        let expiry_height = BlockHeight::from_u32(dump.height + 50);
        let tx_for_sighash: TransactionData<zcash_primitives::transaction::Unauthorized> = TransactionData::from_parts_v6(
            BranchId::Nu6_3,
            0,
            expiry_height,
            None,
            None,
            None,
            Some(unproven_bundle_zat),
        );

        let txid_parts = tx_for_sighash.digest(TxIdDigester);
        let sighash = v6_signature_hash(&tx_for_sighash, &SignableInput::Shielded, &txid_parts);
        let sighash_bytes: [u8; 32] = sighash.as_bytes().try_into().unwrap();
        println!("Computed real V6 sighash:                {}", hex::encode(sighash_bytes));

        // 6. Generate Halo 2 zero-knowledge proof
        println!("Building ProvingKey for PostNu6_3...");
        let pk = ProvingKey::build(OrchardCircuitVersion::PostNu6_3);
        println!("Creating Halo 2 proof for real spend...");
        let proven_bundle = unproven_bundle.create_proof(&pk, &mut rng).unwrap();
        println!("Halo 2 proof created successfully!");

        // 8. Sign bundle with RedPallas spend authorization & binding signature over REAL sighash
        let authorized_bundle = proven_bundle
            .apply_signatures(&mut rng, sighash_bytes, &[orchard_ask])
            .unwrap();

        // 9. Assemble and serialize final V6 transaction with real signatures
        let authorized_bundle_zat = authorized_bundle.try_map_value_balance(ZatBalance::from_i64).unwrap();
        let final_tx_data = TransactionData::from_parts_v6(
            BranchId::Nu6_3,
            0,
            expiry_height,
            None,
            None,
            None,
            Some(authorized_bundle_zat),
        );

        let tx = final_tx_data.freeze().expect("Failed to freeze transaction");
        println!("Transaction ID (txid):                    {}", tx.txid());

        let mut raw_tx_bytes = Vec::new();
        tx.write(&mut raw_tx_bytes).unwrap();
        let raw_tx_hex = hex::encode(&raw_tx_bytes);
        println!("Serialized V6 transaction ({} bytes):", raw_tx_bytes.len());
        println!("RAW_TX_HEX: {}", raw_tx_hex);

        // Save raw transaction hex for broadcasting in S3
        std::fs::write("src/real_tx_v6.hex", &raw_tx_hex).unwrap();

        println!("STAGE S2 RESULT: SUCCESS (Real V6 Ironwood transaction built, proved, signed and serialized)");
    }
}
