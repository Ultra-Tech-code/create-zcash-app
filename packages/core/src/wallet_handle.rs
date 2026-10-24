#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use napi::bindgen_prelude::*;
use napi_derive::napi;
use orchard::circuit::{OrchardCircuitVersion, ProvingKey};
use orchard::keys::FullViewingKey;
use prost::Message;
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};

use crate::consensus::get_nu6_3_activation_height;
use crate::pending_spends::PendingSpendsManager;
use crate::scanner::{CompactBlock, ScanResult, Scanner};
use crate::spendable::query_spendable_notes;
use crate::wallet_db::WalletDb;
use crate::DynamicNetwork;
use zcash_primitives::transaction::fees::transparent::InputSize;
use zcash_primitives::transaction::fees::zip317::FeeRule;
use zcash_primitives::transaction::fees::FeeRule as _;

static GLOBAL_PROVING_KEY: OnceLock<ProvingKey> = OnceLock::new();

/// Returns the shared Orchard circuit proving key, initializing it if not already built.
pub fn get_or_init_proving_key() -> &'static ProvingKey {
    GLOBAL_PROVING_KEY.get_or_init(|| {
        ProvingKey::build(OrchardCircuitVersion::PostNu6_3)
    })
}

/// Spawns a background worker thread to warm up the static proving key ahead of first send.
pub fn warm_up_proving_key() {
    std::thread::spawn(|| {
        let _ = get_or_init_proving_key();
    });
}

#[napi(object)]
pub struct JsScanResult {
    pub status: String, // "synced" or "need_ancestor_hashes"
    pub last_scanned_height: u32,
    pub notes_detected: u32,
    pub from_height: Option<u32>,
    pub count: Option<u32>,
}

#[napi(object)]
pub struct WalletSummary {
    pub last_scanned_height: u32,
    pub tree_size: u32,
    pub unspent_notes_count: u32,
    pub total_balance_zatoshis: i64,
    pub spendable_balance_zatoshis: i64,
}

#[napi(object)]
pub struct JsSpendableNote {
    pub id: i64,
    pub recipient: String,
    pub value_zatoshis: i64,
    pub nullifier: String,
    pub height: u32,
    pub tree_position: i64,
}

pub struct ScanTask {
    pub db: Arc<Mutex<WalletDb>>,
    pub account_id: String,
    pub fvk: FullViewingKey,
    pub network: DynamicNetwork,
    pub raw_blocks: Vec<Vec<u8>>,
}

impl Task for ScanTask {
    type Output = ScanResult;
    type JsValue = JsScanResult;

    fn compute(&mut self) -> Result<Self::Output> {
        let mut blocks = Vec::with_capacity(self.raw_blocks.len());
        for b in &self.raw_blocks {
            let block = CompactBlock::decode(&b[..])
                .map_err(|e| Error::new(Status::GenericFailure, format!("Protobuf decode error: {}", e)))?;
            blocks.push(block);
        }

        let mut db_guard = self.db.lock()
            .map_err(|e| Error::new(Status::GenericFailure, format!("DB lock error: {}", e)))?;

        Scanner::scan_block_batch(db_guard.conn_mut(), &self.account_id, &self.fvk, &self.network, &blocks)
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        match output {
            ScanResult::Synced { last_scanned_height, notes_detected } => Ok(JsScanResult {
                status: "synced".to_string(),
                last_scanned_height,
                notes_detected: notes_detected as u32,
                from_height: None,
                count: None,
            }),
            ScanResult::NeedAncestorHashes { from_height, count } => Ok(JsScanResult {
                status: "need_ancestor_hashes".to_string(),
                last_scanned_height: 0,
                notes_detected: 0,
                from_height: Some(from_height),
                count: Some(count),
            }),
        }
    }
}

#[napi(object)]
pub struct JsBuildTransactionRequest {
    pub spend_handle: Option<u32>,
    pub spending_key_bytes: Option<Buffer>,
    pub recipient_address: String,
    pub amount_zatoshis: i64,
    pub memo: Option<String>,
    pub anchor_bytes: Buffer,
    pub anchor_height: u32,
    pub expiry_height: u32,
    pub spendable_note_ids: Vec<i64>,
    pub reservation_id: Buffer,
}

