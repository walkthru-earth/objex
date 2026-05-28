# objex-utils Split Clarity and Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make it obvious which utilities live in the pure package `@walkthru-earth/objex-utils` versus the app-side `src/lib/utils/`, by renaming the three names that describe a property instead of a job, moving one mislocated file, adding one authoritative map, and removing every stale doc reference.

**Architecture:** Pure-TS utilities live in `packages/objex-utils/src/` and import as `@walkthru-earth/objex-utils`. Heavy-dep or SvelteKit-bound utilities live in `src/lib/utils/` and import via relative `../utils/<x>.js`. This plan does not change any runtime behavior. The verification gate for each code change is `pnpm -w run check` (svelte-check and tsc) plus the objex-utils build with its bundle guardrail. Renamed exports keep identical symbol names, so consumer churn is limited to import paths.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, TypeScript 5, pnpm 10 workspaces, tsup (objex-utils build), Biome (format and lint), Changesets.

**Spec:** `docs/superpowers/specs/2026-05-28-objex-utils-split-clarity-design.md`

---

## File structure

| File | Responsibility | Task |
|------|----------------|------|
| `packages/objex-utils/src/cog-info.ts` (renamed from `cog-pure.ts`) | Pure COG descriptors (SF_LABELS, GeoBounds, CogInfo, safeClamp, clampBounds, buildDataTypeLabel) | 1 |
| `src/lib/utils/signed-url.ts` (renamed from `url.ts`) | Build and presign URLs from connection and credential state | 2 |
| `packages/objex-utils/src/markdown-sql-context.ts` (moved from `src/lib/utils/evidence-context.ts`) | Execute markdown SQL blocks against an injected query engine, cache by name | 3 |
| `src/lib/components/viewers/MarkdownViewer.svelte` | Consumer of the moved context, rewired to inject the engine | 3 |
| `CLAUDE.md` (root) | Adds the Two-Layer Utility Map | 4 |
| `README.md`, `.changeset/utils-to-objex-utils.md`, `docs/wkb-to-geoarrow-pipeline.md`, `docs/multicog-sentinel2-design.md`, `src/lib/query/stac-source-parquet.ts` | Stale-reference fixes | 5 |
| `docs/superpowers/plans/2026-04-27-...`, `docs/superpowers/specs/2026-04-26-...`, `docs/superpowers/specs/2026-04-27-...` | Deleted (stale) | 6 |
| `.changeset/objex-utils-split-clarity.md` | New changeset for this work | 7 |

---

## Task 1: Rename `cog-pure.ts` to `cog-info.ts`

**Files:**
- Rename: `packages/objex-utils/src/cog-pure.ts` to `packages/objex-utils/src/cog-info.ts`
- Modify: `packages/objex-utils/src/index.ts` (export line + comment)
- Modify: `src/lib/utils/cog.ts` (two narrative comments only, no import change)
- Modify: `packages/objex-utils/docs/cog.md`
- Modify: `packages/objex-utils/CLAUDE.md` (cog bullet + the `*-pure.ts` convention text)
- Modify: `src/lib/utils/CLAUDE.md` (promoted-list entry)

The exported symbols (`SF_LABELS`, `GeoBounds`, `CogInfo`, `safeClamp`, `clampBounds`, `buildDataTypeLabel`) stay identical, and `cog.ts` re-exports them by name from the package (not from the file path), so no symbol or import-site changes are needed beyond the comments below.

- [ ] **Step 1: Rename the file with git**

```bash
cd /Users/yharby/Documents/gh/walkthru-earth/obstore-explore/objex
git mv packages/objex-utils/src/cog-pure.ts packages/objex-utils/src/cog-info.ts
```

- [ ] **Step 2: Update the package index export and its comment**

In `packages/objex-utils/src/index.ts`, change line 85-86 comment and line 94 export.

Old:
```ts
// COG utilities (pure helpers only, no maplibre/geotiff/epsg/proj dependency).
// MUST import from `cog-pure.ts` and NOT `cog.ts`. `cog.ts` has top-level
```
New:
```ts
// COG utilities (pure helpers only, no maplibre/geotiff/epsg/proj dependency).
// MUST import from `cog-info.ts` and NOT `cog.ts`. `cog.ts` has top-level
```

Old:
```ts
export * from './cog-pure.js';
```
New:
```ts
export * from './cog-info.js';
```

- [ ] **Step 3: Update the two narrative comments in `src/lib/utils/cog.ts`**

