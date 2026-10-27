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
} = await import(`${projectRoot}/packages/sdk/dist/index.js`);

const BASE_URL = process.env.DASHBOARD_URL || 'http://127.0.0.1:3050';

function replaceHome(str) {
  if (typeof str !== 'string') return str;
  const home = process.env.HOME || '';
  return home ? str.replaceAll(home, '~') : str;
}

console.log('================================================================');
console.log(' PHASE 1 - NU7 AWARENESS & DASHBOARD PRESET VERIFICATION');
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
// 2. Dashboard /api/status endpoint tests for each preset
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
      // Offline local preset or optional testnet-local
      if (p.id === 'testnet-local' || p.id === 'mainnet') {
        assertCheck(`Preset '${p.id}' response handled gracefully`, true, `Offline or unreachable as expected: ${data.error}`);
      } else {
        assertCheck(`Preset '${p.id}' status returned error`, false, `error: ${data.error}`);
      }
    }
  } catch (err) {
    assertCheck(`Preset '${p.id}' fetch failed`, false, err.message);
  }
}

// -------------------------------------------------------------
// 3. Regtest NU7 Direct Zebra Mining Test (Port 39232)
// -------------------------------------------------------------
console.log('\n--- 3. Regtest NU7 Faucet Mining Test ---');

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
// 4. Testnet /api/account Fast Non-Blocking Check
// -------------------------------------------------------------
console.log('\n--- 4. Testnet Non-Blocking Account Check ---');

const startAcctTime = Date.now();
try {
  const acctRes = await fetch(`${BASE_URL}/api/account?preset=testnet&index=0`);
  const acctData = await acctRes.json();
  const elapsed = Date.now() - startAcctTime;

  assertCheck('Testnet account query response time < 5000ms', elapsed < 5000, `${elapsed}ms`);
  assertCheck('Testnet account isWatchOnly flagged', acctData.isWatchOnly === true, 'isWatchOnly: true');
  assertCheck('Testnet UA derived', acctData.unifiedAddress?.startsWith('utest1'), `UA: ${acctData.unifiedAddress?.slice(0, 24)}...`);
  assertCheck('Testnet UFVK derived', acctData.ufvk?.startsWith('uviewtest1'), `UFVK: ${acctData.ufvk?.slice(0, 24)}...`);
} catch (err) {
  assertCheck('Testnet account query failed', false, err.message);
}

console.log('\n================================================================');
console.log(` Summary: ${totalPassed} / ${totalChecks} checks passed.`);
console.log('================================================================\n');

if (totalPassed !== totalChecks) {
  process.exit(1);
}