#[napi(object)]
pub struct JsBuiltTransaction {
    pub txid: String,
    pub raw_bytes: Buffer,
    pub fee: i64,
    pub num_actions: u32,
    pub expiry_height: u32,
}

pub struct BuildTransactionTask {
    pub db: Arc<Mutex<WalletDb>>,
    pub network: DynamicNetwork,
    pub req: JsBuildTransactionRequest,
}

impl Task for BuildTransactionTask {
    type Output = (crate::transaction::BuiltTransaction, [u8; 32]);
    type JsValue = JsBuiltTransaction;

    fn compute(&mut self) -> Result<Self::Output> {
        let sk = if let Some(handle) = self.req.spend_handle {
            let usk = crate::get_spending_key(handle)
                .ok_or_else(|| Error::new(Status::InvalidArg, format!("Spend handle {} not found", handle)))?;
            *usk.orchard()
        } else if let Some(ref sk_buf) = self.req.spending_key_bytes {
            if sk_buf.len() != 32 {
                return Err(Error::new(Status::InvalidArg, "Spending key bytes must be 32 bytes".to_string()));
            }
            let mut arr = [0u8; 32];
            arr.copy_from_slice(sk_buf);
            orchard::keys::SpendingKey::from_bytes(arr)
                .into_option()
                .ok_or_else(|| Error::new(Status::InvalidArg, "Invalid spending key bytes".to_string()))?
        } else {
            return Err(Error::new(Status::InvalidArg, "Either spend_handle or spending_key_bytes must be provided".to_string()));
        };

        if self.req.anchor_bytes.len() != 32 {
            return Err(Error::new(Status::InvalidArg, "anchor_bytes must be 32 bytes".to_string()));
        }
        let mut anchor_arr = [0u8; 32];
        anchor_arr.copy_from_slice(&self.req.anchor_bytes);
        let anchor = orchard::Anchor::from_bytes(anchor_arr)
            .into_option()
            .ok_or_else(|| Error::new(Status::InvalidArg, "Invalid anchor bytes".to_string()))?;

        if self.req.reservation_id.len() != 32 {
            return Err(Error::new(Status::InvalidArg, "reservation_id must be 32 bytes".to_string()));
        }
        let mut res_id = [0u8; 32];
        res_id.copy_from_slice(&self.req.reservation_id);

        let recipient = crate::spendable::parse_recipient_address(&self.req.recipient_address)
            .ok_or_else(|| Error::new(Status::InvalidArg, format!("Invalid recipient address: {}", self.req.recipient_address)))?;

        // 1. Fetch spendable notes and compute Merkle paths under DB lock
        let mut spends: Vec<crate::transaction::SpendInput> = Vec::new();
        let mut total_spends: u64 = 0;
        {
            let db_guard = self.db.lock()
                .map_err(|e| Error::new(Status::GenericFailure, format!("DB lock error: {}", e)))?;

            // Refresh heartbeat before starting
            let pid = std::process::id();
            let _ = crate::pending_spends::PendingSpendsManager::refresh_heartbeat(db_guard.conn(), &res_id, pid);

            let all_spendable = crate::spendable::query_notes_for_builder(db_guard.conn(), self.req.anchor_height, &self.req.spendable_note_ids)
                .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

            for note_id in &self.req.spendable_note_ids {
                let note = all_spendable.iter().find(|n| n.id == *note_id)
                    .ok_or_else(|| Error::new(Status::GenericFailure, format!("Note {} not spendable at anchor height {}", note_id, self.req.anchor_height)))?;
                total_spends += note.value_zatoshis;
                spends.push(crate::transaction::SpendInput::new(note.note, note.merkle_path.clone()));
            }
        }

        if (total_spends as i64) < self.req.amount_zatoshis {
            return Err(Error::new(Status::GenericFailure, format!("Insufficient funds: spends total {} zatoshis < send amount {}", total_spends, self.req.amount_zatoshis)));
        }

        let fvk = FullViewingKey::from(&sk);

        // 2. Compute fee using standard ZIP 317 fee rule
        let num_spends = spends.len();
        let initial_actions = std::cmp::max(num_spends, 2);
        let fee = FeeRule::standard()
            .fee_required(
                &zcash_protocol::consensus::MAIN_NETWORK,
                zcash_protocol::consensus::BlockHeight::from_u32(1),
                std::iter::empty::<InputSize>(),
                std::iter::empty::<usize>(),
                0,
                0,
                0,
                initial_actions,
            )
            .map_err(|e| Error::new(Status::GenericFailure, format!("Fee calculation error: {}", e)))?;
        let fee_zatoshis = u64::from(fee) as i64;

        let change_zatoshis = (total_spends as i64) - self.req.amount_zatoshis - fee_zatoshis;
        if change_zatoshis < 0 {
            return Err(Error::new(Status::GenericFailure, format!("Insufficient funds to cover amount ({}) + fee ({}) with spends ({})", self.req.amount_zatoshis, fee_zatoshis, total_spends)));
        }

        // 3. Assemble outputs
        let mut outputs = Vec::new();
        let memo_bytes = if let Some(ref m_str) = self.req.memo {
            let mut arr = [0u8; 512];
            let bytes = m_str.as_bytes();
            let copy_len = std::cmp::min(bytes.len(), 512);
            arr[..copy_len].copy_from_slice(&bytes[..copy_len]);
            Some(arr)
        } else {
            None
        };

        let recipient_val = orchard::value::NoteValue::from_raw(self.req.amount_zatoshis as u64);
        let mut recipient_spec = crate::transaction::OutputSpec::new(recipient, recipient_val);
        if let Some(m) = memo_bytes {
            recipient_spec = recipient_spec.with_memo_bytes(m);
        }
        outputs.push(recipient_spec);

        if change_zatoshis > 0 {
            let change_address = fvk.address_at(0u32, orchard::keys::Scope::Internal);
            let change_val = orchard::value::NoteValue::from_raw(change_zatoshis as u64);
            outputs.push(crate::transaction::OutputSpec::new(change_address, change_val));
        }

        let branch_id = zcash_protocol::consensus::BranchId::Nu6_3;
        let mut config = crate::transaction::TransactionConfig::new(
            branch_id,
            anchor,
            zcash_protocol::consensus::BlockHeight::from_u32(self.req.expiry_height),
            None,
        );
        config = config.with_expiry_height(zcash_protocol::consensus::BlockHeight::from_u32(self.req.expiry_height));

        let pk = get_or_init_proving_key();

        let mut builder = crate::transaction::TransactionBuilder::new(&sk, config);
        for s in spends {
            builder.add_spend(s);
        }
        for o in outputs {
            builder.add_output(o);
        }

        let built_tx = builder.build_and_prove(pk)
            .map_err(|e| Error::new(Status::GenericFailure, format!("Transaction build/prove failed: {}", e)))?;

        Ok((built_tx, res_id))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        let (built, _res_id) = output;
        let txid_bytes = built.txid.as_ref();
        let txid_hex = hex::encode(txid_bytes);

        Ok(JsBuiltTransaction {
            txid: txid_hex,
            raw_bytes: Buffer::from(built.raw_bytes),
            fee: u64::from(built.fee) as i64,
            num_actions: built.num_actions as u32,
            expiry_height: u32::from(built.expiry_height),
        })
    }
}

