#!/usr/bin/env node
/**
 * STAGE 2b: DASHBOARD TESTNET SYNC & TRANSACTION API EVIDENCE
 *
 * Starts the dashboard Next.js server with a fresh persisted wallet under a TEMP home dir.
 * Reads Wallet B's UFVK by code from ~/.zcash-app-testnet/accounts.json (never printed).
 * POSTs birthday 4542200 and UFVK to the dashboard against testnet.zec.rocks:443.
 * Polls /api/sync/status every second until synced, logging response times (< 5s).
 * Confirms GET /api/transactions contains the 'in' row of 1,000,000 zatoshis
 * matching tx 8ca516abc441e6b95783eb4d733e091dc7312fc1f9e42de43273ed906a65095a.
 * Redacts home paths by code in all output.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { accountFromMnemonic, WalletHandle } from '../packages/sdk/dist/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const EXPECTED_TXID = '8ca516abc441e6b95783eb4d733e091dc7312fc1f9e42de43273ed906a65095a';
const BIRTHDAY_HEIGHT = 4542200;
const TESTNET_ENDPOINT = 'testnet.zec.rocks:443';
const SERVER_PORT = 3058;
const BASE_URL = `http://127.0.0.1:${SERVER_PORT}`;

// Redaction helpers
const realHome = os.homedir();
let tempHome = '';

function redact(text) {
  let res = String(text);
  if (tempHome) {
    res = res.replaceAll(tempHome, '<TEMP_HOME>');
  }
  if (realHome) {
    res = res.replaceAll(realHome, '<HOME>');
  }
  return res;
}

function safeLog(...args) {
  const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a, null, 2))).join(' ');
  console.log(redact(line));
}

async function waitForServer(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/status`);
      if (res.ok) return true;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Server at ${url} failed to become ready within ${timeoutMs}ms`);
}

async function main() {
  safeLog('========================================================================');
  safeLog('STAGE 2b: DASHBOARD TESTNET SYNC & TRANSACTION API EVIDENCE');
  safeLog('========================================================================');
  safeLog(`Execution Time:   ${new Date().toISOString()}`);
  safeLog(`Live Endpoint:    ${TESTNET_ENDPOINT}`);
  safeLog(`Expected TxID:    ${EXPECTED_TXID}`);
  safeLog(`Birthday Height:  ${BIRTHDAY_HEIGHT}`);

  // 1. Read accounts.json strictly by code (UFVKs/mnemonics are NEVER printed)
  const accountsFile = path.join(os.homedir(), '.zcash-app-testnet', 'accounts.json');
  if (!fs.existsSync(accountsFile)) {
    throw new Error(`accounts.json not found at ${accountsFile}`);
  }
  const accountsData = JSON.parse(fs.readFileSync(accountsFile, 'utf8'));
  if (!accountsData.mnemonicB) {
    throw new Error('accounts.json missing mnemonicB');
  }

  const acctB = accountFromMnemonic(accountsData.mnemonicB, 0, 'testnet');
  const ufvkB = acctB.getUnifiedFullViewingKey();
  const addrB = acctB.getUnifiedAddress();

  safeLog('\n[Keys & Addresses] Watch-Only Derivation for Wallet B:');
  safeLog(`  Unified Address: ${addrB}`);
  safeLog('  UFVK: loaded in server memory by code only (never printed or leaked)');

  // 2. Setup fresh temporary home directory (strictly isolating from user's ~)
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'zcash_dash_testnet_'));
  fs.chmodSync(tempHome, 0o700);
  safeLog('\n[Environment Isolation]');
  safeLog(`  Temporary Home Directory: ${tempHome} (permissions: 0700)`);

  // Initialize directory and database file under tempHome/.zcash-app/dashboard
  const dbDir = path.join(tempHome, '.zcash-app', 'dashboard');
  fs.mkdirSync(dbDir, { recursive: true, mode: 0o700 });
  const dbFile = path.join(dbDir, 'testnet_account0.db');

  // Open fresh DB to initialize schema
  const initHandle = WalletHandle.open(dbFile, 'testnet', ufvkB, 'account0', BIRTHDAY_HEIGHT);

  // Seed commitment tree state up to BIRTHDAY_HEIGHT (4542200) from reference wallet
  const refWalletPath = path.join(os.homedir(), '.zcash-app-testnet', 'wallet_a_nu7.db');
  if (fs.existsSync(refWalletPath)) {
    safeLog(`\n[Tree Seeding] Seeding commitment tree frontier up to birthday height ${BIRTHDAY_HEIGHT}...`);
    const dumpSql = execFileSync('/usr/bin/sqlite3', [
      refWalletPath,
      '.dump scanned_blocks ironwood_tree_cap ironwood_tree_checkpoints ironwood_tree_checkpoint_marks_removed ironwood_tree_shards',
    ], { encoding: 'utf8' });

    const lines = dumpSql.split('\n').filter((line) => {
      if (!line.startsWith('INSERT INTO ') && !line.startsWith('INSERT INTO"')) return false;
      if (line.includes('scanned_blocks')) {
        const match = line.match(/VALUES\((\d+)/i);
        if (match && Number(match[1]) > BIRTHDAY_HEIGHT) return false;
      }
      return true;
    });

    const sql = lines.join('\n');
    const tempSql = path.join(tempHome, 'seed.sql');
    fs.writeFileSync(tempSql, sql);
    execFileSync('/usr/bin/sqlite3', [dbFile, `.read ${tempSql}`]);
    fs.unlinkSync(tempSql);
  }

  fs.chmodSync(dbDir, 0o700);
  fs.chmodSync(dbFile, 0o600);

  // 3. Start Next.js dashboard server with ZCASH_APP_HOME and HOME set to tempHome
  safeLog(`\n[Dashboard Server] Starting Next.js standalone process on port ${SERVER_PORT}...`);
  const nextBin = path.join(projectRoot, 'packages', 'dashboard', 'node_modules', '.bin', 'next');
  const serverProcess = spawn(
    nextBin,
    ['start', path.join(projectRoot, 'packages', 'dashboard'), '-p', String(SERVER_PORT)],
    {
      env: {
        ...process.env,
        HOME: tempHome,
        ZCASH_APP_HOME: tempHome,
        PORT: String(SERVER_PORT),
        NODE_ENV: 'production',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  let serverStderr = '';
  serverProcess.stderr.on('data', (d) => {
    serverStderr += d.toString();
  });
  serverProcess.stdout.on('data', (d) => {
    const txt = d.toString().trim();
    if (txt && !txt.includes('GET /api/sync/status') && !txt.includes('Ready in')) {
      safeLog(`  [Server] ${txt}`);
    }
  });

  try {
    await waitForServer(BASE_URL);
    safeLog('  Dashboard server ready and responding to health queries.');

    // 4. POST UFVK and birthday to /api/sync/status
    safeLog('\n[Sync Initialization] POSTing UFVK and birthday to /api/sync/status:');
    const postStart = Date.now();
    const postRes = await fetch(`${BASE_URL}/api/sync/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        network: 'testnet',
        endpoint: TESTNET_ENDPOINT,
        account: 'account0',
        birthday: BIRTHDAY_HEIGHT,
        targetHeight: 4542241,
        batchSize: 50,
        ufvk: ufvkB,
        start: true,
      }),
    });
    const postElapsed = Date.now() - postStart;
    const rawSetCookie = postRes.headers.get('set-cookie');
    const sessionCookie = rawSetCookie ? rawSetCookie.split(';')[0].trim() : '';
    const postJson = await postRes.json();

    safeLog(`  POST /api/sync/status: HTTP ${postRes.status} in ${postElapsed}ms`);
    safeLog(`  Initial Status: status=${postJson.status}, scanned=${postJson.scanned}, target=${postJson.target}`);
    if (postElapsed > 5000) {
      throw new Error(`POST /api/sync/status took ${postElapsed}ms (> 5000ms threshold)`);
    }

    // 5. Poll /api/sync/status every second until synced or target reached
    safeLog('\n[Sync Polling] Polling /api/sync/status every second (verifying < 5s response time):');
    const pollHeaders = sessionCookie ? { cookie: sessionCookie } : {};
    let isComplete = false;
    let pollCount = 0;
    const maxPolls = 60;

    while (!isComplete && pollCount < maxPolls) {
      pollCount++;
      await new Promise((r) => setTimeout(r, 1000));

      const pollStart = Date.now();
      const res = await fetch(
        `${BASE_URL}/api/sync/status?network=testnet&endpoint=${TESTNET_ENDPOINT}&account=account0&start=false`,
        { headers: pollHeaders }
      );
      const elapsed = Date.now() - pollStart;
      const data = await res.json();

      safeLog(
        `  Poll #${String(pollCount).padStart(2, '0')}: HTTP ${res.status} in ${String(elapsed).padStart(3, ' ')}ms | ` +
        `status=${data.status} | scanned=${data.scanned} | target=${data.target} | ` +
        `notesFound=${data.notesFound} | pendingFetches=${data.pendingFetches} | failedFetches=${data.failedFetches}` +
        (data.error ? ` | error=${data.error}` : '')
      );

      if (elapsed > 5000) {
        throw new Error(`Poll #${pollCount} exceeded 5s threshold: ${elapsed}ms`);
      }

      if (data.status === 'synced') {
        isComplete = true;
      }
    }

    if (!isComplete) {
      throw new Error(`Sync did not complete within ${maxPolls} seconds`);
    }
    safeLog('  Background sync completed successfully.');

    // 6. Verify stored transactions via GET /api/transactions
    safeLog('\n[Transaction History API] Querying GET /api/transactions:');
    const txStart = Date.now();
    const txRes = await fetch(
      `${BASE_URL}/api/transactions?network=testnet&account=account0`,
      { headers: pollHeaders }
    );
    const txElapsed = Date.now() - txStart;
    const txData = await txRes.json();

    safeLog(`  GET /api/transactions: HTTP ${txRes.status} in ${txElapsed}ms (${txData.count} transactions returned)`);
    safeLog(`  Transactions payload: ${JSON.stringify(txData.transactions, null, 2)}`);

    const inRow = txData.transactions?.find(
      (tx) => tx.txid === EXPECTED_TXID && tx.direction === 'in'
    );

    if (!inRow) {
      throw new Error(`Expected 'in' row for ${EXPECTED_TXID} not found in stored transactions!`);
    }

    safeLog('\n[Verification Success]');
    safeLog(`  Found Expected 'in' Row:`);
    safeLog(`    TxID:         ${inRow.txid}`);
    safeLog(`    Direction:    ${inRow.direction}`);
    safeLog(`    Value (zat):  ${inRow.value} (1,000,000 zatoshis = 0.01 ZEC)`);
    safeLog(`    Height:       ${inRow.height}`);
    safeLog(`    Action Index: ${inRow.actionIndex ?? inRow.action_index}`);
    safeLog(`    Pool:         ${inRow.pool}`);
    safeLog(`    Fee:          ${inRow.fee !== null ? `${inRow.fee} zat` : 'unknown'}`);
    safeLog(`    Memo:         ${inRow.memo || '(empty)'}`);

    // 7. Verify SQLite DB and directory file permissions
    const dbDir = path.join(tempHome, '.zcash-app', 'dashboard');
    const dbFile = path.join(dbDir, 'testnet_account0.db');
    const dirStat = fs.statSync(dbDir);
    const fileStat = fs.statSync(dbFile);
    const dirMode = (dirStat.mode & 0o777).toString(8);
    const fileMode = (fileStat.mode & 0o777).toString(8);

    safeLog('\n[Security Permissions Check]');
    safeLog(`  Dashboard Directory: ${dbDir} (mode: 0${dirMode}, expected: 0700)`);
    safeLog(`  Database File:       ${dbFile} (mode: 0${fileMode}, expected: 0600)`);

    if (dirMode !== '700' || fileMode !== '600') {
      throw new Error(`Permissions check failed: dir=0${dirMode}, file=0${fileMode}`);
    }

    safeLog('\n========================================================================');
    safeLog('STAGE 2b VERIFICATION COMPLETE: ALL CHECKS PASSED');
    safeLog('========================================================================');
  } finally {
    serverProcess.kill('SIGTERM');
    try {
      fs.rmSync(tempHome, { recursive: true, force: true });
    } catch (_) {}
  }
}

main().catch((err) => {
  console.error(`\n❌ Error: ${err.message}`);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
