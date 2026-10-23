import { createClient, getBalance, detectIncoming, dev } from '../dist/index.js';

async function main() {
  const client = createClient({ endpoint: '127.0.0.1:28137', network: 'regtest' });
  const acct0 = dev.fixtures.account(0, 'regtest');
  const acct2 = dev.fixtures.account(2, 'regtest');

  const ua0 = acct0.getUnifiedAddress();
  const ua2 = acct2.getUnifiedAddress();

  console.log('================================================================');
  console.log('=== STEP 1: BEFORE SEND (STANDALONE SDK SCRIPT OUTSIDE UI) ===');
  console.log('================================================================');
  console.log('Account #0 UA:', ua0);
  console.log('Account #2 UA:', ua2);

  const bal0Before = await getBalance(client, acct0);
  const det0Before = await detectIncoming(client, acct0);
  console.log('\nAccount #0 BEFORE:');
  console.log('  Total Balance:', bal0Before.total.toString(), 'zatoshis (', Number(bal0Before.total) / 1e8, 'ZEC )');
  console.log('  Confirmed:', bal0Before.confirmed.total.toString(), '| Pending:', bal0Before.pending.total.toString());
  console.log('  Detected Notes count:', det0Before.notes.length);
  for (const n of det0Before.notes) {
    console.log(`    Note @ height #${n.height}: ${n.value} zatoshis | txid: ${n.txid.slice(0, 20)}...`);
  }

  const bal2Before = await getBalance(client, acct2);
  const det2Before = await detectIncoming(client, acct2);
  console.log('\nAccount #2 BEFORE:');
  console.log('  Total Balance:', bal2Before.total.toString(), 'zatoshis (', Number(bal2Before.total) / 1e8, 'ZEC )');
  console.log('  Confirmed:', bal2Before.confirmed.total.toString(), '| Pending:', bal2Before.pending.total.toString());
  console.log('  Detected Notes count:', det2Before.notes.length);
  for (const n of det2Before.notes) {
    console.log(`    Note @ height #${n.height}: ${n.value} zatoshis | txid: ${n.txid.slice(0, 20)}...`);
  }

  console.log('\n================================================================');
  console.log('=== STEP 2: EXECUTING SEND (0.15 ZEC = 15,000,000 zatoshis to Acct 2) ===');
  console.log('================================================================');
  const sendAmount = 15000000n;
  const sendRes = await dev.fund(client, ua2, sendAmount);
  console.log('Send completed:');
  console.log('  Txid:', sendRes.txid);
  console.log('  Reported Fee:', sendRes.fee.toString(), 'zatoshis');

  console.log('\n================================================================');
  console.log('=== STEP 3: AFTER SEND (STANDALONE SDK SCRIPT OUTSIDE UI) ===');
  console.log('================================================================');
  await new Promise((r) => setTimeout(r, 2000));
  const bal0After = await getBalance(client, acct0);
  const det0After = await detectIncoming(client, acct0);
  console.log('\nAccount #0 AFTER:');
  console.log('  Total Balance:', bal0After.total.toString(), 'zatoshis (', Number(bal0After.total) / 1e8, 'ZEC )');
  console.log('  Confirmed:', bal0After.confirmed.total.toString(), '| Pending:', bal0After.pending.total.toString());
  console.log('  Detected Notes count:', det0After.notes.length);

  const bal2After = await getBalance(client, acct2);
  const det2After = await detectIncoming(client, acct2);
  console.log('\nAccount #2 AFTER:');
  console.log('  Total Balance:', bal2After.total.toString(), 'zatoshis (', Number(bal2After.total) / 1e8, 'ZEC )');
  console.log('  Confirmed:', bal2After.confirmed.total.toString(), '| Pending:', bal2After.pending.total.toString());
  console.log('  Detected Notes count:', det2After.notes.length);
  for (const n of det2After.notes) {
    console.log(`    Note @ height #${n.height}: ${n.value} zatoshis | txid: ${n.txid.slice(0, 20)}...`);
  }

  console.log('\n================================================================');
  console.log('=== OBSERVATION ON BALANCES ===');
  console.log('================================================================');
  console.log('Account #0 balance diff:', (bal0After.total - bal0Before.total).toString(), 'zatoshis');
  console.log('Account #2 balance diff:', (bal2After.total - bal2Before.total).toString(), 'zatoshis (+0.15 ZEC)');

  await client.close();
}

main().catch(console.error);
