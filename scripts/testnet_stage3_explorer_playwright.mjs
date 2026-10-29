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
const EXPECTED_BLOCK_HEIGHT = '4542240';
const EXPECTED_BLOCK_HASH = '00005c49b2e52450226473f8bbc77411705f7e104835bb12909ed217f16fa92e';
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
  'testnet_stage3_explorer.log'
);

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function redactHome(str) {
  const home = os.homedir();
  return str.split(home).join('~');
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

async function runStage3ExplorerPlaywright() {
  const logLines = [];
  function log(msg = '') {
    const redacted = redactHome(msg);
    console.log(redacted);
    logLines.push(redacted);
  }

  log('========================================================================');
  log('PHASE 3: PLAYWRIGHT TEST SUITE — BLOCKCHAIN EXPLORER');
  log('========================================================================');
  log(`Execution Time:  ${new Date().toISOString()}`);
  log(`Dashboard URL:   ${DASHBOARD_URL}`);
  log(`Target TxID:     ${EXPECTED_TXID}`);
  log(`Target Block:    Height ${EXPECTED_BLOCK_HEIGHT} | Hash ${EXPECTED_BLOCK_HASH}`);
  log('Screenshots Dir: packages/core/tests/logs/screenshots/');
  log('========================================================================\n');

  // STEP 0: Load accounts strictly in memory (UFVKs/mnemonics are NEVER logged)
  log('[0/8] Loading testnet account keys into memory (unlogged)...');
  const accountsFile = path.join(os.homedir(), '.zcash-app-testnet', 'accounts.json');
  if (!fs.existsSync(accountsFile)) {
    throw new Error(`accounts.json not found at ${redactHome(accountsFile)}`);
  }
  const accountsData = JSON.parse(fs.readFileSync(accountsFile, 'utf8'));

  const acctA = accountFromMnemonic(accountsData.mnemonicA, 0, 'testnet');
  const acctB = accountFromMnemonic(accountsData.mnemonicB, 0, 'testnet');

  const ufvkA = acctA.getUnifiedFullViewingKey();
  const ufvkB = acctB.getUnifiedFullViewingKey();

  log('  ✓ Keys derived into memory. UFVKs are strictly guarded and never output.\n');

  // Check / Start Next.js server if not already running
  let serverRunning = false;
  try {
    const res = await fetch(`${DASHBOARD_URL}/api/config`);
    if (res.ok) serverRunning = true;
  } catch (_) {}

  let serverProcess = null;
  if (!serverRunning) {
    log(`  Starting Next.js dashboard server on port ${SERVER_PORT}...`);
    const nextBin = path.join(projectRoot, 'packages', 'dashboard', 'node_modules', 'next', 'dist', 'bin', 'next');
    serverProcess = spawn(
      process.execPath,
      [nextBin, 'start', path.join(projectRoot, 'packages', 'dashboard'), '-p', String(SERVER_PORT)],
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

  log('[1/8] Launching headless browser (Google Chrome)...');
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const page = await context.newPage();

  try {
    log(`[2/8] Navigating to dashboard: ${DASHBOARD_URL}/?preset=testnet...`);
    await page.goto(`${DASHBOARD_URL}/?preset=testnet`, { waitUntil: 'domcontentloaded' });

    // Open Explorer Tab
    log('  Navigating to Explorer Tab...');
    await page.click('#tab-explorer');
    await page.waitForSelector('#explorer-search-input');
    log('  ✓ Explorer tab open and input ready.\n');

    // -------------------------------------------------------------------------
    // SCENARIO 1: Bad Input Validation
    // -------------------------------------------------------------------------
    log('[3/8] Scenario 1: Bad input validation...');
    await page.fill('#explorer-search-input', 'invalid_query_123_not_hex');
    await page.click('#explorer-search-btn');

    await page.waitForSelector('#explorer-error');
    const errText1 = await page.innerText('#explorer-error');
    if (!errText1.toLowerCase().includes('invalid format')) {
      throw new Error(`Expected invalid format error, got: ${errText1}`);
    }
    log(`  ✓ Error correctly displayed: "${errText1.trim()}"`);

    const shot1Path = path.join(screenshotsDir, 'stage3_01_bad_input.png');
    await page.screenshot({ path: shot1Path, fullPage: false });
    log(`  📸 Screenshot saved: ${path.basename(shot1Path)}\n`);

    // -------------------------------------------------------------------------
    // SCENARIO 2: Not Found
    // -------------------------------------------------------------------------
    log('[4/8] Scenario 2: Not found query...');
    await page.fill('#explorer-search-input', 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/explorer')),
      page.click('#explorer-search-btn'),
    ]);

    await page.waitForSelector('#explorer-error');
    const errText2 = await page.innerText('#explorer-error');
    if (!errText2.toLowerCase().includes('not found')) {
      throw new Error(`Expected not found error, got: ${errText2}`);
    }
    log(`  ✓ Error correctly displayed: "${errText2.trim()}"`);

    const shot2Path = path.join(screenshotsDir, 'stage3_02_not_found.png');
    await page.screenshot({ path: shot2Path, fullPage: false });
    log(`  📸 Screenshot saved: ${path.basename(shot2Path)}\n`);

    // -------------------------------------------------------------------------
    // SCENARIO 3: Transaction by ID (Local Core Decoded)
    // -------------------------------------------------------------------------
    log('[5/8] Scenario 3: Transaction by ID (Explorer Order)...');
    await page.fill('#explorer-search-input', EXPECTED_TXID);
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/explorer') && res.status() === 200),
      page.click('#explorer-search-btn'),
    ]);

    await page.waitForSelector('#explorer-tx-view');
    const matchBadgeText = await page.innerText('#explorer-match-badge');
    const upgradeName = await page.innerText('#explorer-upgrade-name');
    const branchId = await page.innerText('#explorer-branch-id');
    const expiryHeight = await page.innerText('#explorer-expiry-height');
    const ironwoodActions = await page.innerText('#explorer-ironwood-actions');
    const anchorWallet = await page.innerText('#explorer-ironwood-anchor-wallet');
    const anchorZebra = await page.innerText('#explorer-ironwood-anchor-zebra');
    const feeDisplay = await page.innerText('#explorer-fee-display');

    log(`  Match Feedback:                        ${matchBadgeText.trim()}`);
    log(`  Network Upgrade:                       ${upgradeName.trim()}`);
    log(`  Consensus Branch:                      ${branchId.trim()}`);
    log(`  Expiry Height:                         ${expiryHeight.trim()}`);
    log(`  Ironwood Actions:                      ${ironwoodActions.trim()}`);
    log(`  Ironwood Anchor (wallet/Orchard order): ${anchorWallet.trim()}`);
    log(`  Ironwood Anchor (Zebra RPC order):     ${anchorZebra.trim()}`);
    log(`  Transaction Fee:                       ${feeDisplay.trim()}`);

    if (!matchBadgeText.toUpperCase().includes('TRANSACTION')) {
      throw new Error(`Expected match Transaction, got: ${matchBadgeText}`);
    }
    if (upgradeName.trim() !== 'NU7') {
      throw new Error(`Expected upgrade NU7, got: ${upgradeName}`);
    }
    if (!branchId.includes('77190ad9')) {
      throw new Error(`Expected branch 77190ad9, got: ${branchId}`);
    }
    if (!expiryHeight.includes('4542278')) {
      throw new Error(`Expected expiry 4542278, got: ${expiryHeight}`);
    }
    if (!ironwoodActions.includes('2')) {
      throw new Error(`Expected 2 actions, got: ${ironwoodActions}`);
    }

    // Assert full 64 chars of both anchor forms
    const expectedWalletAnchor = '92b8796c8a14d0710d61e1775824089d3e8b43b6293bb48c96cf9522699a8e3f';
    const expectedZebraAnchor = '3f8e9a692295cf968cb43b29b6438b3e9d08245877e1610d71d0148a6c79b892';

    if (anchorWallet.trim() !== expectedWalletAnchor) {
      throw new Error(`Expected wallet anchor ${expectedWalletAnchor}, got: ${anchorWallet.trim()}`);
    }
    if (anchorZebra.trim() !== expectedZebraAnchor) {
      throw new Error(`Expected Zebra anchor ${expectedZebraAnchor}, got: ${anchorZebra.trim()}`);
    }
    if (anchorWallet.trim().length !== 64 || anchorZebra.trim().length !== 64) {
      throw new Error(`Anchor hex must be exactly 64 characters`);
    }

    // Assert fee is computed as 10000 zat and not unknown
    if (!feeDisplay.includes('10000 zat')) {
      throw new Error(`Expected fee 10000 zat, got: ${feeDisplay.trim()}`);
    }
    if (feeDisplay.toLowerCase().includes('unknown')) {
      throw new Error(`Fee should be known (10000 zat), but was marked unknown`);
    }

    log('  ✓ Verified: Transaction decoded locally via Core NAPI matching summary.json evidence.');
    log('  ✓ Verified: Anchors displayed in both wallet/Orchard (64-hex) and Zebra RPC (64-hex) byte orders.');
    log('  ✓ Verified: Shielded fee computed as 10,000 zatoshis (0.00010000 ZEC), feeUnknown: false.');

    const shot3Path = path.join(screenshotsDir, 'stage3_03_tx_by_id.png');
    await page.screenshot({ path: shot3Path, fullPage: false });
    log(`  📸 Screenshot saved: ${path.basename(shot3Path)}\n`);

    // -------------------------------------------------------------------------
    // SCENARIO 4: Block by Height
    // -------------------------------------------------------------------------
    log('[6/8] Scenario 4: Block by height (4542240)...');
    await page.fill('#explorer-search-input', EXPECTED_BLOCK_HEIGHT);
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/explorer') && res.status() === 200),
      page.click('#explorer-search-btn'),
    ]);

    await page.waitForSelector('#explorer-block-view');
    const blockMatch = await page.innerText('#explorer-match-badge');
    const blockHeightDisplay = await page.innerText('#explorer-block-height-display');
    const blockHashDisplay = await page.innerText('#explorer-block-hash-display');
    const treeSizeIronwood = await page.innerText('#explorer-ironwood-tree-size');

    log(`  Match Feedback:     ${blockMatch.trim()}`);
    log(`  Block Height:       ${blockHeightDisplay.trim()}`);
    log(`  Block Hash:         ${blockHashDisplay.trim()}`);
    log(`  Ironwood Tree Size: ${treeSizeIronwood.trim()}`);

    if (!blockMatch.toUpperCase().includes('BLOCK')) {
      throw new Error(`Expected match Block, got: ${blockMatch}`);
    }
    if (!blockHeightDisplay.includes(EXPECTED_BLOCK_HEIGHT)) {
      throw new Error(`Expected block height ${EXPECTED_BLOCK_HEIGHT}, got: ${blockHeightDisplay}`);
    }
    if (!blockHashDisplay.includes(EXPECTED_BLOCK_HASH)) {
      throw new Error(`Expected block hash ${EXPECTED_BLOCK_HASH}, got: ${blockHashDisplay}`);
    }

    // Verify tx list contains our expected tx
    const blockTxContent = await page.content();
    if (!blockTxContent.includes(EXPECTED_TXID)) {
      throw new Error(`Expected block tx list to contain ${EXPECTED_TXID}`);
    }
    log(`  ✓ Block contains tx ${EXPECTED_TXID}`);

    const shot4Path = path.join(screenshotsDir, 'stage3_04_block_by_height.png');
    await page.screenshot({ path: shot4Path, fullPage: false });
    log(`  📸 Screenshot saved: ${path.basename(shot4Path)}\n`);

    // -------------------------------------------------------------------------
    // SCENARIO 5: Block by Hash
    // -------------------------------------------------------------------------
    log('[7/8] Scenario 5: Block by hash (00005c49b2e5...)...');
    await page.fill('#explorer-search-input', EXPECTED_BLOCK_HASH);
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/explorer') && res.status() === 200),
      page.click('#explorer-search-btn'),
    ]);

    await page.waitForSelector('#explorer-block-view');
    const hashMatch = await page.innerText('#explorer-match-badge');
    const hashHeight = await page.innerText('#explorer-block-height-display');

    log(`  Match Feedback:     ${hashMatch.trim()}`);
    log(`  Resolved Height:    ${hashHeight.trim()}`);

    if (!hashMatch.toUpperCase().includes('BLOCK')) {
      throw new Error(`Expected match Block, got: ${hashMatch}`);
    }
    if (!hashHeight.includes(EXPECTED_BLOCK_HEIGHT)) {
      throw new Error(`Expected height ${EXPECTED_BLOCK_HEIGHT}, got: ${hashHeight}`);
    }
    log('  ✓ Ambiguous 64-hex starting with 0000 correctly resolved to Block.');

    const shot5Path = path.join(screenshotsDir, 'stage3_05_block_by_hash.png');
    await page.screenshot({ path: shot5Path, fullPage: false });
    log(`  📸 Screenshot saved: ${path.basename(shot5Path)}\n`);

    // -------------------------------------------------------------------------
    // SCENARIO 6: UFVK-Annotated View for Wallet A (OUTGOING)
    // -------------------------------------------------------------------------
    log('[8/8] Scenario 6: UFVK-annotated view for Wallet A (OUT)...');
    // Import Wallet A key via Keys Tab
    await page.click('#tab-addresses');
    await page.waitForSelector('#input-ufvk');

    // If a key was already active, forget it first
    const forgetBtnA = await page.$('#btn-forget-key');
    if (forgetBtnA) {
      await Promise.all([
        page.waitForResponse((res) => res.url().includes('/api/account/forget-key')),
        page.click('#btn-forget-key'),
      ]);
      await page.waitForSelector('#input-ufvk');
    }

    await page.fill('#input-ufvk', ufvkA);
    await page.fill('#input-birthday', '4542200');
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/account/import-key') && res.status() === 200),
      page.click('#btn-import-key'),
    ]);
    await page.waitForSelector('#import-success-banner');
    log('  ✓ Wallet A key imported into session.');

    // Navigate to Explorer Tab and query the transaction
    await page.click('#tab-explorer');
    await page.waitForSelector('#explorer-search-input');
    await page.fill('#explorer-search-input', EXPECTED_TXID);
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/explorer') && res.status() === 200),
      page.click('#explorer-search-btn'),
    ]);

    await page.waitForSelector('#explorer-ownership-banner');
    const ownershipBadgeA = await page.innerText('#explorer-ownership-badge');
    const ownershipAmountA = await page.innerText('#explorer-ownership-amount');

    log(`  Ownership Badge:    ${ownershipBadgeA.trim()}`);
    log(`  Ownership Amount:   ${ownershipAmountA.trim()}`);

    if (!ownershipBadgeA.toUpperCase().includes('OUTGOING')) {
      throw new Error(`Expected OUTGOING badge, got: ${ownershipBadgeA}`);
    }
    if (!ownershipAmountA.includes('0.01')) {
      throw new Error(`Expected 0.01 ZEC, got: ${ownershipAmountA}`);
    }

    // Verify Confidentiality: UFVK string must NOT be revealed in DOM
    const pageHtmlA = await page.content();
    if (pageHtmlA.includes(ufvkA)) {
      throw new Error('SECURITY VIOLATION: Revealed UFVK found in DOM of Explorer view!');
    }
    log('  ✓ Confidentiality verified: Wallet A UFVK is NOT revealed in UI or DOM.');

    const shot6Path = path.join(screenshotsDir, 'stage3_06_wallet_a_annotated_out.png');
    await page.screenshot({ path: shot6Path, fullPage: false });
    log(`  📸 Screenshot saved: ${path.basename(shot6Path)}\n`);

    // -------------------------------------------------------------------------
    // SCENARIO 7: UFVK-Annotated View for Wallet B (INCOMING)
    // -------------------------------------------------------------------------
    log('Scenario 7: UFVK-annotated view for Wallet B (IN)...');
    await page.click('#tab-addresses');
    await page.waitForSelector('#btn-forget-key');
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/account/forget-key') && res.status() === 200),
      page.click('#btn-forget-key'),
    ]);
    await page.waitForSelector('#input-ufvk');

    await page.fill('#input-ufvk', ufvkB);
    await page.fill('#input-birthday', '4542200');
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/account/import-key') && res.status() === 200),
      page.click('#btn-import-key'),
    ]);
    await page.waitForSelector('#import-success-banner');
    log('  ✓ Wallet B key imported into session.');

    await page.click('#tab-explorer');
    await page.waitForSelector('#explorer-search-input');
    await page.fill('#explorer-search-input', EXPECTED_TXID);
    await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/explorer') && res.status() === 200),
      page.click('#explorer-search-btn'),
    ]);

    await page.waitForSelector('#explorer-ownership-banner');
    const ownershipBadgeB = await page.innerText('#explorer-ownership-badge');
    const ownershipAmountB = await page.innerText('#explorer-ownership-amount');

    log(`  Ownership Badge:    ${ownershipBadgeB.trim()}`);
    log(`  Ownership Amount:   ${ownershipAmountB.trim()}`);

    if (!ownershipBadgeB.toUpperCase().includes('INCOMING')) {
      throw new Error(`Expected INCOMING badge, got: ${ownershipBadgeB}`);
    }
    if (!ownershipAmountB.includes('0.01')) {
      throw new Error(`Expected 0.01 ZEC, got: ${ownershipAmountB}`);
    }

    // Verify Confidentiality: UFVK string must NOT be revealed in DOM
    const pageHtmlB = await page.content();
    if (pageHtmlB.includes(ufvkB)) {
      throw new Error('SECURITY VIOLATION: Revealed UFVK found in DOM of Explorer view!');
    }
    log('  ✓ Confidentiality verified: Wallet B UFVK is NOT revealed in UI or DOM.');

    const shot7Path = path.join(screenshotsDir, 'stage3_07_wallet_b_annotated_in.png');
    await page.screenshot({ path: shot7Path, fullPage: false });
    log(`  📸 Screenshot saved: ${path.basename(shot7Path)}\n`);

    // -------------------------------------------------------------------------
    // SCENARIO 8: Direct Route /explorer/[txid]
    // -------------------------------------------------------------------------
    log('Scenario 8: Direct route /explorer/[txid]...');
    await page.goto(`${DASHBOARD_URL}/explorer/${EXPECTED_TXID}?preset=testnet`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#explorer-tx-view');
    const directTxidDisplay = await page.innerText('#explorer-txid-display');
    if (!directTxidDisplay.includes(EXPECTED_TXID.slice(0, 16))) {
      throw new Error(`Expected direct route to display txid ${EXPECTED_TXID}, got: ${directTxidDisplay}`);
    }
    log(`  ✓ Direct route loaded decoded tx view for ${EXPECTED_TXID.slice(0, 16)}...`);

    const shot8Path = path.join(screenshotsDir, 'stage3_08_direct_route_txid.png');
    await page.screenshot({ path: shot8Path, fullPage: false });
    log(`  📸 Screenshot saved: ${path.basename(shot8Path)}\n`);

    log('========================================================================');
    log('ALL 8 PLAYWRIGHT SCENARIOS COMPLETED AND VERIFIED SUCCESSFULLY!');
    log('========================================================================\n');

  } finally {
    await browser.close().catch(() => {});
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
    }
  }

  // Write Log File
  log('Checksums for generated artifacts:');
  const shots = [
    'stage3_01_bad_input.png',
    'stage3_02_not_found.png',
    'stage3_03_tx_by_id.png',
    'stage3_04_block_by_height.png',
    'stage3_05_block_by_hash.png',
    'stage3_06_wallet_a_annotated_out.png',
    'stage3_07_wallet_b_annotated_in.png',
    'stage3_08_direct_route_txid.png',
  ];

  for (const s of shots) {
    const p = path.join(screenshotsDir, s);
    if (fs.existsSync(p)) {
      log(`  ${sha256File(p)}  screenshots/${s}`);
    }
  }

  fs.writeFileSync(LOG_FILE, logLines.join('\n') + '\n', 'utf8');
  console.log(`\nLog written to: ${redactHome(LOG_FILE)} (sha256: ${sha256File(LOG_FILE)})`);
}

runStage3ExplorerPlaywright().catch((err) => {
  console.error('Playwright Suite FAILED:', err);
  process.exit(1);
});
