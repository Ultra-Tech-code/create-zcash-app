#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use rusqlite::{params, Connection, TransactionBehavior};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::scanner::WalletError;

pub const DEFAULT_STALE_RESERVATION_TIMEOUT_SECS: u64 = 120;

/// Manages in-flight spend reservations, locks, and lifecycle states:
/// 'reserved' -> 'broadcast' -> 'mined'.
///
/// Heartbeat timeout (120s) is the sole authority for liveness, avoiding PID reuse hazards.
pub struct PendingSpendsManager;

impl PendingSpendsManager {
    /// Cleans up expired and stale reservations:
    /// 1. Expired transactions: any row where `expiry_height <= current_tip_height` is deleted.
    ///    The note returns to spendable immediately.
    /// 2. Stale reservations: any row in 'reserved' state whose `heartbeat_at` is older than `timeout_secs`
    ///    is deleted, returning the note to spendable.
    pub fn cleanup_stale_and_expired(
        conn: &Connection,
        current_tip_height: u32,
        timeout_secs: u64,
    ) -> Result<usize, WalletError> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| WalletError::Crypto(e.to_string()))?
            .as_secs() as i64;
        let stale_threshold = now.saturating_sub(timeout_secs as i64);

        // Delete expired transactions and stale reservations
        let deleted = conn.execute(
            "DELETE FROM pending_spends 
             WHERE (expiry_height <= ?1)
                OR (state = 'reserved' AND heartbeat_at < ?2)",
            params![current_tip_height as i64, stale_threshold],
        )?;

        Ok(deleted)
    }

    /// Re-links orphaned reservations whose `note_id` was set to NULL by a reorg
    /// when the same note is re-mined at a new height with a new row ID.
    pub fn relink_reservations(conn: &Connection) -> Result<usize, WalletError> {
        let updated = conn.execute(
            "UPDATE pending_spends 
             SET note_id = (
                 SELECT id FROM received_notes 
                 WHERE nullifier = pending_spends.nullifier 
                   AND spent_in_txid IS NULL
                 LIMIT 1
             )
             WHERE note_id IS NULL",
            [],
        )?;
        Ok(updated)
    }

    /// Reserves a set of unspent notes for an in-flight transaction under `BEGIN IMMEDIATE`.
    ///
    /// Validates that:
    /// - Each note exists in `received_notes` and is unspent (`spent_in_txid IS NULL`).
    /// - None of the notes are already locked in `pending_spends`.
    pub fn reserve_notes(
        conn: &mut Connection,
        notes: &[(i64, [u8; 32])], // (note_id, nullifier)
        txid: &[u8; 32],
        expiry_height: u32,
        owner_pid: u32,
        current_tip_height: u32,
    ) -> Result<(), WalletError> {
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;

        // First clean up stale/expired reservations
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| WalletError::Crypto(e.to_string()))?
            .as_secs() as i64;
        let stale_threshold = now.saturating_sub(DEFAULT_STALE_RESERVATION_TIMEOUT_SECS as i64);

        tx.execute(
            "DELETE FROM pending_spends 
             WHERE (expiry_height <= ?1)
                OR (state = 'reserved' AND heartbeat_at < ?2)",
            params![current_tip_height as i64, stale_threshold],
        )?;

        for (note_id, nullifier) in notes {
            // Verify note is unspent
            let spent_check: Option<Option<Vec<u8>>> = tx
                .query_row(
                    "SELECT spent_in_txid FROM received_notes WHERE id = ?1",
                    params![note_id],
                    |row| row.get(0),
                )
                .map(Some)
                .unwrap_or(None);

            match spent_check {
                Some(None) => {} // Unspent, OK!
                Some(Some(_)) => {
                    return Err(WalletError::NoteNotSpendable(format!(
                        "Note {} is already confirmed spent on chain",
                        note_id
                    )));
                }
                None => {
                    return Err(WalletError::NoteNotSpendable(format!(
                        "Note {} not found in wallet",
                        note_id
                    )));
                }
            }

            // Insert reservation
            let insert_res = tx.execute(
                "INSERT INTO pending_spends (nullifier, note_id, txid, created_at, expiry_height, state, owner_pid, heartbeat_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'reserved', ?6, ?7)",
                params![
                    &nullifier[..],
                    note_id,
                    &txid[..],
                    now,
                    expiry_height as i64,
                    owner_pid as i64,
                    now,
                ],
            );

            if let Err(e) = insert_res {
                return Err(WalletError::LockError(format!(
                    "Note {} is already reserved in pending_spends: {}",
                    note_id, e
                )));
            }
        }

        tx.commit()?;
        Ok(())
    }

    /// Refreshes the heartbeat timestamp for an active in-flight reservation.
    ///
    /// The builder/prover invokes this periodically during long prove operations
    /// to prove ongoing liveness, preventing stale cleanup.
    pub fn refresh_heartbeat(
        conn: &Connection,
        txid: &[u8; 32],
        owner_pid: u32,
    ) -> Result<usize, WalletError> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| WalletError::Crypto(e.to_string()))?
            .as_secs() as i64;

        let rows = conn.execute(
            "UPDATE pending_spends SET heartbeat_at = ?1 
             WHERE txid = ?2 AND owner_pid = ?3 AND state = 'reserved'",
            params![now, &txid[..], owner_pid as i64],
        )?;

        Ok(rows)
    }

    /// Transitions an active reservation to 'broadcast' upon successful network submission.
    pub fn mark_broadcast(conn: &Connection, txid: &[u8; 32]) -> Result<usize, WalletError> {
        Self::mark_broadcast_with_reservation(conn, txid, None)
    }

    /// Transitions an active reservation to 'broadcast', optionally updating the reservation_id to the final txid.
    pub fn mark_broadcast_with_reservation(
        conn: &Connection,
        txid: &[u8; 32],
        reservation_id: Option<&[u8; 32]>,
    ) -> Result<usize, WalletError> {
        let rows = if let Some(res_id) = reservation_id {
            conn.execute(
                "UPDATE pending_spends SET state = 'broadcast', txid = ?1 
                 WHERE txid = ?2 AND state = 'reserved'",
                params![&txid[..], &res_id[..]],
            )?
        } else {
            conn.execute(
                "UPDATE pending_spends SET state = 'broadcast' 
                 WHERE txid = ?1 AND state = 'reserved'",
                params![&txid[..]],
            )?
        };

        Ok(rows)
    }

    /// Cancels an in-flight reservation if proving fails or the transaction is aborted.
    pub fn cancel_reservation(conn: &Connection, txid: &[u8; 32]) -> Result<usize, WalletError> {
        let rows = conn.execute(
            "DELETE FROM pending_spends 
             WHERE txid = ?1 AND state = 'reserved'",
            params![&txid[..]],
        )?;

        Ok(rows)
    }

    /// Deletes confirmed pending spend records once their spend is buried beyond confirmation depth.
    pub fn prune_mined_spends(
        conn: &Connection,
        current_tip_height: u32,
        min_confirmations: u32,
    ) -> Result<usize, WalletError> {
        let buried_height = current_tip_height.saturating_sub(min_confirmations);
        let rows = conn.execute(
            "DELETE FROM pending_spends 
             WHERE state = 'mined' AND nullifier IN (
                 SELECT nullifier FROM received_notes 
                 WHERE spent_at_height IS NOT NULL AND spent_at_height <= ?1
             )",
            params![buried_height as i64],
        )?;

        Ok(rows)
    }
}
