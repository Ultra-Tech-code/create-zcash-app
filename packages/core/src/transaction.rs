#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::cmp::max;
use std::iter;

use orchard::builder::{Builder, BundleType};
use orchard::bundle::{BundleVersion, Flags};
use orchard::circuit::ProvingKey;
use orchard::keys::{FullViewingKey, OutgoingViewingKey, Scope, SpendAuthorizingKey, SpendingKey};
use orchard::note::Note;
use orchard::tree::MerklePath;
use orchard::value::NoteValue;
use orchard::Address;
use rand::rngs::OsRng;

use zcash_primitives::transaction::fees::transparent::InputSize;
use zcash_primitives::transaction::fees::zip317::FeeRule;
use zcash_primitives::transaction::fees::FeeRule as _;
use zcash_primitives::transaction::sighash::SignableInput;
use zcash_primitives::transaction::sighash_v6::v6_signature_hash;
use zcash_primitives::transaction::txid::TxIdDigester;
use zcash_primitives::transaction::{Transaction, TransactionData, TxId, Unauthorized};
use zcash_protocol::consensus::{BlockHeight, BranchId};
use zcash_protocol::value::{ZatBalance, Zatoshis};

/// Default block offset below the chain tip to select an anchor.
///
/// Consensus rules require the anchor to be within the last 100 blocks.
/// Selecting an anchor 5 blocks below tip provides resilience against 1-to-4 block
/// chain reorganizations and avoids propagation race conditions at the tip.
pub const DEFAULT_ANCHOR_OFFSET: u32 = 5;

/// Default block lifetime added to target height for transaction expiry (40 blocks).
pub const DEFAULT_EXPIRY_DELTA: u32 = 40;

/// ZIP 302 empty memo: 0xF6 followed by 511 zero bytes.
///
/// In ZIP 302, a memo field that is not explicitly set defaults to `0xF6` followed by
/// 511 zeroes, differentiating an empty memo from a memo of all zeroes.
pub const ZIP302_NO_MEMO: [u8; 512] = {
    let mut m = [0u8; 512];
    m[0] = 0xF6;
    m
};

/// Error types returned by the transaction builder.
///
/// Library code returns these errors and never panics (`unwrap`/`expect` are avoided).
#[derive(Debug, thiserror::Error)]
pub enum TransactionBuildError {
    #[error("Empty inputs: at least one spend input is required")]
    EmptyInputs,

    #[error("Empty outputs: at least one output is required")]
    EmptyOutputs,

    #[error("Total spends ({spends_total} zatoshis) is less than total outputs ({outputs_total} zatoshis)")]
    InsufficientFunds {
        spends_total: u64,
        outputs_total: u64,
    },

    #[error(
        "ZIP 317 fee mismatch: required {required_zatoshis} zatoshis, actual fee is {actual_fee} zatoshis \
         (spends {spends_total} - outputs {outputs_total}). Custom fee was not permitted."
    )]
    FeeMismatch {
        required_zatoshis: u64,
        actual_fee: i64,
        spends_total: u64,
        outputs_total: u64,
    },

    #[error("Anchor mismatch for spend input at index {index}: calculated root {calculated} != anchor {expected}")]
    AnchorMismatch {
        index: usize,
        expected: String,
        calculated: String,
    },

    #[error("ZIP 317 fee rule evaluation error: {0}")]
    Zip317Error(String),

    #[error("Value balance error: {0}")]
    BalanceError(String),

    #[error("Orchard builder error: {0}")]
    BuilderError(String),

    #[error("Orchard zero-knowledge proving error: {0}")]
    ProvingError(String),

    #[error("Orchard spend authorization / binding signing error: {0}")]
    SigningError(String),

    #[error("Failed to freeze transaction: {0}")]
    FreezeError(String),

    #[error("Failed to serialize transaction: {0}")]
    SerializationError(String),
}

