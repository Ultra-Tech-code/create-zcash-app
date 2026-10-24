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

#[derive(serde::Deserialize)]
#[allow(non_snake_case)]
struct CmxItem {
    height: u32,
    cmx: String,
}

#[derive(serde::Deserialize)]
#[allow(non_snake_case)]
struct CmxDoc {
    startHeight: u32,
    height: u32,
    totalBlocks: u32,
    totalIronwoodActions: u32,
    cmxs: Vec<CmxItem>,
}

#[test]
fn test_p1_vs_p2_anchor_comparison() {
    println!("\n=== TEST: P1 COMMITMENT TREE VS P2 SHARDTREE OVER test_cmxs.json ===");

    let fixture_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("test_cmxs.json");

    assert!(fixture_path.exists(), "test_cmxs.json must exist at {:?}", fixture_path);

    let content = std::fs::read_to_string(&fixture_path).expect("read test_cmxs.json");
    let cmx_doc: CmxDoc = serde_json::from_str(&content).expect("parse test_cmxs.json");

    println!("Fixture Metadata:");
    println!("  Recorded startHeight:          {}", cmx_doc.startHeight);
    println!("  Recorded height (chain tip):   {}", cmx_doc.height);
    println!("  Recorded totalBlocks:          {}", cmx_doc.totalBlocks);
    println!("  Recorded totalIronwoodActions: {}", cmx_doc.totalIronwoodActions);
    println!("  Parsed cmxs count:             {}", cmx_doc.cmxs.len());

    assert_eq!(cmx_doc.height, 238);
    assert_eq!(cmx_doc.cmxs.len(), 193);

    // Method 1: P1 CommitmentTree (incrementalmerkletree::frontier::CommitmentTree)
    let mut p1_tree = incrementalmerkletree::frontier::CommitmentTree::<MerkleHashOrchard, 32>::empty();
    for item in &cmx_doc.cmxs {
        let cmx_bytes = hex::decode(&item.cmx).expect("valid hex cmx");
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&cmx_bytes);
        let leaf = MerkleHashOrchard::from_bytes(&arr).expect("valid Pallas leaf");
        p1_tree.append(leaf).expect("p1 append");
    }
    let p1_root: orchard::Anchor = p1_tree.root().into();
    let p1_root_hex = hex::encode(p1_root.to_bytes());
    println!("P1 CommitmentTree Root: {}", p1_root_hex);

    // Method 2: P2 ShardTree with SqliteShardStore
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let db_path = temp_dir.path().join("wallet_shardtree.db");
    let db = WalletDb::open_or_create(&db_path, "regtest", "fp_anchor_test", Some(2)).expect("db open");
    let sqlite_store = SqliteShardStore::new(db.conn(), "ironwood_tree");
    let mut p2_tree: IronwoodShardTree<SqliteShardStore> = ShardTree::new(sqlite_store, 100);

    // Group cmxs by height to append and checkpoint block-by-block
    let mut current_height = cmx_doc.startHeight;
    for item in &cmx_doc.cmxs {
        if item.height > current_height {
            p2_tree.checkpoint(BlockHeight::from_u32(current_height)).expect("p2 checkpoint");
            current_height = item.height;
        }
        let cmx_bytes = hex::decode(&item.cmx).expect("valid hex cmx");
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&cmx_bytes);
        let leaf = MerkleHashOrchard::from_bytes(&arr).expect("valid Pallas leaf");
        p2_tree.append(leaf, Retention::Ephemeral).expect("p2 append");
    }
    // Final checkpoint at recorded height 238
    p2_tree.checkpoint(BlockHeight::from_u32(cmx_doc.height)).expect("p2 final checkpoint");

    let p2_root = p2_tree.root_at_checkpoint_depth(Some(0)).expect("p2 root").expect("root exists");
    let p2_root_hex = hex::encode(p2_root.to_bytes());
    println!("P2 ShardTree Root:      {}", p2_root_hex);

    assert_eq!(p1_root_hex, p2_root_hex, "P1 and P2 methods MUST yield the exact same root!");
    println!("SUCCESS: Both P1 and P2 methods produce identical root: {}", p1_root_hex);

    // Search if 1c5a7114 matches any intermediate root or byte-reversed root
    let target = "1c5a7114b3589b2dbca921cb1dfbf18c2ca86d26be723466187adcb163013b0c";
    let mut check_tree = incrementalmerkletree::frontier::CommitmentTree::<MerkleHashOrchard, 32>::empty();
    let mut found_match = false;
    for (i, item) in cmx_doc.cmxs.iter().enumerate() {
        let cmx_bytes = hex::decode(&item.cmx).expect("valid hex cmx");
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&cmx_bytes);
        let leaf = MerkleHashOrchard::from_bytes(&arr).expect("valid Pallas leaf");
        check_tree.append(leaf).expect("append");
        let r: orchard::Anchor = check_tree.root().into();
        let r_hex = hex::encode(r.to_bytes());
        if r_hex == target {
            println!("MATCH FOUND for 1c5a7114 at index {} (height {})!", i, item.height);
            found_match = true;
        }
        // Also check byte reversed
        let mut rev = r.to_bytes();
        rev.reverse();
        if hex::encode(rev) == target {
            println!("REVERSED MATCH FOUND for 1c5a7114 at index {} (height {})!", i, item.height);
            found_match = true;
        }
    }
    if !found_match {
        println!("Checked all 193 leaf prefixes: target 1c5a7114 did not match any prefix of test_cmxs.json.");
    }
}

