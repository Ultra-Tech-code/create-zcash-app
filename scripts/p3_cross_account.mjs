import { createClient, accountFromMnemonic, KNOWN_TEST_MNEMONICS, dev, syncWallet, send, quoteFee } from '../packages/sdk/dist/index.js';
import { WalletHandle } from '../packages/core/index.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

async function main() {
  console.log('===============================================================');
  console.log('=== PHASE 3 (P3): CROSS-ACCOUNT PAYMENT VIA SDK send() ONLY ===');
  console.log('===============================================================\n');

  const endpoint = process.env.ZCASH_ENDPOINT || '127.0.0.1:28137';
  const client = createClient({ endpoint, network: 'regtest' });

  // 1. Account Setup
  const acct0 = accountFromMnemonic(KNOWN_TEST_MNEMONICS[0], 0, 'regtest');
  const acct1 = accountFromMnemonic(KNOWN_TEST_MNEMONICS[1], 0, 'regtest');

  const addr0 = acct0.getUnifiedAddress();
  const addr1 = acct1.getUnifiedAddress();
  const ufvk0 = acct0.getUnifiedFullViewingKey();
  const ufvk1 = acct1.getUnifiedFullViewingKey();

  console.log('Sender (Account 0):');
  console.log(`  Address: ${addr0}`);
  console.log(`  Spend Handle: ${acct0.spendHandle}\n`);

  console.log('Recipient (Account 1):');
  console.log(`  Address: ${addr1}\n`);

  // Open temporary wallet databases for both accounts
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zcash-p3-wallets-'));
  const db0Path = path.join(tmpDir, 'wallet0.db');
  const db1Path = path.join(tmpDir, 'wallet1.db');

  const wallet0 = WalletHandle.open(db0Path, 'regtest', ufvk0, 'acct0');
  const wallet1 = WalletHandle.open(db1Path, 'regtest', ufvk1, 'acct1');

  // 2. Initial Sync to obtain baseline state & balances
  console.log('--- Step 1: Baseline Sync & Balances ---');
  await syncWallet(client, wallet0);
  await syncWallet(client, wallet1);

  const beforeSummary0 = wallet0.getWalletSummary();
  const beforeSummary1 = wallet1.getWalletSummary();

  console.log(`Account 0 Baseline:`);
  console.log(`  Total Balance:     ${beforeSummary0.totalBalanceZatoshis} zatoshis (${beforeSummary0.totalBalanceZatoshis / 1e8} ZEC)`);
  console.log(`  Confirmed Balance: ${beforeSummary0.spendableBalanceZatoshis} zatoshis`);
  console.log(`  Pending Balance:   ${beforeSummary0.totalBalanceZatoshis - beforeSummary0.spendableBalanceZatoshis} zatoshis`);
  console.log(`  Unspent Notes:     ${beforeSummary0.unspentNotesCount}`);

  console.log(`Account 1 Baseline:`);
  console.log(`  Total Balance:     ${beforeSummary1.totalBalanceZatoshis} zatoshis (${beforeSummary1.totalBalanceZatoshis / 1e8} ZEC)`);
  console.log(`  Confirmed Balance: ${beforeSummary1.spendableBalanceZatoshis} zatoshis`);
  console.log(`  Pending Balance:   ${beforeSummary1.totalBalanceZatoshis - beforeSummary1.spendableBalanceZatoshis} zatoshis`);
  console.log(`  Unspent Notes:     ${beforeSummary1.unspentNotesCount}\n`);

  const transferAmount = 150_000_000n; // 1.5 ZEC
  const expectedFee = quoteFee(2);      // 10,000 zatoshis (0.0001 ZEC, ZIP 317 standard)

  if (BigInt(beforeSummary0.spendableBalanceZatoshis) < transferAmount + expectedFee) {
    throw new Error(`Account 0 has insufficient funds for P3 payment: ${beforeSummary0.spendableBalanceZatoshis}`);
  }

  // 3. Prepare Payment Request: 1.5 ZEC (150,000,000 zatoshis)
  const paymentMemo = 'P3 Cross-Account Payment: Account 0 -> Account 1 (1.5 ZEC)';

  console.log('--- Step 2: Transaction Parameters ---');
  console.log(`  Transfer Amount: ${transferAmount} zatoshis (1.5 ZEC)`);
  console.log(`  Recipient:       ${addr1}`);
  console.log(`  Memo:            "${paymentMemo}"`);
  console.log(`  Quoted Fee:      ${expectedFee} zatoshis (0.0001 ZEC, ZIP 317 standard)\n`);

  // 4. Execute Payment strictly via SDK send()
  console.log('--- Step 3: Executing SDK send() ---');
  const startTime = Date.now();
  const sendResult = await send({
    client,
    wallet: wallet0,
    from: acct0,
    to: addr1,
    amount: transferAmount,
    memo: paymentMemo,
  });
  const durationMs = Date.now() - startTime;

  const displayTxid = Buffer.from(sendResult.txid, 'hex').reverse().toString('hex');

  console.log('Transaction built, proven, and broadcast successfully!');
  console.log(`  Broadcast TxID (node display order): ${displayTxid}`);
  console.log(`  Internal TxID (raw byte order):      ${sendResult.txid}`);
  console.log(`  Fee:           ${sendResult.fee} zatoshis`);
  console.log(`  Num Actions:   ${sendResult.numActions}`);
  console.log(`  Expiry Height: ${sendResult.expiryHeight}`);
  console.log(`  Raw Tx Size:   ${sendResult.rawBytes.length} bytes`);
  console.log(`  Proving & Send Duration: ${durationMs}ms\n`);

  if (sendResult.fee !== expectedFee) {
    throw new Error(`Fee mismatch: expected ${expectedFee}, got ${sendResult.fee}`);
  }

  // 5. Verify In-Flight State (note reserved/broadcast, excluded from spendable)
  console.log('--- Step 4: Verify In-Flight Balance & Reservation Exclusion ---');
  const inFlightSummary0 = wallet0.getWalletSummary();
  console.log(`Account 0 In-Flight Spendable Balance: ${inFlightSummary0.spendableBalanceZatoshis} zatoshis (strictly excluded while in flight)`);
  if (inFlightSummary0.spendableBalanceZatoshis !== 0) {
    throw new Error(`In-flight reservation did not exclude spent note! Spendable: ${inFlightSummary0.spendableBalanceZatoshis}`);
  }

  // 6. Mine 1 Block on Regtest
  console.log('\n--- Step 5: Mining 1 Block to Confirm Transaction ---');
  const infoBeforeMine = await client.getInfo();
  const heightBeforeMine = Number(infoBeforeMine.blockHeight);
  console.log(`Current chain tip before mining: height ${heightBeforeMine}`);

  await dev.mine(client, 1);
  const targetTip = heightBeforeMine + 1;
  console.log(`Mining command sent. Target tip height: ${targetTip}`);

  // Wait for Zaino indexer to advance its best block height and index the block
  console.log('Waiting for Zaino indexer to index mined block...');
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const info = await client.getInfo();
      const currentTip = Number(info.blockHeight);
      if (currentTip >= targetTip) {
        let accessible = false;
        for await (const _ of client.getRawBlockRange(targetTip, targetTip)) {
          accessible = true;
        }
        if (accessible) {
          console.log(`Zaino indexer synchronized at height ${currentTip}!`);
          break;
        }
      }
    } catch (_) {}
  }

  // 7. Query Transaction Details from Zebra Node via JSON-RPC
  console.log('\n--- Step 6: Querying Mined Transaction via JSON-RPC getrawtransaction ---');
  console.log(`Querying broadcast txid: ${displayTxid}`);

  let rpcData;
  for (let i = 0; i < 10; i++) {
    const rpcRes = await fetch('http://127.0.0.1:8181', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + Buffer.from('zebra:zebra').toString('base64'),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'p3-tx-query',
        method: 'getrawtransaction',
        params: [displayTxid, 1],
      }),
    });
    rpcData = await rpcRes.json();
    if (!rpcData.error) break;
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (rpcData && !rpcData.error && rpcData.result) {
    const txInfo = rpcData.result;
    console.log(`  Mined TxID (node):   ${txInfo.txid || displayTxid}`);
    console.log(`  Zebra confirmations: ${txInfo.confirmations}`);
    console.log(`  Zebra blockhash:     ${txInfo.blockhash}`);
    console.log(`  Zebra blockheight:   ${txInfo.height || targetTip}`);
    console.log(`  Zebra tx version:    ${txInfo.version}`);
    console.log(`  Zebra Ironwood actions count: ${txInfo.ironwood?.actions?.length}`);
    console.log(`  Zebra Ironwood valueBalanceZat: ${txInfo.ironwood?.valueBalanceZat} zatoshis`);
    console.log(`  Zebra Ironwood flags: ${JSON.stringify(txInfo.ironwood?.flags)}`);
    console.log(`  Zebra Ironwood anchor: ${txInfo.ironwood?.anchor}`);
  } else {
    console.warn(`RPC result: ${JSON.stringify(rpcData)}`);
  }

  // 8. Resync Wallets Post-Mining
  console.log('\n--- Step 7: Resyncing Both Accounts Post-Mining ---');
  await syncWallet(client, wallet0);
  await syncWallet(client, wallet1);

  const afterSummary0 = wallet0.getWalletSummary();
  const afterSummary1 = wallet1.getWalletSummary();

  console.log(`Account 0 Post-Payment:`);
  console.log(`  Total Balance:     ${afterSummary0.totalBalanceZatoshis} zatoshis (${afterSummary0.totalBalanceZatoshis / 1e8} ZEC)`);
  console.log(`  Confirmed Balance: ${afterSummary0.spendableBalanceZatoshis} zatoshis`);
  console.log(`  Pending Balance:   ${afterSummary0.totalBalanceZatoshis - afterSummary0.spendableBalanceZatoshis} zatoshis`);
  console.log(`  Unspent Notes:     ${afterSummary0.unspentNotesCount}`);

  console.log(`Account 1 Post-Payment:`);
  console.log(`  Total Balance:     ${afterSummary1.totalBalanceZatoshis} zatoshis (${afterSummary1.totalBalanceZatoshis / 1e8} ZEC)`);
  console.log(`  Confirmed Balance: ${afterSummary1.spendableBalanceZatoshis} zatoshis`);
  console.log(`  Pending Balance:   ${afterSummary1.totalBalanceZatoshis - afterSummary1.spendableBalanceZatoshis} zatoshis`);
  console.log(`  Unspent Notes:     ${afterSummary1.unspentNotesCount}\n`);

  // 9. Exact Balance and Conservation Verification
  console.log('--- Step 8: Mathematical Verification & Balance Invariants ---');
  const expectedAcct0After = beforeSummary0.totalBalanceZatoshis - Number(transferAmount) - Number(expectedFee);
  const expectedAcct1After = beforeSummary1.totalBalanceZatoshis + Number(transferAmount);
  const totalBefore = beforeSummary0.totalBalanceZatoshis + beforeSummary1.totalBalanceZatoshis;
  const totalAfter = afterSummary0.totalBalanceZatoshis + afterSummary1.totalBalanceZatoshis;

  console.log(`  Arithmetic Verification:`);
  console.log(`    A0_before - amount - fee == A0_after: ${beforeSummary0.totalBalanceZatoshis} - ${transferAmount} - ${expectedFee} = ${expectedAcct0After} (Actual: ${afterSummary0.totalBalanceZatoshis}) -> ${afterSummary0.totalBalanceZatoshis === expectedAcct0After ? 'VALID ✅' : 'INVALID ❌'}`);
  console.log(`    A1_before + amount       == A1_after: ${beforeSummary1.totalBalanceZatoshis} + ${transferAmount} = ${expectedAcct1After} (Actual: ${afterSummary1.totalBalanceZatoshis}) -> ${afterSummary1.totalBalanceZatoshis === expectedAcct1After ? 'VALID ✅' : 'INVALID ❌'}`);
  console.log(`  Account 0 Expected: ${expectedAcct0After} | Actual: ${afterSummary0.totalBalanceZatoshis} -> ${afterSummary0.totalBalanceZatoshis === expectedAcct0After ? 'MATCH ✅' : 'MISMATCH ❌'}`);
  console.log(`  Account 1 Expected: ${expectedAcct1After} | Actual: ${afterSummary1.totalBalanceZatoshis} -> ${afterSummary1.totalBalanceZatoshis === expectedAcct1After ? 'MATCH ✅' : 'MISMATCH ❌'}`);
  console.log(`  Fee Paid:           ${sendResult.fee} zatoshis`);
  console.log(`  Conservation:       ${afterSummary0.totalBalanceZatoshis} + ${afterSummary1.totalBalanceZatoshis} + ${sendResult.fee} = ${totalAfter + Number(sendResult.fee)} zatoshis (Initial: ${totalBefore} zatoshis) -> ${totalAfter + Number(sendResult.fee) === totalBefore ? 'CONSERVED ✅' : 'VIOLATION ❌'}`);

  if (afterSummary0.totalBalanceZatoshis !== expectedAcct0After) {
    throw new Error(`Account 0 balance mismatch: expected ${expectedAcct0After}, got ${afterSummary0.totalBalanceZatoshis}`);
  }
  if (afterSummary1.totalBalanceZatoshis !== expectedAcct1After) {
    throw new Error(`Account 1 balance mismatch: expected ${expectedAcct1After}, got ${afterSummary1.totalBalanceZatoshis}`);
  }

  // Cleanup temp files
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (_) {}

  await client.close();

  console.log('\n===============================================================');
  console.log('=== PHASE 3 (P3) VERIFICATION COMPLETE: ALL CHECKS PASSED!  ===');
  console.log('===============================================================');
}

main().catch((err) => {
  console.error('P3 Execution Error:', err);
  process.exit(1);
});
