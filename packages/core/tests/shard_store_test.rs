use incrementalmerkletree::{Position, Retention};
use orchard::tree::MerkleHashOrchard;
use shardtree::{store::memory::MemoryShardStore, ShardTree};
use zcash_core::{
    IronwoodShardTree, SqliteShardStore, WalletDb, IRONWOOD_SHARD_HEIGHT, IRONWOOD_TREE_DEPTH,
};
use zcash_protocol::consensus::BlockHeight;

#[test]
fn test_shard_store_matches_memory_shard_store_roundtrip() {
    println!("\n=== TEST: SQLITE SHARD STORE MATCHES MEMORY SHARD STORE BIT-FOR-BIT ===");

    let temp_dir = tempfile::tempdir().expect("tempdir");
    let db_path = temp_dir.path().join("wallet.db");

    let db = WalletDb::open_or_create(&db_path, "regtest", "test_fp", Some(2)).expect("db open");

    // 1. Initialize both ShardTrees (Memory vs SQLite)
    let mem_store = MemoryShardStore::<MerkleHashOrchard, BlockHeight>::empty();
    let mut mem_tree: ShardTree<_, IRONWOOD_TREE_DEPTH, IRONWOOD_SHARD_HEIGHT> =
        ShardTree::new(mem_store, 100);

    let sqlite_store = SqliteShardStore::new(db.conn(), "ironwood_tree");
    let mut sqlite_tree: IronwoodShardTree<SqliteShardStore> = ShardTree::new(sqlite_store, 100);

    // 2. Generate deterministic Pallas commitments
    let make_leaf = |i: u8| -> MerkleHashOrchard {
        let mut bytes = [0u8; 32];
        bytes[0] = i.wrapping_add(1);
        bytes[1] = i.wrapping_mul(3);
        MerkleHashOrchard::from_bytes(&bytes).expect("valid Pallas leaf")
    };

    // Block 2: append leaves 0..10, mark leaf 3
    println!("  Appending Block 2 (10 leaves, leaf 3 marked)...");
    for i in 0..10 {
        let leaf = make_leaf(i);
        let ret = if i == 3 {
            Retention::Marked
        } else {
            Retention::Ephemeral
        };
        mem_tree.append(leaf, ret).expect("mem append");
        sqlite_tree.append(leaf, ret).expect("sqlite append");
    }
    mem_tree.checkpoint(BlockHeight::from_u32(2)).expect("mem checkpoint");
    sqlite_tree.checkpoint(BlockHeight::from_u32(2)).expect("sqlite checkpoint");

    // Verify roots match at Block 2 (depth Some(0))
    let mem_root_b2 = mem_tree.root_at_checkpoint_depth(Some(0)).expect("mem root").expect("b2 root");
    let sql_root_b2 = sqlite_tree.root_at_checkpoint_depth(Some(0)).expect("sql root").expect("b2 root");
    println!("  Block 2 Root: {}", hex::encode(mem_root_b2.to_bytes()));
    assert_eq!(mem_root_b2, sql_root_b2, "Roots at Block 2 must match bit-for-bit");

    // Block 3: append leaves 10..25, mark leaf 18
    println!("  Appending Block 3 (15 leaves, leaf 18 marked)...");
    for i in 10..25 {
        let leaf = make_leaf(i);
        let ret = if i == 18 {
            Retention::Marked
        } else {
            Retention::Ephemeral
        };
        mem_tree.append(leaf, ret).expect("mem append");
        sqlite_tree.append(leaf, ret).expect("sqlite append");
    }
    mem_tree.checkpoint(BlockHeight::from_u32(3)).expect("mem checkpoint");
    sqlite_tree.checkpoint(BlockHeight::from_u32(3)).expect("sqlite checkpoint");

    // Verify roots match at Block 3 (depth Some(0)) and Block 2 (depth Some(1))
    let mem_root_b3 = mem_tree.root_at_checkpoint_depth(Some(0)).expect("mem root").expect("b3 root");
    let sql_root_b3 = sqlite_tree.root_at_checkpoint_depth(Some(0)).expect("sql root").expect("b3 root");
    println!("  Block 3 Root: {}", hex::encode(mem_root_b3.to_bytes()));
    assert_eq!(mem_root_b3, sql_root_b3, "Roots at Block 3 must match bit-for-bit");

    let mem_root_b2_hist = mem_tree.root_at_checkpoint_depth(Some(1)).expect("mem historical root").expect("b2 hist");
    let sql_root_b2_hist = sqlite_tree.root_at_checkpoint_depth(Some(1)).expect("sql historical root").expect("b2 hist");
    assert_eq!(mem_root_b2_hist, sql_root_b2_hist, "Historical roots at depth 1 must match");

    // Compare witnesses for marked leaves
    let mem_wit3 = mem_tree
        .witness_at_checkpoint_id(Position::from(3), &BlockHeight::from_u32(3))
        .expect("mem wit")
        .expect("exists");
    let sql_wit3 = sqlite_tree
        .witness_at_checkpoint_id(Position::from(3), &BlockHeight::from_u32(3))
        .expect("sql wit")
        .expect("exists");
    assert_eq!(mem_wit3, sql_wit3, "Witness paths for leaf 3 must match bit-for-bit");
    assert_eq!(mem_wit3.root(make_leaf(3)), mem_root_b3, "Witness for leaf 3 verifies root");
    println!("  Witness for leaf 3 matches across memory and SQLite stores");

    let mem_wit18 = mem_tree
        .witness_at_checkpoint_id(Position::from(18), &BlockHeight::from_u32(3))
        .expect("mem wit")
        .expect("exists");
    let sql_wit18 = sqlite_tree
        .witness_at_checkpoint_id(Position::from(18), &BlockHeight::from_u32(3))
        .expect("sql wit")
        .expect("exists");
    assert_eq!(mem_wit18, sql_wit18, "Witness paths for leaf 18 must match bit-for-bit");
    assert_eq!(mem_wit18.root(make_leaf(18)), mem_root_b3, "Witness for leaf 18 verifies root");
    println!("  Witness for leaf 18 matches across memory and SQLite stores");

    // 3. Test persistence round-trip: drop sqlite_tree and reopen from SQLite DB on disk
    println!("  Testing disk persistence round-trip by reopening new ShardTree from DB file...");
    drop(sqlite_tree);
    drop(db);

    let reopened_db = WalletDb::open_or_create(&db_path, "regtest", "test_fp", None).expect("reopen");
    let reopened_store = SqliteShardStore::new(reopened_db.conn(), "ironwood_tree");
    let mut reopened_tree: IronwoodShardTree<SqliteShardStore> = ShardTree::new(reopened_store, 100);

    let reopened_root = reopened_tree.root_at_checkpoint_depth(Some(0)).expect("reopened root").expect("root");
    assert_eq!(reopened_root, mem_root_b3, "Reopened tree root on disk must match memory tree");

    let reopened_wit3 = reopened_tree
        .witness_at_checkpoint_id(Position::from(3), &BlockHeight::from_u32(3))
        .expect("reopened wit")
        .expect("exists");
    assert_eq!(reopened_wit3, mem_wit3, "Reopened witness on disk must match memory witness");
    println!("  Persistence round-trip confirmed: disk reload produces identical roots and witnesses");

    // 4. Test reorg rollback / truncate_to_checkpoint
    println!("  Testing reorg rollback: truncate_to_checkpoint(BlockHeight(2))...");
    mem_tree.truncate_to_checkpoint(&BlockHeight::from_u32(2)).expect("mem truncate");
    reopened_tree.truncate_to_checkpoint(&BlockHeight::from_u32(2)).expect("sqlite truncate");

    let mem_truncated_root = mem_tree.root_at_checkpoint_depth(Some(0)).expect("mem truncated root").expect("root");
    let sql_truncated_root = reopened_tree.root_at_checkpoint_depth(Some(0)).expect("sql truncated root").expect("root");
    assert_eq!(mem_truncated_root, sql_truncated_root, "Truncated roots must match");
    assert_eq!(mem_truncated_root, mem_root_b2, "Truncated root must revert to original Block 2 root");
    println!("  Reorg rollback verified: truncate_to_checkpoint rewinds tree state accurately");
}
