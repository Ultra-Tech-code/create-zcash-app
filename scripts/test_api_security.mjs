import assert from 'node:assert';
import * as core from '../packages/core/index.js';

const BASE_URL = process.env.DASHBOARD_URL || 'http://127.0.0.1:3050';

// Derive real, valid UFVKs for tests in server memory without logging
const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const derivedTestnet = core.deriveAccountFromMnemonic(TEST_MNEMONIC, 0, 'testnet');
const TESTNET_UFVK = derivedTestnet.ufvk;

const derivedMainnet = core.deriveAccountFromMnemonic(
  'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong',
  0,
  'mainnet'
);
const MAINNET_UFVK = derivedMainnet.ufvk;

async function runTests() {
  console.log(`=== RUNNING DASHBOARD API SECURITY TESTS (${BASE_URL}) ===\n`);

  // 1. GET /api/sync/status ignores ?ufvk=...
  console.log('Test 1: Verify GET /api/sync/status ignores ?ufvk= in query string...');
  const syncGetRes = await fetch(`${BASE_URL}/api/sync/status?network=testnet&ufvk=${TESTNET_UFVK}`);
  const syncGetData = await syncGetRes.json();
  assert.strictEqual(syncGetData.success, true);
  assert.strictEqual(syncGetData.message, 'UFVK required for background synchronization');
  assert.strictEqual(syncGetData.scanned, 0);
  console.log('✓ PASS: GET /api/sync/status?ufvk=... returned message "UFVK required for background synchronization"\n');

  // 2. GET /api/transactions ignores ?ufvk=...
  console.log('Test 2: Verify GET /api/transactions ignores ?ufvk= in query string...');
  const txGetRes = await fetch(`${BASE_URL}/api/transactions?network=testnet&ufvk=${TESTNET_UFVK}`);
  const txGetData = await txGetRes.json();
  assert.strictEqual(txGetData.success, true);
  assert.strictEqual(txGetData.message, 'No UFVK loaded for this account');
  assert.strictEqual(txGetData.count, 0);
  console.log('✓ PASS: GET /api/transactions?ufvk=... returned message "No UFVK loaded for this account"\n');

  // 3. GET on /api/account/import-key is refused (405 Method Not Allowed)
  console.log('Test 3: Verify GET /api/account/import-key is refused (POST only)...');
  const importGetRes = await fetch(`${BASE_URL}/api/account/import-key`);
  assert.strictEqual(importGetRes.status, 405);
  const importGetData = await importGetRes.json();
  assert.strictEqual(importGetData.error, 'Importing UFVK is POST only');
  console.log('✓ PASS: GET /api/account/import-key returned 405 Method Not Allowed\n');

  // 4. POST /api/account/import-key requires birthday
  console.log('Test 4: Verify POST /api/account/import-key requires birthday...');
  const noBirthdayRes = await fetch(`${BASE_URL}/api/account/import-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ufvk: TESTNET_UFVK, network: 'testnet' }),
  });
  assert.strictEqual(noBirthdayRes.status, 400);
  const noBirthdayData = await noBirthdayRes.json();
  assert.ok(noBirthdayData.error.includes('Birthday height is required'));
  console.log('✓ PASS: Missing birthday height was rejected with 400\n');

  // 5. POST /api/account/import-key validates network prefix
  console.log('Test 5: Verify POST /api/account/import-key refuses key prefix mismatch...');
  const prefixMismatchRes = await fetch(`${BASE_URL}/api/account/import-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ufvk: TESTNET_UFVK, network: 'mainnet', birthday: 2000000 }),
  });
  assert.strictEqual(prefixMismatchRes.status, 400);
  const prefixMismatchData = await prefixMismatchRes.json();
  assert.ok(prefixMismatchData.error.includes('Invalid UFVK prefix for mainnet'));
  console.log('✓ PASS: Testnet UFVK on mainnet was refused\n');

  // 6. POST /api/account/import-key with valid UFVK and birthday sets HttpOnly, SameSite=Strict cookie
  console.log('Test 6: Verify POST /api/account/import-key sets HttpOnly, SameSite=Strict cookie...');
  const importRes = await fetch(`${BASE_URL}/api/account/import-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ufvk: TESTNET_UFVK,
      network: 'testnet',
      birthday: 4542200,
    }),
  });
  assert.strictEqual(importRes.status, 200);
  const importData = await importRes.json();
  assert.strictEqual(importData.success, true);

  const rawSetCookie = importRes.headers.get('set-cookie');
  assert.ok(rawSetCookie, 'Expected Set-Cookie header in response');
  const cookieLower = rawSetCookie.toLowerCase();
  assert.ok(cookieLower.includes('httponly'), 'Cookie must be HttpOnly');
  assert.ok(cookieLower.includes('samesite=strict'), 'Cookie must have SameSite=Strict');
  console.log('✓ PASS: Response includes Set-Cookie with HttpOnly and SameSite=Strict\n');

  // Extract session cookie for subsequent requests
  const match = rawSetCookie.match(/zcash_dashboard_session=([^;]+)/);
  assert.ok(match, 'Session cookie must contain zcash_dashboard_session value');
  const sessionCookieHeader = `zcash_dashboard_session=${match[1]}`;

  // 7. GET /api/account with session cookie retrieves watch-only account details and transparent address
  console.log('Test 7: Verify GET /api/account with session cookie reflects imported watch-only account...');
  const acctRes = await fetch(`${BASE_URL}/api/account?preset=testnet`, {
    headers: { Cookie: sessionCookieHeader },
  });
  assert.strictEqual(acctRes.status, 200);
  const acctData = await acctRes.json();
  assert.strictEqual(acctData.success, true);
  assert.strictEqual(acctData.hasImportedKey, true);
  assert.strictEqual(acctData.isWatchOnly, true);
  assert.ok(acctData.unifiedAddress.startsWith('utest1'), 'Unified address derived from UFVK');
  assert.ok(acctData.transparentAddress.startsWith('tm'), 'Transparent address derived from UFVK');
  console.log('✓ PASS: Account endpoint returns valid UA and transparent address without exposing secret keys\n');

  // 8. Custom endpoints security
  console.log('Test 8: Verify custom endpoints security...');
  // 8a: Arbitrary 127.0.0.1:* in query string is rejected
  const arbitraryQueryRes = await fetch(`${BASE_URL}/api/status?preset=regtest-nu7&endpoint=127.0.0.1:9999`);
  const arbitraryQueryData = await arbitraryQueryRes.json();
  assert.strictEqual(arbitraryQueryData.endpoint, '127.0.0.1:39067', 'Arbitrary query endpoint must be ignored and fallback to preset');
  console.log('✓ PASS: Arbitrary ?endpoint=127.0.0.1:9999 was rejected; preserved preset 127.0.0.1:39067');

  // 8b: Explicit customEndpoint is accepted
  const explicitCustomRes = await fetch(`${BASE_URL}/api/status?preset=regtest-nu7&customEndpoint=127.0.0.1:9999`);
  const explicitCustomData = await explicitCustomRes.json();
  assert.strictEqual(explicitCustomData.endpoint, '127.0.0.1:9999', 'Explicit customEndpoint field must be accepted');
  console.log('✓ PASS: Explicit customEndpoint field was accepted: 127.0.0.1:9999\n');

  // 9. POST /api/account/forget-key clears session and expires cookie
  console.log('Test 9: Verify POST /api/account/forget-key clears session and expires cookie...');
  const forgetRes = await fetch(`${BASE_URL}/api/account/forget-key`, {
    method: 'POST',
    headers: { Cookie: sessionCookieHeader },
  });
  assert.strictEqual(forgetRes.status, 200);
  const forgetData = await forgetRes.json();
  assert.strictEqual(forgetData.success, true);

  const forgetCookie = forgetRes.headers.get('set-cookie');
  assert.ok(forgetCookie, 'Expected Set-Cookie header on forget-key');
  const forgetCookieLower = forgetCookie.toLowerCase();
  assert.ok(forgetCookieLower.includes('httponly'), 'Expired cookie must be HttpOnly');
  assert.ok(forgetCookieLower.includes('samesite=strict'), 'Expired cookie must have SameSite=Strict');
  assert.ok(forgetCookieLower.includes('max-age=0'), 'Cookie must be expired with max-age=0');

  // Verify subsequent request with old cookie returns no UFVK loaded
  const postForgetRes = await fetch(`${BASE_URL}/api/transactions?network=testnet`, {
    headers: { Cookie: sessionCookieHeader },
  });
  const postForgetData = await postForgetRes.json();
  assert.strictEqual(postForgetData.message, 'No UFVK loaded for this account');
  console.log('✓ PASS: Session cleared and cookie expired with SameSite=Strict\n');

  console.log('=== ALL 9 API SECURITY TESTS PASSED CLEANLY! ===');
}

runTests().catch((err) => {
  console.error('API Security Test Failed:', err);
  process.exit(1);
});
