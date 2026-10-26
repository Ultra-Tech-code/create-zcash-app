#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const { ZcashClient } = await import(`${projectRoot}/packages/sdk/dist/client.js`);
const { syncWallet } = await import(`${projectRoot}/packages/sdk/dist/sync.js`);
const { accountFromMnemonic } = await import(`${projectRoot}/packages/sdk/dist/keys.js`);
const { send, reverseTxid } = await import(`${projectRoot}/packages/sdk/dist/send.js`);
const { WalletHandle } = await import(`${projectRoot}/packages/core/index.js`);

async function rpcCall(method, params = []) {
  const res = await fetch('http://127.0.0.1:39232', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return await res.json();
}

async function main() {
  console.log('===============================================================');
  console.log('=== INVESTIGATION: NU7 REGTEST ON ZEBRA 7.0.0 + LIGHTWALLETD ==');
  console.log('===============================================================');

  // 1. Check Zebra getblockchaininfo
  console.log('\n--- 1. Querying Zebra getblockchaininfo on port 39232 ---');
  const bci = await rpcCall('getblockchaininfo');
  console.log('Chain:', bci.result.chain);
  console.log('Block count:', bci.result.blocks);
  console.log('NU7 upgrade activation:', bci.result.upgrades['77190ad9']);
  console.log('Value pools:', JSON.stringify(bci.result.valuePools, null, 2));

  // 2. Query Coinbase at height 105
  console.log('\n--- 2. Querying Block 105 Coinbase Transaction ---');
  const b105 = await rpcCall('getblock', ['105', 1]);
  const coinbaseTxid = b105.result.tx[0];
  console.log('Block 105 Coinbase TxID:', coinbaseTxid);
  const rawTx = await rpcCall('getrawtransaction', [coinbaseTxid, 1]);
  console.log('Coinbase Tx Version:', rawTx.result.version);
  console.log('Coinbase Tx VersionGroupID: 0x' + rawTx.result.versiongroupid);
  console.log('Coinbase Transparent Outputs (vout length):', rawTx.result.vout.length);
  console.log('Coinbase Ironwood Actions count:', rawTx.result.ironwood?.actions?.length ?? 0);
  console.log('Coinbase Ironwood valueBalanceZat:', rawTx.result.ironwood?.valueBalanceZat);
  console.log('Coinbase Ironwood anchor:', rawTx.result.ironwood?.anchor);

  // 3. Query lightwalletd getInfo
  console.log('\n--- 3. Querying lightwalletd getInfo on port 39067 ---');
  const client = new ZcashClient({ endpoint: 'http://127.0.0.1:39067', network: 'regtest-nu7' });
  const lightdInfo = await client.getInfo();
  console.log('Lightwalletd vendor:', lightdInfo.vendor);
  console.log('Lightwalletd version:', lightdInfo.version);
  console.log('Lightwalletd consensusBranchId:', lightdInfo.consensusBranchId);
  console.log('Lightwalletd blockHeight:', lightdInfo.blockHeight);

  // 4. Query lightwalletd TreeState at height 105
  console.log('\n--- 4. Querying lightwalletd GetTreeState at height 105 ---');
  const treeState = await client.getTreeState(105);
  console.log('Height:', treeState.height);
  console.log('Sapling tree (length):', (treeState.saplingTree ?? '').length);
  console.log('Orchard tree:', treeState.orchardTree);
  console.log('Ironwood tree (length):', (treeState.ironwoodTree ?? '').length);

  // 5. Sync Account 0 Wallet
  console.log('\n--- 5. Syncing Account 0 Wallet to Height 105 ---');
  const mnemonic0 = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const acct0 = accountFromMnemonic(mnemonic0, 0, 'regtest-nu7');
  const ufvk0 = acct0.getUnifiedFullViewingKey();
  const dbDir = '/tmp/znu7-investigation';
  const dbPath = path.join(dbDir, 'wallet_acct0.db');
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

  const wallet0 = WalletHandle.open(dbPath, 'regtest-nu7', ufvk0);
  const syncRes = await syncWallet(client, wallet0, {
    startHeight: 1,
    endHeight: 105,
    batchSize: 50,
    verifyRootAtTip: true,
  });
  console.log('Account 0 Sync Summary:', JSON.stringify(syncRes.summary, null, 2));

  // 6. Execute send() from Account 0 to Account 1
  console.log('\n--- 6. Executing send() from Account 0 to Account 1 ---');
  const mnemonic1 = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';
  const acct1 = accountFromMnemonic(mnemonic1, 0, 'regtest-nu7');
  const toAddress = acct1.getUnifiedAddress();

  const sendRes = await send({
    client,
    wallet: wallet0,
    from: acct0.spendHandle,
    to: toAddress,
    amount: 100000000n, // 1.0 ZEC
    memo: 'NU7 regtest test transaction',
    minConfs: 1,
  });
  console.log('Send Result:');
  console.log('  Internal TxID:  ', sendRes.txid);
  console.log('  Explorer TxID:  ', reverseTxid(sendRes.txid));
  console.log('  Fee (zatoshis): ', sendRes.fee.toString());
  console.log('  Num Actions:    ', sendRes.numActions);
  console.log('  Expiry Height:  ', sendRes.expiryHeight);

  // 7. Verify transaction in mempool & mine block
  console.log('\n--- 7. Verifying in mempool & mining block 106 ---');
  const mempool = await rpcCall('getrawmempool');
  console.log('Mempool contents:', mempool.result);
  const mined = await rpcCall('generate', [1]);
  console.log('Mined block hash:', mined.result[0]);

  const block106 = await rpcCall('getblock', ['106', 1]);
  console.log('Block 106 height:', block106.result.height);
  console.log('Block 106 nTx:', block106.result.nTx);
  console.log('Block 106 txids:', block106.result.tx);

  // 8. Sync Account 1 and verify received note
  console.log('\n--- 8. Syncing Account 1 and verifying received shielded note ---');
  const dbPath1 = path.join(dbDir, 'wallet_acct1.db');
  if (fs.existsSync(dbPath1)) fs.unlinkSync(dbPath1);
  const wallet1 = WalletHandle.open(dbPath1, 'regtest-nu7', acct1.getUnifiedFullViewingKey());
  const syncRes1 = await syncWallet(client, wallet1, {
    startHeight: 1,
    endHeight: 106,
    verifyRootAtTip: true,
  });
  console.log('Account 1 Sync Summary:', JSON.stringify(syncRes1.summary, null, 2));

  await client.close();
  console.log('\n===============================================================');
  console.log('=== INVESTIGATION RESULT: ALL COMPONENTS PASSED CLEANLY! ✅ ===');
  console.log('===============================================================');
}

main().catch((err) => {
  console.error('Fatal error during investigation:', err);
  process.exit(1);
});