/// A handle to an open Zcash wallet database with thread-safe access and async background scanning.
#[napi]
pub struct WalletHandle {
    db: Arc<Mutex<WalletDb>>,
    account_id: String,
    fvk: FullViewingKey,
    network: DynamicNetwork,
}

#[napi]
impl WalletHandle {
    /// Opens or initializes a wallet database file with strict 0700/0600 permissions,
    /// WAL mode, busy_timeout=5000ms, and starts background proving key warm-up.
    #[napi(factory)]
    pub fn open(
        db_path: String,
        network_str: String,
        ufvk_str: String,
        account_id: Option<String>,
    ) -> Result<Self> {
        let network = match network_str.to_lowercase().as_str() {
            "main" | "mainnet" => DynamicNetwork::Main(zcash_protocol::consensus::Network::MainNetwork),
            "test" | "testnet" => DynamicNetwork::Test(zcash_protocol::consensus::Network::TestNetwork),
            "regtest" => DynamicNetwork::Regtest(crate::regtest_params()),
            other => return Err(Error::new(Status::InvalidArg, format!("Unknown network: {}", other))),
        };

        let ufvk = zcash_keys::keys::UnifiedFullViewingKey::decode(&network, &ufvk_str)
            .map_err(|e| Error::new(Status::InvalidArg, format!("Invalid UFVK: {}", e)))?;

        let fvk = ufvk.orchard()
            .ok_or_else(|| Error::new(Status::InvalidArg, "UFVK missing Orchard/Ironwood viewing key".to_string()))?
            .clone();

        let ufvk_fingerprint = hex::encode(fvk.to_bytes());
        let activation_h = get_nu6_3_activation_height(&network_str)
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

        let db = WalletDb::open_or_create(
            Path::new(&db_path),
            &network_str,
            &ufvk_fingerprint,
            Some(activation_h),
        )
        .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

        // Warm up proving key in background thread
        warm_up_proving_key();

        let acct = account_id.unwrap_or_else(|| "account0".to_string());

        Ok(Self {
            db: Arc::new(Mutex::new(db)),
            account_id: acct,
            fvk,
            network,
        })
    }

