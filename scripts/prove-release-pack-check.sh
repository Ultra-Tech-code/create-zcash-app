#!/usr/bin/env bash
# Proves the pack-check verification step of .github/workflows/release.yml against a sandbox
# that mirrors CI artifact and tarball layout.
#
# Tests executed:
#   1. Baseline: 9 valid tarballs (4 core/sdk/dev/cli + 5 platform addons) -> exits 0
#   2. Negative control: tarball missing LICENSE -> exits 1
#   3. Negative control: tarball with wrong repository.url -> exits 1
#   4. Negative control: tarball with wrong license -> exits 1
#   5. Negative control: only 8 tarballs present -> exits 1
#
# Output log: packages/core/tests/logs/release_pack_check.log
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${1:-$(mktemp -d "${TMPDIR:-/tmp}/cza-pack-check-proof.XXXXXX")}"
LOG="$REPO_ROOT/packages/core/tests/logs/release_pack_check.log"

mkdir -p "$WORK" "$(dirname "$LOG")"

sha256() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$@"
  else
    sha256sum "$@"
  fi
}

{
  echo "=== create-zcash-app release pack-check proof ==="
  echo "date:        $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "repo:        $REPO_ROOT"
  echo "work dir:    $WORK"
  echo "node:        $(node --version)"
  echo "pnpm:        $(pnpm --version)"
  echo

  echo "--- step 1: prepare sandbox mirroring CI artifact layout ---"
  SANDBOX="$WORK/sandbox"
  mkdir -p "$SANDBOX/packages/core/npm"
  cp "$REPO_ROOT/packages/core/package.json" "$SANDBOX/packages/core/package.json"

  # Populate all 5 platform directories in sandbox with package.json and placeholder .node binaries
  for platform in darwin-arm64 darwin-x64 linux-arm64-gnu linux-x64-gnu win32-x64-msvc; do
    mkdir -p "$SANDBOX/packages/core/npm/$platform"
    cp "$REPO_ROOT/packages/core/npm/$platform/package.json" "$SANDBOX/packages/core/npm/$platform/package.json"
    addon_name="zcash-core.$platform.node"
    head -c 1024 /dev/zero > "$SANDBOX/packages/core/npm/$platform/$addon_name"
    echo "sandbox addon: packages/core/npm/$platform/$addon_name"
  done
  echo

  echo "--- step 2: pack all 9 tarballs into /tmp/release-packs using workflow steps ---"
  rm -rf /tmp/release-packs
  mkdir -p /tmp/release-packs

  # Execute the workflow's own copy-LICENSE step across all packages
  (
    cd "$REPO_ROOT"
    for dir in packages/core packages/sdk packages/dev packages/cli packages/core/npm/*/; do
      cp LICENSE "$dir/"
    done
  )
  echo "copied LICENSE to all package directories"

  # Temporarily wire optionalDependencies in packages/core/package.json (mirroring napi prepublish)
  # and place placeholder .node files in any non-host platform directories for packing
  CORE_BAK="$WORK/core-package.json.bak"
  cp "$REPO_ROOT/packages/core/package.json" "$CORE_BAK"

  CREATED_ADDONS=()
  cleanup_placeholders() {
    cp "$CORE_BAK" "$REPO_ROOT/packages/core/package.json"
    for f in "${CREATED_ADDONS[@]}"; do
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
      CREATED_ADDONS+=("$target_file")
      echo "temporary placeholder: packages/core/npm/$1/$2"
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

  (
    cd "$REPO_ROOT"
    pnpm --filter @zcash-app/core pack --pack-destination /tmp/release-packs
    pnpm --filter @zcash-app/sdk pack --pack-destination /tmp/release-packs
    pnpm --filter zcash-dev pack --pack-destination /tmp/release-packs
    pnpm --filter create-zcash-app pack --pack-destination /tmp/release-packs
    for dir in packages/core/npm/*/; do
      (cd "$dir" && pnpm pack --pack-destination /tmp/release-packs)
    done
  )

  # Restore packages/core/package.json and delete temporary placeholders immediately
  cleanup_placeholders
  trap - EXIT

  echo
  echo "packed tarballs in /tmp/release-packs:"
  ls -1 /tmp/release-packs/*.tgz | while read -r f; do basename "$f"; done
  echo "total tarballs: $(ls -1 /tmp/release-packs/*.tgz | wc -l | tr -d ' ')"
  echo

  echo "--- step 3: extract pack-check script from release.yml unchanged ---"
  CHECK_SCRIPT="$WORK/extracted-pack-check.js"
  node - "$REPO_ROOT/.github/workflows/release.yml" "$CHECK_SCRIPT" <<'NODE'
  const fs = require('fs');
  const yaml = require('js-yaml');
  const [wfPath, outPath] = process.argv.slice(2);
  const doc = yaml.load(fs.readFileSync(wfPath, 'utf8'));
  const step = doc.jobs.publish.steps.find((s) => s.name === 'Pack every package and check the tarballs');
  if (!step || !step.run) throw new Error('Could not find "Pack every package and check the tarballs" step in release.yml');
  const match = /node\s+.*?<<'\s*([A-Za-z0-9_]+)\s*'\n([\s\S]*?)\n\s*\1/.exec(step.run);
  if (!match) throw new Error('Could not extract heredoc script from pack-check step');
  fs.writeFileSync(outPath, match[2]);
  console.log(`Extracted script to ${outPath} (${match[2].length} bytes)`);
NODE
  echo

  echo "--- step 4: run extracted script against baseline (must exit 0) ---"
  set +e
  (
    cd "$SANDBOX"
    node "$CHECK_SCRIPT"
  )
  baseline_rc=$?
  set -e
  echo "-> baseline exit code: $baseline_rc"
  if [ "$baseline_rc" -ne 0 ]; then
    echo "ERROR: baseline check failed!" >&2
    exit 1
  fi
  echo "PASS: baseline pack-check succeeded with exit 0"
  echo

  echo "--- step 5: control test A - tarball missing LICENSE (must exit 1) ---"
  BACKUP_PACKS="$WORK/backup-packs"
  rm -rf "$BACKUP_PACKS"
  cp -r /tmp/release-packs "$BACKUP_PACKS"

  CORRUPT_DIR="$WORK/corrupt-missing-license"
  rm -rf "$CORRUPT_DIR"
  mkdir -p "$CORRUPT_DIR"
  CLI_TGZ="$(ls -1 /tmp/release-packs/create-zcash-app-*.tgz | head -1)"
  tar -xzf "$CLI_TGZ" -C "$CORRUPT_DIR"
  rm -f "$CORRUPT_DIR/package/LICENSE"
  tar -czf "$CLI_TGZ" -C "$CORRUPT_DIR" package

  set +e
  (
    cd "$SANDBOX"
    node "$CHECK_SCRIPT"
  )
  ctrl_a_rc=$?
  set -e
  echo "-> missing LICENSE exit code: $ctrl_a_rc"
  if [ "$ctrl_a_rc" -eq 0 ]; then
    echo "ERROR: check unexpectedly passed when LICENSE was missing!" >&2
    exit 1
  fi
  echo "PASS: missing LICENSE correctly triggered exit 1"
  echo

  # Restore clean tarballs
  rm -rf /tmp/release-packs
  cp -r "$BACKUP_PACKS" /tmp/release-packs

  echo "--- step 6: control test B - wrong repository.url (must exit 1) ---"
  CORRUPT_DIR="$WORK/corrupt-wrong-repo"
  rm -rf "$CORRUPT_DIR"
  mkdir -p "$CORRUPT_DIR"
  tar -xzf "$CLI_TGZ" -C "$CORRUPT_DIR"
  node -e "
    const fs = require('fs');
    const p = '$CORRUPT_DIR/package/package.json';
    const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
    pkg.repository.url = 'git+https://github.com/evil-org/create-zcash-app.git';
    fs.writeFileSync(p, JSON.stringify(pkg, null, 2));
  "
  tar -czf "$CLI_TGZ" -C "$CORRUPT_DIR" package

  set +e
  (
    cd "$SANDBOX"
    node "$CHECK_SCRIPT"
  )
  ctrl_b_rc=$?
  set -e
  echo "-> wrong repository.url exit code: $ctrl_b_rc"
  if [ "$ctrl_b_rc" -eq 0 ]; then
    echo "ERROR: check unexpectedly passed with wrong repository.url!" >&2
    exit 1
  fi
  echo "PASS: wrong repository.url correctly triggered exit 1"
  echo

  # Restore clean tarballs
  rm -rf /tmp/release-packs
  cp -r "$BACKUP_PACKS" /tmp/release-packs

  echo "--- step 7: control test C - wrong license (must exit 1) ---"
  CORRUPT_DIR="$WORK/corrupt-wrong-license"
  rm -rf "$CORRUPT_DIR"
  mkdir -p "$CORRUPT_DIR"
  tar -xzf "$CLI_TGZ" -C "$CORRUPT_DIR"
  node -e "
    const fs = require('fs');
    const p = '$CORRUPT_DIR/package/package.json';
    const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
    pkg.license = 'GPL-3.0';
    fs.writeFileSync(p, JSON.stringify(pkg, null, 2));
  "
  tar -czf "$CLI_TGZ" -C "$CORRUPT_DIR" package

  set +e
  (
    cd "$SANDBOX"
    node "$CHECK_SCRIPT"
  )
  ctrl_c_rc=$?
  set -e
  echo "-> wrong license exit code: $ctrl_c_rc"
  if [ "$ctrl_c_rc" -eq 0 ]; then
    echo "ERROR: check unexpectedly passed with wrong license!" >&2
    exit 1
  fi
  echo "PASS: wrong license correctly triggered exit 1"
  echo

  # Restore clean tarballs
  rm -rf /tmp/release-packs
  cp -r "$BACKUP_PACKS" /tmp/release-packs

  echo "--- step 8: control test D - only 8 tarballs (must exit 1) ---"
  rm -f "$CLI_TGZ"
  echo "current tarball count: $(ls -1 /tmp/release-packs/*.tgz | wc -l | tr -d ' ')"

  set +e
  (
    cd "$SANDBOX"
    node "$CHECK_SCRIPT"
  )
  ctrl_d_rc=$?
  set -e
  echo "-> only 8 tarballs exit code: $ctrl_d_rc"
  if [ "$ctrl_d_rc" -eq 0 ]; then
    echo "ERROR: check unexpectedly passed with only 8 tarballs!" >&2
    exit 1
  fi
  echo "PASS: only 8 tarballs correctly triggered exit 1"
  echo

  echo "RESULT: all pack-check controls verified (baseline=0, missing_license=1, wrong_repo=1, wrong_license=1, count_8=1)"
} 2>&1 | tee "$LOG"

# Clean up /tmp/release-packs and temp work directory
rm -rf /tmp/release-packs "$WORK"

echo
echo "log:        $LOG"
echo "log sha256: $(sha256 "$LOG" | cut -d' ' -f1)"