Old (around line 109):
```ts
// `SF_LABELS` moved to `./cog-pure.ts` (re-exported above) so that
```
New:
```ts
// `SF_LABELS` moved to `cog-info.ts` in @walkthru-earth/objex-utils (re-exported above) so that
```

Old (around line 676):
```ts
// `GeoBounds`, `CogInfo`, `safeClamp`, `clampBounds`, `buildDataTypeLabel`
// live in `./cog-pure.ts` and are re-exported at the top of this file.
```
New:
```ts
// `GeoBounds`, `CogInfo`, `safeClamp`, `clampBounds`, `buildDataTypeLabel`
// live in `cog-info.ts` in @walkthru-earth/objex-utils and are re-exported at the top of this file.
```

- [ ] **Step 4: Update `packages/objex-utils/docs/cog.md`**

Old (line 5):
```
Source: `src/lib/utils/cog-pure.ts` (dependency-free subset). The full `cog.ts` re-exports these same bindings for in-repo consumers.
```
New:
```
Source: `packages/objex-utils/src/cog-info.ts` (dependency-free subset). The app-side `src/lib/utils/cog.ts` re-exports these same bindings for in-repo consumers.
```

- [ ] **Step 5: Update `packages/objex-utils/CLAUDE.md` cog bullet and convention text**

Change the cog bullet header from `cog-pure` to `cog-info`.

Old:
```
- **cog-pure**: `CogInfo` (type), `GeoBounds` (type), `SF_LABELS`, `safeClamp()`, `clampBounds()`, `buildDataTypeLabel()`. Dependency-free subset of `cog.ts`.
```
New:
```
- **cog-info**: `CogInfo` (type), `GeoBounds` (type), `SF_LABELS`, `safeClamp()`, `clampBounds()`, `buildDataTypeLabel()`. Dependency-free subset of the app-side `cog.ts`.
```

Reword the convention sentence so it no longer relies on the `-pure` filename.

Old:
```
If a new re-export needs a heavy dep, split the dependency-free surface into a `*-pure.ts` sibling module (same pattern as `cog-pure.ts`).
```
New:
```
If a new re-export needs a heavy dep, split the dependency-free surface into a sibling module that has zero heavy imports (the pattern `cog-info.ts` uses as the pure subset of the app-side `cog.ts`).
```

- [ ] **Step 6: Update the promoted-list entry in `src/lib/utils/CLAUDE.md`**

In the backtick list under "Promoted to `@walkthru-earth/objex-utils`", change `cog-pure` to `cog-info`.

- [ ] **Step 7: Build objex-utils and run the type check**

```bash
pnpm --filter @walkthru-earth/objex-utils run build
pnpm -w run check
```
Expected: objex-utils build succeeds and the bundle guardrail passes. `pnpm -w run check` reports no new errors.

- [ ] **Step 8: Commit**

```bash
git add packages/objex-utils/src/cog-info.ts packages/objex-utils/src/index.ts src/lib/utils/cog.ts packages/objex-utils/docs/cog.md packages/objex-utils/CLAUDE.md src/lib/utils/CLAUDE.md
git commit -m "refactor(objex-utils): rename cog-pure to cog-info"
```

---

## Task 2: Rename `url.ts` to `signed-url.ts`

**Files:**
- Rename: `src/lib/utils/url.ts` to `src/lib/utils/signed-url.ts`
- Modify: every file importing `../utils/url.js` or `../../utils/url.js` (20 source files)
- Modify: `src/lib/utils/CLAUDE.md` (the `url.ts` table row)
- Modify: `src/lib/components/viewers/CLAUDE.md` (the `utils/url` doc mentions, not `utils/url-state`)

The string `utils/url.js` is safe to replace because `utils/cloud-url.js`, `utils/storage-url.js`, and `utils/url-state.js` do not contain the contiguous substring `utils/url.js` (the character after `utils/` differs in each).

- [ ] **Step 1: Rename the file with git**

```bash
cd /Users/yharby/Documents/gh/walkthru-earth/obstore-explore/objex
git mv src/lib/utils/url.ts src/lib/utils/signed-url.ts
```

- [ ] **Step 2: Rewrite the import paths in all source files**

```bash
grep -rl "utils/url\.js" src/ --include="*.svelte" --include="*.ts" \
  | xargs sed -i '' 's#utils/url\.js#utils/signed-url.js#g'
```

- [ ] **Step 3: Verify no `utils/url.js` import remains and url-state is untouched**

