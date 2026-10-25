#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use incrementalmerkletree::Retention;
use orchard::keys::{FullViewingKey, PreparedIncomingViewingKey, Scope};
use orchard::note::ExtractedNoteCommitment;
use orchard::note_encryption::{CompactAction, IronwoodDomain};
use orchard::tree::MerkleHashOrchard;
use orchard::Address;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;
use zcash_keys::address::UnifiedAddress;
use zcash_note_encryption::{try_compact_note_decryption, EphemeralKeyBytes};
use zcash_protocol::consensus::BlockHeight;

use crate::shard_store::{ShardStoreError, SqliteShardStore};
use crate::DynamicNetwork;

pub const MAX_BLOCKS_PER_TX: usize = 50;
pub const TIME_BUDGET_MS: u128 = 500;

#[doc(hidden)]
pub static INJECT_BATCH_SLEEP_MS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

#[derive(Clone, PartialEq, ::prost::Message)]
pub struct ChainMetadata {
    #[prost(uint32, tag = "1")]
    pub sapling_commitment_tree_size: u32,
    #[prost(uint32, tag = "2")]
    pub orchard_commitment_tree_size: u32,
    #[prost(uint32, tag = "3")]
    pub ironwood_commitment_tree_size: u32,
}

#[derive(Clone, PartialEq, ::prost::Message)]
pub struct CompactBlock {
    #[prost(uint64, tag = "2")]
    pub height: u64,
    #[prost(bytes = "vec", tag = "3")]
    pub hash: Vec<u8>,
    #[prost(bytes = "vec", tag = "4")]
    pub prev_hash: Vec<u8>,
    #[prost(uint32, tag = "5")]
    pub time: u32,
    #[prost(bytes = "vec", tag = "6")]
    pub header: Vec<u8>,
    #[prost(message, repeated, tag = "7")]
    pub vtx: Vec<CompactTx>,
    #[prost(message, optional, tag = "8")]
    pub chain_metadata: Option<ChainMetadata>,
}

#[derive(Clone, PartialEq, ::prost::Message)]
pub struct CompactTx {
    #[prost(uint64, tag = "1")]
    pub index: u64,
    #[prost(bytes = "vec", tag = "2")]
    pub txid: Vec<u8>,
    #[prost(uint32, tag = "3")]
    pub fee: u32,
    #[prost(message, repeated, tag = "6")]
    pub actions: Vec<CompactOrchardAction>,
    #[prost(message, repeated, tag = "9")]
    pub ironwood_actions: Vec<CompactOrchardAction>,
}

