import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  createClient,
  accountFromMnemonic,
  syncWallet,
  decodeIronwoodFrontierRoot,
  WalletHandle,
} from '../packages/sdk/dist/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const BIRTHDAY_HEIGHT = 4542200;
const ENDPOINT = 'https://testnet.zec.rocks:443';
const NETWORK = 'testnet';
const EXPECTED_TXID = '8ca516abc441e6b95783eb4d733e091dc7312fc1f9e42de43273ed906a65095a';

const LOG_FILE = path.join(
  projectRoot,
  'packages',
  'core',
  'tests',
  'logs',
  'testnet_cold_sync_real_birthday.log'
);

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function main() {
  const logLines = [];
  function log(msg = '') {
    console.log(msg);
    logLines.push(msg);
  }

  log('========================================================================');
  log('STAGE 2d: REAL COLD SYNC FROM REAL BIRTHDAY (NO MANUAL SEEDING)');
  log('========================================================================');
  log(`Execution Time:    ${new Date().toISOString()}`);
  log(`Birthday Height:   ${BIRTHDAY_HEIGHT}`);
  log(`Target TxID:       ${EXPECTED_TXID}`);
  log(`Network:           ${NETWORK}`);
  log(`Remote Endpoint:   ${ENDPOINT}`);
  log('========================================================================\n');

  // STEP 1: Delete dashboard wallet directory / files for testnet
  log('[1/5] Identifying and deleting dashboard wallet files for testnet...');
  const dashboardDir = path.join(os.homedir(), '.zcash-app', 'dashboard');
  log(`  Exact Dashboard Wallet Directory: ${dashboardDir}`);

  if (fs.existsSync(dashboardDir)) {
    const files = fs.readdirSync(dashboardDir);
    const testnetFiles = files.filter((f) => f.startsWith('testnet_'));
    log(`  Found ${testnetFiles.length} existing testnet file(s) in dashboard directory:`);
    for (const f of testnetFiles) {
      const fullPath = path.join(dashboardDir, f);
      log(`    Deleting: ${fullPath}`);
      fs.unlinkSync(fullPath);
    }
  } else {
    log(`  Dashboard directory ${dashboardDir} does not exist yet; creating with 0700.`);
    fs.mkdirSync(dashboardDir, { recursive: true, mode: 0o700 });
  }

  // Confirm no testnet files remain
  const remainingTestnet = fs.readdirSync(dashboardDir).filter((f) => f.startsWith('testnet_'));
  if (remainingTestnet.length > 0) {
    throw new Error(`Failed to delete all testnet files: ${remainingTestnet.join(', ')}`);
  }
  log('  ✓ Exact testnet dashboard wallet files demonstrably deleted.\n');

  // STEP 2: Derive Account 0 for Wallet A
  log('[2/5] Reading accounts.json and deriving Account 0 for Wallet A...');
  const accountsFile = path.join(os.homedir(), '.zcash-app-testnet', 'accounts.json');
  if (!fs.existsSync(accountsFile)) {
    throw new Error(`accounts.json not found at ${accountsFile}`);
  }
  const accountsData = JSON.parse(fs.readFileSync(accountsFile, 'utf8'));
  const acctA = accountFromMnemonic(accountsData.mnemonicA, 0, NETWORK);
  const ufvkA = acctA.getUnifiedFullViewingKey();
  const ufvkHash = crypto.createHash('sha256').update(ufvkA.trim()).digest('hex').slice(0, 8);
  const accountId = `acct_${ufvkHash}`;
  const dbPath = path.join(dashboardDir, `testnet_${accountId}.db`);

  log(`  Derived Account ID:  ${accountId}`);
  log(`  Target DB Path:      ${dbPath}`);
  log(`  DB Exists Before Run: ${fs.existsSync(dbPath)} (MUST BE false)`);
  if (fs.existsSync(dbPath)) {
    throw new Error(`Invariant failed: ${dbPath} still exists before cold start!`);
  }

  // STEP 3: Open fresh WalletHandle with birthday 4542200
  log('\n[3/5] Opening brand new WalletHandle with birthday 4542200...');
  const wallet = WalletHandle.open(dbPath, NETWORK, ufvkA, accountId, BIRTHDAY_HEIGHT);
  const initialSummary = wallet.getWalletSummary();
  const isTreeEmpty = wallet.isTreeEmpty();

  log(`  Wallet opened. Database created at: ${dbPath}`);
  log(`  Initial lastScannedHeight: ${initialSummary.lastScannedHeight} (expected: 0)`);
  log(`  Initial treeSize:          ${initialSummary.treeSize} (expected: 0)`);
  log(`  Initial isTreeEmpty:       ${isTreeEmpty} (expected: true)`);
  if (!isTreeEmpty || initialSummary.lastScannedHeight !== 0) {
    throw new Error('Invariant failed: Fresh wallet must have empty tree and lastScannedHeight 0');
  }
  log('  ✓ Verified cold start state: tree is empty, no starting blocks.\n');

  // STEP 4: Run Real Cold Sync against testnet tip with NO manual seeding
  log('[4/5] Executing real cold sync to testnet tip (NO manual seeding)...');
  const client = createClient({ endpoint: ENDPOINT, network: NETWORK });
  const info = await client.getInfo();
  const tipHeight = Number(info.blockHeight);
  log(`  Live Testnet Tip Height: ${tipHeight}`);
  log(`  Total Blocks to Scan:    ${tipHeight - BIRTHDAY_HEIGHT + 1} (from birthday ${BIRTHDAY_HEIGHT})`);

  const syncStartTime = Date.now();
  const syncResult = await syncWallet(client, wallet, {
    birthday: BIRTHDAY_HEIGHT,
    ufvk: ufvkA,
    network: NETWORK,
    batchSize: 1000,
    throttleMs: 30,
    verifyRootAtTip: true,
  });
  const syncDurationMs = Date.now() - syncStartTime;
  const syncDurationSec = (syncDurationMs / 1000).toFixed(2);

  log('\n  --- SYNC PERFORMANCE & RESULTS ---');
  log(`  Sync Duration:           ${syncDurationSec} seconds (${syncDurationMs} ms)`);
  log(`  Blocks Fetched:          ${syncResult.blocksFetched}`);
  log(`  Scan Rate:               ${syncResult.blocksPerSecond.toFixed(1)} blocks/sec`);
  log(`  Total RPC Requests:      ${syncResult.totalRequests}`);
  log(`  Final Scanned Height:    ${syncResult.summary.lastScannedHeight}`);
  log(`  Final ShardTree Size:    ${syncResult.summary.treeSize}`);
  log(`  Unspent Notes Detected:  ${syncResult.summary.unspentNotesCount}`);
  log(`  Pending Tx Fetches:      ${syncResult.pendingFetches}`);
  log(`  Failed Tx Fetches:       ${syncResult.failedFetches}`);

  // Query Zebra TreeState at tip for root comparison
  const tipTreeState = await client.getTreeState(tipHeight);
  const zebraRootHex = decodeIronwoodFrontierRoot(tipTreeState.ironwoodTree);
  const walletRootHex = syncResult.treeRootHex;

  log('\n  --- TREE ROOT VERIFICATION ---');
  log(`  Wallet Ironwood Root:    ${walletRootHex}`);
  log(`  Zebra Tip TreeState Root: ${zebraRootHex}`);
  log(`  Tree Root Match Status:  ${walletRootHex === zebraRootHex ? 'EXACT MATCH (VERIFIED)' : 'MISMATCH'}`);

  if (walletRootHex !== zebraRootHex) {
    throw new Error(`Tree root mismatch at tip ${tipHeight}: wallet ${walletRootHex} != zebra ${zebraRootHex}`);
  }

  // STEP 5: Verify transaction table
  log('\n[5/5] Verifying decrypted transactions table...');
  const txs = wallet.getWalletTransactions(10, 0);
  log(`  Total Transactions Found: ${txs.length}`);
  for (const t of txs) {
    log(`    Row [id=${t.id}]: txid=${t.txid} action=${t.actionIndex} height=${t.height} direction=${t.direction} value=${t.value} memo="${t.memo}"`);
  }

  const outTx = txs.find((t) => t.txid === EXPECTED_TXID && t.direction === 'out');
  if (!outTx) {
    throw new Error(`Expected OUT transaction ${EXPECTED_TXID} was not detected or decrypted!`);
  }
  log(`\n  Target OUT Transaction:  ${outTx.txid}`);
  log(`  Height:                  ${outTx.height}`);
  log(`  Direction:               ${outTx.direction}`);
  log(`  Value:                   ${outTx.value} zatoshis`);
  log(`  Memo:                    "${outTx.memo}"`);
  log(`  Action Index:            ${outTx.actionIndex}`);
  log('  ✓ Target OUT transaction detected, decrypted, and upserted with correct direction (out).');

  const internalTx = txs.find((t) => t.txid === EXPECTED_TXID && t.direction === 'internal');
  if (internalTx) {
    log(`  ✓ Internal change output detected: action ${internalTx.actionIndex}, value ${internalTx.value} zatoshis\n`);
  }

  await client.close();

  log('========================================================================');
  log('✓ REAL COLD SYNC TEST COMPLETED SUCCESSFULLY WITH 100% ROOT INTEGRITY');
  log('========================================================================\n');

  // Write log file
  fs.writeFileSync(LOG_FILE, logLines.join('\n') + '\n', 'utf8');
  const logSha = sha256File(LOG_FILE);
  console.log(`Log File:   ${path.relative(projectRoot, LOG_FILE)}`);
  console.log(`SHA256:     ${logSha}`);
}

main().catch((err) => {
  console.error('Cold sync execution failed:', err);
  process.exit(1);
});
