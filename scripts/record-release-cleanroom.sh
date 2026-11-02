#!/usr/bin/env bash
# Verifies the release path and clean-room installation for create-zcash-app 0.1.0-alpha.2.
# 1. Builds TypeScript packages.
# 2. Packs all 9 packages into tarballs using workflow conventions.
# 3. Runs release.yml sanity checks (license, repo URL, zero workspace: ranges, addon isolation).
# 4. Performs a clean-room install in a temp directory:
#    - npm init -y
#    - npm install packed tarballs (create-zcash-app, sdk, dev, core, host core addon)
#    - npx create-zcash-app qs --network regtest --key-source generate
#    - verifies qs/package.json declares dependencies on ^0.1.0-alpha.2
#    - npx zcash-dev --help inside qs
#    - npx zcash-dev address inside qs (verifies native addon loads and derives address)
#
# Output log: packages/core/tests/logs/release_cleanroom_alpha2.log
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

LOG="$REPO_ROOT/packages/core/tests/logs/release_cleanroom_alpha2.log"
PACKS_DIR="${PACKS_DIR:-/tmp/release-packs-alpha2}"
CLEAN_DIR="${CLEAN_DIR:-/tmp/cza-alpha2-cleanroom}"

mkdir -p "$(dirname "$LOG")"

sha256() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$@"
  else
    sha256sum "$@"
  fi
}

