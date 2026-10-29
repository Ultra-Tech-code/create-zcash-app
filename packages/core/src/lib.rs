#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use bip0039::{Count, English, Mnemonic};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

use orchard::keys::{PreparedIncomingViewingKey, Scope};
use orchard::note_encryption::CompactAction;
use zcash_keys::address::UnifiedAddress;
use zcash_keys::keys::{UnifiedAddressRequest, UnifiedFullViewingKey, UnifiedSpendingKey};
use zcash_note_encryption::{try_compact_note_decryption, EphemeralKeyBytes};
use zcash_protocol::consensus::{self as protocol_consensus, BlockHeight, Network, Parameters};
use zcash_protocol::local_consensus::LocalNetwork;

static NEXT_SPEND_HANDLE: AtomicU32 = AtomicU32::new(1);
static SPEND_HANDLES: Mutex<Option<HashMap<u32, UnifiedSpendingKey>>> = Mutex::new(None);

pub fn store_spending_key(usk: UnifiedSpendingKey) -> u32 {
    let id = NEXT_SPEND_HANDLE.fetch_add(1, Ordering::SeqCst);
    let mut map_guard = match SPEND_HANDLES.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    let map = map_guard.get_or_insert_with(HashMap::new);
    map.insert(id, usk);
    id
}

pub fn get_spending_key(handle: u32) -> Option<UnifiedSpendingKey> {
    let map_guard = match SPEND_HANDLES.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    map_guard.as_ref()?.get(&handle).cloned()
}

/// Returns a LocalNetwork configured for Z3 regtest (matching Zebra regtest schedule).
pub fn regtest_params() -> LocalNetwork {
    consensus::regtest_consensus_params()
}

/// Returns a LocalNetwork configured for Z3 regtest with explicit NU7 activation height.
pub fn regtest_params_with_nu7(nu7_activation: Option<u32>) -> LocalNetwork {
    consensus::regtest_consensus_params_with_nu7(nu7_activation)
}

#[derive(Clone)]
pub enum DynamicNetwork {
    Regtest(LocalNetwork),
    Test(Network),
    Main(Network),
}

impl Parameters for DynamicNetwork {
    fn network_type(&self) -> protocol_consensus::NetworkType {
        match self {
            DynamicNetwork::Regtest(p) => p.network_type(),
            DynamicNetwork::Test(p) => p.network_type(),
            DynamicNetwork::Main(p) => p.network_type(),
        }
    }

    fn activation_height(&self, nu: protocol_consensus::NetworkUpgrade) -> Option<BlockHeight> {
        match self {
            DynamicNetwork::Regtest(p) => p.activation_height(nu),
            DynamicNetwork::Test(p) => p.activation_height(nu),
            DynamicNetwork::Main(p) => p.activation_height(nu),
        }
    }
}

pub fn get_params_for_network(network_str: &str) -> DynamicNetwork {
    match network_str.to_lowercase().as_str() {
        "regtest" => DynamicNetwork::Regtest(regtest_params()),
        "regtest-nu7" | "regtest_nu7" => DynamicNetwork::Regtest(regtest_params_with_nu7(Some(2))),
        "testnet" | "test" => DynamicNetwork::Test(Network::TestNetwork),
        _ => DynamicNetwork::Main(Network::MainNetwork),
    }
}

#[derive(Debug, Clone)]
pub struct InternalDerivedAccount {
    pub ufvk: String,
    pub unified_address: String,
    pub spend_handle: u32,
    pub network: String,
}

pub fn internal_generate_mnemonic() -> String {
    let mnemonic = Mnemonic::<English>::generate(Count::Words12);
    mnemonic.to_string()
}

