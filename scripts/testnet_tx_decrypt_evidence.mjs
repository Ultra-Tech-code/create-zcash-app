import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';
import { accountFromMnemonic, decryptTransaction, WalletHandle } from '../packages/sdk/dist/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  console.log('========================================================================');
  console.log('STAGE 2a: LIVE TESTNET FULL-TRANSACTION DECRYPTION EVIDENCE');
  console.log('========================================================================');
  console.log(`Execution Time: ${new Date().toISOString()}`);

  // 1. Read quicknode getrawtransaction JSON
  const qnPath = path.resolve(__dirname, '../packages/core/tests/logs/chain_queries/quicknode_getrawtransaction.json');
  if (!fs.existsSync(qnPath)) {
    throw new Error(`Quicknode JSON query file not found at ${qnPath}`);
  }
  const qnData = JSON.parse(fs.readFileSync(qnPath, 'utf8'));
  const rawHex = qnData.result.hex;
  const height = qnData.result.height;
  const rawBytes = Buffer.from(rawHex, 'hex');

  console.log(`Loaded Raw Transaction:`);
  console.log(`  Mined Height: ${height}`);
  console.log(`  Raw Bytes:    ${rawBytes.length} bytes (hex: ${rawHex.length} chars)`);

  // 2. Read accounts.json strictly by code (keys never printed or logged)
  const accountsPath = path.join(os.homedir(), '.zcash-app-testnet', 'accounts.json');
  if (!fs.existsSync(accountsPath)) {
    throw new Error(`Accounts file not found at ${accountsPath}`);
  }
  const accts = JSON.parse(fs.readFileSync(accountsPath, 'utf8'));
  if (!accts.mnemonicA || !accts.mnemonicB) {
    throw new Error(`accounts.json must contain mnemonicA and mnemonicB`);
  }

  // Derive watch-only accounts (UFVK-only)
  const walletA = accountFromMnemonic(accts.mnemonicA, 0, 'testnet');
  const walletB = accountFromMnemonic(accts.mnemonicB, 0, 'testnet');

  const ufvkA = walletA.getUnifiedFullViewingKey();
  const ufvkB = walletB.getUnifiedFullViewingKey();
  const addrB = walletB.getUnifiedAddress();

  console.log(`\nDerived Testnet Watch-Only Accounts (UFVK in memory only; secret keys never displayed):`);
  console.log(`  Wallet A Address: ${walletA.getUnifiedAddress().slice(0, 20)}...${walletA.getUnifiedAddress().slice(-12)}`);
  console.log(`  Wallet B Address: ${addrB}`);

  // 3. Setup fresh databases in /tmp with schema v3
  const testDirA = fs.mkdtempSync(path.join('/tmp', 'zcash_wallet_a_'));
  const testDirB = fs.mkdtempSync(path.join('/tmp', 'zcash_wallet_b_'));
  const dbPathA = path.join(testDirA, 'wallet.db');
  const dbPathB = path.join(testDirB, 'wallet.db');

  console.log(`\nInitializing Fresh Databases in /tmp:`);
  console.log(`  Wallet A DB: ${dbPathA}`);
  console.log(`  Wallet B DB: ${dbPathB}`);

  const handleA = WalletHandle.open(dbPathA, 'testnet', ufvkA, 'account0');
  const handleB = WalletHandle.open(dbPathB, 'testnet', ufvkB, 'account0');

  // Verify Schema Version in Wallet A and B
  const sqliteA = new DatabaseSync(dbPathA);
  const sqliteB = new DatabaseSync(dbPathB);

  const schemaVerA = sqliteA.prepare("SELECT value FROM wallet_metadata WHERE key = 'schema_version'").get().value;
  const schemaVerB = sqliteB.prepare("SELECT value FROM wallet_metadata WHERE key = 'schema_version'").get().value;
  console.log(`  Database A Schema Version: ${schemaVerA}`);
  console.log(`  Database B Schema Version: ${schemaVerB}`);

  if (schemaVerA !== '3' || schemaVerB !== '3') {
    throw new Error(`Expected schema version 3, got A: ${schemaVerA}, B: ${schemaVerB}`);
  }

  // 4. Decrypt transaction with Wallet A (Sender)
  console.log(`\n------------------------------------------------------------------------`);
  console.log(`[Wallet A] DECRYPTING TRANSACTION WITH SENDER UFVK`);
  console.log(`------------------------------------------------------------------------`);
  const decA = decryptTransaction(ufvkA, 'testnet', rawBytes, height);

  console.log(`Decryption Results for Wallet A:`);
  console.log(`  TxID:                 ${decA.txid}`);
  console.log(`  Transaction Fee:      ${decA.fee.toLocaleString()} zatoshis`);
  console.log(`  Expiry Height:        ${decA.expiryHeight}`);
  console.log(`  Consensus Branch ID:  0x${decA.consensusBranchId}`);
  console.log(`  Outgoing Actions:     ${decA.outgoing.length}`);
  console.log(`  Incoming/Change:      ${decA.incoming.length}`);

  // Insert into Wallet A wallet_transactions table
  const insertTx = sqliteA.prepare(`
    INSERT INTO wallet_transactions (
      txid, height, direction, value, fee, memo, counterparty, pool, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const out of decA.outgoing) {
    console.log(`\n  >> Action ${out.actionIndex}: OUTGOING ${out.value.toLocaleString()} zat to Wallet B`);
    console.log(`     Recipient:    ${out.recipient}`);
    console.log(`     Net Fee:      ${decA.fee.toLocaleString()} zat`);
    console.log(`     Memo Text:    ${out.memo.text ?? '(empty)'}`);
    console.log(`     Memo Hex:     ${out.memo.hex || '(none)'}`);
    insertTx.run(decA.txid, height, 'out', Number(out.value), Number(decA.fee), out.memo.text ?? null, out.recipient, 'ironwood', Math.floor(Date.now() / 1000));
  }

  for (const inc of decA.incoming) {
    const label = inc.isChange ? 'INTERNAL CHANGE' : 'INCOMING';
    console.log(`\n  >> Action ${inc.actionIndex}: ${label} ${inc.value.toLocaleString()} zat (isChange: ${inc.isChange})`);
    console.log(`     Recipient:    ${inc.recipient}`);
    insertTx.run(decA.txid, height, inc.isChange ? 'internal' : 'in', Number(inc.value), Number(decA.fee), inc.memo.text ?? null, null, 'ironwood', Math.floor(Date.now() / 1000));
  }

  // 5. Decrypt transaction with Wallet B (Recipient)
  console.log(`\n------------------------------------------------------------------------`);
  console.log(`[Wallet B] DECRYPTING TRANSACTION WITH RECIPIENT UFVK`);
  console.log(`------------------------------------------------------------------------`);
  const decB = decryptTransaction(ufvkB, 'testnet', rawBytes, height);

  console.log(`Decryption Results for Wallet B:`);
  console.log(`  TxID:                 ${decB.txid}`);
  console.log(`  Transaction Fee:      ${decB.fee.toLocaleString()} zatoshis`);
  console.log(`  Expiry Height:        ${decB.expiryHeight}`);
  console.log(`  Consensus Branch ID:  0x${decB.consensusBranchId}`);
  console.log(`  Outgoing Actions:     ${decB.outgoing.length}`);
  console.log(`  Incoming Actions:     ${decB.incoming.length}`);

  const insertTxB = sqliteB.prepare(`
    INSERT INTO wallet_transactions (
      txid, height, direction, value, fee, memo, counterparty, pool, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const inc of decB.incoming) {
    console.log(`\n  >> Action ${inc.actionIndex}: INCOMING ${inc.value.toLocaleString()} zat`);
    console.log(`     Recipient:    ${inc.recipient}`);
    console.log(`     isChange:     ${inc.isChange}`);
    console.log(`     Memo Text:    ${inc.memo.text ?? '(empty)'}`);
    console.log(`     Memo Hex:     ${inc.memo.hex || '(none)'}`);
    insertTxB.run(decB.txid, height, 'in', Number(inc.value), Number(decB.fee), inc.memo.text ?? null, null, 'ironwood', Math.floor(Date.now() / 1000));
  }

  // 6. Query and assert rows from both databases
  console.log(`\n------------------------------------------------------------------------`);
  console.log(`VERIFYING PERSISTED DATABASE RECORDS IN wallet_transactions`);
  console.log(`------------------------------------------------------------------------`);

  const rowsA = sqliteA.prepare('SELECT id, txid, height, direction, value, fee, counterparty, pool FROM wallet_transactions ORDER BY id').all();
  console.log(`Wallet A Database Rows:`);
  for (const r of rowsA) {
    console.log(`  Row ${r.id}: direction=${r.direction.padEnd(8)} value=${String(r.value).padStart(10)} fee=${r.fee} counterparty=${r.counterparty ?? 'null'}`);
  }

  const rowsB = sqliteB.prepare('SELECT id, txid, height, direction, value, fee, counterparty, pool FROM wallet_transactions ORDER BY id').all();
  console.log(`Wallet B Database Rows:`);
  for (const r of rowsB) {
    console.log(`  Row ${r.id}: direction=${r.direction.padEnd(8)} value=${String(r.value).padStart(10)} fee=${r.fee} counterparty=${r.counterparty ?? 'null'}`);
  }

  // Assertions
  const outA = rowsA.find((r) => r.direction === 'out');
  if (!outA || outA.value !== 1000000 || outA.fee !== 10000) {
    throw new Error(`Wallet A failed assertion: expected outgoing 1,000,000 zat with 10,000 fee, got ${JSON.stringify(outA)}`);
  }

  const inB = rowsB.find((r) => r.direction === 'in');
  if (!inB || inB.value !== 1000000) {
    throw new Error(`Wallet B failed assertion: expected incoming 1,000,000 zat, got ${JSON.stringify(inB)}`);
  }

  console.log(`\n========================================================================`);
  console.log(`VERIFICATION RESULT: SUCCESS!`);
  console.log(`  Wallet A shows OUTGOING 1,000,000 zat to Wallet B with fee 10,000 zat`);
  console.log(`  Wallet B shows INCOMING 1,000,000 zat`);
  console.log(`  UFVK-only watch mode enforced: no mnemonic or spending key logged`);
  console.log(`  Schema v3 wallet_transactions verified in clean SQLite DBs in /tmp`);
  console.log(`========================================================================`);

  sqliteA.close();
  sqliteB.close();
}

main().catch((err) => {
  console.error('Evidence script failed:', err);
  process.exit(1);
});
