import { createClient, watch, dev } from '../dist/index.js';

async function main() {
  const client = createClient({ endpoint: '127.0.0.1:28137', network: 'regtest' });
  const acct0 = dev.fixtures.account(0, 'regtest');
  const acct3 = dev.fixtures.account(3, 'regtest');
  const acct0Ua = acct0.getUnifiedAddress();
  const targetUa = acct3.getUnifiedAddress();
  const ufvk = acct3.getUnifiedFullViewingKey();

  console.log('--- Proving watch() live on fixture account 3 ---');
  console.log(`Account 0 UA (${acct0Ua.length} chars): ${acct0Ua}`);
  console.log(`Account 3 UA (${targetUa.length} chars): ${targetUa}`);

  const receivedNotes = [];
  let callbackCount = 0;

  console.log('\n[1] Starting watch (poll interval 1000ms)...');
  const stopWatch = watch(client, ufvk, (note) => {
    callbackCount++;
    console.log(`onNote event #${callbackCount}:`, {
      pool: note.pool,
      value: note.value.toString(),
      txid: note.txid,
      height: note.height,
    });
    receivedNotes.push(note);
  }, { pollMs: 1000 });

  // Allow initial poll to establish chain tip
  await new Promise((r) => setTimeout(r, 1500));

  console.log('\n[2] Sending Payment 1: 0.25 ZEC (25,000,000 zatoshis)...');
  const fund1 = await dev.fund(client, targetUa, 25000000n);
  console.log('Payment 1 confirmed in block. Txid:', fund1.txid);
  await new Promise((r) => setTimeout(r, 2500));

  console.log('\n[3] Sending Payment 2: 0.35 ZEC (35,000,000 zatoshis)...');
  const fund2 = await dev.fund(client, targetUa, 35000000n);
  console.log('Payment 2 confirmed in block. Txid:', fund2.txid);
  await new Promise((r) => setTimeout(r, 2500));

  console.log(`\n[4] Total onNote callbacks during active watch: ${callbackCount}`);
  if (callbackCount === 2) {
    console.log('PASS: Exactly 2 payments triggered exactly 2 onNote callbacks.');
  } else {
    console.error(`FAIL: Callback count mismatch. Expected 2, got ${callbackCount}`);
    process.exit(1);
  }

  console.log('\n[5] Stopping watch()...');
  stopWatch();
  console.log('Watch stopped.');

  console.log('\n[6] Sending Payment 3: 0.45 ZEC (45,000,000 zatoshis) while watch is STOPPED...');
  const fund3 = await dev.fund(client, targetUa, 45000000n);
  console.log('Payment 3 confirmed in block. Txid:', fund3.txid);
  await new Promise((r) => setTimeout(r, 3000));

  const callbacksAfterStop = callbackCount - 2;
  console.log(`\n[7] Callbacks received after stopping watch: ${callbacksAfterStop}`);
  if (callbacksAfterStop === 0) {
    console.log('PASS: Confirmed 0 callbacks received after stopWatch() called.');
  } else {
    console.error('FAIL: Error: received callbacks after watch stopped!');
    process.exit(1);
  }

  await client.close();
  console.log('\nwatch() verification test passed completely!');
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
