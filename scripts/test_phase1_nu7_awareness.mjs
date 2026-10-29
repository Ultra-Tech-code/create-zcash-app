#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const {
  getUpgradeName,
  normalizeBranchId,
  getExpectedBranchId,
  CONSENSUS_BRANCH_UPGRADES,
  dev,
} = await import(`${projectRoot}/packages/sdk/dist/index.js`);

const {
  readZebraCookie,
  buildTestnetLightwalletdArgs,
  redactLightwalletdArgs,
} = await import(`${projectRoot}/packages/dev/dist/index.js`);

const BASE_URL = process.env.DASHBOARD_URL || 'http://127.0.0.1:3050';

console.log('================================================================');
console.log(' PHASE 1.1 - NU7 AWARENESS, GUARDS & DASHBOARD FIXES TEST SUITE');
console.log('================================================================');
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log(`Base URL:  ${BASE_URL}`);

let totalPassed = 0;
let totalChecks = 0;

function assertCheck(name, cond, details = '') {
  totalChecks += 1;
  if (cond) {
    totalPassed += 1;
    console.log(`[PASS] ${name}${details ? ` -> ${details}` : ''}`);
  } else {
    console.error(`[FAIL] ${name}${details ? ` -> ${details}` : ''}`);
    process.exitCode = 1;
  }
}

// -------------------------------------------------------------
// 1. SDK Helper Tests: getUpgradeName & branch normalization
// -------------------------------------------------------------
console.log('\n--- 1. SDK Consensus Helper Tests ---');

assertCheck('NU7 branch ID mapping', getUpgradeName('77190ad9') === 'NU7', '77190ad9 -> NU7');
assertCheck('NU7 with 0x prefix', getUpgradeName('0x77190ad9') === 'NU7', '0x77190ad9 -> NU7');
assertCheck('NU7 uppercase', getUpgradeName('0X77190AD9') === 'NU7', '0X77190AD9 -> NU7');
assertCheck('NU7 numeric form', getUpgradeName(0x77190ad9) === 'NU7', '0x77190ad9 -> NU7');

assertCheck('NU6.3 branch ID mapping', getUpgradeName('37a5165b') === 'NU6.3', '37a5165b -> NU6.3');
assertCheck('NU6.3 with 0x prefix', getUpgradeName('0x37a5165b') === 'NU6.3', '0x37a5165b -> NU6.3');

assertCheck('NU6 branch ID mapping', getUpgradeName('c8e71055') === 'NU6', 'c8e71055 -> NU6');
assertCheck('NU5 branch ID mapping', getUpgradeName('c2d6d0b4') === 'NU5', 'c2d6d0b4 -> NU5');
assertCheck('Canopy branch ID mapping', getUpgradeName('e9ff75a6') === 'Canopy', 'e9ff75a6 -> Canopy');
assertCheck('Heartwood branch ID mapping', getUpgradeName('f5b9230b') === 'Heartwood', 'f5b9230b -> Heartwood');
assertCheck('Blossom branch ID mapping', getUpgradeName('2bb40e60') === 'Blossom', '2bb40e60 -> Blossom');
assertCheck('Sapling branch ID mapping', getUpgradeName('76b809bb') === 'Sapling', '76b809bb -> Sapling');
assertCheck('Overwinter branch ID mapping', getUpgradeName('5ba81b19') === 'Overwinter', '5ba81b19 -> Overwinter');
assertCheck('Sprout branch ID mapping', getUpgradeName('00000000') === 'Sprout', '00000000 -> Sprout');

assertCheck('Unknown branch ID fallback', getUpgradeName('deadbeef') === 'Unknown (0xdeadbeef)', 'deadbeef -> Unknown (0xdeadbeef)');
assertCheck('Unknown branch ID with 0x prefix', getUpgradeName('0x12345678') === 'Unknown (0x12345678)', '0x12345678 -> Unknown (0x12345678)');
assertCheck('Empty / null branch ID handling', getUpgradeName(null) === 'Unknown' && getUpgradeName('') === 'Unknown');

// -------------------------------------------------------------
// 2. Dashboard /api/status Preset Tests
// -------------------------------------------------------------
console.log('\n--- 2. Dashboard /api/status Preset Tests ---');

const presets = [
  { id: 'regtest-nu7', expectedUpgrade: 'NU7', expectedBranch: '77190ad9', expectedNetwork: 'regtest' },
  { id: 'regtest-z3', expectedUpgrade: 'NU6.3', expectedBranch: '37a5165b', expectedNetwork: 'regtest' },
  { id: 'testnet', expectedUpgrade: 'NU7', expectedBranch: '77190ad9', expectedNetwork: 'testnet' },
  { id: 'testnet-local', expectedNetwork: 'testnet' },
  { id: 'mainnet', expectedNetwork: 'mainnet' },
];

