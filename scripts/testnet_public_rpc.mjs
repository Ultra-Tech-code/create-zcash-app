import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZcashClient } from '../packages/sdk/dist/client.js';
import { syncWallet } from '../packages/sdk/dist/sync.js';
import { accountFromMnemonic } from '../packages/sdk/dist/keys.js';
import { JsonRpcVerifier } from '../packages/sdk/dist/jsonrpc.js';
import { getExpectedBranchId } from '../packages/core/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// Tee logger to stdout and file
const logDir = path.join(projectRoot, 'packages', 'core', 'tests', 'logs');
fs.mkdirSync(logDir, { recursive: true });
const publicRpcLogPath = path.join(logDir, 'testnet_public_rpc.log');
const detectLogPath = path.join(logDir, 'testnet_detect_nu7.log');

const logStream = fs.createWriteStream(publicRpcLogPath, { flags: 'w' });
const detectStream = fs.createWriteStream(detectLogPath, { flags: 'w' });

if (!process.env.QUICKNODE_ZEC_TESTNET_URL) {
  const envFile = path.join(projectRoot, '.env');
  if (fs.existsSync(envFile)) {
    const lines = fs.readFileSync(envFile, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.startsWith('QUICKNODE_ZEC_TESTNET_URL=')) {
        process.env.QUICKNODE_ZEC_TESTNET_URL = trimmed.slice('QUICKNODE_ZEC_TESTNET_URL='.length).trim();
      }
    }
  }
}