/// Outgoing Viewing Key (OVK) policy for note encryption.
///
/// Under ZIP 316 / ZIP 302, senders should encrypt outgoing ciphertexts with an OVK
/// so that the sender wallet can decrypt and recover payment history.
#[derive(Debug, Clone, Default)]
pub enum OvkPolicy {
    /// Derive the OVK directly from the sender's FullViewingKey (external scope).
    ///
    /// This is the default. The sender retains the ability to decrypt sent notes.
    #[default]
    SenderFvk,

    /// Use an explicit custom OutgoingViewingKey.
    Custom(OutgoingViewingKey),

    /// Explicit opt-out: no OVK is used (`None`).
    ///
    /// The note ciphertext will not be recoverable by the sender.
    None,
}

impl PartialEq for OvkPolicy {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (OvkPolicy::SenderFvk, OvkPolicy::SenderFvk) => true,
            (OvkPolicy::None, OvkPolicy::None) => true,
            (OvkPolicy::Custom(a), OvkPolicy::Custom(b)) => a.as_ref() == b.as_ref(),
            _ => false,
        }
    }
}

impl Eq for OvkPolicy {}

/// A spend input specifying a note, its Merkle witness path, and an optional custom key.
#[derive(Debug, Clone)]
pub struct SpendInput {
    pub note: Note,
    pub merkle_path: MerklePath,
    /// Optional spending key if this note was received by a different key than the primary
    /// transaction sender key. If `None`, the transaction's primary spending key is used.
    pub spending_key: Option<SpendingKey>,
}

impl SpendInput {
    /// Creates a spend input using the transaction's primary spending key.
    pub fn new(note: Note, merkle_path: MerklePath) -> Self {
        Self {
            note,
            merkle_path,
            spending_key: None,
        }
    }

    /// Creates a spend input with an explicit custom spending key.
    pub fn with_custom_key(
        note: Note,
        merkle_path: MerklePath,
        spending_key: SpendingKey,
    ) -> Self {
        Self {
            note,
            merkle_path,
            spending_key: Some(spending_key),
        }
    }
}

/// Specification for a transaction output note.
#[derive(Debug, Clone)]
pub struct OutputSpec {
    pub recipient: Address,
    pub value: NoteValue,
    /// Optional memo. If `None`, defaults to ZIP 302 empty memo (`0xF6` followed by 511 zeroes).
    pub memo: Option<[u8; 512]>,
    /// OVK policy. Defaults to `OvkPolicy::SenderFvk` (sender can decrypt).
    pub ovk_policy: OvkPolicy,
}

impl OutputSpec {
    /// Creates a new output specification with default memo (ZIP 302 `0xF6` + 511 zeroes)
    /// and default OVK policy (`OvkPolicy::SenderFvk`).
    pub fn new(recipient: Address, value: NoteValue) -> Self {
        Self {
            recipient,
            value,
            memo: None,
            ovk_policy: OvkPolicy::SenderFvk,
        }
    }

    /// Creates an output with an explicit 512-byte memo.
    pub fn with_memo(recipient: Address, value: NoteValue, memo: [u8; 512]) -> Self {
        Self {
            recipient,
            value,
            memo: Some(memo),
            ovk_policy: OvkPolicy::SenderFvk,
        }
    }

    /// Sets the memo byte array.
    pub fn with_memo_bytes(mut self, memo: [u8; 512]) -> Self {
        self.memo = Some(memo);
        self
    }

    /// Sets the OVK policy (e.g. `OvkPolicy::None` for explicit opt-out).
    pub fn with_ovk_policy(mut self, ovk_policy: OvkPolicy) -> Self {
        self.ovk_policy = ovk_policy;
        self
    }
}

/// Configuration and consensus parameters for building a V6 Ironwood transaction.
#[derive(Debug, Clone)]
pub struct TransactionConfig {
    /// Consensus branch ID (e.g. `BranchId::Nu6_3`).
    pub branch_id: BranchId,

