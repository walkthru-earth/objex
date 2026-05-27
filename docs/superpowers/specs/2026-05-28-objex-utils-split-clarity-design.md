# objex-utils vs objex utils, split clarity and cleanup

Date 2026-05-28
Status Design, awaiting review
Branch feat/utils-to-objex-utils

## Problem

After pure-TypeScript utilities were relocated from the SvelteKit app's `src/lib/utils/` into the isolated package `@walkthru-earth/objex-utils`, it became hard to tell at a glance which utilities live where and why. A four-agent re-audit confirmed the underlying code split is clean (no duplicate files, no name collisions, no orphaned dead code, no broken imports in source), but three things still cause confusion.

1. A few filenames name a dependency property or a framework lineage instead of the job the file does, so a reader cannot infer purpose from the name.
2. There is no single authoritative map that states the rule for which package a utility belongs to and lists both sides side by side.
3. Several docs still describe the pre-move layout, sending readers to paths that no longer exist.

## Goal

After this change, a developer can answer "where does this utility live and why" from the name plus one short map, every filename states its job, and no doc points at a stale path. No behavior changes. Both packages still build and pass the bundle guardrail.

## Current state (verified)

- `packages/objex-utils/src/` holds 33 pure-TS utility modules plus `index.ts`. Zero Svelte, zero heavy deps. Re-exports host-side types from `src/lib/` (Connection, StorageAdapter, QueryEngine, constants, file-icons). A post-build guardrail (`scripts/verify-objex-utils-bundle.mjs`) blocks 47 heavy-dep patterns from the bundle.
- `src/lib/utils/` holds 17 modules, each legitimately heavy-dep (cog, zarr, pmtiles, deck, shiki, marked, pdf, babylon, zip) or framework-bound (`$app/navigation`, Svelte stores).
- The package boundary already differentiates the two layers at every import site. Pure utilities import as `@walkthru-earth/objex-utils`, heavy ones as a relative `../utils/x.js`.

## Design

### Part A, naming pass (full audit, targeted renames)

All 50 modules were evaluated against one rule. A filename must state the job, and the package boundary states the layer. Forty-seven names already meet this rule and stay unchanged. Three name a property or a lineage rather than a job and are renamed. Exported symbol names stay identical except for the one class noted below, so consumer churn is limited to import paths.

| Old path | New path | Why | Churn |
|----------|----------|-----|-------|
| `src/lib/utils/url.ts` | `src/lib/utils/signed-url.ts` | "url" is the vaguest name in the repo and overlaps three pure modules (cloud-url, storage-url) plus url-state. Its job is building and presigning URLs from connection and credential state. | 20 import sites, plus the `src/lib/utils/CLAUDE.md` table and `viewers/CLAUDE.md` "Key deps used" cells |
| `packages/objex-utils/src/cog-pure.ts` | `packages/objex-utils/src/cog-info.ts` | "-pure" names a dependency property, not a job. The module's job is describing a COG without rendering it, and its primary export is `CogInfo`. | `index.ts:94` export line, comments at `index.ts:86` and `cog.ts:109,676`, both CLAUDE.md files, `docs/README.md` cog page. Exported symbols unchanged, `cog.ts` re-exports them by name through the package so no symbol churn. |
| `src/lib/utils/evidence-context.ts` | `packages/objex-utils/src/markdown-sql-context.ts` | This is the file move from Part B. It also drops the "Evidence" jargon and pairs the executor with its parser, `markdown-sql.ts`. Class `EvidenceContext` becomes `MarkdownSqlContext`. | See Part B |

Names evaluated and kept, grouped by why they are already clear.

- Already job-descriptive and domain-prefixed, kept as is. `cloud-url`, `storage-url`, `storage-smoketest`, `url-state`, `markdown-sql`, `markdown`, `cog`, `cog-histogram`, `cog-asset`, `colormap-sprite`, `channel-composite`, `parquet-metadata`, `geometry-type`, `connection-identity`, `host-detection`, `map-pixel-inspect`, `map-selection`, `column-types`, `file-sort`, all `stac-*`.
- Generic but conventional and unambiguous, kept as is. `format`, `error`, `export`, `hex`, `lru`, `notebook`, `clipboard`, `local-storage`, `deck`, `archive`, `pdf`, `model3d`, `shiki`, `pmtiles`, `pmtiles-tile`, `zarr`, `zarr-tab`, `geoarrow`, `wkb`.

### Part B, move evidence-context into objex-utils

`evidence-context.ts` is used only by `MarkdownViewer.svelte`, which currently imports it through a `$lib/utils/evidence-context` path. That `$lib/` import inside `src/lib/` violates the npm publishing rules. The class logic (relative-path rewriting for `read_parquet`/`read_csv`/`read_json`, plus a results cache) is framework-agnostic. The only non-pure dependency is `getQueryEngine()` from the app's DuckDB query layer.

Move the logic into the package and inject the engine.