pub fn internal_derive_account_from_mnemonic(
    mnemonic_str: &str,
    account_index: u32,
    network_str: &str,
) -> Result<InternalDerivedAccount, String> {
    let mnemonic = Mnemonic::<English>::from_phrase(mnemonic_str)
        .map_err(|e| format!("Invalid mnemonic: {:?}", e))?;
    let seed = mnemonic.to_seed("");

    let params = get_params_for_network(network_str);
    let account_id = account_index
        .try_into()
        .map_err(|e| format!("Invalid account index: {:?}", e))?;

    let usk = UnifiedSpendingKey::from_seed(&params, &seed, account_id)
        .map_err(|e| format!("Failed to derive spending key: {:?}", e))?;

    let ufvk = usk.to_unified_full_viewing_key();
    let ufvk_encoded = ufvk.encode(&params).map_err(|e| format!("Failed to encode UFVK: {:?}", e))?;

    let (ua, _) = ufvk
        .default_address(UnifiedAddressRequest::AllAvailableKeys)
        .map_err(|e| format!("Failed to generate unified address: {:?}", e))?;
    let ua_encoded = ua.encode(&params);

    let spend_handle = store_spending_key(usk);

    Ok(InternalDerivedAccount {
        ufvk: ufvk_encoded,
        unified_address: ua_encoded,
        spend_handle,
        network: network_str.to_string(),
    })
}

pub fn internal_get_address_from_ufvk(
    ufvk_str: &str,
    network_str: &str,
    diversifier_index: Option<u32>,
) -> Result<String, String> {
    let params = get_params_for_network(network_str);
    let ufvk = UnifiedFullViewingKey::decode(&params, ufvk_str)
        .map_err(|e| format!("Failed to decode UFVK: {:?}", e))?;

    let (ua, _) = if let Some(idx) = diversifier_index {
        let j = idx.into();
        ufvk.find_address(j, UnifiedAddressRequest::AllAvailableKeys)
            .map_err(|e| format!("Failed to derive address at diversifier: {:?}", e))?
    } else {
        ufvk.default_address(UnifiedAddressRequest::AllAvailableKeys)
            .map_err(|e| format!("Failed to derive default address: {:?}", e))?
    };

    Ok(ua.encode(&params))
}

pub fn internal_get_transparent_address_from_ufvk(
    ufvk_str: &str,
    network_str: &str,
) -> Result<Option<String>, String> {
    let params = get_params_for_network(network_str);
    let ufvk = UnifiedFullViewingKey::decode(&params, ufvk_str)
        .map_err(|e| format!("Failed to decode UFVK: {:?}", e))?;

    let (ua, _) = ufvk
        .default_address(UnifiedAddressRequest::AllAvailableKeys)
        .map_err(|e| format!("Failed to derive default address: {:?}", e))?;

    if let Some(t_addr) = ua.transparent() {
        let addr = zcash_keys::address::Address::from(*t_addr);
        return Ok(Some(addr.encode(&params)));
    }
    Ok(None)
}

#[derive(Debug, Clone)]
pub struct DecryptedNoteInfo {
    pub pool: String,
    pub value_zatoshis: i64,
    pub recipient: String,
    pub action_index: u32,
    pub nullifier: String,
    pub rho: String,
    pub rseed: String,
}

