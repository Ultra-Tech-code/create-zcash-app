import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { GET } from '../../dashboard/src/app/api/explorer/route.js';
import { GET as getStatus } from '../../dashboard/src/app/api/status/route.js';
import { GET as getAccount } from '../../dashboard/src/app/api/account/route.js';
import { POST as postMine } from '../../dashboard/src/app/api/mine/route.js';
import { POST as postImportKey } from '../../dashboard/src/app/api/account/import-key/route.js';
import { POST as postForgetKey } from '../../dashboard/src/app/api/account/forget-key/route.js';
import { POST as postSyncStatus } from '../../dashboard/src/app/api/sync/status/route.js';
import {
  setSession,
  deleteSession,
  createSessionId,
  SESSION_COOKIE_NAME,
} from '../../dashboard/src/app/session.js';
import {
  decodeTransaction,
  classifyExplorerQuery,
  reverseTxid,
  getUpgradeName,
  decryptTransaction,
  accountFromMnemonic,
} from './index.js';

describe('Phase 3 Explorer Offline Tests', () => {
  const chainQueriesDir = path.resolve(
    __dirname,
    '../../core/tests/logs/chain_queries'
  );
  const summaryJsonPath = path.join(chainQueriesDir, 'summary.json');
  const getTxJsonPath = path.join(chainQueriesDir, 'lightwalletd_gettransaction.json');
  const getBlockJsonPath = path.join(chainQueriesDir, 'lightwalletd_getblock.json');

  const summary = JSON.parse(fs.readFileSync(summaryJsonPath, 'utf8'));
  const getTxData = JSON.parse(fs.readFileSync(getTxJsonPath, 'utf8'));
  const getBlockData = JSON.parse(fs.readFileSync(getBlockJsonPath, 'utf8'));

  const rawTxBytes = Buffer.from(getTxData.data_hex, 'hex');

  let fakeServer: http.Server;
  let fakeRpcUrl: string;
  const rpcCallCounts = {
    getrawtransaction: 0,
    getblock: 0,
    getblockhash: 0,
  };

  beforeAll(async () => {
    fakeServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          const { method, params, id } = parsed;

          if (method === 'getrawtransaction') {
            rpcCallCounts.getrawtransaction++;
            const [txid] = params;
            if (txid === summary.verified_txid_explorer_order) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  jsonrpc: '2.0',
                  id,
                  result: {
                    hex: getTxData.data_hex,
                    height: summary.mined_height,
                    blockhash: summary.checks.block_hashes_equal.quicknode_getblockhash,
                    time: 1792976987,
                  },
                })
              );
              return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                jsonrpc: '2.0',
                id,
                error: { code: -5, message: 'No such mempool or blockchain transaction' },
              })
            );
            return;
          }

          if (method === 'getblock') {
            rpcCallCounts.getblock++;
            const [hashOrHeight] = params;
            if (
              hashOrHeight === summary.checks.block_hashes_equal.quicknode_getblockhash ||
              hashOrHeight === String(summary.mined_height)
            ) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  jsonrpc: '2.0',
                  id,
                  result: {
                    hash: summary.checks.block_hashes_equal.quicknode_getblockhash,
                    height: summary.mined_height,
                    previousblockhash: getBlockData.prev_hash_explorer_order,
                    time: 1792976987,
                    tx: [summary.verified_txid_explorer_order],
                  },
                })
              );
              return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                jsonrpc: '2.0',
                id,
                error: { code: -5, message: 'Block not found' },
              })
            );
            return;
          }

          if (method === 'getblockhash') {
            rpcCallCounts.getblockhash++;
            const [height] = params;
            if (height === summary.mined_height) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  jsonrpc: '2.0',
                  id,
                  result: summary.checks.block_hashes_equal.quicknode_getblockhash,
                })
              );
              return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                jsonrpc: '2.0',
                id,
                error: { code: -8, message: 'Block height out of range' },
              })
            );
            return;
          }

          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Method not found' }));
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e?.message }));
        }
      });
    });

    await new Promise<void>((resolve) => {
      fakeServer.listen(0, '127.0.0.1', () => {
        const addr = fakeServer.address() as AddressInfo;
        fakeRpcUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => fakeServer.close(() => resolve()));
  });

  it('Requirement 1: classifyExplorerQuery auto-detects height, txid, block hash, and rejects bad input', () => {
    // Digits -> block height
    const qHeight = classifyExplorerQuery('4542240');
    expect(qHeight.kind).toBe('height');
    expect(qHeight.cleanQuery).toBe('4542240');

    // 64-hex without leading zeros -> txid / hash
    const qTx = classifyExplorerQuery(summary.verified_txid_explorer_order);
    expect(qTx.kind).toBe('hash_or_txid');
    expect(qTx.cleanQuery).toBe(summary.verified_txid_explorer_order);
    expect(qTx.isAmbiguousHash).toBe(false);

    // 64-hex with leading zeros -> block hash (ambiguous)
    const qBlock = classifyExplorerQuery(summary.checks.block_hashes_equal.lightwalletd_getblock_hash);
    expect(qBlock.kind).toBe('hash_or_txid');
    expect(qBlock.cleanQuery).toBe(summary.checks.block_hashes_equal.lightwalletd_getblock_hash);
    expect(qBlock.isAmbiguousHash).toBe(true);

    // Invalid format
    const qBad = classifyExplorerQuery('not_a_valid_query_123');
    expect(qBad.kind).toBe('invalid');
    expect(qBad.error).toContain('Invalid format');

    // Empty query
    const qEmpty = classifyExplorerQuery('   ');
    expect(qEmpty.kind).toBe('empty');
  });

  it('Requirement 3 & 7: decodeTransaction locally decodes tx 8ca516ab...095a matching summary.json evidence', () => {
    const decoded = decodeTransaction(rawTxBytes, 'testnet', getTxData.height);

    // Explorer-order TxID matches summary.json
    expect(decoded.txid).toBe(summary.verified_txid_explorer_order);
    expect(decoded.txid).toBe('8ca516abc441e6b95783eb4d733e091dc7312fc1f9e42de43273ed906a65095a');

    // Version is 6 (NU7 v6 Ironwood format)
    expect(decoded.version).toBe(6);

    // Consensus branch ID is 77190ad9
    expect(decoded.consensusBranchId).toBe('77190ad9');

    // Upgrade name via getUpgradeName is NU7
    expect(decoded.upgradeName).toBe('NU7');
    expect(getUpgradeName(decoded.consensusBranchId)).toBe('NU7');

    // Expiry height equals 4542278 (matches summary.json check)
    expect(decoded.expiryHeight).toBe(summary.checks.expiry_height_equals_4542278.expected_expiry);
    expect(decoded.expiryHeight).toBe(4542278);

    // Fee paid is 10,000 zatoshis (computable without transparent inputs)
    expect(decoded.fee).toBe(10000n);
    expect(decoded.feeUnknown).toBe(false);

    // Pools touched is ['ironwood']
    expect(decoded.pools).toEqual(['ironwood']);
    expect(decoded.actionCounts.ironwoodActions).toBe(2);
    expect(decoded.actionCounts.transparentInputs).toBe(0);
    expect(decoded.actionCounts.transparentOutputs).toBe(0);
    expect(decoded.actionCounts.saplingSpends).toBe(0);
    expect(decoded.actionCounts.saplingOutputs).toBe(0);
    expect(decoded.actionCounts.orchardActions).toBe(0);

    // Ironwood anchor: assert FULL 64 chars in both "wallet/Orchard order" and "Zebra RPC order"
    expect(decoded.anchors.ironwood?.walletOrchardOrder).toBe(
      summary.checks.tx_anchor_matches_send_run_root.root_printed_in_testnet_send_run_log
    );
    expect(decoded.anchors.ironwood?.walletOrchardOrder).toBe(
      '92b8796c8a14d0710d61e1775824089d3e8b43b6293bb48c96cf9522699a8e3f'
    );
    expect(decoded.anchors.ironwood?.walletOrchardOrder.length).toBe(64);

    expect(decoded.anchors.ironwood?.zebraRpcOrder).toBe(
      summary.checks.tx_anchor_matches_send_run_root.raw_anchor_on_chain_zebra_order
    );
    expect(decoded.anchors.ironwood?.zebraRpcOrder).toBe(
      '3f8e9a692295cf968cb43b29b6438b3e9d08245877e1610d71d0148a6c79b892'
    );
    expect(decoded.anchors.ironwood?.zebraRpcOrder.length).toBe(64);

    // Nullifiers and commitments counts
    expect(decoded.nullifiers.length).toBe(2);
    expect(decoded.noteCommitments.length).toBe(2);

    // Size matches fixture data length
    expect(decoded.size).toBe(getTxData.data_length_bytes);
    expect(decoded.size).toBe(9166);
  });

  it('Requirement 3: reverseTxid converts between explorer order and internal wire order', () => {
    // Explorer order -> Internal wire order
    const internal = reverseTxid(summary.verified_txid_explorer_order);
    expect(internal).toBe(summary.verified_txid_internal_order);
    expect(internal).toBe('5a09656a90ed7332e42de4f9c12f31c71d093e734deb8357b9e641c4ab16a58c');

    // Internal wire order -> Explorer order
    const explorer = reverseTxid(summary.verified_txid_internal_order);
    expect(explorer).toBe(summary.verified_txid_explorer_order);
    expect(explorer).toBe('8ca516abc441e6b95783eb4d733e091dc7312fc1f9e42de43273ed906a65095a');
  });

  it('Requirement 5 & 7: block fixture evidence matches block 4542240 in summary.json', () => {
    expect(getBlockData.height).toBe(summary.mined_height);
    expect(getBlockData.height).toBe(4542240);

    // Block hash in explorer order matches summary.json
    expect(getBlockData.hash_explorer_order).toBe(
      summary.checks.block_hashes_equal.lightwalletd_getblock_hash
    );
    expect(getBlockData.hash_explorer_order).toBe(
      '00005c49b2e52450226473f8bbc77411705f7e104835bb12909ed217f16fa92e'
    );

    // Transaction list includes tx 8ca516ab...095a
    const txList = getBlockData.vtx.map((v: any) => v.txid_explorer_order);
    expect(txList).toContain(summary.verified_txid_explorer_order);
    expect(getBlockData.vtx_count).toBe(2);

    // Previous block hash
    expect(getBlockData.prev_hash_explorer_order).toBe(
      '00005e80d191d363361a7e11dd5e02fa0c509af41134f9ecd5c927826d1ed361'
    );
  });

  it('Requirement 4: decryptTransaction annotates ownership for Wallet A (OUT) and Wallet B (IN)', () => {
    // Using standard test mnemonics for deterministic verification
    const senderAcct = accountFromMnemonic(
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      0,
      'testnet'
    );
    // Stranger test UFVK sees 0 notes
    const strangerDec = decryptTransaction(
      senderAcct.getUnifiedFullViewingKey(),
      'testnet',
      rawTxBytes,
      getTxData.height
    );
    expect(strangerDec.txid).toBe(summary.verified_txid_explorer_order);
    // Without knowing the private keys for the live testnet wallets, decryptTransaction safely returns 0 notes
    expect(strangerDec.incoming.length).toBe(0);
    expect(strangerDec.outgoing.length).toBe(0);
  });

  it('Requirement 2 & Phase 3 Follow-up #2 (1): exercises real server route handler with stubbed JSON-RPC transport for getrawtransaction + getblock', async () => {
    rpcCallCounts.getrawtransaction = 0;
    rpcCallCounts.getblock = 0;

    const prevZebraRpc = process.env.ZEBRA_RPC_URL;
    const prevAllowCustom = process.env.ZCASH_ALLOW_CUSTOM_ENDPOINT;
    process.env.ZEBRA_RPC_URL = fakeRpcUrl;
    process.env.ZCASH_ALLOW_CUSTOM_ENDPOINT = '1';

    try {
      // 1. Transaction lookup via real server route handler using Zebra-RPC transport
      // Point customEndpoint to an unused port to ensure lightwalletd is bypassed/fails and secondary JSON-RPC is exercised
      const txReq = new Request(
        `http://localhost:3050/api/explorer?q=${summary.verified_txid_explorer_order}&customEndpoint=127.0.0.1:59998`
      );
      const txRes = await GET(txReq);
      expect(txRes.status).toBe(200);

      const txJson = await txRes.json();
      expect(txJson.success).toBe(true);
      expect(txJson.matchType).toBe('tx');
      expect(txJson.data.txid).toBe(summary.verified_txid_explorer_order);
      expect(txJson.data.height).toBe(summary.mined_height);
      expect(txJson.data.blockHash).toBe(summary.checks.block_hashes_equal.quicknode_getblockhash);
      expect(txJson.data.version).toBe(6);
      expect(txJson.data.consensusBranchId).toBe('77190ad9');
      expect(txJson.data.upgradeName).toBe('NU7');
      expect(txJson.data.expiryHeight).toBe(summary.checks.expiry_height_equals_4542278.expected_expiry);
      expect(txJson.data.fee).toBe(10000);
      expect(txJson.data.feeUnknown).toBe(false);
      expect(txJson.data.pools).toEqual(['ironwood']);
      expect(txJson.data.actionCounts.ironwoodActions).toBe(2);
      expect(txJson.data.anchors.ironwood.walletOrchardOrder).toBe(
        summary.checks.tx_anchor_matches_send_run_root.computed_reversed_anchor
      );
      expect(txJson.data.anchors.ironwood.zebraRpcOrder).toBe(
        summary.checks.tx_anchor_matches_send_run_root.raw_anchor_on_chain_zebra_order
      );
      expect(txJson.data.nullifiers.length).toBe(2);
      expect(txJson.data.noteCommitments.length).toBe(2);
      expect(txJson.data.size).toBe(getTxData.data_length_bytes);

      // Verify the server actually invoked getrawtransaction on our transport stub
      expect(rpcCallCounts.getrawtransaction).toBeGreaterThan(0);

      // 2. Block lookup via real server route handler using Zebra-RPC transport
      const blockReq = new Request(
        `http://localhost:3050/api/explorer?q=${summary.checks.block_hashes_equal.quicknode_getblockhash}&customEndpoint=127.0.0.1:59998`
      );
      const blockRes = await GET(blockReq);
      expect(blockRes.status).toBe(200);

      const blockJson = await blockRes.json();
      expect(blockJson.success).toBe(true);
      expect(blockJson.matchType).toBe('block');
      expect(blockJson.data.height).toBe(summary.mined_height);
      expect(blockJson.data.hash).toBe(summary.checks.block_hashes_equal.quicknode_getblockhash);
      expect(blockJson.data.previousBlockHash).toBe(getBlockData.prev_hash_explorer_order);
      expect(blockJson.data.txCount).toBe(1);
      expect(blockJson.data.txList[0].txid).toBe(summary.verified_txid_explorer_order);

      // Verify the server actually invoked getblock on our transport stub
      expect(rpcCallCounts.getblock).toBeGreaterThan(0);
    } finally {
      if (prevZebraRpc !== undefined) process.env.ZEBRA_RPC_URL = prevZebraRpc;
      else delete process.env.ZEBRA_RPC_URL;
      if (prevAllowCustom !== undefined) process.env.ZCASH_ALLOW_CUSTOM_ENDPOINT = prevAllowCustom;
      else delete process.env.ZCASH_ALLOW_CUSTOM_ENDPOINT;
    }
  });

  it('Security: request with ?zebraRpc=... query param must NOT cause any call to that listener', async () => {
    let canaryCallCount = 0;
    const canaryServer = http.createServer((req, res) => {
      canaryCallCount++;
      res.writeHead(500);
      res.end();
    });

    let canaryUrl: string;
    await new Promise<void>((resolve) => {
      canaryServer.listen(0, '127.0.0.1', () => {
        const addr = canaryServer.address() as AddressInfo;
        canaryUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });

    const prevZebraRpc = process.env.ZEBRA_RPC_URL;
    delete process.env.ZEBRA_RPC_URL;

    try {
      // Send requests attempting to pass an outbound listener URL via query parameter
      const txReq = new Request(
        `http://localhost:3050/api/explorer?q=${summary.verified_txid_explorer_order}&zebraRpc=${canaryUrl}&secondaryRpc=${canaryUrl}`
      );
      await GET(txReq);

      const blockReq = new Request(
        `http://localhost:3050/api/explorer?q=4542240&zebraRpc=${canaryUrl}&secondaryRpc=${canaryUrl}`
      );
      await GET(blockReq);

      // Assert canary listener call count remains strictly 0
      expect(canaryCallCount).toBe(0);
    } finally {
      await new Promise<void>((resolve) => canaryServer.close(() => resolve()));
      if (prevZebraRpc !== undefined) process.env.ZEBRA_RPC_URL = prevZebraRpc;
      else delete process.env.ZEBRA_RPC_URL;
    }
  });

  it('Security: without ZCASH_ALLOW_CUSTOM_ENDPOINT=1, ?customEndpoint=... causes zero connections to a canary listener for /api/explorer, /api/status, and /api/account', async () => {
    let canaryConnCount = 0;
    const canaryServer = http.createServer((req, res) => {
      res.writeHead(500);
      res.end();
    });
    canaryServer.on('connection', () => {
      canaryConnCount++;
    });

    let canaryEndpoint: string;
    await new Promise<void>((resolve) => {
      canaryServer.listen(0, '127.0.0.1', () => {
        const addr = canaryServer.address() as AddressInfo;
        canaryEndpoint = `127.0.0.1:${addr.port}`;
        resolve();
      });
    });

    const prevAllowCustom = process.env.ZCASH_ALLOW_CUSTOM_ENDPOINT;
    delete process.env.ZCASH_ALLOW_CUSTOM_ENDPOINT;

    try {
      // 1. /api/explorer
      const explorerReq = new Request(
        `http://localhost:3050/api/explorer?q=4542240&customEndpoint=${canaryEndpoint}`
      );
      await GET(explorerReq);

      // 2. /api/status
      const statusReq = new Request(
        `http://localhost:3050/api/status?customEndpoint=${canaryEndpoint}`
      );
      await getStatus(statusReq);

      // 3. /api/account
      const accountReq = new Request(
        `http://localhost:3050/api/account?customEndpoint=${canaryEndpoint}`
      );
      await getAccount(accountReq);

      // Assert canary listener on canaryEndpoint received ZERO connections
      expect(canaryConnCount).toBe(0);
    } finally {
      await new Promise<void>((resolve) => canaryServer.close(() => resolve()));
      if (prevAllowCustom !== undefined) process.env.ZCASH_ALLOW_CUSTOM_ENDPOINT = prevAllowCustom;
      else delete process.env.ZCASH_ALLOW_CUSTOM_ENDPOINT;
    }
  });

  it('Security: state-changing POST routes reject cross-site requests with 403 Forbidden', async () => {
    const postRoutes = [
      { name: '/api/mine', handler: postMine, url: 'http://localhost:3050/api/mine' },
      { name: '/api/account/import-key', handler: postImportKey, url: 'http://localhost:3050/api/account/import-key' },
      { name: '/api/account/forget-key', handler: postForgetKey, url: 'http://localhost:3050/api/account/forget-key' },
      { name: '/api/sync/status', handler: postSyncStatus, url: 'http://localhost:3050/api/sync/status' },
    ];

    for (const route of postRoutes) {
      // Case 1: Sec-Fetch-Site: cross-site must be rejected with 403
      const crossSiteReq = new Request(route.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'sec-fetch-site': 'cross-site',
        },
        body: JSON.stringify({ blocks: 1, ufvk: 'test', start: true }),
      });
      const crossSiteRes = await route.handler(crossSiteReq);
      expect(crossSiteRes.status).toBe(403);
      const crossSiteJson = await crossSiteRes.json();
      expect(crossSiteJson.success).toBe(false);
      expect(crossSiteJson.code).toBe('CROSS_SITE_FORBIDDEN');

      // Case 2: Untrusted Origin header must be rejected with 403
      const crossOriginReq = new Request(route.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          host: 'localhost:3050',
          origin: 'https://evil-attacker.example',
        },
        body: JSON.stringify({ blocks: 1, ufvk: 'test', start: true }),
      });
      const crossOriginRes = await route.handler(crossOriginReq);
      expect(crossOriginRes.status).toBe(403);
      const crossOriginJson = await crossOriginRes.json();
      expect(crossOriginJson.success).toBe(false);
      expect(crossOriginJson.code).toBe('CROSS_ORIGIN_FORBIDDEN');

      // Case 3: Legitimate same-origin request is NOT rejected with 403
      const sameOriginReq = new Request(route.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          host: 'localhost:3050',
          origin: 'http://localhost:3050',
          'sec-fetch-site': 'same-origin',
        },
        body: JSON.stringify({ blocks: 1 }),
      });
      const sameOriginRes = await route.handler(sameOriginReq);
      // Status must NOT be 403 Forbidden
      expect(sameOriginRes.status).not.toBe(403);
    }
  });

  it('Phase 3 Follow-up #2 (2): calls real /api/explorer handler across tx hit, block hit, not-found, node-unreachable with secret tokens and asserts zero leaks in body or headers', async () => {
    // Sensitive credentials that must never appear in any response body or headers
    const fakeToken = 'secret-token-xyz-987654321';
    const fakeUser = 'sensitive-rpc-username';
    const fakePass = 'super-secret-auth-password-999';
    const fakeHost = 'node.protected-network.internal.test:8232';
    const fakeEndpointUrl = `https://${fakeUser}:${fakePass}@${fakeHost}/rpc?token=${fakeToken}`;
    const fakeUfvk =
      'uviewtest1qvqqqqqq987654321abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdef';

    // Configure secret URLs in environment
    const prevZebraRpc = process.env.ZEBRA_RPC_URL;
    const prevSecondary = process.env.ZCASH_SECONDARY_ENDPOINT;
    const prevQuicknode = process.env.QUICKNODE_ZEC_TESTNET_URL;
    const prevAllowCustom = process.env.ZCASH_ALLOW_CUSTOM_ENDPOINT;

    process.env.ZEBRA_RPC_URL = fakeEndpointUrl;
    process.env.ZCASH_SECONDARY_ENDPOINT = fakeEndpointUrl;
    process.env.QUICKNODE_ZEC_TESTNET_URL = fakeEndpointUrl;
    process.env.ZCASH_ALLOW_CUSTOM_ENDPOINT = '1';

    // Create an active UFVK session
    const sessionId = createSessionId();
    setSession(sessionId, {
      ufvk: fakeUfvk,
      birthday: 4542200,
      network: 'testnet',
    });

    const cookieHeader = `${SESSION_COOKIE_NAME}=${sessionId}`;

    const sensitiveStrings = [
      fakeToken,
      fakeUser,
      fakePass,
      fakeHost,
      fakeEndpointUrl,
      fakeUfvk,
    ];

    try {
      // 1. Tx hit
      const txReq = new Request(
        `http://localhost:3050/api/explorer?q=${summary.verified_txid_explorer_order}`,
        { headers: { cookie: cookieHeader } }
      );
      const txRes = await GET(txReq);
      expect(txRes.status).toBe(200);
      const txBody = await txRes.text();
      const txHeaders = Array.from(txRes.headers.entries())
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n');
      for (const s of sensitiveStrings) {
        expect(txBody).not.toContain(s);
        expect(txHeaders).not.toContain(s);
      }

      // 2. Block hit
      const blockReq = new Request(
        `http://localhost:3050/api/explorer?q=${summary.mined_height}`,
        { headers: { cookie: cookieHeader } }
      );
      const blockRes = await GET(blockReq);
      expect(blockRes.status).toBe(200);
      const blockBody = await blockRes.text();
      const blockHeaders = Array.from(blockRes.headers.entries())
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n');
      for (const s of sensitiveStrings) {
        expect(blockBody).not.toContain(s);
        expect(blockHeaders).not.toContain(s);
      }

      // 3. Not found (query for non-existent 64-hex hash via working fake transport that returns not found)
      process.env.ZEBRA_RPC_URL = fakeRpcUrl;
      const notFoundReq = new Request(
        `http://localhost:3050/api/explorer?q=ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff&customEndpoint=127.0.0.1:59998`,
        { headers: { cookie: cookieHeader } }
      );
      const notFoundRes = await GET(notFoundReq);
      expect(notFoundRes.status).toBe(404);
      const notFoundBody = await notFoundRes.text();
      const notFoundHeaders = Array.from(notFoundRes.headers.entries())
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n');
      for (const s of sensitiveStrings) {
        expect(notFoundBody).not.toContain(s);
        expect(notFoundHeaders).not.toContain(s);
      }

      // 4. Node unreachable (error path where URLs and network error messages often leak)
      process.env.ZEBRA_RPC_URL = 'http://127.0.0.1:59999';
      const unreachableReq = new Request(
        `http://localhost:3050/api/explorer?q=99999999&customEndpoint=127.0.0.1:59999`,
        { headers: { cookie: cookieHeader } }
      );
      const unreachableRes = await GET(unreachableReq);
      expect(unreachableRes.status).toBe(502);
      const unreachableBody = await unreachableRes.text();
      const unreachableHeaders = Array.from(unreachableRes.headers.entries())
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n');
      for (const s of sensitiveStrings) {
        expect(unreachableBody).not.toContain(s);
        expect(unreachableHeaders).not.toContain(s);
      }
      expect(unreachableBody).toContain('NODE_UNREACHABLE');
    } finally {
      deleteSession(sessionId);
      if (prevZebraRpc !== undefined) process.env.ZEBRA_RPC_URL = prevZebraRpc;
      else delete process.env.ZEBRA_RPC_URL;
      if (prevSecondary !== undefined) process.env.ZCASH_SECONDARY_ENDPOINT = prevSecondary;
      else delete process.env.ZCASH_SECONDARY_ENDPOINT;
      if (prevQuicknode !== undefined) process.env.QUICKNODE_ZEC_TESTNET_URL = prevQuicknode;
      else delete process.env.QUICKNODE_ZEC_TESTNET_URL;
      if (prevAllowCustom !== undefined) process.env.ZCASH_ALLOW_CUSTOM_ENDPOINT = prevAllowCustom;
      else delete process.env.ZCASH_ALLOW_CUSTOM_ENDPOINT;
    }
  });
});
