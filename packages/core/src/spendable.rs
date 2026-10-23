#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use incrementalmerkletree::Position;
use orchard::note::{Note, NoteVersion, RandomSeed, Rho};
use orchard::tree::MerklePath;
use orchard::value::NoteValue;
use orchard::Address;
use rusqlite::{params, Connection};
use zcash_address::unified::{Container, Encoding};
use zcash_protocol::consensus::BlockHeight;

use crate::scanner::WalletError;
use crate::shard_store::SqliteShardStore;
use crate::transaction::SpendInput;
use crate::IronwoodShardTree;

/// Represents a note confirmed on chain that is available to be spent.
#[derive(Debug, Clone)]
pub struct SpendableNote {
    pub id: i64,
    pub note: Note,
    pub merkle_path: MerklePath,
    pub nullifier: [u8; 32],
    pub height: u32,
    pub tree_position: u64,
    pub value_zatoshis: u64,
}

impl From<&SpendableNote> for SpendInput {
    fn from(s: &SpendableNote) -> Self {
        SpendInput::new(s.note, s.merkle_path.clone())
    }
}

/// Parses a recipient address from either a unified address string or raw hex bytes.
pub fn parse_recipient_address(recipient_str: &str) -> Option<Address> {
    if let Ok(raw_bytes) = hex::decode(recipient_str) {
        if raw_bytes.len() == 43 {
            let mut arr = [0u8; 43];
            arr.copy_from_slice(&raw_bytes);
            return Address::from_raw_address_bytes(&arr).into_option();
        }
    }

    if let Ok((_net, ua)) = zcash_address::unified::Address::decode(recipient_str) {
        for receiver in ua.items() {
            if let zcash_address::unified::Receiver::Orchard(bytes) = receiver {
                return Address::from_raw_address_bytes(&bytes).into_option();
            }
        }
    }

    None
}

/// Queries spendable notes from the wallet DB at the specified `anchor_height` and `min_confs`.
///
/// ### Confirmation Convention
/// Confirmations are defined as:
/// `confirmations = anchor_height + 1 - height`
///
/// Requirements enforced:
/// 1. `height <= anchor_height`: A note mined after the anchor height cannot be witnessed at this anchor.
/// 2. `anchor_height + 1 - height >= min_confs`: Requires at least `min_confs` confirmations relative to the anchor.
/// 3. `nullifier NOT IN (SELECT nullifier FROM pending_spends WHERE state IN ('reserved', 'broadcast', 'mined'))`: Excludes notes with in-flight reservations or confirmed spends.
/// 4. Merkle paths are computed at exactly the anchor checkpoint.
/// 5. A note that cannot be witnessed at that anchor (e.g. pruned checkpoint mark) is strictly excluded, never returned with a bad path.
pub fn query_spendable_notes(
    conn: &Connection,
    anchor_height: u32,
    min_confs: u32,
) -> Result<Vec<SpendableNote>, WalletError> {
    let store = SqliteShardStore::new(conn, "ironwood_tree");
    let tree = crate::IronwoodShardTree::new(store, 100);
    query_spendable_notes_with_tree(conn, &tree, anchor_height, min_confs)
}

/// Queries spendable notes using an existing `IronwoodShardTree` instance.
pub fn query_spendable_notes_with_tree(
    conn: &Connection,
    tree: &IronwoodShardTree<SqliteShardStore>,
    anchor_height: u32,
    min_confs: u32,
) -> Result<Vec<SpendableNote>, WalletError> {
    let mut stmt = conn.prepare_cached(
        "SELECT id, recipient, value_zatoshis, nullifier, rho, rseed, tree_position, height
         FROM received_notes
         WHERE spent_in_txid IS NULL
           AND height <= ?1
           AND (?1 + 1 - height) >= ?2
           AND nullifier NOT IN (
               SELECT nullifier FROM pending_spends 
               WHERE state IN ('reserved', 'broadcast', 'mined')
           )
         ORDER BY height ASC, tree_position ASC",
    )?;

    let rows = stmt.query_map(
        params![anchor_height as i64, min_confs as i64],
        |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, Vec<u8>>(3)?,
                row.get::<_, Vec<u8>>(4)?,
                row.get::<_, Vec<u8>>(5)?,
                row.get::<_, i64>(6)?,
                row.get::<_, i64>(7)?,
            ))
        },
    )?;

    let mut spendable = Vec::new();
    let anchor_checkpoint = BlockHeight::from_u32(anchor_height);

    for r in rows {
        let (id, recipient_str, value_zat, nf_bytes, rho_bytes, rseed_bytes, tree_pos, height) = r?;

        if nf_bytes.len() != 32 || rho_bytes.len() != 32 || rseed_bytes.len() != 32 {
            continue;
        }

        let mut nf_arr = [0u8; 32];
        nf_arr.copy_from_slice(&nf_bytes);

        let mut rho_arr = [0u8; 32];
        rho_arr.copy_from_slice(&rho_bytes);
        let rho = match Rho::from_bytes(&rho_arr).into_option() {
            Some(r) => r,
            None => continue,
        };

        let mut rseed_arr = [0u8; 32];
        rseed_arr.copy_from_slice(&rseed_bytes);
        let rseed = match RandomSeed::from_bytes(rseed_arr, &rho).into_option() {
            Some(s) => s,
            None => continue,
        };

        let recipient = match parse_recipient_address(&recipient_str) {
            Some(a) => a,
            None => continue,
        };

        let note_value = NoteValue::from_raw(value_zat as u64);
        let note = match Note::from_parts(recipient, note_value, rho, rseed, NoteVersion::V3).into_option() {
            Some(n) => n,
            None => continue,
        };

        // Compute Merkle path at the exact anchor checkpoint
        let position = Position::from(tree_pos as u64);
        let witness_opt = tree.witness_at_checkpoint_id(position, &anchor_checkpoint)?;

        // Exclude note if it cannot be witnessed at this anchor
        if let Some(merkle_path) = witness_opt {
            spendable.push(SpendableNote {
                id,
                note,
                merkle_path: merkle_path.into(),
                nullifier: nf_arr,
                height: height as u32,
                tree_position: tree_pos as u64,
                value_zatoshis: value_zat as u64,
            });
        }
    }

    Ok(spendable)
}
