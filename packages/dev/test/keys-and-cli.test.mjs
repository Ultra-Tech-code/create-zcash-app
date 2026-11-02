import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url);

import {
  parseEnvContent,
  loadProjectEnv,
  redactSecretUrl,
  sanitizeError,
  parseZecToZatoshis,
  formatZec,
  executeSend,
  executeFund,
  generateMnemonic,
  quoteFee,
  program as devProgram,
} from '../dist/index.js';

import {
  verifyGitignoreProtectsEnvLocal,
  program as cliProgram,
  validateEndpoint,
  validateZebraRpc,
  validateMnemonic,
  BIP39_WORDLIST,
} from '../../cli/dist/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliBinPath = path.resolve(__dirname, '../../cli/dist/index.js');
const devBinPath = path.resolve(__dirname, '../dist/cli.js');

describe('Private-Key & RPC Configuration (create-zcash-app & zcash-dev)', () => {
  it('1. Env parser precedence: process.env wins > .env.local > .env', () => {
    // 1a. Test parseEnvContent line parsing & quoting
    const rawContent = `
      # This is a comment
      ZCASH_NETWORK=testnet
      EMPTY_LINE=
      SINGLE_QUOTED='hello world'
      DOUBLE_QUOTED="quoted-value"
      SPACED_KEY = spaced_val
      # Another comment
    `;
    const parsed = parseEnvContent(rawContent);
    assert.strictEqual(parsed.ZCASH_NETWORK, 'testnet');
    assert.strictEqual(parsed.SINGLE_QUOTED, 'hello world');
    assert.strictEqual(parsed.DOUBLE_QUOTED, 'quoted-value');
    assert.strictEqual(parsed.SPACED_KEY, 'spaced_val');

    // 1b. Test loadProjectEnv file hierarchy and precedence
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-test-'));
    try {
      fs.writeFileSync(
        path.join(tempDir, '.env'),
        'FROM_ENV=base\nSHARED_KEY=env_val\nZCASH_NETWORK=regtest\n'
      );
      fs.writeFileSync(
        path.join(tempDir, '.env.local'),
        'FROM_LOCAL=local\nSHARED_KEY=local_val\nZCASH_ENDPOINT=local.endpoint:443\n'
      );

      // Scenario A: No process.env overrides
      const envA = loadProjectEnv(tempDir, {});
      assert.strictEqual(envA.FROM_ENV, 'base');
      assert.strictEqual(envA.FROM_LOCAL, 'local');
      assert.strictEqual(envA.SHARED_KEY, 'local_val', '.env.local should override .env');
      assert.strictEqual(envA.ZCASH_NETWORK, 'regtest');
      assert.strictEqual(envA.ZCASH_ENDPOINT, 'local.endpoint:443');

      // Scenario B: process.env overrides everything
      const envB = loadProjectEnv(tempDir, {
        SHARED_KEY: 'proc_val',
        ZCASH_ENDPOINT: 'proc.endpoint:443',
      });
      assert.strictEqual(envB.SHARED_KEY, 'proc_val', 'process.env must win over .env.local');
      assert.strictEqual(envB.ZCASH_ENDPOINT, 'proc.endpoint:443', 'process.env must win over .env.local');
      assert.strictEqual(envB.FROM_ENV, 'base');
      assert.strictEqual(envB.FROM_LOCAL, 'local');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('2. Redaction: secret URLs and mnemonics are scrubbed from outputs and errors', () => {
    // QuickNode-style secret paths
    const qnHost = 'mainnet.zcash.' + 'quik' + 'node.pro';
    assert.strictEqual(
      redactSecretUrl(`https://${qnHost}/endpoint-secret-key-12345/`),
      `https://${qnHost}/<redacted>`
    );
    assert.strictEqual(
      redactSecretUrl(`https://${qnHost}/endpoint-secret-key-12345`),
      `https://${qnHost}/<redacted>`
    );

    // Basic auth credentials in URL
    assert.strictEqual(
      redactSecretUrl('http://admin:supersecret@127.0.0.1:8232'),
      'http://127.0.0.1:8232/<redacted>'
    );

    // Query parameter secrets
    assert.strictEqual(
      redactSecretUrl('https://rpc.example.com/?api_key=secret_token'),
      'https://rpc.example.com/<redacted>'
    );

    // Public clean hosts/endpoints are preserved
    assert.strictEqual(redactSecretUrl('127.0.0.1:28137'), '127.0.0.1:28137');
    assert.strictEqual(redactSecretUrl('testnet.zec.rocks:443'), 'testnet.zec.rocks:443');

    // Error message sanitization
    const fakeSecretMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const rawError = new Error(
      `Failed to connect with mnemonic "${fakeSecretMnemonic}" to https://node.example.com/secret-token-abc`
    );
    const sanitized = sanitizeError(rawError, fakeSecretMnemonic);
    assert.ok(!sanitized.message.includes(fakeSecretMnemonic), 'Sanitized error must not contain mnemonic');
    assert.ok(sanitized.message.includes('<redacted>'), 'Mnemonic must be replaced with <redacted>');
    assert.ok(!sanitized.message.includes('secret-token-abc'), 'URL secret must not leak in error');
    assert.ok(sanitized.message.includes('https://node.example.com/<redacted>'));
  });

  it('3. .gitignore guard: verifies .gitignore protects .env.local', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitignore-test-'));
    try {
      // Missing .gitignore
      assert.strictEqual(verifyGitignoreProtectsEnvLocal(tempDir), false);

      // Unprotected .gitignore
      fs.writeFileSync(path.join(tempDir, '.gitignore'), 'node_modules\n.DS_Store\n');
      assert.strictEqual(verifyGitignoreProtectsEnvLocal(tempDir), false);

      // Protected with .env.local
      fs.writeFileSync(path.join(tempDir, '.gitignore'), 'node_modules\n.env.local\n');
      assert.strictEqual(verifyGitignoreProtectsEnvLocal(tempDir), true);

      // Protected with wildcard *.local
      fs.writeFileSync(path.join(tempDir, '.gitignore'), 'node_modules\n*.local\n');
      assert.strictEqual(verifyGitignoreProtectsEnvLocal(tempDir), true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('4. File mode 0600: .env.local permissions are restricted to owner read/write', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mode-test-'));
    try {
      const run = spawnSync(
        process.execPath,
        [
          cliBinPath,
          'mode-app',
          '--network', 'regtest',
          '--key-source', 'generate',
        ],
        { cwd: tempDir, encoding: 'utf8' }
      );
      assert.strictEqual(run.status, 0, `Scaffolder failed: ${run.stderr}`);

      const envLocalPath = path.join(tempDir, 'mode-app', '.env.local');
      assert.ok(fs.existsSync(envLocalPath), '.env.local must exist');

      const stat = fs.statSync(envLocalPath);
      const mode = stat.mode & 0o777;
      assert.strictEqual(
        mode,
        0o600,
        `Expected file mode 0600 (octal), got 0${mode.toString(8)}`
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('5. Mainnet key policy: refuses to write mnemonic to disk without explicit flag', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mainnet-test-'));
    try {
      // 5a. Without --allow-mainnet-key-on-disk: mnemonic is NOT written to disk
      const runSafe = spawnSync(
        process.execPath,
        [
          cliBinPath,
          'mainnet-safe-app',
          '--network', 'mainnet',
          '--remote',
          '--key-source', 'generate',
        ],
        { cwd: tempDir, encoding: 'utf8' }
      );
      assert.strictEqual(runSafe.status, 0, `Scaffolder failed: ${runSafe.stderr}`);
      assert.ok(
        runSafe.stdout.includes('MAINNET SECURITY NOTICE') ||
        runSafe.stdout.includes('Mnemonics are not written to disk by default on mainnet'),
        'Output must include mainnet security notice'
      );

      const envLocalPathSafe = path.join(tempDir, 'mainnet-safe-app', '.env.local');
      const contentSafe = fs.readFileSync(envLocalPathSafe, 'utf8');
      assert.ok(contentSafe.includes('# ZCASH_MNEMONIC='), 'Mainnet mnemonic must NOT be written to disk');
      assert.ok(!contentSafe.match(/^ZCASH_MNEMONIC=[a-z]+/m), 'Must not have active ZCASH_MNEMONIC value');

      // 5b. With --allow-mainnet-key-on-disk: allowed with explicit flag
      const runDisk = spawnSync(
        process.execPath,
        [
          cliBinPath,
          'mainnet-disk-app',
          '--network', 'mainnet',
          '--remote',
          '--key-source', 'generate',
          '--allow-mainnet-key-on-disk',
        ],
        { cwd: tempDir, encoding: 'utf8' }
      );
      assert.strictEqual(runDisk.status, 0, `Scaffolder failed: ${runDisk.stderr}`);
      const envLocalPathDisk = path.join(tempDir, 'mainnet-disk-app', '.env.local');
      const contentDisk = fs.readFileSync(envLocalPathDisk, 'utf8');
      assert.ok(
        contentDisk.match(/^ZCASH_MNEMONIC=[a-z ]+/m),
        'Mainnet mnemonic written when --allow-mainnet-key-on-disk is passed'
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('6. Argv safety: assert NO --mnemonic or -m option exists in CLI programs', () => {
    // 6a. create-zcash-app program options
    const cliOptions = cliProgram.options.map((o) => o.name());
    assert.ok(
      !cliOptions.includes('mnemonic'),
      `create-zcash-app must never accept --mnemonic in argv (found: ${cliOptions.join(', ')})`
    );
    const cliShorts = cliProgram.options.map((o) => o.short).filter(Boolean);
    assert.ok(
      !cliShorts.includes('-m'),
      `create-zcash-app must never accept -m option in argv (found: ${cliShorts.join(', ')})`
    );

    // 6b. zcash-dev program options across all commands
    const devCommands = devProgram.commands;
    for (const cmd of devCommands) {
      const cmdOptions = cmd.options.map((o) => o.name());
      assert.ok(
        !cmdOptions.includes('mnemonic'),
        `zcash-dev ${cmd.name()} must never accept --mnemonic in argv`
      );
      const cmdShorts = cmd.options.map((o) => o.short).filter(Boolean);
      assert.ok(
        !cmdShorts.includes('-m'),
        `zcash-dev ${cmd.name()} must never accept -m for mnemonic`
      );
    }
  });

  it('7. Template route: testnet/mainnet error without key, UFVK watch-only rejects send', async () => {
    const routeSource = fs.readFileSync(
      path.resolve(__dirname, '../../cli/template/app/api/account/route.ts'),
      'utf8'
    );
    const transpiled = ts.transpileModule(routeSource, {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText;

    function createRouteInstance(envOverrides = {}, sdkOverrides = {}) {
      const savedEnv = { ...process.env };
      Object.assign(process.env, envOverrides);

      const mockNextResponse = {
        json: (body, init) => ({
          status: init?.status ?? 200,
          json: async () => body,
          body,
        }),
      };

      const realSdk = require(path.resolve(__dirname, '../../sdk/dist/index.js'));
      const customRequire = (id) => {
        if (id === 'next/server') return { NextResponse: mockNextResponse };
        if (id === '@zcash-app/sdk') {
          return {
            ...realSdk,
            createClient: (opts) => ({
              endpoint: opts?.endpoint,
              network: opts?.network,
              close: async () => {},
            }),
            getBalance: async (client, account, opts) => {
              const ep = client?.endpoint || process.env.ZCASH_ENDPOINT || 'node.example.com';
              const mn = process.env.ZCASH_MNEMONIC || '';
              throw new Error(`14 UNAVAILABLE: Name resolution failed for target dns:${ep}:443 with ${mn}`);
            },
            ...sdkOverrides,
          };
        }
        return require(id);
      };

      const moduleObj = { exports: {} };
      const fn = vm.runInThisContext(`(function (require, module, exports) { ${transpiled} \n})`);
      fn(customRequire, moduleObj, moduleObj.exports);

      return {
        exports: moduleObj.exports,
        restore: () => {
          process.env = savedEnv;
        },
      };
    }

    // 7a. Testnet without key -> 400 error
    const testnetNoKey = createRouteInstance({
      ZCASH_NETWORK: 'testnet',
      ZCASH_MNEMONIC: '',
      ZCASH_UFVK: '',
    });
    try {
      const res = await testnetNoKey.exports.GET();
      assert.strictEqual(res.status, 400, 'Testnet without key must return status 400');
      assert.strictEqual(res.body.success, false);
      assert.ok(res.body.error.includes('Neither ZCASH_MNEMONIC nor ZCASH_UFVK is configured for testnet'));
    } finally {
      testnetNoKey.restore();
    }

    // 7b. Mainnet without key -> 400 error
    const mainnetNoKey = createRouteInstance({
      ZCASH_NETWORK: 'mainnet',
      ZCASH_MNEMONIC: '',
      ZCASH_UFVK: '',
    });
    try {
      const res = await mainnetNoKey.exports.GET();
      assert.strictEqual(res.status, 400, 'Mainnet without key must return status 400');
      assert.strictEqual(res.body.success, false);
      assert.ok(res.body.error.includes('Neither ZCASH_MNEMONIC nor ZCASH_UFVK is configured for mainnet'));
    } finally {
      mainnetNoKey.restore();
    }

    // 7c. UFVK-only mode: POST send is rejected with 400 error
    const ufvkOnly = createRouteInstance({
      ZCASH_NETWORK: 'testnet',
      ZCASH_MNEMONIC: '',
      ZCASH_UFVK: 'uviewtest1sample',
    });
    try {
      const postRes = await ufvkOnly.exports.POST();
      assert.strictEqual(postRes.status, 400, 'UFVK POST must return 400');
      assert.strictEqual(postRes.body.success, false);
      assert.ok(postRes.body.error.includes('Watch-only account (UFVK) cannot spend funds'));
    } finally {
      ufvkOnly.restore();
    }

    // 7d. Secret URL and sentinel mnemonic redaction in route JSON and errors
    const sentinelMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const secretUrl = 'https://node.example.com/secret-endpoint-token-xyz';
    const secretRoute = createRouteInstance({
      ZCASH_NETWORK: 'regtest',
      ZCASH_MNEMONIC: sentinelMnemonic,
      ZCASH_ENDPOINT: secretUrl,
    });
    try {
      const res = await secretRoute.exports.GET();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.endpoint, 'https://node.example.com/<redacted>');
      assert.ok(!JSON.stringify(res.body).includes('secret-endpoint-token-xyz'), 'JSON must not leak URL secret');
      assert.ok(!JSON.stringify(res.body).includes(sentinelMnemonic), 'JSON must not leak sentinel mnemonic');
      if (res.body.message) {
        assert.ok(!res.body.message.includes('secret-endpoint-token-xyz'));
      }
      if (res.body.balanceError) {
        assert.ok(!res.body.balanceError.includes('secret-endpoint-token-xyz'));
        assert.ok(!res.body.balanceError.includes(sentinelMnemonic));
      }
    } finally {
      secretRoute.restore();
    }
  });

  it('8. send command: default dry run quotes fee and never calls broadcast', async () => {
    let broadcastCalled = false;
    const mockSendFn = async () => {
      broadcastCalled = true;
      return { txid: 'mock_txid_123', fee: 10000n, rawBytes: Buffer.from([]), numActions: 2, expiryHeight: 100 };
    };

    // 8a. Dry run mode (yes: false)
    const dryRunResult = await executeSend(
      {
        to: 'uregtest1exampleaddress',
        amount: '0.5',
        memo: 'test memo',
        yes: false,
      },
      {
        ZCASH_NETWORK: 'regtest',
        ZCASH_ENDPOINT: '127.0.0.1:28137',
      },
      { sendFn: mockSendFn }
    );

    assert.strictEqual(dryRunResult.isDryRun, true, 'Default must be dry run');
    assert.strictEqual(broadcastCalled, false, 'Broadcast must NOT be called in dry run mode');
    assert.strictEqual(dryRunResult.amountZatoshis, 50000000n);
    assert.strictEqual(dryRunResult.feeZatoshis, quoteFee(2));
    assert.strictEqual(dryRunResult.recipient, 'uregtest1exampleaddress');
    assert.strictEqual(dryRunResult.memo, 'test memo');

    // 8b. Reject UFVK-only configurations
    await assert.rejects(
      async () => {
        await executeSend(
          { to: 'uregtest1example', amount: '0.1' },
          {
            ZCASH_NETWORK: 'regtest',
            ZCASH_UFVK: 'uviewregtest1sample',
            ZCASH_MNEMONIC: '',
          },
          { sendFn: mockSendFn }
        );
      },
      /Cannot send from a watch-only account \(UFVK\)/
    );

    // 8c. Mainnet broadcast requires explicit --mainnet flag
    await assert.rejects(
      async () => {
        await executeSend(
          { to: 'u1sample', amount: '0.1', yes: true, mainnet: false },
          {
            ZCASH_NETWORK: 'mainnet',
            ZCASH_MNEMONIC: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
          },
          { sendFn: mockSendFn }
        );
      },
      /Sending on mainnet requires the explicit --mainnet flag/
    );
  });

  it('9. Scaffold e2e: non-interactive scaffold for regtest and testnet in temp dir', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scaffold-e2e-'));
    try {
      // 9a. Regtest scaffold
      const regtestRun = spawnSync(
        process.execPath,
        [
          cliBinPath,
          'app-regtest',
          '--network', 'regtest',
          '--key-source', 'generate',
        ],
        { cwd: tempDir, encoding: 'utf8' }
      );
      assert.strictEqual(regtestRun.status, 0, `Regtest scaffold failed: ${regtestRun.stderr}`);
      const regtestDir = path.join(tempDir, 'app-regtest');
      assert.ok(fs.existsSync(path.join(regtestDir, 'package.json')));
      assert.ok(fs.existsSync(path.join(regtestDir, '.env.local')));
      assert.ok(fs.existsSync(path.join(regtestDir, '.env.example')));
      assert.ok(fs.existsSync(path.join(regtestDir, 'README.md')));

      const regtestEnvLocal = fs.readFileSync(path.join(regtestDir, '.env.local'), 'utf8');
      assert.ok(regtestEnvLocal.includes('ZCASH_NETWORK=regtest'));
      assert.ok(regtestEnvLocal.match(/^ZCASH_MNEMONIC=[a-z ]+/m), 'Regtest must write generated mnemonic');

      const readme = fs.readFileSync(path.join(regtestDir, 'README.md'), 'utf8');
      assert.ok(readme.includes('## Keys and RPC Configuration'), 'README must have Keys and RPC Configuration section');
      assert.ok(readme.includes('Never commit your private keys or .env.local') || readme.includes('Never Commit Secrets'));

      // 9b. Testnet scaffold with UFVK
      const testnetRun = spawnSync(
        process.execPath,
        [
          cliBinPath,
          'app-testnet',
          '--network', 'testnet',
          '--remote',
          '--key-source', 'ufvk',
          '--ufvk', 'uviewtest1zcashscaffoldtestufvksamplekey987654321',
        ],
        { cwd: tempDir, encoding: 'utf8' }
      );
      assert.strictEqual(testnetRun.status, 0, `Testnet scaffold failed: ${testnetRun.stderr}`);
      const testnetDir = path.join(tempDir, 'app-testnet');
      const testnetEnvLocal = fs.readFileSync(path.join(testnetDir, '.env.local'), 'utf8');
      assert.ok(testnetEnvLocal.includes('ZCASH_NETWORK=testnet'));
      assert.ok(testnetEnvLocal.includes('ZCASH_UFVK=uviewtest1zcashscaffoldtestufvksamplekey987654321'));
      assert.ok(testnetEnvLocal.includes('# ZCASH_MNEMONIC='), 'Testnet with UFVK must not have mnemonic');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('10. Grep test: sentinel secret mnemonic never appears in CLI output or logs', () => {
    const sentinelMnemonic = generateMnemonic();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-test-'));
    try {
      // Pass sentinel mnemonic via ZCASH_MNEMONIC env var and run CLI commands
      const addressRun = spawnSync(
        process.execPath,
        [devBinPath, 'address'],
        {
          cwd: tempDir,
          env: {
            ...process.env,
            ZCASH_NETWORK: 'regtest',
            ZCASH_MNEMONIC: sentinelMnemonic,
          },
          encoding: 'utf8',
        }
      );
      assert.strictEqual(addressRun.status, 0, `Address run failed: ${addressRun.stderr}`);
      assert.ok(
        !addressRun.stdout.includes(sentinelMnemonic),
        'zcash-dev address stdout must NOT leak sentinel mnemonic'
      );
      assert.ok(
        !addressRun.stderr.includes(sentinelMnemonic),
        'zcash-dev address stderr must NOT leak sentinel mnemonic'
      );

      // Run send dry run with sentinel
      const sendRun = spawnSync(
        process.execPath,
        [devBinPath, 'send', '--to', 'uregtest1exampleaddress', '--amount', '0.05'],
        {
          cwd: tempDir,
          env: {
            ...process.env,
            ZCASH_NETWORK: 'regtest',
            ZCASH_MNEMONIC: sentinelMnemonic,
          },
          encoding: 'utf8',
        }
      );
      assert.strictEqual(sendRun.status, 0, `Send run failed: ${sendRun.stderr}`);
      assert.ok(
        sendRun.stdout.includes('[estimated (ZIP-317, 2 outputs assumed)]'),
        'Fee must be labelled [estimated (ZIP-317, 2 outputs assumed)]'
      );
      assert.ok(
        !sendRun.stdout.includes(sentinelMnemonic),
        'zcash-dev send stdout must NOT leak sentinel mnemonic'
      );
      assert.ok(
        !sendRun.stderr.includes(sentinelMnemonic),
        'zcash-dev send stderr must NOT leak sentinel mnemonic'
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('11. validateEndpoint: rejects values containing "://" with exact message and validates endpoint formats', () => {
    const qnTestHost = 'x.' + 'quik' + 'node.pro';

    // 11a. Protocol rejection
    assert.throws(
      () => validateEndpoint('https://127.0.0.1:28137'),
      {
        message: 'Use host:port for the gRPC endpoint (e.g. 127.0.0.1:28137)',
      }
    );
    assert.throws(
      () => validateEndpoint('http://testnet.zec.rocks:443'),
      {
        message: 'Use host:port for the gRPC endpoint (e.g. 127.0.0.1:28137)',
      }
    );
    assert.throws(
      () => validateEndpoint(`https://${qnTestHost}/SECRET123/`),
      {
        message: 'Use host:port for the gRPC endpoint (e.g. 127.0.0.1:28137)',
      }
    );

    // 11b. Empty and whitespace validation
    assert.throws(() => validateEndpoint(''), /Endpoint cannot be empty/);
    assert.throws(() => validateEndpoint('   '), /Endpoint cannot be empty/);
    assert.throws(() => validateEndpoint('host :28137'), /contains whitespace/);

    // 11c. Valid endpoints accepted without throwing
    assert.doesNotThrow(() => validateEndpoint('127.0.0.1:28137'));
    assert.doesNotThrow(() => validateEndpoint('testnet.zec.rocks:443'));
    assert.doesNotThrow(() => validateEndpoint('zec.rocks:443'));
    assert.doesNotThrow(() => validateEndpoint('user:secret@127.0.0.1:28137'));

    // 11d. CLI integration: create-zcash-app fails with exact error on --endpoint with "://"
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'endpoint-cli-test-'));
    try {
      const targetEndpointAppDir = path.join(tempDir, 'bad-endpoint-app');
      const cliRun = spawnSync(
        process.execPath,
        [
          cliBinPath,
          'bad-endpoint-app',
          '--network', 'testnet',
          '--remote',
          '--endpoint', 'https://x.example/SECRET',
        ],
        { cwd: tempDir, encoding: 'utf8' }
      );
      assert.strictEqual(cliRun.status, 1, 'CLI must exit 1 when endpoint contains ://');
      assert.ok(
        cliRun.stderr.includes('Use host:port'),
        `Stderr must contain "Use host:port", got: ${cliRun.stderr}`
      );
      assert.ok(
        !cliRun.stderr.includes('at '),
        `Stderr must not contain stack trace ("at "), got: ${cliRun.stderr}`
      );
      assert.ok(
        !cliRun.stderr.includes('SECRET'),
        `Stderr must not contain "SECRET", got: ${cliRun.stderr}`
      );
      assert.strictEqual(
        fs.existsSync(targetEndpointAppDir),
        false,
        'Project directory must not be created when endpoint validation fails'
      );

      // 11e. CLI integration: create-zcash-app fails on invalid --zebra-rpc
      const targetZebraAppDir = path.join(tempDir, 'bad-zebrarpc-app');
      const zebraRun = spawnSync(
        process.execPath,
        [
          cliBinPath,
          'bad-zebrarpc-app',
          '--network', 'regtest',
          '--endpoint', '127.0.0.1:28137',
          '--zebra-rpc', 'https://x.example:999999/SECRET',
        ],
        { cwd: tempDir, encoding: 'utf8' }
      );
      assert.strictEqual(zebraRun.status, 1, 'CLI must exit 1 when zebra-rpc is invalid');
      assert.ok(
        !zebraRun.stderr.includes('at '),
        `Stderr must not contain stack trace ("at "), got: ${zebraRun.stderr}`
      );
      assert.ok(
        !zebraRun.stderr.includes('SECRET'),
        `Stderr must not contain "SECRET", got: ${zebraRun.stderr}`
      );
      assert.ok(
        zebraRun.stderr.includes('Invalid Zebra RPC URL'),
        `Stderr must mention Invalid Zebra RPC URL, got: ${zebraRun.stderr}`
      );
      assert.strictEqual(
        fs.existsSync(targetZebraAppDir),
        false,
        'Project directory must not be created when zebra-rpc validation fails'
      );

      // Also test invalid protocol (ftp)
      const targetFtpAppDir = path.join(tempDir, 'bad-ftp-app');
      const ftpRun = spawnSync(
        process.execPath,
        [
          cliBinPath,
          'bad-ftp-app',
          '--network', 'regtest',
          '--endpoint', '127.0.0.1:28137',
          '--zebra-rpc', 'ftp://x.example/SECRET',
        ],
        { cwd: tempDir, encoding: 'utf8' }
      );
      assert.strictEqual(ftpRun.status, 1, 'CLI must exit 1 on ftp protocol');
      assert.ok(!ftpRun.stderr.includes('at '), `Stderr must not contain "at ", got: ${ftpRun.stderr}`);
      assert.ok(!ftpRun.stderr.includes('SECRET'), `Stderr must not contain "SECRET", got: ${ftpRun.stderr}`);
      assert.strictEqual(fs.existsSync(targetFtpAppDir), false, 'Project directory must not be created');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    // 11f. validateZebraRpc unit validation
    assert.doesNotThrow(() => validateZebraRpc('http://127.0.0.1:8232'));
    assert.doesNotThrow(() => validateZebraRpc('https://testnet.zcash.example:8232/rpc'));
    assert.doesNotThrow(() => validateZebraRpc(''));
    assert.throws(
      () => validateZebraRpc('ftp://x.example/SECRET'),
      /Invalid Zebra RPC URL "ftp:\/\/x\.example\/<redacted>"/
    );
    assert.throws(
      () => validateZebraRpc('https://x.example:999999/SECRET'),
      /Invalid Zebra RPC URL "https:\/\/x\.example:999999\/<redacted>"/
    );
  });

  it('12. validateMnemonic: tests invalid words, wrong checksum, 15-word phrase, valid 24-word phrase, and CLI exit', () => {
    // 12a. Valid 24-word phrase accepted
    const valid24 = generateMnemonic(24);
    assert.strictEqual(validateMnemonic(valid24), true, 'Valid 24-word phrase must pass');

    // 12b. Valid 12-word phrase accepted
    const valid12 = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    assert.strictEqual(validateMnemonic(valid12), true, 'Valid 12-word phrase must pass');

    // 12c. 15-word phrase rejected
    const phrase15 = 'abandon '.repeat(15).trim();
    assert.strictEqual(validateMnemonic(phrase15), false, '15-word phrase must fail');

    // 12d. Invalid words rejected (word not in BIP-39 wordlist)
    const invalidWordPhrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon notabipword';
    assert.strictEqual(validateMnemonic(invalidWordPhrase), false, 'Phrase with invalid word must fail');

    // 12e. Wrong checksum rejected (12 valid words with incorrect checksum)
    const wrongChecksumPhrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon';
    assert.strictEqual(validateMnemonic(wrongChecksumPhrase), false, 'Phrase with wrong checksum must fail');

    // 12f. CLI aborts with exact error when invalid mnemonic is imported or passed via env, before writing any file
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mnemonic-cli-test-'));
    try {
      const cliRun = spawnSync(
        process.execPath,
        [
          cliBinPath,
          'invalid-mnemonic-app',
          '--network', 'regtest',
          '--key-source', 'import',
        ],
        {
          cwd: tempDir,
          env: {
            ...process.env,
            ZCASH_MNEMONIC: wrongChecksumPhrase,
          },
          encoding: 'utf8',
        }
      );
      assert.strictEqual(cliRun.status, 1, 'CLI must exit 1 on invalid mnemonic');
      assert.ok(
        cliRun.stderr.includes('Invalid BIP-39 mnemonic (word count, wordlist or checksum)'),
        `Stderr must contain exact error message, got: ${cliRun.stderr}`
      );
      // Assert no mnemonic words are echoed in output
      assert.ok(!cliRun.stdout.includes('abandon'));
      assert.ok(!cliRun.stderr.includes('abandon'));
      // Assert no files were written
      assert.strictEqual(
        fs.existsSync(path.join(tempDir, 'invalid-mnemonic-app')),
        false,
        'No project directory or files must be written when mnemonic is invalid'
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('13. Secret URL and credential redaction: secrets appear only in .env.local and are redacted in zcash.config.json', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-leak-test-'));
    try {
      const qnTestHost = 'x.' + 'quik' + 'node.pro';
      const secretToken = 'SECRET123';
      const secretZebraRpc = `https://${qnTestHost}/${secretToken}/`;
      const secretEndpoint = `user:${secretToken}@127.0.0.1:28137`;

      const run = spawnSync(
        process.execPath,
        [
          cliBinPath,
          'secret-redacted-app',
          '--network', 'regtest',
          '--key-source', 'generate',
          '--zebra-rpc', secretZebraRpc,
          '--endpoint', secretEndpoint,
        ],
        { cwd: tempDir, encoding: 'utf8' }
      );
      assert.strictEqual(run.status, 0, `Scaffolder failed: ${run.stderr}`);

      const projectDir = path.join(tempDir, 'secret-redacted-app');
      const envLocalPath = path.join(projectDir, '.env.local');
      assert.ok(fs.existsSync(envLocalPath), '.env.local must exist');

      // The secret token MUST appear in .env.local
      const envLocalContent = fs.readFileSync(envLocalPath, 'utf8');
      assert.ok(
        envLocalContent.includes(secretToken),
        '.env.local must contain the secret token'
      );

      // Verify zcash.config.json has redacted values
      const configPath = path.join(projectDir, 'zcash.config.json');
      assert.ok(fs.existsSync(configPath), 'zcash.config.json must exist');
      const configContent = fs.readFileSync(configPath, 'utf8');
      const configParsed = JSON.parse(configContent);
      assert.strictEqual(configParsed.zebraRpc, 'https://x.quiknode.pro/<redacted>');
      assert.strictEqual(configParsed.endpoint, '<redacted>@127.0.0.1:28137');
      assert.ok(
        !configContent.includes(secretToken),
        'zcash.config.json must NOT contain the secret token'
      );

      // Verify SECRET123 appears in NO other generated file
      function checkDir(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            checkDir(fullPath);
          } else if (entry.isFile() && entry.name !== '.env.local') {
            const fileContent = fs.readFileSync(fullPath, 'utf8');
            assert.ok(
              !fileContent.includes(secretToken),
              `File "${path.relative(projectDir, fullPath)}" must NOT contain "${secretToken}"`
            );
          }
        }
      }
      checkDir(projectDir);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('14. BIP-39 wordlist SHA-256 integrity: hash equals 2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda', () => {
    assert.strictEqual(BIP39_WORDLIST.length, 2048, 'BIP-39 wordlist must contain exactly 2048 words');
    const text = BIP39_WORDLIST.join('\n') + '\n';
    const actualHash = crypto.createHash('sha256').update(text).digest('hex');
    const expectedHash = '2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda';
    assert.strictEqual(
      actualHash,
      expectedHash,
      `BIP-39 wordlist SHA-256 mismatch: actual ${actualHash} !== expected ${expectedHash}`
    );
  });

  it('15. Scaffolder regtest stack option: --regtest-stack nu7 vs --regtest-stack z3', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stack-test-'));
    try {
      // 15a. NU7 stack
      const runNu7 = spawnSync(
        process.execPath,
        [
          cliBinPath,
          'nu7-app',
          '--network', 'regtest',
          '--regtest-stack', 'nu7',
          '--key-source', 'generate',
        ],
        { cwd: tempDir, encoding: 'utf8' }
      );
      assert.strictEqual(runNu7.status, 0, `Scaffolder NU7 failed: ${runNu7.stderr}`);

      const nu7Dir = path.join(tempDir, 'nu7-app');
      const nu7Env = fs.readFileSync(path.join(nu7Dir, '.env.local'), 'utf8');
      assert.ok(nu7Env.includes('ZCASH_NETWORK=regtest'));
      assert.ok(nu7Env.includes('ZCASH_REGTEST_STACK=nu7'));
      assert.ok(nu7Env.includes('ZCASH_ENDPOINT=127.0.0.1:39067'));
      assert.ok(nu7Env.includes('ZCASH_ZEBRA_RPC=http://127.0.0.1:39232'));

      const nu7Config = JSON.parse(fs.readFileSync(path.join(nu7Dir, 'zcash.config.json'), 'utf8'));
      assert.strictEqual(nu7Config.network, 'regtest');
      assert.strictEqual(nu7Config.regtestStack, 'nu7');
      assert.strictEqual(nu7Config.endpoint, '127.0.0.1:39067');
      assert.strictEqual(nu7Config.zebraRpc, 'http://127.0.0.1:39232');

      const nu7Compose = fs.readFileSync(path.join(nu7Dir, 'docker-compose.yml'), 'utf8');
      assert.ok(nu7Compose.includes('zfnd/zebra:7.0.0'));
      assert.ok(nu7Compose.includes('electriccoinco/lightwalletd:latest'));
      assert.ok(nu7Compose.includes('39067:9067'));
      assert.ok(nu7Compose.includes('39232:18232'));

      // 15b. Z3 stack
      const runZ3 = spawnSync(
        process.execPath,
        [
          cliBinPath,
          'z3-app',
          '--network', 'regtest',
          '--regtest-stack', 'z3',
          '--key-source', 'generate',
        ],
        { cwd: tempDir, encoding: 'utf8' }
      );
      assert.strictEqual(runZ3.status, 0, `Scaffolder Z3 failed: ${runZ3.stderr}`);

      const z3Dir = path.join(tempDir, 'z3-app');
      const z3Env = fs.readFileSync(path.join(z3Dir, '.env.local'), 'utf8');
      assert.ok(z3Env.includes('ZCASH_NETWORK=regtest'));
      assert.ok(z3Env.includes('ZCASH_REGTEST_STACK=z3'));
      assert.ok(z3Env.includes('ZCASH_ENDPOINT=127.0.0.1:28137'));
      assert.ok(z3Env.includes('ZCASH_ZEBRA_RPC=http://127.0.0.1:18232'));

      const z3Config = JSON.parse(fs.readFileSync(path.join(z3Dir, 'zcash.config.json'), 'utf8'));
      assert.strictEqual(z3Config.network, 'regtest');
      assert.strictEqual(z3Config.regtestStack, 'z3');
      assert.strictEqual(z3Config.endpoint, '127.0.0.1:28137');
      assert.strictEqual(z3Config.zebraRpc, 'http://127.0.0.1:18232');

      const z3Compose = fs.readFileSync(path.join(z3Dir, 'docker-compose.yml'), 'utf8');
      assert.ok(z3Compose.includes('zingodevops/zainod:0.10.0-no-tls'));
      assert.ok(z3Compose.includes('28137:28137'));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('16. Unbound WalletHandle.open regression test: executeSend with default openFn exercises receiver binding', async () => {
    // When openWalletFn is omitted from deps, executeSend must call WalletHandle.open with WalletHandle as receiver
    let syncCalled = false;
    let sendCalled = false;

    const mockClient = {
      close: async () => {},
      config: { network: 'regtest-nu7', endpoint: '127.0.0.1:39067' },
    };

    const res = await executeSend(
      {
        to: 'uregtest1cjtspqcvw97evv27s0qfq55e347hwwp02s0hsvvgdfh05j5cydf7q2x6e09vd72776c5354h2v72zsw649w30cqq6jffwsv9h679f6m25p',
        amount: '0.05',
        yes: true,
      },
      {
        ZCASH_NETWORK: 'regtest',
        ZCASH_REGTEST_STACK: 'nu7',
        ZCASH_ENDPOINT: '127.0.0.1:39067',
      },
      {
        client: mockClient,
        // openWalletFn deliberately omitted to exercise default openFn
        syncWalletFn: async (client, wallet) => {
          syncCalled = true;
          assert.ok(wallet, 'Wallet instance must be passed to syncWalletFn');
          assert.strictEqual(typeof wallet.getWalletSummary, 'function');
        },
        sendFn: async (opts) => {
          sendCalled = true;
          return { txid: 'regression-unbound-open-txid-12345' };
        },
      }
    );

    assert.strictEqual(syncCalled, true, 'syncWalletFn must be called');
    assert.strictEqual(sendCalled, true, 'sendFn must be called');
    assert.strictEqual(res.txid, 'regression-unbound-open-txid-12345');
    assert.strictEqual(res.isDryRun, false);
  });

  it('17. executeFund unit tests: NU7 SDK send vs Z3 Zallet RPC router with stubbed dependencies', async () => {
    const targetUa = 'uregtest1cjtspqcvw97evv27s0qfq55e347hwwp02s0hsvvgdfh05j5cydf7q2x6e09vd72776c5354h2v72zsw649w30cqq6jffwsv9h679f6m25p';

    // 17a. NU7 stack funding via SDK send path
    let nu7SyncCalled = false;
    let nu7SendCalled = false;
    const mockNu7Client = {
      close: async () => {},
      config: { network: 'regtest-nu7', endpoint: '127.0.0.1:39067' },
    };

    const nu7FundRes = await executeFund(
      { address: targetUa, amount: '3.5', stack: 'nu7' },
      { ZCASH_NETWORK: 'regtest', ZCASH_REGTEST_STACK: 'nu7', ZCASH_ENDPOINT: '127.0.0.1:39067' },
      {
        client: mockNu7Client,
        syncWalletFn: async (client, wallet) => {
          nu7SyncCalled = true;
          assert.ok(wallet);
        },
        sendFn: async (opts) => {
          nu7SendCalled = true;
          assert.strictEqual(opts.to, targetUa);
          assert.strictEqual(opts.amount, 350000000n);
          return { txid: 'mock-nu7-fund-txid-abcdef' };
        },
      }
    );

    assert.strictEqual(nu7SyncCalled, true);
    assert.strictEqual(nu7SendCalled, true);
    assert.strictEqual(nu7FundRes.stack, 'nu7');
    assert.strictEqual(nu7FundRes.txid, 'mock-nu7-fund-txid-abcdef');
    assert.strictEqual(nu7FundRes.amountZec, '3.5');
    assert.strictEqual(nu7FundRes.zatoshis, 350000000n);

    // 17b. Z3 stack funding via Zallet RPC router
    const calls = [];
    const mockZ3Fetch = async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      const body = JSON.parse(init.body);
      if (body.method === 'listaddresses') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            result: [
              {
                unified: [
                  {
                    addresses: [
                      { address: 'uregtest1_mock_zallet_sender_address' },
                    ],
                  },
                ],
              },
            ],
          }),
        };
      }
      if (body.method === 'z_sendmany') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            result: 'mock-z3-fund-txid-998877',
          }),
        };
      }
      throw new Error(`Unexpected RPC method: ${body.method}`);
    };

    const z3FundRes = await executeFund(
      { address: targetUa, amount: '1.25', stack: 'z3' },
      { ZCASH_NETWORK: 'regtest', ZCASH_REGTEST_STACK: 'z3', ZCASH_ENDPOINT: '127.0.0.1:28137' },
      { fetchFn: mockZ3Fetch }
    );

    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls[0].body.method, 'listaddresses');
    assert.strictEqual(calls[1].body.method, 'z_sendmany');
    assert.strictEqual(calls[1].body.params[0], 'uregtest1_mock_zallet_sender_address');
    assert.strictEqual(calls[1].body.params[1][0].address, targetUa);
    assert.strictEqual(calls[1].body.params[1][0].amount, '1.25000000');
    assert.strictEqual(z3FundRes.stack, 'z3');
    assert.strictEqual(z3FundRes.txid, 'mock-z3-fund-txid-998877');
    assert.strictEqual(z3FundRes.amountZec, '1.25');
    assert.strictEqual(z3FundRes.zatoshis, 125000000n);

    // 17c. Backend missing error handling
    await assert.rejects(
      async () => {
        await executeFund(
          { address: targetUa, amount: '1.0', stack: 'nu7' },
          { ZCASH_NETWORK: 'regtest', ZCASH_REGTEST_STACK: 'nu7', ZCASH_ENDPOINT: '127.0.0.1:39067' },
          {
            client: mockNu7Client,
            syncWalletFn: async () => {
              throw new Error('connect ECONNREFUSED 127.0.0.1:39067');
            },
          }
        );
      },
      /Could not connect to NU7 lightwalletd indexer at 127.0.0.1:39067\. Is the NU7 stack running\? Run: zcash-dev regtest up --stack nu7/
    );

    await assert.rejects(
      async () => {
        await executeFund(
          { address: targetUa, amount: '1.0', stack: 'z3' },
          { ZCASH_NETWORK: 'regtest', ZCASH_REGTEST_STACK: 'z3', ZCASH_ENDPOINT: '127.0.0.1:28137' },
          {
            fetchFn: async () => {
              throw new Error('fetch failed ECONNREFUSED');
            },
          }
        );
      },
      /Could not connect to Z3 RPC router \/ Zallet at http:\/\/127\.0\.0\.1:8181\. Is the Z3 stack running\? Run: zcash-dev regtest up --stack nu6/
    );
  });

  it('18. regtest-init.sh retry logic & CLI execSync error handling', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cza-test-regtest-init-'));
    const binDir = path.join(tmpDir, 'bin');
    fs.mkdirSync(binDir, { recursive: true });

    // Mock docker
    fs.writeFileSync(
      path.join(binDir, 'docker'),
      `#!/bin/sh
if [ "$1" = "compose" ] && [ "$2" = "logs" ]; then
  for i in $(seq 1 20); do echo "mock-zebra-log-line-$i"; done
fi
exit 0
`,
      { mode: 0o755 }
    );

    // Mock nc
    fs.writeFileSync(
      path.join(binDir, 'nc'),
      `#!/bin/sh
exit 0
`,
      { mode: 0o755 }
    );

    const scriptPath = path.resolve(__dirname, '../docker/regtest-nu7/regtest-init.sh');

    // 18a: Generate fails twice, then works -> retries and succeeds
    const stateFile = path.join(tmpDir, 'count.txt');
    fs.writeFileSync(stateFile, '0');

    fs.writeFileSync(
      path.join(binDir, 'curl'),
      `#!/usr/bin/env bash
for arg in "$@"; do
  if [[ "$arg" =~ "getblockchaininfo" ]]; then
    echo '{"jsonrpc":"2.0","id":1,"result":{"blocks":0}}'
    exit 0
  fi
  if [[ "$arg" =~ "generate" ]]; then
    CNT=$(cat "${stateFile}")
    CNT=$((CNT + 1))
    echo "$CNT" > "${stateFile}"
    if [ "$CNT" -le 2 ]; then
      echo '{"jsonrpc":"2.0","id":1,"error":{"code":-32603,"message":"startup race: state not initialized"}}'
      exit 0
    else
      echo '{"jsonrpc":"2.0","id":1,"result":["00000001","00000002"]}'
      exit 0
    fi
  fi
done
exit 0
`,
      { mode: 0o755 }
    );

    const successRun = spawnSync('bash', [scriptPath], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        GENERATE_TIMEOUT_SECS: '10',
      },
      encoding: 'utf8',
    });

    assert.strictEqual(successRun.status, 0, `Expected 0, stderr: ${successRun.stderr}`);
    assert.match(successRun.stdout, /Blocks mined\. NU7 is now active\./);
    assert.strictEqual(fs.readFileSync(stateFile, 'utf8').trim(), '3');

    // 18b: Permanent failure -> prints last response body & last 20 lines of docker compose logs, exits 1
    fs.writeFileSync(
      path.join(binDir, 'curl'),
      `#!/usr/bin/env bash
for arg in "$@"; do
  if [[ "$arg" =~ "getblockchaininfo" ]]; then
    echo '{"jsonrpc":"2.0","id":1,"result":{"blocks":0}}'
    exit 0
  fi
  if [[ "$arg" =~ "generate" ]]; then
    echo '{"jsonrpc":"2.0","id":1,"error":{"code":-32603,"message":"fatal startup crash permanent"}}'
    exit 0
  fi
done
exit 0
`,
      { mode: 0o755 }
    );

    const failRun = spawnSync('bash', [scriptPath], {
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        GENERATE_TIMEOUT_SECS: '2',
      },
      encoding: 'utf8',
    });

    assert.strictEqual(failRun.status, 1);
    assert.match(failRun.stderr, /Failed to mine initial blocks within 2s\./);
    assert.match(failRun.stderr, /fatal startup crash permanent/);
    assert.match(failRun.stderr, /mock-zebra-log-line-20/);

    // 18c: CLI handling when execSync of init script fails -> prints one clear line, no stack trace
    const dummyRegtestDir = path.join(tmpDir, 'dummy-regtest');
    fs.mkdirSync(dummyRegtestDir, { recursive: true });
    fs.writeFileSync(path.join(dummyRegtestDir, 'docker-compose.yml'), 'version: "3"\n');
    fs.writeFileSync(
      path.join(dummyRegtestDir, 'regtest-init.sh'),
      '#!/bin/sh\necho "simulated init error"\nexit 1\n',
      { mode: 0o755 }
    );

    const cliRun = spawnSync(
      process.execPath,
      [devBinPath, 'regtest', 'up', '--stack', 'nu7', '--regtest-path', dummyRegtestDir],
      { encoding: 'utf8' }
    );

    assert.strictEqual(cliRun.status, 1);
    assert.match(cliRun.stderr, /regtest-init\.sh failed, see output above/);
    assert.doesNotMatch(cliRun.stderr, /node:child_process/);
    assert.doesNotMatch(cliRun.stderr, /at checkExecSyncError/);
    assert.doesNotMatch(cliRun.stderr, /Command failed:/);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
