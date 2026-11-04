/**
 * Watch-Only Wallet Monitor Example
 *
 * Demonstrates:
 * 1. Initializing a zero-custody watch-only account using a Unified Full Viewing Key (accountFromUfvk).
 * 2. Deriving valid Unified Addresses for receiving deposits.
 * 3. Detecting incoming transactions and querying pool balances without access to spending keys.
 * 4. Demonstrating that transaction creation/sending from a watch-only account is strictly rejected.
 */

import {
  createClient,
  accountFromUfvk,
  detectIncoming,
  getBalance,
  send,
} from '@zcash-app/sdk';

const ENDPOINT = process.env.ZCASH_ENDPOINT || '127.0.0.1:39067';
const NETWORK = process.env.ZCASH_NETWORK || 'regtest';

export async function runWatchOnlyMonitor(ufvk) {
  console.log('=== Watch-Only Monitor Service ===\n');

  if (!ufvk || !ufvk.startsWith('uview')) {
    throw new Error('Valid Unified Full Viewing Key (starting with "uview") is required');
  }

  // 1. Initialize watch-only account (zero custody: no spend keys)
  const account = accountFromUfvk(ufvk, NETWORK);
  const client = createClient({ endpoint: ENDPOINT, network: NETWORK });

  console.log(`Connecting to:          ${ENDPOINT} (${NETWORK})`);
  console.log(`UFVK:                   ${ufvk.slice(0, 30)}...`);
  console.log(`Deposit Address (UA):   ${account.getUnifiedAddress(0)}\n`);

  try {
    // 2. Query chain status & balance
    const info = await client.getInfo();
    console.log(`Chain Tip Height:       ${info.blockHeight}`);

    const balance = await getBalance(client, account);
    console.log(`Confirmed Balance:      ${balance.total} zatoshis`);
    console.log(`  - Transparent:        ${balance.confirmed.transparent} zatoshis`);
    console.log(`  - Sapling:            ${balance.confirmed.sapling} zatoshis`);
    console.log(`  - Orchard:            ${balance.confirmed.orchard} zatoshis`);
    console.log(`  - Ironwood:           ${balance.confirmed.ironwood} zatoshis\n`);

    // 3. Scan for incoming notes
    const { notes } = await detectIncoming(client, account);
    console.log(`Incoming Notes Found:   ${notes.length}`);
    for (const note of notes) {
      console.log(`  • Note: ${note.value} zatoshis in pool "${note.pool}" at height ${note.height}`);
      console.log(`    TxID: ${note.txid}`);
    }

    // 4. Attempt to send from a watch-only account (MUST FAIL)
    console.log('\n--- Verifying Spend Protection ---');
    console.log('Attempting to execute send() from watch-only account...');
    try {
      await send({
        client,
        wallet: {},
        from: account,
        to: account.getUnifiedAddress(1),
        amount: 10_000n,
      });
      console.error('❌ SECURITY FAILURE: send() succeeded on a watch-only account!');
      process.exit(1);
    } catch (spendErr) {
      console.log(`✅ SPEND REJECTED AS EXPECTED: ${spendErr.message || spendErr}`);
    }
  } finally {
    await client.close();
  }
}

if (process.argv[1] && process.argv[1].endsWith('monitor.mjs')) {
  const sampleUfvk =
    process.env.ZCASH_UFVK ||
    // Standard test fixture UFVK for account 0 on regtest
    'uviewregtest1z6ssj73q32w934f59x2j4wh709d7q5u8w03rwnr50rvt5dly78f7wsq0x26k5w39d375z328n797v902vqqq530q8huvs0s2v032u6q7q832';
  runWatchOnlyMonitor(sampleUfvk).catch(console.error);
}
