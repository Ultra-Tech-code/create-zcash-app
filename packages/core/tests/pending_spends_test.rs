use rusqlite::params;
use zcash_core::{PendingSpendsManager, WalletDb, WalletError};

fn insert_test_note(db: &WalletDb, id: i64, nullifier: &[u8; 32], spent: bool) {
    let spent_txid = if spent { Some(vec![0xFFu8; 32]) } else { None };
    let spent_height = if spent { Some(5) } else { None };

    db.conn().execute(
        "INSERT INTO received_notes (
            id, account_id, pool, txid, action_index, height, recipient,
            value_zatoshis, nullifier, rho, rseed, cmx, tree_position,
            scope, memo, spent_in_txid, spent_at_height
        ) VALUES (?1, 'acct0', 'ironwood', ?2, ?1, 2, 'uregtest1dummy', 500000, ?3, ?4, ?5, ?6, ?1, 'external', NULL, ?7, ?8)",
        params![
            id,
            vec![0x11u8; 32],
            &nullifier[..],
            vec![0x22u8; 32],
            vec![0x33u8; 32],
            vec![0x44u8; 32],
            spent_txid,
            spent_height,
        ],
    ).expect("insert test note");
}

#[test]
fn test_reserve_notes_and_state_transitions() {
    println!("\n=== TEST: PENDING SPENDS STATE MACHINE & DUAL LOCKS ===");
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let db_path = temp_dir.path().join("wallet_spends.db");
    let mut db = WalletDb::open_or_create(&db_path, "regtest", "fp_spends", Some(2)).expect("db open");

    let nf1 = [0x01u8; 32];
    insert_test_note(&db, 1, &nf1, false);

    let txid1 = [0xAAu8; 32];
    let owner_pid = 12345u32;
    let expiry_height = 100u32;
    let tip_height = 50u32;

    // 1. Reserve note 1
    println!("  Reserving note 1 for txid1...");
    PendingSpendsManager::reserve_notes(
        db.conn_mut(),
        &[(1, nf1)],
        &txid1,
        expiry_height,
        owner_pid,
        tip_height,
    ).expect("reserve note 1");

    // Verify row created with state 'reserved'
    let (state, pid): (String, i64) = db.conn().query_row(
        "SELECT state, owner_pid FROM pending_spends WHERE nullifier = ?1",
        params![&nf1[..]],
        |r| Ok((r.get(0)?, r.get(1)?)),
    ).expect("query pending spend");
    assert_eq!(state, "reserved");
    assert_eq!(pid, owner_pid as i64);

    // 2. Dual-lock: attempting to reserve the same note again fails immediately
    println!("  Attempting duplicate reservation on note 1...");
    let txid2 = [0xBBu8; 32];
    let dup_res = PendingSpendsManager::reserve_notes(
        db.conn_mut(),
        &[(1, nf1)],
        &txid2,
        expiry_height,
        54321,
        tip_height,
    );
    match dup_res {
        Err(WalletError::LockError(msg)) => {
            println!("  Correctly rejected duplicate reservation: {}", msg);
            assert!(msg.contains("already reserved"));
        }
        other => panic!("Expected LockError, got {:?}", other),
    }

    // 3. Attempting to reserve an already spent note fails
    let nf_spent = [0x02u8; 32];
    insert_test_note(&db, 2, &nf_spent, true);
    let spent_res = PendingSpendsManager::reserve_notes(
        db.conn_mut(),
        &[(2, nf_spent)],
        &txid2,
        expiry_height,
        owner_pid,
        tip_height,
    );
    match spent_res {
        Err(WalletError::NoteNotSpendable(msg)) => {
            println!("  Correctly rejected already-spent note: {}", msg);
            assert!(msg.contains("already confirmed spent"));
        }
        other => panic!("Expected NoteNotSpendable error, got {:?}", other),
    }

    // 4. Mark broadcast: transitions state from 'reserved' to 'broadcast'
    println!("  Marking reservation as broadcast...");
    let updated = PendingSpendsManager::mark_broadcast(db.conn(), &txid1).expect("mark broadcast");
    assert_eq!(updated, 1);
    let b_state: String = db.conn().query_row(
        "SELECT state FROM pending_spends WHERE txid = ?1",
        params![&txid1[..]],
        |r| r.get(0),
    ).expect("query state");
    assert_eq!(b_state, "broadcast");

    // 5. Cancel reservation (e.g. if aborted before broadcast):
    let nf3 = [0x03u8; 32];
    insert_test_note(&db, 3, &nf3, false);
    let txid3 = [0xCCu8; 32];
    PendingSpendsManager::reserve_notes(
        db.conn_mut(),
        &[(3, nf3)],
        &txid3,
        expiry_height,
        owner_pid,
        tip_height,
    ).expect("reserve note 3");
    let cancelled = PendingSpendsManager::cancel_reservation(db.conn(), &txid3).expect("cancel");
    assert_eq!(cancelled, 1);
    let count: i64 = db.conn().query_row("SELECT COUNT(*) FROM pending_spends WHERE txid = ?1", params![&txid3[..]], |r| r.get(0)).expect("count");
    assert_eq!(count, 0, "Cancelled reservation must be deleted completely");
    println!("  Cancelled reservation deleted; note returned to spendable pool");
}

