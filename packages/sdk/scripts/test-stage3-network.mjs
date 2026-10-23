import { createClient, detectIncoming, dev } from '../dist/index.js';

async function main() {
  console.log('=======================================================');
  console.log('=== STAGE S3: NETWORK BROADCAST & ON-CHAIN SPEND PROOF ===');
  console.log('=======================================================');

  const client = createClient({ endpoint: '127.0.0.1:28137', network: 'regtest' });
  const acct0 = dev.fixtures.account(0, 'regtest');
  const acct3 = dev.fixtures.account(3, 'regtest');
  const ufvk0 = acct0.getUnifiedFullViewingKey();
  const ufvk3 = acct3.getUnifiedFullViewingKey();

  const spentNfHex = '0a094e4307783c87445915b8869aca5e1ffaabb8510da765398904b5d377c00f';
  const expectedTxid = 'b2d523a82f648726e1bd4d225fda4a8af81addfb86db4277f6b485d811b7d73a';

  console.log('\n[1] Mining 1 block to confirm the mempool transaction...');
  await dev.mine(client, 1);

  const info = await client.getInfo();
  const targetHeight = parseInt(info.blockHeight, 10);
  console.log(`Mined block on chain. Waiting for Zaino to index height ${targetHeight}...`);

  for (let i = 0; i < 30; i++) {
    try {
      const stream = client.getBlockRange(targetHeight, targetHeight);
      let found = false;
      for await (const b of stream) {
        if (Number(b.height) === targetHeight) {
          found = true;
          break;
        }
      }
      if (found) break;
    } catch (e) {
      // Wait 1s and retry
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log(`Zaino fully indexed block ${targetHeight}!`);

  console.log('\n[2] Scanning chain with detectIncoming for Account 0 (recipient of 24.99 ZEC)...');
  const sync0 = await detectIncoming(client, ufvk0, targetHeight - 3, targetHeight);
  console.log(`Found ${sync0.notes.length} note(s) for Account 0 at height ${targetHeight}:`);
  const receivedNote = sync0.notes.find((n) => n.txid === expectedTxid);
  if (receivedNote) {
    console.log('SUCCESS: Newly created output note detected on-chain!');
    console.log({
      pool: receivedNote.pool,
      valueZatoshis: receivedNote.value.toString(),
      txid: receivedNote.txid,
      height: receivedNote.height,
      treePosition: receivedNote.treePosition,
      cmx: receivedNote.cmx,
      rho: receivedNote.rho,
      rseed: receivedNote.rseed,
      nullifier: receivedNote.nullifier,
    });
  } else {
    console.error('FAILED: Output note not detected for Account 0');
    process.exit(1);
  }

  console.log('\n[3] Checking for spent nullifier in on-chain block...');
  console.log(`Expected spent nullifier: ${spentNfHex}`);
  console.log(`Spent nullifiers detected in scanned range:`, Array.from(sync0.spentNullifiers));
  const nfFound = sync0.spentNullifiers.has(spentNfHex);
  if (nfFound) {
    console.log(`SUCCESS: Spent nullifier ${spentNfHex} confirmed on-chain!`);
  } else {
    console.error(`FAILED: Spent nullifier ${spentNfHex} not found in spentNullifiers`);
    process.exit(1);
  }

  console.log('\nSTAGE S3 RESULT: SUCCESS (V6 transaction mined on regtest, output note detected, spent nullifier verified on-chain)');
  await client.close();
}

main().catch((err) => {
  console.error('STAGE S3 ERROR:', err);
  process.exit(1);
});