    /// Asynchronously scans a batch of raw CompactBlock protobuf buffers off the main Node.js event loop.
    #[napi]
    pub fn scan_blocks(&self, raw_blocks: Vec<Buffer>) -> AsyncTask<ScanTask> {
        let raw_vecs: Vec<Vec<u8>> = raw_blocks.into_iter().map(|b| b.to_vec()).collect();
        AsyncTask::new(ScanTask {
            db: Arc::clone(&self.db),
            account_id: self.account_id.clone(),
            fvk: self.fvk.clone(),
            network: self.network.clone(),
            raw_blocks: raw_vecs,
        })
    }

    /// Synchronously scans raw blocks (useful for tests and direct callers).
    pub fn scan_blocks_sync(&self, raw_blocks: Vec<Vec<u8>>) -> Result<ScanResult> {
        let mut task = ScanTask {
            db: Arc::clone(&self.db),
            account_id: self.account_id.clone(),
            fvk: self.fvk.clone(),
            network: self.network.clone(),
            raw_blocks,
        };
        task.compute()
    }

    /// Returns a comprehensive balance and sync status summary.
    #[napi]
    pub fn get_wallet_summary(&self) -> Result<WalletSummary> {
        let db_guard = self.db.lock()
            .map_err(|e| Error::new(Status::GenericFailure, format!("DB lock error: {}", e)))?;
        let conn = db_guard.conn();

        let (last_scanned_height, tree_size): (u32, u32) = conn
            .query_row(
                "SELECT height, tree_size FROM scanned_blocks ORDER BY height DESC LIMIT 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap_or((0, 0));

        let unspent_notes_count: u32 = conn
            .query_row(
                "SELECT COUNT(*) FROM received_notes WHERE spent_in_txid IS NULL",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        let total_balance_zatoshis: i64 = conn
            .query_row(
                "SELECT COALESCE(SUM(value_zatoshis), 0) FROM received_notes WHERE spent_in_txid IS NULL",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        let spendable_balance_zatoshis: i64 = conn
            .query_row(
                "SELECT COALESCE(SUM(value_zatoshis), 0) FROM received_notes 
                 WHERE spent_in_txid IS NULL 
                   AND nullifier NOT IN (
                       SELECT nullifier FROM pending_spends 
                       WHERE state IN ('reserved', 'broadcast', 'mined')
                   )",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        Ok(WalletSummary {
            last_scanned_height,
            tree_size,
            unspent_notes_count,
            total_balance_zatoshis,
            spendable_balance_zatoshis,
        })
    }

    /// Queries spendable notes confirmed at the given anchor height with min_confs.
    #[napi]
    pub fn query_spendable_notes(
        &self,
        anchor_height: u32,
        min_confs: u32,
    ) -> Result<Vec<JsSpendableNote>> {
        let db_guard = self.db.lock()
            .map_err(|e| Error::new(Status::GenericFailure, format!("DB lock error: {}", e)))?;

        let notes = query_spendable_notes(db_guard.conn(), anchor_height, min_confs)
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

        let result = notes
            .into_iter()
            .map(|n| JsSpendableNote {
                id: n.id,
                recipient: hex::encode(n.note.recipient().to_raw_address_bytes()),
                value_zatoshis: n.value_zatoshis as i64,
                nullifier: hex::encode(n.nullifier),
                height: n.height,
                tree_position: n.tree_position as i64,
            })
            .collect();

        Ok(result)
    }

    /// Resolves a detected reorganization by rolling back wallet state to a common ancestor.
    #[napi]
    pub fn resolve_reorg(
        &self,
        from_height: u32,
        ancestor_hashes: Vec<Buffer>,
    ) -> Result<u32> {
        let mut hashes: Vec<[u8; 32]> = Vec::with_capacity(ancestor_hashes.len());
        for b in ancestor_hashes {
            if b.len() != 32 {
                return Err(Error::new(Status::InvalidArg, "Ancestor hash must be 32 bytes".to_string()));
            }
            let mut arr = [0u8; 32];
            arr.copy_from_slice(&b);
            hashes.push(arr);
        }

        let mut db_guard = self.db.lock()
            .map_err(|e| Error::new(Status::GenericFailure, format!("DB lock error: {}", e)))?;

        Scanner::resolve_reorg(db_guard.conn_mut(), from_height, &hashes)
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))
    }

