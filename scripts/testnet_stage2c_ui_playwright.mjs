import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from '../packages/dashboard/node_modules/playwright/index.mjs';
import { accountFromMnemonic } from '../packages/sdk/dist/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const EXPECTED_TXID = '8ca516abc441e6b95783eb4d733e091dc7312fc1f9e42de43273ed906a65095a';
const BIRTHDAY_HEIGHT = 4542200;
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://127.0.0.1:3050';

const screenshotsDir = path.join(projectRoot, 'packages', 'core', 'tests', 'logs', 'screenshots');
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function runPlaywrightTest() {
  console.log('========================================================================');
  console.log('STAGE 2c: PLAYWRIGHT UI TEST SUITE — KEYS & ACTIVITY TABS');
  console.log('========================================================================');
  console.log(`Execution Time:  ${new Date().toISOString()}`);
  console.log(`Dashboard URL:   ${DASHBOARD_URL}`);
  console.log(`Target TxID:     ${EXPECTED_TXID}`);
  console.log(`Birthday:        ${BIRTHDAY_HEIGHT}`);
  console.log('Screenshots Dir: packages/core/tests/logs/screenshots/');
  console.log('========================================================================\n');

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

  console.log('[1/7] Launching headless browser (Google Chrome)...');
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const page = await context.newPage();

  console.log(`[2/7] Navigating to dashboard on testnet: ${DASHBOARD_URL}/?preset=testnet...`);
  await page.goto(`${DASHBOARD_URL}/?preset=testnet`, { waitUntil: 'domcontentloaded' });

  // STEP A: Keys tab for Wallet A
  console.log('\n[3/7] Navigating to Keys Tab and importing Wallet A UFVK...');
  await page.click('#tab-addresses');
  await page.waitForSelector('#input-ufvk');

  // Paste Wallet A UFVK and Birthday height
  await page.fill('#input-ufvk', ufvkA);
  await page.fill('#input-birthday', String(BIRTHDAY_HEIGHT));
  await page.click('#btn-import-key');

  // Wait for import success banner
  await page.waitForSelector('#import-success-banner');
  console.log('  ✓ Wallet A imported via POST successfully');

  // Verify UFVK is collapsed (NOT revealed)
  await page.waitForSelector('#ufvk-collapsed-container', { timeout: 10000 });
  const isRevealedA = await page.$('#ufvk-revealed-text');
  if (isRevealedA) {
    throw new Error('SECURITY VIOLATION: UFVK must NOT be revealed by default!');
  }
  console.log('  ✓ Verified UFVK is collapsed behind "Reveal UFVK" button (Confidentiality enforced)');

  // Capture Screenshot 1: Wallet A Keys Tab (Collapsed UFVK)
  const shot1Path = path.join(screenshotsDir, 'stage2c_01_wallet_a_keys.png');
  await page.screenshot({ path: shot1Path, fullPage: false });
  console.log(`  📸 Screenshot saved: ${path.basename(shot1Path)}`);

  // STEP B: Activity tab for Wallet A (Assert OUT row)
  console.log('\n[4/7] Navigating to Activity Tab for Wallet A (expecting OUT row)...');
  await page.click('#tab-transactions');
  await page.waitForSelector('#table-transactions');

  // Wait for OUT row
  const outRowSelector = `tr[data-txid="${EXPECTED_TXID}"][data-direction="out"]`;
  await page.waitForSelector(outRowSelector, { timeout: 10000 });
  console.log(`  ✓ Found OUT row for tx ${EXPECTED_TXID}`);

  // Capture Screenshot 2: Wallet A Activity Tab (OUT row)
  const shot2Path = path.join(screenshotsDir, 'stage2c_02_wallet_a_activity_out.png');
  await page.screenshot({ path: shot2Path, fullPage: false });
  console.log(`  📸 Screenshot saved: ${path.basename(shot2Path)}`);

  // STEP C: Forget Key
  console.log('\n[5/7] Navigating to Keys Tab and clearing session via "Forget Key"...');
  await page.click('#tab-addresses');
  await page.waitForSelector('#btn-forget-key');
  await Promise.all([
    page.waitForResponse((res) => res.url().includes('/api/account/forget-key') && res.status() === 200),
    page.click('#btn-forget-key'),
  ]);
  await page.waitForSelector('#btn-forget-key', { state: 'detached' });
  console.log('  ✓ Server-side session cleared and cookie expired');

  // Capture Screenshot 3: Keys Forgotten
  const shot3Path = path.join(screenshotsDir, 'stage2c_03_keys_forgotten.png');
  await page.screenshot({ path: shot3Path, fullPage: false });
  console.log(`  📸 Screenshot saved: ${path.basename(shot3Path)}`);

  // STEP D: Keys tab for Wallet B
  console.log('\n[6/7] Importing Wallet B UFVK via POST...');
  await page.fill('#input-ufvk', ufvkB);
  await page.fill('#input-birthday', String(BIRTHDAY_HEIGHT));
  await page.click('#btn-import-key');

  // Wait for import success banner
  await page.waitForSelector('#import-success-banner');
  console.log('  ✓ Wallet B imported via POST successfully');

  // Verify UFVK is collapsed (NOT revealed)
  await page.waitForSelector('#ufvk-collapsed-container', { timeout: 10000 });
  const isRevealedB = await page.$('#ufvk-revealed-text');
  if (isRevealedB) {
    throw new Error('SECURITY VIOLATION: UFVK must NOT be revealed by default!');
  }
  console.log('  ✓ Verified UFVK is collapsed behind "Reveal UFVK" button');

  // Capture Screenshot 4: Wallet B Keys Tab (Collapsed UFVK)
  const shot4Path = path.join(screenshotsDir, 'stage2c_04_wallet_b_keys.png');
  await page.screenshot({ path: shot4Path, fullPage: false });
  console.log(`  📸 Screenshot saved: ${path.basename(shot4Path)}`);

  // STEP E: Activity tab for Wallet B (Assert IN row)
  console.log('\n[7/7] Navigating to Activity Tab for Wallet B (expecting IN row)...');
  await page.click('#tab-transactions');
  await page.waitForSelector('#table-transactions');

  // Wait for IN row
  const inRowSelector = `tr[data-txid="${EXPECTED_TXID}"][data-direction="in"]`;
  await page.waitForSelector(inRowSelector, { timeout: 10000 });
  console.log(`  ✓ Found IN row for tx ${EXPECTED_TXID}`);

  // Capture Screenshot 5: Wallet B Activity Tab (IN row)
  const shot5Path = path.join(screenshotsDir, 'stage2c_05_wallet_b_activity_in.png');
  await page.screenshot({ path: shot5Path, fullPage: false });
  console.log(`  📸 Screenshot saved: ${path.basename(shot5Path)}`);

  await browser.close();

  // Print all screenshots with sha256 hashes
  console.log('\n========================================================================');
  console.log('PLAYWRIGHT SCREENSHOT EVIDENCE & SHA256 HASHES');
  console.log('========================================================================');
  const shots = [shot1Path, shot2Path, shot3Path, shot4Path, shot5Path];
  for (const s of shots) {
    const hash = sha256File(s);
    const rel = path.relative(projectRoot, s);
    console.log(`${hash}  ${rel}`);
  }
  console.log('========================================================================');
  console.log('✓ PLAYWRIGHT TEST SUITE COMPLETED SUCCESSFULLY: ALL ASSERTIONS PASSED!');
  console.log('========================================================================');
}

runPlaywrightTest().catch((err) => {
  console.error('Playwright Test Failed:', err);
  process.exit(1);
});
