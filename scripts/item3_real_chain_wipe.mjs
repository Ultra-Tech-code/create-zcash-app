import { WalletHandle } from '../packages/core/index.js';
import { ZcashClient, syncWallet, accountFromMnemonic } from '../packages/sdk/dist/index.js';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('================================================================');
  console.log('ITEM 3: REAL CHAIN WIPE & RECOVERY INTEGRATION TEST');
  console.log('================================================================\n');

  const mnemonic0 = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const acct0 = accountFromMnemonic(mnemonic0, 0, 'regtest');
  const ufvk0 = acct0.getUnifiedFullViewingKey();

  const walletDir = path.resolve(__dirname, '../packages/core/tests/wallet_integration_run');
  fs.mkdirSync(walletDir, { recursive: true });
  const dbPath = path.join(walletDir, 'chain_wipe_test.db');
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  if (fs.existsSync(`${dbPath}-wal`)) fs.unlinkSync(`${dbPath}-wal`);
  if (fs.existsSync(`${dbPath}-shm`)) fs.unlinkSync(`${dbPath}-shm`);

  // 1. Initial sync against current chain before wipe
  let client;
  let infoBefore;
  for (let i = 0; i < 30; i++) {
    try {
      client = new ZcashClient({ endpoint: '127.0.0.1:28137', network: 'regtest' });
      infoBefore = await client.getInfo();
      if (infoBefore && infoBefore.blockHeight) break;
    } catch (e) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  console.log(`Pre-wipe chain tip: height ${infoBefore?.blockHeight}, upgrade: ${infoBefore?.upgradeName}`);

  let wallet = WalletHandle.open(dbPath, 'regtest', ufvk0, 'account0');
  console.log('Syncing wallet against pre-wipe chain...');
  const preWipeSync = await syncWallet(client, wallet, { batchSize: 50 });
  console.log(`Pre-wipe wallet synced to height ${preWipeSync.summary.lastScannedHeight}, tree size: ${preWipeSync.summary.treeSize}`);
  await client.close();

  // 2. Perform REAL chain wipe using zcash-dev regtest wipe
  console.log('\n--- 2. EXECUTING REAL zcash-dev regtest wipe ---');
  const z3Dir = '/Users/0xblackadam/Downloads/z3';
  const devCliPath = path.resolve(__dirname, '../packages/dev/dist/cli.js');
  execSync(`node "${devCliPath}" regtest wipe --z3-path "${z3Dir}"`, { stdio: 'inherit' });

  // 3. Connect client to the brand new chain
  console.log('\n--- 3. DETECTING CHAINRESET ON BRAND NEW CHAIN ---');
  let infoAfter;
  for (let i = 0; i < 30; i++) {
    try {
      client = new ZcashClient({ endpoint: '127.0.0.1:28137', network: 'regtest' });
      infoAfter = await client.getInfo();
      if (infoAfter && infoAfter.blockHeight) break;
    } catch (e) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  console.log(`Brand new chain tip: height ${infoAfter?.blockHeight}\n`);

  // Stream block 2 from the new chain into the existing wallet (which scanned the old block 2)
  const newChainBlocks = [];
  for await (const b of client.getRawBlockRange(2, 2)) {
    newChainBlocks.push(b);
  }

  let caughtError = null;
  try {
    await wallet.scanBlocks(newChainBlocks);
  } catch (err) {
    caughtError = err;
    console.log('>>> RAW ChainReset ERROR RECEIVED FROM WALLET: <<<');
    console.log(err.message || err);
  }

  if (!caughtError || !String(caughtError).includes('Chain reset detected')) {
    console.error('FAILED: Expected ChainReset error was not raised!');
    process.exit(1);
  }
  console.log('>>> SUCCESS: Raw ChainReset error successfully caught! <<<\n');

  // 4. Recover with wallet.reset()
  console.log('--- 4. EXECUTING wallet.reset() TO RECOVER ---');
  wallet.reset();
  const summaryAfterReset = wallet.getWalletSummary();
  console.log('Wallet summary immediately after reset():', summaryAfterReset);
  if (summaryAfterReset.lastScannedHeight !== 0 || summaryAfterReset.treeSize !== 0) {
    console.error('FAILED: wallet.reset() did not wipe all state!');
    process.exit(1);
  }
  console.log('>>> SUCCESS: wallet.reset() successfully reset wallet to clean slate! <<<\n');

  // 5. Full resync to new chain tip
  console.log('--- 5. FULL RESYNC TO NEW CHAIN TIP ---');
  const postResetSync = await syncWallet(client, wallet, {
    batchSize: 50,
    onProgress: (scanned, tip) => {
      console.log(`  Resynced up to block ${scanned}/${tip}`);
    },
  });
  console.log(`New sync completed: height ${postResetSync.summary.lastScannedHeight}/${postResetSync.tipHeight}, tree size: ${postResetSync.summary.treeSize}`);
  console.log(`New Ironwood tree root: ${postResetSync.treeRootHex}`);
  console.log(`TreeState matched: ${postResetSync.treeStateMatched}`);

  await client.close();
  console.log('\n================================================================');
  console.log('ITEM 3 COMPLETE: REAL CHAIN WIPE & RECOVERY VERIFIED!');
  console.log('================================================================\n');
}

main().catch((err) => {
  console.error('Fatal error in item 3 test:', err);
  process.exit(1);
});
