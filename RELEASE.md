# Release Checklist

## Prerequisites

- [ ] npm org `@walkthru-earth` exists and you have publish access
- [ ] npm trusted publishing configured for both packages (see below)

### First-Time Bootstrap (before trusted publishing)

Trusted publishing can only be configured on packages that already exist on npm.
If the packages haven't been published yet, do the initial publish manually:

```bash
# Build both packages
pnpm run package
pnpm --filter @walkthru-earth/objex-utils run build

# Login to npm (browser-based auth)
npm login --scope=@walkthru-earth

# Publish both for the first time
pnpm publish --access public --no-git-checks
cd packages/objex-utils && pnpm publish --access public --no-git-checks && cd ../..
```

### npm Trusted Publishing Setup (one-time, after first publish)

No classic `NPM_TOKEN` secret needed. Both packages use OIDC-based trusted publishing.

For each package (`@walkthru-earth/objex` and `@walkthru-earth/objex-utils`):

1. Go to **npmjs.com → Packages** → click the package → **Settings** tab
   (direct link: `https://www.npmjs.com/package/<package-name>/access`)
2. Under **Trusted Publishers**, click **Add trusted publisher**
3. Configure:
   - **Provider**: GitHub Actions
   - **Repository owner**: `walkthru-earth`
   - **Repository name**: `objex`
   - **Workflow filename**: `release.yml`
   - **Environment**: _(leave blank)_
4. Save

This allows the `release.yml` workflow to publish via OIDC token exchange — no secrets to rotate.

## Automated Release Flow (Changesets)

### 1. Add a changeset to your PR

```bash
pnpm changeset
```

Interactive prompt asks:
- Which packages changed? (both bump together via `fixed` config)
- Patch / Minor / Major?
- Summary of changes

This creates a `.changeset/<random-name>.md` file. Commit it with your PR.

### 2. Merge PR to main

The `release.yml` workflow runs automatically and creates/updates a **"chore: version packages"** PR that:
- Bumps versions in both `package.json` files
- Generates/updates `CHANGELOG.md` for each package
- Accumulates multiple changesets if several PRs merge

### 3. Merge the "Version Packages" PR

This triggers the workflow again, which:
- Builds both packages
- Publishes to npm with provenance attestation
- Creates a GitHub Release with auto-generated notes

## Pre-Release Checks

```bash
# Ensure clean working tree
git status  # must be clean

# Run all checks
pnpm -w run format
pnpm -w run lint
pnpm -w run check

# Build both packages
pnpm -w run package                                     # @walkthru-earth/objex
pnpm --filter @walkthru-earth/objex-utils run build     # @walkthru-earth/objex-utils

# Smoke test utils
node -e "import('./packages/objex-utils/dist/index.js').then(m => console.log(Object.keys(m).join(', ')))"
```

## Dry-Run Publish

```bash
# Main package
pnpm publish --dry-run --no-git-checks

# Utils sub-package
cd packages/objex-utils && pnpm publish --dry-run --no-git-checks && cd ../..
```

Verify:
- [ ] No `.wasm`, `.env`, or credential files in tarball
- [ ] `dist/` files present (`.js`, `.d.ts`, `.svelte`)
- [ ] Package size is reasonable (~230 KB packed for main, ~110 KB for utils)

## Post-Publish Verification

```bash
# Check packages exist on npm
npm view @walkthru-earth/objex version
npm view @walkthru-earth/objex-utils version

# Test install in a fresh directory
cd /tmp && mkdir test-objex && cd test-objex && npm init -y
npm install @walkthru-earth/objex-utils
node -e "const m = require('@walkthru-earth/objex-utils'); console.log(Object.keys(m).join(', '))"
```

- [ ] Versions match on npmjs.com
- [ ] README renders correctly on npm package page
- [ ] Exports work in a fresh install
- [ ] Provenance badge visible on npm package page

## If Something Goes Wrong

**CI publish failed:**
- Check Actions tab for error logs
- Fix the issue, push to main
- The next merge will re-trigger the workflow

**Bad version published:**
- Deprecate (soft): `npm deprecate @walkthru-earth/objex@X.Y.Z "broken release, use X.Y.Z+1"`
- Unpublish (within 72h only): `npm unpublish @walkthru-earth/objex@X.Y.Z`
- Add a new changeset with a patch fix and merge immediately

**Version mismatch between packages:**
- The `fixed` config in `.changeset/config.json` prevents this — both packages always bump together
