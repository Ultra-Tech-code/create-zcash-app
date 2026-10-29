import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  readZebraCookie,
  buildTestnetLightwalletdArgs,
  redactLightwalletdArgs,
} from '../dist/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.resolve(__dirname, '../dist/cli.js');

describe('Local Testnet Lightwalletd Helper (v0.6.0 Flags & Secret Redaction)', () => {
  it('builds genuine v0.6.0 lightwalletd arguments with exact required flags', () => {
    const fakeToken = 'secret_hex_token_9f8e7d6c5b4a';
    const customDataDir = '/tmp/test_lightwalletd_data';

    const args = buildTestnetLightwalletdArgs({
      rpcHost: '127.0.0.1',
      rpcPort: 18232,
      cookieUser: '__cookie__',
      cookieToken: fakeToken,
      grpcBind: '127.0.0.1:39167',
      httpBind: '127.0.0.1:39168',
      dataDir: customDataDir,
    });

    const expectedFlags = [
      '--rpchost', '127.0.0.1',
      '--rpcport', '18232',
      '--rpcuser', '__cookie__',
      '--rpcpassword', fakeToken,
      '--grpc-bind-addr', '127.0.0.1:39167',
      '--http-bind-addr', '127.0.0.1:39168',
      '--data-dir', customDataDir,
      '--no-tls-very-insecure',
    ];

    assert.deepStrictEqual(args, expectedFlags);

    // Verify all flags in args exist in real lightwalletd v0.6.0
    const realV060Flags = new Set([
      '--rpchost',
      '--rpcport',
      '--rpcuser',
      '--rpcpassword',
      '--grpc-bind-addr',
      '--http-bind-addr',
      '--data-dir',
      '--no-tls-very-insecure',
    ]);

    for (let i = 0; i < args.length; i++) {
      if (args[i].startsWith('--')) {
        assert.ok(
          realV060Flags.has(args[i]),
          `Unexpected flag ${args[i]} not in genuine v0.6.0 flag list`
        );
      }
    }
  });

  it('strictly refuses to build arguments without an RPC password / cookie token', () => {
    assert.throws(
      () => {
        buildTestnetLightwalletdArgs({
          cookieToken: '',
        });
      },
      /Cannot build lightwalletd arguments without an RPC password/
    );
  });

  it('redacts cookie token and replaces home directory paths for safe logging', () => {
    const fakeToken = 'ultra_secret_cookie_token_12345';
    const args = buildTestnetLightwalletdArgs({
      cookieToken: fakeToken,
      dataDir: path.join(os.homedir(), '.zcash-app-testnet/lightwalletd-data'),
    });

    const redacted = redactLightwalletdArgs(args, fakeToken);
    const joinedRedacted = redacted.join(' ');

    assert.ok(
      !joinedRedacted.includes(fakeToken),
      'Redacted command line MUST NEVER contain the cookie token'
    );
    assert.ok(
      joinedRedacted.includes('--rpcpassword [REDACTED]'),
      'Password flag argument must be replaced with [REDACTED]'
    );
    assert.ok(
      !joinedRedacted.includes(os.homedir()),
      'Home directory paths must be normalized to ~ in logs'
    );
    assert.ok(
      joinedRedacted.includes('~/.zcash-app-testnet/lightwalletd-data'),
      'Normalized path with ~ must be present'
    );
  });

  it('reads and parses Zebra cookie file by code, handling restarts and invalid formats', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zebra-cookie-test-'));
    const cookiePath = path.join(tmpDir, '.cookie');

    // 1. Missing file error
    assert.throws(
      () => {
        readZebraCookie(path.join(tmpDir, 'nonexistent.cookie'));
      },
      /Zebra cookie file not found.*Note that Zebra generates a fresh cookie token each time it restarts/
    );

    // 2. Valid format __cookie__:<token>
    const sampleToken = 'mock_cookie_token_test_12345';
    fs.writeFileSync(cookiePath, `__cookie__:${sampleToken}\n`);
    const creds = readZebraCookie(cookiePath);
    assert.strictEqual(creds.user, '__cookie__');
    assert.strictEqual(creds.token, sampleToken);

    // 3. Malformed format (no colon)
    fs.writeFileSync(cookiePath, 'invalid_no_colon');
    assert.throws(
      () => {
        readZebraCookie(cookiePath);
      },
      /Invalid Zebra cookie format/
    );

    // 4. Empty token
    fs.writeFileSync(cookiePath, '__cookie__:\n');
    assert.throws(
      () => {
        readZebraCookie(cookiePath);
      },
      /Empty token in Zebra cookie file/
    );

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('zcash-dev testnet lightwalletd --dry-run prints redacted flags and never reveals token in output', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zcash-dev-dryrun-'));
    const testCookie = path.join(tmpDir, '.cookie');
    const secretToken = 'secret_token_never_leak_this_5678';
    fs.writeFileSync(testCookie, `__cookie__:${secretToken}\n`);

    const res = spawnSync(
      process.execPath,
      [
        cliPath,
        'testnet',
        'lightwalletd',
        '--dry-run',
        '--cookie-path',
        testCookie,
        '--rpchost',
        '127.0.0.1',
        '--rpcport',
        '18232',
        '--grpc-bind-addr',
        '127.0.0.1:39167',
        '--http-bind-addr',
        '127.0.0.1:39168',
      ],
      { encoding: 'utf8' }
    );

    assert.strictEqual(res.status, 0, `Command failed: ${res.stderr}`);
    assert.ok(
      !res.stdout.includes(secretToken),
      'Process stdout MUST NEVER contain the secret token'
    );
    assert.ok(
      !res.stderr.includes(secretToken),
      'Process stderr MUST NEVER contain the secret token'
    );
    assert.match(
      res.stdout,
      /--rpcpassword \[REDACTED\]/,
      'Stdout must contain redacted rpcpassword flag'
    );
    assert.match(
      res.stdout,
      /--grpc-bind-addr 127\.0\.0\.1:39167/,
      'Stdout must contain 39167 grpc bind'
    );
    assert.match(
      res.stdout,
      /--http-bind-addr 127\.0\.0\.1:39168/,
      'Stdout must contain 39168 http bind'
    );
    assert.match(
      res.stdout,
      /Notice: The cookie token changes whenever your Zebra node restarts/,
      'Stdout must state clearly that the token changes on restart'
    );
    assert.match(
      res.stdout,
      /Dry-run complete\. Lightwalletd process was not started\./,
      'Process must not start lightwalletd'
    );

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
