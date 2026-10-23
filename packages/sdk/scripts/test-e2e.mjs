import { createClient, accountFromMnemonic, dev, buildPaymentRequest, parsePaymentRequest } from '../dist/index.js';

async function main() {
  console.log('--- Testing @zcash-app/sdk ---');

  // 1. Client setup & GetInfo
  const client = createClient({
    endpoint: '127.0.0.1:28137',
    network: 'regtest',
  });

  try {
    const info = await client.getInfo();
    console.log('✅ Zaino connected successfully!');
    console.log(`- Vendor: ${info.vendor} v${info.version}`);
    console.log(`- Upgrade: ${info.upgradeName}`);
    console.log(`- Block Height: ${info.blockHeight}`);
    console.log(`- Branch ID: ${info.consensusBranchId}`);
    console.log(`- Upgrade Height: ${info.upgradeHeight}`);

    // Regtest assertions: must be regtest, branch 37a5165b, upgrade height 2, block height under 1000
    const branchId = (info.consensusBranchId || '').toLowerCase();
    const upgradeHeight = Number(info.upgradeHeight);
    const blockHeight = Number(info.blockHeight);

    if (branchId !== '37a5165b') {
      console.error(`❌ Chain assertion failed: expected consensusBranchId '37a5165b', got '${info.consensusBranchId}'`);
      process.exit(1);
    }
    if (upgradeHeight !== 2) {
      console.error(`❌ Chain assertion failed: expected upgradeHeight 2, got '${info.upgradeHeight}'`);
      process.exit(1);
    }
    if (isNaN(blockHeight) || blockHeight >= 1000) {
      console.error(`❌ Chain assertion failed: expected blockHeight < 1000 for regtest, got '${info.blockHeight}'`);
      process.exit(1);
    }
    console.log('✅ Chain verified: regtest (branch 37a5165b, upgrade height 2, block height < 1000)');

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
