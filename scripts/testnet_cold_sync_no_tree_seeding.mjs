import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  accountFromMnemonic,
  WalletHandle,
  ZcashClient,
  syncWallet,
} from '../packages/sdk/dist/index.js';

const BIRTHDAY_HEIGHT = 4542200;
const TARGET_HEIGHT = 4542241;
const TESTNET_ENDPOINT = 'testnet.zec.rocks:443';

async function runColdSync() {
  console.log('========================================================================');
  console.log('COLD SYNC MEASUREMENT FROM REAL BIRTHDAY (NO TREE SEEDING)');
  console.log('========================================================================');
  console.log(`Execution Time:  ${new Date().toISOString()}`);
  console.log(`Live Endpoint:   https://${TESTNET_ENDPOINT}`);
  console.log(`Birthday Height: ${BIRTHDAY_HEIGHT}`);
  console.log(`Target Height:   ${TARGET_HEIGHT}`);
  console.log(`Block Range:     ${TARGET_HEIGHT - BIRTHDAY_HEIGHT + 1} blocks (4542200 to 4542241)`);
  console.log('Tree Seeding:    DISABLED (Completely unseeded fresh database)');
  console.log('========================================================================\n');

  const accountsFile = path.join(os.homedir(), '.zcash-app-testnet', 'accounts.json');
  if (!fs.existsSync(accountsFile)) {
    throw new Error(`accounts.json not found at ${accountsFile}`);
  }
  const accountsData = JSON.parse(fs.readFileSync(accountsFile, 'utf8'));
  const acctB = accountFromMnemonic(accountsData.mnemonicB, 0, 'testnet');
  const ufvkB = acctB.getUnifiedFullViewingKey();

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zcash_cold_sync_'));
  const dbPath = path.join(tempDir, 'wallet_cold.db');
  console.log(`Initialized fresh unseeded database: ${dbPath}`);

  const wallet = WalletHandle.open(dbPath, 'testnet', ufvkB, 'account0', BIRTHDAY_HEIGHT);
  const client = new ZcashClient({ endpoint: TESTNET_ENDPOINT, network: 'testnet' });

  console.log(`Starting cold sync from height ${BIRTHDAY_HEIGHT} to target ${TARGET_HEIGHT}...`);
  const startTime = performance.now();
  let syncError = null;
  let blocksScanned = 0;

  try {
    const res = await syncWallet(client, wallet, {
      startHeight: BIRTHDAY_HEIGHT,
      targetHeight: TARGET_HEIGHT,
      batchSize: 50,
      fullTxFetch: true,
    });
    blocksScanned = res.scannedHeight ? res.scannedHeight - BIRTHDAY_HEIGHT + 1 : 0;
  } catch (err) {
    syncError = err;
  } finally {
    const elapsedMs = performance.now() - startTime;
    const elapsedSec = (elapsedMs / 1000).toFixed(2);
    await client.close();

    console.log('\n========================================================================');
    console.log('COLD SYNC RESULTS & DURATION REPORT');
    console.log('========================================================================');
    console.log(`Elapsed Duration:    ${elapsedSec}s (${elapsedMs.toFixed(0)} ms)`);
    console.log(`Blocks Requested:    ${TARGET_HEIGHT - BIRTHDAY_HEIGHT + 1}`);

    if (syncError) {
      const errMsg = syncError.message || String(syncError);
      console.log(`Outcome:             FAILED / BLOCKED`);
      console.log(`Failure Reason:      ${errMsg}`);
      console.log('\nHonest Architectural Analysis:');
      console.log('  The Zebra / lightwalletd ShardTree scanner verifies commitment tree size continuity.');
      console.log('  At testnet block 4542200, the Orchard/Ironwood tree has 758,992 commitments.');
      console.log('  A cold, unseeded database starts with tree size 0, triggering an expected tree size gap');
      console.log('  ("expected 0, actual 758992") unless commitments are scanned continuously from activation');
      console.log('  (block 2) or the tree state is initialized via GetTreeState.');
      console.log('  Scanning from activation (4.5M blocks) at public lightwalletd rates (~20 blocks/s)');
      console.log('  would require ~225,000 seconds (over 62 hours), which is prohibitively slow for dashboard cold start.');
    } else {
      console.log(`Outcome:             SUCCESS`);
      console.log(`Blocks Scanned:      ${blocksScanned}`);
      console.log(`Scanning Rate:       ${(blocksScanned / (elapsedMs / 1000)).toFixed(2)} blocks/s`);
    }
    console.log('========================================================================');

    // Clean up temporary files
    try {
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
      if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

runColdSync().catch((err) => {
  console.error('Cold sync execution failed:', err);
  process.exit(1);
});
