#!/usr/bin/env bash
# Proves that `create-zcash-app` emits a Next.js project that installs and builds against the exact
# packages we intend to publish, without relying on the workspace.
#
#   bash scripts/prove-scaffold-template.sh [work-dir]
#
# Layout it creates:
#   <work-dir>/tarballs/*.tgz   `pnpm pack` output for core, sdk, zcash-dev and create-zcash-app
#   <work-dir>/my-app/          the scaffolded project, installed with `file:` dependencies
#
# Log: packages/core/tests/logs/scaffold_template_build.log
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

LOG="packages/core/tests/logs/scaffold_template_build.log"
WORK_DIR="${1:-$(mktemp -d "${TMPDIR:-/tmp}/cza-release-proof.XXXXXX")}"

sha256() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$@"
  else
    sha256sum "$@"
  fi
}
TARBALLS="$WORK_DIR/tarballs"
APP_DIR="$WORK_DIR/my-app"

mkdir -p "$WORK_DIR" "$(dirname "$LOG")"
mkdir -p "$TARBALLS"

{
  echo "=== create-zcash-app template release proof ==="
  echo "date:        $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "repo:        $REPO_ROOT"
  echo "work dir:    $WORK_DIR"
  echo "node:        $(node --version)"
  echo "pnpm:        $(pnpm --version)"
  echo

  echo "--- step 1: build the TypeScript packages the tarballs are made from ---"
  if ! ls packages/core/*.node >/dev/null 2>&1; then
    echo "no native addon found; building @zcash-app/core (this runs cargo in release mode)"
    pnpm --filter @zcash-app/core build
  fi
  pnpm --filter @zcash-app/sdk build
  pnpm --filter zcash-dev build
  pnpm --filter create-zcash-app build
  echo

  echo "--- step 2: put the host-built addon in its per-platform package ---"
  # The native addon is not shipped inside the root @zcash-app/core tarball. `napi artifacts`
  # copies each zcash-core.<target>.node into packages/core/npm/<platform>/, and those packages are
  # what @zcash-app/core lists as optionalDependencies. Only the host target is built here, so
  # place that one; CI builds every target and packs all five.
  pnpm --filter @zcash-app/core exec napi create-npm-dirs
  for addon in packages/core/*.node; do
    platform="${addon##*/}"
    platform="${platform#zcash-core.}"
    platform="${platform%.node}"
    cp "$addon" "packages/core/npm/$platform/"
    echo "placed $addon in packages/core/npm/$platform/"
  done
  echo
  echo "per-platform addon check (exactly one .node per packages/core/npm/<platform>/):"
  # PROVE_PER_PLATFORM_ADDONS=1 is what CI sets: a release build must have an addon for every
  # napi target. Locally only the host target exists, so the missing-platform part of the check is
  # reported but not fatal here; an unexpected second addon or a broken dir is fatal in both modes.
  node - "$REPO_ROOT" "${PROVE_PER_PLATFORM_ADDONS:-0}" <<'NODE'
const fs = require('fs');
const path = require('path');
const [repoRoot, strict] = process.argv.slice(2);
const NPM_PLATFORM = {
  'aarch64-apple-darwin': 'darwin-arm64',
  'x86_64-apple-darwin': 'darwin-x64',
  'x86_64-unknown-linux-gnu': 'linux-x64-gnu',
  'aarch64-unknown-linux-gnu': 'linux-arm64-gnu',
  'x86_64-pc-windows-msvc': 'win32-x64-msvc',
};
const core = JSON.parse(fs.readFileSync(path.join(repoRoot, 'packages/core/package.json'), 'utf8'));
const targets = (core.napi && core.napi.targets) || [];
const missing = [];
let failures = 0;
for (const target of targets) {
  const platform = NPM_PLATFORM[target] || target;
  const dir = path.join(repoRoot, 'packages/core/npm', platform);
  const addons = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.node')) : [];
  if (addons.length === 1) {
    console.log(`  ok   ${platform}: ${addons[0]}`);
  } else if (addons.length > 1) {
    console.error(`  FAIL ${platform}: ${addons.length} addons, expected exactly one`);
    failures++;
  } else {
    missing.push(platform);
  }
}
if (targets.length === 0) {
  console.error('FAIL: no napi targets in packages/core/package.json');
  failures++;
}
if (missing.length > 0) {
  const line = `  no addon built for: ${missing.join(', ')}`;
  if (strict === '1') {
    console.error(`${line} (PROVE_PER_PLATFORM_ADDONS=1: every target must have one)`);
    failures++;
  } else {
    console.log(`${line} — not built on this host; the every-target assertion is CI-only`);
    console.log('       (locally skipped; CI runs this script with PROVE_PER_PLATFORM_ADDONS=1)');
  }
}
if (failures > 0) process.exit(1);
NODE
  echo

  echo "--- step 3: pack tarballs ---"
  # The root @zcash-app/core manifest gets the platform packages that actually contain an addon,
  # exactly as `napi prepublish` wires optionalDependencies into the published manifest. The
  # original file is restored right after the pack (and on any exit), so the tree stays clean.
  CORE_PKG_BAK="$WORK_DIR/core-package.json.bak"
  cp packages/core/package.json "$CORE_PKG_BAK"
  trap 'cp "$CORE_PKG_BAK" "$REPO_ROOT/packages/core/package.json"' EXIT
  node - "$REPO_ROOT" <<'NODE'
