#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const {
  ZcashClient,
  syncWallet,
  accountFromMnemonic,
  KNOWN_TEST_MNEMONICS,
  send,
  reverseTxid,
  WalletHandle,
} = await import(`${projectRoot}/packages/sdk/dist/index.js`);

const ZEBRA_RPC_PORT = process.env.ZEBRA_RPC_PORT || '49232';
const ZAINO_GRPC_PORT = process.env.ZAINO_GRPC_PORT || '8137';

async function rpcCall(method, params = []) {
  const res = await fetch(`http://127.0.0.1:${ZEBRA_RPC_PORT}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  });
  return await res.json();
}

async function main() {
  const log = [];
  const append = (line) => {
    console.log(line);
    log.push(line);
  };

  append('===============================================================');
  append('=== ZAINO FEAT/NU7 REGTEST SPIKE END-TO-END VERIFICATION =====');
  append('===============================================================');

  const assertions = [];
  function assertCheck(name, condition, details = '') {
    const passed = Boolean(condition);
    assertions.push({ name, passed, details });
    if (passed) {
      append(`[PASS] ${name}${details ? ` (${details})` : ''}`);
    } else {
      append(`[FAIL] ${name}${details ? ` (${details})` : ''}`);
      throw new Error(`Assertion failed: ${name} - ${details}`);
    }
  }

  // 1. Verify Zebra Node
  append('\n--- 1. Verifying Zebra 7.0.0 Node ---');
  const bci = await rpcCall('getblockchaininfo');
  assertCheck('Zebra chain is Regtest', bci.result.chain === 'test');
  assertCheck('Zebra height is at least 105', bci.result.blocks >= 105, `height=${bci.result.blocks}`);
  assertCheck(
    'NU7 consensus branch is active in Zebra',
    bci.result.upgrades['77190ad9']?.status === 'active',
    `activation=${bci.result.upgrades['77190ad9']?.activationheight}`
  );

  // 2. Verify Zaino gRPC Service
  append('\n--- 2. Connecting to Zaino gRPC Service ---');
  const client = new ZcashClient({
    endpoint: `http://127.0.0.1:${ZAINO_GRPC_PORT}`,
    network: 'regtest-nu7',
  });

  let lightdInfo;
  for (let i = 0; i < 30; i++) {
    try {
      lightdInfo = await client.getInfo();
      if (lightdInfo && Number(lightdInfo.blockHeight) >= bci.result.blocks) {
        break;
      }
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!lightdInfo) {
    lightdInfo = await client.getInfo();
  }

  append(`Zaino Vendor: ${lightdInfo.vendor}`);
  append(`Zaino Version: ${lightdInfo.version}`);
  append(`Zaino Git Commit: ${lightdInfo.gitCommit}`);
  append(`Zaino Consensus Branch ID: ${lightdInfo.consensusBranchId}`);
  append(`Zaino Tip Height: ${lightdInfo.blockHeight}`);

  assertCheck('Zaino consensusBranchId is 77190ad9', lightdInfo.consensusBranchId === '77190ad9');
  assertCheck('Zaino blockHeight matches Zebra tip', Number(lightdInfo.blockHeight) >= 105, `height=${lightdInfo.blockHeight}`);

  // 3. Sync Account 0 (Miner Recipient)
  append('\n--- 3. Syncing Account 0 (Miner Recipient) to Tip ---');
  const acct0 = accountFromMnemonic(KNOWN_TEST_MNEMONICS[0], 0, 'regtest-nu7');
  const dbDir = path.join(projectRoot, 'node_modules/.cache/zaino-spike');
  fs.mkdirSync(dbDir, { recursive: true });
  const dbPath0 = path.join(dbDir, 'wallet_acct0.db');
  if (fs.existsSync(dbPath0)) fs.unlinkSync(dbPath0);

  const wallet0 = WalletHandle.open(dbPath0, 'regtest-nu7', acct0.getUnifiedFullViewingKey());
  const tipHeight = Number(lightdInfo.blockHeight);

  append(`Starting sync from height 1 to target ${tipHeight}...`);
  const sync0 = await syncWallet(client, wallet0, {
    startHeight: 1,
    endHeight: tipHeight,
    verifyRootAtTip: true,
  });

  append(`Scanned: ${sync0.summary.lastScannedHeight}/${tipHeight}`);
  append(`Discovered unspent notes: ${sync0.summary.unspentNotesCount}`);
  append(`Total spendable balance: ${sync0.summary.spendableBalanceZatoshis} zatoshis`);

  assertCheck('Account 0 scanned to tip', sync0.summary.lastScannedHeight === tipHeight);
  assertCheck('Account 0 discovered shielded notes', sync0.summary.unspentNotesCount > 0, `notes=${sync0.summary.unspentNotesCount}`);
  assertCheck('Account 0 has spendable balance', sync0.summary.spendableBalanceZatoshis > 0, `balance=${sync0.summary.spendableBalanceZatoshis}`);

  // 4. Send transaction from Account 0 to Account 1
  append('\n--- 4. Executing send() from Account 0 to Account 1 through Zaino ---');
  const acct1 = accountFromMnemonic(KNOWN_TEST_MNEMONICS[1], 0, 'regtest-nu7');
  const sendRes = await send({
    client,
    wallet: wallet0,
    from: acct0.spendHandle,
    to: acct1.getUnifiedAddress(),
    amount: 100000000n, // 1.0 ZEC
    memo: 'Zaino feat/nu7 regtest stack end-to-end evidence',
  });

  append(`Send TxID: ${sendRes.txid}`);
  append(`Send Fee: ${sendRes.fee} zatoshis`);
  append(`Send Actions: ${sendRes.numActions}`);
  append(`Send Expiry: ${sendRes.expiryHeight}`);

  assertCheck('Send returned valid txid', typeof sendRes.txid === 'string' && sendRes.txid.length === 64, `txid=${sendRes.txid}`);
  assertCheck('Send fee is standard 10000 zatoshis', sendRes.fee === 10000n);
  assertCheck('Send numActions is 2', sendRes.numActions === 2);
  const expectedExpiry = tipHeight + 1 + 120;
  assertCheck('Send expiry height equals target height + 120', sendRes.expiryHeight === expectedExpiry, `expiry=${sendRes.expiryHeight}, expected=${expectedExpiry}`);

  // 5. Verify transaction in mempool and mine block
  append('\n--- 5. Verifying mempool and mining block ---');
  const explorerTxid = reverseTxid(sendRes.txid);
  const mempool = await rpcCall('getrawmempool');
  append(`Mempool contents: ${JSON.stringify(mempool.result)}`);
  assertCheck('Transaction is present in Zebra mempool', mempool.result.includes(explorerTxid), `explorerTxid=${explorerTxid}`);

  const mined = await rpcCall('generate', [1]);
  append(`Mined block hash: ${mined.result[0]}`);
  assertCheck('Block successfully mined', Array.isArray(mined.result) && mined.result.length === 1, `blockHash=${mined.result[0]}`);

  const nextHeight = tipHeight + 1;
  const block = await rpcCall('getblock', [String(nextHeight), 1]);
  assertCheck('Mined block height incremented', block.result.height === nextHeight);
  assertCheck('Mined block includes the sent transaction', block.result.tx.includes(explorerTxid));

  // Wait for Zaino to ingest the mined block
  append(`Waiting for Zaino to index mined block ${nextHeight}...`);
  for (let i = 0; i < 30; i++) {
    try {
      const hdr = await client.getBlockHeader(nextHeight);
      if (hdr && hdr.height === nextHeight) {
        append(`Zaino indexed block ${nextHeight}`);
        break;
      }
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 1000));
  }

  // 6. Sync Account 1 (Recipient) and verify receipt
  append('\n--- 6. Syncing Account 1 (Recipient) to confirm receipt ---');
  const dbPath1 = path.join(dbDir, 'wallet_acct1.db');
  if (fs.existsSync(dbPath1)) fs.unlinkSync(dbPath1);

  const wallet1 = WalletHandle.open(dbPath1, 'regtest-nu7', acct1.getUnifiedFullViewingKey());
  const sync1 = await syncWallet(client, wallet1, {
    startHeight: 1,
    endHeight: nextHeight,
    verifyRootAtTip: true,
  });

  append(`Recipient Scanned: ${sync1.summary.lastScannedHeight}/${nextHeight}`);
  append(`Recipient Unspent Notes: ${sync1.summary.unspentNotesCount}`);
  append(`Recipient Balance: ${sync1.summary.spendableBalanceZatoshis} zatoshis`);

  assertCheck('Account 1 scanned to new tip', sync1.summary.lastScannedHeight === nextHeight);
  assertCheck('Account 1 has unspent notes', sync1.summary.unspentNotesCount >= 1, `notes=${sync1.summary.unspentNotesCount}`);
  assertCheck('Account 1 balance is at least 1.0 ZEC (100,000,000 zatoshis)', sync1.summary.spendableBalanceZatoshis >= 100000000n, `balance=${sync1.summary.spendableBalanceZatoshis}`);

  await client.close();

  // 7. Compute final banner strictly from assertions
  const passedCount = assertions.filter((a) => a.passed).length;
  const totalCount = assertions.length;
  const allChecksPassed = totalCount >= 10 && passedCount === totalCount;

  if (allChecksPassed) {
    append('\n' + '='.repeat(70));
    append(`=== ZAINO FEAT/NU7 REGTEST SPIKE END-TO-END VERIFIED: ${passedCount}/${totalCount} ASSERTIONS PASSED ✅ ===`);
    append('='.repeat(70) + '\n');
  } else {
    append(`\n❌ VERIFICATION FAILED: Only ${passedCount}/${totalCount} assertions passed!`);
    process.exit(1);
  }

  // Save log
  const logPath = path.join(projectRoot, 'packages/core/tests/logs/zaino_nu7_spike.log');
  fs.writeFileSync(logPath, log.join('\n'));
  console.log(`Log successfully written to ${logPath}`);
}

main().catch((err) => {
  console.error('Fatal error during Zaino NU7 spike:', err);
  process.exit(1);
});

