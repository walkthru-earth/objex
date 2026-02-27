# Release Checklist

## Prerequisites

- [ ] `NPM_TOKEN` secret added to GitHub repo settings (Settings → Secrets → Actions)
- [ ] npm org `@walkthru-earth` exists and you have publish access

## Pre-Release

```bash
# 1. Ensure clean working tree
git status  # must be clean

# 2. Run all checks
pnpm -w run format
pnpm -w run lint
pnpm -w run check

# 3. Build both packages
pnpm -w run package                                     # @walkthru-earth/objex
pnpm --filter @walkthru-earth/objex-utils run build     # @walkthru-earth/objex-utils

# 4. Smoke test utils
node -e "import('./packages/objex-utils/dist/index.js').then(m => console.log(Object.keys(m).join(', ')))"

# 5. Verify SvelteKit app still builds
pnpm -w run build
```

## Version Bump

Both packages must have matching versions.

```bash
# Edit version in both:
#   package.json              → "version": "X.Y.Z"
#   packages/objex-utils/package.json → "version": "X.Y.Z"

# Commit the version bump
git add package.json packages/objex-utils/package.json
git commit -m "chore: bump version to X.Y.Z"
git push origin main
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

## Create GitHub Release

1. Go to **Releases → Draft a new release**
2. Tag: `vX.Y.Z` (create new tag on publish)
3. Target: `main`
4. Title: `vX.Y.Z`
5. Description: summarize changes since last release
6. Click **Publish release**

This triggers `.github/workflows/publish.yml` which:
1. Installs dependencies
2. Builds `@walkthru-earth/objex` (`pnpm run package`)
3. Builds `@walkthru-earth/objex-utils` (`tsup`)
4. Publishes both to npm with `--access public`

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

## If Something Goes Wrong

**CI publish failed:**
- Check Actions tab for error logs
- Fix the issue, push to main
- Delete the GitHub Release and tag, then recreate

```bash
git tag -d vX.Y.Z
git push origin :refs/tags/vX.Y.Z
```

**Bad version published:**
- Deprecate (soft): `npm deprecate @walkthru-earth/objex@X.Y.Z "broken release, use X.Y.Z+1"`
- Unpublish (within 72h only): `npm unpublish @walkthru-earth/objex@X.Y.Z`
- Publish a patch fix immediately

**Version mismatch between packages:**
- Always bump both `package.json` files together
- Both packages should share the same version number
