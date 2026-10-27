#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const COOKIE_PATH = path.join(os.homedir(), 'Library/Caches/zebra/.cookie');
const LOCAL_RPC_URL = process.env.LOCAL_ZEBRA_RPC_URL || 'http://127.0.0.1:18232';
const SUMMARY_JSON_PATH = path.join(projectRoot, 'packages/core/tests/logs/chain_queries/summary.json');

const KNOWN_TXID = '8ca516abc441e6b95783eb4d733e091dc7312fc1f9e42de43273ed906a65095a';
const KNOWN_HEIGHT = 4542240;
const KNOWN_CHECKPOINT_HEIGHT = 4542475;
const KNOWN_ROOT_4542475 = '9b39d0b326b53b9a93e798e7e58add0d086e09ce8972e59cf68fa40ef58a6706';

function reverseHex(hexStr) {
  return Buffer.from(hexStr, 'hex').reverse().toString('hex');
}

function replaceHome(str) {
  if (!str) return str;
  return String(str).replaceAll(os.homedir(), '~');
}

async function main() {
  console.log('===============================================================');
  console.log('=== PART A: LOCAL TESTNET ZEBRA NODE READ-ONLY RPC QUERIES ===');
  console.log('===============================================================');

  // 1. Secret handling: Read cookie from disk at runtime without logging/echoing it
  if (!fs.existsSync(COOKIE_PATH)) {
    console.error(`❌ Local Zebra cookie file not found at: ${replaceHome(COOKIE_PATH)}`);
    process.exit(1);
  }

  const rawCookie = fs.readFileSync(COOKIE_PATH, 'utf8').trim();
  if (!rawCookie) {
    console.error('❌ Local Zebra cookie file is empty');
    process.exit(1);
  }

  // Format of Zebra cookie is __cookie__:<token>
  const authHeader = 'Basic ' + Buffer.from(rawCookie).toString('base64');
  console.log(`[AUTH] Successfully read cookie authentication from ${replaceHome(COOKIE_PATH)} (token redacted)`);

  async function rpcCall(method, params = []) {
    let res;
    try {
      res = await fetch(LOCAL_RPC_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
    } catch (err) {
      console.error(`❌ Network error connecting to local Zebra RPC at ${LOCAL_RPC_URL}:`, err.message);
      process.exit(1);
    }

    if (res.status === 401 || res.status === 403) {
      console.error(`❌ Basic auth with __cookie__:<token> failed on ${LOCAL_RPC_URL} (HTTP ${res.status}). Stopping at Part A.`);
      process.exit(1);
    }

    if (!res.ok) {
      console.error(`❌ RPC call ${method} failed with HTTP status ${res.status}`);
      process.exit(1);
    }

    const json = await res.json();
    if (json.error) {
      console.error(`❌ RPC error in ${method}:`, json.error);
      process.exit(1);
    }
    return json.result;
  }

  const assertions = [];
  function assertCheck(name, condition, details = '') {
    const passed = Boolean(condition);
    assertions.push({ name, passed, details });
    if (passed) {
      console.log(`[PASS] ${name}${details ? ` (${details})` : ''}`);
    } else {
      console.error(`[FAIL] ${name}${details ? ` (${details})` : ''}`);
      throw new Error(`Assertion failed: ${name} - ${details}`);
    }
  }

  // Read chain_queries/summary.json for reference
  let summary = null;
  if (fs.existsSync(SUMMARY_JSON_PATH)) {
    summary = JSON.parse(fs.readFileSync(SUMMARY_JSON_PATH, 'utf8'));
  }

  // 1. getblockchaininfo
  console.log('\n--- 1. Querying getblockchaininfo ---');
  const bci = await rpcCall('getblockchaininfo');
  console.log('Chain:              ', bci.chain);
  console.log('Blocks:             ', bci.blocks);
  console.log('Best Block Hash:    ', bci.bestblockhash);
  console.log('NU7 Upgrade Status: ', JSON.stringify(bci.upgrades?.['77190ad9']));
  assertCheck('Chain is testnet', bci.chain === 'test');
  assertCheck('Tip is well past NU7 activation height 4465026', bci.blocks > 4465026, `blocks=${bci.blocks}`);
  assertCheck('NU7 consensus upgrade is active', bci.upgrades?.['77190ad9']?.status === 'active');

  // 2. getblockcount
  console.log('\n--- 2. Querying getblockcount ---');
  const blockCount = await rpcCall('getblockcount');
  console.log('Block count:        ', blockCount);
  assertCheck('Block count equals getblockchaininfo blocks', blockCount === bci.blocks, `count=${blockCount}`);

  // 3. getrawtransaction (verbose)
  console.log(`\n--- 3. Querying getrawtransaction for ${KNOWN_TXID} ---`);
  const tx = await rpcCall('getrawtransaction', [KNOWN_TXID, 1]);
  console.log('Tx Version:         ', tx.version);
  console.log('Tx VersionGroupID:   0x' + tx.versiongroupid);
  console.log('Tx Expiry Height:   ', tx.expiryheight);
  console.log('Tx Ironwood Anchor: ', tx.ironwood?.anchor);
  const reversedAnchor = tx.ironwood?.anchor ? reverseHex(tx.ironwood.anchor) : '';
  console.log('Tx Reversed Anchor: ', reversedAnchor);

  assertCheck('Tx Version is 6 (NU7 format)', tx.version === 6);
  assertCheck('Tx VersionGroupID is 0xd884b698', tx.versiongroupid.toLowerCase() === 'd884b698');
  assertCheck('Tx Expiry Height is 4542278', tx.expiryheight === 4542278);

  if (summary) {
    assertCheck(
      'Tx expiry matches summary.json expected_expiry',
      tx.expiryheight === summary.checks.expiry_height_equals_4542278.expected_expiry,
      `expiry=${tx.expiryheight}`
    );
    assertCheck(
      'Tx raw anchor matches summary.json raw_anchor_on_chain_zebra_order',
      tx.ironwood?.anchor?.toLowerCase() === summary.checks.tx_anchor_matches_send_run_root.raw_anchor_on_chain_zebra_order.toLowerCase(),
      `anchor=${tx.ironwood?.anchor}`
    );
    assertCheck(
      'Tx reversed anchor matches summary.json root_printed_in_testnet_send_run_log',
      reversedAnchor.toLowerCase() === summary.checks.tx_anchor_matches_send_run_root.root_printed_in_testnet_send_run_log.toLowerCase(),
      `reversed=${reversedAnchor}`
    );
  }

  // 4. getblock for 4542240
  console.log(`\n--- 4. Querying getblock for height ${KNOWN_HEIGHT} ---`);
  const block = await rpcCall('getblock', [String(KNOWN_HEIGHT), 1]);
  console.log('Block Height:       ', block.height);
  console.log('Block Hash:         ', block.hash);
  console.log('Block Num Tx:       ', block.tx?.length);
  assertCheck('Block height is 4542240', block.height === KNOWN_HEIGHT);
  assertCheck('Block contains verified testnet send txid', block.tx?.includes(KNOWN_TXID));

  if (summary) {
    assertCheck(
      'Block hash matches summary.json quicknode_getblockhash & lightwalletd_getblock_hash',
      block.hash.toLowerCase() === summary.checks.block_hashes_equal.quicknode_getblockhash.toLowerCase(),
      `hash=${block.hash}`
    );
  }

  // 5. z_gettreestate at 4542475
  console.log(`\n--- 5. Querying z_gettreestate for height ${KNOWN_CHECKPOINT_HEIGHT} ---`);
  const treeState = await rpcCall('z_gettreestate', [String(KNOWN_CHECKPOINT_HEIGHT)]);
  const nodeIronwoodRoot = treeState.ironwood?.commitments?.finalRoot;
  console.log('TreeState Height:   ', treeState.height);
  console.log('Ironwood FinalRoot: ', nodeIronwoodRoot);
  assertCheck('TreeState height is 4542475', Number(treeState.height) === KNOWN_CHECKPOINT_HEIGHT);
  assertCheck(
    'Ironwood root matches known three-way root verification (9b39d0b3...6706)',
    nodeIronwoodRoot?.toLowerCase() === KNOWN_ROOT_4542475.toLowerCase(),
    `root=${nodeIronwoodRoot}`
  );

  // Summary Banner computed strictly from assertions
  const passedCount = assertions.filter((a) => a.passed).length;
  const totalCount = assertions.length;
  const allPassed = totalCount >= 10 && passedCount === totalCount;

  if (allPassed) {
    console.log('\n' + '='.repeat(70));
    console.log(`=== PART A VERIFIED: ALL ${passedCount}/${totalCount} LOCAL NODE ASSERTIONS PASSED ✅ ===`);
    console.log('='.repeat(70) + '\n');
  } else {
    console.error(`\n❌ VERIFICATION FAILED: Only ${passedCount}/${totalCount} assertions passed!`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error during local node queries:', err);
  process.exit(1);
});
