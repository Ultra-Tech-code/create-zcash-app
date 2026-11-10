import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../..');

describe('Port Uniqueness Across Local Stacks & Presets', () => {
  it('ensures local presets in endpoints.ts have expected ports', async () => {
    const endpointsFile = path.join(projectRoot, 'packages/dashboard/src/app/endpoints.ts');
    const content = fs.readFileSync(endpointsFile, 'utf8');

    // Verify regtest-lightwalletd, regtest-zaino, regtest-full, and testnet-local ports
    const lightwalletdMatch = content.match(/'regtest-lightwalletd':\s*\{[\s\S]*?endpoint:\s*'127\.0\.0\.1:(\d+)'/);
    const zainoMatch = content.match(/'regtest-zaino':\s*\{[\s\S]*?endpoint:\s*'127\.0\.0\.1:(\d+)'/);
    const fullMatch = content.match(/'regtest-full':\s*\{[\s\S]*?endpoint:\s*'127\.0\.0\.1:(\d+)'/);
    const testnetLocalMatch = content.match(/'testnet-local':\s*\{[\s\S]*?endpoint:\s*'127\.0\.0\.1:(\d+)'/);

    assert.ok(lightwalletdMatch, 'regtest-lightwalletd preset must be configured');
    assert.ok(zainoMatch, 'regtest-zaino preset must be configured');
    assert.ok(fullMatch, 'regtest-full preset must be configured');
    assert.ok(testnetLocalMatch, 'testnet-local preset must be configured');

    const lightwalletdPort = parseInt(lightwalletdMatch[1], 10);
    const zainoPort = parseInt(zainoMatch[1], 10);
    const fullPort = parseInt(fullMatch[1], 10);
    const testnetLocalPort = parseInt(testnetLocalMatch[1], 10);

    assert.strictEqual(lightwalletdPort, 39067, 'Lightwalletd regtest default port must be 39067');
    assert.strictEqual(zainoPort, 38137, 'Zaino regtest default port must be 38137');
    assert.strictEqual(fullPort, 39067, 'Full stack regtest gRPC default port must be 39067');
    assert.strictEqual(testnetLocalPort, 39167, 'Local testnet lightwalletd default port must be 39167');

    assert.notStrictEqual(
      lightwalletdPort,
      zainoPort,
      'Lightwalletd regtest port (39067) and Zaino regtest port (38137) must not collide'
    );
    assert.notStrictEqual(
      lightwalletdPort,
      testnetLocalPort,
      'Lightwalletd regtest port (39067) and testnet-local port (39167) must not collide'
    );
    assert.notStrictEqual(
      zainoPort,
      testnetLocalPort,
      'Zaino regtest port (38137) and testnet-local port (39167) must not collide'
    );
  });

  it('ensures each docker-compose stack has no internal port collisions and does not collide with testnet-local', () => {
    const stacks = ['lightwalletd', 'zaino', 'full'];
    const extractHostPorts = (yaml) => {
      const ports = [];
      const regex = /"127\.0\.0\.1:\$\{[^:]+:-(\d+)\}:/g;
      let match;
      while ((match = regex.exec(yaml)) !== null) {
        ports.push(parseInt(match[1], 10));
      }
      return ports;
    };

    const testnetLocalPorts = new Set([39167, 39168]);
    const expectedAllPorts = new Set([38080, 39068, 39167, 39168, 38137, 8182, 8230, 39232]);

    const observedPorts = new Set([...testnetLocalPorts]);

    for (const stack of stacks) {
      const composePath = path.join(projectRoot, `packages/dev/docker/stacks/${stack}/docker-compose.yml`);
      assert.ok(fs.existsSync(composePath), `Stack compose must exist: ${composePath}`);
      const content = fs.readFileSync(composePath, 'utf8');
      const ports = extractHostPorts(content);

      // Verify no internal duplicates within a single stack
      const uniquePorts = new Set(ports);
      assert.strictEqual(
        uniquePorts.size,
        ports.length,
        `Stack ${stack} must not have duplicate host port bindings: ${ports.join(', ')}`
      );

      for (const p of ports) {
        observedPorts.add(p);
        assert.strictEqual(
          testnetLocalPorts.has(p),
          false,
          `Stack ${stack} port ${p} must not collide with testnet-local ports`
        );
      }
    }

    // Verify all expected ports are covered across the 3 stacks + testnet-local
    for (const expectedPort of expectedAllPorts) {
      assert.ok(
        observedPorts.has(expectedPort),
        `Expected port ${expectedPort} should be present in stacks or testnet-local`
      );
    }
  });
});
