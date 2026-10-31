#!/usr/bin/env bash
# Proves the step order of the "publish" job in .github/workflows/release.yml.
#
# Why the order matters: `napi prepublish` rewrites packages/core/package.json to add the five
# platform packages as optionalDependencies, which leaves pnpm-lock.yaml stale. Every later
# `pnpm run` / `pnpm exec` runs pnpm's dependency check first (runDepsStatusCheck), which installs
# with --frozen-lockfile in CI and fails with:
#
#   ERR_PNPM_OUTDATED_LOCKFILE: Cannot install with "frozen-lockfile" because pnpm-lock.yaml is not
#   up to date with <ROOT>/packages/core/package.json
#   * 5 dependencies were added: @zcash-app/core-darwin-arm64@0.1.0-alpha.0, ...
#
# So the TypeScript builds run before prepublish, and everything after prepublish is `node`,
# `pnpm pack` or `pnpm publish`. This script runs that sequence against a throwaway copy of the
# repo and also runs the old position once as a control, which must fail with the error above.
#
# Usage: bash scripts/prove-release-step-order.sh [workdir]
#
# Requires a host-built addon at packages/core/*.node (pnpm --filter @zcash-app/core run build).
# The four non-host addons are 1 KiB placeholders: `napi artifacts` refuses to run unless every
# configured target has one, and the only question here is step order, not binary contents.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${1:-$(mktemp -d /tmp/cza-release-step-order.XXXXXX)}"
PACKS="$WORK-packs"

fail=0
step() { echo; echo "===== $* ====="; }
must() {
  local label="$1"; shift
  step "$label"
  echo "\$ $*"
  "$@"
  local rc=$?
  echo "-> exit=$rc"
  [ "$rc" -ne 0 ] && fail=1
  return 0
}

echo "repo:      $REPO_ROOT"
echo "head:      $(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo '(no git)')"
echo "node:      $(node -v)"
echo "pnpm:      $(pnpm -v)"
echo "work copy: $WORK"

HOST_ADDON="$(ls "$REPO_ROOT"/packages/core/*.node 2>/dev/null | head -1)"
if [ -z "$HOST_ADDON" ]; then
  echo "ERROR: no host addon found at packages/core/*.node — build it first:" >&2
  echo "       pnpm --filter @zcash-app/core run build" >&2
  exit 2
fi
echo "host addon: $(basename "$HOST_ADDON")"

step "copy the repo into the throwaway work dir (no target/, no .git/)"
rm -rf "$WORK" "$PACKS"
mkdir -p "$WORK"
rsync -a --exclude 'target/' --exclude '.git/' "$REPO_ROOT/" "$WORK/"
echo "-> exit=$?"

cd "$WORK" || exit 1
rm -rf packages/core/npm packages/core/artifacts
node -e 'const p=require(process.cwd()+"/packages/core/package.json");console.log("packages/core/package.json optionalDependencies:", JSON.stringify(p.optionalDependencies||null))'

must "pnpm install          # workflow step: Install dependencies" \
  env CI=true pnpm install

# ------------------------------------------------------------------- new position of the builds
must "pnpm --filter @zcash-app/sdk build            # workflow step: Build the TypeScript packages" \
  env CI=true pnpm --filter @zcash-app/sdk build
must "pnpm --filter zcash-dev build                 # workflow step: Build the TypeScript packages" \
  env CI=true pnpm --filter zcash-dev build
must "pnpm --filter create-zcash-app build          # workflow step: Build the TypeScript packages" \
  env CI=true pnpm --filter create-zcash-app build

step "seed the artifact layout the workflow gets from actions/download-artifact"
case "$(basename "$HOST_ADDON")" in
  *darwin-arm64*) host_target=aarch64-apple-darwin;      host_npm_dir=darwin-arm64 ;;
  *darwin-x64*)   host_target=x86_64-apple-darwin;       host_npm_dir=darwin-x64 ;;
  *linux-x64*)    host_target=x86_64-unknown-linux-gnu;  host_npm_dir=linux-x64-gnu ;;
  *linux-arm64*)  host_target=aarch64-unknown-linux-gnu; host_npm_dir=linux-arm64-gnu ;;
  *win32-x64*)    host_target=x86_64-pc-windows-msvc;    host_npm_dir=win32-x64-msvc ;;
  *)              host_target=unknown ;;
esac
if [ "$host_target" = unknown ]; then
  echo "ERROR: cannot map $(basename "$HOST_ADDON") to a napi target" >&2
  exit 2
fi
mkdir -p "packages/core/artifacts/bindings-$host_target"
cp "$HOST_ADDON" "packages/core/artifacts/bindings-$host_target/"
ls -la "packages/core/artifacts/bindings-$host_target/"
for spec in \
  'aarch64-apple-darwin zcash-core.darwin-arm64.node' \
  'x86_64-apple-darwin zcash-core.darwin-x64.node' \
  'x86_64-unknown-linux-gnu zcash-core.linux-x64-gnu.node' \
  'aarch64-unknown-linux-gnu zcash-core.linux-arm64-gnu.node' \
  'x86_64-pc-windows-msvc zcash-core.win32-x64-msvc.node'; do
  set -- $spec
  [ -f "packages/core/artifacts/bindings-$1/$2" ] && continue
  mkdir -p "packages/core/artifacts/bindings-$1"
  head -c 1024 /dev/zero > "packages/core/artifacts/bindings-$1/$2"
  echo "placeholder: packages/core/artifacts/bindings-$1/$2"
done

must "pnpm --filter @zcash-app/core exec napi create-npm-dirs" \
  env CI=true pnpm --filter @zcash-app/core exec napi create-npm-dirs
