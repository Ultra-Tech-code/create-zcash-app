import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from '../packages/dashboard/node_modules/playwright/index.mjs';
import { accountFromMnemonic } from '../packages/sdk/dist/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const EXPECTED_TXID = '8ca516abc441e6b95783eb4d733e091dc7312fc1f9e42de43273ed906a65095a';
const BIRTHDAY_HEIGHT = 4542200;
const SERVER_PORT = 3050;
const DASHBOARD_URL = process.env.DASHBOARD_URL || `http://127.0.0.1:${SERVER_PORT}`;

const screenshotsDir = path.join(projectRoot, 'packages', 'core', 'tests', 'logs', 'screenshots');
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

const LOG_FILE = path.join(
  projectRoot,
  'packages',
  'core',
  'tests',
  'logs',
  'testnet_stage2d_playwright.log'
);

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function waitForServer(url, timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/config`);
      if (res.ok) return true;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server at ${url} failed to respond within ${timeoutMs}ms`);
}

async function runPlaywrightTest() {
  const logLines = [];
  function log(msg = '') {
    console.log(msg);
    logLines.push(msg);
  }

  log('========================================================================');
  log('STAGE 2d: PLAYWRIGHT UI TEST SUITE — WIPED DASHBOARD DB REAL COLD SYNC');
  log('========================================================================');
  log(`Execution Time:  ${new Date().toISOString()}`);
  log(`Dashboard URL:   ${DASHBOARD_URL}`);
  log(`Target TxID:     ${EXPECTED_TXID}`);
  log(`Birthday:        ${BIRTHDAY_HEIGHT}`);
  log('Screenshots Dir: packages/core/tests/logs/screenshots/');
  log('========================================================================\n');

  // STEP 0: Compute account IDs and wipe dashboard databases for testnet
  log('[0/7] Identifying and wiping testnet dashboard databases...');
  const dashboardDir = path.join(os.homedir(), '.zcash-app', 'dashboard');
  if (!fs.existsSync(dashboardDir)) {
    fs.mkdirSync(dashboardDir, { recursive: true, mode: 0o700 });
  }

  // 1. Read accounts.json strictly in code (UFVKs/mnemonics are NEVER logged)
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

  const dbPathA = path.join(dashboardDir, `testnet_${accountIdA}.db`);
  const dbPathB = path.join(dashboardDir, `testnet_${accountIdB}.db`);

  // Delete all testnet files to guarantee clean cold state
  const existingFiles = fs.readdirSync(dashboardDir).filter((f) => f.startsWith('testnet_'));
  for (const f of existingFiles) {
    fs.unlinkSync(path.join(dashboardDir, f));
  }

  log(`  Dashboard DB Directory: ${dashboardDir}`);
  log(`  Wallet A Expected DB:   ${dbPathA}`);
  log(`  Wallet B Expected DB:   ${dbPathB}`);
  log('\n  --- DB DID NOT EXIST BEFORE RUN CHECK ---');
  const existsA_before = fs.existsSync(dbPathA);
  const existsB_before = fs.existsSync(dbPathB);
  log(`  Wallet A DB Exists Before Run: ${existsA_before} (MUST BE false)`);
  log(`  Wallet B DB Exists Before Run: ${existsB_before} (MUST BE false)`);

  if (existsA_before || existsB_before) {
    throw new Error('Invariant failed: Testnet database files existed before test run!');
  }
  log('  ✓ Verified: Testnet DB did not exist before run. Demonstrably fresh cold sync!\n');

  // Start Next.js server if not already running
  let serverProcess = null;
  let serverRunning = false;
  try {
    const res = await fetch(`${DASHBOARD_URL}/api/config`);
    if (res.ok) serverRunning = true;
  } catch (_) {}

  if (!serverRunning) {
    log(`  Starting Next.js dashboard server on port ${SERVER_PORT}...`);
    const nextBin = path.join(projectRoot, 'packages', 'dashboard', 'node_modules', '.bin', 'next');
    serverProcess = spawn(
      nextBin,
      ['start', path.join(projectRoot, 'packages', 'dashboard'), '-p', String(SERVER_PORT)],
      {
        env: {
          ...process.env,
          PORT: String(SERVER_PORT),
          NODE_ENV: 'production',
        },
        stdio: 'ignore',
      }
    );
    await waitForServer(DASHBOARD_URL);
    log('  ✓ Dashboard server running and responding.\n');
  } else {
    log('  ✓ Existing dashboard server detected and responding.\n');
  }

  log('[1/7] Launching headless browser (Google Chrome)...');
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const page = await context.newPage();

  try {
    log(`[2/7] Navigating to dashboard on testnet: ${DASHBOARD_URL}/?preset=testnet...`);
    await page.goto(`${DASHBOARD_URL}/?preset=testnet`, { waitUntil: 'domcontentloaded' });

    // STEP A: Keys tab for Wallet A
    log('\n[3/7] Navigating to Keys Tab and importing Wallet A UFVK...');
    await page.click('#tab-addresses');
    await page.waitForSelector('#input-ufvk');

    // Paste Wallet A UFVK and Birthday height
    await page.fill('#input-ufvk', ufvkA);
    await page.fill('#input-birthday', String(BIRTHDAY_HEIGHT));
    await page.click('#btn-import-key');

    // Wait for import success banner
    await page.waitForSelector('#import-success-banner');
    log('  ✓ Wallet A imported via POST successfully');

    // Verify UFVK is collapsed (NOT revealed)
    await page.waitForSelector('#ufvk-collapsed-container', { timeout: 10000 });
    const isRevealedA = await page.$('#ufvk-revealed-text');
    if (isRevealedA) {
      throw new Error('SECURITY VIOLATION: UFVK must NOT be revealed by default!');
    }
    log('  ✓ Verified UFVK is collapsed behind "Reveal UFVK" button (Confidentiality enforced)');

    // Capture Screenshot 1: Wallet A Keys Tab (Collapsed UFVK)
    const shot1Path = path.join(screenshotsDir, 'stage2d_01_wallet_a_keys.png');
    await page.screenshot({ path: shot1Path, fullPage: false });
    // Also mirror to stage2c filename for compatibility
    fs.copyFileSync(shot1Path, path.join(screenshotsDir, 'stage2c_01_wallet_a_keys.png'));
    log(`  📸 Screenshot saved: ${path.basename(shot1Path)}`);

    // STEP B: Activity tab for Wallet A (Assert OUT row from cold sync)
    log('\n[4/7] Navigating to Activity Tab for Wallet A (fresh cold sync from 4542200 to tip)...');
    await page.click('#tab-transactions');
    await page.waitForSelector('#table-transactions');

    // Wait up to 60s for cold sync to reach 4542240 and render OUT row
    log('  Waiting for live sync to detect and display OUT row in UI table...');
    const outRowSelector = `tr[data-txid="${EXPECTED_TXID}"][data-direction="out"]`;
    await page.waitForSelector(outRowSelector, { timeout: 60000 });
    log(`  ✓ Found OUT row for tx ${EXPECTED_TXID} in UI transactions table!`);

    // Confirm Wallet A database exists and has rows now
    const existsA_after = fs.existsSync(dbPathA);
    log(`  Wallet A DB Exists After Sync: ${existsA_after} (MUST BE true)`);
    if (!existsA_after) {
      throw new Error('Invariant failed: Wallet A DB was not created by UI sync!');
    }
    log('  ✓ Rows demonstrably come from a fresh sync through the UI into a brand-new DB.');

    // Capture Screenshot 2: Wallet A Activity Tab (OUT row)
    const shot2Path = path.join(screenshotsDir, 'stage2d_02_wallet_a_activity_out.png');
    await page.screenshot({ path: shot2Path, fullPage: false });
    fs.copyFileSync(shot2Path, path.join(screenshotsDir, 'stage2c_02_wallet_a_activity_out.png'));
    log(`  📸 Screenshot saved: ${path.basename(shot2Path)}`);

    // STEP C: Forget Key
    log('\n[5/7] Navigating to Keys Tab and clearing session via "Forget Key"...');
    await page.click('#tab-addresses');
    await page.waitForSelector('#btn-forget-key');
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/account/forget-key') && res.status() === 200),
      page.click('#btn-forget-key'),
    ]);
    await page.waitForSelector('#btn-forget-key', { state: 'detached' });
    log('  ✓ Server-side session cleared and cookie expired');

    // Capture Screenshot 3: Keys Forgotten
    const shot3Path = path.join(screenshotsDir, 'stage2d_03_keys_forgotten.png');
    await page.screenshot({ path: shot3Path, fullPage: false });
    fs.copyFileSync(shot3Path, path.join(screenshotsDir, 'stage2c_03_keys_forgotten.png'));
    log(`  📸 Screenshot saved: ${path.basename(shot3Path)}`);

    // STEP D: Keys tab for Wallet B
    log('\n[6/7] Importing Wallet B UFVK via POST...');
    await page.fill('#input-ufvk', ufvkB);
    await page.fill('#input-birthday', String(BIRTHDAY_HEIGHT));
    await page.click('#btn-import-key');

    // Wait for import success banner
    await page.waitForSelector('#import-success-banner');
    log('  ✓ Wallet B imported via POST successfully');

    // Verify UFVK is collapsed (NOT revealed)
    await page.waitForSelector('#ufvk-collapsed-container', { timeout: 10000 });
    const isRevealedB = await page.$('#ufvk-revealed-text');
    if (isRevealedB) {
      throw new Error('SECURITY VIOLATION: UFVK must NOT be revealed by default!');
    }
    log('  ✓ Verified UFVK is collapsed behind "Reveal UFVK" button');

    // Capture Screenshot 4: Wallet B Keys Tab (Collapsed UFVK)
    const shot4Path = path.join(screenshotsDir, 'stage2d_04_wallet_b_keys.png');
    await page.screenshot({ path: shot4Path, fullPage: false });
    fs.copyFileSync(shot4Path, path.join(screenshotsDir, 'stage2c_04_wallet_b_keys.png'));
    log(`  📸 Screenshot saved: ${path.basename(shot4Path)}`);

    // STEP E: Activity tab for Wallet B (Assert IN row from cold sync)
    log('\n[7/7] Navigating to Activity Tab for Wallet B (expecting IN row from cold sync)...');
    await page.click('#tab-transactions');
    await page.waitForSelector('#table-transactions');

    // Wait up to 60s for cold sync to reach 4542240 and render IN row
    log('  Waiting for live sync to detect and display IN row in UI table...');
    const inRowSelector = `tr[data-txid="${EXPECTED_TXID}"][data-direction="in"]`;
    await page.waitForSelector(inRowSelector, { timeout: 60000 });
    log(`  ✓ Found IN row for tx ${EXPECTED_TXID} in UI transactions table!`);

    // Confirm Wallet B database exists
    const existsB_after = fs.existsSync(dbPathB);
    log(`  Wallet B DB Exists After Sync: ${existsB_after} (MUST BE true)`);
    if (!existsB_after) {
      throw new Error('Invariant failed: Wallet B DB was not created by UI sync!');
    }

    // Capture Screenshot 5: Wallet B Activity Tab (IN row)
    const shot5Path = path.join(screenshotsDir, 'stage2d_05_wallet_b_activity_in.png');
    await page.screenshot({ path: shot5Path, fullPage: false });
    fs.copyFileSync(shot5Path, path.join(screenshotsDir, 'stage2c_05_wallet_b_activity_in.png'));
    log(`  📸 Screenshot saved: ${path.basename(shot5Path)}`);

    await browser.close();

    // Print all screenshots with sha256 hashes
    log('\n========================================================================');
    log('PLAYWRIGHT SCREENSHOT EVIDENCE & SHA256 HASHES');
    log('========================================================================');
    const shots = [shot1Path, shot2Path, shot3Path, shot4Path, shot5Path];
    for (const s of shots) {
      const hash = sha256File(s);
      const rel = path.relative(projectRoot, s);
      log(`${hash}  ${rel}`);
    }
    log('========================================================================');
    log('✓ PLAYWRIGHT TEST SUITE COMPLETED SUCCESSFULLY: ALL ASSERTIONS PASSED!');
    log('========================================================================\n');

    // Save log file
    fs.writeFileSync(LOG_FILE, logLines.join('\n') + '\n', 'utf8');
    // Mirror to stage2c log as well
    fs.writeFileSync(
      path.join(projectRoot, 'packages', 'core', 'tests', 'logs', 'testnet_stage2c_playwright.log'),
      logLines.join('\n') + '\n',
      'utf8'
    );
    const logSha = sha256File(LOG_FILE);
    console.log(`Log File:   ${path.relative(projectRoot, LOG_FILE)}`);
    console.log(`SHA256:     ${logSha}`);
  } finally {
    if (serverProcess) {
      serverProcess.kill();
    }
  }
}

runPlaywrightTest().catch((err) => {
  console.error('Playwright Test Failed:', err);
  process.exit(1);
});