```bash
grep -rn "utils/url\.js" src/ --include="*.svelte" --include="*.ts" || echo "none remaining (good)"
grep -rn "utils/url-state\.js" src/ --include="*.svelte" --include="*.ts" | head -1
```
Expected: first command prints "none remaining (good)". Second still finds `utils/url-state.js` imports (proves the rename did not corrupt them).

- [ ] **Step 4: Update the table row in `src/lib/utils/CLAUDE.md`**

Change the leading cell of the `url.ts` row.

Old:
```
| `url.ts` | `buildHttpsUrl()`, `buildHttpsUrlAsync()`, `buildDuckDbUrl()`, `buildDuckDbUrlAsync()`, `buildStorageUrl()`, `canStreamDirectly()`.
```
New:
```
| `signed-url.ts` | `buildHttpsUrl()`, `buildHttpsUrlAsync()`, `buildDuckDbUrl()`, `buildDuckDbUrlAsync()`, `buildStorageUrl()`, `canStreamDirectly()`.
```

Also update the mermaid node label `URL[url.ts<br/>Svelte stores + presign.ts]` to `URL[signed-url.ts<br/>Svelte stores + presign.ts]` in the same file.

- [ ] **Step 5: Update the `utils/url` doc mentions in `src/lib/components/viewers/CLAUDE.md`**

Protect `utils/url-state` first, rewrite `utils/url`, then restore.

```bash
sed -i '' \
  -e 's#utils/url-state#§URLSTATE§#g' \
  -e 's#utils/url#utils/signed-url#g' \
  -e 's#§URLSTATE§#utils/url-state#g' \
  src/lib/components/viewers/CLAUDE.md
```

- [ ] **Step 6: Verify the doc rewrite left url-state intact**

```bash
grep -c "utils/url-state" src/lib/components/viewers/CLAUDE.md
grep -c "utils/signed-url" src/lib/components/viewers/CLAUDE.md
grep -c "§URLSTATE§" src/lib/components/viewers/CLAUDE.md
```
Expected: url-state count unchanged from before, signed-url count greater than zero, sentinel count zero.

- [ ] **Step 7: Run the type check**

```bash
pnpm -w run check
```
Expected: no new errors. Any missed import site would surface here as a module-not-found error.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(utils): rename url.ts to signed-url.ts"
```

---

## Task 3: Move `evidence-context.ts` into the package as `markdown-sql-context.ts`

**Files:**
- Create: `packages/objex-utils/src/markdown-sql-context.ts`
- Modify: `packages/objex-utils/src/index.ts` (add export)
- Modify: `src/lib/components/viewers/MarkdownViewer.svelte` (inject engine)
- Delete: `src/lib/utils/evidence-context.ts`
- Modify: `src/lib/utils/CLAUDE.md` (remove the evidence-context table row and mermaid node, add to promoted list)
- Modify: `packages/objex-utils/CLAUDE.md` (add markdown-sql-context bullet)
- Modify: `src/lib/components/viewers/CLAUDE.md` (MarkdownViewer row)

The class becomes pure by taking a `QueryEngine` argument instead of calling `getQueryEngine()` internally. `QueryEngine` and `QueryResult` are imported type-only from the host path the package already uses for shared types.

- [ ] **Step 1: Create the package module**

Create `packages/objex-utils/src/markdown-sql-context.ts`:

```ts
import type { QueryEngine, QueryResult } from '../../../src/lib/query/engine.js';

/**
 * Executes the SQL blocks parsed out of a markdown document (Evidence.dev style)
 * against an injected query engine, and caches the results by block name. Pairs
 * with `markdown-sql.ts` (the parser). Pure TypeScript: the engine is supplied by
 * the host so this module never imports DuckDB or any other heavy dependency.
 */
export class MarkdownSqlContext {
	private engine: QueryEngine;
	private connId: string;
	private prefix: string;
	private results = new Map<string, { result: QueryResult; rows: Record<string, any>[] }>();

	constructor(engine: QueryEngine, connId: string, prefix = '') {
		this.engine = engine;
		this.connId = connId;
		this.prefix = prefix;
	}

	/** Execute a SQL query and store the result under the given name. */
	async executeSql(sql: string, queryName: string): Promise<Record<string, any>[]> {
		const transformedSql = this.transformPaths(sql);
		const result = await this.engine.query(this.connId, transformedSql);
		const rows = result.rows ?? [];
		this.results.set(queryName, { result, rows });
		return rows;
	}