    /// Transaction anchor (root of the Ironwood commitment tree).
    ///
    /// ## Anchor Height Selection
    /// In Zcash, the anchor represents the root of the note commitment tree at a specific block height.
    /// To maximize robustness against chain reorgs and network propagation delays:
    /// - The anchor should NOT be chosen at the absolute chain tip. If the chain tip reorgs by even
    ///   1 block, a transaction anchored to that tip becomes invalid immediately.
    /// - Instead, choose an anchor a few blocks below the tip (e.g. `tip - 5` to `tip - 10`).
    /// - Any anchor within the last 100 blocks is valid under consensus rules (ZIP 209 / ZIP 212),
    ///   so choosing `tip - 5` provides high reorg resilience while remaining well within the
    ///   100-block window.
    pub anchor: orchard::Anchor,

    /// Optional anchor block height for documentation / reference tracking.
    pub anchor_height: Option<BlockHeight>,

    /// Expiry block height after which miners will reject this transaction if unmined.
    /// Defaults to `target_height + DEFAULT_EXPIRY_DELTA` (typically tip + 40).
    pub expiry_height: BlockHeight,

    /// Whether to allow a fee that differs from the conventional ZIP 317 fee.
    ///
    /// If `false` (default), the builder strictly requires:
    /// `total_spends - total_outputs == zip317_fee`.
    /// Leftover value can never silently become fee.
    pub allow_custom_fee: bool,
}

impl TransactionConfig {
    /// Creates a transaction configuration with standard defaults given the tip height,
    /// anchor, and branch ID.
    ///
    /// The anchor height is recorded as `tip_height - DEFAULT_ANCHOR_OFFSET` (5 blocks below tip).
    /// The expiry height defaults to `tip_height + DEFAULT_EXPIRY_DELTA` (40 blocks above tip).
    /// `allow_custom_fee` defaults to `false`.
    pub fn new(
        branch_id: BranchId,
        anchor: orchard::Anchor,
        tip_height: BlockHeight,
        anchor_offset: Option<u32>,
    ) -> Self {
        let offset = anchor_offset.unwrap_or(DEFAULT_ANCHOR_OFFSET);
        let anchor_height = BlockHeight::from_u32(u32::from(tip_height).saturating_sub(offset));
        let expiry_height = BlockHeight::from_u32(u32::from(tip_height) + DEFAULT_EXPIRY_DELTA);
        Self {
            branch_id,
            anchor,
            anchor_height: Some(anchor_height),
            expiry_height,
            allow_custom_fee: false,
        }
    }

    /// Sets the expiry height explicitly.
    pub fn with_expiry_height(mut self, expiry_height: BlockHeight) -> Self {
        self.expiry_height = expiry_height;
        self
    }

    /// Sets whether custom (non-standard ZIP 317) fees are allowed.
    pub fn with_allow_custom_fee(mut self, allow_custom_fee: bool) -> Self {
        self.allow_custom_fee = allow_custom_fee;
        self
    }
}

/// Result of building, proving, and signing a V6 Ironwood transaction.
///
/// Contains wire bytes, txid, fee, and metadata.
/// **Notice**: Contains NO secret key material (ask, sk, seed).
#[derive(Debug, Clone)]
pub struct BuiltTransaction {
    /// 32-byte transaction ID.
    pub txid: TxId,
    /// Canonical serialized wire bytes ready for network broadcast.
    pub raw_bytes: Vec<u8>,
    /// Net fee paid in zatoshis (`total_spends - total_outputs`).
    pub fee: Zatoshis,
    /// Number of actions in the Ironwood bundle (padded to minimum 2).
    pub num_actions: usize,
    /// Block height at which this transaction expires.
    pub expiry_height: BlockHeight,
    /// Parsed frozen transaction data.
    pub transaction: Transaction,
}

