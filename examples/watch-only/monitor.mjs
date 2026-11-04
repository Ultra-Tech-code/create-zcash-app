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
  WatchOnlySpendError,
} from '@zcash-app/sdk';

const ENDPOINT = process.env.ZCASH_ENDPOINT || '127.0.0.1:39067';
const rawNetwork = process.env.ZCASH_NETWORK || 'regtest';
const isNu7 = rawNetwork === 'regtest-nu7' || ENDPOINT.includes('39067');
const NETWORK = isNu7 ? 'regtest-nu7' : rawNetwork;

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
      if (spendErr instanceof WatchOnlySpendError) {
        console.log(`✅ SPEND REJECTED AS EXPECTED (WatchOnlySpendError): ${spendErr.message}`);
      } else {
        throw new Error(`Expected WatchOnlySpendError, got: ${spendErr}`);
      }
    }
  } finally {
    await client.close();
  }
}

if (process.argv[1] && process.argv[1].endsWith('monitor.mjs')) {
  const sampleUfvk =
    process.env.ZCASH_UFVK ||
    // Standard test fixture UFVK for account 2 on regtest
    'uviewregtest1wc0v5cry88thqcarv52wll3a3kape7g3y4n3z938ul89jlnmclly56cttcg6cdat62m4nhcwn6vdsyf3g3ljkkd8fffk323l0qcy9ug8fsfxhexu737hckrvw6xgrz7dtepexaye25qdw02wys0l9h8kpes6wtge7ha6gu2c4jz75a4hrtzzt2ydympf2jjdg6hea687d2upfwf8ld6vdd46pxcylypkd8pdl3wt2jz4s0gjfu0swvzlzqm09nrjwj3uuf97yyvlrpx44stwlp6d9ak6sydqvyfp49a86khgzugrqkfm0l4qam995v56wt8c5k5pjlt947mazufsrkanv9y5atnh5tfh52nq30kjac97e6r2rcx25q8pl4p4uprqt60u3j2kedzev3acdr7ha5tg6gaejsjpmrtutyhstc7ssppwxga7cqd2r2fmlzp52ysaky97xznl23xtv36w2g3am9k42xy69qw3xz4pw6mussp6sg3l';
  runWatchOnlyMonitor(sampleUfvk).catch(console.error);
}