- New file `packages/objex-utils/src/markdown-sql-context.ts` exports `class MarkdownSqlContext`.
- Constructor signature `(engine: QueryEngine, connId: string, prefix = '')`. The class calls `this.engine.query(connId, transformedSql)` instead of awaiting `getQueryEngine()` internally.
- `QueryEngine` and `QueryResult` are imported type-only from `../../../src/lib/query/engine.js`, matching the host-side type-import convention the package already uses. No runtime heavy dep enters the package.
- `index.ts` adds `export * from './markdown-sql-context.js'`.
- `MarkdownViewer.svelte` imports `MarkdownSqlContext` from `@walkthru-earth/objex-utils`, imports `getQueryEngine` from the relative `../../query/index.js` path, and constructs `new MarkdownSqlContext(await getQueryEngine(), tab.connectionId ?? '', dirPrefix)`. This also removes the `$lib/` violation.
- Delete `src/lib/utils/evidence-context.ts`.

### Part C, authoritative split map

Add one short "Two-layer utility map" section to the root `CLAUDE.md`, the entry point readers hit first. It states the placement rule as a decision a reader can apply, and links to the two CLAUDE.md files that already hold the full per-side inventories. It does not duplicate the file lists, so there is one canonical list per side and the map stays DRY.

The decision rule, in plain form. A new utility goes in `@walkthru-earth/objex-utils` when it is pure TypeScript with no heavy graphics or browser library and no SvelteKit or Svelte-store dependency, even via `await import()`. Otherwise it stays in `src/lib/utils/`. The canonical moved-list lives in `src/lib/utils/CLAUDE.md`, the canonical package inventory lives in `packages/objex-utils/CLAUDE.md`.

### Part D, fix stale references

| File | Issue | Fix |
|------|-------|-----|
| `README.md` lines 61-63 | Invalid import paths like `@walkthru-earth/objex/utils/wkb` | Change to `@walkthru-earth/objex-utils` |
| `.changeset/utils-to-objex-utils.md` line 6 | Claims old files "become thin shims that re-export" | Reword to state the utilities moved and old `src/lib/utils/` paths no longer exist |
| `docs/wkb-to-geoarrow-pipeline.md` line 14 | Cites `src/lib/utils/geoarrow.ts` | Cite `packages/objex-utils/src/geoarrow.ts` |
| `docs/multicog-sentinel2-design.md` lines 2, 10, 28 | Cite `src/lib/utils/stac.ts` | Cite `packages/objex-utils/src/stac.ts` |
| `src/lib/query/stac-source-parquet.ts` comment | Refers to `utils/stac-geoparquet.js` and `utils/wkb.js` | Update comment to the package import path |

Also update any reference touched by the Part A renames (`url.ts` to `signed-url.ts`, `cog-pure.ts` to `cog-info.ts`) across CLAUDE.md files and docs so the renames do not introduce new stale paths.

### Part E, delete stale planning docs

- Delete `docs/superpowers/plans/2026-04-27-unified-rgb-channel-picker-plan.md`. It describes creating `cog-asset.ts` and `channel-composite.ts` in `src/lib/utils/`, but they shipped in the package. The feature is complete.
- For the two design specs in `docs/superpowers/specs/` (`2026-04-26-stac-source-contract-design.md`, `2026-04-27-unified-rgb-channel-picker-design.md`), update their stale path references rather than delete, since they are decision records. Confirm at review whether to keep-and-fix or delete.

### Part F, verify production grade

Run the full pre-publish chain and confirm each step.

- `pnpm -w run format && pnpm -w run lint:fix && pnpm -w run check`
- `pnpm -w run package` (svelte-package plus publint)
- `pnpm --filter @walkthru-earth/objex-utils run build` (tsup plus the bundle guardrail)
- `grep -r '\$lib/' dist/ --include='*.js'` must find nothing
- `pnpm pack --pack-destination /tmp` and inspect the tarball
- Add a changeset so both packages bump together via the fixed config

## Out of scope

- No mass rename of the 47 already-clear modules.
- No new utility extraction beyond the evidence-context move.
- No behavior changes to any viewer or utility.

## Risks

- The `url.ts` to `signed-url.ts` rename touches 20 import sites. Mechanical, caught by `pnpm -w run check` if any are missed.
- The evidence-context move changes a constructor signature. Only one call site, updated in the same change.
- The cog-pure rename touches the package index and a guardrail-adjacent comment. The `*-pure.ts` convention text in `packages/objex-utils/CLAUDE.md` is reworded to describe the pattern generically (split the dependency-free surface into a sibling module with zero heavy imports) so the convention survives the loss of the `-pure` filename signal.

## Success criteria

- Every utility filename states its job.
- Root CLAUDE.md carries the placement rule plus links to both inventories.
- No doc or code comment points at a moved path.
- Both packages build, the guardrail passes, `dist/` has no `$lib/`, and the tarball is clean.