/// Calculates the recommended anchor block height given the current tip.
///
/// Considers `DEFAULT_ANCHOR_OFFSET` (5 blocks below tip) unless an explicit offset is provided.
pub fn choose_recommended_anchor_height(
    tip_height: BlockHeight,
    offset: Option<u32>,
) -> BlockHeight {
    let off = offset.unwrap_or(DEFAULT_ANCHOR_OFFSET);
    BlockHeight::from_u32(u32::from(tip_height).saturating_sub(off))
}

/// Computes the conventional ZIP 317 fee for a given count of spends and outputs.
///
/// In Orchard / Ironwood with default minimum padding (2 actions), the logical action count
/// is `max(max(num_spends, num_outputs), 2)`.
pub fn compute_zip317_fee(
    num_spends: usize,
    num_outputs: usize,
) -> Result<Zatoshis, TransactionBuildError> {
    let actions = max(max(num_spends, num_outputs), 2);
    FeeRule::standard()
        .fee_required(
            &zcash_protocol::consensus::MAIN_NETWORK,
            BlockHeight::from_u32(1),
            iter::empty::<InputSize>(),
            iter::empty::<usize>(),
            0,
            0,
            0,
            actions,
        )
        .map_err(|e| TransactionBuildError::Zip317Error(e.to_string()))
}

/// A builder for constructing, proving, and signing V6 Ironwood transactions.
pub struct TransactionBuilder<'a> {
    spending_key: &'a SpendingKey,
    spends: Vec<SpendInput>,
    outputs: Vec<OutputSpec>,
    config: TransactionConfig,
}

impl<'a> TransactionBuilder<'a> {
    /// Creates a new builder with the primary sender's spending key and transaction configuration.
    pub fn new(spending_key: &'a SpendingKey, config: TransactionConfig) -> Self {
        Self {
            spending_key,
            spends: Vec::new(),
            outputs: Vec::new(),
            config,
        }
    }

    /// Adds a spend input.
    pub fn add_spend(&mut self, spend: SpendInput) -> &mut Self {
        self.spends.push(spend);
        self
    }

    /// Adds an output specification.
    pub fn add_output(&mut self, output: OutputSpec) -> &mut Self {
        self.outputs.push(output);
        self
    }

