import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../..');

describe('Port Uniqueness Across Local Stacks & Presets', () => {
  it('ensures every local preset in endpoints.ts has a distinct port', async () => {
    const endpointsFile = path.join(projectRoot, 'packages/dashboard/src/app/endpoints.ts');
    const content = fs.readFileSync(endpointsFile, 'utf8');

    // Extract all local endpoints matching 127.0.0.1:PORT
    const portMatches = [...content.matchAll(/127\.0\.0\.1:(\d+)/g)].map((m) => parseInt(m[1], 10));

    // Specifically verify regtest-nu7 and testnet-local ports
    const nu7Match = content.match(/'regtest-nu7':\s*\{[\s\S]*?endpoint:\s*'127\.0\.0\.1:(\d+)'/);
    const testnetLocalMatch = content.match(/'testnet-local':\s*\{[\s\S]*?endpoint:\s*'127\.0\.0\.1:(\d+)'/);
    const z3Match = content.match(/'regtest-z3':\s*\{[\s\S]*?endpoint:\s*'127\.0\.0\.1:(\d+)'/);

    assert.ok(nu7Match, 'regtest-nu7 preset must be configured');
    assert.ok(testnetLocalMatch, 'testnet-local preset must be configured');
    assert.ok(z3Match, 'regtest-z3 preset must be configured');

    const nu7Port = parseInt(nu7Match[1], 10);
    const testnetLocalPort = parseInt(testnetLocalMatch[1], 10);
    const z3Port = parseInt(z3Match[1], 10);

    assert.strictEqual(nu7Port, 39067, 'NU7 regtest default port must be 39067');
    assert.strictEqual(testnetLocalPort, 39167, 'Local testnet lightwalletd default port must be 39167');
    assert.strictEqual(z3Port, 28137, 'Z3 regtest default port must be 28137');

    assert.notStrictEqual(
      nu7Port,
      testnetLocalPort,
      'NU7 regtest port (39067) and testnet-local port (39167) must not collide'
    );
    assert.notStrictEqual(nu7Port, z3Port, 'NU7 regtest and Z3 regtest ports must not collide');
    assert.notStrictEqual(testnetLocalPort, z3Port, 'Testnet local and Z3 regtest ports must not collide');
  });

  it('ensures docker-compose stacks and testnet lightwalletd use non-overlapping host ports', () => {
    const regtestCompose = fs.readFileSync(
      path.join(projectRoot, 'packages/dev/docker/regtest/docker-compose.yml'),
      'utf8'
    );
    const nu7Compose = fs.readFileSync(
      path.join(projectRoot, 'packages/dev/docker/regtest-nu7/docker-compose.yml'),
      'utf8'
    );

    // Collect host ports from port bindings "127.0.0.1:HOST_PORT:CONTAINER_PORT"
    const extractHostPorts = (yaml) => {
      const ports = new Set();
      const regex = /"127\.0\.0\.1:\$\{[^:]+:-(\d+)\}:/g;
      let match;
      while ((match = regex.exec(yaml)) !== null) {
        ports.add(parseInt(match[1], 10));
      }
      return ports;
    };

    const z3Ports = extractHostPorts(regtestCompose);
    const nu7Ports = extractHostPorts(nu7Compose);
    const testnetLocalPorts = new Set([39167, 39168, 18232]);

    // Check intersection between z3 and nu7
    for (const port of z3Ports) {
      assert.strictEqual(
        nu7Ports.has(port),
        false,
        `Port collision detected between Z3 regtest and NU7 regtest on port ${port}`
      );
      assert.strictEqual(
        testnetLocalPorts.has(port),
        false,
        `Port collision detected between Z3 regtest and testnet-local on port ${port}`
      );
    }

    // Check intersection between nu7 and testnetLocal
    for (const port of nu7Ports) {
      assert.strictEqual(
        testnetLocalPorts.has(port),
        false,
        `Port collision detected between NU7 regtest and testnet-local on port ${port}`
      );
    }
  });
});
