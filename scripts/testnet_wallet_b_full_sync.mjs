#!/usr/bin/env node
/**
 * Testnet Wallet B Full Standard Sync
 *
 * PROVING THE STANDARD PATH:
 * Scans from activation height 4,134,000 to tip against https://testnet.zec.rocks:443.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { ZcashClient } from '../packages/sdk/dist/client.js';
import { syncWallet } from '../packages/sdk/dist/sync.js';
import { accountFromMnemonic } from '../packages/sdk/dist/keys.js';
import { WalletHandle } from '../packages/core/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const logDir = path.join(projectRoot, 'packages', 'core', 'tests', 'logs');
fs.mkdirSync(logDir, { recursive: true });
const syncLogPath = path.join(logDir, 'wallet_b_first_sync.log');
const logStream = fs.createWriteStream(syncLogPath, { flags: 'w' });

function log(msg = '') {
  console.log(msg);
  logStream.write(msg + '\n');
}

async function main() {
  log('================================================================');
  log('   WALLET B FULL STANDARD SYNC (PROVING CANONICAL PATH)');
  log('================================================================');
  log(`Timestamp: ${new Date().toISOString()}`);
  log('\n--- PRIOR SEEDED WALLET B ARTIFACT DOCUMENTATION ---');
  log('Previously, wallet_b_nu7.db was accelerated for rapid test assertions');
  log('by cloning the commitment tree tables (blocks, sapling_tree, orchard_tree)');
  log('from synced reference wallet_a_nu7.db up to height 4,542,233, followed by');
  log('a 7-block scan (4,542,234 to 4,542,241). This logic has been preserved');
  log('in scripts/seed_wallet_from_tree.mjs with a prominent "TEST ONLY" header.');
  log('----------------------------------------------------------------\n');

  const walletDir = path.join(os.homedir(), '.zcash-app-testnet');
  const accountsFile = path.join(walletDir, 'accounts.json');
  if (!fs.existsSync(accountsFile)) {
    log(`ERROR: accounts.json not found at ${accountsFile}`);
    process.exit(1);
  }

  const accountsData = JSON.parse(fs.readFileSync(accountsFile, 'utf8'));
  const acctB = accountFromMnemonic(accountsData.mnemonicB, 0, 'testnet');
  const ufvkB = acctB.getUnifiedFullViewingKey();
  const addressB = acctB.getUnifiedAddress();

  log(`Wallet B Unified Address: ${addressB}`);
  const walletBPath = path.join(walletDir, 'wallet_b_nu7.db');
  const backupBPath = path.join(walletDir, 'wallet_b_nu7.db.seeded_bak');

  log(`\n--- ANNOUNCEMENT & CLEAN SETUP ---`);
  if (fs.existsSync(walletBPath)) {
    log(`Notice: Backing up seeded wallet_b_nu7.db -> wallet_b_nu7.db.seeded_bak`);
    fs.copyFileSync(walletBPath, backupBPath);
    log(`Notice: Deleting ~/.zcash-app-testnet/wallet_b_nu7.db to create fresh wallet`);
    fs.unlinkSync(walletBPath);
  }

  log(`Creating fresh Wallet B at: ${walletBPath}`);
  const handleB = WalletHandle.open(walletBPath, 'testnet', ufvkB);
  log(`Fresh Wallet B initialized with Account B UFVK.`);

  const ENDPOINT = 'https://testnet.zec.rocks:443';
  log(`\n--- Connecting to ${ENDPOINT} ---`);
  const client = new ZcashClient({
    endpoint: ENDPOINT,
    network: 'testnet',
  });

  const chainInfo = await client.assertChainIdentity();
  const tipHeight = chainInfo.blockHeight;
  log(`Remote Tip Height:        ${tipHeight}`);
  log(`Chain Name:               ${chainInfo.chainName}`);
  log(`Consensus Branch ID:      0x${chainInfo.consensusBranchId.toString(16)}`);

  const START_HEIGHT = 4134000;
  log(`Starting full scan from activation height ${START_HEIGHT} to tip ${tipHeight}...`);
  log(`Batch size: 1000 blocks | Throttle: 50ms pause per batch`);

  const startTime = Date.now();

  const syncResult = await syncWallet(client, handleB, {
    batchSize: 1000,
    throttleMs: 50,
    birthday: START_HEIGHT,
    startHeight: START_HEIGHT,
    onProgress: (currentHeight, tip, notesCount) => {
      if (currentHeight % 20000 === 0 || currentHeight >= tip) {
        const pct = (((currentHeight - START_HEIGHT) / (tip - START_HEIGHT)) * 100).toFixed(1);
        const elapsedSec = (Date.now() - startTime) / 1000;
        const bps = elapsedSec > 0 ? ((currentHeight - START_HEIGHT) / elapsedSec).toFixed(1) : '0';
        log(`[Sync Progress] Height: ${currentHeight}/${tip} (${pct}%) | Notes: ${notesCount} | Speed: ${bps} blocks/s`);
      }
    },
  });

  const totalSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
  const totalBlocks = tipHeight - START_HEIGHT;
  const avgBps = (totalBlocks / parseFloat(totalSeconds)).toFixed(1);

  log(`\n--- SYNC BENCHMARK RESULTS ---`);
  log(`Total blocks scanned:     ${totalBlocks}`);
  log(`Total elapsed time:       ${totalSeconds} seconds (${(parseFloat(totalSeconds) / 60).toFixed(2)} minutes)`);
  log(`Average throughput:       ${avgBps} blocks/s`);
  log(`Final wallet height:      ${syncResult.summary.lastScannedHeight}`);

  log(`\n--- VERIFYING RECEIVED NOTES (SQLite query) ---`);
  const notesSql = 'SELECT id, value_zatoshis, height, pool, hex(txid) FROM received_notes;';
  const notesOutput = execFileSync('/usr/bin/sqlite3', [walletBPath, notesSql], { encoding: 'utf8' }).trim();
  log(`Query: ${notesSql}`);
  log(notesOutput || '(NO NOTES DETECTED)');

  // Assert expected 1,000,000-zat note at height 4,542,240
  const lines = notesOutput.split('\n');
  const matchingNote = lines.find((l) => l.includes('1000000|4542240|ironwood'));
  if (matchingNote) {
    log(`\nSUCCESS: 1,000,000-zat note at height 4,542,240 detected in fresh Wallet B!`);
    log(`Note detail: ${matchingNote}`);
  } else {
    log(`\nERROR: Expected 1,000,000-zat note at height 4,542,240 was NOT found in received_notes!`);
    process.exit(1);
  }

  log('\n================================================================');
  log('   WALLET B FULL STANDARD SYNC COMPLETED SUCCESSFULLY');
  log('================================================================');
}

main().catch((err) => {
  log(`Unhandled error: ${err.stack || err.message}`);
  process.exit(1);
});