	/**
	 * Transform relative file paths in SQL to full S3 URLs.
	 * e.g. read_parquet('data.parquet') becomes read_parquet('s3://bucket/prefix/data.parquet').
	 */
	private transformPaths(sql: string): string {
		if (!this.connId || !this.prefix) return sql;
		return sql.replace(/(read_(?:parquet|csv|json|csv_auto))\('([^']+)'\)/g, (match, fn, path) => {
			if (path.startsWith('s3://') || path.startsWith('http') || path.startsWith('/')) {
				return match;
			}
			const fullPath = `s3://${this.prefix}/${path}`;
			return `${fn}('${fullPath}')`;
		});
	}

	getResult(queryName: string) {
		return this.results.get(queryName);
	}

	getAllResults(): Map<string, Record<string, any>[]> {
		const map = new Map<string, Record<string, any>[]>();
		for (const [name, { rows }] of this.results) {
			map.set(name, rows);
		}
		return map;
	}

	getColumns(queryName: string): string[] {
		const entry = this.results.get(queryName);
		if (!entry) return [];
		return entry.result.columns;
	}
}
```

- [ ] **Step 2: Export it from the package index**

In `packages/objex-utils/src/index.ts`, add the export immediately after the existing markdown-sql export.

Old:
```ts
export * from './markdown-sql.js';
```
New:
```ts
export * from './markdown-sql.js';
// Markdown SQL execution context (engine injected by host)
export * from './markdown-sql-context.js';
```

- [ ] **Step 3: Rewire `MarkdownViewer.svelte` imports**

Replace the old import line (line 12):

Old:
```ts
import { EvidenceContext } from '$lib/utils/evidence-context';
```
New:
```ts
import { MarkdownSqlContext } from '@walkthru-earth/objex-utils';
import { getQueryEngine } from '../../query/index.js';
```

- [ ] **Step 4: Rewire the construction site (around line 81)**

Old:
```ts
			const ctx = new EvidenceContext(
				tab.connectionId ?? '',
				tab.path.split('/').slice(0, -1).join('/')
			);
```
New:
```ts
			const engine = await getQueryEngine();
			const ctx = new MarkdownSqlContext(
				engine,
				tab.connectionId ?? '',
				tab.path.split('/').slice(0, -1).join('/')
			);
```

- [ ] **Step 5: Delete the old file**

```bash
git rm src/lib/utils/evidence-context.ts
```

- [ ] **Step 6: Update `src/lib/utils/CLAUDE.md`**

Remove the `evidence-context.ts` row from the file table. Remove the `EVC[evidence-context.ts<br/>query/index = DuckDB]` node from the mermaid diagram. Add `markdown-sql-context` to the backtick promoted list (alphabetically near `markdown-sql`).

- [ ] **Step 7: Update `packages/objex-utils/CLAUDE.md`**

Add a bullet near the `markdown-sql` bullet:
```
- **markdown-sql-context**: `MarkdownSqlContext` (class). Executes the SQL blocks parsed by `markdown-sql` against an injected `QueryEngine`, caches results by block name, and rewrites relative `read_parquet`/`read_csv`/`read_json` paths to `s3://prefix/...`. The engine is passed in by the host so the module stays free of DuckDB.
```

- [ ] **Step 8: Update the MarkdownViewer row in `src/lib/components/viewers/CLAUDE.md`**

Old:
```
| MarkdownViewer | Marked, Milkdown | utils/markdown, utils/markdown-sql, editor/MilkdownEditor |
```
New:
```
| MarkdownViewer | Marked, Milkdown | utils/markdown, markdown-sql + markdown-sql-context (objex-utils), query/index (getQueryEngine), editor/MilkdownEditor |
```

- [ ] **Step 9: Build objex-utils, run the guardrail, type check**

```bash
pnpm --filter @walkthru-earth/objex-utils run build
pnpm -w run check
```
Expected: build and guardrail pass (the new module is type-only at the boundary, so no heavy dep enters the bundle). `pnpm -w run check` reports no new errors.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor(objex-utils): move evidence-context to package as markdown-sql-context with injected engine"
```

---

## Task 4: Add the Two-Layer Utility Map to root `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md` (insert a section before "## Build Defines")

- [ ] **Step 1: Insert the map section**

In `CLAUDE.md`, insert the following immediately before the line `## Build Defines (\`vite.config.ts\`)`:

