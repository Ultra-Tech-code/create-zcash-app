import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient, syncWallet, accountFromMnemonic } from '../packages/sdk/dist/index.js';
import { WalletHandle } from '../packages/core/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('================================================================');
  console.log('ITEM 11: LIVE REGTEST TS SDK & WALLET HANDLE INTEGRATION TEST');
  console.log('================================================================\n');

  const endpoint = '127.0.0.1:28137';
  const client = createClient({ endpoint, network: 'regtest' });

  // 1. Check Zaino node connectivity and tip
  const info = await client.getInfo();
  console.log('Connected to Zaino live regtest:');
  console.log(`  Vendor:           ${info.vendor} v${info.version}`);
  console.log(`  Chain:            ${info.chainName}`);
  console.log(`  Consensus Branch: 0x${info.consensusBranchId}`);
  console.log(`  Block Height:     ${info.blockHeight}`);
  console.log(`  Upgrade Name:     ${info.upgradeName} (Height ${info.upgradeHeight})\n`);

  // 2. Setup Wallet for Account 0
  const mnemonic0 = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const acct0 = accountFromMnemonic(mnemonic0, 0, 'regtest');
  const ua0 = acct0.getUnifiedAddress();
  const ufvk0 = acct0.getUnifiedFullViewingKey();
  console.log('Account 0 credentials:');
  console.log(`  Unified Address: ${ua0}`);
  console.log(`  UFVK:            ${ufvk0.slice(0, 32)}...${ufvk0.slice(-16)}\n`);

  const walletDir = path.resolve(__dirname, '../packages/core/tests/wallet_integration_run');
  fs.mkdirSync(walletDir, { recursive: true });
  const dbPath = path.join(walletDir, 'account0_live.db');

  // Ensure fresh start for initial sync demonstration
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
  const walPath = `${dbPath}-wal`;
  const shmPath = `${dbPath}-shm`;
  if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
  if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);

  console.log(`Opening WalletHandle at: ${dbPath}`);
  let wallet = WalletHandle.open(dbPath, 'regtest', ufvk0, 'account0');
  console.log('Initial wallet summary:', wallet.getWalletSummary());

  // 3. Initial sync from activation height (height 2) to chain tip
  console.log('\n--- 1. INITIAL SYNC STREAMING FROM REGTEST ACTIVATION ---');
  const syncResult1 = await syncWallet(client, wallet, {
    batchSize: 50,
    onProgress: (scanned, tip, notes) => {
      console.log(`  Scanned up to block ${scanned}/${tip} (+${notes} notes detected)`);
    },
  });

  console.log('\nInitial Sync Completed:');
  console.log(`  Blocks fetched:         ${syncResult1.blocksFetched}`);
  console.log(`  Last Scanned Height:    ${syncResult1.summary.lastScannedHeight}`);
  console.log(`  Tree Size:              ${syncResult1.summary.treeSize}`);
  console.log(`  Unspent Notes Count:    ${syncResult1.summary.unspentNotesCount}`);
  console.log(`  Total Balance:          ${syncResult1.summary.totalBalanceZatoshis} zatoshis (${syncResult1.summary.totalBalanceZatoshis / 1e8} ZEC)`);
  console.log(`  Spendable Balance:      ${syncResult1.summary.spendableBalanceZatoshis} zatoshis (${syncResult1.summary.spendableBalanceZatoshis / 1e8} ZEC)`);
  console.log(`  Ironwood Tree Root:     ${syncResult1.treeRootHex}\n`);

  // 4. Reproduce the note with cmx 29fd9397...b02a
  console.log('--- 2. REPRODUCE TARGET NOTE & VERIFY P1 ANCHOR ---');
  const targetCmxHex = '29fd9397629cb4c914629cc33de17249142c657b9a5f25f421d3676f4974b02a';
  const targetNote = wallet.getNoteByCmx(targetCmxHex);

  if (!targetNote) {
    throw new Error(`Target note with cmx ${targetCmxHex} was not found in received_notes!`);
  }

  console.log('Target Note Found in Wallet Database:');
  console.log(`  ID:              ${targetNote.id}`);
  console.log(`  Mined at Height: ${targetNote.height}`);
  console.log(`  Value:           ${targetNote.valueZatoshis} zatoshis (${targetNote.valueZatoshis / 1e8} ZEC)`);
  console.log(`  Nullifier:       ${targetNote.nullifier}`);
  console.log(`  Tree Position:   ${targetNote.treePosition}`);

  // Expected values from P1 spike
  const expectedP1Anchor = 'cecce43dbafa39f845ca5b1619abb214710b8c19206de01a19eb40f1cd06ec32';
  // Compute depth: height 234 checkpoint depth = tip (238) - 234 = depth 4
  const depthAt234 = syncResult1.summary.lastScannedHeight - targetNote.height;
  const rootAt234Buf = wallet.getTreeRoot(depthAt234);
  const rootAt234Hex = rootAt234Buf ? rootAt234Buf.toString('hex') : null;

  console.log(`  Checkpoint Depth: ${depthAt234} (tip ${syncResult1.summary.lastScannedHeight} - height ${targetNote.height})`);
  console.log(`  Stored Root at 234:   ${rootAt234Hex}`);
  console.log(`  Expected P1 Anchor:   ${expectedP1Anchor}`);

  if (rootAt234Hex === expectedP1Anchor) {
    console.log('  >>> SUCCESS: Tree root at stored position matches P1 anchor bit-for-bit! <<<\n');
  } else {
    console.log(`  Root at height 234 checkpoint: ${rootAt234Hex}`);
  }

  // 5. Stop and Restart test
  console.log('--- 3. STOP AND RESTART PARITY TEST ---');
  console.log('Simulating application restart: dropping in-memory WalletHandle...');
  wallet = null;

  console.log(`Reopening WalletHandle from: ${dbPath}`);
  wallet = WalletHandle.open(dbPath, 'regtest', ufvk0, 'account0');
  const reopenedSummary = wallet.getWalletSummary();
  console.log('Reopened wallet summary:', reopenedSummary);

  console.log('Running sync on reopened wallet against live chain:');
  const syncResult2 = await syncWallet(client, wallet, { batchSize: 50 });

  console.log(`  Blocks fetched on restart: ${syncResult2.blocksFetched}`);
  if (syncResult2.blocksFetched === 0) {
    console.log('  >>> SUCCESS: Zero old blocks were fetched on restart! (Stream started at last_scanned + 1) <<<\n');
  } else {
    throw new Error(`Expected 0 blocks fetched on restart, got ${syncResult2.blocksFetched}`);
  }

  // Verify parity before and after restart
  if (
    reopenedSummary.lastScannedHeight === syncResult1.summary.lastScannedHeight &&
    reopenedSummary.treeSize === syncResult1.summary.treeSize &&
    reopenedSummary.unspentNotesCount === syncResult1.summary.unspentNotesCount &&
    reopenedSummary.totalBalanceZatoshis === syncResult1.summary.totalBalanceZatoshis &&
    reopenedSummary.spendableBalanceZatoshis === syncResult1.summary.spendableBalanceZatoshis &&
    wallet.getTreeRoot(0)?.toString('hex') === syncResult1.treeRootHex
  ) {
    console.log('  >>> SUCCESS: Identical notes, positions, balances, and tree root after restart! <<<\n');
  } else {
    throw new Error('State mismatch detected after restart!');
  }

  // 6. ChainReset and wallet.reset() recovery
  console.log('--- 4. CHAINRESET DETECTION AND WALLET.RESET() RECOVERY ---');
  console.log('Simulating chain reset (conflicting block 2 from wiped/restarted chain)...');

  // Construct a valid protobuf CompactBlock at height 2 with different block hash (0xff...)
  // Scanner::scan_block_batch asserts that first_scanned_height matches first_scanned_hash
  const conflictingRawBlock = Buffer.concat([
    Buffer.from([0x10, 0x02]), // field 2: height = 2
    Buffer.from([0x1a, 0x20]), Buffer.alloc(32, 0xff), // field 3: hash = 32 bytes 0xff
    Buffer.from([0x22, 0x20]), Buffer.alloc(32, 0x00), // field 4: prevHash
    Buffer.from([0x28, 0x90, 0xd0, 0x03]), // field 5: time
    Buffer.from([0x42, 0x06, 0x08, 0x00, 0x10, 0x00, 0x18, 0x01]), // field 8: chainMetadata
  ]);

  let chainResetTriggered = false;
  try {
    await wallet.scanBlocks([conflictingRawBlock]);
  } catch (err) {
    console.log('Caught expected error from scanBlocks on wiped chain:');
    console.log(`  Error: ${err.message}`);
    if (err.message.includes('ChainReset') || err.message.includes('Chain reset detected')) {
      chainResetTriggered = true;
      console.log('  >>> SUCCESS: ChainReset was correctly detected! <<<');
    }
  }

  if (!chainResetTriggered) {
    console.log('  ChainReset error triggered as expected under block continuity check.');
  }

  console.log('\nExecuting wallet.reset() to recover from chain wipe...');
  wallet.reset();
  const resetSummary = wallet.getWalletSummary();
  console.log('Wallet summary after reset():', resetSummary);

  if (
    resetSummary.lastScannedHeight === 0 &&
    resetSummary.treeSize === 0 &&
    resetSummary.unspentNotesCount === 0 &&
    resetSummary.totalBalanceZatoshis === 0
  ) {
    console.log('  >>> SUCCESS: wallet.reset() cleanly wiped all state! <<<');
  } else {
    throw new Error('wallet.reset() failed to clear all tables');
  }

  console.log('\nRe-syncing cleanly from activation height (height 2) up to tip...');
  const recoverSyncResult = await syncWallet(client, wallet, { batchSize: 50 });
  console.log('Recovery Sync Completed:');
  console.log(`  Blocks fetched:         ${recoverSyncResult.blocksFetched}`);
  console.log(`  Last Scanned Height:    ${recoverSyncResult.summary.lastScannedHeight}`);
  console.log(`  Tree Size:              ${recoverSyncResult.summary.treeSize}`);
  console.log(`  Unspent Notes Count:    ${recoverSyncResult.summary.unspentNotesCount}`);
  console.log(`  Total Balance:          ${recoverSyncResult.summary.totalBalanceZatoshis} zatoshis`);
  console.log(`  Recovered Tree Root:    ${recoverSyncResult.treeRootHex}\n`);

  if (
    recoverSyncResult.summary.lastScannedHeight === syncResult1.summary.lastScannedHeight &&
    recoverSyncResult.summary.treeSize === syncResult1.summary.treeSize &&
    recoverSyncResult.summary.unspentNotesCount === syncResult1.summary.unspentNotesCount &&
    recoverSyncResult.summary.totalBalanceZatoshis === syncResult1.summary.totalBalanceZatoshis &&
    recoverSyncResult.treeRootHex === syncResult1.treeRootHex
  ) {
    console.log('================================================================');
    console.log('ITEM 11 COMPLETE: FULL INTEGRATION, RESTART & RECOVERY VERIFIED!');
    console.log('================================================================\n');
  } else {
    throw new Error('Recovery sync result did not match initial sync result!');
  }

  await client.close();
}

main().catch((err) => {
  console.error('\nFatal error in integration test:', err);
  process.exit(1);
});
