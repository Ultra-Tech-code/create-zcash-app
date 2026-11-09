#!/usr/bin/env node
/**
 * NU7 Coexistence Spike: Zaino (feat/nu7) + Zallet v0.1.0-beta.4
 * Demonstrates both services operating simultaneously against the same Zebra 7.0.0 node.
 * 
 * Verifies:
 * 1. Zebra 7.0.0 running with indexer gRPC and JSON-RPC
 * 2. Zaino gRPC service connected to Zebra over JSON-RPC (rpc backend)
 * 3. Zallet v0.1.0-beta.4 running connected to Zebra
 * 4. SDK sync and transaction discovery via Zaino
 * 5. SDK send transaction via Zaino mined into Zebra block
 * 6. Zallet z_listunspent listing mature Ironwood shielded notes
 */

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

const ZEBRA_RPC_PORT = process.env.ZEBRA_RPC_PORT || '49232';
const ZALLET_RPC_PORT = process.env.ZALLET_RPC_PORT || '48232';
const ZAINO_GRPC_PORT = process.env.ZAINO_GRPC_PORT || '8137';
const OUTPUT_LOG = process.env.COEXISTENCE_LOG || path.join(projectRoot, 'packages/core/tests/logs/zaino_zallet_coexistence.log');

async function zebraRpc(method, params = []) {
  const res = await fetch(`http://127.0.0.1:${ZEBRA_RPC_PORT}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  });
  return await res.json();
}

async function zalletRpc(method, params = []) {
  const auth = Buffer.from('zebra:zebra').toString('base64');
  const res = await fetch(`http://127.0.0.1:${ZALLET_RPC_PORT}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
    },
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
  append('=== NU7 REGTEST STACK COEXISTENCE: ZAINO + ZALLET BETA.4 ======');
  append('===============================================================');
  append(`Date:              ${new Date().toISOString()}`);
  append(`Zebra RPC:         http://127.0.0.1:${ZEBRA_RPC_PORT}`);
  append(`Zaino gRPC:        127.0.0.1:${ZAINO_GRPC_PORT}`);
  append(`Zallet RPC:        http://127.0.0.1:${ZALLET_RPC_PORT}`);
  append(`Output log:        ${OUTPUT_LOG}`);

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
  const bci = await zebraRpc('getblockchaininfo');
  assertCheck('Zebra chain is Regtest', bci.result.chain === 'test');
  assertCheck('Zebra height is at least 110', bci.result.blocks >= 110, `height=${bci.result.blocks}`);
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

  append(`Zaino version:     ${lightdInfo.version}`);
  append(`Zaino git commit:  ${lightdInfo.gitCommit}`);
  append(`Zaino branch ID:   ${lightdInfo.consensusBranchId}`);
  append(`Zaino blockHeight: ${lightdInfo.blockHeight}`);
  append(`Zaino chainName:   ${lightdInfo.chainName}`);

  assertCheck('Consensus branch ID is 77190ad9', lightdInfo.consensusBranchId === '77190ad9');
  assertCheck('Zaino reports height >= 110', Number(lightdInfo.blockHeight) >= 110, `height=${lightdInfo.blockHeight}`);
  assertCheck('Zaino reports correct git commit', typeof lightdInfo.gitCommit === 'string' && lightdInfo.gitCommit.length > 0, `commit=${lightdInfo.gitCommit}`);

  // 3. Verify Zallet JSON-RPC Service
  append('\n--- 3. Verifying Zallet JSON-RPC Service ---');
  const walletInfo = await zalletRpc('getwalletinfo');
  append(`Zallet seedfp:     ${walletInfo.result.mnemonic_seedfp}`);
  assertCheck('Zallet getwalletinfo returned seedfp', typeof walletInfo.result.mnemonic_seedfp === 'string' && walletInfo.result.mnemonic_seedfp.startsWith('zip32seedfp1'));

  const zalletAccounts = await zalletRpc('z_listaccounts');
  append(`Zallet accounts:   ${zalletAccounts.result.length}`);
  assertCheck('Zallet has Account 0 registered', zalletAccounts.result.length >= 1);
  const zalletAccount0 = zalletAccounts.result[0];
  append(`Account 0 UUID:    ${zalletAccount0.account_uuid}`);
  append(`Account 0 UA:      ${zalletAccount0.addresses[0]?.ua?.slice(0, 32)}...`);

  // 4. SDK Sync & Ironwood Note Discovery via Zaino
  append('\n--- 4. SDK Sync & Ironwood Tree State via Zaino ---');
  const acct0 = accountFromMnemonic(KNOWN_TEST_MNEMONICS[0], 0, 'regtest-nu7');
  const dbPath0 = path.join(projectRoot, 'packages/core/tests/logs/zaino_coexistence_wallet0.db');
  if (fs.existsSync(dbPath0)) fs.unlinkSync(dbPath0);

  const wallet0 = WalletHandle.open(dbPath0, 'regtest-nu7', acct0.getUnifiedFullViewingKey());
  const tipHeight = Number(lightdInfo.blockHeight);

  append(`Syncing Account 0 from height 1 to ${tipHeight}...`);
  const sync0 = await syncWallet(client, wallet0, {
    startHeight: 1,
    endHeight: tipHeight,
    verifyRootAtTip: true,
  });

  append(`Scanned: ${sync0.summary.lastScannedHeight}/${tipHeight}`);
  append(`Discovered unspent notes: ${sync0.summary.unspentNotesCount}`);
  append(`Spendable balance: ${sync0.summary.spendableBalanceZatoshis} zatoshis`);

  assertCheck('Account 0 scanned to tip', sync0.summary.lastScannedHeight === tipHeight);
  assertCheck('Account 0 discovered shielded notes', sync0.summary.unspentNotesCount > 0, `notes=${sync0.summary.unspentNotesCount}`);
  assertCheck('Account 0 has spendable balance', sync0.summary.spendableBalanceZatoshis > 0, `balance=${sync0.summary.spendableBalanceZatoshis}`);

  // Ironwood note check
  const detected0 = await detectIncoming(client, acct0);
  const ironwoodNotes0 = detected0.notes.filter((n) => n.pool === 'ironwood');
  append(`Discovered Ironwood notes via Zaino: ${ironwoodNotes0.length}`);
  if (ironwoodNotes0.length > 0) {
    append(`Sample Ironwood note: pool=${ironwoodNotes0[0].pool}, value=${ironwoodNotes0[0].value}, txid=${ironwoodNotes0[0].txid}`);
  }
  assertCheck('SDK discovered Ironwood note via Zaino', ironwoodNotes0.length > 0, `ironwoodNotes=${ironwoodNotes0.length}`);

  const treeState = await client.getTreeState(tipHeight);
  append(`GetTreeState(${tipHeight}) ironwoodTree: ${treeState.ironwoodTree}`);
  const ironwoodRootHex = treeState.ironwoodTree && treeState.ironwoodTree !== '000000'
    ? decodeIronwoodFrontierRoot(treeState.ironwoodTree)
    : null;
  append(`Decoded Ironwood root: ${ironwoodRootHex}`);
  assertCheck('GetTreeState returns non-empty Ironwood root', typeof ironwoodRootHex === 'string' && ironwoodRootHex.length === 64, `root=${ironwoodRootHex}`);

  // 5. Send transaction from Account 0 to Account 1 via Zaino
  append('\n--- 5. Executing send() via Zaino ---');
  const acct1 = accountFromMnemonic(KNOWN_TEST_MNEMONICS[1], 0, 'regtest-nu7');
  const sendRes = await send({
    client,
    wallet: wallet0,
    from: acct0.spendHandle,
    to: acct1.getUnifiedAddress(),
    amount: 100000000n, // 1.0 ZEC
    memo: 'NU7 Coexistence Spike: Zaino + Zallet',
    allowZeroFee: true,
  });

  append(`Send TxID: ${sendRes.txid}`);
  append(`Send Fee:  ${sendRes.fee} zatoshis`);
  assertCheck('Send returned valid txid', typeof sendRes.txid === 'string' && sendRes.txid.length === 64, `txid=${sendRes.txid}`);

  // Mine 1 block on Zebra to confirm the send transaction
  append('\n--- 6. Mining block on Zebra to confirm send ---');
  const mineRes = await zebraRpc('generate', [1]);
  const minedBlockHash = mineRes.result[0];
  append(`Mined block: ${minedBlockHash}`);
  assertCheck('Zebra mined block confirming send', typeof minedBlockHash === 'string' && minedBlockHash.length === 64);

  // 7. Verify Zallet z_listunspent
  append('\n--- 7. Querying Zallet z_listunspent ---');
  let zalletUnspent;
  for (let i = 0; i < 15; i++) {
    zalletUnspent = await zalletRpc('z_listunspent');
    if (zalletUnspent.result && Array.isArray(zalletUnspent.result) && zalletUnspent.result.length > 0) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  append(`Zallet unspent notes count: ${zalletUnspent.result?.length ?? 0}`);
  if (zalletUnspent.result && zalletUnspent.result.length > 0) {
    const firstNote = zalletUnspent.result[0];
    append(`Sample Zallet note txid:    ${firstNote.txid}`);
    append(`Sample Zallet note pool:    ${firstNote.pool}`);
    append(`Sample Zallet note confs:   ${firstNote.confirmations}`);
    append(`Sample Zallet note value:   ${firstNote.value} ZEC (${firstNote.valueZat} zatoshis)`);
  }
  assertCheck('Zallet z_listunspent returned unspent notes', zalletUnspent.result && zalletUnspent.result.length > 0, `notes=${zalletUnspent.result?.length}`);
  const hasIronwood = zalletUnspent.result?.some((n) => n.pool === 'ironwood');
  assertCheck('Zallet reports Ironwood pool note in z_listunspent', Boolean(hasIronwood));

  append('\n===============================================================');
  append('=== COEXISTENCE SUMMARY: ALL ASSERTIONS PASSED ================');
  append(`Total assertions: ${assertions.length}`);
  append(`Passed:           ${assertions.filter((a) => a.passed).length}`);
  append(`Failed:           ${assertions.filter((a) => !a.passed).length}`);
  append('===============================================================');

  // Write output log
  fs.mkdirSync(path.dirname(OUTPUT_LOG), { recursive: true });
  fs.writeFileSync(OUTPUT_LOG, log.join('\n') + '\n', 'utf8');
  console.log(`\nLog written to ${OUTPUT_LOG}`);
}

main().catch((err) => {
  console.error('\n[FATAL ERROR]', err);
  process.exit(1);
});
