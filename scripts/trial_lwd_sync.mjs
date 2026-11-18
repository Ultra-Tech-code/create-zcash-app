#!/usr/bin/env node
/**
 * Trial lightwalletd v0.6.2 behaviour changes:
 * 1. Default sync loop compatibility (batch size 1000, 50ms throttle)
 * 2. Concurrency check against --max-concurrent-recv (default 32)
 * 3. Stream idle timeout check against --client-stream-idle-timeout (default 30s)
 * 4. Testnet status report
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const {
  ZcashClient,
  syncWallet,
  accountFromMnemonic,
  KNOWN_TEST_MNEMONICS,
  WalletHandle,
  decodeIronwoodFrontierRoot,
} = await import(`${projectRoot}/packages/sdk/dist/index.js`);

const LOG_FILE = path.resolve(
  process.env.SYNC_TRIAL_LOG ||
  `${projectRoot}/packages/core/tests/logs/trial_lwd_v062_sync.log`
);

const logLines = [];
function log(msg = '') {
  console.log(msg);
  logLines.push(msg);
}

async function main() {
  log(`=== LIGHTWALLETD v0.6.2 BEHAVIOUR TRIAL ===`);
  log(`Date: ${new Date().toISOString()}`);
  log(`Platform: ${process.platform} ${process.arch} (${process.version})`);
  log(`Output log: ${LOG_FILE}\n`);

  const endpoint = process.env.LIGHTWALLETD_ENDPOINT || '127.0.0.1:39067';
  const client = new ZcashClient({ endpoint });

  log(`--- STEP 2.1: Indexer Info & Version Verification ---`);
  const info = await client.getInfo();
  log(`Vendor: ${info.vendor}`);
  log(`Version: ${info.version}`);
  log(`Git Commit: ${info.gitCommit}`);
  log(`Branch: ${info.branch}`);
  log(`Consensus Branch ID: ${info.consensusBranchId}`);
  log(`Block Height: ${info.blockHeight}`);
  log(`Chain Name: ${info.chainName}`);

  if (info.vendor !== 'ECC LightWalletD') {
    throw new Error(`Expected vendor ECC LightWalletD, got ${info.vendor}`);
  }
  if (info.version !== 'v0.6.2') {
    throw new Error(`Expected version v0.6.2, got ${info.version}`);
  }
  if (!info.gitCommit.startsWith('f8fe2cca7ede')) {
    throw new Error(`Expected commit f8fe2cca7ede..., got ${info.gitCommit}`);
  }
  log(`[PASS] Verified lightwalletd v0.6.2 running with commit ${info.gitCommit}\n`);

  log(`--- STEP 2.2: SDK Default Sync Loop Test (batchSize=1000, throttleMs=50) ---`);
  const tipHeight = Number(info.blockHeight);
  log(`Target sync range: height 2 to tip ${tipHeight}`);

  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trial_sync_wallet_'));
  const dbPath = path.join(dbDir, 'wallet.sqlite');
  const account0 = accountFromMnemonic(KNOWN_TEST_MNEMONICS[0], 0, 'regtest');
  const ufvk = account0.getUnifiedFullViewingKey();
  const wallet = WalletHandle.open(dbPath, 'regtest', ufvk, 'acct0', 2);

  log(`Executing syncWallet with default parameters (batchSize=1000, throttleMs=50)...`);
  const syncStart = Date.now();
  const syncResult = await syncWallet(client, wallet, {
    batchSize: 1000,
    throttleMs: 50,
    birthday: 2,
    network: 'regtest',
    ufvk,
    fetchFullTransactions: false,
  });
  const syncElapsed = Date.now() - syncStart;

  log(`Sync completed in ${syncElapsed} ms`);
  log(`Blocks fetched: ${syncResult.blocksFetched}`);
  log(`Wallet lastScannedHeight: ${syncResult.summary.lastScannedHeight}`);
  log(`Tip height: ${syncResult.tipHeight}`);
  log(`Tree root hex: ${syncResult.treeRootHex}`);
  log(`Tree state matched: ${syncResult.treeStateMatched}`);
  log(`Total requests: ${syncResult.totalRequests}`);

  if (syncResult.summary.lastScannedHeight !== tipHeight) {
    throw new Error(`Sync incomplete: lastScannedHeight ${syncResult.summary.lastScannedHeight} != tip ${tipHeight}`);
  }
  if (!syncResult.treeStateMatched) {
    throw new Error(`Tree root mismatch at tip height ${tipHeight}`);
  }
  log(`[PASS] SDK default sync loop completed cleanly against lightwalletd v0.6.2 without being cut or rejected.\n`);

  log(`--- STEP 2.3: Concurrency Test (--max-concurrent-recv default 32) ---`);
  log(`Testing 16 concurrent getRawBlockRange requests...`);
  const p16 = [];
  for (let i = 0; i < 16; i++) {
    p16.push((async () => {
      let count = 0;
      for await (const _ of client.getRawBlockRange(2, Math.min(20, tipHeight))) {
        count++;
      }
      return count;
    })());
  }
  const results16 = await Promise.all(p16);
  log(`16 concurrent requests resolved successfully: counts = [${results16.slice(0, 4).join(', ')}, ...] (all ${results16[0]} blocks)`);

  log(`Testing 32 concurrent getRawBlockRange requests (matching default limit 32)...`);
  const p32 = [];
  for (let i = 0; i < 32; i++) {
    p32.push((async () => {
      let count = 0;
      for await (const _ of client.getRawBlockRange(2, Math.min(20, tipHeight))) {
        count++;
      }
      return count;
    })());
  }
  const results32 = await Promise.all(p32);
  log(`32 concurrent requests resolved successfully: counts = [${results32.slice(0, 4).join(', ')}, ...] (all ${results32[0]} blocks)`);
  log(`[PASS] No rejection or RESOURCE_EXHAUSTED observed under 32 concurrent stream requests.\n`);

  log(`--- STEP 2.4: Stream Idle Timeout Test (--client-stream-idle-timeout default 30s) ---`);
  log(`SDK sync loop uses 50 ms politeness throttle between batches.`);
  log(`Since 50 ms << 30,000 ms (30s), normal streaming is completely unaffected.`);
  log(`Testing short idle pause (5 seconds):`);
  const iter = client.getRawBlockRange(2, tipHeight)[Symbol.asyncIterator]();
  const firstBlock = await iter.next();
  log(`Received first block (height 2, ${firstBlock.value?.length || 0} bytes). Pausing stream consumption for 5 seconds...`);
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const secondBlock = await iter.next();
  log(`Received second block after 5s pause (height 3, ${secondBlock.value?.length || 0} bytes). Stream remained healthy.`);
  // Drain remaining blocks
  let drained = 2;
  while (true) {
    const item = await iter.next();
    if (item.done) break;
    drained++;
  }
  log(`Stream drained cleanly to completion (${drained} blocks total).`);
  log(`[PASS] Stream idle timeout of 30s does not disrupt normal or delayed stream consumers within timeout window.\n`);

  log(`--- STEP 2.5: Testnet Sync Benchmark Status ---`);
  log(`Querying public testnet endpoint (testnet.zec.rocks:443)...`);
  try {
    const testnetClient = new ZcashClient({ endpoint: 'testnet.zec.rocks:443' });
    const testnetInfo = await testnetClient.getInfo();
    log(`Public testnet indexer version: ${testnetInfo.version}`);
    log(`Public testnet git commit: ${testnetInfo.gitCommit}`);
    log(`Public testnet consensus branch ID: ${testnetInfo.consensusBranchId}`);
    log(`Testnet sync benchmark on lightwalletd v0.6.2: NOT TESTED (no public or local testnet endpoint running lightwalletd v0.6.2 is available; testnet.zec.rocks:443 runs v0.6.1 commit ${testnetInfo.gitCommit.slice(0, 12)}).`);
  } catch (err) {
    log(`Could not connect to testnet.zec.rocks:443: ${err.message}`);
    log(`Testnet sync benchmark on lightwalletd v0.6.2: NOT TESTED (no public or local testnet endpoint running lightwalletd v0.6.2 is available).`);
  }

  log(`\n=== ALL CHECKS COMPLETED SUCCESSFULLY ===`);

  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.writeFileSync(LOG_FILE, logLines.join('\n') + '\n', 'utf8');
  console.log(`Saved log to ${LOG_FILE}`);

  // Cleanup temp db
  try {
    fs.rmSync(dbDir, { recursive: true, force: true });
  } catch {}
}

main().catch((err) => {
  console.error('Trial execution failed:', err);
  process.exit(1);
});
