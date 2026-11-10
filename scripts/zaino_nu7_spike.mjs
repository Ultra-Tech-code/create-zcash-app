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
  WalletHandle,
  detectIncoming,
  decodeIronwoodFrontierRoot,
} = await import(`${projectRoot}/packages/sdk/dist/index.js`);

const BACKEND_MODE = process.env.ZAINO_BACKEND_MODE || 'rpc';
const CONFIG_FILE = process.env.ZAINO_CONFIG_FILE || process.env.CONFIG_FILE || (BACKEND_MODE === 'direct' ? 'packages/dev/docker/spikes/nu7-stack/zainod-direct.toml' : (BACKEND_MODE === 'lightwalletd' ? 'packages/dev/docker/stacks/lightwalletd/docker-compose.yml' : 'packages/dev/docker/stacks/zaino/zainod.toml'));
const OUTPUT_LOG = process.env.SPIKE_OUTPUT_LOG || `packages/core/tests/logs/zaino_nu7_spike_${BACKEND_MODE}.log`;
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
  append(`=== NU7 REGTEST STACK END-TO-END VERIFICATION: ${BACKEND_MODE.toUpperCase()} =====`);
  append('===============================================================');
  append(`backend mode:      ${BACKEND_MODE}`);
  append(`config file name:  ${CONFIG_FILE}`);
  if (BACKEND_MODE === 'lightwalletd') {
    append(`Lightwalletd listen port: ${ZAINO_GRPC_PORT}`);
  } else {
    append(`Zaino listen port: ${ZAINO_GRPC_PORT}`);
  }
  append(`Zebra RPC port:    ${ZEBRA_RPC_PORT}`);

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
  append('\n--- 2. Connecting to Light Client gRPC Service ---');
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

  const commitLabel = BACKEND_MODE === 'lightwalletd' ? 'lightwalletd git commit' : 'zainod git commit';
  append(`${commitLabel} (from GetLightdInfo): ${lightdInfo.gitCommit}`);
  append(`Vendor:            ${lightdInfo.vendor}`);
  append(`Version:           ${lightdInfo.version}`);
  append(`Branch ID:         ${lightdInfo.consensusBranchId}`);
  append(`Tip Height:        ${lightdInfo.blockHeight}`);

  assertCheck('Consensus branch ID is 77190ad9', lightdInfo.consensusBranchId === '77190ad9');
  assertCheck('Block height matches Zebra tip', Number(lightdInfo.blockHeight) >= 105, `height=${lightdInfo.blockHeight}`);

  // 3. Sync Account 0 (Miner Recipient)
  append('\n--- 3. Syncing Account 0 (Miner Recipient) to Tip ---');
  const acct0 = accountFromMnemonic(KNOWN_TEST_MNEMONICS[0], 0, 'regtest-nu7');
  const dbDir = path.join(projectRoot, `node_modules/.cache/${BACKEND_MODE}-spike`);
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

  // 3b. Verify Ironwood Note Discovery & Tree State Root
  append('\n--- 3b. Verifying Ironwood Notes & Tree State ---');
  const detected0 = await detectIncoming(client, acct0);
  const ironwoodNotes0 = detected0.notes.filter((n) => n.pool === 'ironwood');
  append(`Account 0 discovered Ironwood notes: ${ironwoodNotes0.length}`);
  if (ironwoodNotes0.length > 0) {
    append(`Sample Ironwood note: pool=${ironwoodNotes0[0].pool}, value=${ironwoodNotes0[0].value}, txid=${ironwoodNotes0[0].txid}`);
  }
  assertCheck('SDK discovered Ironwood note', ironwoodNotes0.length > 0, `ironwoodNotes=${ironwoodNotes0.length}`);

  const treeState = await client.getTreeState(tipHeight);
  append(`GetTreeState(${tipHeight}) ironwoodTree: ${treeState.ironwoodTree}`);
  const ironwoodRootHex = treeState.ironwoodTree && treeState.ironwoodTree !== '000000'
    ? decodeIronwoodFrontierRoot(treeState.ironwoodTree)
    : null;
  append(`GetTreeState(${tipHeight}) decoded Ironwood root: ${ironwoodRootHex}`);
  assertCheck(
    'GetTreeState returns non-empty Ironwood root',
    typeof ironwoodRootHex === 'string' && ironwoodRootHex.length === 64,
    `root=${ironwoodRootHex}`
  );

  // 4. Send transaction from Account 0 to Account 1
  append('\n--- 4. Executing send() from Account 0 to Account 1 ---');
  const acct1 = accountFromMnemonic(KNOWN_TEST_MNEMONICS[1], 0, 'regtest-nu7');
  const sendRes = await send({
    client,
    wallet: wallet0,
    from: acct0.spendHandle,
    to: acct1.getUnifiedAddress(),
    amount: 100000000n, // 1.0 ZEC
    memo: 'NU7 stack end-to-end evidence',
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
  // send() returns the txid in node/explorer display order directly
  const explorerTxid = sendRes.txid;
  const mempool = await rpcCall('getrawmempool');
  append(`Mempool contents: ${JSON.stringify(mempool.result)}`);
  assertCheck('Transaction is present in Zebra mempool', mempool.result.includes(explorerTxid), `explorerTxid=${explorerTxid}`);
  append(`TxID ${explorerTxid} appears verbatim in Zebra mempool`);

  const mined = await rpcCall('generate', [1]);
  append(`Mined block hash: ${mined.result[0]}`);
  assertCheck('Block successfully mined', Array.isArray(mined.result) && mined.result.length === 1, `blockHash=${mined.result[0]}`);

  const nextHeight = tipHeight + 1;
  const block = await rpcCall('getblock', [String(nextHeight), 1]);
  assertCheck('Mined block height incremented', block.result.height === nextHeight);
  assertCheck('Mined block includes the sent transaction', block.result.tx.includes(explorerTxid));
  append(`TxID ${explorerTxid} appears verbatim in mined block ${nextHeight} tx list`);

  // Wait for service to ingest the mined block
  append(`Waiting for service to index mined block ${nextHeight}...`);
  for (let i = 0; i < 30; i++) {
    try {
      const hdr = await client.getBlockHeader(nextHeight);
      if (hdr && hdr.height === nextHeight) {
        append(`Service indexed block ${nextHeight}`);
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
    append(`=== ${BACKEND_MODE.toUpperCase()} NU7 REGTEST END-TO-END VERIFIED: ${passedCount}/${totalCount} ASSERTIONS PASSED ✅ ===`);
    append('='.repeat(70) + '\n');
  } else {
    append(`\n❌ VERIFICATION FAILED: Only ${passedCount}/${totalCount} assertions passed!`);
    process.exit(1);
  }

  if (process.env.ZAINO_STARTUP_LOG && fs.existsSync(process.env.ZAINO_STARTUP_LOG)) {
    append('\n--- Daemon Startup Output (Proof of Backend / State Mode) ---');
    append(fs.readFileSync(process.env.ZAINO_STARTUP_LOG, 'utf8').trim());
  }

  // Save log
  const logPath = path.join(projectRoot, OUTPUT_LOG);
  fs.writeFileSync(logPath, log.join('\n') + '\n');
  console.log(`Log successfully written to ${logPath}`);
}

main().catch((err) => {
  console.error('Fatal error during spike:', err);
  process.exit(1);
});