#[test]
fn test_decode_zaino_frontier_hex() {
    println!("\n=== TEST: DECODE ZAINO FRONTIER HEX AND VERIFY ROOT ===");
    let frontier_hex = "010d3f8b26dbf85bea4ee41e5f9346fbb333b3ca3d44047dce7370dfeebc31c50001d87e82e8fbe744caa5fbdf347ba48e79d3729b338d2efe380bc8348f64928d2e1f0000015e7b3bfc0feb82f5dd24cf8a06835efaca27cc804e1ee17a26255bc3a93217270001d522396c660822eecfa4d4180d333b07d094de9834d4db082c20068586418f3501eccfc7b98746433a335efa38e87a91b06f0b4fd19e507f10d945cc5079b3862200000000000000000000000000000000000000000000000000";
    let bytes = hex::decode(frontier_hex).expect("decode hex");

    let tree = zcash_primitives::merkle_tree::read_commitment_tree::<MerkleHashOrchard, _, 32>(&bytes[..])
        .expect("read CommitmentTree from bytes");
    let root: orchard::Anchor = tree.root().into();
    let root_hex = hex::encode(root.to_bytes());
    println!("Decoded Zaino Frontier Root: {}", root_hex);
    assert_eq!(root_hex, "b97d496047752711022273c8e7b2222cdeb3164247d5cf551ada66141642d212");
    println!("SUCCESS: Decoded frontier root matches wallet root b97d4960... bit-for-bit!");
}

