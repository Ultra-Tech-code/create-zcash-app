# Release Guide

This document describes the release procedure for `create-zcash-app`, `@zcash-app/sdk`, `zcash-dev`, and `@zcash-app/core`.

## Prerequisites

- Trusted publishing permissions configured on npm for the `Ultra-Tech-code/create-zcash-app` repository.
- Write access to the GitHub repository to create tags and trigger release workflows.
- npm CLI access to manage dist-tags if promoting from `next` to `latest`.

---

## Release Procedure (0.1.0-alpha.2)

### 1. Merge Release Preparation PR to `main`
Ensure the release preparation branch (`release/v0.1.0-alpha.2`) has been merged into `main` after all continuous integration checks pass.

### 2. Tag the Merged Commit
Fetch latest `main`, create an annotated git tag matching the package version, and push the tag to `origin`:
```bash
git checkout main
git pull origin main
git tag -a v0.1.0-alpha.2 -m "create-zcash-app 0.1.0-alpha.2"
git push origin v0.1.0-alpha.2
```

### 3. Dry-Run Workflow Dispatch
1. In GitHub, go to **Actions** → **Release (npm)** (`release.yml`).
2. Click **Run workflow**.
3. Select branch: `main`.
4. Ensure **`dry_run`** is set to `true`.
5. Click **Run workflow** and confirm that all matrix builds complete, tarballs pass all sanity checks, and each `npm publish --dry-run` step exits cleanly without errors.

### 4. Live Publish Workflow Dispatch
1. In GitHub, return to **Actions** → **Release (npm)**.
2. Click **Run workflow**.
3. Select branch: `main`.
4. Uncheck **`dry_run`** (`false`).
5. Click **Run workflow**.
6. The workflow will build all 5 target native addons, package the tarballs, and publish the 5 platform packages, followed by `@zcash-app/core`, `@zcash-app/sdk`, `zcash-dev`, and `create-zcash-app` using the `next` dist-tag (`NPM_TAG: next`).

### 5. Registry Verification
Confirm that all 4 packages are visible on npm under the `next` tag:
```bash
npm view create-zcash-app@next version
npm view @zcash-app/sdk@next version
npm view zcash-dev@next version
npm view @zcash-app/core@next version
```

### 6. Promote `latest` Dist-Tag
The GitHub release workflow publishes with `--tag next` to keep prerelease builds isolated. However, `latest` currently points at `0.1.0-alpha.1` on npm. To ensure that users running the documented standard quickstart commands (such as plain `npx create-zcash-app`) receive the new release, the repository owner must promote the four user-facing packages to `latest`:
```bash
npm dist-tag add create-zcash-app@0.1.0-alpha.2 latest
npm dist-tag add @zcash-app/sdk@0.1.0-alpha.2 latest
npm dist-tag add zcash-dev@0.1.0-alpha.2 latest
npm dist-tag add @zcash-app/core@0.1.0-alpha.2 latest
```

> [!NOTE]
> Do not update the dist-tags on the per-platform packages (`@zcash-app/core-*`). They are resolved automatically by `@zcash-app/core` through direct optional dependency version requirements.

### 7. Confirm Dist-Tags
Verify that both `latest` and `next` now point to `0.1.0-alpha.2`:
```bash
npm dist-tag ls create-zcash-app
npm dist-tag ls @zcash-app/sdk
npm dist-tag ls zcash-dev
npm dist-tag ls @zcash-app/core
```
