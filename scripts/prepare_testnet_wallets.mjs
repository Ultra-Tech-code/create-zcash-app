import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  accountFromMnemonic,
  WalletHandle,
  ZcashClient,
  syncWallet,
} from '../packages/sdk/dist/index.js';

const SEED_HEIGHT = 4542233;
const TARGET_HEIGHT = 4542241;
const EXPECTED_TXID = '8ca516abc441e6b95783eb4d733e091dc7312fc1f9e42de43273ed906a65095a';

async function prepare() {
  console.log('=== PREPARING TESTNET WALLET DATABASES FOR WALLET A AND WALLET B ===');

  const accountsFile = path.join(os.homedir(), '.zcash-app-testnet', 'accounts.json');
  if (!fs.existsSync(accountsFile)) {
    throw new Error(`accounts.json not found at ${accountsFile}`);
  }
  const accountsData = JSON.parse(fs.readFileSync(accountsFile, 'utf8'));

  const acctA = accountFromMnemonic(accountsData.mnemonicA, 0, 'testnet');
  const acctB = accountFromMnemonic(accountsData.mnemonicB, 0, 'testnet');

  const ufvkA = acctA.getUnifiedFullViewingKey();
  const ufvkB = acctB.getUnifiedFullViewingKey();

  const hashA = crypto.createHash('sha256').update(ufvkA.trim()).digest('hex').slice(0, 8);
  const hashB = crypto.createHash('sha256').update(ufvkB.trim()).digest('hex').slice(0, 8);

  const accountIdA = `acct_${hashA}`;
  const accountIdB = `acct_${hashB}`;

  const dashboardDir = path.join(os.homedir(), '.zcash-app', 'dashboard');
  fs.mkdirSync(dashboardDir, { recursive: true, mode: 0o700 });

  const dbPathA = path.join(dashboardDir, `testnet_${accountIdA}.db`);
  const dbPathB = path.join(dashboardDir, `testnet_${accountIdB}.db`);

  console.log(`Setting up Wallet A database at: ${dbPathA}`);
  console.log(`Setting up Wallet B database at: ${dbPathB}`);

  const refWalletPath = path.join(os.homedir(), '.zcash-app-testnet', 'wallet_a_nu7.db');
  if (!fs.existsSync(refWalletPath)) {
    throw new Error(`Reference wallet not found at ${refWalletPath}`);
  }

  // 1. Prepare Wallet A
  if (fs.existsSync(dbPathA)) fs.unlinkSync(dbPathA);
  const walletA = WalletHandle.open(dbPathA, 'testnet', ufvkA, accountIdA, 4542200);

  const dumpSqlA = execFileSync('/usr/bin/sqlite3', [
    refWalletPath,
    '.dump scanned_blocks ironwood_tree_cap ironwood_tree_checkpoints ironwood_tree_checkpoint_marks_removed ironwood_tree_shards received_notes',
  ], { encoding: 'utf8' });

  const linesA = dumpSqlA.split('\n').filter((line) => {
    if (!line.startsWith('INSERT INTO ') && !line.startsWith('INSERT INTO"')) return false;
    if (line.includes('scanned_blocks')) {
      const match = line.match(/VALUES\((\d+)/i);
      if (match && Number(match[1]) > SEED_HEIGHT) return false;
    }
    if (line.includes('received_notes')) {
      if (line.includes('4542240')) return false;
    }
    return true;
  });

  const tempSqlA = path.join(os.tmpdir(), 'seed_a.sql');
  fs.writeFileSync(tempSqlA, linesA.join('\n'));
  execFileSync('/usr/bin/sqlite3', [dbPathA, `.read ${tempSqlA}`]);
  fs.unlinkSync(tempSqlA);
  fs.chmodSync(dbPathA, 0o600);

  // 2. Prepare Wallet B
  if (fs.existsSync(dbPathB)) fs.unlinkSync(dbPathB);
  const walletB = WalletHandle.open(dbPathB, 'testnet', ufvkB, accountIdB, 4542200);

  const linesB = dumpSqlA.split('\n').filter((line) => {
    if (!line.startsWith('INSERT INTO ') && !line.startsWith('INSERT INTO"')) return false;
    if (line.includes('scanned_blocks')) {
      const match = line.match(/VALUES\((\d+)/i);
      if (match && Number(match[1]) > SEED_HEIGHT) return false;
    }
    if (line.includes('received_notes')) return false;
    return true;
  });

  const tempSqlB = path.join(os.tmpdir(), 'seed_b.sql');
  fs.writeFileSync(tempSqlB, linesB.join('\n'));
  execFileSync('/usr/bin/sqlite3', [dbPathB, `.read ${tempSqlB}`]);
  fs.unlinkSync(tempSqlB);
  fs.chmodSync(dbPathB, 0o600);

  // 3. Sync Wallet A and Wallet B from 4542234 to 4542241 to populate wallet_transactions
  console.log('\n[Live Sync] Synchronizing Wallet A to target 4542241 (populating OUT row)...');
  const client = new ZcashClient({ endpoint: 'testnet.zec.rocks:443', network: 'testnet' });

  await syncWallet(client, walletA, {
    startHeight: SEED_HEIGHT + 1,
    targetHeight: TARGET_HEIGHT,
    batchSize: 10,
    fullTxFetch: true,
  });

  console.log('\n[Live Sync] Synchronizing Wallet B to target 4542241 (populating IN row)...');
  await syncWallet(client, walletB, {
    startHeight: SEED_HEIGHT + 1,
    targetHeight: TARGET_HEIGHT,
    batchSize: 10,
    fullTxFetch: true,
  });

  await client.close();

  // Verify wallet_transactions
  const txsA = walletA.getWalletTransactions(10, 0);
  const txsB = walletB.getWalletTransactions(10, 0);

  console.log('\nWallet A Transactions count:', txsA.length);
  const outA = txsA.find(t => t.direction === 'out' && t.txid === EXPECTED_TXID);
  console.log('Wallet A OUT row found:', Boolean(outA), outA?.direction, outA?.valueZat);

  console.log('Wallet B Transactions count:', txsB.length);
  const inB = txsB.find(t => t.direction === 'in' && t.txid === EXPECTED_TXID);
  console.log('Wallet B IN row found:', Boolean(inB), inB?.direction, inB?.valueZat);

  if (!outA || !inB) {
    throw new Error('Preparation failed: OUT or IN row missing');
  }

  console.log('\n=== PREPARATION COMPLETE: BOTH WALLET DATABASES READY! ===');
}

prepare().catch((err) => {
  console.error('Preparation failed:', err);
  process.exit(1);
});