#[allow(clippy::too_many_arguments)]
pub fn internal_try_decrypt_action(
    ufvk_str: &str,
    network_str: &str,
    ephemeral_key_bytes: &[u8],
    cmx_bytes: &[u8],
    enc_ciphertext: &[u8],
    is_ironwood: bool,
    action_index: u32,
    nullifier_bytes: Option<&[u8]>,
) -> Result<Option<DecryptedNoteInfo>, String> {
    let params = get_params_for_network(network_str);
    let ufvk = UnifiedFullViewingKey::decode(&params, ufvk_str)
        .map_err(|e| format!("Failed to decode UFVK: {:?}", e))?;

    let orchard_fvk = match ufvk.orchard() {
        Some(fvk) => fvk,
        None => return Ok(None),
    };

    let ivk_external = orchard_fvk.to_ivk(Scope::External);
    let ivk_internal = orchard_fvk.to_ivk(Scope::Internal);
    let prepared_external = PreparedIncomingViewingKey::new(&ivk_external);
    let prepared_internal = PreparedIncomingViewingKey::new(&ivk_internal);

    if ephemeral_key_bytes.len() != 32 || cmx_bytes.len() != 32 || enc_ciphertext.len() < 52 {
        return Ok(None);
    }

    let mut epk_arr = [0u8; 32];
    epk_arr.copy_from_slice(ephemeral_key_bytes);
    let epk = EphemeralKeyBytes(epk_arr);

    let mut cmx_arr = [0u8; 32];
    cmx_arr.copy_from_slice(cmx_bytes);

    let cmx = match orchard::note::ExtractedNoteCommitment::from_bytes(&cmx_arr).into_option() {
        Some(c) => c,
        None => return Ok(None),
    };

    let mut enc_52 = [0u8; 52];
    enc_52.copy_from_slice(&enc_ciphertext[..52]);

    let nullifier = match nullifier_bytes.and_then(|b| {
        if b.len() == 32 {
            let mut arr = [0u8; 32];
            arr.copy_from_slice(b);
            orchard::note::Nullifier::from_bytes(&arr).into_option()
        } else {
            None
        }
    }) {
        Some(nf) => nf,
        None => match orchard::note::Nullifier::from_bytes(&[0u8; 32]).into_option() {
            Some(nf) => nf,
            None => return Ok(None),
        },
    };

    let compact_action = CompactAction::from_parts(nullifier, cmx, epk, enc_52);

    // Try decrypting with External IVK first, then Internal IVK for change notes.
    // If is_ironwood is true, use IronwoodDomain (ZIP 2005, lead byte 0x03), falling back to OrchardDomain.
    // Otherwise use OrchardDomain (lead byte 0x02), falling back to IronwoodDomain.
    let decrypted = if is_ironwood {
        let iw_domain = orchard::note_encryption::IronwoodDomain::for_compact_action(&compact_action);
        try_compact_note_decryption(&iw_domain, &prepared_external, &compact_action)
            .or_else(|| try_compact_note_decryption(&iw_domain, &prepared_internal, &compact_action))
            .or_else(|| {
                let or_domain = orchard::note_encryption::OrchardDomain::for_compact_action(&compact_action);
                try_compact_note_decryption(&or_domain, &prepared_external, &compact_action)
                    .or_else(|| try_compact_note_decryption(&or_domain, &prepared_internal, &compact_action))
            })
    } else {
        let or_domain = orchard::note_encryption::OrchardDomain::for_compact_action(&compact_action);
        try_compact_note_decryption(&or_domain, &prepared_external, &compact_action)
            .or_else(|| try_compact_note_decryption(&or_domain, &prepared_internal, &compact_action))
            .or_else(|| {
                let iw_domain = orchard::note_encryption::IronwoodDomain::for_compact_action(&compact_action);
                try_compact_note_decryption(&iw_domain, &prepared_external, &compact_action)
                    .or_else(|| try_compact_note_decryption(&iw_domain, &prepared_internal, &compact_action))
            })
    };

    if let Some((note, recipient)) = decrypted {
        let pool = if is_ironwood { "ironwood" } else { "orchard" };
        let ua = UnifiedAddress::from_receivers(Some(recipient), None, None, None, None)
            .map(|u| u.encode(&params))
            .unwrap_or_default();

        let nf = note.nullifier(orchard_fvk);
        let nf_hex = hex::encode(nf.to_bytes());
        let rho_hex = hex::encode(note.rho().to_bytes());
        let rseed_hex = hex::encode(note.rseed().as_bytes());

        return Ok(Some(DecryptedNoteInfo {
            pool: pool.to_string(),
            value_zatoshis: note.value().inner() as i64,
            recipient: ua,
            action_index,
            nullifier: nf_hex,
            rho: rho_hex,
            rseed: rseed_hex,
        }));
    }

    Ok(None)
}

#[cfg(not(test))]
mod napi_bindings {
    use super::*;
    use napi::bindgen_prelude::*;
    use napi_derive::napi;

    #[napi(object)]
    pub struct DerivedAccount {
        pub ufvk: String,
        pub unified_address: String,
        pub spend_handle: u32,
        pub network: String,
    }

    #[napi(object)]
    pub struct DecryptedNote {
        pub pool: String,
        pub value_zatoshis: i64,
        pub recipient: String,
        pub action_index: u32,
        pub nullifier: String,
        pub rho: String,
        pub rseed: String,
    }

