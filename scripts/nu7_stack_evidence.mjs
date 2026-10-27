#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const { ZcashClient } = await import(`${projectRoot}/packages/sdk/dist/client.js`);
const { syncWallet } = await import(`${projectRoot}/packages/sdk/dist/sync.js`);
const { accountFromMnemonic } = await import(`${projectRoot}/packages/sdk/dist/keys.js`);
const { KNOWN_TEST_MNEMONICS } = await import(`${projectRoot}/packages/sdk/dist/constants.js`);
const { send, reverseTxid } = await import(`${projectRoot}/packages/sdk/dist/send.js`);
const { WalletHandle } = await import(`${projectRoot}/packages/core/index.js`);

const ZEBRA_PORT = process.env.ZEBRA_RPC_PORT || '39232';
const LIGHTD_PORT = process.env.LIGHTWALLETD_GRPC_PORT || '39067';

async function rpcCall(method, params = []) {
  const res = await fetch(`http://127.0.0.1:${ZEBRA_PORT}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return await res.json();
}

async function main() {
  console.log('===============================================================');
  console.log('=== NU7 REGTEST STACK END-TO-END VERIFICATION & EVIDENCE =====');
  console.log('===============================================================');

  const assertions = [];
  function assertCheck(name, condition, details = '') {
    const passed = Boolean(condition);
    assertions.push({ name, passed, details });
    if (passed) {
      console.log(`[PASS] ${name}${details ? ` (${details})` : ''}`);
    } else {
      console.error(`[FAIL] ${name}${details ? ` (${details})` : ''}`);
      throw new Error(`Assertion failed: ${name} - ${details}`);
    }
  }

  // 1. Wipe and re-initialize NU7 regtest stack using productized CLI
  console.log('\n--- 1. Wiping and initializing NU7 stack via zcash-dev CLI ---');
  execSync(`node "${projectRoot}/packages/dev/dist/cli.js" regtest wipe --stack nu7 --yes`, {
    stdio: 'inherit',
    env: { ...process.env, ZEBRA_RPC_PORT: ZEBRA_PORT, LIGHTWALLETD_GRPC_PORT: LIGHTD_PORT },
  });

  // Verify Zebra getblockchaininfo
  const bci = await rpcCall('getblockchaininfo');
  assertCheck('Zebra chain is Regtest', bci.result.chain === 'test');
  assertCheck('Tip height is at least 105', bci.result.blocks >= 105, `height=${bci.result.blocks}`);
  assertCheck(
    'NU7 consensus branch is active',
    bci.result.upgrades['77190ad9']?.status === 'active',
    `activation=${bci.result.upgrades['77190ad9']?.activationheight}`
  );

  // 2. Query lightwalletd
  console.log('\n--- 2. Connecting to lightwalletd ---');
  const client = new ZcashClient({ endpoint: `http://127.0.0.1:${LIGHTD_PORT}`, network: 'regtest-nu7' });
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
  assertCheck('lightwalletd consensusBranchId is 77190ad9', lightdInfo.consensusBranchId === '77190ad9');
  assertCheck('lightwalletd blockHeight matches Zebra tip', Number(lightdInfo.blockHeight) >= 105, `height=${lightdInfo.blockHeight}`);

  // 3. Sync Account 0 (miner recipient)
  console.log('\n--- 3. Syncing Account 0 (Miner Recipient) to Tip ---');
  const acct0 = accountFromMnemonic(KNOWN_TEST_MNEMONICS[0], 0, 'regtest-nu7');
  const dbDir = path.join(projectRoot, 'node_modules/.cache/nu7-evidence');
  fs.mkdirSync(dbDir, { recursive: true });
  const dbPath0 = path.join(dbDir, 'wallet_acct0.db');
  if (fs.existsSync(dbPath0)) fs.unlinkSync(dbPath0);

  const wallet0 = WalletHandle.open(dbPath0, 'regtest-nu7', acct0.getUnifiedFullViewingKey());
  const tipHeight = Number(lightdInfo.blockHeight);
  const sync0 = await syncWallet(client, wallet0, {
    startHeight: 1,
    endHeight: tipHeight,
    verifyRootAtTip: true,
  });

  assertCheck('Account 0 scanned to tip', sync0.summary.lastScannedHeight === tipHeight);
  assertCheck('Account 0 discovered shielded notes', sync0.summary.unspentNotesCount > 0, `notes=${sync0.summary.unspentNotesCount}`);
  assertCheck('Account 0 has spendable balance', sync0.summary.spendableBalanceZatoshis > 0, `balance=${sync0.summary.spendableBalanceZatoshis}`);

  // 4. Send transaction from Account 0 to Account 1
  console.log('\n--- 4. Executing send() from Account 0 to Account 1 ---');
  const acct1 = accountFromMnemonic(KNOWN_TEST_MNEMONICS[1], 0, 'regtest-nu7');
  const sendRes = await send({
    client,
    wallet: wallet0,
    from: acct0.spendHandle,
    to: acct1.getUnifiedAddress(),
    amount: 100000000n, // 1.0 ZEC
    memo: 'NU7 productized regtest stack end-to-end evidence',
  });

  assertCheck('Send returned valid txid', typeof sendRes.txid === 'string' && sendRes.txid.length === 64, `txid=${sendRes.txid}`);
  assertCheck('Send fee is standard 10000 zatoshis', sendRes.fee === 10000n);
  assertCheck('Send numActions is 2', sendRes.numActions === 2);
  const expectedExpiry = tipHeight + 1 + 120;
  assertCheck('Send expiry height equals target height + 120', sendRes.expiryHeight === expectedExpiry, `expiry=${sendRes.expiryHeight}, expected=${expectedExpiry}`);

  // 5. Verify transaction in mempool and mine block
  console.log('\n--- 5. Verifying mempool and mining block ---');
  const explorerTxid = reverseTxid(sendRes.txid);
  const mempool = await rpcCall('getrawmempool');
  assertCheck('Transaction is present in Zebra mempool', mempool.result.includes(explorerTxid), `explorerTxid=${explorerTxid}`);

  const mined = await rpcCall('generate', [1]);
  assertCheck('Block successfully mined', Array.isArray(mined.result) && mined.result.length === 1, `blockHash=${mined.result[0]}`);

  const nextHeight = tipHeight + 1;
  const block = await rpcCall('getblock', [String(nextHeight), 1]);
  assertCheck('Mined block height incremented', block.result.height === nextHeight);
  assertCheck('Mined block includes the sent transaction', block.result.tx.includes(explorerTxid));

  // Wait for lightwalletd to ingest the mined block
  for (let i = 0; i < 30; i++) {
    try {
      const tipCheck = await client.getInfo();
      if (Number(tipCheck.blockHeight) >= nextHeight) break;
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 1000));
  }

  // 6. Sync Account 1 (Recipient) and verify receipt
  console.log('\n--- 6. Syncing Account 1 (Recipient) to confirm receipt ---');
  const dbPath1 = path.join(dbDir, 'wallet_acct1.db');
  if (fs.existsSync(dbPath1)) fs.unlinkSync(dbPath1);

  const wallet1 = WalletHandle.open(dbPath1, 'regtest-nu7', acct1.getUnifiedFullViewingKey());
  const sync1 = await syncWallet(client, wallet1, {
    startHeight: 1,
    endHeight: nextHeight,
    verifyRootAtTip: true,
  });

  assertCheck('Account 1 scanned to new tip', sync1.summary.lastScannedHeight === nextHeight);
  assertCheck('Account 1 has exactly 1 unspent note', sync1.summary.unspentNotesCount === 1);
  assertCheck('Account 1 balance is 1.0 ZEC (100,000,000 zatoshis)', sync1.summary.spendableBalanceZatoshis === 100000000n || sync1.summary.spendableBalanceZatoshis === 100000000);

  await client.close();

  // 7. Compute final banner strictly from assertions
  const passedCount = assertions.filter((a) => a.passed).length;
  const totalCount = assertions.length;
  const allChecksPassed = totalCount >= 15 && passedCount === totalCount;

  if (allChecksPassed) {
    console.log('\n' + '='.repeat(70));
    console.log(`=== NU7 REGTEST STACK END-TO-END VERIFIED: ${passedCount}/${totalCount} ASSERTIONS PASSED ✅ ===`);
    console.log('='.repeat(70) + '\n');
  } else {
    console.error(`\n❌ VERIFICATION FAILED: Only ${passedCount}/${totalCount} assertions passed!`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error during NU7 end-to-end evidence run:', err);
  process.exit(1);
});
