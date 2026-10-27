import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(here, '../dist/cli.js');

/**
 * `zcash-dev regtest wipe` must never delete anything without an explicit --yes.
 * The CLI resolves the z3 project from --z3-path, verifies COMPOSE_PROJECT_NAME,
 * prints the derived volumes, and only then asks for confirmation. With stdin not
 * attached to a TTY there is nobody to ask, so it must abort with exit code 1.
 */
test('zcash-dev regtest wipe refuses to run without --yes (default z3-regtest)', () => {
  assert.ok(fs.existsSync(cli), `built CLI missing at ${cli}; run pnpm --filter zcash-dev build`);

  const z3Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zcash-dev-wipe-refusal-'));
  fs.writeFileSync(path.join(z3Dir, 'docker-compose.yml'), 'name: z3-regtest\nservices: {}\n');
  const marker = path.join(z3Dir, 'chain-marker');
  fs.writeFileSync(marker, 'must survive the refused wipe\n');

  const res = spawnSync(process.execPath, [cli, 'regtest', 'wipe', '--z3-path', z3Dir], {
    encoding: 'utf8',
    input: '',
    timeout: 120_000,
  });

  assert.equal(res.status, 1, `expected exit 1, got ${res.status} (stderr: ${res.stderr})`);
  assert.match(res.stderr, /Wipe aborted: explicit confirmation required/);
  assert.match(res.stderr, /--yes/);

  // Nothing may be deleted by a refused wipe.
  assert.ok(fs.existsSync(marker), 'refused wipe must not delete project files');
  assert.equal(fs.readFileSync(marker, 'utf8'), 'must survive the refused wipe\n');

  fs.rmSync(z3Dir, { recursive: true, force: true });
});

test('zcash-dev regtest wipe refuses to run without --yes (nu7 stack: zcash-regtest-nu7)', () => {
  const nu7Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zcash-dev-wipe-nu7-refusal-'));
  fs.writeFileSync(path.join(nu7Dir, 'docker-compose.yml'), 'name: zcash-regtest-nu7\nservices: {}\n');
  const marker = path.join(nu7Dir, 'chain-marker');
  fs.writeFileSync(marker, 'must survive the refused wipe\n');

  const res = spawnSync(process.execPath, [cli, 'regtest', 'wipe', '--regtest-path', nu7Dir], {
    encoding: 'utf8',
    input: '',
    timeout: 120_000,
  });

  assert.equal(res.status, 1, `expected exit 1, got ${res.status} (stderr: ${res.stderr})`);
  assert.match(res.stderr, /Wipe aborted: explicit confirmation required/);
  assert.match(res.stderr, /--yes/);

  assert.ok(fs.existsSync(marker), 'refused wipe must not delete project files');
  fs.rmSync(nu7Dir, { recursive: true, force: true });
});

test('zcash-dev regtest wipe refuses untrusted project name', () => {
  const badDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zcash-dev-wipe-bad-project-'));
  fs.writeFileSync(path.join(badDir, 'docker-compose.yml'), 'name: mainnet-validator-node\nservices: {}\n');

  const res = spawnSync(process.execPath, [cli, 'regtest', 'wipe', '--regtest-path', badDir, '--yes'], {
    encoding: 'utf8',
    input: '',
    timeout: 120_000,
  });

  assert.equal(res.status, 1, `expected exit 1, got ${res.status}`);
  assert.match(res.stderr, /Refusing to wipe: Expected name to be one of/);
  assert.match(res.stderr, /z3-regtest/);
  assert.match(res.stderr, /zcash-regtest-nu7/);

  fs.rmSync(badDir, { recursive: true, force: true });
});

test('zcash-dev regtest wipe --dry-run accepts zcash-regtest-nu7 project name', () => {
  const nu7Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zcash-dev-wipe-dryrun-'));
  fs.writeFileSync(path.join(nu7Dir, 'docker-compose.yml'), 'name: zcash-regtest-nu7\nservices: {}\n');

  const res = spawnSync(process.execPath, [cli, 'regtest', 'wipe', '--regtest-path', nu7Dir, '--dry-run'], {
    encoding: 'utf8',
    input: '',
    timeout: 120_000,
  });

  assert.equal(res.status, 0, `expected exit 0, got ${res.status} (stderr: ${res.stderr})`);
  assert.match(res.stdout, /Project Name:\s+zcash-regtest-nu7/);
  assert.match(res.stdout, /Dry Run complete: zero destructive actions executed/);

  fs.rmSync(nu7Dir, { recursive: true, force: true });
});

test('miner address helper derives Account 0 for regtest and strictly refuses non-regtest networks', async () => {
  const { getRegtestAccount0MinerAddress } = await import('../dist/cli.js');

  const nu7Address = getRegtestAccount0MinerAddress('regtest-nu7');
  assert.ok(nu7Address.startsWith('uregtest1'), `expected uregtest1 address, got: ${nu7Address}`);

  const regtestAddress = getRegtestAccount0MinerAddress('regtest');
  assert.ok(regtestAddress.startsWith('uregtest1'), `expected uregtest1 address, got: ${regtestAddress}`);

  assert.throws(
    () => getRegtestAccount0MinerAddress('mainnet'),
    /Refusing miner address derivation for non-regtest network "mainnet"/
  );

  assert.throws(
    () => getRegtestAccount0MinerAddress('testnet'),
    /Refusing miner address derivation for non-regtest network "testnet"/
  );
});