must "pnpm --filter @zcash-app/core exec napi artifacts --output-dir artifacts" \
  env CI=true pnpm --filter @zcash-app/core exec napi artifacts --output-dir artifacts
ls -la packages/core/npm/*/*.node 2>/dev/null

must "pnpm --filter @zcash-app/core exec napi prepublish --tag-style npm --skip-optional-publish --no-gh-release" \
  env CI=true pnpm --filter @zcash-app/core exec napi prepublish --tag-style npm --skip-optional-publish --no-gh-release

step "manifest after prepublish (the state that broke the old order)"
node -e 'const p=require(process.cwd()+"/packages/core/package.json");console.log("optionalDependencies:", JSON.stringify(p.optionalDependencies,null,2))'
echo "occurrences of core-darwin-arm64 in pnpm-lock.yaml: $(grep -c 'core-darwin-arm64' pnpm-lock.yaml || true)"

step "verify prepublish wired the platform packages (the workflow's own node check, unchanged)"
manifest=packages/core/package.json
node - "$manifest" <<'NODE'
const fs = require('fs');
const manifestPath = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const targets = (manifest.napi && manifest.napi.targets) || [];
const optional = Object.keys(manifest.optionalDependencies || {});
const missing = targets.filter((target) => {
  const suffix = target
    .replace('aarch64-apple-darwin', 'darwin-arm64')
    .replace('x86_64-apple-darwin', 'darwin-x64')
    .replace('x86_64-unknown-linux-gnu', 'linux-x64-gnu')
    .replace('aarch64-unknown-linux-gnu', 'linux-arm64-gnu')
    .replace('x86_64-pc-windows-msvc', 'win32-x64-msvc');
  return !optional.includes(`${manifest.name}-${suffix}`);
});
console.log(`napi targets: ${targets.length}, optionalDependencies: ${optional.length}`);
optional.forEach((name) => console.log(`  ${name}`));
if (targets.length === 0 || missing.length > 0) {
  console.error(`MISSING platform packages: ${missing.join(', ') || '(no targets)'}`);
  process.exit(1);
}
NODE
rc=$?
echo "-> exit=$rc"
[ "$rc" -ne 0 ] && fail=1

step "control: the OLD order put a pnpm run step here, and it fails"
echo "\$ CI=true pnpm --filter @zcash-app/sdk build   # where this step used to sit"
env CI=true pnpm --filter @zcash-app/sdk build > "$WORK.oldorder.log" 2>&1
OLD_RC=$?
grep -E 'Scope: all|ERR_PNPM_OUTDATED_LOCKFILE|dependencies were added|runDepsStatusCheck' \
  "$WORK.oldorder.log" | head -5
echo "-> exit=$OLD_RC (expected 1: ERR_PNPM_OUTDATED_LOCKFILE from runDepsStatusCheck)"
if [ "$OLD_RC" -eq 0 ]; then
  echo "UNEXPECTED: the old order passed; the control did not reproduce the CI failure"
  fail=1
fi

step "everything after prepublish is node / pnpm pack / pnpm publish only"
must "pnpm --filter @zcash-app/core pack"  env CI=true pnpm --filter @zcash-app/core pack --pack-destination "$PACKS"
must "pnpm --filter @zcash-app/sdk pack"   env CI=true pnpm --filter @zcash-app/sdk pack --pack-destination "$PACKS"
must "pnpm --filter zcash-dev pack"        env CI=true pnpm --filter zcash-dev pack --pack-destination "$PACKS"
must "pnpm --filter create-zcash-app pack" env CI=true pnpm --filter create-zcash-app pack --pack-destination "$PACKS"
ls -la "$PACKS"

must "pnpm publish packages/core/npm/<host> --dry-run --ignore-scripts --no-git-checks" \
  env CI=true pnpm publish "packages/core/npm/$host_npm_dir" --dry-run --ignore-scripts --no-git-checks --access public --tag next
must "pnpm publish packages/core --dry-run --ignore-scripts --no-git-checks" \
  env CI=true pnpm publish packages/core --dry-run --ignore-scripts --no-git-checks --access public --tag next
must "pnpm publish packages/sdk --dry-run --ignore-scripts --no-git-checks" \
  env CI=true pnpm publish packages/sdk --dry-run --ignore-scripts --no-git-checks --access public --tag next
must "pnpm publish packages/dev --dry-run --ignore-scripts --no-git-checks" \
  env CI=true pnpm publish packages/dev --dry-run --ignore-scripts --no-git-checks --access public --tag next
must "pnpm publish packages/cli --dry-run --ignore-scripts --no-git-checks" \
  env CI=true pnpm publish packages/cli --dry-run --ignore-scripts --no-git-checks --access public --tag next

step "packed manifests: no workspace: ranges survive"
for t in "$PACKS"/*.tgz; do
  echo "--- $(basename "$t")"
  tar -xzOf "$t" package/package.json | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      const p=JSON.parse(s);
      const deps={...(p.dependencies||{}),...(p.optionalDependencies||{})};
      const ws=Object.entries(deps).filter(([,r])=>String(r).includes("workspace:"));
      console.log(p.name+"@"+p.version, "deps:", JSON.stringify(deps));
      console.log(ws.length? "WORKSPACE RANGE: "+JSON.stringify(ws) : "no workspace: ranges");
      if (ws.length) process.exit(1);
    });' || fail=1
done

rm -rf "$WORK" "$PACKS"

step "result"
if [ "$fail" -ne 0 ]; then
  echo "FAILED: the reordered sequence did not complete cleanly"
  exit 1
fi
echo "the reordered sequence completed with packages/core/package.json already rewritten by prepublish:"
echo "builds before prepublish, and only node / pnpm pack / pnpm publish after it"
