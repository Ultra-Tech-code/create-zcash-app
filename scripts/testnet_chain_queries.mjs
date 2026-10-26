#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, decodeIronwoodFrontierRoot } from '../packages/sdk/dist/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const outDir = path.join(projectRoot, 'packages', 'core', 'tests', 'logs', 'chain_queries');
fs.mkdirSync(outDir, { recursive: true });

// Read QuickNode URL from .env
const envPath = path.join(projectRoot, '.env');
if (!fs.existsSync(envPath)) {
  console.error('ERROR: .env not found');
  process.exit(1);
}
const envContent = fs.readFileSync(envPath, 'utf8');
const qnMatch = envContent.match(/ZCASH_SECONDARY_ENDPOINT=(.*)/) || envContent.match(/QUICKNODE_.*=(.*)/);
if (!qnMatch) {
  console.error('ERROR: QuickNode endpoint not found in .env');
  process.exit(1);
}
const qnUrl = qnMatch[1].trim();

function redactUrl(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//<redacted_host>/<redacted_token>`;
  } catch {
    return 'https://<redacted_host>/<redacted_token>';
  }
}

async function fetchQn(method, params, id) {
  const res = await fetch(qnUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params })
  });
  return await res.json();
}

async function main() {
  const explorerTxid = '8ca516abc441e6b95783eb4d733e091dc7312fc1f9e42de43273ed906a65095a';
  const internalTxidBuf = Buffer.from(explorerTxid, 'hex').reverse();
  const internalTxid = internalTxidBuf.toString('hex');
  const targetHeight = 4542240;

  console.log('=== TESTNET CHAIN QUERIES ===');
  console.log(`Explorer TxID:  ${explorerTxid}`);
  console.log(`Internal TxID:  ${internalTxid}`);
  console.log(`Target Height:  ${targetHeight}\n`);

  // (a) QuickNode queries
  console.log('--- Querying QuickNode JSON-RPC ---');

  // 1. getblockcount
  const qnBlockCount = await fetchQn('getblockcount', [], 'qn-blockcount');
  const countPath = path.join(outDir, 'quicknode_getblockcount.json');
  fs.writeFileSync(countPath, JSON.stringify(qnBlockCount, null, 2) + '\n');
  console.log(`Saved: ${countPath}`);

  // 2. getblockhash 4542240
  const qnBlockHash = await fetchQn('getblockhash', [targetHeight], 'qn-blockhash');
  const hashPath = path.join(outDir, 'quicknode_getblockhash.json');
  fs.writeFileSync(hashPath, JSON.stringify(qnBlockHash, null, 2) + '\n');
  console.log(`Saved: ${hashPath}`);

  // 3. getrawtransaction verbose
  const qnRawTx = await fetchQn('getrawtransaction', [explorerTxid, 1], 'qn-rawtx');
  const rawTxPath = path.join(outDir, 'quicknode_getrawtransaction.json');
  fs.writeFileSync(rawTxPath, JSON.stringify(qnRawTx, null, 2) + '\n');
  console.log(`Saved: ${rawTxPath}`);

  // (b) lightwalletd queries
  console.log('\n--- Querying testnet.zec.rocks:443 via lightwalletd gRPC ---');
  const client = createClient({ endpoint: 'https://testnet.zec.rocks:443', network: 'testnet' });

  // 1. GetBlock(4542240)
  const grpcBlock = await new Promise((resolve, reject) => {
    client.client.GetBlock({ height: targetHeight }, (err, res) => {
      if (err) reject(err); else resolve(res);
    });
  });

  const blockJson = {
    height: Number(grpcBlock.height),
    hash_explorer_order: Buffer.from(grpcBlock.hash).reverse().toString('hex'),
    hash_raw_bytes_hex: Buffer.from(grpcBlock.hash).toString('hex'),
    prev_hash_explorer_order: Buffer.from(grpcBlock.prevHash).reverse().toString('hex'),
    time: Number(grpcBlock.time),
    header_hex: Buffer.from(grpcBlock.header).toString('hex'),
    vtx_count: grpcBlock.vtx ? grpcBlock.vtx.length : 0,
    vtx: (grpcBlock.vtx || []).map((tx, idx) => ({
      index: idx,
      txid_explorer_order: Buffer.from(tx.txid).reverse().toString('hex'),
      txid_internal_order: Buffer.from(tx.txid).toString('hex')
    }))
  };
  const blockPath = path.join(outDir, 'lightwalletd_getblock.json');
  fs.writeFileSync(blockPath, JSON.stringify(blockJson, null, 2) + '\n');
  console.log(`Saved: ${blockPath}`);

  // 2. GetTransaction(internalTxid)
  const grpcTx = await new Promise((resolve, reject) => {
    client.client.GetTransaction({ hash: internalTxidBuf }, (err, res) => {
      if (err) reject(err); else resolve(res);
    });
  });

  const txDataBuf = Buffer.from(grpcTx.data);
  const txJson = {
    height: Number(grpcTx.height),
    data_length_bytes: txDataBuf.length,
    data_hex: txDataBuf.toString('hex')
  };
  const txPath = path.join(outDir, 'lightwalletd_gettransaction.json');
  fs.writeFileSync(txPath, JSON.stringify(txJson, null, 2) + '\n');
  console.log(`Saved: ${txPath}`);

  await client.close();

  // (c) Computed Summary File
  console.log('\n--- Computing Validation Summary ---');

  // Read root printed in testnet_send_run.log
  const sendRunLogPath = path.join(projectRoot, 'packages', 'core', 'tests', 'logs', 'testnet_send_run.log');
  const sendRunLogContent = fs.readFileSync(sendRunLogPath, 'utf8');
  const rootMatch = sendRunLogContent.match(/Primary Endpoint Root:\s+([a-f0-9]{64})/i);
  const rootInSendRun = rootMatch ? rootMatch[1].toLowerCase() : null;

  const qnBlockHex = qnBlockHash.result;
  const grpcBlockHex = blockJson.hash_explorer_order;
  const blockHashesEqual = (qnBlockHex === grpcBlockHex);

  const qnTxAnchor = qnRawTx.result?.ironwood?.anchor || null;
  // Zebra's RPC displays anchor byte-reversed relative to the root in testnet_send_run.log
  const qnTxAnchorReversed = qnTxAnchor ? Buffer.from(qnTxAnchor, 'hex').reverse().toString('hex') : null;
  const anchorMatchesSendRun = (qnTxAnchorReversed === rootInSendRun);

  const qnExpiry = qnRawTx.result?.expiryheight;
  const expiryMatches = (qnExpiry === 4542278);

  const summary = {
    verified_txid_explorer_order: explorerTxid,
    verified_txid_internal_order: internalTxid,
    mined_height: targetHeight,
    endpoint_quicknode_rpc: redactUrl(qnUrl),
    endpoint_lightwalletd: 'https://testnet.zec.rocks:443',
    checks: {
      block_hashes_equal: {
        quicknode_getblockhash: qnBlockHex,
        lightwalletd_getblock_hash: grpcBlockHex,
        pass: blockHashesEqual
      },
      tx_anchor_matches_send_run_root: {
        raw_anchor_on_chain_zebra_order: qnTxAnchor,
        computed_reversed_anchor: qnTxAnchorReversed,
        root_printed_in_testnet_send_run_log: rootInSendRun,
        pass: anchorMatchesSendRun
      },
      expiry_height_equals_4542278: {
        node_reported_expiry: qnExpiry,
        expected_expiry: 4542278,
        pass: expiryMatches
      }
    },
    all_checks_passed: blockHashesEqual && anchorMatchesSendRun && expiryMatches
  };

  const summaryPath = path.join(outDir, 'summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n');
  console.log(`Saved: ${summaryPath}`);

  console.log('\n--- Summary Verification Result ---');
  console.log(JSON.stringify(summary, null, 2));

  if (!summary.all_checks_passed) {
    console.error('ERROR: One or more validation checks failed!');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal query error:', err);
  process.exit(1);
});
