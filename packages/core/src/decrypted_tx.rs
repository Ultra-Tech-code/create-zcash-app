#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::HashMap;
use std::io::Cursor;

use zcash_client_backend::{decrypt_transaction, TransferType};
use zcash_keys::address::UnifiedAddress;
use zcash_keys::keys::UnifiedFullViewingKey;
use zcash_primitives::transaction::Transaction;
use zcash_protocol::consensus::{BlockHeight, BranchId};
use zcash_protocol::memo::{Memo, MemoBytes};

use crate::{get_params_for_network, DynamicNetwork};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecryptedMemo {
    pub text: Option<String>,
    pub hex: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecryptedActionIncoming {
    pub action_index: u32,
    pub value: i64,
    pub memo: DecryptedMemo,
    pub recipient: String,
    pub is_change: bool,
    pub is_internal: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecryptedActionOutgoing {
    pub action_index: u32,
    pub value: i64,
    pub memo: DecryptedMemo,
    pub recipient: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecryptedTransactionResult {
    pub txid: String,
    pub fee: Option<i64>,
    pub expiry_height: u32,
    pub consensus_branch_id: String,
    pub incoming: Vec<DecryptedActionIncoming>,
    pub outgoing: Vec<DecryptedActionOutgoing>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedActionCounts {
    pub transparent_inputs: u32,
    pub transparent_outputs: u32,
    pub sapling_spends: u32,
    pub sapling_outputs: u32,
    pub orchard_actions: u32,
    pub ironwood_actions: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedAnchors {
    pub sapling: Option<String>,
    pub orchard: Option<String>,
    pub ironwood: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedTransactionResult {
    pub txid: String,
    pub version: u32,
    pub consensus_branch_id: String,
    pub expiry_height: u32,
    pub fee: Option<i64>,
    pub pools: Vec<String>,
    pub action_counts: DecodedActionCounts,
    pub anchors: DecodedAnchors,
    pub nullifiers: Vec<String>,
    pub note_commitments: Vec<String>,
    pub size: usize,
}

pub fn parse_decrypted_memo(memo_bytes: &MemoBytes) -> DecryptedMemo {
    let memo_parsed = Memo::try_from(memo_bytes.clone()).ok();
    match memo_parsed {
        Some(Memo::Text(t)) => {
            let s = t.to_string();
            let hex_str = hex::encode(s.as_bytes());
            DecryptedMemo {
                text: Some(s),
                hex: hex_str,
            }
        }
        Some(Memo::Empty) => DecryptedMemo {
            text: None,
            hex: String::new(),
        },
        _ => {
            let raw_slice = memo_bytes.as_slice();
            if raw_slice.is_empty() {
                DecryptedMemo {
                    text: None,
                    hex: String::new(),
                }
            } else {
                let text = std::str::from_utf8(raw_slice).ok().map(|s| s.to_string());
                DecryptedMemo {
                    text,
                    hex: hex::encode(raw_slice),
                }
            }
        }
    }
}

pub fn internal_decrypt_transaction(
    ufvk_str: &str,
    network_str: &str,
    raw_tx_bytes: &[u8],
    height: u32,
) -> Result<DecryptedTransactionResult, String> {
    let params = get_params_for_network(network_str);
    let ufvk = UnifiedFullViewingKey::decode(&params, ufvk_str)
        .map_err(|e| format!("Failed to decode UFVK: {:?}", e))?;

    let block_height = BlockHeight::from_u32(height);
    let branch_id = BranchId::for_height(&params, block_height);
    let branch_id_hex = format!("{:08x}", u32::from(branch_id));

    let mut cursor = Cursor::new(raw_tx_bytes);
    let tx = Transaction::read(&mut cursor, branch_id)
        .map_err(|e| format!("Failed to deserialize transaction bytes: {:?}", e))?;

    let txid_hex = tx.txid().to_string();
    let expiry_height = u32::from(tx.expiry_height());

    // Compute fee as the sum of all value balances (transparent in - out, sapling, orchard, ironwood).
    // If transparent inputs are present without known prevout amounts or if the overall balance
    // is incomputable, fee_paid returns None (null) rather than silently defaulting to 0.
    let fee = tx
        .fee_paid(|_| Ok::<Option<zcash_protocol::value::Zatoshis>, zcash_protocol::value::BalanceError>(None))
        .ok()
        .flatten()
        .map(|z| u64::from(z) as i64);

    let mut ufvks = HashMap::new();
    ufvks.insert(0u32, ufvk);

    let dec = match &params {
        DynamicNetwork::Regtest(p) => decrypt_transaction(p, Some(block_height), None, &tx, &ufvks),
        DynamicNetwork::Test(p) => decrypt_transaction(p, Some(block_height), None, &tx, &ufvks),
        DynamicNetwork::Main(p) => decrypt_transaction(p, Some(block_height), None, &tx, &ufvks),
    };

    let mut incoming = Vec::new();
    let mut outgoing = Vec::new();

    for out in dec.ironwood_outputs() {
        let (note, _pool) = out.note();
        let value = note.value().inner() as i64;
        let memo = parse_decrypted_memo(out.memo());
        let recipient_addr = note.recipient();
        let recipient_ua = UnifiedAddress::from_receivers(Some(recipient_addr), None, None, None, None)
            .map(|u| u.encode(&params))
            .unwrap_or_default();
        let action_index = out.index() as u32;

        match out.transfer_type() {
            TransferType::Incoming => {
                incoming.push(DecryptedActionIncoming {
                    action_index,
                    value,
                    memo,
                    recipient: recipient_ua,
                    is_change: false,
                    is_internal: false,
                });
            }
            TransferType::AccountInternal => {
                incoming.push(DecryptedActionIncoming {
                    action_index,
                    value,
                    memo,
                    recipient: recipient_ua,
                    is_change: true,
                    is_internal: true,
                });
            }
            TransferType::Outgoing => {
                outgoing.push(DecryptedActionOutgoing {
                    action_index,
                    value,
                    memo,
                    recipient: recipient_ua,
                });
            }
            TransferType::WalletInternal => {
                // Shielded cross-account transfers are handled via Incoming/Outgoing
            }
        }
    }

    Ok(DecryptedTransactionResult {
        txid: txid_hex,
        fee,
        expiry_height,
        consensus_branch_id: branch_id_hex,
        incoming,
        outgoing,
    })
}

fn determine_branch_id_from_bytes(
    raw_tx_bytes: &[u8],
    params: &DynamicNetwork,
) -> Result<BranchId, String> {
    if raw_tx_bytes.len() < 4 {
        return Err("Transaction bytes too short".to_string());
    }
    let header_bytes: [u8; 4] = match raw_tx_bytes[0..4].try_into() {
        Ok(b) => b,
        Err(_) => return Err("Failed to read header bytes".to_string()),
    };
    let header = u32::from_le_bytes(header_bytes);
    let overwintered = (header & 0x8000_0000) != 0;
    let version = header & 0x7FFF_FFFF;

    if overwintered && version >= 5 && raw_tx_bytes.len() >= 12 {
        let branch_bytes: [u8; 4] = match raw_tx_bytes[8..12].try_into() {
            Ok(b) => b,
            Err(_) => return Err("Failed to read branch id bytes".to_string()),
        };
        let branch_id_u32 = u32::from_le_bytes(branch_bytes);
        if let Ok(bid) = BranchId::try_from(branch_id_u32) {
            return Ok(bid);
        }
    } else if overwintered && version == 4 && raw_tx_bytes.len() >= 4 {
        let len = raw_tx_bytes.len();
        let branch_bytes: [u8; 4] = match raw_tx_bytes[len - 4..len].try_into() {
            Ok(b) => b,
            Err(_) => return Err("Failed to read v4 branch id bytes".to_string()),
        };
        let branch_id_u32 = u32::from_le_bytes(branch_bytes);
        if let Ok(bid) = BranchId::try_from(branch_id_u32) {
            return Ok(bid);
        }
    }

    Ok(BranchId::for_height(params, BlockHeight::from_u32(5_000_000)))
}

pub fn internal_decode_transaction(
    raw_tx_bytes: &[u8],
    network_str: Option<&str>,
    height: Option<u32>,
) -> Result<DecodedTransactionResult, String> {
    if raw_tx_bytes.is_empty() {
        return Err("Empty transaction bytes".to_string());
    }

    let network = network_str.unwrap_or("testnet");
    let params = get_params_for_network(network);

    let branch_id = if let Some(h) = height {
        if h > 0 {
            BranchId::for_height(&params, BlockHeight::from_u32(h))
        } else {
            determine_branch_id_from_bytes(raw_tx_bytes, &params)?
        }
    } else {
        determine_branch_id_from_bytes(raw_tx_bytes, &params)?
    };

    let mut cursor = Cursor::new(raw_tx_bytes);
    let tx = Transaction::read(&mut cursor, branch_id)
        .map_err(|e| format!("Failed to deserialize transaction bytes: {:?}", e))?;

    let txid = tx.txid().to_string();
    let version = tx.version().header() & 0x7FFF_FFFF;
    let consensus_branch_id = format!("{:08x}", u32::from(branch_id));
    let expiry_height = u32::from(tx.expiry_height());

    let fee = tx
        .fee_paid(|_| Ok::<Option<zcash_protocol::value::Zatoshis>, zcash_protocol::value::BalanceError>(None))
        .ok()
        .flatten()
        .map(|z| u64::from(z) as i64);

    let mut pools = Vec::new();
    let mut nullifiers = Vec::new();
    let mut note_commitments = Vec::new();
    let mut sapling_anchor = None;
    let mut orchard_anchor = None;
    let mut ironwood_anchor = None;

    let (t_in, t_out) = if let Some(tb) = tx.transparent_bundle() {
        let vin_len = tb.vin.len() as u32;
        let vout_len = tb.vout.len() as u32;
        if vin_len > 0 || vout_len > 0 {
            pools.push("transparent".to_string());
        }
        (vin_len, vout_len)
    } else {
        (0, 0)
    };

    let (s_spends, s_outputs) = if let Some(sb) = tx.sapling_bundle() {
        let spends = sb.shielded_spends();
        let outputs = sb.shielded_outputs();
        if !spends.is_empty() || !outputs.is_empty() {
            pools.push("sapling".to_string());
        }
        for s in spends {
            nullifiers.push(hex::encode(s.nullifier().0));
            if sapling_anchor.is_none() {
                sapling_anchor = Some(hex::encode(s.anchor().to_bytes()));
            }
        }
        for o in outputs {
            note_commitments.push(hex::encode(o.cmu().to_bytes()));
        }
        (spends.len() as u32, outputs.len() as u32)
    } else {
        (0, 0)
    };

    let o_actions = if let Some(ob) = tx.orchard_bundle() {
        let acts = ob.actions();
        if !acts.is_empty() {
            pools.push("orchard".to_string());
            orchard_anchor = Some(hex::encode(ob.anchor().to_bytes()));
        }
        for a in acts {
            nullifiers.push(hex::encode(a.nullifier().to_bytes()));
            note_commitments.push(hex::encode(a.cmx().to_bytes()));
        }
        acts.len() as u32
    } else {
        0
    };

    let iw_actions = if let Some(ib) = tx.ironwood_bundle() {
        let acts = ib.actions();
        if !acts.is_empty() {
            pools.push("ironwood".to_string());
            ironwood_anchor = Some(hex::encode(ib.anchor().to_bytes()));
        }
        for a in acts {
            nullifiers.push(hex::encode(a.nullifier().to_bytes()));
            note_commitments.push(hex::encode(a.cmx().to_bytes()));
        }
        acts.len() as u32
    } else {
        0
    };

    Ok(DecodedTransactionResult {
        txid,
        version,
        consensus_branch_id,
        expiry_height,
        fee,
        pools,
        action_counts: DecodedActionCounts {
            transparent_inputs: t_in,
            transparent_outputs: t_out,
            sapling_spends: s_spends,
            sapling_outputs: s_outputs,
            orchard_actions: o_actions,
            ironwood_actions: iw_actions,
        },
        anchors: DecodedAnchors {
            sapling: sapling_anchor,
            orchard: orchard_anchor,
            ironwood: ironwood_anchor,
        },
        nullifiers,
        note_commitments,
        size: raw_tx_bytes.len(),
    })
}
