use serde::Deserialize;
use std::fs;
use std::path::Path;
use zcash_core::WalletHandle;

#[derive(Deserialize)]
struct FixtureData {
    height: u32,
    #[serde(rename = "treeSize")]
    tree_size: u32,
    #[serde(rename = "ironwoodTreeFrontierHex")]
    ironwood_tree_frontier_hex: String,
    #[serde(rename = "blockHashBytesHex")]
    block_hash_bytes_hex: String,
}

const EXPECTED_ROOT_HEX: &str = "89d7e4b0ed7d60fa46124d5335e09f6b2e0a4a5e7684fac5a9f9807da3e9d71c";

fn get_testnet_ufvk() -> String {
    let phrase = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    zcash_core::internal_derive_account_from_mnemonic(phrase, 0, "testnet")
        .unwrap_or_else(|e| panic!("derive testnet ufvk: {e}"))
        .ufvk
}

#[test]
fn test_tree_frontier_init_from_captured_fixture() {
    println!("\n=== TEST: PARSE CAPTURED FRONTIER FIXTURE & INITIALIZE SHARDTREE ===");

    let fixture_path = Path::new("tests/fixtures/tree_state_4542199.json");
    let fixture_bytes = match fs::read(fixture_path) {
        Ok(b) => b,
        Err(_) => fs::read("packages/core/tests/fixtures/tree_state_4542199.json")
            .unwrap_or_else(|e| panic!("Failed to read fixture: {}", e)),
    };

    let fixture: FixtureData = serde_json::from_slice(&fixture_bytes)
        .unwrap_or_else(|e| panic!("Failed to parse fixture JSON: {}", e));

    assert_eq!(fixture.height, 4542199);
    assert_eq!(fixture.tree_size, 758992);

    let temp_dir = tempfile::tempdir().unwrap_or_else(|e| panic!("Failed tempdir: {}", e));
    let db_path = temp_dir.path().join("wallet_frontier_test.db");

    // Open wallet at birthday 4542200
    let wallet = WalletHandle::open(
        db_path.to_str().unwrap_or_default().to_string(),
        "testnet".to_string(),
        get_testnet_ufvk(),
        Some("account0".to_string()),
        Some(4542200),
    ).unwrap_or_else(|e| panic!("WalletHandle::open failed: {}", e));

    assert!(wallet.is_tree_empty().unwrap_or_default(), "Tree must be empty initially");

    let block_hash_bytes = hex::decode(&fixture.block_hash_bytes_hex).unwrap_or_default();
    let block_hash_buf = napi::bindgen_prelude::Buffer::from(block_hash_bytes);

    // Initialize frontier
    let res = wallet.init_tree_frontier(
        fixture.height,
        fixture.ironwood_tree_frontier_hex.clone(),
        fixture.tree_size,
        Some(block_hash_buf),
    ).unwrap_or_else(|e| panic!("init_tree_frontier failed: {}", e));

    println!("  Initialized tree frontier at height {}:", res.height);
    println!("    Parsed Tree Size: {}", res.tree_size);
    println!("    Tree Root Hex:    {}", res.root_hex);
    println!("    Already Init:     {}", res.already_initialized);

    assert_eq!(res.height, 4542199);
    assert_eq!(res.tree_size, 758992);
    assert_eq!(res.root_hex, EXPECTED_ROOT_HEX);
    assert!(!res.already_initialized);
    assert!(!wallet.is_tree_empty().unwrap_or(true), "Tree must no longer be empty");

    // Verify wallet summary reflects the starting checkpoint
    let summary = wallet.get_wallet_summary().unwrap_or_else(|e| panic!("get_wallet_summary failed: {}", e));
    assert_eq!(summary.last_scanned_height, 4542199);
    assert_eq!(summary.tree_size, 758992);
    println!("  ✓ Verified wallet summary matches starting checkpoint bit-for-bit");
}

#[test]
fn test_tree_frontier_init_size_mismatch_rejection() {
    println!("\n=== NEGATIVE TEST: SIZE-MISMATCH REJECTION ===");

    let fixture_path = Path::new("tests/fixtures/tree_state_4542199.json");
    let fixture_bytes = match fs::read(fixture_path) {
        Ok(b) => b,
        Err(_) => fs::read("packages/core/tests/fixtures/tree_state_4542199.json")
            .unwrap_or_else(|e| panic!("Failed to read fixture: {}", e)),
    };
    let fixture: FixtureData = serde_json::from_slice(&fixture_bytes)
        .unwrap_or_else(|e| panic!("Failed to parse fixture: {}", e));

    let temp_dir = tempfile::tempdir().unwrap_or_else(|e| panic!("Failed tempdir: {}", e));
    let db_path = temp_dir.path().join("wallet_mismatch_test.db");

    let wallet = WalletHandle::open(
        db_path.to_str().unwrap_or_default().to_string(),
        "testnet".to_string(),
        get_testnet_ufvk(),
        Some("account0".to_string()),
        Some(4542200),
    ).unwrap_or_else(|e| panic!("WalletHandle::open failed: {}", e));

    // Expected size is intentionally altered (e.g. 758990 instead of 758992)
    let tampered_expected_size = fixture.tree_size - 2;
    let res = wallet.init_tree_frontier(
        fixture.height,
        fixture.ironwood_tree_frontier_hex.clone(),
        tampered_expected_size,
        None,
    );

    assert!(res.is_err(), "Must reject size mismatch loudly");
    let err_str = res.err().unwrap().to_string();
    println!("  Observed error message: {}", err_str);
    assert!(err_str.contains("Tree size mismatch"), "Error must clearly explain tree size mismatch");
    assert!(err_str.contains("758992"), "Error must report actual parsed size");
    assert!(err_str.contains(&tampered_expected_size.to_string()), "Error must report expected size");
    println!("  ✓ Size mismatch rejected loudly with clear diagnostics");
}