    /// Reserves notes for an in-flight send transaction under BEGIN IMMEDIATE.
    #[napi]
    pub fn reserve_notes(
        &self,
        notes: Vec<i64>,
        txid: Buffer,
        expiry_height: u32,
    ) -> Result<()> {
        if txid.len() != 32 {
            return Err(Error::new(Status::InvalidArg, "txid must be 32 bytes".to_string()));
        }
        let mut txid_arr = [0u8; 32];
        txid_arr.copy_from_slice(&txid);

        let mut db_guard = self.db.lock()
            .map_err(|e| Error::new(Status::GenericFailure, format!("DB lock error: {}", e)))?;

        let tip_height: u32 = db_guard.conn()
            .query_row("SELECT height FROM scanned_blocks ORDER BY height DESC LIMIT 1", [], |r| r.get(0))
            .unwrap_or(0);

        let mut note_pairs = Vec::with_capacity(notes.len());
        for note_id in notes {
            let nf_bytes: Vec<u8> = db_guard.conn()
                .query_row("SELECT nullifier FROM received_notes WHERE id = ?1", rusqlite::params![note_id], |r| r.get(0))
                .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to find note {}: {}", note_id, e)))?;

            if nf_bytes.len() != 32 {
                return Err(Error::new(Status::GenericFailure, "Corrupt nullifier in DB".to_string()));
            }
            let mut nf_arr = [0u8; 32];
            nf_arr.copy_from_slice(&nf_bytes);
            note_pairs.push((note_id, nf_arr));
        }

        let pid = std::process::id();
        PendingSpendsManager::reserve_notes(
            db_guard.conn_mut(),
            &note_pairs,
            &txid_arr,
            expiry_height,
            pid,
            tip_height,
        )
        .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))
    }

    fn mark_broadcast_internal(&self, txid: &[u8], reservation_id: Option<&[u8]>) -> Result<u32> {
        if txid.len() != 32 {
            return Err(Error::new(Status::InvalidArg, "txid must be 32 bytes".to_string()));
        }
        let mut txid_arr = [0u8; 32];
        txid_arr.copy_from_slice(txid);

        let mut res_arr = [0u8; 32];
        let res_ref = if let Some(r) = reservation_id {
            if r.len() != 32 {
                return Err(Error::new(Status::InvalidArg, "reservation_id must be 32 bytes".to_string()));
            }
            res_arr.copy_from_slice(r);
            Some(&res_arr)
        } else {
            None
        };

        let db_guard = self.db.lock()
            .map_err(|e| Error::new(Status::GenericFailure, format!("DB lock error: {}", e)))?;

        let updated = PendingSpendsManager::mark_broadcast_with_reservation(db_guard.conn(), &txid_arr, res_ref)
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

        Ok(updated as u32)
    }

    /// Marks an in-flight reservation as broadcast to the network.
    #[napi]
    pub fn mark_broadcast(&self, txid: Buffer) -> Result<u32> {
        self.mark_broadcast_internal(&txid, None)
    }

    /// Marks an in-flight reservation as broadcast to the network, re-keying from a reservation_id.
    #[napi]
    pub fn mark_broadcast_with_reservation(&self, txid: Buffer, reservation_id: Buffer) -> Result<u32> {
        self.mark_broadcast_internal(&txid, Some(&reservation_id))
    }

    /// Refreshes the heartbeat timestamp of an active in-flight reservation to prevent stale timeout.
    #[napi]
    pub fn refresh_heartbeat(&self, reservation_id: Buffer) -> Result<u32> {
        if reservation_id.len() != 32 {
            return Err(Error::new(Status::InvalidArg, "reservation_id must be 32 bytes".to_string()));
        }
        let mut res_arr = [0u8; 32];
        res_arr.copy_from_slice(&reservation_id);

        let db_guard = self.db.lock()
            .map_err(|e| Error::new(Status::GenericFailure, format!("DB lock error: {}", e)))?;

        let updated = PendingSpendsManager::refresh_heartbeat(db_guard.conn(), &res_arr, std::process::id())
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

        Ok(updated as u32)
    }

    /// Asynchronously builds, proves, signs, and serializes a V6 Ironwood transaction in a background worker thread.
    #[napi]
    pub fn build_and_prove_transaction(&self, req: JsBuildTransactionRequest) -> AsyncTask<BuildTransactionTask> {
        AsyncTask::new(BuildTransactionTask {
            db: Arc::clone(&self.db),
            network: self.network.clone(),
            req,
        })
    }

    /// Returns the 32-byte Ironwood commitment tree root at the specified block height.
    #[napi]
    pub fn get_tree_root_at_height(&self, height: u32) -> Result<Option<Buffer>> {
        let db_guard = self.db.lock()
            .map_err(|e| Error::new(Status::GenericFailure, format!("DB lock error: {}", e)))?;
        let store = crate::shard_store::SqliteShardStore::new(db_guard.conn(), "ironwood_tree");
        let tree = crate::shard_store::IronwoodShardTree::new(store, 100);
        let cid = zcash_protocol::consensus::BlockHeight::from_u32(height);
        let root = tree.root_at_checkpoint_id(&cid)
            .map_err(|e| Error::new(Status::GenericFailure, format!("Tree error: {:?}", e)))?;
        Ok(root.map(|r| Buffer::from(r.to_bytes().to_vec())))
    }

    /// Cancels an in-flight reservation if proving fails or transaction is aborted.
    #[napi]
    pub fn cancel_reservation(&self, txid: Buffer) -> Result<u32> {
        if txid.len() != 32 {
            return Err(Error::new(Status::InvalidArg, "txid must be 32 bytes".to_string()));
        }
        let mut txid_arr = [0u8; 32];
        txid_arr.copy_from_slice(&txid);

        let db_guard = self.db.lock()
            .map_err(|e| Error::new(Status::GenericFailure, format!("DB lock error: {}", e)))?;

        let deleted = PendingSpendsManager::cancel_reservation(db_guard.conn(), &txid_arr)
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

        Ok(deleted as u32)
    }

    /// Resets wallet state (wipes scanned blocks, notes, tree, and pending spends, clearing chain continuity metadata).
    #[napi]
    pub fn reset(&self) -> Result<()> {
        let mut db_guard = self.db.lock()
            .map_err(|e| Error::new(Status::GenericFailure, format!("DB lock error: {}", e)))?;
        let conn = db_guard.conn_mut();
        let tx = conn.transaction()
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
        tx.execute("DELETE FROM scanned_blocks", [])
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
        tx.execute("DELETE FROM received_notes", [])
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
        tx.execute("DELETE FROM pending_spends", [])
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
        tx.execute("DELETE FROM ironwood_tree_shards", [])
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
        tx.execute("DELETE FROM ironwood_tree_cap", [])
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
        tx.execute("DELETE FROM ironwood_tree_checkpoint_marks_removed", [])
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
        tx.execute("DELETE FROM ironwood_tree_checkpoints", [])
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
        tx.execute("DELETE FROM wallet_metadata WHERE key = 'first_scanned_height' OR key = 'first_scanned_hash'", [])
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
        tx.commit()
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
        Ok(())
    }

    /// Returns the 32-byte Ironwood commitment tree root at the specified checkpoint depth (0 = tip).
    #[napi]
    pub fn get_tree_root(&self, depth: Option<u32>) -> Result<Option<Buffer>> {
        let db_guard = self.db.lock()
            .map_err(|e| Error::new(Status::GenericFailure, format!("DB lock error: {}", e)))?;
        let store = crate::shard_store::SqliteShardStore::new(db_guard.conn(), "ironwood_tree");
        let tree = crate::shard_store::IronwoodShardTree::new(store, 100);
        let root = tree.root_at_checkpoint_depth(depth.map(|d| d as usize))
            .map_err(|e| Error::new(Status::GenericFailure, format!("Tree error: {:?}", e)))?;
        Ok(root.map(|r| Buffer::from(r.to_bytes().to_vec())))
    }

    /// Looks up a received note by its 32-byte commitment hex (cmx).
    #[napi]
    pub fn get_note_by_cmx(&self, cmx_hex: String) -> Result<Option<JsSpendableNote>> {
        let db_guard = self.db.lock()
            .map_err(|e| Error::new(Status::GenericFailure, format!("DB lock error: {}", e)))?;
        let cmx_bytes = hex::decode(&cmx_hex)
            .map_err(|e| Error::new(Status::InvalidArg, format!("Invalid cmx hex: {}", e)))?;

        let row = db_guard.conn().query_row(
            "SELECT id, recipient, value_zatoshis, nullifier, height, tree_position 
             FROM received_notes WHERE cmx = ?1",
            rusqlite::params![&cmx_bytes],
            |r| {
                let nullifier_bytes: Vec<u8> = r.get(3)?;
                Ok(JsSpendableNote {
                    id: r.get(0)?,
                    recipient: r.get(1)?,
                    value_zatoshis: r.get(2)?,
                    nullifier: hex::encode(nullifier_bytes),
                    height: r.get(4)?,
                    tree_position: r.get(5)?,
                })
            },
        );

        match row {
            Ok(note) => Ok(Some(note)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(Error::new(Status::GenericFailure, e.to_string())),
        }
    }
}

