#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use thiserror::Error;
pub use zcash_protocol::consensus::{
    BlockHeight, BranchId, NetworkType, NetworkUpgrade, Parameters, MAIN_NETWORK, TEST_NETWORK,
};
pub use zcash_protocol::local_consensus::LocalNetwork;

#[derive(Error, Debug, PartialEq, Eq)]
pub enum ConsensusError {
    #[error("Unknown network: {0}")]
    UnknownNetwork(String),
    #[error("NU6.3 network upgrade not activated on network: {0}")]
    Nu6_3NotActivated(String),
    #[error("NU7 network upgrade not activated on network: {0}")]
    Nu7NotActivated(String),
}

/// Sourced consensus parameters for Regtest, matching Zebra's regtest configuration
/// (`[network.testnet_parameters.activation_heights]` where NU7 = 2).
pub fn regtest_consensus_params() -> LocalNetwork {
    regtest_consensus_params_with_nu7(Some(2))
}

/// Sourced consensus parameters for Regtest with explicit NU7 activation height.
pub fn regtest_consensus_params_with_nu7(nu7_activation: Option<u32>) -> LocalNetwork {
    let nu7 = nu7_activation.unwrap_or(2);
    LocalNetwork {
        overwinter: Some(BlockHeight::from_u32(1)),
        sapling: Some(BlockHeight::from_u32(1)),
        blossom: Some(BlockHeight::from_u32(1)),
        heartwood: Some(BlockHeight::from_u32(1)),
        canopy: Some(BlockHeight::from_u32(1)),
        nu5: Some(BlockHeight::from_u32(2)),
        nu6: Some(BlockHeight::from_u32(2)),
        nu6_1: Some(BlockHeight::from_u32(2)),
        nu6_2: Some(BlockHeight::from_u32(2)),
        nu6_3: Some(BlockHeight::from_u32(2)),
        nu7: Some(BlockHeight::from_u32(nu7)),
    }
}

/// Retrieves the NU6.3 pool activation height from consensus parameter structures.
/// Preserved for wallet default birthday initialization and historical consensus queries.
pub fn get_nu6_3_activation_height(network: &str) -> Result<u32, ConsensusError> {
    match network.to_ascii_lowercase().as_str() {
        "main" | "mainnet" => MAIN_NETWORK
            .activation_height(NetworkUpgrade::Nu6_3)
            .map(u32::from)
            .ok_or_else(|| ConsensusError::Nu6_3NotActivated("mainnet".to_string())),
        "test" | "testnet" => TEST_NETWORK
            .activation_height(NetworkUpgrade::Nu6_3)
            .map(u32::from)
            .ok_or_else(|| ConsensusError::Nu6_3NotActivated("testnet".to_string())),
        "regtest" | "regtest-nu7" | "regtest_nu7" => {
            let params = regtest_consensus_params();
            params
                .activation_height(NetworkUpgrade::Nu6_3)
                .map(u32::from)
                .ok_or_else(|| ConsensusError::Nu6_3NotActivated("regtest".to_string()))
        }
        other => Err(ConsensusError::UnknownNetwork(other.to_string())),
    }
}

/// Alias for get_nu6_3_activation_height (Ironwood pool activation height).
pub fn get_ironwood_activation_height(network: &str) -> Result<u32, ConsensusError> {
    get_nu6_3_activation_height(network)
}

/// Retrieves the official 32-bit Consensus Branch ID for NU6.3 (0x37a5165b).
pub fn get_nu6_3_branch_id() -> u32 {
    u32::from(BranchId::Nu6_3)
}

/// Retrieves the official NU7 activation height from consensus parameter structures.
/// Mainnet: 3,543,405; Testnet: 4,465,026; Regtest: 2.
pub fn get_nu7_activation_height(network: &str) -> Result<u32, ConsensusError> {
    match network.to_ascii_lowercase().as_str() {
        "main" | "mainnet" => MAIN_NETWORK
            .activation_height(NetworkUpgrade::Nu7)
            .map(u32::from)
            .ok_or_else(|| ConsensusError::Nu7NotActivated("mainnet".to_string())),
        "test" | "testnet" => TEST_NETWORK
            .activation_height(NetworkUpgrade::Nu7)
            .map(u32::from)
            .ok_or_else(|| ConsensusError::Nu7NotActivated("testnet".to_string())),
        "regtest" | "regtest-nu7" | "regtest_nu7" => {
            let params = regtest_consensus_params();
            params
                .activation_height(NetworkUpgrade::Nu7)
                .map(u32::from)
                .ok_or_else(|| ConsensusError::Nu7NotActivated("regtest".to_string()))
        }
        other => Err(ConsensusError::UnknownNetwork(other.to_string())),
    }
}

/// Retrieves the official 32-bit Consensus Branch ID for NU7 (0x77190ad9).
pub fn get_nu7_branch_id() -> u32 {
    u32::from(BranchId::Nu7)
}

/// Derives the expected 32-bit Consensus Branch ID for a given network and block height
/// directly from BranchId::for_height.
pub fn get_consensus_branch_id_for_height(network: &str, height: u32) -> Result<u32, ConsensusError> {
    let h = BlockHeight::from_u32(height);
    match network.to_ascii_lowercase().as_str() {
        "test" | "testnet" => Ok(u32::from(BranchId::for_height(&TEST_NETWORK, h))),
        "main" | "mainnet" => Ok(u32::from(BranchId::for_height(&MAIN_NETWORK, h))),
        "regtest" | "regtest-nu7" | "regtest_nu7" => {
            let params = regtest_consensus_params();
            Ok(u32::from(BranchId::for_height(&params, h)))
        }
        other => Err(ConsensusError::UnknownNetwork(other.to_string())),
    }
}
