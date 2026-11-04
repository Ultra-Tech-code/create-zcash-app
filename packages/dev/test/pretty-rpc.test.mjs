/**
 * Inspired by zebraUtilities by dismad (MIT License, (c) dismad)
 * https://github.com/dismad/zebraUtilities
 * Reimplemented in TypeScript for zcash-dev.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  formatZec,
  parseZecAmountToZatoshis,
  formatZatoshis,
  toZatoshis,
  formatTimestamp,
  stripAnsi,
  visualLength,
  padRight,
  padLeft,
  createColors,
  formatSupply,
  parseSupplyInfo,
  formatBlock,
  formatTx,
  formatTxSummaryLine,
  parseTxDetails,
  formatPeers,
  formatMempool,
  ZebraRpcClient,
} from '../dist/pretty/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.resolve(__dirname, 'fixtures');

function loadFixture(filename) {
  const filePath = path.join(fixturesDir, filename);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

describe('Pretty RPC & Formatters Unit Tests', () => {
  const bciFixture = loadFixture('blockchaininfo.json');
  const b108Fixture = loadFixture('block-108.json');
  const b107Fixture = loadFixture('block-107.json');
  const txCoinbaseFixture = loadFixture('tx-coinbase.json');
  const txPaymentFixture = loadFixture('tx-payment-ironwood.json');
  const txMempoolFixture = loadFixture('tx-mempool.json');
  const subsidy108Fixture = loadFixture('blocksubsidy-108.json');
  const peerinfoFixture = loadFixture('peerinfo.json');
  const mempoolFixture = loadFixture('mempool.json');

  // =========================================================================
  // RULE 1: BigInt zatoshis end to end (no floats, no bc, no scientific notation)
  // =========================================================================
  describe('Rule 1: BigInt Zatoshis End-to-End', () => {
    it('formats zatoshis to exact ZEC string without floating point drift', () => {
      assert.equal(formatZec(0n), '0.00000000');
      assert.equal(formatZec(1n), '0.00000001');
      assert.equal(formatZec(100000000n), '1.00000000');
      assert.equal(formatZec(208333333n), '2.08333333');
      assert.equal(formatZec(-10000n), '-0.00010000');
      assert.equal(formatZec(-208337333n), '-2.08337333');
      // Very large supply (e.g. 21 million ZEC in zatoshis)
      assert.equal(formatZec(2100000000000000n), '21000000.00000000');
    });

    it('parses ZEC decimal string to BigInt zatoshis without float pitfalls', () => {
      assert.equal(parseZecAmountToZatoshis('0'), 0n);
      assert.equal(parseZecAmountToZatoshis('1.0'), 100000000n);
      assert.equal(parseZecAmountToZatoshis('2.08333333'), 208333333n);
      assert.equal(parseZecAmountToZatoshis('0.0001'), 10000n);
      assert.equal(parseZecAmountToZatoshis('0.00000001'), 1n);
      assert.equal(parseZecAmountToZatoshis('-2.08337333'), -208337333n);
    });

    it('formats zatoshis with comma thousand separators', () => {
      assert.equal(formatZatoshis(0n), '0');
      assert.equal(formatZatoshis(10000n), '10,000');
      assert.equal(formatZatoshis(208333333n), '208,333,333');
      assert.equal(formatZatoshis(23749969963n), '23,749,969,963');
      assert.equal(formatZatoshis(-208337333n), '-208,337,333');
    });

    it('extracts zatoshis reliably via toZatoshis', () => {
      assert.equal(toZatoshis(625000000), 625000000n);
      assert.equal(toZatoshis('625000000'), 625000000n);
      assert.equal(toZatoshis(undefined, '6.25'), 625000000n);
      assert.equal(toZatoshis(null, null), 0n);
    });
  });

  // =========================================================================
  // RULE 2: getblockchaininfo.valuePools looked up by id, never array index
  // =========================================================================
  describe('Rule 2: Pool Lookup by ID and Unknown Pool Handling', () => {
    it('looks up pools by id regardless of array ordering', () => {
      const reversedBci = {
        ...bciFixture,
        valuePools: [...bciFixture.valuePools].reverse(),
      };

      const parsedNormal = parseSupplyInfo(bciFixture);
      const parsedReversed = parseSupplyInfo(reversedBci);

      assert.equal(parsedReversed.totalChainSupplyZat, parsedNormal.totalChainSupplyZat);
      assert.equal(parsedReversed.totalShieldedSupplyZat, parsedNormal.totalShieldedSupplyZat);

      // Verify each pool has identical balance
      for (const pool of parsedNormal.pools) {
        const matching = parsedReversed.pools.find((p) => p.id === pool.id);
        assert.ok(matching, `Pool ${pool.id} should be found`);
        assert.equal(matching.chainValueZat, pool.chainValueZat);
        assert.equal(matching.monitored, pool.monitored);
      }
    });

    it('handles missing pools without crashing', () => {
      const partialBci = {
        chain: 'regtest',
        blocks: 10,
        valuePools: [
          { id: 'ironwood', chainValueZat: 500000000, monitored: true },
        ],
      };
      const parsed = parseSupplyInfo(partialBci);
      assert.equal(parsed.totalShieldedSupplyZat, 500000000n);

      const saplingPool = parsed.pools.find((p) => p.id === 'sapling');
      assert.ok(saplingPool);
      assert.equal(saplingPool.chainValueZat, 0n);
      assert.equal(saplingPool.monitored, false);

      const out = formatSupply(partialBci, { noColor: true });
      assert.match(out, /Ironwood\s+5\.00000000/);
      assert.match(out, /Sapling\s+0\.00000000/);
    });

    it('handles unknown future pools cleanly with their id', () => {
      const futureBci = {
        chain: 'test',
        blocks: 999,
        valuePools: [
          ...bciFixture.valuePools,
          { id: 'quantum', chainValueZat: 123456789, monitored: true },
        ],
      };
      const parsed = parseSupplyInfo(futureBci);
      const quantumPool = parsed.pools.find((p) => p.id === 'quantum');
      assert.ok(quantumPool);
      assert.equal(quantumPool.name, 'Quantum');
      assert.equal(quantumPool.chainValueZat, 123456789n);
      assert.equal(quantumPool.monitored, true);

      const formatted = formatSupply(futureBci, { noColor: true });
      assert.match(formatted, /Quantum\s+1\.23456789/);
    });
  });

  // =========================================================================
  // RULE 3: Timestamps formatted as UTC ISO-8601 by default, with --local
  // =========================================================================
  describe('Rule 3: UTC ISO-8601 vs Local Timestamps', () => {
    const sampleUnix = 1296688622; // Block 108 time

    it('formats default timestamp as UTC ISO-8601 ending with Z', () => {
      const formatted = formatTimestamp(sampleUnix, false);
      assert.match(formatted, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      assert.equal(formatted, '2011-02-02T23:17:02Z');
    });

    it('formats local timestamp with timezone offset when local=true', () => {
      const formatted = formatTimestamp(sampleUnix, true);
      assert.match(formatted, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    });

    it('handles missing or invalid timestamps gracefully', () => {
      assert.equal(formatTimestamp(NaN), 'n/a');
    });
  });

  // =========================================================================
  // RULE 4: Ironwood pool in transactions detected and displayed
  // =========================================================================
  describe('Rule 4: Ironwood Pool Detection & Display', () => {
    it('detects Ironwood in NU7 coinbase transaction', () => {
      const parsed = parseTxDetails(txCoinbaseFixture);
      assert.ok(parsed.isCoinbase);
      assert.deepEqual(parsed.pools, ['Ironwood']);
      assert.equal(parsed.ironwoodActionsCount, 1);
      assert.equal(parsed.ironwoodValueBalanceZat, -208337333n);
      assert.equal(parsed.orchardActionsCount, 0);

      const out = formatTx(txCoinbaseFixture, { subsidyZat: 208333333n }, { noColor: true });
      assert.match(out, /Pools:\s+Ironwood/);
      assert.match(out, /Ironwood:\s+1 action\(s\), value balance: -2\.08337333 ZEC/);
    });

    it('detects Ironwood in NU7 payment transaction', () => {
      const parsed = parseTxDetails(txPaymentFixture);
      assert.equal(parsed.isCoinbase, false);
      assert.deepEqual(parsed.pools, ['Ironwood']);
      assert.equal(parsed.ironwoodActionsCount, 2);
      assert.equal(parsed.ironwoodValueBalanceZat, 10000n);

      const out = formatTx(txPaymentFixture, {}, { noColor: true });
      assert.match(out, /Pools:\s+Ironwood/);
      assert.match(out, /Ironwood:\s+2 action\(s\), value balance: \+0\.00010000 ZEC/);
    });
  });

  // =========================================================================
  // RULE 5: Fee calculation: transparent inputs - outputs + value balances
  // =========================================================================
  describe('Rule 5: Fee Calculation & Unresolved Transparent Inputs', () => {
    it('calculates fee accurately for shielded Ironwood transaction', () => {
      const parsed = parseTxDetails(txPaymentFixture);
      assert.equal(parsed.feeZat, 10000n);
      assert.equal(parsed.feeDisplay, '0.00010000 ZEC (10,000 zatoshis)');
    });

    it('calculates coinbase fee as subsidy - outputs', () => {
      // For block 108 coinbase:
      // subsidy = 208333333 zatoshis
      // output into Ironwood = 208337333 zatoshis
      // subsidy - outputs = 208333333 - 208337333 = -4000 zatoshis
      const subsidyZat = 208333333n;
      const parsed = parseTxDetails(txCoinbaseFixture, { subsidyZat });
      assert.equal(parsed.feeZat, -4000n);
      assert.equal(parsed.feeDisplay, '-0.00004000 ZEC (-4,000 zatoshis)');
    });

    it('outputs "fee: n/a (transparent inputs not resolved)" when prevouts are unresolved', () => {
      const txWithTransparentInputs = {
        txid: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        version: 5,
        vin: [{ txid: '111111', vout: 0 }],
        vout: [{ valueZat: 50000000 }],
      };

      const parsed = parseTxDetails(txWithTransparentInputs, { transparentInputsUnresolved: true });
      assert.equal(parsed.feeZat, undefined);
      assert.equal(parsed.feeDisplay, 'fee: n/a (transparent inputs not resolved)');

      const out = formatTx(txWithTransparentInputs, { transparentInputsUnresolved: true }, { noColor: true });
      assert.match(out, /Fee:\s+fee: n\/a \(transparent inputs not resolved\)/);
    });

    it('computes exact fee when transparent inputs are resolved', () => {
      const txWithResolvedInputs = {
        txid: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        version: 5,
        vin: [{ txid: '111111', vout: 0 }],
        vout: [{ valueZat: 99990000 }],
        valueBalanceZat: 0,
      };

      // Input 100,000,000 zatoshis, output 99,990,000 zatoshis -> fee 10,000 zatoshis
      const parsed = parseTxDetails(txWithResolvedInputs, {
        transparentInputsTotalZat: 100000000n,
      });
      assert.equal(parsed.feeZat, 10000n);
      assert.equal(parsed.feeDisplay, '0.00010000 ZEC (10,000 zatoshis)');
    });
  });

  // =========================================================================
  // RULE 6: Concurrency and pure functions (no temp files, stateless)
  // =========================================================================
  describe('Rule 6: Pure Functions & Concurrency without Temp Files', () => {
    it('produces identical output across concurrent runs without filesystem side-effects', async () => {
      const filesBefore = fs.readdirSync(process.cwd());

      const promises = Array.from({ length: 20 }, async () => {
        const s1 = formatSupply(bciFixture, { noColor: true });
        const b1 = formatBlock(b108Fixture, { noColor: true });
        const t1 = formatTx(txPaymentFixture, {}, { noColor: true });
        return { s1, b1, t1 };
      });

      const results = await Promise.all(promises);
      const first = results[0];

      for (let i = 1; i < results.length; i++) {
        assert.equal(results[i].s1, first.s1);
        assert.equal(results[i].b1, first.b1);
        assert.equal(results[i].t1, first.t1);
      }

      const filesAfter = fs.readdirSync(process.cwd());
      assert.deepEqual(filesAfter, filesBefore, 'No temp files should be created by formatters');
    });
  });

  // =========================================================================
  // RULE 7: Mempool vs mined transactions cleanly handled
  // =========================================================================
  describe('Rule 7: Mempool vs Mined Transactions', () => {
    it('formats mined transaction with block height and confirmations', () => {
      const parsed = parseTxDetails(txPaymentFixture);
      assert.equal(parsed.isMempool, false);
      assert.equal(parsed.height, 108);
      assert.equal(parsed.confirmations, 5);

      const out = formatTx(txPaymentFixture, {}, { noColor: true });
      assert.match(out, /Status:\s+Mined in block 108 \(5 confirmations\)/);
      assert.match(out, /Block Hash:\s+602b4fd7661af844d664bca0538b9ebdfd28fa95e89732fbabb8458de4cdab11/);
    });

    it('formats mempool transaction with "In mempool (0 confirmations)" without crashing', () => {
      const parsed = parseTxDetails(txMempoolFixture);
      assert.equal(parsed.isMempool, true);
      assert.equal(parsed.confirmations, 0);
      assert.equal(parsed.height, undefined);

      const out = formatTx(txMempoolFixture, {}, { noColor: true });
      assert.match(out, /Status:\s+In mempool \(0 confirmations\)/);
      assert.doesNotMatch(out, /Block Hash:/);
    });

    it('handles summary line for both mined and mempool transactions', () => {
      const minedSummary = formatTxSummaryLine(txPaymentFixture, {}, { noColor: true });
      assert.match(minedSummary, /108/);

      const mempoolSummary = formatTxSummaryLine(txMempoolFixture, {}, { noColor: true });
      assert.match(mempoolSummary, /mempool/);
    });
  });

  // =========================================================================
  // RULE 8: Terminal colors and visual string width alignment
  // =========================================================================
  describe('Rule 8: Colors and Visual String Width Alignment', () => {
    it('disables ANSI escapes when noColor is set', () => {
      const outSupply = formatSupply(bciFixture, { noColor: true });
      const outBlock = formatBlock(b108Fixture, { noColor: true });
      const outTx = formatTx(txPaymentFixture, {}, { noColor: true });

      // eslint-disable-next-line no-control-regex
      const ansiRegex = /\x1b\[[0-9;]*m/;
      assert.doesNotMatch(outSupply, ansiRegex);
      assert.doesNotMatch(outBlock, ansiRegex);
      assert.doesNotMatch(outTx, ansiRegex);
    });

    it('calculates column alignment based on visual string length, ignoring ANSI codes', () => {
      const c = createColors(true);
      const plainStr = 'Hello';
      const coloredStr = c.green('Hello');

      assert.equal(visualLength(plainStr), 5);
      assert.equal(visualLength(coloredStr), 5);

      const paddedPlain = padRight(plainStr, 10);
      const paddedColored = padRight(coloredStr, 10);

      assert.equal(visualLength(paddedPlain), 10);
      assert.equal(visualLength(paddedColored), 10);
      assert.equal(stripAnsi(paddedColored), paddedPlain);
    });

    it('formats peers list and mempool list accurately', () => {
      const outPeers = formatPeers(peerinfoFixture, { noColor: true });
      assert.match(outPeers, /192\.168\.1\.100:8233/);
      assert.match(outPeers, /10\.0\.0\.42:8233/);
      assert.match(outPeers, /Your Zebrad node has 2 ip\('s\) connected\./);

      const outMempool = formatMempool(mempoolFixture, { noColor: true });
      assert.match(outMempool, /Mempool status: 0 transaction\(s\) pending/);
      assert.match(outMempool, /\(mempool is empty\)/);
    });
  });

  // =========================================================================
  // Security & URL Redaction
  // =========================================================================
  describe('Security & URL Redaction', () => {
    it('redacts credentials in ZebraRpcClient and never echoes secrets', () => {
      const secretUrl = 'http://rpcuser:supersecretpass@127.0.0.1:39232';
      const client = new ZebraRpcClient({ endpoint: secretUrl });
      assert.doesNotMatch(client.endpoint, /supersecretpass/);
      assert.match(client.endpoint, /http:\/\/127\.0\.0\.1:39232/);
    });
  });

  // =========================================================================
  // Import Graph Isolation (No Native Binding or SDK Dependency)
  // =========================================================================
  describe('Import Graph Isolation (No Native Binding or SDK Dependency)', () => {
    it('imports dist/pretty/index.js cleanly in a fresh process that throws on @zcash-app/sdk or native binding', () => {
      const targetUrl = pathToFileURL(path.resolve(__dirname, '../dist/pretty/index.js')).href;
      const code = `
        import Module from 'node:module';
        const origLoad = Module._load;
        Module._load = function(request, parent, isMain) {
          if (request === '@zcash-app/sdk' || request === '@zcash-app/core' || request.endsWith('.node')) {
            throw new Error('Forbidden import in pretty modules: ' + request);
          }
          return origLoad.apply(this, arguments);
        };
        await import(${JSON.stringify(targetUrl)});
      `;
      const repoRoot = path.resolve(__dirname, '../../..');
      const res = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
        cwd: repoRoot,
        encoding: 'utf8',
      });
      assert.equal(res.status, 0, `Isolated import failed: ${res.stderr || res.stdout}`);
    });

    it('verifies compiled files in dist/pretty do not reference @zcash-app/sdk or core', () => {
      const prettyDistDir = path.resolve(__dirname, '../dist/pretty');
      const files = fs.readdirSync(prettyDistDir).filter((f) => f.endsWith('.js'));
      for (const file of files) {
        const content = fs.readFileSync(path.join(prettyDistDir, file), 'utf8');
        assert.doesNotMatch(content, /@zcash-app\/sdk/);
        assert.doesNotMatch(content, /@zcash-app\/core/);
        assert.doesNotMatch(content, /\.node/);
      }
    });
  });
});
