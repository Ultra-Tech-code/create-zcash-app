use bip0039::{Count, English, Mnemonic};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

use orchard::keys::{PreparedIncomingViewingKey, Scope};
use orchard::note_encryption::CompactAction;
use zcash_keys::address::UnifiedAddress;
use zcash_keys::keys::{UnifiedAddressRequest, UnifiedFullViewingKey, UnifiedSpendingKey};
use zcash_note_encryption::{try_compact_note_decryption, EphemeralKeyBytes};
use zcash_protocol::consensus::{self, BlockHeight, Network, Parameters};
use zcash_protocol::local_consensus::LocalNetwork;

static NEXT_SPEND_HANDLE: AtomicU32 = AtomicU32::new(1);
static SPEND_HANDLES: Mutex<Option<HashMap<u32, UnifiedSpendingKey>>> = Mutex::new(None);

pub fn store_spending_key(usk: UnifiedSpendingKey) -> u32 {
    let id = NEXT_SPEND_HANDLE.fetch_add(1, Ordering::SeqCst);
    let mut map_guard = SPEND_HANDLES.lock().unwrap();
    let map = map_guard.get_or_insert_with(HashMap::new);
    map.insert(id, usk);
    id
}

pub fn get_spending_key(handle: u32) -> Option<UnifiedSpendingKey> {
    let map_guard = SPEND_HANDLES.lock().unwrap();
    map_guard.as_ref()?.get(&handle).cloned()
}

/// Returns a LocalNetwork configured for Z3 regtest (NU6.3 active from height 2).
pub fn regtest_params() -> LocalNetwork {
    LocalNetwork {
        overwinter: Some(BlockHeight::from_u32(1)),
        sapling: Some(BlockHeight::from_u32(1)),
        blossom: Some(BlockHeight::from_u32(1)),
        heartwood: Some(BlockHeight::from_u32(1)),
        canopy: Some(BlockHeight::from_u32(1)),
        nu5: Some(BlockHeight::from_u32(1)),
        nu6: Some(BlockHeight::from_u32(1)),
        nu6_1: Some(BlockHeight::from_u32(1)),
        nu6_2: Some(BlockHeight::from_u32(1)),
        nu6_3: Some(BlockHeight::from_u32(2)),
    }
}

#[derive(Clone)]
pub enum DynamicNetwork {
    Regtest(LocalNetwork),
    Test(Network),
    Main(Network),
}

impl Parameters for DynamicNetwork {
    fn network_type(&self) -> consensus::NetworkType {
        match self {
            DynamicNetwork::Regtest(p) => p.network_type(),
            DynamicNetwork::Test(p) => p.network_type(),
            DynamicNetwork::Main(p) => p.network_type(),
        }
    }

    fn activation_height(&self, nu: consensus::NetworkUpgrade) -> Option<BlockHeight> {
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
    let ufvk_encoded = ufvk.encode(&params);

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

#[derive(Debug, Clone)]
pub struct DecryptedNoteInfo {
    pub pool: String,
    pub value_zatoshis: i64,
    pub recipient: String,
    pub action_index: u32,
}

pub fn internal_try_decrypt_action(
    ufvk_str: &str,
    network_str: &str,
    ephemeral_key_bytes: &[u8],
    cmx_bytes: &[u8],
    enc_ciphertext: &[u8],
    is_ironwood: bool,
    action_index: u32,
) -> Result<Option<DecryptedNoteInfo>, String> {
    let params = get_params_for_network(network_str);
    let ufvk = UnifiedFullViewingKey::decode(&params, ufvk_str)
        .map_err(|e| format!("Failed to decode UFVK: {:?}", e))?;

    let orchard_fvk = match ufvk.orchard() {
        Some(fvk) => fvk,
        None => return Ok(None),
    };

    let ivk = orchard_fvk.to_ivk(Scope::External);
    let prepared_ivk = PreparedIncomingViewingKey::new(&ivk);

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

    let compact_action = CompactAction::from_parts(nullifier_dummy(), cmx, epk, enc_52);

    let domain = orchard::note_encryption::OrchardDomain::for_compact_action(&compact_action);

    if let Some((note, recipient)) = try_compact_note_decryption(&domain, &prepared_ivk, &compact_action) {
        let pool = if is_ironwood { "ironwood" } else { "orchard" };
        let ua = UnifiedAddress::from_receivers(Some(recipient), None, None)
            .map(|u| u.encode(&params))
            .unwrap_or_default();

        return Ok(Some(DecryptedNoteInfo {
            pool: pool.to_string(),
            value_zatoshis: note.value().inner() as i64,
            recipient: ua,
            action_index,
        }));
    }

    Ok(None)
}

fn nullifier_dummy() -> orchard::note::Nullifier {
    orchard::note::Nullifier::from_bytes(&[0u8; 32]).unwrap()
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
    pub fn try_decrypt_action(
        ufvk_str: String,
        network_str: String,
        ephemeral_key: Buffer,
        cmx: Buffer,
        enc_ciphertext: Buffer,
        is_ironwood: bool,
        action_index: u32,
    ) -> Result<Option<DecryptedNote>> {
        let res = internal_try_decrypt_action(
            &ufvk_str,
            &network_str,
            &ephemeral_key,
            &cmx,
            &enc_ciphertext,
            is_ironwood,
            action_index,
        )
        .map_err(|e| Error::new(Status::GenericFailure, e))?;

        Ok(res.map(|n| DecryptedNote {
            pool: n.pool,
            value_zatoshis: n.value_zatoshis,
            recipient: n.recipient,
            action_index: n.action_index,
        }))
    }
}

#[cfg(test)]
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

        let t_fvk = ufvk.transparent().unwrap();
        let ivk = t_fvk.derive_external_ivk().unwrap();
        let t_addr = ivk.derive_address(NonHardenedChildIndex::ZERO).unwrap();
        let addr = Address::from(t_addr);
        let encoded = addr.encode(&testnet_params);
        assert_eq!(encoded, "tmF1xjfhsSzhy55dmhorzTnKjtHhZmPKzts");
    }
}