const fs = require('fs');
const path = require('path');
const repoRoot = process.argv[2];
const manifestPath = path.join(repoRoot, 'packages/core/package.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const optionalDependencies = {};
for (const entry of fs.readdirSync(path.join(repoRoot, 'packages/core/npm'))) {
  const dir = path.join(repoRoot, 'packages/core/npm', entry);
  if (!fs.statSync(dir).isDirectory()) continue;
  if (fs.readdirSync(dir).filter((f) => f.endsWith('.node')).length !== 1) continue;
  const platformPkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  optionalDependencies[platformPkg.name] = platformPkg.version;
}
manifest.optionalDependencies = optionalDependencies;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
for (const [name, version] of Object.entries(optionalDependencies)) {
  console.log(`@zcash-app/core optionalDependency: ${name} ${version}`);
}
NODE
  pnpm --filter @zcash-app/core pack --pack-destination "$TARBALLS"
  cp "$CORE_PKG_BAK" packages/core/package.json
  pnpm --filter @zcash-app/sdk pack --pack-destination "$TARBALLS"
  pnpm --filter zcash-dev pack --pack-destination "$TARBALLS"
  pnpm --filter create-zcash-app pack --pack-destination "$TARBALLS"
  for dir in packages/core/npm/*/; do
    if ls "$dir"*.node >/dev/null 2>&1; then
      (cd "$dir" && npm pack --pack-destination "$TARBALLS" >/dev/null)
      echo "packed the platform package in $dir"
    fi
  done
  echo
  echo "tarballs:"
  (cd "$TARBALLS" && ls -1 *.tgz)
  echo
  echo "sha256:"
  (cd "$TARBALLS" && sha256 *.tgz)
  echo

  echo "payload and manifest checks (everything a consumer receives):"
  node - "$TARBALLS" <<'NODE'
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const tarballDir = process.argv[2];
const tarballs = fs.readdirSync(tarballDir).filter((f) => f.endsWith('.tgz'));

// Resource cores are matched by the digit that starts their version, so the platform addon
// tarballs (zcash-app-core-darwin-arm64-…) are not mistaken for @zcash-app/core itself.
const expected = [
  { pattern: /^zcash-app-core-\d/, isCore: true, entries: ['package/index.js', 'package/index.d.ts'] },
  { pattern: /^zcash-app-sdk-\d/, entries: ['package/dist/index.js', 'package/dist/index.d.ts'] },
  { pattern: /^zcash-dev-\d/, entries: ['package/dist/cli.js', 'package/dist/index.js'] },
  { pattern: /^create-zcash-app-\d/, entries: ['package/dist/index.js', 'package/template/package.json.tmpl'] },
];

// One tarball per platform addon package, each holding exactly one .node and nothing in the root
// @zcash-app/core tarball: a duplicated addon is ~7 MB per consumer that cannot use it.
const platformTarballs = tarballs.filter((f) => /^zcash-app-core-[a-z]/.test(f));
const platformPackageNames = platformTarballs.map(
  (f) => '@zcash-app/' + f.replace(/\.tgz$/, '').replace(/^zcash-app-/, '').replace(/-\d+\.\d+\.\d+.*$/, '')
);
let failures = 0;
if (platformTarballs.length === 0) {
  console.error('MISSING platform addon tarball: no zcash-app-core-<platform>-*.tgz was packed');
  failures++;
}
for (const file of platformTarballs) {
  const listing = execSync(`tar -tzf ${path.join(tarballDir, file)}`, { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  const addons = listing.filter((l) => l.endsWith('.node'));
  if (addons.length !== 1) {
    console.error(`EXPECTED exactly one addon in ${file}, found ${addons.length}`);
    failures++;
  } else {
    console.log(`${file}: platform addon ${addons[0]}`);
  }
}

for (const { pattern, isCore, entries } of expected) {
  const file = tarballs.find((f) => pattern.test(f));
  if (!file) {
    console.error(`MISSING TARBALL: nothing matching ${pattern}`);
    failures++;
    continue;
  }
  const full = path.join(tarballDir, file);
  const listing = execSync(`tar -tzf ${full}`, { encoding: 'utf8' }).split('\n');
  const manifest = JSON.parse(
    execSync(`tar -xzOf ${full} package/package.json`, { encoding: 'utf8' })
  );

  for (const entry of entries) {
    if (!listing.includes(entry)) {
      console.error(`MISSING ${entry} in ${file}`);
      failures++;
    }
  }
  if (isCore) {
    const stray = listing.filter((l) => l.endsWith('.node'));
    if (stray.length > 0) {
      console.error(
        `UNEXPECTED native addon in ${file}: addons belong in the per-platform packages ` +
          `(found ${stray.join(', ')})`
      );
      failures++;
    }
    const declared = Object.keys(manifest.optionalDependencies || {});
    const undeclared = platformPackageNames.filter((name) => !declared.includes(name));
    if (undeclared.length > 0) {
      console.error(`MISSING optionalDependencies in ${file}: ${undeclared.join(', ')}`);
      failures++;
    }
    console.log(`  optionalDependencies: ${declared.join(', ') || '(none)'}`);
  }

  const ranges = {
    ...(manifest.dependencies || {}),
    ...(manifest.optionalDependencies || {}),
    ...(manifest.peerDependencies || {}),
    ...(manifest.devDependencies || {}),
  };
  const workspaceRanges = Object.entries(ranges).filter(([, range]) =>
    String(range).includes('workspace:')
  );
  if (workspaceRanges.length > 0) {
    console.error(
      `WORKSPACE RANGE IN ${file}: ` + workspaceRanges.map(([n, r]) => `${n}=${r}`).join(', ')
    );
    failures++;
  }

  console.log(
    `${file}: ${manifest.name}@${manifest.version}, ${listing.length} entries, ` +
      `${Object.keys(ranges).length} declared deps, workspace ranges: ${workspaceRanges.length}`
  );
  for (const [name, range] of Object.entries(ranges)) {
    if (name.startsWith('@zcash-app/') || name === 'zcash-dev') {
      console.log(`  ${name} -> ${range}`);
    }
  }
}

if (failures > 0) {
  console.error(`FAILED: ${failures} tarball check(s) failed`);
  process.exit(1);
}
NODE
  echo

  CORE_TGZ="$(cd "$TARBALLS" && ls -1 zcash-app-core-[0-9]*.tgz)"
  SDK_TGZ="$(cd "$TARBALLS" && ls -1 zcash-app-sdk-*.tgz)"
  DEV_TGZ="$(cd "$TARBALLS" && ls -1 zcash-dev-*.tgz)"
  CLI_TGZ="$(cd "$TARBALLS" && ls -1 create-zcash-app-*.tgz)"

  echo "--- step 4: run the packed scaffolder non-interactively ---"
  # The CLI tarball is installed here (not linked from the workspace) so this exercises what a
  # real `npx create-zcash-app` run gets: dist/ plus the template/ directory, nothing else.
  rm -rf "$APP_DIR" "$WORK_DIR/cli-extract"
  mkdir -p "$WORK_DIR/cli-extract"
  tar -xzf "$TARBALLS/$CLI_TGZ" -C "$WORK_DIR/cli-extract"
  (cd "$WORK_DIR/cli-extract/package" && npm install --omit=dev --no-audit --no-fund --loglevel=error)
  (
    cd "$WORK_DIR"
    node cli-extract/package/dist/index.js my-app --network testnet --remote
  )
  echo
  echo "files written by the scaffolder:"
  (cd "$APP_DIR" && find . -type f -not -path './node_modules/*' | sort)
  echo

  echo "--- step 5: point the scaffolded dependencies at the packed tarballs ---"
  node - "$APP_DIR/package.json" "$CORE_TGZ" "$SDK_TGZ" "$DEV_TGZ" "$TARBALLS" <<'NODE'
const fs = require('fs');
const [packageJsonPath, coreTgz, sdkTgz, devTgz, tarballDir] = process.argv.slice(2);
const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const declaredSdkRange = pkg.dependencies['@zcash-app/sdk'];
const declaredDevRange = pkg.devDependencies['zcash-dev'];

pkg.dependencies['@zcash-app/sdk'] = `file:../tarballs/${sdkTgz}`;
pkg.devDependencies['zcash-dev'] = `file:../tarballs/${devTgz}`;
fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n');

// pnpm 11 reads overrides from pnpm-workspace.yaml, not from package.json. These redirect the
// transitive @zcash-app/core (and sdk) that the packed manifests reference by version to the
// tarballs we just built, which is what a registry install would resolve to. The template's own
// settings (allowBuilds) are kept.
const pathModule = require('path');
const workspaceYamlPath = pathModule.join(pathModule.dirname(packageJsonPath), 'pnpm-workspace.yaml');
const existingWorkspaceYaml = fs.existsSync(workspaceYamlPath)
  ? fs.readFileSync(workspaceYamlPath, 'utf8').trimEnd() + '\n\n'
  : '';
// The native addons are separate packages now, so the platform package(s) packed here have to be
// redirected too: the core tarball lists them as optionalDependencies the way prepublish would.
const platformOverrides = fs
  .readdirSync(tarballDir)
  .filter((f) => /^zcash-app-core-[a-z].*\.tgz$/.test(f))
  .map((f) => {
    const name = f.replace(/\.tgz$/, '').replace(/^zcash-app-/, '').replace(/-\d+\.\d+\.\d+.*$/, '');
    return `  '@zcash-app/${name}': file:../tarballs/${f}`;
  });
const overridesBlock = [
  'overrides:',
  `  '@zcash-app/core': file:../tarballs/${coreTgz}`,
  `  '@zcash-app/sdk': file:../tarballs/${sdkTgz}`,
  ...platformOverrides,
  '',
].join('\n');
fs.writeFileSync(workspaceYamlPath, existingWorkspaceYaml + overridesBlock);
console.log(`scaffolder declared @zcash-app/sdk ${declaredSdkRange} and zcash-dev ${declaredDevRange}`);
console.log(`installing from file:../tarballs/${sdkTgz}`);
NODE
  echo

  echo "--- step 6: pnpm install ---"
  (
    cd "$APP_DIR"
    NEXT_TELEMETRY_DISABLED=1 pnpm install
  )
  echo

  echo "--- step 7: pnpm build ---"
  (
    cd "$APP_DIR"
    NEXT_TELEMETRY_DISABLED=1 pnpm build
  )
  echo

  echo "--- step 8: build output ---"
  test -f "$APP_DIR/.next/BUILD_ID" || { echo "FAILED: .next/BUILD_ID missing"; exit 1; }
  echo "BUILD_ID: $(cat "$APP_DIR/.next/BUILD_ID")"
  node -e "
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const appDir = process.argv[1];
const appRequire = createRequire(path.join(appDir, 'package.json'));
const readVersion = (packageJsonPath) => JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')).version;
const sdkPkg = appRequire.resolve('@zcash-app/sdk/package.json');
const sdkDir = path.dirname(sdkPkg);
const coreCandidates = [path.join(sdkDir, 'node_modules', '@zcash-app', 'core', 'package.json')];
const pnpmStore = path.join(appDir, 'node_modules', '.pnpm');
if (fs.existsSync(pnpmStore)) {
  for (const entry of fs.readdirSync(pnpmStore)) {
    if (!entry.startsWith('@zcash-app+core@')) continue;
    coreCandidates.push(path.join(pnpmStore, entry, 'node_modules', '@zcash-app', 'core', 'package.json'));
  }
}
const corePkg = coreCandidates.find((candidate) => fs.existsSync(candidate));
console.log('installed @zcash-app/sdk  ', readVersion(sdkPkg));
console.log('installed @zcash-app/core ', corePkg ? readVersion(corePkg) + ' (' + path.relative(appDir, corePkg) + ')' : 'not found');
console.log('installed zcash-dev       ', readVersion(appRequire.resolve('zcash-dev/package.json')));
" "$APP_DIR"
  echo

  echo "--- step 9: the installed SDK loads its native addon at runtime ---"
  (
    cd "$APP_DIR"
    node --input-type=module -e "
import { accountFromMnemonic, generateMnemonic } from '@zcash-app/sdk';
const mnemonic = generateMnemonic();
const account = accountFromMnemonic(mnemonic, 0, 'regtest');
const address = account.getUnifiedAddress();
console.log('mnemonic words:', mnemonic.split(' ').length);
console.log('regtest unified address prefix:', address.slice(0, 12) + '…', '(length', address.length + ')');
"
  )
  echo
  echo "RESULT: the scaffolded project installed from tarballs and built successfully"
} 2>&1 | tee "$LOG"

echo
echo "log:       $LOG"
echo "log sha256: $(sha256 "$LOG" | cut -d' ' -f1)"
