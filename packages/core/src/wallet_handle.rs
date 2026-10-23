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

    /// Marks an in-flight reservation as broadcast to the network.
    #[napi]
    pub fn mark_broadcast(&self, txid: Buffer) -> Result<u32> {
        if txid.len() != 32 {
            return Err(Error::new(Status::InvalidArg, "txid must be 32 bytes".to_string()));
        }
        let mut txid_arr = [0u8; 32];
        txid_arr.copy_from_slice(&txid);

        let db_guard = self.db.lock()
            .map_err(|e| Error::new(Status::GenericFailure, format!("DB lock error: {}", e)))?;

        let updated = PendingSpendsManager::mark_broadcast(db_guard.conn(), &txid_arr)
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

        Ok(updated as u32)
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
}