#[test]
fn test_decode_zaino_tampered_frontier_fails_or_mismatches() {
    println!("\n=== NEGATIVE TEST: TAMPERED ZAINO FRONTIER REJECTION & ROOT MISMATCH ===");
    let original_frontier_hex = "010d3f8b26dbf85bea4ee41e5f9346fbb333b3ca3d44047dce7370dfeebc31c50001d87e82e8fbe744caa5fbdf347ba48e79d3729b338d2efe380bc8348f64928d2e1f0000015e7b3bfc0feb82f5dd24cf8a06835efaca27cc804e1ee17a26255bc3a93217270001d522396c660822eecfa4d4180d333b07d094de9834d4db082c20068586418f3501eccfc7b98746433a335efa38e87a91b06f0b4fd19e507f10d945cc5079b3862200000000000000000000000000000000000000000000000000";
    let expected_root = "b97d496047752711022273c8e7b2222cdeb3164247d5cf551ada66141642d212";

    // 1. First assert the genuine frontier root decodes and equals the authentic expected root
    let authentic_root = zcash_core::decode_ironwood_frontier_root(original_frontier_hex.to_string())
        .expect("decode authentic frontier root");
    assert_eq!(authentic_root, expected_root, "Genuine frontier root MUST equal expected root");
    println!("  Verified: Genuine frontier root ({}) matches authentic root bit-for-bit!", authentic_root);

    // 2. Case 1: Tampered payload bytes (mutate internal leaf hash by flipping bits)
    let mut tampered_bytes = hex::decode(original_frontier_hex).expect("decode hex");
    tampered_bytes[10] ^= 0xff; // corrupt byte inside leaf

    // Decoding either errors out (invalid curve point) or yields an entirely different root
    match zcash_primitives::merkle_tree::read_commitment_tree::<MerkleHashOrchard, _, 32>(&tampered_bytes[..]) {
        Ok(tree) => {
            let tampered_root: orchard::Anchor = tree.root().into();
            let tampered_root_hex = hex::encode(tampered_root.to_bytes());
            println!("  Tampered frontier decoded but yielded root: {}", tampered_root_hex);
            assert_ne!(
                tampered_root_hex, expected_root,
                "Tampered frontier MUST NOT match authentic root!"
            );
        }
        Err(e) => {
            println!("  Tampered frontier failed to decode as expected: {:?}", e);
        }
    }

    // 3. Case 2: Truncated or corrupt bytes must fail decode_ironwood_frontier_root
    let decode_res = zcash_core::decode_ironwood_frontier_root("deadbeef00".to_string());
    assert!(decode_res.is_err(), "Truncated frontier must return error");
    println!("SUCCESS: Tampered / corrupted frontier correctly yields mismatch or error!");
}

#[test]
#[ignore]
fn test_live_zebra_gettreestate_window_comparison() {
    println!("\n=== LIVE TEST: COMPARE WALLET SHARDTREE ROOT TO RAW ZEBRA GETTREESTATE ===");
    let rpc_url = "http://127.0.0.1:8181";

    let curl_rpc = |payload: &str| -> serde_json::Value {
        let output = std::process::Command::new("curl")
            .args(["-s", "-X", "POST", rpc_url, "-H", "Content-Type: application/json", "-d", payload])
            .output()
            .expect("execute curl");
        serde_json::from_slice(&output.stdout).expect("parse json response")
    };

    let info_resp = curl_rpc(r#"{"jsonrpc":"2.0","id":"info","method":"getblockchaininfo","params":[]}"#);
    let tip = info_resp["result"]["blocks"].as_u64().expect("tip height");
    println!("  Live Zebra tip height: {}", tip);

    let start_h = tip.saturating_sub(10).max(2);
    let mut compared_count = 0;

    for h in start_h..=tip {
        let req_body = format!(
            r#"{{"jsonrpc":"2.0","id":"tree","method":"z_gettreestate","params":["{}"]}}"#,
            h
        );
        let resp = curl_rpc(&req_body);

        let commitments = &resp["result"]["orchard"]["commitments"];
        if let Some(final_root) = commitments["finalRoot"].as_str() {
            let final_state = commitments["finalState"].as_str().unwrap_or("");
            if !final_state.is_empty() {
                let decoded_root = zcash_core::decode_ironwood_frontier_root(final_state.to_string())
                    .expect("decode frontier root");
                assert_eq!(
                    decoded_root, final_root,
                    "Decoded frontier root must match raw Zebra finalRoot at height {}",
                    h
                );
                println!("  Height {}: finalRoot {} strictly matches decoded finalState!", h, final_root);
                compared_count += 1;
            }
        }
    }

    assert!(compared_count >= 10, "Must compare at least 10 heights, compared {}", compared_count);
    println!("SUCCESS: Verified {} live heights against raw Zebra z_gettreestate!", compared_count);
}