#[test]
fn test_slow_proving_heartbeat_refresh_preserves_reservation() {
    println!("\n=== TEST: SLOW PROVE HEARTBEAT REFRESH (AUTHORITY OVER PID) ===");
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let db_path = temp_dir.path().join("wallet_heartbeat.db");
    let mut db = WalletDb::open_or_create(&db_path, "regtest", "fp_hb", Some(2)).expect("db open");

    let nf = [0x10u8; 32];
    insert_test_note(&db, 10, &nf, false);

    let txid = [0xEEu8; 32];
    let owner_pid = 9999u32;
    let tip = 100u32;
    let expiry = 140u32;

    // Reserve note 10
    PendingSpendsManager::reserve_notes(
        db.conn_mut(),
        &[(10, nf)],
        &txid,
        expiry,
        owner_pid,
        tip,
    ).expect("reserve");

    // Simulate proving operation taking 150 seconds (exceeding 120s timeout)
    // To simulate time advancing by 150 seconds, we manually backdate the original heartbeat_at by 150s:
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).expect("time").as_secs() as i64;
    db.conn().execute(
        "UPDATE pending_spends SET heartbeat_at = ?1 WHERE txid = ?2",
        params![now - 150, &txid[..]],
    ).expect("backdate heartbeat");

    // If no heartbeat refresh occurs, cleanup WOULD delete it:
    // But our active send calls refresh_heartbeat during proving!
    println!("  Prover periodically refreshing heartbeat during long proof...");
    let refreshed = PendingSpendsManager::refresh_heartbeat(db.conn(), &txid, owner_pid).expect("refresh hb");
    assert_eq!(refreshed, 1, "Must update heartbeat for in-progress reservation");

    // Run cleanup
    let deleted = PendingSpendsManager::cleanup_stale_and_expired(db.conn(), tip, 120).expect("cleanup");
    assert_eq!(deleted, 0, "Reservation with refreshed heartbeat must NOT be deleted");

    let exists: i64 = db.conn().query_row(
        "SELECT COUNT(*) FROM pending_spends WHERE txid = ?1 AND state = 'reserved'",
        params![&txid[..]],
        |r| r.get(0),
    ).expect("check exists");
    assert_eq!(exists, 1, "Reservation remains safely locked during long proving session");
    println!("  Verified: Slow prove (>120s simulated) with periodic heartbeat never loses its reservation!");
}

#[test]
fn test_stale_reservation_and_expired_tx_cleanup() {
    println!("\n=== TEST: STALE RESERVATION & EXPIRED TX CLEANUP ===");
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let db_path = temp_dir.path().join("wallet_cleanup.db");
    let db = WalletDb::open_or_create(&db_path, "regtest", "fp_clean", Some(2)).expect("db open");

    let nf_stale = [0x21u8; 32];
    insert_test_note(&db, 21, &nf_stale, false);

    let nf_expired = [0x22u8; 32];
    insert_test_note(&db, 22, &nf_expired, false);

    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).expect("time").as_secs() as i64;

    // 1. Insert a crashed/stale reservation (heartbeat 200s ago)
    db.conn().execute(
        "INSERT INTO pending_spends (nullifier, note_id, txid, created_at, expiry_height, state, owner_pid, heartbeat_at)
         VALUES (?1, 21, ?2, ?3, 200, 'reserved', 1111, ?4)",
        params![&nf_stale[..], vec![0x21u8; 32], now - 200, now - 200],
    ).expect("insert stale");

    // 2. Insert a broadcast transaction whose expiry_height (100) has passed tip (105)
    db.conn().execute(
        "INSERT INTO pending_spends (nullifier, note_id, txid, created_at, expiry_height, state, owner_pid, heartbeat_at)
         VALUES (?1, 22, ?2, ?3, 100, 'broadcast', 2222, ?3)",
        params![&nf_expired[..], vec![0x22u8; 32], now - 50],
    ).expect("insert expired");

    println!("  Running cleanup at tip height 105 with 120s timeout...");
    let deleted = PendingSpendsManager::cleanup_stale_and_expired(db.conn(), 105, 120).expect("cleanup");
    assert_eq!(deleted, 2, "Both stale reservation and expired transaction must be cleaned up");

    // Notes return to spendable immediately
    let count: i64 = db.conn().query_row("SELECT COUNT(*) FROM pending_spends", [], |r| r.get(0)).expect("count");
    assert_eq!(count, 0, "All expired and stale rows removed; notes spendable again");
    println!("  Stale reservation and expired broadcast transaction successfully cleaned up!");
}