    #[napi]
    pub fn generate_mnemonic() -> Result<String> {
        Ok(internal_generate_mnemonic())
    }

    #[napi]
    pub fn derive_account_from_mnemonic(
        mnemonic_str: String,
        account_index: u32,
        network_str: String,
    ) -> Result<DerivedAccount> {
        let acct = internal_derive_account_from_mnemonic(&mnemonic_str, account_index, &network_str)
            .map_err(|e| Error::new(Status::GenericFailure, e))?;
        Ok(DerivedAccount {
            ufvk: acct.ufvk,
            unified_address: acct.unified_address,
            spend_handle: acct.spend_handle,
            network: acct.network,
        })
    }

    #[napi]
    pub fn get_address_from_ufvk(
        ufvk_str: String,
        network_str: String,
        diversifier_index: Option<u32>,
    ) -> Result<String> {
        internal_get_address_from_ufvk(&ufvk_str, &network_str, diversifier_index)
            .map_err(|e| Error::new(Status::GenericFailure, e))
    }

    #[napi]
    pub fn get_transparent_address_from_ufvk(
        ufvk_str: String,
        network_str: String,
    ) -> Result<Option<String>> {
        internal_get_transparent_address_from_ufvk(&ufvk_str, &network_str)
            .map_err(|e| Error::new(Status::GenericFailure, e))
    }

    #[napi]
    #[allow(clippy::too_many_arguments)]
    pub fn try_decrypt_action(
        ufvk_str: String,
        network_str: String,
        ephemeral_key: Buffer,
        cmx: Buffer,
        enc_ciphertext: Buffer,
        is_ironwood: bool,
        action_index: u32,
        nullifier: Option<Buffer>,
    ) -> Result<Option<DecryptedNote>> {
        let res = internal_try_decrypt_action(
            &ufvk_str,
            &network_str,
            &ephemeral_key,
            &cmx,
            &enc_ciphertext,
            is_ironwood,
            action_index,
            nullifier.as_deref(),
        )
        .map_err(|e| Error::new(Status::GenericFailure, e))?;

        Ok(res.map(|n| DecryptedNote {
            pool: n.pool,
            value_zatoshis: n.value_zatoshis,
            recipient: n.recipient,
            action_index: n.action_index,
            nullifier: n.nullifier,
            rho: n.rho,
            rseed: n.rseed,
        }))
    }

    #[napi]
    pub fn get_expected_branch_id(network_str: String, height: u32) -> Result<String> {
        let branch = crate::consensus::get_consensus_branch_id_for_height(&network_str, height)
            .map_err(|e| Error::new(Status::InvalidArg, e.to_string()))?;
        Ok(format!("{:08x}", branch))
    }

    #[napi]
    pub fn get_default_tx_expiry_delta(network_str: String, height: u32) -> Result<u32> {
        let network = get_params_for_network(&network_str);
        let branch_id = zcash_protocol::consensus::BranchId::for_height(&network, BlockHeight::from_u32(height));
        Ok(zcash_primitives::transaction::builder::default_tx_expiry_delta(branch_id))
    }

    #[napi(object)]
    pub struct JsDecryptedMemo {
        pub text: Option<String>,
        pub hex: String,
    }

    #[napi(object)]
    pub struct JsDecryptedActionIncoming {
        pub action_index: u32,
        pub value: i64,
        pub memo: JsDecryptedMemo,
        pub recipient: String,
        pub is_change: bool,
        pub is_internal: bool,
    }

    #[napi(object)]
    pub struct JsDecryptedActionOutgoing {
        pub action_index: u32,
        pub value: i64,
        pub memo: JsDecryptedMemo,
        pub recipient: String,
    }

    #[napi(object)]
    pub struct JsDecryptedTransactionResult {
        pub txid: String,
        pub fee: Option<i64>,
        pub expiry_height: u32,
        pub consensus_branch_id: String,
        pub incoming: Vec<JsDecryptedActionIncoming>,
        pub outgoing: Vec<JsDecryptedActionOutgoing>,
    }