for (const p of presets) {
  try {
    const res = await fetch(`${BASE_URL}/api/status?preset=${p.id}`);
    const data = await res.json();

    if (data.success) {
      assertCheck(`Preset '${p.id}' status success`, true, `status: 200, endpoint: ${data.endpoint}`);
      assertCheck(`Preset '${p.id}' network matches`, data.network === p.expectedNetwork, `network: ${data.network}`);

      if (p.expectedBranch) {
        assertCheck(
          `Preset '${p.id}' consensus branch matches`,
          data.info?.actualBranchId === p.expectedBranch,
          `branch: 0x${data.info?.actualBranchId}`
        );
        assertCheck(
          `Preset '${p.id}' upgradeName matches node`,
          data.info?.upgradeName === p.expectedUpgrade,
          `upgradeName: ${data.info?.upgradeName}`
        );
        assertCheck(
          `Preset '${p.id}' branchMatches verification flag`,
          data.info?.branchMatches === true,
          `branchMatches: ${data.info?.branchMatches}`
        );
      }
    } else {
      if (p.id === 'testnet-local' || p.id === 'mainnet') {
        assertCheck(`Preset '${p.id}' response handled gracefully`, true, `Offline or unreachable: ${data.error}`);
      } else {
        assertCheck(`Preset '${p.id}' status returned error`, false, `error: ${data.error}`);
      }
    }
  } catch (err) {
    assertCheck(`Preset '${p.id}' fetch failed`, false, err.message);
  }
}

// -------------------------------------------------------------
// 3. Chain Name Guard: regtest-vs-testnet Mismatch Checks
// -------------------------------------------------------------
console.log('\n--- 3. Chain Name Guard Tests (regtest-vs-testnet) ---');

try {
  // Scenario A: User selects 'testnet' against a local regtest node (127.0.0.1:39067)
  const regtestAsTestnetRes = await fetch(`${BASE_URL}/api/status?network=testnet&endpoint=127.0.0.1:39067`);
  const regtestAsTestnetData = await regtestAsTestnetRes.json();

  assertCheck('Chain Guard: Detects regtest node when testnet selected', regtestAsTestnetData.info?.chainMismatch === true);
  assertCheck('Chain Guard: Sets branchMatches to false on chain mismatch', regtestAsTestnetData.info?.branchMatches === false);
  const expectedMsgA = `You selected testnet but this node reports chain 'test' (height ${regtestAsTestnetData.info?.blockHeight}). Sapling activates at height 1, so this is a regtest node. Pick the matching preset.`;
  assertCheck(
    'Chain Guard: Formats mismatch message with detection signal for regtest node',
    regtestAsTestnetData.info?.chainMismatchMessage === expectedMsgA,
    regtestAsTestnetData.info?.chainMismatchMessage
  );

  // Scenario B: User selects 'regtest' against a remote testnet node (testnet.zec.rocks:443)
  const testnetAsRegtestRes = await fetch(`${BASE_URL}/api/status?network=regtest&endpoint=testnet.zec.rocks:443`);
  const testnetAsRegtestData = await testnetAsRegtestRes.json();

  assertCheck('Chain Guard: Detects testnet node when regtest selected', testnetAsRegtestData.info?.chainMismatch === true);
  assertCheck('Chain Guard: Sets branchMatches to false on testnet node mismatch', testnetAsRegtestData.info?.branchMatches === false);
  const expectedMsgB = `You selected regtest but this node reports chain 'test' (height ${testnetAsRegtestData.info?.blockHeight}). Sapling activates at height 280000, so this is a testnet node. Pick the matching preset.`;
  assertCheck(
    'Chain Guard: Formats mismatch message with detection signal for testnet node',
    testnetAsRegtestData.info?.chainMismatchMessage === expectedMsgB,
    testnetAsRegtestData.info?.chainMismatchMessage
  );
} catch (err) {
  assertCheck('Chain Guard test query failed', false, err.message);
}

// -------------------------------------------------------------
// 4. Testnet / Mainnet Watch-Only Refusal Checks
// -------------------------------------------------------------
console.log('\n--- 4. Watch-Only Fixture Refusal Tests ---');

// SDK dev.fixtures.account refusal
assertCheck('SDK Refusal: dev.fixtures.account strictly refuses testnet', (() => {
  try {
    dev.fixtures.account(0, 'testnet');
    return false;
  } catch (e) {
    return /strictly prohibited on testnet/i.test(e.message);
  }
})());

assertCheck('SDK Refusal: dev.fixtures.account strictly refuses mainnet', (() => {
  try {
    dev.fixtures.account(0, 'mainnet');
    return false;
  } catch (e) {
    return /strictly prohibited on mainnet/i.test(e.message);
  }
})());

// Dashboard /api/account testnet watch-only refusal
try {
  const acctTestnetRes = await fetch(`${BASE_URL}/api/account?preset=testnet&index=0`);
  const acctTestnet = await acctTestnetRes.json();

  assertCheck('/api/account: Testnet is marked isWatchOnly', acctTestnet.isWatchOnly === true);
  assertCheck('/api/account: Testnet fixture UA is refused (null)', acctTestnet.unifiedAddress === null);
  assertCheck('/api/account: Testnet fixture UFVK is refused (null)', acctTestnet.ufvk === null);
  assertCheck('/api/account: Testnet status is ready (watch-only)', acctTestnet.status === 'ready');
  assertCheck(
    '/api/account: Testnet message explains watch-only & fixture refusal',
    acctTestnet.message?.includes('Testnet is watch-only') && acctTestnet.message?.includes('Public fixture mnemonics are refused'),
    acctTestnet.message
  );
} catch (err) {
  assertCheck('/api/account testnet test failed', false, err.message);
}

