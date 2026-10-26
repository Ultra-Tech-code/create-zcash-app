#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZcashClient } from '../packages/sdk/dist/client.js';
import { syncWallet } from '../packages/sdk/dist/sync.js';
import { accountFromMnemonic } from '../packages/sdk/dist/keys.js';
import { JsonRpcVerifier } from '../packages/sdk/dist/jsonrpc.js';
import {
  WalletHandle,
  decodeIronwoodFrontierRoot,
  ironwoodEmptyTreeRoot,
  getExpectedBranchId,
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
      const qnTreeHex = (qnTs.ironwoodTree ?? '').toLowerCase();
      if (/^0*$/.test(qnTreeHex)) {
        secondaryRootHex = ironwoodEmptyTreeRoot().toLowerCase();
      } else {
        secondaryRootHex = decodeIronwoodFrontierRoot(qnTs.ironwoodTree).toLowerCase();
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
  const expiryHeight = tipHeight + 40;

  log(`Spendable Note IDs:      ${selectedNoteIds.join(', ')}`);
  log(`Total Inbound:           ${selectedTotal} zatoshis`);
  log(`Output Amount:           ${amountZat} zatoshis`);
  log(`ZIP-317 Quoted Fee:      ${requiredFee} zatoshis`);
  log(`Expiry Height:           ${expiryHeight}`);

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

  // 9. Pre-broadcast validation & parameter verification
  log('\n================================================================');
  log('   PRE-BROADCAST VERIFICATION SUMMARY');
  log('================================================================');
  log(`TxID (display order):    ${built.txid}`);
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
  log(`  Confirmed TxID: ${built.txid}`);
  log(`  Log saved to:   ${sendLogPath}`);

  await client.close();
}

main().catch((err) => {
  log(`Unhandled error: ${err.stack || err.message}`);
  process.exit(1);
});
