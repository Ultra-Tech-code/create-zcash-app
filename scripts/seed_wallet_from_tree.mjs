#!/usr/bin/env node
/**
 * ============================================================================
 *                       ⚠️  WARNING: TEST ONLY SCRIPT  ⚠️
 * ============================================================================
 * THIS SCRIPT IS FOR LOCAL TEST / BENCHMARK ENVIRONMENT ACCELERATION ONLY.
 * DO NOT USE THIS SCRIPT IN PRODUCTION OR FOR REAL FUNDS.
 *
 * PURPOSE:
 * Explains and reproduces how wallet_b_nu7.db was initially seeded:
 * 1. Creates wallet_b_nu7.db initialized with Account B's mnemonic/UFVK.
 * 2. Clones the note commitment tree and sync metadata tables (blocks,
 *    sapling_tree, orchard_tree, etc.) from an already-synced reference
 *    wallet (e.g. wallet_a_nu7.db) up to height 4,542,233.
 * 3. Performs a narrow 7-block incremental scan (4,542,234 to 4,542,241)
 *    using Account B's UFVK against testnet.zec.rocks to detect the incoming
 *    transaction note at height 4,542,240 without rescanning 400k+ historical blocks.
 *
 * NOTE: The canonical, standard wallet path requires a full scan from activation
 * height (4,134,000 on NU7 testnet) to tip, which is proven independently
 * by the standard sync runner.
 * ============================================================================
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ZcashClient } from '../packages/sdk/dist/client.js';
import { syncWallet } from '../packages/sdk/dist/sync.js';
import { accountFromMnemonic } from '../packages/sdk/dist/keys.js';
import { WalletHandle } from '../packages/core/index.js';

const walletDir = path.join(os.homedir(), '.zcash-app-testnet');
const accountsFile = path.join(walletDir, 'accounts.json');

if (!fs.existsSync(accountsFile)) {
  console.error(`ERROR: accounts.json not found at ${accountsFile}`);
  process.exit(1);
}

const accountsData = JSON.parse(fs.readFileSync(accountsFile, 'utf8'));
const acctB = accountFromMnemonic(accountsData.mnemonicB, 0, 'testnet');
const ufvkB = acctB.getUnifiedFullViewingKey();

const walletAPath = path.join(walletDir, 'wallet_a_nu7.db');
const walletBPath = path.join(walletDir, 'wallet_b_nu7.db');

console.log('=== TEST ONLY: Seeding Wallet B from Reference Tree ===');
console.log(`Source Wallet A: ${walletAPath}`);
console.log(`Target Wallet B: ${walletBPath}`);

if (!fs.existsSync(walletAPath)) {
  console.error(`ERROR: Source wallet ${walletAPath} does not exist`);
  process.exit(1);
}

// 1. Initialize fresh DB schema for Wallet B
if (fs.existsSync(walletBPath)) {
  fs.unlinkSync(walletBPath);
}

console.log('1. Initializing Wallet B schema...');
const handleB = WalletHandle.open(walletBPath, 'testnet', ufvkB);
handleB.close?.();

// 2. Clone commitment tree tables from Wallet A to Wallet B
console.log('2. Cloning commitment tree state from Wallet A...');
const dumpSql = execFileSync('/usr/bin/sqlite3', [
  walletAPath,
  '.dump blocks sapling_tree orchard_tree received_notes',
], { encoding: 'utf8' });

// Filter out received_notes so Wallet B only inherits the tree, not Wallet A notes
const treeOnlySql = dumpSql
  .split('\n')
  .filter((line) => !line.includes('INSERT INTO received_notes') && !line.includes('INSERT INTO "received_notes"'))
  .join('\n');

const dumpFile = path.join(walletDir, 'tree_dump_temp.sql');
fs.writeFileSync(dumpFile, treeOnlySql);

execFileSync('/usr/bin/sqlite3', [walletBPath, `.read ${dumpFile}`]);
fs.unlinkSync(dumpFile);

// Set scanned height back to 4542233 so the next 7 blocks will be scanned for Account B notes
execFileSync('/usr/bin/sqlite3', [
  walletBPath,
  'UPDATE blocks SET height = 4542233 WHERE height > 4542233;',
]);

console.log('3. Running incremental 7-block scan (4542234 -> 4542241)...');
const client = new ZcashClient({
  endpoint: 'https://testnet.zec.rocks:443',
  network: 'testnet',
});

const handleB2 = WalletHandle.open(walletBPath, 'testnet', ufvkB);
await syncWallet(client, handleB2, {
  batchSize: 1000,
  throttleMs: 50,
  targetHeight: 4542241,
});

console.log('Seeding complete. Checking Wallet B received notes:');
const notes = execFileSync('/usr/bin/sqlite3', [
  walletBPath,
  'SELECT id, value_zatoshis, height, pool, hex(txid) FROM received_notes;',
], { encoding: 'utf8' }).trim();
console.log(notes || '(no notes found)');
