import { createClient, dev } from '../dist/index.js';

async function testItem1() {
  const client = createClient({ endpoint: '127.0.0.1:28137', network: 'regtest' });
  const acct = dev.fixtures.account(3, 'regtest');
  const targetUa = acct.getUnifiedAddress();

  console.log('=== ITEM 1: dev.fund EXACT DECIMAL & REAL FEE VERIFICATION ===');
  console.log('Target UA:', targetUa);

  // Test with an exact zatoshis amount that would suffer from float inaccuracy if converted via Number:
  // e.g. 12345678 zatoshis = 0.12345678 ZEC
  const testZatoshis = 12345678n;
  console.log('Sending test amount (zatoshis):', testZatoshis.toString());

  const result = await dev.fund(client, targetUa, testZatoshis);

  console.log('\ndev.fund returned result:');
  console.log('txid:', result.txid);
  console.log('fee (zatoshis):', result.fee.toString());
  console.log('fee (type):', typeof result.fee);

  // Also query z_viewtransaction directly to display raw Zallet output
  const viewRes = await fetch('http://127.0.0.1:8181', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Basic ' + Buffer.from('zebra:zebra').toString('base64'),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'verify-viewtx',
      method: 'z_viewtransaction',
      params: [result.txid],
    }),
  });
  const rawView = await viewRes.json();
  console.log('\nRaw Zallet z_viewtransaction response:');
  console.log(JSON.stringify(rawView, null, 2));

  await client.close();
}

testItem1().catch(console.error);