// Dashboard /api/account mainnet watch-only refusal
try {
  const acctMainnetRes = await fetch(`${BASE_URL}/api/account?preset=mainnet&index=0`);
  const acctMainnet = await acctMainnetRes.json();

  assertCheck('/api/account: Mainnet is marked isWatchOnly', acctMainnet.isWatchOnly === true);
  assertCheck('/api/account: Mainnet fixture UA is refused (null)', acctMainnet.unifiedAddress === null);
  assertCheck('/api/account: Mainnet fixture UFVK is refused (null)', acctMainnet.ufvk === null);
  assertCheck(
    '/api/account: Mainnet message explains watch-only & fixture refusal',
    acctMainnet.message?.includes('Mainnet is watch-only') && acctMainnet.message?.includes('Public fixture mnemonics are refused'),
    acctMainnet.message
  );
} catch (err) {
  assertCheck('/api/account mainnet test failed', false, err.message);
}

// -------------------------------------------------------------
// 5. /api/account Error Surfacing (No Silent Zeros)
// -------------------------------------------------------------
console.log('\n--- 5. /api/account Error Surfacing (No Silent Zeros) ---');

try {
  // Query regtest account against an unreachable offline endpoint
  const offlineEndpoint = '127.0.0.1:59999';
  const errRes = await fetch(`${BASE_URL}/api/account?network=regtest&endpoint=${offlineEndpoint}&index=0`);
  const errData = await errRes.json();

  assertCheck('/api/account: Offline node returns status "error"', errData.status === 'error', `status: ${errData.status}`);
  assertCheck('/api/account: Offline node returns success false', errData.success === false);
  assertCheck(
    '/api/account: Offline node message describes connection failure',
    typeof errData.message === 'string' && errData.message.includes('Failed to query node'),
    errData.message
  );
  assertCheck(
    '/api/account: Balances are null on error (NO silent zeros)',
    errData.balances === null,
    `balances: ${JSON.stringify(errData.balances)}`
  );
} catch (err) {
  assertCheck('/api/account error test failed', false, err.message);
}

// -------------------------------------------------------------
// 6. Regtest NU7 Direct Zebra Mining Test (Port 39232)
// -------------------------------------------------------------
console.log('\n--- 6. Regtest NU7 Faucet Mining Test ---');

try {
  const mineRes = await fetch(`${BASE_URL}/api/mine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blocks: 1, preset: 'regtest-nu7' }),
  });
  const mineData = await mineRes.json();
  assertCheck('NU7 Regtest mine 1 block call', mineData.success === true, `rpcUrl: ${mineData.rpcUrl}`);
  assertCheck('NU7 Regtest mine RPC targeted 39232', mineData.rpcUrl === 'http://127.0.0.1:39232', 'Targeted port 39232');
  assertCheck('NU7 Regtest block hash returned', Array.isArray(mineData.result) && mineData.result.length === 1, `block: ${mineData.result?.[0]?.slice(0, 16)}...`);
} catch (err) {
  assertCheck('NU7 Regtest mine call failed', false, err.message);
}

// -------------------------------------------------------------
// 7. Local Testnet Lightwalletd Helper Unit Checks
// -------------------------------------------------------------
console.log('\n--- 7. Local Testnet Lightwalletd Helper Checks ---');

const testArgs = buildTestnetLightwalletdArgs({
  cookieToken: 'secret_test_token_abc123',
  dataDir: '/tmp/test_dir',
});

assertCheck(
  'Helper: Builds 39167 gRPC port default',
  testArgs.includes('--grpc-bind-addr') && testArgs[testArgs.indexOf('--grpc-bind-addr') + 1] === '127.0.0.1:39167'
);
assertCheck(
  'Helper: Builds 39168 HTTP port default',
  testArgs.includes('--http-bind-addr') && testArgs[testArgs.indexOf('--http-bind-addr') + 1] === '127.0.0.1:39168'
);
assertCheck(
  'Helper: Builds 18232 RPC port default',
  testArgs.includes('--rpcport') && testArgs[testArgs.indexOf('--rpcport') + 1] === '18232'
);
assertCheck(
  'Helper: Includes --no-tls-very-insecure flag',
  testArgs.includes('--no-tls-very-insecure')
);

const redactedArgs = redactLightwalletdArgs(testArgs, 'secret_test_token_abc123');
assertCheck(
  'Helper: Redaction removes cookie token completely',
  !redactedArgs.join(' ').includes('secret_test_token_abc123') && redactedArgs.includes('[REDACTED]')
);

console.log('\n================================================================');
console.log(` Summary: ${totalPassed} / ${totalChecks} checks passed.`);
console.log('================================================================\n');

if (totalPassed !== totalChecks) {
  process.exit(1);
}