#[derive(Clone, PartialEq, ::prost::Message)]
pub struct CompactOrchardAction {
    #[prost(bytes = "vec", tag = "1")]
    pub nullifier: Vec<u8>,
    #[prost(bytes = "vec", tag = "2")]
    pub cmx: Vec<u8>,
    #[prost(bytes = "vec", tag = "3")]
    pub ephemeral_key: Vec<u8>,
    #[prost(bytes = "vec", tag = "4")]
    pub ciphertext: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScanResult {
    Synced {
        last_scanned_height: u32,
        notes_detected: usize,
    },
    NeedAncestorHashes {
        from_height: u32,
        count: u32,
    },
}

#[derive(Error, Debug)]
pub enum WalletError {
    #[error("Database error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("Shard store error: {0}")]
    ShardStore(#[from] ShardStoreError),

    #[error("Shard tree error: {0}")]
    ShardTree(#[from] shardtree::error::ShardTreeError<ShardStoreError>),

    #[error("Missing or invalid Ironwood field: {0}")]
    MissingIronwoodField(String),

    #[error("Tree size gap at height {height}: expected {expected}, actual {actual}")]
    TreeSizeGap {
        expected: u32,
        actual: u32,
        height: u32,
    },

    #[error("Chain reset detected at height {height}: expected hash {expected}, actual {actual}")]
    ChainReset {
        expected: String,
        actual: String,
        height: u32,
    },

    #[error("Reorg too deep: height {height}, max depth {max_depth}")]
    ReorgTooDeep {
        height: u32,
        max_depth: u32,
    },

    #[error("Protobuf decode error: {0}")]
    ProtobufDecode(String),

    #[error("Cryptographic or decoding error: {0}")]
    Crypto(String),

    #[error("Transaction build error: {0}")]
    TransactionBuild(String),

    #[error("Note not spendable: {0}")]
    NoteNotSpendable(String),

    #[error("Stale reservation or lock error: {0}")]
    LockError(String),

    #[error("Fault injected: {0}")]
    FaultInjected(String),
}

thread_local! {
    /// Test hook: forces a fault before the next checkpoint commit.
    #[doc(hidden)]
    pub static INJECT_FAULT_BEFORE_CHECKPOINT: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

pub struct Scanner;

impl Scanner {
    /// Scans a contiguous batch of CompactBlocks atomically inside a `BEGIN IMMEDIATE` transaction.
    ///
    /// Strictly adheres to Ironwood-only scanning:
    /// - Only reads `tx.ironwood_actions` (field 9) and `chain_metadata.ironwood_commitment_tree_size`.
    /// - Fails loudly if `chain_metadata` is missing or if action byte lengths are invalid.
    /// - Verifies tree size continuity: asserts that `current_tree_size + block_iw_cmxs == metadata.ironwood_commitment_tree_size`.
    /// - Dual-scope trial decryption (External scope first, then Internal change scope).
    /// - Appends all block commitments to `IronwoodShardTree` (Marked for owned notes, Ephemeral otherwise).
    /// - Marks owned notes as spent when their nullifiers appear in block actions.
    pub fn scan_block_batch(
        conn: &mut Connection,
        account_id: &str,
        fvk: &FullViewingKey,
        network: &DynamicNetwork,
        blocks: &[CompactBlock],
    ) -> Result<ScanResult, WalletError> {
        if blocks.is_empty() {
            let last_height: Option<u32> = conn
                .query_row(
                    "SELECT height FROM scanned_blocks ORDER BY height DESC LIMIT 1",
                    [],
                    |row| row.get(0),
                )
                .optional()?;
            return Ok(ScanResult::Synced {
                last_scanned_height: last_height.unwrap_or(0),
                notes_detected: 0,
            });
        }

        let prepared_external = PreparedIncomingViewingKey::new(&fvk.to_ivk(Scope::External));
        let prepared_internal = PreparedIncomingViewingKey::new(&fvk.to_ivk(Scope::Internal));

        let mut block_idx = 0;
        let mut total_notes_detected = 0usize;
        let mut last_scanned_height = 0u32;

        while block_idx < blocks.len() {
            // Use BEGIN IMMEDIATE to acquire write lock upfront, preventing concurrent deadlocks
            let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
            let tx_start = std::time::Instant::now();
            let mut blocks_in_tx = 0;

            let first_block = &blocks[block_idx];

            // Upfront ChainReset verification: if block is at first_scanned_height, verify hash matches
            let first_scanned_h_val: Option<String> = tx
                .query_row(
                    "SELECT value FROM wallet_metadata WHERE key = 'first_scanned_height'",
                    [],
                    |row| row.get(0),
                )
                .optional()?;
            let first_scanned_hash_val: Option<String> = tx
                .query_row(
                    "SELECT value FROM wallet_metadata WHERE key = 'first_scanned_hash'",
                    [],
                    |row| row.get(0),
                )
                .optional()?;

            if let (Some(expected_h), Some(exp_hash)) = (first_scanned_h_val.as_ref(), first_scanned_hash_val.as_ref()) {
                let expected_h_num = expected_h.parse::<u64>().unwrap_or(first_block.height);
                if first_block.height == expected_h_num {
                    let block_hash_hex = hex::encode(&first_block.hash);
                    if &block_hash_hex != exp_hash {
                        return Err(WalletError::ChainReset {
                            expected: exp_hash.clone(),
                            actual: block_hash_hex,
                            height: first_block.height as u32,
                        });
                    }
                }
            }

            // Query tip of scanned_blocks
            let tip: Option<(u32, Vec<u8>, u32)> = tx
                .query_row(
                    "SELECT height, block_hash, tree_size FROM scanned_blocks ORDER BY height DESC LIMIT 1",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .optional()?;

            let mut current_tree_size = match tip {
                Some((last_h, ref last_hash, tree_sz)) => {
                    if first_block.height != (last_h as u64) + 1 {
                        // Check if block connects or if reorg ancestor hashes are needed
                        if first_block.prev_hash != *last_hash {
                            return Ok(ScanResult::NeedAncestorHashes {
                                from_height: last_h,
                                count: 10,
                            });
                        }
                    }
                    if first_block.prev_hash != *last_hash {
                        return Ok(ScanResult::NeedAncestorHashes {
                            from_height: last_h,
                            count: 10,
                        });
                    }
                    tree_sz
                }
                None => {
                    // First scan ever: record chain identity if not yet set
                    if first_scanned_h_val.is_none() {
                        tx.execute(
                            "INSERT OR REPLACE INTO wallet_metadata (key, value) VALUES ('first_scanned_height', ?1)",
                            params![first_block.height.to_string()],
                        )?;
                    }
                    if first_scanned_hash_val.is_none() {
                        tx.execute(
                            "INSERT OR REPLACE INTO wallet_metadata (key, value) VALUES ('first_scanned_hash', ?1)",
                            params![hex::encode(&first_block.hash)],
                        )?;
                    }

                    // Initial tree size at start of activation
                    0
                }
            };

            let mut expected_height = match tip {
                Some((h, _, _)) => (h as u64) + 1,
                None => first_block.height,
            };
            let mut expected_prev_hash: Option<Vec<u8>> = tip.map(|(_, h, _)| h);
            last_scanned_height = expected_height as u32;

            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|e| WalletError::Crypto(e.to_string()))?
                .as_secs() as i64;

            // Open ShardTree on the connection inside transaction
            let store = SqliteShardStore::new(&tx, "ironwood_tree");
            let mut tree = crate::IronwoodShardTree::new(store, 100);

            while block_idx < blocks.len() {
                let block = &blocks[block_idx];

                let sleep_ms = INJECT_BATCH_SLEEP_MS.load(std::sync::atomic::Ordering::SeqCst);
                if sleep_ms > 0 {
                    std::thread::sleep(std::time::Duration::from_millis(sleep_ms));
                }
            let b_height = block.height;
            if b_height != expected_height {
                return Err(WalletError::TreeSizeGap {
                    expected: expected_height as u32,
                    actual: b_height as u32,
                    height: b_height as u32,
                });
            }

            if let Some(ref exp_prev) = expected_prev_hash {
                if block.prev_hash != *exp_prev {
                    return Ok(ScanResult::NeedAncestorHashes {
                        from_height: (expected_height - 1) as u32,
                        count: 10,
                    });
                }
            }

            // Strictly parse chainMetadata.ironwoodCommitmentTreeSize
            let metadata = block.chain_metadata.as_ref().ok_or_else(|| {
                WalletError::MissingIronwoodField(format!(
                    "CompactBlock at height {} missing required chainMetadata",
                    b_height
                ))
            })?;
            let target_tree_size = metadata.ironwood_commitment_tree_size;

            // Count ironwood commitments across all transactions in block
            let mut block_iw_cmx_count = 0u32;
            for tx_item in &block.vtx {
                block_iw_cmx_count = block_iw_cmx_count.saturating_add(tx_item.ironwood_actions.len() as u32);
            }

            // Tree-size / gap verification
            let expected_tree_size = current_tree_size.saturating_add(block_iw_cmx_count);
            if expected_tree_size != target_tree_size {
                return Err(WalletError::TreeSizeGap {
                    expected: expected_tree_size,
                    actual: target_tree_size,
                    height: b_height as u32,
                });
            }

            // Process each transaction
            for vtx in &block.vtx {
                let txid = &vtx.txid;

                // 1. Spend detection: check if any action's nullifier matches an unspent received note
                for act in &vtx.ironwood_actions {
                    if act.nullifier.len() != 32 {
                        return Err(WalletError::MissingIronwoodField(format!(
                            "Invalid nullifier length {} in tx at height {}",
                            act.nullifier.len(),
                            b_height
                        )));
                    }

                    // Update received_notes to mark spend
                    let rows = tx.execute(
                        "UPDATE received_notes SET spent_in_txid = ?1, spent_at_height = ?2 WHERE nullifier = ?3 AND spent_in_txid IS NULL",
                        params![txid, b_height as i64, &act.nullifier],
                    )?;
                    if rows > 0 {
                        // Mark pending_spends row as mined
                        tx.execute(
                            "UPDATE pending_spends SET state = 'mined' WHERE nullifier = ?1",
                            params![&act.nullifier],
                        )?;
                    }
                }

                // 2. Output note detection & ShardTree leaf appending
                for (action_idx, act) in vtx.ironwood_actions.iter().enumerate() {
                    if act.cmx.len() != 32 || act.ephemeral_key.len() != 32 || act.ciphertext.len() < 52 {
                        return Err(WalletError::MissingIronwoodField(format!(
                            "Invalid ironwood action field lengths in tx at height {}",
                            b_height
                        )));
                    }

                    let mut nf_bytes = [0u8; 32];
                    nf_bytes.copy_from_slice(&act.nullifier);
                    let nf = orchard::note::Nullifier::from_bytes(&nf_bytes);
                    let nf = if bool::from(nf.is_none()) {
                        return Err(WalletError::Crypto("Invalid nullifier encoding".into()));
                    } else {
                        match nf.into_option() {
                            Some(n) => n,
                            None => return Err(WalletError::Crypto("Invalid nullifier".into())),
                        }
                    };

                    let mut cmx_bytes = [0u8; 32];
                    cmx_bytes.copy_from_slice(&act.cmx);
                    let cmx = ExtractedNoteCommitment::from_bytes(&cmx_bytes);
                    let cmx = if bool::from(cmx.is_none()) {
                        return Err(WalletError::Crypto("Invalid cmx encoding".into()));
                    } else {
                        match cmx.into_option() {
                            Some(c) => c,
                            None => return Err(WalletError::Crypto("Invalid cmx".into())),
                        }
                    };

                    let mut epk_bytes = [0u8; 32];
                    epk_bytes.copy_from_slice(&act.ephemeral_key);
                    let epk = EphemeralKeyBytes(epk_bytes);

                    let mut enc_52 = [0u8; 52];
                    enc_52.copy_from_slice(&act.ciphertext[..52]);

                    let compact_action = CompactAction::from_parts(nf, cmx, epk, enc_52);
                    let domain = IronwoodDomain::for_compact_action(&compact_action);

                    // Dual-scope trial decryption: External first, then Internal change
                    let decrypted = try_compact_note_decryption(&domain, &prepared_external, &compact_action)
                        .map(|(note, recipient)| (note, recipient, "external"))
                        .or_else(|| {
                            try_compact_note_decryption(&domain, &prepared_internal, &compact_action)
                                .map(|(note, recipient)| (note, recipient, "internal"))
                        });

                    let leaf_hash = MerkleHashOrchard::from_bytes(&cmx_bytes);
                    let leaf_hash = if bool::from(leaf_hash.is_none()) {
                        return Err(WalletError::Crypto("Invalid Pallas leaf hash".into()));
                    } else {
                        match leaf_hash.into_option() {
                            Some(h) => h,
                            None => return Err(WalletError::Crypto("Invalid leaf hash".into())),
                        }
                    };

                    let tree_position = current_tree_size;

                    if let Some((note, recipient, scope_str)) = decrypted {
                        total_notes_detected += 1;
                        // Mark note in ShardTree
                        tree.append(leaf_hash, Retention::Marked)?;

                        let recipient_ua = format_address(&recipient, network);
                        let note_nf = note.nullifier(fvk);
                        let value_zatoshis = note.value().inner() as i64;
                        let rho_bytes = note.rho().to_bytes();
                        let rseed_bytes = note.rseed().as_bytes();

                        tx.execute(
                            "INSERT INTO received_notes (
                                account_id, pool, txid, action_index, height, recipient,
                                value_zatoshis, nullifier, rho, rseed, cmx, tree_position,
                                scope, memo, spent_in_txid, spent_at_height
                            ) VALUES (?1, 'ironwood', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, NULL, NULL, NULL)",
                            params![
                                account_id,
                                txid,
                                action_idx as i64,
                                b_height as i64,
                                recipient_ua,
                                value_zatoshis,
                                &note_nf.to_bytes()[..],
                                &rho_bytes[..],
                                &rseed_bytes[..],
                                &cmx_bytes[..],
                                tree_position as i64,
                                scope_str,
                            ],
                        )?;
                    } else {
                        // Not an owned note: append with Ephemeral retention
                        tree.append(leaf_hash, Retention::Ephemeral)?;
                    }

                    current_tree_size += 1;
                }
            }

            // Re-link any orphaned pending spend reservations if their notes were re-mined
            crate::PendingSpendsManager::relink_reservations(&tx)?;

            if INJECT_FAULT_BEFORE_CHECKPOINT.with(|c| c.get()) {
                return Err(WalletError::FaultInjected(
                    "Simulated crash between received_notes write and shard/checkpoint write".into(),
                ));
            }

            // Checkpoint ShardTree at block height
            tree.checkpoint(BlockHeight::from_u32(b_height as u32))?;

            // Record scanned block
            tx.execute(
                "INSERT INTO scanned_blocks (height, block_hash, prev_hash, tree_size, scanned_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![b_height as i64, &block.hash, &block.prev_hash, current_tree_size as i64, now],
            )?;

            // Maintain sliding window: retain exactly 100 blocks
            if b_height >= 100 {
                tx.execute(
                    "DELETE FROM scanned_blocks WHERE height <= ?1",
                    params![(b_height - 100) as i64],
                )?;
            }

            expected_height = b_height + 1;
            expected_prev_hash = Some(block.hash.clone());
            last_scanned_height = b_height as u32;
            block_idx += 1;
            blocks_in_tx += 1;

            let tx_elapsed = tx_start.elapsed().as_millis();
            if (blocks_in_tx >= MAX_BLOCKS_PER_TX || tx_elapsed >= TIME_BUDGET_MS) && block_idx < blocks.len() {
                tx.commit()?;
                return Ok(ScanResult::Synced {
                    last_scanned_height,
                    notes_detected: total_notes_detected,
                });
            }
        }

        // Commit SQLite transaction atomically for this batch
        tx.commit()?;
    }

    Ok(ScanResult::Synced {
        last_scanned_height,
        notes_detected: total_notes_detected,
    })
    }

    /// Resolves a detected reorg by walking back from `from_height` along `ancestor_hashes`.
    ///
    /// Identifies the fork height `H_fork` where `scanned_blocks.block_hash` matches the node's block hash.
    /// Atomically:
    /// 1. Truncates `IronwoodShardTree` back to checkpoint `H_fork`.
    /// 2. Deletes `scanned_blocks` above `H_fork`.
    /// 3. Deletes `received_notes` created above `H_fork` (cascading to `pending_spends`).
    /// 4. Reverts confirmed spends mined above `H_fork` back to unspent (`spent_in_txid = NULL`).
    /// 5. Transitions `pending_spends` for notes created at or below `H_fork` from `'mined'` back to `'broadcast'`.
    pub fn resolve_reorg(
        conn: &mut Connection,
        from_height: u32,
        ancestor_hashes: &[[u8; 32]],
    ) -> Result<u32, WalletError> {
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;

        let mut fork_height = None;
        for (idx, hash) in ancestor_hashes.iter().enumerate() {
            let h = match from_height.checked_sub(idx as u32) {
                Some(val) => val,
                None => break,
            };

            let row_hash: Option<Vec<u8>> = tx
                .query_row(
                    "SELECT block_hash FROM scanned_blocks WHERE height = ?1",
                    params![h as i64],
                    |row| row.get(0),
                )
                .optional()?;

            if let Some(ref rh) = row_hash {
                if rh.as_slice() == hash.as_slice() {
                    fork_height = Some(h);
                    break;
                }
            }
        }

        let fork_h = fork_height.ok_or_else(|| WalletError::ReorgTooDeep {
            height: from_height,
            max_depth: ancestor_hashes.len() as u32,
        })?;

        // 1. Rewind ShardTree to checkpoint H_fork
        {
            let store = SqliteShardStore::new(&tx, "ironwood_tree");
            let mut tree = crate::IronwoodShardTree::new(store, 100);
            tree.truncate_to_checkpoint(&BlockHeight::from_u32(fork_h))?;
        }

        // 2. Remove orphaned scanned_blocks
        tx.execute(
            "DELETE FROM scanned_blocks WHERE height > ?1",
            params![fork_h as i64],
        )?;

        // 3. Detach orphaned note_ids in pending_spends so in-flight reservations are preserved
        tx.execute(
            "UPDATE pending_spends SET note_id = NULL WHERE note_id IN (SELECT id FROM received_notes WHERE height > ?1)",
            params![fork_h as i64],
        )?;

        // Delete notes received on the orphaned chain
        tx.execute(
            "DELETE FROM received_notes WHERE height > ?1",
            params![fork_h as i64],
        )?;

        // 4. Reset spends that were mined on the orphaned chain back to unspent
        tx.execute(
            "UPDATE received_notes SET spent_in_txid = NULL, spent_at_height = NULL WHERE spent_at_height > ?1",
            params![fork_h as i64],
        )?;

        // 5. Revert pending_spends from 'mined' to 'broadcast' for notes that still exist
        tx.execute(
            "UPDATE pending_spends SET state = 'broadcast' WHERE state = 'mined' AND nullifier IN (SELECT nullifier FROM received_notes WHERE height <= ?1)",
            params![fork_h as i64],
        )?;

        tx.commit()?;

        Ok(fork_h)
    }
}

fn format_address(addr: &Address, network: &DynamicNetwork) -> String {
    UnifiedAddress::from_receivers(Some(*addr), None, None)
        .map(|ua| ua.encode(network))
        .unwrap_or_else(|| hex::encode(addr.to_raw_address_bytes()))
}