{
  echo "=== create-zcash-app 0.1.0-alpha.2 release verification & clean-room proof ==="
  echo "date:        $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "repo:        $REPO_ROOT"
  echo "node:        $(node --version)"
  echo "npm:         $(npm --version)"
  echo "pnpm:        $(pnpm --version)"
  echo "os:          $(uname -sm)"
  echo

  echo "--- step 1: build TypeScript packages ---"
  pnpm --filter @zcash-app/sdk build
  pnpm --filter zcash-dev build
  pnpm --filter create-zcash-app build
  echo "TypeScript packages built successfully."
  echo

  echo "--- step 2: pack all 9 packages into $PACKS_DIR ---"
  rm -rf "$PACKS_DIR"
  mkdir -p "$PACKS_DIR"

  for dir in packages/core packages/sdk packages/dev packages/cli packages/core/npm/*/; do
    cp "$REPO_ROOT/LICENSE" "$dir/"
  done

  CORE_BAK="/tmp/core-package-json.bak"
  cp "$REPO_ROOT/packages/core/package.json" "$CORE_BAK"

  CREATED_PLACEHOLDERS=()
  cleanup_placeholders() {
    cp "$CORE_BAK" "$REPO_ROOT/packages/core/package.json"
    rm -f "$CORE_BAK"
    for f in "${CREATED_PLACEHOLDERS[@]}"; do
      rm -f "$f"
    done
  }
  trap cleanup_placeholders EXIT

  for spec in \
    'darwin-arm64 zcash-core.darwin-arm64.node' \
    'darwin-x64 zcash-core.darwin-x64.node' \
    'linux-arm64-gnu zcash-core.linux-arm64-gnu.node' \
    'linux-x64-gnu zcash-core.linux-x64-gnu.node' \
    'win32-x64-msvc zcash-core.win32-x64-msvc.node'; do
    set -- $spec
    target_file="$REPO_ROOT/packages/core/npm/$1/$2"
    if [ ! -f "$target_file" ]; then
      head -c 1024 /dev/zero > "$target_file"
      CREATED_PLACEHOLDERS+=("$target_file")
      echo "temporary placeholder for non-host target: packages/core/npm/$1/$2"
    fi
  done

  node - "$REPO_ROOT/packages/core/package.json" <<'NODE'
  const fs = require('fs');
  const file = process.argv[2];
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  pkg.optionalDependencies = {
    '@zcash-app/core-darwin-arm64': pkg.version,
    '@zcash-app/core-darwin-x64': pkg.version,
    '@zcash-app/core-linux-arm64-gnu': pkg.version,
    '@zcash-app/core-linux-x64-gnu': pkg.version,
    '@zcash-app/core-win32-x64-msvc': pkg.version,
  };
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
NODE

  pnpm --filter @zcash-app/core pack --pack-destination "$PACKS_DIR"
  pnpm --filter @zcash-app/sdk pack --pack-destination "$PACKS_DIR"
  pnpm --filter zcash-dev pack --pack-destination "$PACKS_DIR"
  pnpm --filter create-zcash-app pack --pack-destination "$PACKS_DIR"
  for dir in packages/core/npm/*/; do
    (cd "$dir" && pnpm pack --pack-destination "$PACKS_DIR")
  done

  cleanup_placeholders
  trap - EXIT

  echo "packed tarballs in $PACKS_DIR:"
  ls -1 "$PACKS_DIR"/*.tgz | while read -r f; do basename "$f"; done
  echo "total tarballs: $(ls -1 "$PACKS_DIR"/*.tgz | wc -l | tr -d ' ')"
  echo

  echo "--- step 3: run release.yml sanity checks on tarballs ---"
  node - "$PACKS_DIR" <<'NODE'
  const fs = require('fs');
  const path = require('path');
  const { execSync } = require('child_process');
  const packsDir = process.argv[2];

  const tarballs = fs.readdirSync(packsDir).filter((f) => f.endsWith('.tgz'));
  if (tarballs.length !== 9) {
    console.error(`EXPECTED exactly 9 tarballs in ${packsDir}, found ${tarballs.length}`);
    process.exit(1);
  }

  const expectedUrl = 'git+https://github.com/Ultra-Tech-code/create-zcash-app.git';
  let failures = 0;

  for (const file of tarballs) {
    const full = path.join(packsDir, file);
    const listing = execSync(`tar -tzf ${full}`, { encoding: 'utf8' }).split('\n').filter(Boolean);
    const manifest = JSON.parse(
      execSync(`tar -xzOf ${full} package/package.json`, { encoding: 'utf8' })
    );

    if (manifest.license !== 'Apache-2.0') {
      console.error(`INVALID LICENSE in ${file}: expected Apache-2.0, found ${manifest.license}`);
      failures++;
    }
    if (!manifest.repository || manifest.repository.url !== expectedUrl) {
      console.error(
        `INVALID REPOSITORY in ${file}: expected ${expectedUrl}, found ${manifest.repository ? manifest.repository.url : undefined}`
      );
      failures++;
    }
    if (!listing.includes('package/LICENSE')) {
      console.error(`MISSING package/LICENSE in ${file}`);
      failures++;
    }
    const workspaceRanges = Object.entries({
      ...(manifest.dependencies || {}),
      ...(manifest.optionalDependencies || {}),
      ...(manifest.peerDependencies || {}),
      ...(manifest.devDependencies || {}),
    }).filter(([, range]) => String(range).includes('workspace:'));
    if (workspaceRanges.length > 0) {
      console.error(
        `WORKSPACE RANGE IN ${file}: ` + workspaceRanges.map(([n, r]) => `${n}=${r}`).join(', ')
      );
      failures++;
    }
    console.log(`tarball check ok: ${file} (workspace ranges: 0, license: ${manifest.license}, version: ${manifest.version})`);
  }

  const expected = [
    { pattern: /^zcash-app-core-\d/, isCore: true, entries: ['package/index.js', 'package/index.d.ts'] },
    { pattern: /^zcash-app-sdk-\d/, entries: ['package/dist/index.js', 'package/dist/index.d.ts'] },
    { pattern: /^zcash-dev-\d/, entries: ['package/dist/cli.js', 'package/dist/index.js'] },
    { pattern: /^create-zcash-app-\d/, entries: ['package/dist/index.js', 'package/template/package.json.tmpl'] },
  ];

  for (const { pattern, isCore, entries } of expected) {
    const file = tarballs.find((f) => pattern.test(f));
    if (!file) {
      console.error(`MISSING TARBALL: nothing matching ${pattern}`);
      failures++;
      continue;
    }
    const full = path.join(packsDir, file);
    const listing = execSync(`tar -tzf ${full}`, { encoding: 'utf8' }).split('\n');
    for (const entry of entries) {
      if (!listing.includes(entry)) {
        console.error(`MISSING ${entry} in ${file}`);
        failures++;
      }
    }
    if (isCore && listing.some((l) => l.endsWith('.node'))) {
      console.error(
        `UNEXPECTED native addon in ${file}: addons belong in the per-platform packages`
      );
      failures++;
    }
  }

  if (failures > 0) process.exit(1);
  console.log('✅ All 9 tarballs passed manifest and structure validation.');
NODE
  echo

  echo "--- step 4: clean-room install and verification in $CLEAN_DIR ---"
  rm -rf "$CLEAN_DIR"
  mkdir -p "$CLEAN_DIR"
  cd "$CLEAN_DIR"

  echo "1. Initialize clean npm package"
  npm init -y

  echo "2. Install packed tarballs into clean room"
  npm install \
    "$PACKS_DIR"/create-zcash-app-0.1.0-alpha.2.tgz \
    "$PACKS_DIR"/zcash-app-sdk-0.1.0-alpha.2.tgz \
    "$PACKS_DIR"/zcash-dev-0.1.0-alpha.2.tgz \
    "$PACKS_DIR"/zcash-app-core-0.1.0-alpha.2.tgz \
    "$PACKS_DIR"/zcash-app-core-darwin-arm64-0.1.0-alpha.2.tgz

  echo "3. Run create-zcash-app scaffolder"
  npx create-zcash-app qs --network regtest --key-source generate < /dev/null

  echo "4. Verify scaffolded qs/package.json dependency ranges"
  node -e '
  const fs = require("fs");
  const pkg = JSON.parse(fs.readFileSync("qs/package.json", "utf8"));
  console.log("qs dependencies:", JSON.stringify(pkg.dependencies, null, 2));
  console.log("qs devDependencies:", JSON.stringify(pkg.devDependencies, null, 2));

  if (pkg.dependencies["@zcash-app/sdk"] !== "^0.1.0-alpha.2") {
    console.error("FAIL: @zcash-app/sdk range is " + pkg.dependencies["@zcash-app/sdk"] + ", expected ^0.1.0-alpha.2");
    process.exit(1);
  }
  if (pkg.devDependencies["zcash-dev"] !== "^0.1.0-alpha.2") {
    console.error("FAIL: zcash-dev range is " + pkg.devDependencies["zcash-dev"] + ", expected ^0.1.0-alpha.2");
    process.exit(1);
  }
  console.log("✅ Verified: scaffolded app depends on @zcash-app/sdk@^0.1.0-alpha.2 and zcash-dev@^0.1.0-alpha.2");
'

  echo "5. Enter qs directory and verify npx zcash-dev --help"
  cd qs
  npx zcash-dev --help

  echo
  echo "6. Run npx zcash-dev address (verifies key derivation via native addon)"
  npx zcash-dev address

  echo
  echo "7. Clean up temporary test artifacts"
  cd "$REPO_ROOT"
  rm -rf "$PACKS_DIR" "$CLEAN_DIR"

  echo
  echo "=== Clean-room install verification SUCCEEDED ==="
} 2>&1 | tee "$LOG"

echo
echo "log:        $LOG"
echo "log sha256: $(sha256 "$LOG" | cut -d' ' -f1)"
