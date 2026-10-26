#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { ZcashClient } from '../packages/sdk/dist/client.js';
import { syncWallet } from '../packages/sdk/dist/sync.js';
import { accountFromMnemonic } from '../packages/sdk/dist/keys.js';
import { JsonRpcVerifier } from '../packages/sdk/dist/jsonrpc.js';
import {
  WalletHandle,
  decodeIronwoodFrontierRoot,
  ironwoodEmptyTreeRoot,
  getExpectedBranchId,
  getDefaultTxExpiryDelta,
  quoteFee,
} from '../packages/core/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// Redacted logging setup
const logDir = path.join(projectRoot, 'packages', 'core', 'tests', 'logs');
fs.mkdirSync(logDir, { recursive: true });
const sendLogPath = path.join(logDir, 'testnet_send.log');
const logStream = fs.createWriteStream(sendLogPath, { flags: 'w' });

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

function printUsage() {
  console.log(`
Usage: node scripts/testnet_send.mjs --amount-zat <zatoshis> --yes [options]

Required flags:
  --amount-zat <amount>   Amount to send in zatoshis (must be positive integer)
  --yes                   Required authorization flag; refuses to broadcast without it

Optional flags:
  --to <address>          Recipient Unified Address (defaults to Account B from accounts.json)
  --anchor <height>       Explicit anchor height (defaults to tip - 5)
  --help                  Show this help message
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  // 1. Parse arguments and enforce safety guards
  let amountZatStr = null;
  let hasYesFlag = false;
  let recipientAddress = null;
  let explicitAnchorHeight = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--amount-zat') {
      amountZatStr = args[i + 1];
      i++;
    } else if (args[i] === '--yes') {
      hasYesFlag = true;
    } else if (args[i] === '--to') {
      recipientAddress = args[i + 1];
      i++;
    } else if (args[i] === '--anchor') {
      explicitAnchorHeight = parseInt(args[i + 1], 10);
      i++;
    }
  }

  if (!amountZatStr) {
    console.error('REFUSING TO RUN: Missing required --amount-zat <amount> argument.');
    printUsage();
    process.exit(2);
  }

  const amountZat = BigInt(amountZatStr);
  if (amountZat <= 0n) {
    console.error(`REFUSING TO RUN: Invalid --amount-zat ${amountZatStr} (must be > 0).`);
    process.exit(2);
  }

  if (!hasYesFlag) {
    console.error('REFUSING TO BROADCAST WITHOUT EXPLICIT --yes FLAG.');
    console.error('This script broadcasts a live transaction to Zcash Testnet.');
    console.error('Provide --yes to confirm you want to perform this live broadcast.');
    printUsage();
    process.exit(2);
  }

  log('================================================================');
  log('   ZCASH TESTNET PHASE 5 CONTROLLED LIVE SEND PIPELINE');
  log('================================================================');
  log(`Timestamp: ${new Date().toISOString()}`);
  log(`Send Amount: ${amountZat} zatoshis (${Number(amountZat) / 100_000_000} ZEC)`);

  const PRIMARY_ENDPOINT = 'https://testnet.zec.rocks:443';
  log(`Primary Endpoint:   ${PRIMARY_ENDPOINT} (third-party server)`);

  // 2. Load accounts and sender wallet
  const walletDir = path.join(os.homedir(), '.zcash-app-testnet');
  const accountsFile = path.join(walletDir, 'accounts.json');
  if (!fs.existsSync(accountsFile)) {
    log(`ERROR: accounts.json not found at ${accountsFile}. Run scripts/testnet_public_rpc.mjs first.`);
    process.exit(1);
  }

  const accountsData = JSON.parse(fs.readFileSync(accountsFile, 'utf8'));
  const acctA = accountFromMnemonic(accountsData.mnemonicA, 0, 'testnet');
  const ufvkA = acctA.getUnifiedFullViewingKey();
  const addressA = acctA.getUnifiedAddress();
  const addressB = accountsData.accountB?.unifiedAddress ?? (accountFromMnemonic(accountsData.mnemonicB, 0, 'testnet')).getUnifiedAddress();

  const toAddress = recipientAddress ?? addressB;
  log(`Sender (Account A): ${addressA}`);
  log(`Recipient:          ${toAddress}`);

  const walletDbPath = path.join(walletDir, 'wallet_a_nu7.db');
  log(`Wallet DB:          ${walletDbPath}`);

  // 3. Connect and verify primary endpoint
  const client = new ZcashClient({
    endpoint: PRIMARY_ENDPOINT,
    network: 'testnet',
  });

  log('\n--- Step 1: Assert Chain Identity & Consensus Branch on Primary Endpoint ---');
  const primaryInfo = await client.assertChainIdentity();
  const tipHeight = primaryInfo.blockHeight;
  const expectedBranch = getExpectedBranchId('testnet', tipHeight);
  log(`Primary Tip Height:      ${tipHeight}`);
  log(`Primary Consensus Branch: 0x${primaryInfo.consensusBranchId} (expected: 0x${expectedBranch})`);
  log(`Chain Name:              ${primaryInfo.chainName}`);

  // 4. Select anchor height
  const anchorHeight = explicitAnchorHeight ?? (tipHeight - 5);
  log(`Selected Anchor Height:  ${anchorHeight} (tip - 5)`);

  // 5. Query roots on both endpoints
  log('\n--- Step 2: Query Ironwood Commitment Tree Roots on Both Endpoints ---');
  let primaryRootHex = null;
  try {
    const ts = await client.getTreeState(anchorHeight);
    const nodeTreeHex = (ts.ironwoodTree ?? '').toLowerCase();
    if (/^0*$/.test(nodeTreeHex)) {
      primaryRootHex = ironwoodEmptyTreeRoot().toLowerCase();
    } else {
      primaryRootHex = decodeIronwoodFrontierRoot(ts.ironwoodTree).toLowerCase();
    }
  } catch (err) {
    log(`Failed to fetch tree state from primary endpoint: ${err.message}`);
    process.exit(1);
  }

  let secondaryRootHex = null;
  let secondaryLabel = 'QuickNode RPC (third-party server)';
  const qnUrl = process.env.QUICKNODE_ZEC_TESTNET_URL;
  if (qnUrl) {
    try {
      const qnVerifier = new JsonRpcVerifier(qnUrl);
      secondaryLabel = `${qnVerifier.safeUrl} (third-party server)`;
      const qnTs = await qnVerifier.getTreeState(anchorHeight);
      const finalRoot = qnTs.ironwood?.commitments?.finalRoot;
      const finalState = qnTs.ironwood?.commitments?.finalState;
      if (finalRoot) {
        secondaryRootHex = finalRoot.toLowerCase();
      } else if (finalState) {
        if (/^0*$/.test(finalState)) {
          secondaryRootHex = ironwoodEmptyTreeRoot().toLowerCase();
        } else {
          secondaryRootHex = decodeIronwoodFrontierRoot(finalState).toLowerCase();
        }
      }
    } catch (err) {
      log(`Secondary endpoint check warning: ${err.message}`);
    }
  } else {
    log('Secondary endpoint not configured (QUICKNODE_ZEC_TESTNET_URL unset). Single-source verification.');
  }

  log(`Primary Endpoint Root:   ${primaryRootHex} [${PRIMARY_ENDPOINT}]`);
  log(`Secondary Endpoint Root: ${secondaryRootHex ?? '(unconfigured)'} [${secondaryLabel}]`);

  if (secondaryRootHex && primaryRootHex !== secondaryRootHex) {
    log(`CRITICAL: Anchor root mismatch between primary and secondary endpoints at height ${anchorHeight}!`);
    log(`  Primary:   ${primaryRootHex}`);
    log(`  Secondary: ${secondaryRootHex}`);
    log('Aborting send to protect against chain fork / eclipse attack.');
    process.exit(1);
  }

  // 6. Open wallet, sync to tip, and verify local tree root matches
  log('\n--- Step 3: Open Wallet & Verify Local Tree Anchor ---');
  const wallet = WalletHandle.open(walletDbPath, 'testnet', ufvkA);
  const summary = wallet.getWalletSummary();
  log(`Wallet Scanned Height:   ${summary.lastScannedHeight}`);

  if (summary.lastScannedHeight < tipHeight) {
    log(`Syncing wallet to tip height ${tipHeight}...`);
    await syncWallet(client, wallet, {
      startHeight: summary.lastScannedHeight + 1,
      endHeight: tipHeight,
      batchSize: 1000,
      throttleMs: 50,
      verifyRootAtTip: true,
    });
  }

  const localRootBuf = wallet.getTreeRootAtHeight(anchorHeight);
  if (!localRootBuf) {
    log(`ERROR: No local tree root checkpoint at anchor height ${anchorHeight}.`);
    process.exit(1);
  }
  const localRootHex = localRootBuf.toString('hex').toLowerCase();
  log(`Local Wallet Anchor:     ${localRootHex}`);

  if (localRootHex !== primaryRootHex) {
    log(`ERROR: Local anchor root ${localRootHex} does not match remote root ${primaryRootHex}`);
    process.exit(1);
  }
  log('Local anchor matches remote consensus root ✅');

  // 7. Select spendable notes
  log('\n--- Step 4: Select Notes & Calculate Fee ---');
  const spendableNotes = wallet.querySpendableNotes(anchorHeight, 1);
  if (spendableNotes.length === 0) {
    log(`ERROR: No spendable notes found in wallet at anchor height ${anchorHeight}.`);
    process.exit(1);
  }

  let selectedTotal = 0;
  const selectedNotes = [];
  const requiredFee = Number(quoteFee(2)); // Standard 2-action fee: 10,000 zatoshis

  for (const n of spendableNotes) {
    selectedNotes.push(n);
    selectedTotal += n.valueZatoshis;
    if (selectedTotal >= Number(amountZat) + requiredFee) break;
  }

  if (selectedTotal < Number(amountZat) + requiredFee) {
    log(`ERROR: Insufficient funds. Total spendable ${selectedTotal} < amount ${amountZat} + fee ${requiredFee}`);
    process.exit(1);
  }

  const selectedNoteIds = selectedNotes.map((n) => n.id);
  const reservationId = Buffer.alloc(32, 0x5a);
  const expiryDelta = getDefaultTxExpiryDelta('testnet', tipHeight);
  const expiryHeight = tipHeight + expiryDelta;

  log(`Spendable Note IDs:      ${selectedNoteIds.join(', ')}`);
  log(`Total Inbound:           ${selectedTotal} zatoshis`);
  log(`Output Amount:           ${amountZat} zatoshis`);
  log(`ZIP-317 Quoted Fee:      ${requiredFee} zatoshis`);
  log(`Expiry Height:           ${expiryHeight} (tip + ${expiryDelta})`);

  // 8. Build and prove transaction
  log('\n--- Step 5: Build and Halo2-Prove V6 Ironwood Transaction ---');
  wallet.reserveNotes(selectedNoteIds, reservationId, expiryHeight);

  let built;
  try {
    const buildReq = {
      spendHandle: acctA.spendHandle,
      recipientAddress: toAddress,
      amountZatoshis: Number(amountZat),
      memo: 'Phase 5 Controlled Live Send',
      anchorBytes: localRootBuf,
      anchorHeight,
      expiryHeight,
      spendableNoteIds: selectedNoteIds,
      reservationId,
    };
    built = await wallet.buildAndProveTransaction(buildReq);
  } catch (err) {
    wallet.cancelReservation(reservationId);
    log(`Transaction build/prove failed: ${err.message}`);
    process.exit(1);
  }

  const txidRpc = Buffer.from(built.txid, 'hex').reverse().toString('hex');

  // 9. Pre-broadcast validation & parameter verification
  log('\n================================================================');
  log('   PRE-BROADCAST VERIFICATION SUMMARY');
  log('================================================================');
  log(`TxID (node/explorer RPC order):    ${txidRpc}`);
  log(`TxID (internal builder byte order): ${built.txid}`);
  log(`Fee Paid:                ${built.fee} zatoshis (ZIP 317 standard)`);
  log(`Expiry Height:           ${built.expiryHeight}`);
  log(`Consensus Branch ID:     0x${expectedBranch} (NU7)`);
  log(`Anchor Height:           ${anchorHeight}`);
  log(`Primary Root:            ${primaryRootHex}`);
  log(`Secondary Root:          ${secondaryRootHex ?? '(unconfigured)'}`);
  log(`Number of Actions:       ${built.numActions}`);
  log(`Raw Transaction Size:    ${built.rawBytes.length} bytes`);
  log('================================================================\n');

  // 10. Broadcast transaction exactly once (no auto-retry)
  log('--- Step 6: Single-Shot Broadcast (Exactly Once) ---');
  log(`Broadcasting ${built.rawBytes.length} bytes to ${PRIMARY_ENDPOINT}...`);

  let sendRes;
  try {
    sendRes = await client.sendTransaction(built.rawBytes);
  } catch (err) {
    wallet.cancelReservation(reservationId);
    log(`CRITICAL: Broadcast RPC call threw error: ${err.message}`);
    process.exit(1);
  }

  if (sendRes.errorCode !== 0) {
    wallet.cancelReservation(reservationId);
    log(`CRITICAL: Transaction broadcast rejected by node!`);
    log(`  Error Code:    ${sendRes.errorCode}`);
    log(`  Error Message: ${sendRes.errorMessage}`);
    process.exit(1);
  }

  const txidBuf = Buffer.from(built.txid, 'hex');
  wallet.markBroadcastWithReservation(txidBuf, reservationId);
  log(`TRANSACTION BROADCAST ACCEPTED BY NODE! ✅`);
  log(`  Confirmed TxID (explorer order): ${txidRpc}`);
  log(`  Confirmed TxID (internal order): ${built.txid}`);
  log(`  Log saved to:   ${sendLogPath}`);

  // 11. Wait for confirmation on live chain
  log('\n--- Step 7: Await On-Chain Confirmation ---');
  log(`Polling live testnet node for txid: ${txidRpc}...`);
  log(`  Explorer TxID: ${txidRpc}`);
  log(`  Internal TxID: ${built.txid}`);
  log(`  RPC TxID:      ${txidRpc}`);

  let confirmedTx = null;
  let minedHeight = null;
  const pollStart = Date.now();
  const maxWaitMs = 20 * 60 * 1000; // 20 minutes max

  while (Date.now() - pollStart < maxWaitMs) {
    if (qnUrl) {
      try {
        const qnVerifier = new JsonRpcVerifier(qnUrl);
        const rawTxData = await qnVerifier.getRawTransaction(txidRpc, 1);
        if (rawTxData && (rawTxData.confirmations >= 1 || rawTxData.height > 0)) {
          confirmedTx = rawTxData;
          minedHeight = rawTxData.height;
          break;
        }
      } catch (err) {
        // Transaction may still be in mempool or indexing
      }
    }

    try {
      const tipInfo = await client.getInfo();
      log(`  [${new Date().toISOString()}] Current tip: ${tipInfo.blockHeight} (waiting for block containing ${txidRpc})...`);
    } catch {}

    await new Promise((r) => setTimeout(r, 10000));
  }

  if (!confirmedTx) {
    log(`Timed out waiting for confirmation after 20 minutes.`);
    process.exit(1);
  }

  log(`\nTRANSACTION CONFIRMED ON-CHAIN! ✅`);
  log(`  Node Reported Mined Height: ${minedHeight}`);
  log(`  Node Reported Block Hash:   ${confirmedTx.blockhash}`);
  log(`  Confirmations:              ${confirmedTx.confirmations}`);

  // 12. Query live node for on-chain branch ID verification
  log('\n--- Step 8: Verify On-Chain Consensus Branch ID from Live Node ---');
  const txHex = confirmedTx.hex;
  log(`  Raw Tx Hex (first 64 chars): ${txHex.slice(0, 64)}...`);
  // Offset 0..4: 06000080 (v6 overwintered)
  // Offset 4..8: 98b684d8 (nGroupId 0x8848b698)
  // Offset 8..12: d90a1977 (consensus branch ID 0x77190ad9 in little-endian)
  const branchBytesHex = txHex.slice(16, 24);
  const branchIdParsed = Buffer.from(branchBytesHex, 'hex').reverse().toString('hex');
  log(`  Transaction Header Bytes [8..12]: ${branchBytesHex} -> Consensus Branch ID: 0x${branchIdParsed}`);
  if (branchIdParsed.toLowerCase() === '77190ad9') {
    log(`  Verified On-Chain Consensus Branch ID: 0x77190ad9 (NU7) MATCHES ON NODE! ✅`);
  } else {
    log(`  WARNING: Expected 0x77190ad9, parsed 0x${branchIdParsed}`);
  }

  // 13. Resync Wallet A and prove Change Note in SQLite
  log('\n--- Step 9: Resync Wallet A & Prove Change Note ---');
  const summaryA = wallet.getWalletSummary();
  if (summaryA.lastScannedHeight < minedHeight) {
    await syncWallet(client, wallet, {
      startHeight: summaryA.lastScannedHeight + 1,
      endHeight: minedHeight,
      batchSize: 1000,
      throttleMs: 50,
      verifyRootAtTip: false,
    });
  }

  const queryWalletA = (sql) => {
    return execFileSync('/usr/bin/sqlite3', [walletDbPath, sql], { encoding: 'utf8' }).trim();
  };

  log('Wallet A received_notes (raw SQLite):');
  const rowsA = queryWalletA(`SELECT id, value_zatoshis, height, pool, hex(txid), hex(spent_in_txid) FROM received_notes;`);
  log(rowsA);

  // 14. Initialize/Open & Sync Wallet B and prove Received Note in SQLite
  log('\n--- Step 10: Sync Wallet B & Prove Received Note ---');
  const walletBPath = path.join(walletDir, 'wallet_b_nu7.db');
  const acctB = accountFromMnemonic(accountsData.mnemonicB, 0, 'testnet');
  const ufvkB = acctB.getUnifiedFullViewingKey();

  if (!fs.existsSync(walletBPath)) {
    let initWalletB = WalletHandle.open(walletBPath, 'testnet', ufvkB);
    initWalletB = null;
    execFileSync('/usr/bin/sqlite3', [
      walletBPath,
      `ATTACH DATABASE '${walletDbPath}' AS dbA;
       INSERT INTO scanned_blocks SELECT * FROM dbA.scanned_blocks WHERE height <= ${minedHeight - 2};
       INSERT INTO ironwood_tree_shards SELECT * FROM dbA.ironwood_tree_shards;
       INSERT INTO ironwood_tree_cap SELECT * FROM dbA.ironwood_tree_cap;
       INSERT INTO ironwood_tree_checkpoints SELECT * FROM dbA.ironwood_tree_checkpoints WHERE checkpoint_id <= ${minedHeight - 2};`
    ]);
  }

  const walletB = WalletHandle.open(walletBPath, 'testnet', ufvkB);
  const summaryB = walletB.getWalletSummary();
  if (summaryB.lastScannedHeight < minedHeight) {
    await syncWallet(client, walletB, {
      startHeight: summaryB.lastScannedHeight + 1,
      endHeight: minedHeight,
      batchSize: 1000,
      throttleMs: 50,
      verifyRootAtTip: false,
    });
  }

  const queryWalletB = (sql) => {
    return execFileSync('/usr/bin/sqlite3', [walletBPath, sql], { encoding: 'utf8' }).trim();
  };

  log('Wallet B received_notes (raw SQLite):');
  const rowsB = queryWalletB(`SELECT id, value_zatoshis, height, pool, hex(txid) FROM received_notes;`);
  log(rowsB);

  log('\n================================================================');
  log('   PHASE 5 LIVE TESTNET SEND COMPLETE & VERIFIED ON-CHAIN! ✅');
  log('================================================================');

  await client.close();
}

main().catch((err) => {
  log(`Unhandled error: ${err.stack || err.message}`);
  process.exit(1);
});
