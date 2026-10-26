import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { JsonRpcVerifier } from '../packages/sdk/dist/jsonrpc.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// Load environment variables for secondary endpoint (if present)
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

function log(msg) {
  const clean = redactText(String(msg));
  console.log(clean);
}

async function main() {
  log('================================================================');
  log('   TESTNET SEND POST-HOC ON-CHAIN VERIFICATION');
  log('   Status: run after the fact');
  log(`   Timestamp: ${new Date().toISOString()}`);
  log('================================================================\n');

  // TxID: Node/Explorer RPC display order vs Internal builder byte order
  const explorerTxid = '8ca516abc441e6b95783eb4d733e091dc7312fc1f9e42de43273ed906a65095a';
  const internalTxid = Buffer.from(explorerTxid, 'hex').reverse().toString('hex');
  assert.strictEqual(
    Buffer.from(internalTxid, 'hex').reverse().toString('hex'),
    explorerTxid,
    'TxID byte reversal round-trip assertion failed'
  );

  log(`TxID (node/explorer RPC display order):    ${explorerTxid}`);
  log(`TxID (internal builder byte-reversed):     ${internalTxid}`);

  const qnUrl = process.env.QUICKNODE_ZEC_TESTNET_URL;
  if (!qnUrl) {
    log('ERROR: QUICKNODE_ZEC_TESTNET_URL unset in environment / .env');
    process.exit(1);
  }

  const verifier = new JsonRpcVerifier(qnUrl);
  log(`\nQuerying node (${verifier.safeUrl}) via getrawtransaction...`);

  let confirmedTx;
  try {
    confirmedTx = await verifier.getRawTransaction(explorerTxid, 1);
  } catch (err) {
    log(`ERROR: Node query failed: ${err.message}`);
    process.exit(1);
  }

  const confirmations = confirmedTx.confirmations;
  const blockHash = confirmedTx.blockhash;
  const txHex = confirmedTx.hex;

  log(`\n--- Node Confirmation Status ---`);
  log(`Confirmations:      ${confirmations}`);
  log(`Block Hash:         ${blockHash}`);
  log(`Raw Tx Bytes Size:  ${Buffer.from(txHex, 'hex').length} bytes`);

  // Parse Header Fields:
  // Offset 0..4 (8 hex chars): version (06000080 -> v6 overwintered)
  // Offset 4..8 (8 hex chars): version group ID (98b684d8 -> 0xd884b698)
  // Offset 8..12 (8 hex chars): consensus branch ID (d90a1977 -> 0x77190ad9)
  // Offset 12..16 (8 hex chars): lock time (00000000 -> 0)
  // Offset 16..20 (8 hex chars): expiry height (464f4500 -> 4542278, little-endian)
  const versionHex = txHex.slice(0, 8);
  const versionGroupIdHex = txHex.slice(8, 16);
  const branchBytesHex = txHex.slice(16, 24);
  const branchIdParsed = '0x' + Buffer.from(branchBytesHex, 'hex').reverse().toString('hex');
  const lockTimeBytesHex = txHex.slice(24, 32);
  const lockTimeParsed = Buffer.from(lockTimeBytesHex, 'hex').readUInt32LE(0);
  const expiryBytesHex = txHex.slice(32, 40);
  const expiryHeightParsed = Buffer.from(expiryBytesHex, 'hex').readUInt32LE(0);

  log(`\n--- Parsed On-Chain Transaction Header ---`);
  log(`Version Bytes [0..4]:          ${versionHex}`);
  log(`Version Group ID Bytes [4..8]:  ${versionGroupIdHex}`);
  log(`Branch ID Bytes [8..12]:       ${branchBytesHex} -> ${branchIdParsed}`);
  log(`Lock Time Bytes [12..16]:      ${lockTimeBytesHex} -> ${lockTimeParsed}`);
  log(`Expiry Height Bytes [16..20]:  ${expiryBytesHex} -> ${expiryHeightParsed}`);

  // Dynamic comparison against NU7 branch ID
  const EXPECTED_NU7_BRANCH = '0x77190ad9';
  const branchMatches = branchIdParsed.toLowerCase() === EXPECTED_NU7_BRANCH.toLowerCase();
  log(`Branch ID Check: parsed ${branchIdParsed} == expected ${EXPECTED_NU7_BRANCH} -> ${branchMatches}`);

  // Check Wallet Databases
  const walletDir = path.join(os.homedir(), '.zcash-app-testnet');
  const walletAPath = path.join(walletDir, 'wallet_a_nu7.db');
  const walletBPath = path.join(walletDir, 'wallet_b_nu7.db');

  log(`\n--- Wallet A State & Received Notes (SQLite query) ---`);
  if (fs.existsSync(walletAPath)) {
    const scannedTipA = execFileSync('/usr/bin/sqlite3', [walletAPath, 'SELECT MAX(height) FROM scanned_blocks;'], { encoding: 'utf8' }).trim();
    log(`Wallet A Scanned Tip Height: ${scannedTipA} (source: wallet_a_nu7.db -> scanned_blocks.height)`);
    const rowsA = execFileSync('/usr/bin/sqlite3', [walletAPath, 'SELECT id, value_zatoshis, height, pool, hex(txid), hex(spent_in_txid) FROM received_notes;'], { encoding: 'utf8' }).trim();
    log(rowsA);
  } else {
    log(`Wallet A DB not found at: ${walletAPath}`);
  }

  log(`\n--- Wallet B State & Received Notes (SQLite query) ---`);
  if (fs.existsSync(walletBPath)) {
    const scannedTipB = execFileSync('/usr/bin/sqlite3', [walletBPath, 'SELECT MAX(height) FROM scanned_blocks;'], { encoding: 'utf8' }).trim();
    log(`Wallet B Scanned Tip Height: ${scannedTipB} (source: wallet_b_nu7.db -> scanned_blocks.height)`);
    const rowsB = execFileSync('/usr/bin/sqlite3', [walletBPath, 'SELECT id, value_zatoshis, height, pool, hex(txid) FROM received_notes;'], { encoding: 'utf8' }).trim();
    log(rowsB);
  } else {
    log(`Wallet B DB not found at: ${walletBPath}`);
  }

  log('\n================================================================');
  log('   POST-HOC VERIFICATION COMPLETE');
  log('================================================================');
}

main().catch((err) => {
  log(`Unhandled error: ${err.stack || err.message}`);
  process.exit(1);
});