/// Deserializes a hex-encoded Ironwood commitment tree frontier from GetTreeState/z_gettreestate
/// and returns its 32-byte Merkle root hex.
#[napi]
pub fn decode_ironwood_frontier_root(frontier_hex: String) -> Result<String> {
    let bytes = hex::decode(&frontier_hex)
        .map_err(|e| Error::new(Status::InvalidArg, format!("Invalid frontier hex: {e}")))?;
    let tree = zcash_primitives::merkle_tree::read_commitment_tree::<orchard::tree::MerkleHashOrchard, _, 32>(&bytes[..])
        .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to parse commitment tree: {e}")))?;
    let root: orchard::Anchor = tree.root().into();
    Ok(hex::encode(root.to_bytes()))
}

/// Returns the conventional ZIP 317 fee for a transaction with the given number of actions.
#[napi]
pub fn quote_fee(num_actions: u32) -> Result<i64> {
    let fee = FeeRule::standard()
        .fee_required(
            &zcash_protocol::consensus::MAIN_NETWORK,
            zcash_protocol::consensus::BlockHeight::from_u32(1),
            std::iter::empty::<InputSize>(),
            std::iter::empty::<usize>(),
            0,
            0,
            0,
            num_actions as usize,
        )
        .map_err(|e| Error::new(Status::GenericFailure, format!("Fee rule error: {}", e)))?;
    Ok(u64::from(fee) as i64)
}

/// Warms up the static circuit proving key in a background thread ahead of first send.
#[napi]
pub fn warmup_prover() -> Result<()> {
    warm_up_proving_key();
    Ok(())
}

