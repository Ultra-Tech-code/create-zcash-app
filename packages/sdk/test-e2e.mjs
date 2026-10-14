import { createClient, accountFromMnemonic, dev, buildPaymentRequest, parsePaymentRequest } from './dist/index.js';

async function main() {
  console.log('--- Testing @zcash-app/sdk ---');

  // 1. Client setup & GetInfo
  const client = createClient({
    endpoint: '127.0.0.1:8137',
    network: 'regtest',
  });

  try {
    const info = await client.getInfo();
    console.log('✅ Zaino connected successfully!');
    console.log(`- Vendor: ${info.vendor} v${info.version}`);
    console.log(`- Upgrade: ${info.upgradeName}`);
    console.log(`- Block Height: ${info.blockHeight}`);
    console.log(`- Branch ID: ${info.consensusBranchId}`);

    // 2. Key derivation
    const fixtureAcct = dev.fixtures.account(0, 'regtest');
    const ua = fixtureAcct.getUnifiedAddress();
    const ufvk = fixtureAcct.getUnifiedFullViewingKey();
    console.log('\n✅ Derived fixture account:');
    console.log(`- Unified Address: ${ua}`);
    console.log(`- UFVK: ${ufvk.slice(0, 30)}...`);

    // 3. ZIP-321 Payment Request
    const uri = buildPaymentRequest({
      to: ua,
      value: 250000000n, // 2.5 ZEC
      memo: 'Coffee payment',
      label: 'Espresso Bar',
    });
    console.log('\n✅ Built ZIP-321 URI:');
    console.log(uri);

    const parsed = parsePaymentRequest(uri);
    console.log('Parsed URI:', parsed);
    if (parsed.value === 250000000n && parsed.memo === 'Coffee payment') {
      console.log('✅ ZIP-321 round-trip verification passed!');
    }

    await client.close();
    console.log('\n🎉 SDK test script completed cleanly!');
  } catch (err) {
    console.error('❌ Error during SDK test:', err);
    process.exit(1);
  }
}

main();
