import { createClient, getBalance, dev } from '../dist/index.js';

async function testItem4() {
  const client = createClient({ endpoint: '127.0.0.1:28137', network: 'regtest' });
  const acct = dev.fixtures.account(3, 'regtest');
  const info = await client.getInfo();
  console.log('=== ITEM 4: getBalance minConf & CONFIRMED/PENDING SPLIT ===');
  console.log('Current block height:', info.blockHeight);

  // 1. Check with default minConf (minConf = 1)
  const balDefault = await getBalance(client, acct);
  console.log('\n[1] getBalance with default minConf (1):');
  console.log('Total confirmed (zatoshis):', balDefault.confirmed.total.toString());
  console.log('Confirmed breakdown:', {
    ironwood: balDefault.confirmed.ironwood.toString(),
    orchard: balDefault.confirmed.orchard.toString(),
    transparent: balDefault.confirmed.transparent.toString(),
  });
  console.log('Pending breakdown:', {
    ironwood: balDefault.pending.ironwood.toString(),
    orchard: balDefault.pending.orchard.toString(),
    transparent: balDefault.pending.transparent.toString(),
  });

  // 2. Check with a high minConf (e.g. minConf = 10)
  // Notes mined recently (heights 215, 216, etc.) will have fewer confirmations and shift to pending!
  const balHighConf = await getBalance(client, acct, { minConf: 10 });
  console.log('\n[2] getBalance with minConf = 10:');
  console.log('Confirmed total:', balHighConf.confirmed.total.toString());
  console.log('Pending total:', balHighConf.pending.total.toString());
  console.log('Pending breakdown:', {
    ironwood: balHighConf.pending.ironwood.toString(),
    orchard: balHighConf.pending.orchard.toString(),
    transparent: balHighConf.pending.transparent.toString(),
  });

  await client.close();
}

testItem4().catch(console.error);