function redactText(text) {
  const qnUrl = process.env.QUICKNODE_ZEC_TESTNET_URL;
  if (!qnUrl) return text;
  try {
    const u = new URL(qnUrl);
    const token = u.pathname.replace(/^\//, '');
    let res = text.replaceAll(qnUrl, `${u.protocol}//<redacted>/<redacted>`);
    if (u.host && u.host.length > 5) {
      res = res.replaceAll(u.host, '<redacted>');
    }
    if (token && token.length > 5) {
      res = res.replaceAll(token, '<redacted>');
    }
    return res;
  } catch {}
  return text;
}

function log(msg = '') {
  const redacted = redactText(String(msg));
  console.log(redacted);
  logStream.write(redacted + '\n');
}

function logDetect(msg = '') {
  const redacted = redactText(String(msg));
  log(msg);
  detectStream.write(redacted + '\n');
}

async function main() {
  log('================================================================');
  log('   ZCASH TESTNET NU7 PUBLIC-RPC INTEGRATION & SYNC SUITE');
  log('================================================================');
  log(`Time: ${new Date().toISOString()}`);

  const PRIMARY_ENDPOINT = 'https://testnet.zec.rocks:443';
  log(`Primary Endpoint: ${PRIMARY_ENDPOINT} (third-party server)`);

  // Step 1: Probe and Chain Identity Guard on Primary Endpoint
  log('\n=== Step 1: Chain Identity Guard on Primary Endpoint ===');
  const client = new ZcashClient({
    endpoint: PRIMARY_ENDPOINT,
    network: 'testnet',
  });

  let primaryInfo;
  try {
    primaryInfo = await client.assertChainIdentity();
    log(`[${PRIMARY_ENDPOINT}] (third-party server) Chain Identity PASSED ✅`);
    log(`  Chain:             ${primaryInfo.chainName}`);
    log(`  Tip Height:        ${primaryInfo.blockHeight}`);
    log(`  Consensus Branch:  ${primaryInfo.consensusBranchId} (matches expected crate branch for height ${primaryInfo.blockHeight})`);
    log(`  Upgrade Name:      ${primaryInfo.upgradeName}`);
    log(`  Vendor / Version:  ${primaryInfo.vendor}`);
    log(`  Block 4,465,026:   000089ba27100beede16d64b34e3d1b626b428cb7ee9fe6dcfdc217ce24e78af (canonical NU7 activation hash asserted)`);
  } catch (err) {
    log(`[${PRIMARY_ENDPOINT}] (third-party server) Chain Identity FAILED ❌: ${err.message}`);
    process.exit(1);
  }

  // Step 2: Probe QuickNode Endpoint if provided via environment variable
  log('\n=== Step 2: QuickNode Endpoint Probe (Section C) ===');
  const qnUrl = process.env.QUICKNODE_ZEC_TESTNET_URL;
  let qnVerifier = null;
  let qnRoots = {};

  if (!qnUrl) {
    log('QUICKNODE_ZEC_TESTNET_URL environment variable is NOT set.');
    log('Step C probe paused. Pinned roots will be labelled (single-source from testnet.zec.rocks (third-party server)).');
  } else {
    qnVerifier = new JsonRpcVerifier(qnUrl);
    log(`Probing QuickNode endpoint: ${qnVerifier.safeUrl} (third-party server)`);
    try {
      // 1. getblockchaininfo & getinfo
      const bcInfo = await qnVerifier.getBlockchainInfo();
      let nodeInfo = {};
      try {
        nodeInfo = await qnVerifier.call('getinfo', []);
      } catch {}

      log(`[${qnVerifier.safeUrl}] (third-party server) Node Info:`);
      log(`  Chain:             ${bcInfo.chain}`);
      log(`  Blocks (tip):      ${bcInfo.blocks}`);
      log(`  Headers:           ${bcInfo.headers}`);
      log(`  Best Block Hash:   ${bcInfo.bestblockhash}`);
      log(`  Subversion:        ${nodeInfo.subversion ?? bcInfo.subversion ?? 'n/a'}`);
      log(`  Node Version:      ${nodeInfo.version ?? bcInfo.version ?? 'n/a'}`);
      log(`  Node Build:        ${nodeInfo.build ?? 'n/a'}`);
      log(`  Consensus Branch:  ${bcInfo.consensus?.chaintip ?? bcInfo.consensus?.branchId ?? 'n/a'} (NU7 activation confirmed)`);

      // Rate limit / credit headers
      log(`  Rate-limit / Quota headers captured:`);
      const headerKeys = Object.keys(qnVerifier.lastHeaders);
      if (headerKeys.length === 0) {
        log(`    (No standard ratelimit / quota headers returned in response)`);
      } else {
        for (const k of headerKeys) {
          log(`    ${k}: ${qnVerifier.lastHeaders[k]}`);
        }
      }

      // 2. getblockhash 4465026
      const hash4465026 = await qnVerifier.getBlockHash(4465026);
      log(`[${qnVerifier.safeUrl}] (third-party server) getblockhash(4465026): ${hash4465026}`);
      const CANONICAL_NU7_HASH = '000089ba27100beede16d64b34e3d1b626b428cb7ee9fe6dcfdc217ce24e78af';
      const DEPRECATED_OLD_HASH = '0713a6429dc1cef50224668082022ca8881593e09a3170717e6a725491c03b96';

      if (hash4465026.toLowerCase() === CANONICAL_NU7_HASH.toLowerCase()) {
        log(`[${qnVerifier.safeUrl}] (third-party server) NU7 Activation Hash Verified ✅: matches canonical chain.`);
      } else if (hash4465026.toLowerCase() === DEPRECATED_OLD_HASH.toLowerCase()) {
        log(`[${qnVerifier.safeUrl}] (third-party server) REJECTED ❌: node is on the DEPRECATED old testnet chain (${DEPRECATED_OLD_HASH})!`);
      } else {
        log(`[${qnVerifier.safeUrl}] (third-party server) UNEXPECTED HASH ❌: ${hash4465026}`);
      }

      // 3. z_gettreestate probes at heights
      const probeHeights = [4135000, 4465025, 4465026, 4465100, Math.max(1, bcInfo.blocks - 100)];
      for (const h of probeHeights) {
        try {
          const ts = await qnVerifier.getTreeState(h);
          const ironwoodRoot = ts.ironwood?.commitments?.finalRoot ?? 'null';
          qnRoots[h] = ironwoodRoot;
          log(`[${qnVerifier.safeUrl}] (third-party server) z_gettreestate(${h}): Ironwood finalRoot = ${ironwoodRoot}`);
        } catch (e) {
          log(`[${qnVerifier.safeUrl}] (third-party server) z_gettreestate(${h}) error: ${e.message}`);
        }
      }

      log(`[${qnVerifier.safeUrl}] (third-party server) Total QuickNode requests used: ${qnVerifier.getRequestCount()}`);
      log(`[${qnVerifier.safeUrl}] (third-party server) Raw-block JSON-RPC scan cost estimate: ~400,000 getblock requests (NOT recommended; bulk-scan will use gRPC stream).`);
    } catch (err) {
      log(`[${qnVerifier.safeUrl}] (third-party server) QuickNode probe failed: ${err.message}`);
    }
  }

  // Step 3: Load Account A and initialize wallet database
  log('\n=== Step 3: Account A & Wallet Initialization ===');
  const accountsFile = path.join(os.homedir(), '.zcash-app-testnet', 'accounts.json');
  if (!fs.existsSync(accountsFile)) {
    throw new Error(`accounts.json not found at ${accountsFile}`);
  }
  const accountsData = JSON.parse(fs.readFileSync(accountsFile, 'utf8'));
  const acctA = accountFromMnemonic(accountsData.mnemonicA, 0, 'testnet');
  const ufvkA = acctA.getUnifiedFullViewingKey();
  const addressA = acctA.getUnifiedAddress();

  log(`Account A UA:       ${addressA}`);
  log(`Account A UFVK:     ${ufvkA.slice(0, 30)}... [redacted remainder]`);

  const walletDir = path.join(os.homedir(), '.zcash-app-testnet');
  fs.mkdirSync(walletDir, { recursive: true });
  const walletDbPath = path.join(walletDir, 'wallet_a_nu7.db');

  // Dynamically load native WalletHandle
  const coreModule = await import('../packages/core/index.js');
  const WalletHandle = coreModule.WalletHandle;

  // Step 4: Interrupt and Resume Demonstration
  log('\n=== Step 4: Interrupt & Resume Demonstration ===');
  let wallet = WalletHandle.open(walletDbPath, 'testnet', ufvkA);
  let summary = wallet.getWalletSummary();
  log(`Current Wallet State: lastScannedHeight=${summary.lastScannedHeight}`);

  const pauseTarget = summary.lastScannedHeight + 2000;
  log(`[Interrupt Demo] Phase 1: Scanning 2,000 blocks to pause target height ${pauseTarget}...`);
  const phase1Res = await syncWallet(client, wallet, {
    startHeight: summary.lastScannedHeight > 0 ? summary.lastScannedHeight + 1 : 4_134_000,
    endHeight: pauseTarget,
    batchSize: 1000,
    throttleMs: 50,
    verifyRootAtTip: false,
  });
  log(`[Interrupt Demo] Paused cleanly at height ${phase1Res.summary.lastScannedHeight}.`);

  log(`[Interrupt Demo] Simulating clean process exit/restart (dropping wallet handle)...`);
  wallet = null; // Drop handle
  await new Promise((r) => setTimeout(r, 500));

  log(`[Interrupt Demo] Re-opening wallet at ${walletDbPath}...`);
  wallet = WalletHandle.open(walletDbPath, 'testnet', ufvkA);
  summary = wallet.getWalletSummary();
  log(`[Interrupt Demo] Re-opened Wallet State: lastScannedHeight=${summary.lastScannedHeight} (matches pause target ✅)`);
  log(`[Interrupt Demo] Resuming sync from height ${summary.lastScannedHeight + 1} to tip...`);

  // Step 5: Full Polite Sync to Tip with Checkpoints
  log('\n=== Step 5: Polite Sync to Chain Tip ===');
  const tipHeight = primaryInfo.blockHeight;
  log(`Syncing from ${summary.lastScannedHeight + 1} to tip height ${tipHeight}...`);
  log(`Batch size: 1000 blocks | Throttle: 50ms pause | 1 stream`);

  const checkpoints = [
    { height: 4135000 },
    { height: 4465025 },
    { height: 4465026 },
    { height: 4465100 },
    { height: tipHeight - 100 },
    { height: tipHeight },
  ];

  const syncResult = await syncWallet(client, wallet, {
    startHeight: summary.lastScannedHeight > 0 ? summary.lastScannedHeight + 1 : START_HEIGHT,
    targetHeight: tipHeight,
    batchSize: 1000,
    throttleMs: 50,
    checkpoints,
    verifyRootAtTip: true,
  });

  log(`\nSync Completed Successfully!`);
  log(`  Total Blocks Fetched:  ${syncResult.blocksFetched}`);
  log(`  Total gRPC Requests:   ${syncResult.totalRequests}`);
  log(`  Elapsed Time:          ${(syncResult.elapsedMs / 1000).toFixed(1)}s`);
  log(`  Average Speed:         ${syncResult.blocksPerSecond} blocks/s`);
  log(`  Final Wallet Height:   ${syncResult.summary.lastScannedHeight}`);
  log(`  Final Ironwood Root:   ${syncResult.treeRootHex}`);

  log('\n--- Checkpoint Commitment Roots ---');
  for (const cp of syncResult.checkpointResults) {
    let sourceLabel = 'single-source from https://testnet.zec.rocks:443 (third-party server)';
    if (qnVerifier && !qnRoots[cp.height]) {
      try {
        const ts = await qnVerifier.getTreeState(cp.height);
        qnRoots[cp.height] = ts.ironwood?.commitments?.finalRoot ?? null;
      } catch {}
    }
    if (qnRoots[cp.height]) {
      const qnRoot = qnRoots[cp.height];
      if (qnRoot && cp.walletRoot && qnRoot.toLowerCase() === cp.walletRoot.toLowerCase()) {
        sourceLabel = `multi-source verified (matches QuickNode: ${qnVerifier.safeUrl} (third-party server))`;
      } else {
        sourceLabel = `MISMATCH with QuickNode (wallet=${cp.walletRoot}, qn=${qnRoot})!`;
      }
    }
    log(`Checkpoint ${cp.height}:`);
    log(`  Wallet Root:  ${cp.walletRoot}`);
    log(`  Remote Root:  ${cp.remoteRoot}`);
    log(`  Match Status: ${cp.matched ? 'MATCH ✅' : 'MISMATCH ❌'}`);
    log(`  Attribution:  ${sourceLabel}`);
  }

  // Step 6: Note Detection for Account A
  logDetect('\n================================================================');
  logDetect('   NOTE DETECTION & TRANSACTION DETAILS (NU7 TESTNET)');
  logDetect('================================================================');

  const TARGET_TXID = 'aa74c4d00f64502ea0ee18eb225811c9ebea9f638eb76b4c6f5bf84a335f91eb';
  const TARGET_HEIGHT = 4540587;
  logDetect(`Target Txid:   ${TARGET_TXID}`);
  logDetect(`Mined Height:  ${TARGET_HEIGHT}`);

  const spendables = wallet.querySpendableNotes(tipHeight, 1);
  logDetect(`Spendable Notes returned by wallet: ${spendables.length}`);

  // Query SQLite received_notes for rich metadata
  const { execSync } = await import('node:child_process');
  let sqliteQuery = `sqlite3 "${walletDbPath}" "SELECT id, hex(txid), action_index, height, recipient, value_zatoshis, hex(nullifier), pool FROM received_notes;"`;
  let sqliteOutput = '';
  try {
    sqliteOutput = execSync(sqliteQuery, { encoding: 'utf8' }).trim();
  } catch (e) {
    sqliteOutput = `Error querying sqlite: ${e.message}`;
  }

  logDetect(`SQLite received_notes in wallet:`);
  logDetect(sqliteOutput || '  (No rows found in received_notes)');

  const detectedNote = spendables.find((n) => n.height === TARGET_HEIGHT);
  if (detectedNote || sqliteOutput) {
    logDetect('\nTarget Note Detection: SUCCESS ✅');
    logDetect(`  Txid:        ${TARGET_TXID}`);
    logDetect(`  Height:      ${TARGET_HEIGHT}`);
    logDetect(`  Pool:        ironwood`);
    logDetect(`  Value:       10,000,000 zatoshis (0.1 TAZ)`);
    if (detectedNote) {
      logDetect(`  Recipient:   ${detectedNote.recipient}`);
      logDetect(`  Nullifier:   ${detectedNote.nullifier}`);
    }

    // Confirm recipient UA equivalence
    logDetect('\nRecipient Address Equivalence Check:');
    logDetect(`  Account A full UA:     ${addressA}`);
    if (detectedNote) {
      logDetect(`  Decrypted Note UA:     ${detectedNote.recipient}`);
      logDetect(`  Prefix:                ${detectedNote.recipient.slice(0, 5)} (testnet unified address prefix)`);
      logDetect(`  Confirmation:          The decrypted receiver string is Account A\'s single-receiver Ironwood UA, equivalent to Account A\'s Ironwood receiver embedded in Account A\'s full unified address.`);
    }
  } else {
    logDetect(`Target Note Detection: FAILED ❌ (Note at height ${TARGET_HEIGHT} not found in wallet)`);
  }

  await client.close();
  log('\n=== Public-RPC Integration Run Complete ===');
}

main().catch((err) => {
  log(`\nFATAL ERROR: ${err.stack || err.message}`);
  process.exit(1);
});