```markdown
## Two-Layer Utility Map

Utilities live in one of two places. Decide with one rule.

- **Pure TypeScript, no heavy graphics or browser library, no SvelteKit or Svelte-store dependency (even via `await import()`)** goes in `@walkthru-earth/objex-utils` (`packages/objex-utils/src/`). Import it as `@walkthru-earth/objex-utils`.
- **Anything else** (heavy dep such as deck.gl, maplibre, zarrita, pdfjs, shiki, marked, babylon, pmtiles, zip, OR a `$app/navigation` / Svelte-store dependency) stays in `src/lib/utils/`. Import it via a relative `../utils/<x>.js`.

The import line tells you the layer. A package specifier (`@walkthru-earth/objex-utils`) is the pure layer, a relative `../utils/...` is the app layer. The canonical inventories are the two CLAUDE.md files, do not duplicate the lists elsewhere.

- Pure package inventory, see `packages/objex-utils/CLAUDE.md`.
- App-side inventory plus the list of every module promoted to the package, see `src/lib/utils/CLAUDE.md`.

```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): add two-layer utility map to root CLAUDE.md"
```

---

## Task 5: Fix stale references

**Files:**
- Modify: `README.md` (remove three invalid-subpath import lines)
- Modify: `.changeset/utils-to-objex-utils.md` (shim wording + cog-pure to cog-info)
- Modify: `docs/wkb-to-geoarrow-pipeline.md` (path)
- Modify: `docs/multicog-sentinel2-design.md` (authoritative pointer)
- Modify: `src/lib/query/stac-source-parquet.ts` (header comment)

- [ ] **Step 1: Remove the invalid README import lines**

In `README.md`, delete lines 61-63 (they use the non-existent `@walkthru-earth/objex/utils/*` subpath, and the objex-utils section below already documents these correctly).

Delete:
```ts
import { parseWKB } from '@walkthru-earth/objex/utils/wkb';
import { buildGeoArrowTables } from '@walkthru-earth/objex/utils/geoarrow';
import { readParquetMetadata } from '@walkthru-earth/objex/utils/parquet-metadata';
```

- [ ] **Step 2: Fix the changeset wording and the cog-pure references**

In `.changeset/utils-to-objex-utils.md`:

Old (in line 6):
```
The `src/lib/utils/<name>.ts` files become thin shims that re-export from `@walkthru-earth/objex-utils`, so every existing import path in `@walkthru-earth/objex` continues to resolve.
```
New:
```
The `src/lib/utils/<name>.ts` source files were removed. Consumers import these utilities from `@walkthru-earth/objex-utils` directly.
```

Also in line 6, change the list entry `cog-pure` to `cog-info`. In line 8, change `the `cog-pure.ts` split pattern` to `the `cog-info.ts` split pattern`.

- [ ] **Step 3: Fix the geoarrow doc path**

In `docs/wkb-to-geoarrow-pipeline.md`:

Old (line 14):
```
`buildGeoArrowTables` in `src/lib/utils/geoarrow.ts`. It walks raw WKB
```
New:
```
`buildGeoArrowTables` in `packages/objex-utils/src/geoarrow.ts` (re-exported through `src/lib/index.ts` and the `@walkthru-earth/objex-utils` entry point). It walks raw WKB
```

- [ ] **Step 4: Fix the multicog design authoritative pointer**

In `docs/multicog-sentinel2-design.md`:

Old (line 3):
```
Status, Implemented (v0.6.0-alpha.1). See `src/lib/components/viewers/MultiCogViewer.svelte` and `src/lib/utils/stac.ts`.
```
New:
```
Status, Implemented (v0.6.0-alpha.1). See `src/lib/components/viewers/MultiCogViewer.svelte` and `packages/objex-utils/src/stac.ts`.
```

- [ ] **Step 5: Fix the stac-source-parquet header comment**

In `src/lib/query/stac-source-parquet.ts`:

Old (lines 7-8):
```ts
 *   - `stacRowToItem` from `utils/stac-geoparquet.js` for the pure transform
 *   - `parseWKB` from `utils/wkb.js` for geometry decoding
```
New:
```ts
 *   - `stacRowToItem` from `@walkthru-earth/objex-utils` for the pure transform
 *   - `parseWKB` from `@walkthru-earth/objex-utils` for geometry decoding
```

- [ ] **Step 6: Commit**

```bash
git add README.md .changeset/utils-to-objex-utils.md docs/wkb-to-geoarrow-pipeline.md docs/multicog-sentinel2-design.md src/lib/query/stac-source-parquet.ts
git commit -m "docs: fix stale utils paths across README, changeset, and design docs"
```

---

## Task 6: Delete stale planning and spec docs

**Files:**
- Delete: `docs/superpowers/plans/2026-04-27-unified-rgb-channel-picker-plan.md`
- Delete: `docs/superpowers/specs/2026-04-26-stac-source-contract-design.md`
- Delete: `docs/superpowers/specs/2026-04-27-unified-rgb-channel-picker-design.md`

These describe the pre-move layout for shipped features. The new spec `2026-05-28-objex-utils-split-clarity-design.md` is kept.

- [ ] **Step 1: Delete the three files**

```bash
cd /Users/yharby/Documents/gh/walkthru-earth/obstore-explore/objex
git rm docs/superpowers/plans/2026-04-27-unified-rgb-channel-picker-plan.md \
       docs/superpowers/specs/2026-04-26-stac-source-contract-design.md \
       docs/superpowers/specs/2026-04-27-unified-rgb-channel-picker-design.md
```

- [ ] **Step 2: Confirm the new spec survives**

```bash
ls docs/superpowers/specs/
```
Expected: only `2026-05-28-objex-utils-split-clarity-design.md` remains in specs/.

- [ ] **Step 3: Commit**

```bash
git commit -m "docs: remove stale planning and spec docs describing pre-move utils layout"
```

---

## Task 7: Changeset and full production-grade verification

**Files:**
- Create: `.changeset/objex-utils-split-clarity.md`

- [ ] **Step 1: Add the changeset**

Create `.changeset/objex-utils-split-clarity.md`:

```markdown
---
'@walkthru-earth/objex': patch
'@walkthru-earth/objex-utils': patch
---

Clarify the two-layer utility split. Rename `cog-pure` to `cog-info` and the app-side `url` to `signed-url`, move the markdown SQL execution context into `@walkthru-earth/objex-utils` as `MarkdownSqlContext` (engine injected by the host), add a two-layer utility map to the root guide, and fix stale documentation paths. No runtime behavior changes.
```

- [ ] **Step 2: Run format and lint**

```bash
pnpm -w run format
pnpm -w run lint:fix
```
Expected: completes with no remaining errors.

- [ ] **Step 3: Run the type check**

```bash
pnpm -w run check
```
Expected: no errors.

- [ ] **Step 4: Build both packages**

```bash
pnpm -w run package
pnpm --filter @walkthru-earth/objex-utils run build
```
Expected: svelte-package plus publint succeed, tsup build succeeds, and the bundle guardrail prints no forbidden-import failures.

- [ ] **Step 5: Confirm no `$lib/` leaked into the published dist**

```bash
grep -r '\$lib/' dist/ --include='*.js' || echo "no \$lib in dist (good)"
```
Expected: prints "no $lib in dist (good)".

- [ ] **Step 6: Inspect the objex-utils tarball**

```bash
pnpm --filter @walkthru-earth/objex-utils pack --pack-destination /tmp
tar tf /tmp/walkthru-earth-objex-utils-*.tgz | grep -E 'cog-info|markdown-sql-context' || echo "check dist contents"
```
Expected: the built `dist` carries the renamed and moved modules (names appear in `dist/index.*`).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: changeset for objex-utils split clarity"
```

---

## Self-review notes

- **Spec coverage.** Part A renames map to Tasks 1, 2, 3. Part B move is Task 3. Part C map is Task 4. Part D stale fixes are Task 5. Part E deletions are Task 6. Part F verification plus changeset is Task 7. All six parts covered.
- **Type consistency.** The moved class is `MarkdownSqlContext` in every reference (module, index export, MarkdownViewer construction, both CLAUDE.md files). The constructor signature `(engine, connId, prefix)` matches the `new MarkdownSqlContext(engine, ...)` call site in Task 3 Step 4. `engine.query(connId, sql)` matches `QueryEngine.query(connId: string, sql: string): Promise<QueryResult>` from `src/lib/query/engine.ts:58`, and `result.columns` plus `result.rows` match the original evidence-context usage.
- **Renamed symbols.** `cog-info.ts` and `signed-url.ts` keep identical exported symbol names, so only import paths and narrative comments change. Verified `cog.ts` re-exports the cog symbols by name from the package, not from the file path, so the file rename needs no import edit in `cog.ts`.
- **No placeholders.** Every code and doc step shows the exact before and after text or the exact command.
