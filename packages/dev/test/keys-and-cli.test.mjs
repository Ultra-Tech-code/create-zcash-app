import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
  generateMnemonic,
  quoteFee,
  program as devProgram,
} from '../dist/index.js';

import {
  verifyGitignoreProtectsEnvLocal,
  program as cliProgram,
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

    function createRouteInstance(envOverrides = {}) {
      const savedEnv = { ...process.env };
      Object.assign(process.env, envOverrides);

      const mockNextResponse = {
        json: (body, init) => ({
          status: init?.status ?? 200,
          json: async () => body,
          body,
        }),
      };

      const customRequire = (id) => {
        if (id === 'next/server') return { NextResponse: mockNextResponse };
        if (id === '@zcash-app/sdk') return require(path.resolve(__dirname, '../../sdk/dist/index.js'));
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
});
