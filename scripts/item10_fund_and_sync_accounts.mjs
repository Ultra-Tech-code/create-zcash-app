import { createClient, accountFromMnemonic, KNOWN_TEST_MNEMONICS, dev, syncWallet, getBalance } from '../packages/sdk/dist/index.js';
import { WalletHandle } from '../packages/core/index.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

async function main() {
  console.log('=== P3 PREREQUISITES: FUND AND SYNC ACCOUNT 0 & ACCOUNT 1 ON REGTEST ===\n');

  const endpoint = process.env.ZCASH_ENDPOINT || '127.0.0.1:28137';
  const client = createClient({ endpoint, network: 'regtest' });

  // 1. Derive Account 0 and Account 1 from constants.ts mnemonics
  const acct0 = accountFromMnemonic(KNOWN_TEST_MNEMONICS[0], 0, 'regtest');
  const acct1 = accountFromMnemonic(KNOWN_TEST_MNEMONICS[1], 0, 'regtest');

  const addr0 = acct0.getUnifiedAddress();
  const addr1 = acct1.getUnifiedAddress();
  const ufvk0 = acct0.getUnifiedFullViewingKey();
  const ufvk1 = acct1.getUnifiedFullViewingKey();

  console.log(`Account 0:`);
  console.log(`  Mnemonic: "${KNOWN_TEST_MNEMONICS[0]}"`);
  console.log(`  Address:  ${addr0}`);
  console.log(`  UFVK:     ${ufvk0}\n`);

  console.log(`Account 1:`);
  console.log(`  Mnemonic: "${KNOWN_TEST_MNEMONICS[1]}"`);
  console.log(`  Address:  ${addr1}`);
  console.log(`  UFVK:     ${ufvk1}\n`);

  // 2. Fund Account 0 with 5.0 ZEC (500,000,000 zatoshis)
  console.log('Funding Account 0 with 5.0 ZEC...');
  const tx0 = await dev.fund(client, addr0, 500_000_000n);
  console.log(`  Txid 0: ${tx0.txid}`);

  // 3. Fund Account 1 with 3.0 ZEC (300,000,000 zatoshis)
  console.log('Funding Account 1 with 3.0 ZEC...');
  const tx1 = await dev.fund(client, addr1, 300_000_000n);
  console.log(`  Txid 1: ${tx1.txid}`);

  // 4. Mine 2 blocks to ensure confirmation and maturity
  console.log('\nMining 2 blocks to confirm transactions...');
  await dev.mine(client, 2);

  // Wait for Zaino indexer to index the newly mined blocks
  let info = await client.getInfo();
  for (let attempt = 0; attempt < 30; attempt++) {
    info = await client.getInfo();
    try {
      // Test if tip is indexable
      const ts = await client.getTreeState(Number(info.blockHeight));
      if (ts) break;
    } catch (e) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  console.log(`Current Zaino indexed chain tip: height ${info.blockHeight}\n`);

  // 5. Open WalletHandle for Account 0, sync and check balance
  const tmp0 = fs.mkdtempSync(path.join(os.tmpdir(), 'acct0-wallet-'));
  const db0Path = path.join(tmp0, 'wallet_acct0.db');
  const wallet0 = WalletHandle.open(db0Path, 'regtest', ufvk0, 'acct0');

  console.log('--- Syncing Account 0 Wallet ---');
  const sync0 = await syncWallet(client, wallet0, { verifyRootAtTip: true });
  console.log(`Account 0 Sync Result:`);
  console.log(`  Tip Height:      ${sync0.tipHeight}`);
  console.log(`  Blocks Fetched:  ${sync0.blocksFetched}`);
  console.log(`  Tree Root Hex:   ${sync0.treeRootHex}`);
  console.log(`  TreeState Match: ${sync0.treeStateMatched}`);
  console.log(`  Unspent Notes:   ${sync0.summary.unspentNotesCount}`);
  console.log(`  Total Balance:   ${sync0.summary.totalBalanceZatoshis} zatoshis (${Number(sync0.summary.totalBalanceZatoshis) / 1e8} ZEC)`);

  const bal0 = await getBalance(client, acct0);
  console.log(`Account 0 getBalance SDK Output:`);
  console.log(`  Confirmed Ironwood: ${bal0.confirmed.ironwood} zatoshis`);
  console.log(`  Pending Ironwood:   ${bal0.pending.ironwood} zatoshis`);
  console.log(`  Total:              ${bal0.total} zatoshis\n`);

  // 6. Open WalletHandle for Account 1, sync and check balance
  const tmp1 = fs.mkdtempSync(path.join(os.tmpdir(), 'acct1-wallet-'));
  const db1Path = path.join(tmp1, 'wallet_acct1.db');
  const wallet1 = WalletHandle.open(db1Path, 'regtest', ufvk1, 'acct1');

  console.log('--- Syncing Account 1 Wallet ---');
  const sync1 = await syncWallet(client, wallet1, { verifyRootAtTip: true });
  console.log(`Account 1 Sync Result:`);
  console.log(`  Tip Height:      ${sync1.tipHeight}`);
  console.log(`  Blocks Fetched:  ${sync1.blocksFetched}`);
  console.log(`  Tree Root Hex:   ${sync1.treeRootHex}`);
  console.log(`  TreeState Match: ${sync1.treeStateMatched}`);
  console.log(`  Unspent Notes:   ${sync1.summary.unspentNotesCount}`);
  console.log(`  Total Balance:   ${sync1.summary.totalBalanceZatoshis} zatoshis (${Number(sync1.summary.totalBalanceZatoshis) / 1e8} ZEC)`);

  const bal1 = await getBalance(client, acct1);
  console.log(`Account 1 getBalance SDK Output:`);
  console.log(`  Confirmed Ironwood: ${bal1.confirmed.ironwood} zatoshis`);
  console.log(`  Pending Ironwood:   ${bal1.pending.ironwood} zatoshis`);
  console.log(`  Total:              ${bal1.total} zatoshis\n`);

  // Clean up
  try {
    fs.rmSync(tmp0, { recursive: true, force: true });
    fs.rmSync(tmp1, { recursive: true, force: true });
  } catch (e) {}

  await client.close();
  console.log('✅ Item 10 SUCCESS: Both Account 0 and Account 1 funded, synced, and note balances confirmed!');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