#[test]
fn test_tree_frontier_init_empty_frontier_rejection() {
    println!("\n=== NEGATIVE TEST: EMPTY / MISSING FRONTIER REJECTION ===");

    let temp_dir = tempfile::tempdir().unwrap_or_else(|e| panic!("Failed tempdir: {}", e));
    let db_path = temp_dir.path().join("wallet_empty_test.db");

    let wallet = WalletHandle::open(
        db_path.to_str().unwrap_or_default().to_string(),
        "testnet".to_string(),
        get_testnet_ufvk(),
        Some("account0".to_string()),
        Some(4542200),
    ).unwrap_or_else(|e| panic!("WalletHandle::open failed: {}", e));

    // Case 1: Empty string
    let res1 = wallet.init_tree_frontier(4542199, "".to_string(), 758992, None);
    assert!(res1.is_err(), "Empty string frontier must fail loudly");
    let err1 = res1.err().unwrap().to_string();
    println!("  Case 1 (empty string) error: {}", err1);
    assert!(err1.contains("empty or missing"));

    // Case 2: Zero bytes with expected_tree_size > 0
    let res2 = wallet.init_tree_frontier(4542199, "000000".to_string(), 758992, None);
    assert!(res2.is_err(), "Zero bytes frontier for non-zero tree size must fail loudly");
    let err2 = res2.err().unwrap().to_string();
    println!("  Case 2 (000000 for size > 0) error: {}", err2);
    assert!(err2.contains("empty (zero bytes)"));

    println!("  ✓ Empty frontier correctly rejected loudly");
}

#[test]
fn test_tree_frontier_init_idempotent() {
    println!("\n=== TEST: IDEMPOTENT RE-INITIALIZATION ===");

    let fixture_path = Path::new("tests/fixtures/tree_state_4542199.json");
    let fixture_bytes = match fs::read(fixture_path) {
        Ok(b) => b,
        Err(_) => fs::read("packages/core/tests/fixtures/tree_state_4542199.json")
            .unwrap_or_else(|e| panic!("Failed to read fixture: {}", e)),
    };
    let fixture: FixtureData = serde_json::from_slice(&fixture_bytes)
        .unwrap_or_else(|e| panic!("Failed to parse fixture: {}", e));

    let temp_dir = tempfile::tempdir().unwrap_or_else(|e| panic!("Failed tempdir: {}", e));
    let db_path = temp_dir.path().join("wallet_idempotent_test.db");

    let wallet = WalletHandle::open(
        db_path.to_str().unwrap_or_default().to_string(),
        "testnet".to_string(),
        get_testnet_ufvk(),
        Some("account0".to_string()),
        Some(4542200),
    ).unwrap_or_else(|e| panic!("WalletHandle::open failed: {}", e));

    let block_hash_bytes = hex::decode(&fixture.block_hash_bytes_hex).unwrap_or_default();

    // 1. First init
    let res1 = wallet.init_tree_frontier(
        fixture.height,
        fixture.ironwood_tree_frontier_hex.clone(),
        fixture.tree_size,
        Some(napi::bindgen_prelude::Buffer::from(block_hash_bytes.clone())),
    ).unwrap_or_else(|e| panic!("First init failed: {}", e));
    assert!(!res1.already_initialized);
    assert_eq!(res1.tree_size, fixture.tree_size);
    assert_eq!(res1.root_hex, EXPECTED_ROOT_HEX);

    // 2. Second init with identical parameters must be an idempotent no-op
    let res2 = wallet.init_tree_frontier(
        fixture.height,
        fixture.ironwood_tree_frontier_hex.clone(),
        fixture.tree_size,
        Some(napi::bindgen_prelude::Buffer::from(block_hash_bytes)),
    ).unwrap_or_else(|e| panic!("Second init failed: {}", e));
    assert!(res2.already_initialized, "Second init must report already_initialized: true");
    assert_eq!(res2.tree_size, fixture.tree_size);
    assert_eq!(res2.root_hex, EXPECTED_ROOT_HEX);

    // Summary must remain unchanged
    let summary = wallet.get_wallet_summary().unwrap_or_else(|e| panic!("get_wallet_summary failed: {}", e));
    assert_eq!(summary.last_scanned_height, fixture.height);
    assert_eq!(summary.tree_size, fixture.tree_size);
    println!("  ✓ Idempotent re-initialization verified successfully");
}
