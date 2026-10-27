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