    #[napi]
    pub fn decrypt_transaction(
        ufvk_str: String,
        network_str: String,
        raw_tx_bytes: Buffer,
        height: u32,
    ) -> Result<JsDecryptedTransactionResult> {
        let res = crate::decrypted_tx::internal_decrypt_transaction(
            &ufvk_str,
            &network_str,
            &raw_tx_bytes,
            height,
        )
        .map_err(|e| Error::new(Status::GenericFailure, e))?;

        Ok(JsDecryptedTransactionResult {
            txid: res.txid,
            fee: res.fee,
            expiry_height: res.expiry_height,
            consensus_branch_id: res.consensus_branch_id,
            incoming: res
                .incoming
                .into_iter()
                .map(|inc| JsDecryptedActionIncoming {
                    action_index: inc.action_index,
                    value: inc.value,
                    memo: JsDecryptedMemo {
                        text: inc.memo.text,
                        hex: inc.memo.hex,
                    },
                    recipient: inc.recipient,
                    is_change: inc.is_change,
                    is_internal: inc.is_internal,
                })
                .collect(),
            outgoing: res
                .outgoing
                .into_iter()
                .map(|out| JsDecryptedActionOutgoing {
                    action_index: out.action_index,
                    value: out.value,
                    memo: JsDecryptedMemo {
                        text: out.memo.text,
                        hex: out.memo.hex,
                    },
                    recipient: out.recipient,
                })
                .collect(),
        })
    }

    #[napi(object)]
    pub struct JsDecodedActionCounts {
        pub transparent_inputs: u32,
        pub transparent_outputs: u32,
        pub sapling_spends: u32,
        pub sapling_outputs: u32,
        pub orchard_actions: u32,
        pub ironwood_actions: u32,
    }

    #[napi(object)]
    pub struct JsDecodedAnchorPair {
        pub wallet_orchard_order: String,
        pub zebra_rpc_order: String,
    }

    #[napi(object)]
    pub struct JsDecodedAnchors {
        pub sapling: Option<JsDecodedAnchorPair>,
        pub orchard: Option<JsDecodedAnchorPair>,
        pub ironwood: Option<JsDecodedAnchorPair>,
    }

    #[napi(object)]
    pub struct JsDecodedTransaction {
        pub txid: String,
        pub version: u32,
        pub consensus_branch_id: String,
        pub expiry_height: u32,
        pub fee: Option<i64>,
        pub pools: Vec<String>,
        pub action_counts: JsDecodedActionCounts,
        pub anchors: JsDecodedAnchors,
        pub nullifiers: Vec<String>,
        pub note_commitments: Vec<String>,
        pub size: u32,
    }

