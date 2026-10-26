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
test('zcash-dev regtest wipe refuses to run without --yes', () => {
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
