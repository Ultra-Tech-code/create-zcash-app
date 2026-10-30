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

  echo "--- step 2: pack tarballs ---"
  pnpm --filter @zcash-app/core pack --pack-destination "$TARBALLS"
  pnpm --filter @zcash-app/sdk pack --pack-destination "$TARBALLS"
  pnpm --filter zcash-dev pack --pack-destination "$TARBALLS"
  pnpm --filter create-zcash-app pack --pack-destination "$TARBALLS"
  echo
  echo "tarballs:"
  (cd "$TARBALLS" && ls -1 *.tgz)
  echo
  echo "sha256:"
  (cd "$TARBALLS" && sha256 *.tgz)
  echo

  CORE_TGZ="$(cd "$TARBALLS" && ls -1 zcash-app-core-*.tgz)"
  SDK_TGZ="$(cd "$TARBALLS" && ls -1 zcash-app-sdk-*.tgz)"
  DEV_TGZ="$(cd "$TARBALLS" && ls -1 zcash-dev-*.tgz)"
  CLI_TGZ="$(cd "$TARBALLS" && ls -1 create-zcash-app-*.tgz)"

  echo "--- step 3: run the packed scaffolder non-interactively ---"
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

  echo "--- step 4: point the scaffolded dependencies at the packed tarballs ---"
  node - "$APP_DIR/package.json" "$CORE_TGZ" "$SDK_TGZ" "$DEV_TGZ" <<'NODE'
const fs = require('fs');
const [packageJsonPath, coreTgz, sdkTgz, devTgz] = process.argv.slice(2);
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
const overridesBlock = [
  'overrides:',
  `  '@zcash-app/core': file:../tarballs/${coreTgz}`,
  `  '@zcash-app/sdk': file:../tarballs/${sdkTgz}`,
  '',
].join('\n');
fs.writeFileSync(workspaceYamlPath, existingWorkspaceYaml + overridesBlock);
console.log(`scaffolder declared @zcash-app/sdk ${declaredSdkRange} and zcash-dev ${declaredDevRange}`);
console.log(`installing from file:../tarballs/${sdkTgz}`);
NODE
  echo

  echo "--- step 5: pnpm install ---"
  (
    cd "$APP_DIR"
    NEXT_TELEMETRY_DISABLED=1 pnpm install
  )
  echo

  echo "--- step 6: pnpm build ---"
  (
    cd "$APP_DIR"
    NEXT_TELEMETRY_DISABLED=1 pnpm build
  )
  echo

  echo "--- step 7: build output ---"
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

  echo "--- step 8: the installed SDK loads its native addon at runtime ---"
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