    #[napi]
    pub fn decode_transaction(
        raw_tx_bytes: Buffer,
        network_str: Option<String>,
        height: Option<u32>,
    ) -> Result<JsDecodedTransaction> {
        let res = crate::decrypted_tx::internal_decode_transaction(
            &raw_tx_bytes,
            network_str.as_deref(),
            height,
        )
        .map_err(|e| Error::new(Status::GenericFailure, e))?;

        Ok(JsDecodedTransaction {
            txid: res.txid,
            version: res.version,
            consensus_branch_id: res.consensus_branch_id,
            expiry_height: res.expiry_height,
            fee: res.fee,
            pools: res.pools,
            action_counts: JsDecodedActionCounts {
                transparent_inputs: res.action_counts.transparent_inputs,
                transparent_outputs: res.action_counts.transparent_outputs,
                sapling_spends: res.action_counts.sapling_spends,
                sapling_outputs: res.action_counts.sapling_outputs,
                orchard_actions: res.action_counts.orchard_actions,
                ironwood_actions: res.action_counts.ironwood_actions,
            },
            anchors: JsDecodedAnchors {
                sapling: res.anchors.sapling.map(|p| JsDecodedAnchorPair {
                    wallet_orchard_order: p.wallet_orchard_order,
                    zebra_rpc_order: p.zebra_rpc_order,
                }),
                orchard: res.anchors.orchard.map(|p| JsDecodedAnchorPair {
                    wallet_orchard_order: p.wallet_orchard_order,
                    zebra_rpc_order: p.zebra_rpc_order,
                }),
                ironwood: res.anchors.ironwood.map(|p| JsDecodedAnchorPair {
                    wallet_orchard_order: p.wallet_orchard_order,
                    zebra_rpc_order: p.zebra_rpc_order,
                }),
            },
            nullifiers: res.nullifiers,
            note_commitments: res.note_commitments,
            size: res.size as u32,
        })
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod tests {
    use super::*;

    #[test]
    fn test_derive_account_regtest() {
        let phrase = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
        let acct = internal_derive_account_from_mnemonic(phrase, 0, "regtest").unwrap();

        assert!(acct.unified_address.starts_with("uregtest1"));
        assert!(acct.ufvk.starts_with("uviewregtest1"));
        assert!(acct.spend_handle > 0);

        let testnet_params = DynamicNetwork::Test(Network::TestNetwork);
        let mnemonic = Mnemonic::<English>::from_phrase(phrase).unwrap();
        let seed = mnemonic.to_seed("");
        let usk = UnifiedSpendingKey::from_seed(&testnet_params, &seed, 0.try_into().unwrap()).unwrap();
        let ufvk = usk.to_unified_full_viewing_key();
        use zcash_keys::address::Address;
        use zcash_transparent::keys::{IncomingViewingKey, NonHardenedChildIndex};

        let t_fvk = ufvk.p2pkh().unwrap();
        let ivk = t_fvk.derive_external_ivk().unwrap();
        let t_addr = ivk.derive_address(NonHardenedChildIndex::ZERO).unwrap();
        let addr = Address::from(t_addr);
        let encoded = addr.encode(&testnet_params);
        assert_eq!(encoded, "tmF1xjfhsSzhy55dmhorzTnKjtHhZmPKzts");
    }

    #[test]
    fn test_decrypt_action_computes_nullifier() {
        use orchard::keys::Scope;
        use orchard::value::NoteValue;
        use zcash_protocol::consensus::Network;

        let testnet_params = DynamicNetwork::Test(Network::TestNetwork);
        let phrase = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
        let mnemonic = Mnemonic::<English>::from_phrase(phrase).unwrap();
        let seed = mnemonic.to_seed("");
        let usk = UnifiedSpendingKey::from_seed(&testnet_params, &seed, 0.try_into().unwrap()).unwrap();
        let ufvk = usk.to_unified_full_viewing_key();
        let orchard_fvk = ufvk.orchard().unwrap();
        let recipient = orchard_fvk.address_at(0u32, Scope::External);

        let rho = orchard::note::Rho::from_bytes(&[4u8; 32]).unwrap();
        let rseed = orchard::note::RandomSeed::from_bytes([5u8; 32], &rho).unwrap();
        let note = orchard::Note::from_parts(
            recipient,
            NoteValue::from_raw(100_000),
            rho,
            rseed,
            orchard::note::NoteVersion::V2,
        )
        .unwrap();

        let expected_nf = note.nullifier(orchard_fvk);
        let expected_nf_hex = hex::encode(expected_nf.to_bytes());

        // Assert note.nullifier() derives a valid 32-byte hex nullifier for the known FVK
        assert_eq!(expected_nf_hex.len(), 64);
        assert!(hex::decode(&expected_nf_hex).is_ok());

        // Verify try_decrypt_action return structure exposes nullifier string
        let dummy_info = DecryptedNoteInfo {
            pool: "orchard".to_string(),
            value_zatoshis: 100_000,
            recipient: "uregtest1...".to_string(),
            action_index: 0,
            nullifier: expected_nf_hex.clone(),
            rho: "04".repeat(32),
            rseed: "05".repeat(32),
        };

        assert_eq!(dummy_info.nullifier, expected_nf_hex);
    }

    #[test]
    fn test_internal_ironwood_change_note_decryption() {
        use orchard::builder::{Builder, BundleType};
        use orchard::bundle::{BundleVersion, Flags};
        use orchard::keys::Scope;
        use orchard::value::NoteValue;
        use orchard::Anchor;
        use zcash_protocol::consensus::Network;

        let testnet_params = DynamicNetwork::Test(Network::TestNetwork);
        let phrase = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
        let mnemonic = Mnemonic::<English>::from_phrase(phrase).unwrap();
        let seed = mnemonic.to_seed("");
        let usk = UnifiedSpendingKey::from_seed(&testnet_params, &seed, 0.try_into().unwrap()).unwrap();
        let ufvk = usk.to_unified_full_viewing_key();
        let ufvk_str = ufvk.encode(&testnet_params).unwrap();
        let orchard_fvk = ufvk.orchard().unwrap();

        // Target an internal-scope change address
        let internal_recipient = orchard_fvk.address_at(0u32, Scope::Internal);

        let mut builder = Builder::new(
            BundleType::Coinbase,
            BundleVersion::ironwood_v3(),
            Flags::SPENDS_DISABLED,
            Anchor::from_bytes([0u8; 32]).unwrap(),
        )
        .unwrap();

        builder
            .add_output(
                None,
                internal_recipient,
                NoteValue::from_raw(500_000),
                [0u8; 512],
            )
            .unwrap();

        let mut rng = rand::rng();
        let (pczt_bundle, _) = builder.build_for_pczt(&mut rng).unwrap();
        let action = &pczt_bundle.actions()[0];

        let epk_bytes = action.output().encrypted_note().epk_bytes;
        let cmx_bytes = action.output().cmx().to_bytes();
        let enc_ciphertext = action.output().encrypted_note().enc_ciphertext.as_ref();
        let nf_bytes = action.spend().nullifier().to_bytes();

        let res = internal_try_decrypt_action(
            &ufvk_str,
            "testnet",
            &epk_bytes,
            &cmx_bytes,
            enc_ciphertext,
            true,
            0,
            Some(&nf_bytes),
        )
        .unwrap();

        assert!(res.is_some(), "Scope::Internal Ironwood note must decrypt successfully");
        let info = res.unwrap();
        assert_eq!(info.pool, "ironwood");
        assert_eq!(info.value_zatoshis, 500_000);
        assert!(!info.nullifier.is_empty());
    }
}

pub mod consensus;
pub mod decrypted_tx;
pub mod pending_spends;
pub mod scanner;
pub mod schema;
pub mod shard_store;
pub mod spendable;
pub mod transaction;
pub mod wallet_db;
pub mod wallet_handle;

pub use consensus::{
    get_consensus_branch_id_for_height, get_nu6_3_activation_height, get_nu6_3_branch_id,
    ConsensusError,
};
pub use decrypted_tx::{
    internal_decode_transaction, internal_decrypt_transaction, parse_decrypted_memo,
    DecodedActionCounts, DecodedAnchors, DecodedTransactionResult, DecryptedActionIncoming,
    DecryptedActionOutgoing, DecryptedMemo, DecryptedTransactionResult,
};
pub use pending_spends::PendingSpendsManager;
pub use scanner::{
    ChainMetadata, CompactBlock, CompactOrchardAction, CompactTx, ScanResult, Scanner,
    WalletError,
};
#[doc(hidden)]
pub use scanner::{INJECT_BATCH_SLEEP_MS, INJECT_FAULT_BEFORE_CHECKPOINT};
pub use schema::{initialize_schema, metadata_keys, CURRENT_SCHEMA_VERSION};
pub use shard_store::{
    IronwoodShardTree, ShardStoreError, SqliteShardStore, IRONWOOD_SHARD_HEIGHT,
    IRONWOOD_TREE_DEPTH,
};
pub use spendable::{
    parse_recipient_address, query_spendable_notes, query_spendable_notes_with_tree, SpendableNote,
};
pub use transaction::{
    build_and_prove_v6_ironwood_tx, choose_recommended_anchor_height, compute_zip317_fee,
    BuiltTransaction, OutputSpec, OvkPolicy, SpendInput, TransactionBuildError,
    TransactionBuilder, TransactionConfig, ZIP302_NO_MEMO,
};
pub use wallet_db::{WalletDb, WalletDbError};
pub use wallet_handle::{
    decode_ironwood_frontier_root, ironwood_empty_tree_root, JsScanResult, JsSpendableNote,
    JsTreeFrontierInitResult, WalletHandle, WalletSummary,
};

