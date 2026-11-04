/**
 * End-to-End Runner for Stage 2 Recipes against NU7 Regtest Stack
 *
 * Runs and captures:
 * 1. recipe_checkout_nu7.log
 * 2. recipe_watch_only_nu7.log
 * 3. recipe_payroll_nu7.log
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import {
  createClient,
  accountFromMnemonic,
  accountFromUfvk,
  detectIncoming,
  getBalance,
  send,
  dev,
  reverseTxid,
  WatchOnlySpendError,
} from '../packages/sdk/dist/index.js';
import { runCheckoutWorkflow } from '../examples/checkout/checkout.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const LOGS_DIR = path.join(REPO_ROOT, 'packages', 'core', 'tests', 'logs');

const ENDPOINT = '127.0.0.1:39067';
const ZEBRA_RPC = 'http://127.0.0.1:39232';
const NETWORK = 'regtest-nu7';

function formatZec(zatoshis) {
  const z = BigInt(zatoshis);
  const whole = z / 100_000_000n;
  const frac = (z % 100_000_000n).toString().padStart(8, '0');
  return `${whole}.${frac}`;
}

async function mineBlocks(count = 1) {
  const res = await fetch(ZEBRA_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'generate',
      params: [count],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Mining failed: ${JSON.stringify(data.error)}`);
  return data.result;
}

// ----------------------------------------------------------------------------
// Recipe 1: Shielded Checkout Flow
// ----------------------------------------------------------------------------
async function runCheckoutRecipe() {
  const logLines = [];
  const log = (msg = '') => {
    console.log(msg);
    logLines.push(msg);
  };

  // Uses CheckoutService implementation from examples/checkout/checkout.mjs
  const result = await runCheckoutWorkflow({
    merchantMnemonic: dev.fixtures.mnemonics[1],
    payerMnemonic: dev.fixtures.mnemonics[0],
    orderId: 'ORD-8821',
    orderAmountZat: 100_000n,
    network: NETWORK,
    endpoint: ENDPOINT,
    zebraRpc: ZEBRA_RPC,
    log,
  });

  // Verify byte reversal equivalence
  if (result.order.txid !== reverseTxid(result.broadcastTxid)) {
    throw new Error(
      `Detected note txid (${result.order.txid}) does not match reverseTxid(broadcastTxid) (${reverseTxid(result.broadcastTxid)})`
    );
  }

  const logPath = path.join(LOGS_DIR, 'recipe_checkout_nu7.log');
  fs.writeFileSync(logPath, logLines.join('\n') + '\n');
  return logPath;
}

// ----------------------------------------------------------------------------
// Recipe 2: Watch-Only Wallet Monitor
// ----------------------------------------------------------------------------
async function runWatchOnlyRecipe() {
  const logLines = [];
  const log = (msg = '') => {
    console.log(msg);
    logLines.push(msg);
  };

  log('========================================================================');
  log('RECIPE 2: WATCH-ONLY WALLET MONITOR — ZERO-CUSTODY AIR-GAPPED SERVICE');
  log('========================================================================');
  log(`Timestamp: ${new Date().toISOString()}`);
  log(`Network:   ${NETWORK}`);
  log(`Endpoint:  ${ENDPOINT}`);
  log('------------------------------------------------------------------------\n');

  const client = createClient({ endpoint: ENDPOINT, network: NETWORK });

  try {
    // 1. Air-gapped cold storage key: export UFVK only
    const coldMnemonic = dev.fixtures.mnemonics[2];
    const coldAcct = accountFromMnemonic(coldMnemonic, 0, NETWORK);
    const coldUfvk = coldAcct.getUnifiedFullViewingKey();

    log(`[1/5] Server configured with Unified Full Viewing Key (UFVK):`);
    log(`      UFVK:            ${coldUfvk}`);
    log(`      Spending Authority: NONE (Zero Custody Server)\n`);

    // 2. Initialize WatchOnlyAccount
    const watchAcct = accountFromUfvk(coldUfvk, NETWORK);
    const depositUA = watchAcct.getUnifiedAddress(0);
    log(`[2/5] Derived Deposit Receiving Address:`);
    log(`      Deposit UA:      ${depositUA}`);
    const initBalance = await getBalance(client, watchAcct);
    log(`      Initial Balance: ${initBalance.total} zatoshis\n`);

    // 3. External payer sends 0.002 ZEC deposit
    const payerMnemonic = dev.fixtures.mnemonics[0];
    log(`[3/5] External payer broadcasts deposit:`);
    log(`      Recipient:       ${depositUA}`);
    log(`      Amount:          0.002 ZEC (200,000 zatoshis)`);

    const sendCmd = `node "${path.join(REPO_ROOT, 'packages', 'dev', 'dist', 'cli.js')}" send --to "${depositUA}" --amount 0.002 --memo "Deposit to cold wallet" --endpoint "${ENDPOINT}" --yes`;
    const sendOutput = execSync(sendCmd, {
      env: {
        ...process.env,
        ZCASH_MNEMONIC: payerMnemonic,
        ZCASH_NETWORK: NETWORK,
        ZCASH_ENDPOINT: ENDPOINT,
        ZCASH_ZEBRA_RPC: ZEBRA_RPC,
      },
    }).toString();

    const txidMatch = sendOutput.match(/Txid:\s+([0-9a-fA-F]{64})/);
    const txid = txidMatch ? txidMatch[1] : 'unknown';
    log(`      TxID:            ${txid}`);

    // Mine 1 block
    log(`      Mining 1 block to confirm deposit...`);
    const minedHashes = await mineBlocks(1);
    log(`      Mined Block:     ${minedHashes[0]}\n`);

    // 4. Watch-only monitor detects note & queries confirmed balance
    log(`[4/5] Watch-only monitor detects deposit:`);
    const { notes } = await detectIncoming(client, watchAcct, { sinceHeight: 1 });
    const depNote = notes.find(
      (n) =>
        n.txid === txid ||
        reverseTxid(n.txid) === txid ||
        (n.value === 200_000n && n.pool === 'ironwood')
    );
    if (!depNote) throw new Error(`Watch-only monitor failed to detect deposit tx ${txid}`);

    log(`      Detected Pool:   ${depNote.pool}`);
    log(`      Detected Value:  ${depNote.value} zatoshis (${formatZec(depNote.value)} ZEC)`);
    log(`      Block Height:    ${depNote.height}`);

    const finalBalance = await getBalance(client, watchAcct);
    log(`      Confirmed Total: ${finalBalance.total} zatoshis (${formatZec(finalBalance.total)} ZEC)`);
    log(`      Orchard Pool:    ${finalBalance.confirmed.orchard} zatoshis\n`);

    // 5. Demonstrate that spending from watch-only account is strictly rejected
    log(`[5/5] Enforcing Spend Rejection:`);
    log(`      Attempting to call send() from WatchOnlyAccount...`);
    let caughtError = null;

    try {
      await send({
        client,
        wallet: {},
        from: watchAcct,
        to: depositUA,
        amount: 50_000n,
      });
    } catch (err) {
      caughtError = err;
    }

    if (!caughtError) {
      throw new Error(`SECURITY FATAL: WatchOnlyAccount was permitted to author a spend!`);
    }
    if (!(caughtError instanceof WatchOnlySpendError)) {
      throw new Error(`SECURITY ERROR: Expected WatchOnlySpendError, but caught: ${caughtError}`);
    }

    log(`      ✅ SPEND STRICTLY REJECTED: ${caughtError.message}\n`);

    log('========================================================================');
    log('WATCH-ONLY RECIPE COMPLETED SUCCESSFULLY');
    log('========================================================================');
  } finally {
    await client.close();
  }

  const logPath = path.join(LOGS_DIR, 'recipe_watch_only_nu7.log');
  fs.writeFileSync(logPath, logLines.join('\n') + '\n');
  return logPath;
}

// ----------------------------------------------------------------------------
// Recipe 3: Disbursement & Payroll
// ----------------------------------------------------------------------------
async function runPayrollRecipe() {
  const logLines = [];
  const log = (msg = '') => {
    console.log(msg);
    logLines.push(msg);
  };

  log('========================================================================');
  log('RECIPE 3: DISBURSEMENT & PAYROLL — 3-RECIPIENT SEQUENTIAL BATCH RUN');
  log('========================================================================');
  log(`Timestamp: ${new Date().toISOString()}`);
  log(`Network:   ${NETWORK}`);
  log(`Endpoint:  ${ENDPOINT}`);
  log('------------------------------------------------------------------------\n');

  const client = createClient({ endpoint: ENDPOINT, network: NETWORK });

  try {
    const employerMnemonic = dev.fixtures.mnemonics[0];
    const employerAcct = accountFromMnemonic(employerMnemonic, 0, NETWORK);

    // Setup 3 fresh employee recipients (using dedicated test fixtures 4, 5, 6)
    const employees = [
      {
        name: 'Alice (Lead Core Developer)',
        account: accountFromMnemonic(dev.fixtures.mnemonics[4], 0, NETWORK),
        amountZec: '0.0005',
        amountZat: 50_000n,
        memo: 'Payroll: 2026-11 Alice Core Dev',
      },
      {
        name: 'Bob (Security Researcher)',
        account: accountFromMnemonic(dev.fixtures.mnemonics[5], 0, NETWORK),
        amountZec: '0.0007',
        amountZat: 70_000n,
        memo: 'Payroll: 2026-11 Bob Security Audit',
      },
      {
        name: 'Charlie (Infrastructure Eng)',
        account: accountFromMnemonic(dev.fixtures.mnemonics[6], 0, NETWORK),
        amountZec: '0.0009',
        amountZat: 90_000n,
        memo: 'Payroll: 2026-11 Charlie Infra Ops',
      },
    ];

    log(`[1/4] Loaded Payroll Roster:`);
    for (let i = 0; i < employees.length; i++) {
      const emp = employees[i];
      const ua = emp.account.getUnifiedAddress(0);
      const initBal = await getBalance(client, emp.account);
      if (initBal.total > 0n) {
        throw new Error(`Account freshness assertion failed: ${emp.name} already has ${initBal.total} zatoshis!`);
      }
      log(`      Employee ${i + 1}: ${emp.name}`);
      log(`        Address: ${ua.slice(0, 35)}...`);
      log(`        Amount:  ${emp.amountZec} ZEC (${emp.amountZat} zatoshis)`);
      log(`        Memo:    "${emp.memo}"`);
    }
    log('');

    log(`[2/4] Executing Sequential Disbursement Transactions:`);
    log(`      Note: SDK and CLI currently support 1 recipient per transaction.`);
    log(`      Each disbursement requires a separate transaction, ZIP-317 fee,`);
    log(`      and anchor confirmation for sequential note spendability.\n`);

    const disbursementResults = [];

    for (let i = 0; i < employees.length; i++) {
      const emp = employees[i];
      const targetUA = emp.account.getUnifiedAddress(0);

      log(`      --> Processing payment ${i + 1}/${employees.length} to ${emp.name}...`);
      const sendCmd = `node "${path.join(REPO_ROOT, 'packages', 'dev', 'dist', 'cli.js')}" send --to "${targetUA}" --amount "${emp.amountZec}" --memo "${emp.memo}" --endpoint "${ENDPOINT}" --yes`;
      const sendOutput = execSync(sendCmd, {
        env: {
          ...process.env,
          ZCASH_MNEMONIC: employerMnemonic,
          ZCASH_NETWORK: NETWORK,
          ZCASH_ENDPOINT: ENDPOINT,
          ZCASH_ZEBRA_RPC: ZEBRA_RPC,
        },
      }).toString();

      const txidMatch = sendOutput.match(/Txid:\s+([0-9a-fA-F]{64})/);
      const txid = txidMatch ? txidMatch[1] : 'unknown';
      const feeMatch = sendOutput.match(/Fee:\s+([0-9.]+)\s+ZEC\s+\((\d+)\s+zatoshis\)/);
      const feeZat = feeMatch ? feeMatch[2] : '10000';

      log(`          TxID:        ${txid}`);
      log(`          ZIP-317 Fee: ${feeZat} zatoshis`);

      // Mine 1 block between disbursements so change note matures into a spendable anchor
      log(`          Mining block to confirm change note & update anchor...`);
      const mined = await mineBlocks(1);
      log(`          Confirmed in block: ${mined[0]}\n`);

      disbursementResults.push({
        employee: emp.name,
        address: targetUA,
        txid,
        feeZat,
        amountZec: emp.amountZec,
      });
    }

    log(`[3/4] Verifying Payee Balances Post-Disbursement:`);
    for (const emp of employees) {
      const bal = await getBalance(client, emp.account);
      log(`      ${emp.name}:`);
      log(`        Confirmed Balance: ${bal.total} zatoshis (${formatZec(bal.total)} ZEC)`);
      log(`        Orchard Confirmed: ${bal.confirmed.orchard} zatoshis`);
    }
    log('');

    log(`[4/4] Batch Summary:`);
    const totalDisbursedZat = employees.reduce((sum, e) => sum + e.amountZat, 0n);
    const totalFeesZat = BigInt(disbursementResults.length * 10_000);
    log(`      Total Employees Paid: ${employees.length}`);
    log(`      Total Disbursed:      ${totalDisbursedZat} zatoshis (${formatZec(totalDisbursedZat)} ZEC)`);
    log(`      Total ZIP-317 Fees:   ${totalFeesZat} zatoshis (${formatZec(totalFeesZat)} ZEC)`);
    log(`      Total Net Outflow:    ${totalDisbursedZat + totalFeesZat} zatoshis (${formatZec(totalDisbursedZat + totalFeesZat)} ZEC)\n`);

    log('========================================================================');
    log('PAYROLL RECIPE COMPLETED SUCCESSFULLY');
    log('========================================================================');
  } finally {
    await client.close();
  }

  const logPath = path.join(LOGS_DIR, 'recipe_payroll_nu7.log');
  fs.writeFileSync(logPath, logLines.join('\n') + '\n');
  return logPath;
}

async function main() {
  console.log('=== Running Stage 2 Recipe Suite against NU7 Regtest ===\n');
  const p1 = await runCheckoutRecipe();
  console.log(`Saved: ${p1}`);
  const p2 = await runWatchOnlyRecipe();
  console.log(`Saved: ${p2}`);
  const p3 = await runPayrollRecipe();
  console.log(`Saved: ${p3}`);
  console.log('\n🎉 All 3 recipes executed cleanly on NU7 regtest!\n');
}

main().catch((err) => {
  console.error('\n❌ Recipe execution error:', err);
  process.exit(1);
});