    /// Builds, proves with the given `ProvingKey`, signs, and serializes the transaction.
    ///
    /// ## Security Guarantees
    /// 1. **ZIP 317 Fee Verification**: Checks that `spends - outputs == conventional_fee`.
    ///    Fails with `FeeMismatch` if leftover funds exist unless `config.allow_custom_fee` is true.
    /// 2. **Key Derivation in Rust**: Derives `FullViewingKey` and `SpendAuthorizingKey`
    ///    internally from the spending key.
    /// 3. **ZIP 302 Default Memo**: Outputs without explicit memos receive `0xF6` + 511 zeroes.
    /// 4. **OVK Handling**: Automatically sets OVK from the sender's FVK unless `OvkPolicy::None`.
    /// 5. **Default Padding**: Enforces `BundleType::DEFAULT` (padded to minimum 2 actions).
    /// 6. **Zero unwraps**: All errors are returned via `Result<BuiltTransaction, TransactionBuildError>`.
    pub fn build_and_prove(
        &self,
        pk: &ProvingKey,
    ) -> Result<BuiltTransaction, TransactionBuildError> {
        if self.spends.is_empty() {
            return Err(TransactionBuildError::EmptyInputs);
        }
        if self.outputs.is_empty() {
            return Err(TransactionBuildError::EmptyOutputs);
        }

        // 1. Validate value totals and calculate net fee
        let total_spends: u64 = self
            .spends
            .iter()
            .map(|s| s.note.value().inner())
            .sum();
        let total_outputs: u64 = self
            .outputs
            .iter()
            .map(|o| o.value.inner())
            .sum();

        if total_spends < total_outputs {
            return Err(TransactionBuildError::InsufficientFunds {
                spends_total: total_spends,
                outputs_total: total_outputs,
            });
        }

        let actual_fee_i64 = (total_spends as i64)
            .checked_sub(total_outputs as i64)
            .ok_or_else(|| {
                TransactionBuildError::BalanceError("Calculation underflow computing fee".to_string())
            })?;

        // 2. Validate Merkle paths match the anchor before starting expensive proving
        for (i, spend) in self.spends.iter().enumerate() {
            let cmx: orchard::note::ExtractedNoteCommitment = spend.note.commitment().into();
            let root = spend.merkle_path.root(cmx);
            if root != self.config.anchor {
                return Err(TransactionBuildError::AnchorMismatch {
                    index: i,
                    expected: hex::encode(self.config.anchor.to_bytes()),
                    calculated: hex::encode(root.to_bytes()),
                });
            }
        }

        // 3. Derive viewing key for primary sender
        let sender_fvk = FullViewingKey::from(self.spending_key);

        // 4. Initialize Orchard Builder with default padding (min 2 actions)
        let mut builder = Builder::new(
            BundleType::DEFAULT,
            BundleVersion::ironwood_v3(),
            Flags::ENABLED,
            self.config.anchor,
        )
        .map_err(|e| TransactionBuildError::BuilderError(format!("Failed to init builder: {:?}", e)))?;

        // 5. Add spend inputs
        for spend in &self.spends {
            let sk = spend.spending_key.as_ref().unwrap_or(self.spending_key);
            let fvk = FullViewingKey::from(sk);
            builder
                .add_spend(fvk, spend.note, spend.merkle_path.clone())
                .map_err(|e| {
                    TransactionBuildError::BuilderError(format!("Failed to add spend: {:?}", e))
                })?;
        }

        // 6. Add outputs with ZIP 302 memo default & OVK policy
        for output in &self.outputs {
            let ovk = match &output.ovk_policy {
                OvkPolicy::SenderFvk => Some(sender_fvk.to_ovk(Scope::External)),
                OvkPolicy::Custom(custom) => Some(custom.clone()),
                OvkPolicy::None => None,
            };
            let memo = output.memo.unwrap_or(ZIP302_NO_MEMO);
            builder
                .add_output(ovk, output.recipient, output.value, memo)
                .map_err(|e| {
                    TransactionBuildError::BuilderError(format!("Failed to add output: {:?}", e))
                })?;
        }

        // 7. Synthesize unproven bundle
        let mut rng = OsRng;
        let (unproven_bundle, _meta) = builder
            .build::<i64>(&mut rng)
            .map_err(|e| TransactionBuildError::BuilderError(format!("Build error: {:?}", e)))?
            .ok_or_else(|| {
                TransactionBuildError::BuilderError("No bundle was generated by builder".to_string())
            })?;

        let num_actions = unproven_bundle.actions().len();
        let bundle_value_balance = *unproven_bundle.value_balance();

        // 8. Conventional ZIP 317 fee check
        let conventional_fee = FeeRule::standard()
            .fee_required(
                &zcash_protocol::consensus::MAIN_NETWORK,
                BlockHeight::from_u32(1),
                iter::empty::<InputSize>(),
                iter::empty::<usize>(),
                0,
                0,
                0,
                num_actions,
            )
            .map_err(|e| TransactionBuildError::Zip317Error(e.to_string()))?;

        let conventional_fee_u64 = u64::from(conventional_fee);

        if !self.config.allow_custom_fee && (actual_fee_i64 as u64 != conventional_fee_u64) {
            return Err(TransactionBuildError::FeeMismatch {
                required_zatoshis: conventional_fee_u64,
                actual_fee: actual_fee_i64,
                spends_total: total_spends,
                outputs_total: total_outputs,
            });
        }

        // Verify value balance matches actual fee
        if bundle_value_balance != actual_fee_i64 {
            return Err(TransactionBuildError::BalanceError(format!(
                "Bundle value balance {} does not match expected fee {}",
                bundle_value_balance, actual_fee_i64
            )));
        }

        // 9. Assemble V6 TransactionData<Unauthorized> to compute canonical V6 sighash
        let unproven_bundle_zat = unproven_bundle
            .clone()
            .try_map_value_balance(ZatBalance::from_i64)
            .map_err(|e| TransactionBuildError::BalanceError(format!("Invalid ZatBalance: {:?}", e)))?;

        let tx_for_sighash: TransactionData<Unauthorized> = TransactionData::from_parts_v6(
            self.config.branch_id,
            0, // lock_time
            self.config.expiry_height,
            None, // transparent_bundle
            None, // spk
            None, // sapling_bundle
            Some(unproven_bundle_zat),
        );

        let txid_parts = tx_for_sighash.digest(TxIdDigester);
        let sighash = v6_signature_hash(&tx_for_sighash, &SignableInput::Shielded, &txid_parts);
        let sighash_bytes: [u8; 32] = match sighash.as_bytes().try_into() {
            Ok(b) => b,
            Err(_) => {
                return Err(TransactionBuildError::SigningError(
                    "Invalid sighash byte length".to_string(),
                ));
            }
        };

        // 10. Generate Halo 2 zero-knowledge proof
        let proven_bundle = unproven_bundle
            .create_proof(pk, &mut rng)
            .map_err(|e| TransactionBuildError::ProvingError(format!("{:?}", e)))?;

        // 11. Derive spend authorization keys and apply RedPallas signatures
        let asks: Vec<SpendAuthorizingKey> = self
            .spends
            .iter()
            .map(|s| {
                let sk = s.spending_key.as_ref().unwrap_or(self.spending_key);
                SpendAuthorizingKey::from(sk)
            })
            .collect();

        let authorized_bundle = proven_bundle
            .apply_signatures(rng, sighash_bytes, &asks)
            .map_err(|e| TransactionBuildError::SigningError(format!("{:?}", e)))?;

        // 12. Freeze into final authorized Transaction
        let authorized_bundle_zat = authorized_bundle
            .try_map_value_balance(ZatBalance::from_i64)
            .map_err(|e| TransactionBuildError::BalanceError(format!("Invalid ZatBalance: {:?}", e)))?;

        let final_tx_data = TransactionData::from_parts_v6(
            self.config.branch_id,
            0,
            self.config.expiry_height,
            None,
            None,
            None,
            Some(authorized_bundle_zat),
        );

        let tx = final_tx_data
            .freeze()
            .map_err(|e| TransactionBuildError::FreezeError(format!("{:?}", e)))?;

        let txid = tx.txid();
        let mut raw_bytes = Vec::new();
        tx.write(&mut raw_bytes)
            .map_err(|e| TransactionBuildError::SerializationError(e.to_string()))?;

        let fee_zatoshis = Zatoshis::from_nonnegative_i64(actual_fee_i64)
            .map_err(|e| TransactionBuildError::BalanceError(format!("Invalid fee zatoshis: {:?}", e)))?;

        Ok(BuiltTransaction {
            txid,
            raw_bytes,
            fee: fee_zatoshis,
            num_actions,
            expiry_height: self.config.expiry_height,
            transaction: tx,
        })
    }
}

/// Convenience function to build, prove, and sign a V6 Ironwood transaction.
pub fn build_and_prove_v6_ironwood_tx(
    spending_key: &SpendingKey,
    spends: Vec<SpendInput>,
    outputs: Vec<OutputSpec>,
    config: &TransactionConfig,
    pk: &ProvingKey,
) -> Result<BuiltTransaction, TransactionBuildError> {
    let mut builder = TransactionBuilder::new(spending_key, config.clone());
    for s in spends {
        builder.add_spend(s);
    }
    for o in outputs {
        builder.add_output(o);
    }
    builder.build_and_prove(pk)
}
