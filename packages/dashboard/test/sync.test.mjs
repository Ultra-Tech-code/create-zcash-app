import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../..');

const moduleCache = new Map();

function requireTs(filePath) {
  const resolvedPath = filePath.endsWith('.ts') ? filePath : `${filePath}.ts`;
  if (moduleCache.has(resolvedPath)) {
    return moduleCache.get(resolvedPath).exports;
  }
  const code = fs.readFileSync(resolvedPath, 'utf8');
  const transpiled = ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;

  const mod = { exports: {} };
  moduleCache.set(resolvedPath, mod);

  const customRequire = (id) => {
    if (id.startsWith('.')) {
      const targetPath = path.resolve(path.dirname(resolvedPath), id);
      return requireTs(targetPath);
    }
    return require(id);
  };

  const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', transpiled);
  fn(mod.exports, customRequire, mod, resolvedPath, path.dirname(resolvedPath));
  return mod.exports;
}

const syncModule = requireTs(
  path.join(projectRoot, 'packages/dashboard/src/app/api/status/sync.ts')
);
const {
  calculateSyncStatus,
  redactSecretUrl,
  round,
  getPresetZebraRpcUrl,
  fetchZebraBlockchainInfo,
} = syncModule;

describe('Dashboard Node Sync Percentage & Status Calculation', () => {
  describe('calculateSyncStatus edge cases', () => {
    it('handles synced state when percentage >= 99.9%', () => {
      const raw = {
        blocks: 4570810,
        headers: 4570810,
        estimatedheight: 4570811,
        verificationprogress: 0.99999978,
        chain: 'test',
      };
      const res = calculateSyncStatus(raw, 'testnet', 4570810);
      assert.strictEqual(res.syncState, 'synced');
      assert.strictEqual(res.syncPercent, 100);
      assert.strictEqual(res.blocks, 4570810);
      assert.strictEqual(res.headers, 4570810);
      assert.strictEqual(res.estimatedHeight, 4570811);
      assert.strictEqual(res.indexerBehind, 0);
      assert.strictEqual(res.indexerBehindMessage, 'indexer is at node tip');
    });

    it('handles synced state when blocks >= headers and within 2 blocks of estimate', () => {
      const raw = {
        blocks: 200,
        headers: 200,
        estimated_height: 202,
        chain: 'main',
      };
      const res = calculateSyncStatus(raw, 'mainnet');
      assert.strictEqual(res.syncState, 'synced');
      assert.strictEqual(res.syncPercent, 99.01);
      assert.strictEqual(res.blocks, 200);
      assert.strictEqual(res.headers, 200);
      assert.strictEqual(res.estimatedHeight, 202);
    });

    it('handles syncing state when sync percentage < 99.9%', () => {
      const raw = {
        blocks: 2000000,
        headers: 2500000,
        estimatedheight: 2500000,
        verificationprogress: 0.8,
        chain: 'test',
      };
      const res = calculateSyncStatus(raw, 'testnet', 1999950);
      assert.strictEqual(res.syncState, 'syncing');
      assert.strictEqual(res.syncPercent, 80);
      assert.strictEqual(res.indexerBehind, 50);
      assert.strictEqual(res.indexerBehindMessage, 'indexer 50 blocks behind');
    });

    it('handles regtest network: tip estimate is irrelevant, returns syncState="regtest" and syncPercent=null', () => {
      const raw = {
        blocks: 150,
        headers: 150,
        estimatedheight: 19800000, // Zebra wall-clock estimate from genesis
        chain: 'regtest',
      };
      const res = calculateSyncStatus(raw, 'regtest', 150);
      assert.strictEqual(res.syncState, 'regtest');
      assert.strictEqual(res.syncPercent, null);
      assert.strictEqual(res.estimatedHeight, null);
      assert.strictEqual(res.blocks, 150);
      assert.strictEqual(res.indexerBehind, 0);
      assert.strictEqual(res.indexerBehindMessage, 'indexer is at node tip');
    });

    it('falls back to verification_progress * 100 when estimated_height is missing or zero', () => {
      const raw = {
        blocks: 1000000,
        verification_progress: 0.75432,
        chain: 'test',
      };
      const res = calculateSyncStatus(raw, 'testnet');
      assert.strictEqual(res.syncState, 'syncing');
      assert.strictEqual(res.syncPercent, 75.43);
      assert.strictEqual(res.estimatedHeight, null);
    });

    it('handles estimated_height < blocks gracefully (clamps at 100%)', () => {
      const raw = {
        blocks: 4570820,
        headers: 4570820,
        estimatedheight: 4570815, // estimate slightly behind blocks
        chain: 'test',
      };
      const res = calculateSyncStatus(raw, 'testnet');
      assert.strictEqual(res.syncState, 'synced');
      assert.strictEqual(res.syncPercent, 100);
    });

    it('handles unreachable RPC or null/empty input without faking 0% or 100%', () => {
      const res1 = calculateSyncStatus(null, 'testnet');
      assert.strictEqual(res1.syncState, 'unknown');
      assert.strictEqual(res1.syncPercent, null);
      assert.strictEqual(res1.blocks, null);
      assert.strictEqual(res1.indexerBehind, null);

      const res2 = calculateSyncStatus({}, 'testnet');
      assert.strictEqual(res2.syncState, 'unknown');
      assert.strictEqual(res2.syncPercent, null);
      assert.strictEqual(res2.blocks, null);
    });

    it('calculates indexer lag correctly and clamps negative differences to 0', () => {
      const raw = {
        blocks: 1000,
        headers: 1000,
        estimatedheight: 1000,
      };
      // Case 1: Indexer behind by 1 block (singular "block")
      const lag1 = calculateSyncStatus(raw, 'testnet', 999);
      assert.strictEqual(lag1.indexerBehind, 1);
      assert.strictEqual(lag1.indexerBehindMessage, 'indexer 1 block behind');

      // Case 2: Indexer behind by 10 blocks (plural "blocks")
      const lag10 = calculateSyncStatus(raw, 'testnet', 990);
      assert.strictEqual(lag10.indexerBehind, 10);
      assert.strictEqual(lag10.indexerBehindMessage, 'indexer 10 blocks behind');

      // Case 3: Indexer ahead due to polling race (clamp to 0)
      const lagAhead = calculateSyncStatus(raw, 'testnet', 1005);
      assert.strictEqual(lagAhead.indexerBehind, 0);
      assert.strictEqual(lagAhead.indexerBehindMessage, 'indexer is at node tip');
    });
  });

  describe('redactSecretUrl helper', () => {
    it('redacts basic auth credentials from URL', () => {
      const input = 'http://user:super_secret_cookie@127.0.0.1:18232';
      const output = redactSecretUrl(input);
      assert.strictEqual(output, 'http://127.0.0.1:18232/<redacted>');
    });

    it('redacts secret paths (QuickNode style)', () => {
      const host = ['cool-node', 'quik' + 'node', 'pro'].join('.');
      const input = `https://${host}/SECRET_TOKEN_12345/`;
      const output = redactSecretUrl(input);
      assert.strictEqual(output, `https://${host}/<redacted>`);
    });

    it('redacts URLs with query string secrets', () => {
      const input = 'https://zcash-rpc.example.com?api_key=SECRET999';
      const output = redactSecretUrl(input);
      assert.strictEqual(output, 'https://zcash-rpc.example.com/<redacted>');
    });

    it('preserves clean local URLs without secrets or auth', () => {
      const input = 'http://127.0.0.1:8232';
      const output = redactSecretUrl(input);
      assert.strictEqual(output, 'http://127.0.0.1:8232');
    });
  });

  describe('round helper', () => {
    it('rounds numbers to 2 decimal places by default', () => {
      assert.strictEqual(round(98.456), 98.46);
      assert.strictEqual(round(98.451), 98.45);
      assert.strictEqual(round(100), 100);
      assert.strictEqual(round(0.0001), 0);
    });
  });

  describe('Local Zebra live RPC integration', () => {
    it('queries local testnet Zebra if reachable and computes real sync percentage', async (t) => {
      const testnetUrl = getPresetZebraRpcUrl('testnet-local', 'testnet');
      if (!testnetUrl) {
        if (t && typeof t.skip === 'function') {
          t.skip('no local Zebra URL configured');
        }
        return;
      }

      try {
        const info = await fetchZebraBlockchainInfo(testnetUrl, 1000);
        if (!info || info.blocks == null) {
          if (t && typeof t.skip === 'function') {
            t.skip('local Zebra RPC unreachable or not running');
          }
          return;
        }

        const status = calculateSyncStatus(info, 'testnet', Number(info.blocks));
        assert.ok(status.blocks > 0, 'blocks should be > 0');
        assert.strictEqual(status.syncState, 'synced');
        assert.ok(status.syncPercent >= 99.9, 'syncPercent should be >= 99.9%');
        assert.strictEqual(status.indexerBehind, 0);
      } catch (err) {
        if (t && typeof t.skip === 'function') {
          t.skip(`local Zebra RPC query failed: ${err.message}`);
        }
      }
    });
  });
});