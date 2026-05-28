# Audit Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the findings from the 5-dimension codebase audit (hardcoded values, correctness bugs, performance, UI consistency, mobile) in risk-ordered phases, each independently shippable.

**Architecture:** Work bottom-up. Phases 1-3 are small, surgical, and mostly cover pure TypeScript in `@walkthru-earth/objex-utils` and `src/lib/query` — these get real TDD with vitest. Phases 4-5 are larger Svelte component refactors (UI consistency + mobile) verified via `svelte-check`, build, and manual browser testing because Svelte viewers have no unit-test harness here. Every phase ends green on `format` + `lint:fix` + `check` and is committed.

**Tech Stack:** SvelteKit 2 (static adapter, CSR-only), Svelte 5 runes, TypeScript 5, Tailwind CSS 4, pnpm 10, DuckDB-WASM, deck.gl/MapLibre, vitest, Biome.

---

## Conventions for every task

- **Quality gate command (run before every commit):**
  ```bash
  pnpm -w run format && pnpm -w run lint:fix && pnpm -w run check
  ```
  All three must pass (Biome: tabs, single quotes, semicolons, 100-char width).
- **Unit test command (pure utils in objex-utils):**
  ```bash
  pnpm --filter @walkthru-earth/objex-utils test -- --run
  ```
- **Package build verification (when touching `src/lib` public API or objex-utils):**
  ```bash
  pnpm -w run package && pnpm --filter @walkthru-earth/objex-utils run build
  ```
- **Import rule (hard):** No `$lib/` in any file under `src/lib/` or `packages/`. Use relative imports. Pure utils import from `@walkthru-earth/objex-utils`.
- **i18n rule:** every user-facing string goes through `t()`.

---

## File Structure

New files:
- `packages/objex-utils/src/crs.ts` — pure CRS helpers (`isWgs84`), re-exported from package index.
- `packages/objex-utils/src/crs.test.ts` — vitest for `crs.ts`.
- `src/lib/components/viewers/ViewerHeader.svelte` — shared viewer title bar (Phase 4).
- `src/lib/components/viewers/ViewerStatus.svelte` — shared loading/error/empty state (Phase 4).
- `src/lib/utils/signed-url-effect.ts` — shared signed-iframe-URL resolver (Phase 4).

Modified (high-traffic): `src/lib/constants.ts`, `packages/objex-utils/src/index.ts`, `packages/objex-utils/src/wkb.ts`, `packages/objex-utils/src/cloud-url.ts`, `packages/objex-utils/src/app-config.ts`, `src/lib/query/wasm.ts`, `src/lib/query/stac-source-parquet.ts`, `src/lib/storage/presign.ts`, `src/lib/storage/providers.ts`, `src/lib/stores/settings.svelte.ts`, `src/lib/utils/url-state.ts`, `src/lib/utils/deck.ts`, plus most viewers in `src/lib/components/viewers/`.

---

## Phase 0: Baseline

### Task 0.1: Establish a green baseline

**Files:** none (verification only)

- [ ] **Step 1: Confirm the working tree is clean and on a feature branch**

```bash
git status
git checkout -b audit-remediation
```
Expected: clean tree, switched to new branch.

- [ ] **Step 2: Run the quality gate to capture a known-good baseline**

```bash
pnpm -w run format && pnpm -w run lint:fix && pnpm -w run check
```
Expected: all pass. If anything fails on a clean tree, STOP and report — the baseline is not green and later "did I break it?" checks become unreliable.

- [ ] **Step 3: Run existing unit tests**

```bash
pnpm --filter @walkthru-earth/objex-utils test -- --run
```
Expected: all pass (includes `app-config.test.ts`).

---

## Phase 1: Centralize hardcoded values (single source of truth)

Goal: kill duplicated literals and wire up the SoT constants that already exist but are unused.

### Task 1.1: Add `DEFAULT_AWS_REGION` constant and wire all call sites

**Scope (important):** Replace ONLY the *fallback* pattern `... || 'us-east-1'` and the dialog's `$state('us-east-1')` default. Do NOT touch the provider registry's legitimate data: `defaultRegion: 'us-east-1'`, the region option lists `{ code: 'us-east-1', label: ... }`, `endpointPlaceholder` strings, or the doc comment in `url-state.ts`. Those are configuration data, not duplicated fallbacks.

The exact fallback sites (from grep):
- `packages/objex-utils/src/cloud-url.ts:57` — `regionMatch ? regionMatch[0] : 'us-east-1'`
- `packages/objex-utils/src/storage-url.ts` — 6× `defaults.region || 'us-east-1'` (lines ~171, 203, 248, 460, 522, 543). NOTE: line ~570 `parsed.region !== 'us-east-1'` is a comparison — replace it with the constant too so the equality stays meaningful.
- `src/lib/storage/providers.ts:583` — `region || 'us-east-1'` (the `buildProviderBaseUrl` return). Leave lines 80/162/236/297 (`defaultRegion`) and 83/239/300/320 (option labels/placeholders) UNTOUCHED.
- `src/lib/storage/presign.ts:54` — `conn.region || 'us-east-1'`
- `src/lib/components/layout/ConnectionDialog.svelte:59` — `let region = $state('us-east-1')`

**Files:**
- Modify: `src/lib/constants.ts`
- Modify: `packages/objex-utils/src/index.ts` (re-export)
- Modify: `packages/objex-utils/src/cloud-url.ts:57`
- Modify: `packages/objex-utils/src/storage-url.ts` (6 fallback sites + 1 comparison)
- Modify: `src/lib/storage/presign.ts:54`
- Modify: `src/lib/storage/providers.ts:583` (fallback only)
- Modify: `src/lib/components/layout/ConnectionDialog.svelte:59`

- [ ] **Step 1: Add the constant to `src/lib/constants.ts`** (append in the Geo/CRS section)

```ts
// ── AWS defaults ──

/** Region assumed when a connection or bucket name yields none. AWS's global default. */
export const DEFAULT_AWS_REGION = 'us-east-1';
```

- [ ] **Step 2: Re-export from objex-utils** — in `packages/objex-utils/src/index.ts`, find the line that re-exports host constants (it lists `COPY_FEEDBACK_MS`, `DEFAULT_TARGET_CRS`, ...) and add `DEFAULT_AWS_REGION` to that export list.

- [ ] **Step 3: Use it in `cloud-url.ts`** — replace line 57:

```ts
		const region = regionMatch ? regionMatch[0] : 'us-east-1';
```
with:
```ts
		const region = regionMatch ? regionMatch[0] : DEFAULT_AWS_REGION;
```
and add the import at the top (it already imports from host providers; add a sibling-style import from host constants):
```ts
import { DEFAULT_AWS_REGION } from '../../../src/lib/constants.js';
```

- [ ] **Step 3b: Use it in `storage-url.ts`** — replace each `defaults.region || 'us-east-1'` with `defaults.region || DEFAULT_AWS_REGION` and the `parsed.region !== 'us-east-1'` comparison with `!== DEFAULT_AWS_REGION`. Import relatively (this file is in the pure package and already imports host modules via `../../../src/lib/...`):
```ts
import { DEFAULT_AWS_REGION } from '../../../src/lib/constants.js';
```

- [ ] **Step 4: Use it in `presign.ts` and `providers.ts`** — replace ONLY the fallback sites (`presign.ts:54` and `providers.ts:583`) with `DEFAULT_AWS_REGION`, importing relatively (`import { DEFAULT_AWS_REGION } from '../constants.js';`).

```bash
grep -n "|| 'us-east-1'" src/lib/storage/presign.ts src/lib/storage/providers.ts
```
Replace each match. Do NOT change `providers.ts` lines 80/162/236/297 (`defaultRegion`) or 83/239/300/320 (region option labels / placeholders) — those are registry data, not fallbacks.

- [ ] **Step 5: Use it in `ConnectionDialog.svelte`** — replace the `$state` default:

```bash
grep -n "us-east-1" src/lib/components/layout/ConnectionDialog.svelte
```
Change `let region = $state('us-east-1')` to `let region = $state(DEFAULT_AWS_REGION)`, importing from `@walkthru-earth/objex-utils` (component layer uses the package, not relative host paths).

- [ ] **Step 6: Verify no fallback literals remain** (registry data legitimately keeps the string)

```bash
grep -rn "|| 'us-east-1'\|: 'us-east-1'$\|? regionMatch" src/lib/storage src/lib/components/layout/ConnectionDialog.svelte packages/objex-utils/src/cloud-url.ts packages/objex-utils/src/storage-url.ts
```
Expected: no `|| 'us-east-1'` fallbacks left. The provider registry (`defaultRegion`, option labels, placeholders) and the `url-state.ts` doc comment still contain the literal — that is correct.

- [ ] **Step 7: Quality gate + package build**

```bash
pnpm -w run format && pnpm -w run lint:fix && pnpm -w run check
pnpm --filter @walkthru-earth/objex-utils run build
```
Expected: all pass; objex-utils bundle verifier passes.

- [ ] **Step 8: Commit**

```bash
git add src/lib/constants.ts packages/objex-utils/src/index.ts packages/objex-utils/src/cloud-url.ts packages/objex-utils/src/storage-url.ts src/lib/storage/presign.ts src/lib/storage/providers.ts src/lib/components/layout/ConnectionDialog.svelte
git commit -m "refactor: centralize default AWS region into DEFAULT_AWS_REGION"
```

---

### Task 1.2: Add a tested `isWgs84` helper in objex-utils and adopt it in TableViewer

**Files:**
- Create: `packages/objex-utils/src/crs.ts`
- Create: `packages/objex-utils/src/crs.test.ts`
- Modify: `packages/objex-utils/src/index.ts`
- Modify: `src/lib/components/viewers/TableViewer.svelte` (the inline `[4326, 4979]` + string compare site, ~line 506)

> Note: do NOT touch `FlatGeobufViewer`'s `WGS84_CODES` here — it is intentionally broader (includes NAD27/NAD83 datums 4267/4269 and a `isWgs84Geographic` 4000-4999 range). Reconciling it is Task 1.3, kept separate so this task stays a safe pure-function extraction.

- [ ] **Step 1: Write the failing test** — `packages/objex-utils/src/crs.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isWgs84 } from './crs.js';

describe('isWgs84', () => {
	it('accepts the canonical WGS84 numeric codes', () => {
		expect(isWgs84(4326)).toBe(true);
		expect(isWgs84(4979)).toBe(true);
	});
	it('accepts the canonical WGS84 string forms', () => {
		expect(isWgs84('EPSG:4326')).toBe(true);
		expect(isWgs84('OGC:CRS84')).toBe(true);
		expect(isWgs84('epsg:4326')).toBe(true);
	});
	it('rejects projected / other CRS', () => {
		expect(isWgs84(3857)).toBe(false);
		expect(isWgs84('EPSG:3857')).toBe(false);
		expect(isWgs84(4267)).toBe(false); // NAD27 is a datum, not WGS84
	});
	it('handles null/undefined/garbage', () => {
		expect(isWgs84(null)).toBe(false);
		expect(isWgs84(undefined)).toBe(false);
		expect(isWgs84('')).toBe(false);
		expect(isWgs84(NaN)).toBe(false);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @walkthru-earth/objex-utils test -- --run crs
```
Expected: FAIL — cannot resolve `./crs.js`.

- [ ] **Step 3: Implement `packages/objex-utils/src/crs.ts`**

```ts
/**
 * CRS helpers — pure TS. Single source of truth for "is this WGS84 lon/lat".
 * Reuses WGS84_CODES / DEFAULT_TARGET_CRS from host constants so the numeric
 * set is never re-typed in a viewer.
 */
import { DEFAULT_TARGET_CRS, WGS84_CODES } from '../../../src/lib/constants.js';

/** WGS84 string forms that require no reprojection (matches DEFAULT_TARGET_CRS + EPSG:4326/4979). */
const WGS84_STRINGS = new Set(['epsg:4326', 'epsg:4979', DEFAULT_TARGET_CRS.toLowerCase()]);

/**
 * True when the given CRS is WGS84 lon/lat (no ST_Transform needed).
 * Accepts a numeric EPSG code or a string like "EPSG:4326" / "OGC:CRS84".
 */
export function isWgs84(crs: number | string | null | undefined): boolean {
	if (crs === null || crs === undefined) return false;
	if (typeof crs === 'number') return Number.isFinite(crs) && WGS84_CODES.has(crs);
	const s = crs.trim().toLowerCase();
	if (s.length === 0) return false;
	if (WGS84_STRINGS.has(s)) return true;
	const m = s.match(/(?:epsg:)?(\d+)/);
	return m ? WGS84_CODES.has(Number(m[1])) : false;
}
```

- [ ] **Step 4: Re-export from `packages/objex-utils/src/index.ts`** — add:

```ts
export * from './crs.js';
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm --filter @walkthru-earth/objex-utils test -- --run crs
```
Expected: PASS (4 tests).

- [ ] **Step 6: Adopt in TableViewer** — the current code (lines 505-509) is:

```ts
						const isWgs84 =
							crsVal === 'EPSG:4326' ||
							crsVal === 'OGC:CRS84' ||
							(crsVal.startsWith('EPSG:') && [4326, 4979].includes(Number(crsVal.split(':')[1])));
						sourceCrs = isWgs84 ? null : crsVal;
```
The local `const isWgs84` would COLLIDE with the imported function name. Delete the local const entirely and call the import directly:

```ts
						sourceCrs = isWgs84(crsVal) ? null : crsVal;
```
Add `isWgs84` to the existing `@walkthru-earth/objex-utils` import in that file. The semantics are identical — `isWgs84(crsVal)` returns true for `EPSG:4326`/`OGC:CRS84`/`EPSG:4979`, so `sourceCrs` stays `null` (no `ST_Transform`) in exactly the same cases.

- [ ] **Step 7: Quality gate + build + test**

```bash
pnpm -w run format && pnpm -w run lint:fix && pnpm -w run check
pnpm --filter @walkthru-earth/objex-utils run build
pnpm --filter @walkthru-earth/objex-utils test -- --run
```
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add packages/objex-utils/src/crs.ts packages/objex-utils/src/crs.test.ts packages/objex-utils/src/index.ts src/lib/components/viewers/TableViewer.svelte
git commit -m "feat: add tested isWgs84 helper and adopt it in TableViewer"
```

---

### Task 1.3: Document (do NOT blindly narrow) FlatGeobufViewer's CRS set

**Files:**
- Modify: `src/lib/components/viewers/FlatGeobufViewer.svelte:74-85` (comment only)

**Important decision, not a mechanical swap.** The actual FGB code is:

```ts
const WGS84_CODES = new Set([4326, 4979, 4267, 4269]);
const CRS84_NAMES = ['CRS84', 'CRS 84', 'OGC:CRS84'];

/** Returns true if the header CRS is WGS84/CRS84 or absent (assumed WGS84). */
function isWgs84Crs(crs: HeaderMeta['crs']): boolean {
	if (!crs) return true; // no CRS declared → assume WGS84
	if (crs.code && WGS84_CODES.has(crs.code)) return true;
	if (crs.name && CRS84_NAMES.some((n) => crs.name!.includes(n))) return true;
	return false;
}
```

This set INTENTIONALLY treats NAD27 (4267) and NAD83 (4269) as "no reprojection needed" — NAD83 is within ~1-2 m of WGS84 and FGB authors commonly ship NAD-coded data that is effectively lon/lat. Swapping `isWgs84Crs` to the canonical `isWgs84` (only 4326/4979) would START reprojecting those files, which is a **behavior change** that needs a real FGB test file to validate, not a refactor. So this task does NOT replace the predicate.

- [ ] **Step 1: Read the block to confirm it still matches the snippet above**

```bash
sed -n '72,85p' src/lib/components/viewers/FlatGeobufViewer.svelte
```

- [ ] **Step 2: Add a clarifying comment only** — above the local `WGS84_CODES`, explain why it diverges from the canonical `WGS84_CODES` in `constants.ts` so a future reader doesn't "fix" it by deleting the NAD codes:

```ts
// NOTE: intentionally broader than the canonical WGS84_CODES in constants.ts.
// 4267 (NAD27) / 4269 (NAD83) are treated as lon/lat here because FGB files
// commonly ship NAD-coded data that needs no reprojection for display.
// Do not narrow to [4326, 4979] without a NAD-coded FGB test file.
const WGS84_CODES = new Set([4326, 4979, 4267, 4269]);
```

- [ ] **Step 3: Quality gate**

```bash
pnpm -w run format && pnpm -w run lint:fix && pnpm -w run check
```
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/viewers/FlatGeobufViewer.svelte
git commit -m "docs: explain why FlatGeobuf WGS84 set includes NAD datums"
```

---

### Task 1.4: Wire up the already-existing-but-unused `COPY_FEEDBACK_MS`

**Files:**
- Modify: `src/lib/components/viewers/TableToolbar.svelte` (raw `2000`)
- Modify: `src/lib/components/layout/SettingsSheet.svelte` (raw `1500`)

- [ ] **Step 1: Grep the call sites**

```bash
grep -n "2000\|1500\|setTimeout" src/lib/components/viewers/TableToolbar.svelte src/lib/components/layout/SettingsSheet.svelte
```

- [ ] **Step 2: Replace both literals** with `COPY_FEEDBACK_MS`, imported from `@walkthru-earth/objex-utils`. Both become the same 2000ms feedback duration (intentional consolidation — copy feedback should be uniform).

- [ ] **Step 3: Confirm the constant is now used**

```bash
grep -rn "COPY_FEEDBACK_MS" src/lib
```
Expected: imports in both files (plus any pre-existing `clipboard.ts` usage).

- [ ] **Step 4: Quality gate**

```bash
pnpm -w run format && pnpm -w run lint:fix && pnpm -w run check
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/viewers/TableToolbar.svelte src/lib/components/layout/SettingsSheet.svelte
git commit -m "refactor: use COPY_FEEDBACK_MS for copy feedback timeouts"
```

---

### Task 1.5: Wire `STORAGE_KEYS.CONNECTIONS` into wasm.ts

**Files:**
- Modify: `src/lib/query/wasm.ts` (the raw `localStorage.getItem('obstore-explore-connections')` site, ~line 970)

- [ ] **Step 1: Grep the site**

```bash
grep -n "obstore-explore-connections" src/lib/query/wasm.ts
```

- [ ] **Step 2: Replace the literal** with `STORAGE_KEYS.CONNECTIONS`. Confirm `STORAGE_KEYS` is importable — `wasm.ts` is in `src/lib`, so import relatively: `import { STORAGE_KEYS } from '../constants.js';` (merge into an existing import from `../constants.js` if present).

- [ ] **Step 3: Verify no raw key remains**

```bash
grep -rn "obstore-explore-connections" src/lib
```
Expected: only the definition in `constants.ts`.

- [ ] **Step 4: Quality gate + commit**

```bash
pnpm -w run format && pnpm -w run lint:fix && pnpm -w run check
git add src/lib/query/wasm.ts
git commit -m "refactor: use STORAGE_KEYS.CONNECTIONS in wasm.ts"
```

---

### Task 1.6: Centralize repeated deck.gl / map literals

**Files:**
- Modify: `src/lib/utils/deck.ts` (add `HIGHLIGHT_COLOR`; it already hosts `GEOMETRY_COLORS`)
- Modify: `src/lib/constants.ts` (add `TILE_DEBOUNCE_MS`, `FIRST_FEATURE_FLY_ZOOM`)
- Modify: `src/lib/components/viewers/FlatGeobufViewer.svelte` (highlightColor + flyTo zoom)
- Modify: `src/lib/components/viewers/GeoParquetMapViewer.svelte` (flyTo zoom)
- Modify: `src/lib/components/viewers/StacMosaicViewer.svelte` (debounceTime)

- [ ] **Step 1: Add `HIGHLIGHT_COLOR` to `src/lib/utils/deck.ts`** near `GEOMETRY_COLORS`:

```ts
/** RGBA used to highlight a hovered/selected feature across map viewers. */
export const HIGHLIGHT_COLOR: [number, number, number, number] = [255, 255, 255, 100];
```

- [ ] **Step 2: Add the two constants to `src/lib/constants.ts`** in the relevant sections:

```ts
// ── Map / tiles ──

/** deck.gl tile-layer debounce (ms) before fetching after a viewport change. */
export const TILE_DEBOUNCE_MS = 200;

/** Zoom level used when flying to the first feature of a vector dataset. */
export const FIRST_FEATURE_FLY_ZOOM = 14;
```

- [ ] **Step 3: Replace the call sites** — grep each, replace the literal, add the import:

```bash
grep -n "255, 255, 255, 100\|highlightColor" src/lib/utils/deck.ts src/lib/components/viewers/FlatGeobufViewer.svelte
grep -n "zoom: 14" src/lib/components/viewers/GeoParquetMapViewer.svelte src/lib/components/viewers/FlatGeobufViewer.svelte
grep -n "debounceTime" src/lib/components/viewers/StacMosaicViewer.svelte
```
- In `deck.ts`, use the new `HIGHLIGHT_COLOR` constant in the 3 internal sites.
- In `FlatGeobufViewer.svelte`, import `HIGHLIGHT_COLOR` from `../../utils/deck.js` for the highlight, and `FIRST_FEATURE_FLY_ZOOM` from `@walkthru-earth/objex-utils` for `flyTo`.
- In `GeoParquetMapViewer.svelte`, import and use `FIRST_FEATURE_FLY_ZOOM`.
- In `StacMosaicViewer.svelte`, import and use `TILE_DEBOUNCE_MS` at both `debounceTime` sites.

- [ ] **Step 4: Quality gate + build + commit**

```bash
pnpm -w run format && pnpm -w run lint:fix && pnpm -w run check
pnpm --filter @walkthru-earth/objex-utils run build
git add src/lib/utils/deck.ts src/lib/constants.ts src/lib/components/viewers/FlatGeobufViewer.svelte src/lib/components/viewers/GeoParquetMapViewer.svelte src/lib/components/viewers/StacMosaicViewer.svelte
git commit -m "refactor: centralize highlight color, tile debounce, fly-to zoom"
```

---

### Task 1.7: Dedupe the `1000`/`2000` limit defaults against `DEFAULT_APP_CONFIG`

**Files:**
- Modify: `src/lib/stores/settings.svelte.ts:90,95`
- Modify: `src/lib/query/stac-source-parquet.ts` (the `DEFAULT_LIMIT = 2000`, ~line 211)

- [ ] **Step 1: In `settings.svelte.ts`, reference the config defaults instead of re-typing** — the fallbacks `1000`/`2000` duplicate `DEFAULT_APP_CONFIG.defaults`. Import it and use it:

```ts
import { DEFAULT_APP_CONFIG } from '@walkthru-earth/objex-utils';
```
Replace the trailing literal in `featureLimit`:
```ts
		get featureLimit(): number {
			return resolveSetting(
				user.featureLimit,
				cfg().defaults.featureLimit,
				DEFAULT_APP_CONFIG.defaults.featureLimit
			) as number;
		},
```
and the `mosaicItemLimit` fallback:
```ts
			const configured = resolveSetting(
				cfg().defaults.mosaicItemLimit,
				DEFAULT_APP_CONFIG.defaults.mosaicItemLimit
			) as number;
```

- [ ] **Step 2: In `stac-source-parquet.ts`, derive the default from the shared config** — replace `const DEFAULT_LIMIT = 2000;` with a reference to `DEFAULT_APP_CONFIG.defaults.mosaicItemLimit`:

```ts
import { DEFAULT_APP_CONFIG } from '@walkthru-earth/objex-utils';
const DEFAULT_LIMIT = DEFAULT_APP_CONFIG.defaults.mosaicItemLimit;
```
Confirm the file does not already import a conflicting `DEFAULT_APP_CONFIG`.

- [ ] **Step 3: Quality gate + commit**

```bash
pnpm -w run format && pnpm -w run lint:fix && pnpm -w run check
git add src/lib/stores/settings.svelte.ts src/lib/query/stac-source-parquet.ts
git commit -m "refactor: source default feature/mosaic limits from DEFAULT_APP_CONFIG"
```

---

### Task 1.8: Move CartoDN basemap defaults into `DEFAULT_APP_CONFIG`

**Files:**
- Modify: `packages/objex-utils/src/app-config.ts` (`DEFAULT_APP_CONFIG`)
- Modify: `packages/objex-utils/src/app-config.test.ts` (assert the defaults)
- Modify: `src/lib/components/viewers/map/MapContainer.svelte:11-12`

- [ ] **Step 1: Read the current hardcoded URLs** so the move is verbatim:

```bash
sed -n '1,30p' src/lib/components/viewers/map/MapContainer.svelte
```
Capture the exact positron (light) and dark-matter (dark) style URLs.

- [ ] **Step 2: Add them to `DEFAULT_APP_CONFIG.basemaps` + `defaultBasemap`** in `app-config.ts` (replace the empty `basemaps: []` / `defaultBasemap: {}`):

```ts
	basemaps: [
		{
			id: 'positron',
			label: 'Positron',
			type: 'vector',
			url: '<EXACT_LIGHT_URL_FROM_STEP_1>',
			variant: 'light'
		},
		{
			id: 'dark-matter',
			label: 'Dark Matter',
			type: 'vector',
			url: '<EXACT_DARK_URL_FROM_STEP_1>',
			variant: 'dark'
		}
	],
	defaultBasemap: { light: 'positron', dark: 'dark-matter' },
```

- [ ] **Step 3: Update the `mergeAppConfig` "non-object input" test** — `app-config.test.ts:60-62` asserts `mergeAppConfig(DEFAULT_APP_CONFIG, null)` equals `DEFAULT_APP_CONFIG`; that still holds (same object). Add one positive assertion that the defaults now carry basemaps:

```ts
	it('ships CartoDN basemap defaults', () => {
		expect(DEFAULT_APP_CONFIG.basemaps.map((b) => b.id)).toEqual(['positron', 'dark-matter']);
		expect(DEFAULT_APP_CONFIG.defaultBasemap).toEqual({ light: 'positron', dark: 'dark-matter' });
	});
```

- [ ] **Step 4: Make `MapContainer.svelte` consume the resolved basemap** — replace the inline URL constants with `resolveBasemap(appConfig.value, settings.resolved, settings.basemapId)`; fall back to the hardcoded URL only if `resolveBasemap` returns undefined (it won't now, but keep the guard tiny). Read lines 1-40 first to wire the existing `appConfig`/`settings` imports; `resolveBasemap` comes from `@walkthru-earth/objex-utils`.

- [ ] **Step 5: Run tests + quality gate + build**

```bash
pnpm --filter @walkthru-earth/objex-utils test -- --run
pnpm -w run format && pnpm -w run lint:fix && pnpm -w run check
pnpm --filter @walkthru-earth/objex-utils run build
```
Expected: all pass.

- [ ] **Step 6: Manual smoke** — note: open a map viewer in light and dark theme, confirm the basemap still renders and toggles. Record result in commit body.

- [ ] **Step 7: Commit**

```bash
git add packages/objex-utils/src/app-config.ts packages/objex-utils/src/app-config.test.ts src/lib/components/viewers/map/MapContainer.svelte
git commit -m "refactor: move default basemaps into DEFAULT_APP_CONFIG"
```

---

### Task 1.9: Remove stray `console.log` from FlatGeobufViewer

**Files:**
- Modify: `src/lib/components/viewers/FlatGeobufViewer.svelte`

- [ ] **Step 1: List them**

```bash
grep -n "console.log" src/lib/components/viewers/FlatGeobufViewer.svelte
```

- [ ] **Step 2: Delete each `console.log` line.** Keep `console.error`/`console.warn` only if they report genuine errors; remove debug logs entirely (CLAUDE.md: no `console.log` in library code).

- [ ] **Step 3: Confirm none remain**

```bash
grep -rn "console.log" src/lib/components/viewers/FlatGeobufViewer.svelte
```
Expected: nothing.

- [ ] **Step 4: Quality gate + commit**

```bash
pnpm -w run format && pnpm -w run lint:fix && pnpm -w run check
git add src/lib/components/viewers/FlatGeobufViewer.svelte
git commit -m "chore: remove debug console.log from FlatGeobufViewer"
```

---

## Phase 2: Correctness bugs

### Task 2.1: `findGeoColumnFromRows` must scan first N non-null rows, not just row 0

**Files:**
- Modify: `packages/objex-utils/src/wkb.ts:338-379`
- Create/modify: `packages/objex-utils/src/wkb.test.ts` (create if absent)

Bug: `const sample = rows[0]` (wkb.ts:344). If row 0's geometry is NULL but later rows have geometry, detection returns null and the map silently renders nothing.

- [ ] **Step 1: Write the failing test** — `packages/objex-utils/src/wkb.test.ts` (add this `describe`; create the file with the import if it does not exist):

```ts
import { describe, expect, it } from 'vitest';
import { findGeoColumnFromRows } from './wkb.js';

describe('findGeoColumnFromRows', () => {
	const schema = [
		{ name: 'id', type: 'INTEGER' },
		{ name: 'geometry', type: 'BLOB' }
	];
	// Minimal valid little-endian WKB Point (0x01, type=1, x=0, y=0)
	const wkbPoint = new Uint8Array([
		0x01, 0x01, 0x00, 0x00, 0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
	]);

	it('finds the geometry column when row 0 is null but a later row has WKB', () => {
		const rows = [
			{ id: 1, geometry: null },
			{ id: 2, geometry: wkbPoint }
		];
		expect(findGeoColumnFromRows(rows, schema)).toBe('geometry');
	});

	it('still finds it when row 0 already has WKB (regression)', () => {
		const rows = [{ id: 1, geometry: wkbPoint }];
		expect(findGeoColumnFromRows(rows, schema)).toBe('geometry');
	});

	it('returns null when no row has geometry', () => {
		const rows = [
			{ id: 1, geometry: null },
			{ id: 2, geometry: null }
		];
		expect(findGeoColumnFromRows(rows, schema)).toBeNull();
	});
});
```

- [ ] **Step 2: Run it to verify the first case fails**

```bash
pnpm --filter @walkthru-earth/objex-utils test -- --run wkb
```
Expected: FAIL on "finds the geometry column when row 0 is null..." (current code only checks `rows[0]`).

- [ ] **Step 3: Rewrite `findGeoColumnFromRows`** to scan up to the first N non-null candidate values per column. Replace the body (lines 342-378):

```ts
	if (rows.length === 0) return null;

	const MAX_SCAN = 50;
	const scan = rows.slice(0, MAX_SCAN);

	const firstNonNull = (key: string): unknown => {
		for (const row of scan) {
			const v = row[key];
			if (v !== null && v !== undefined) return v;
		}
		return undefined;
	};

	// First pass: binary-typed columns, first non-null value per column
	for (const f of schema) {
		const t = f.type.toLowerCase();
		const isBinary = t.includes('blob') || t.includes('binary') || t.includes('bytea');
		if (isBinary && looksLikeWKB(firstNonNull(f.name))) return f.name;
	}

	// Second pass: any column whose first non-null value looks geometric
	const keys = new Set<string>();
	for (const row of scan) for (const k of Object.keys(row)) keys.add(k);

	for (const key of keys) {
		const value = firstNonNull(key);
		if (value === undefined) continue;
		if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
			if (looksLikeWKB(value)) return key;
		}
		if (typeof value === 'string') {
			if (/^[0-9a-fA-F]+$/.test(value) && value.length >= 10 && looksLikeWKB(value)) return key;
			if (isWKT(value)) return key;
		}
		if (isGeoJSONGeometry(value)) return key;
		if (typeof value === 'string' && value.startsWith('{')) {
			try {
				if (isGeoJSONGeometry(JSON.parse(value))) return key;
			} catch {
				// not JSON
			}
		}
	}

	return null;
```

- [ ] **Step 4: Run the test to verify all pass**

```bash
pnpm --filter @walkthru-earth/objex-utils test -- --run wkb
```
Expected: PASS (3 tests).

- [ ] **Step 5: Quality gate + build**

```bash
pnpm -w run format && pnpm -w run lint:fix && pnpm -w run check
pnpm --filter @walkthru-earth/objex-utils run build
```

- [ ] **Step 6: Commit**

```bash
git add packages/objex-utils/src/wkb.ts packages/objex-utils/src/wkb.test.ts
git commit -m "fix: detect geometry column from first non-null row, not row 0"
```

---

### Task 2.2: Don't select a GeometryCollection-only column as the geometry column

**Files:**
- Modify: `packages/objex-utils/src/wkb.ts` (`looksLikeWKB`, line 330)
- Modify: `packages/objex-utils/src/wkb.test.ts`

Bug: `looksLikeWKB` accepts base type `7` (GeometryCollection), but `parseWKB`/`readGeometry` returns `Unknown`/empty coords for it. So a GeometryCollection BLOB gets picked as the geo column, then every row renders empty with no error. Restricting acceptance to types 1-6 lets detection fall through to a renderable column if one exists.

- [ ] **Step 1: Add a failing test** to `wkb.test.ts`:

```ts
describe('looksLikeWKB type range (via findGeoColumnFromRows)', () => {
	// EWKB GeometryCollection (type 7), little-endian, 0 sub-geometries
	const gc = new Uint8Array([0x01, 0x07, 0x00, 0x00, 0x00, 0, 0, 0, 0]);
	const point = new Uint8Array([
		0x01, 0x01, 0x00, 0x00, 0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
	]);

	it('prefers a renderable Point column over a GeometryCollection column', () => {
		const schema = [
			{ name: 'gc', type: 'BLOB' },
			{ name: 'pt', type: 'BLOB' }
		];
		const rows = [{ gc, pt: point }];
		expect(findGeoColumnFromRows(rows, schema)).toBe('pt');
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @walkthru-earth/objex-utils test -- --run wkb
```
Expected: FAIL — current `looksLikeWKB` accepts type 7, so `gc` (first in schema) is selected.

- [ ] **Step 3: Restrict `looksLikeWKB` to renderable base types (1-6)** — change line 330:

```ts
	// Valid renderable base geometry types are 1–6 (7 = GeometryCollection,
	// which parseWKB returns as Unknown/empty — never select it as the geo column)
	return typeInt >= 1 && typeInt <= 6;
```

- [ ] **Step 4: Run the test + full wkb suite**

```bash
pnpm --filter @walkthru-earth/objex-utils test -- --run wkb
```
Expected: PASS.

- [ ] **Step 5: Quality gate + build + commit**

```bash
pnpm -w run format && pnpm -w run lint:fix && pnpm -w run check
pnpm --filter @walkthru-earth/objex-utils run build
git add packages/objex-utils/src/wkb.ts packages/objex-utils/src/wkb.test.ts
git commit -m "fix: don't select GeometryCollection-only columns for map rendering"
```

---

### Task 2.3: Stop misclassifying a narrow desktop window as a low-memory device

**Files:**
- Modify: `src/lib/query/stac-source-parquet.ts` (`detectLowMemoryDefault`, ~line 479 and its definition)

Bug: the low-memory heuristic uses `Math.min(innerWidth, innerHeight) <= 820`, so a desktop browser resized narrow silently drops `ORDER BY datetime DESC` and caps LIMIT to 200 with no indication. It should gate on the same signal `settings.svelte.ts` uses for the real reason (mobile UA / heap caps), not raw window size.

- [ ] **Step 1: Read the current heuristic**

```bash
grep -n "detectLowMemoryDefault\|820\|innerWidth\|innerHeight" src/lib/query/stac-source-parquet.ts
```
Read the full function body.

- [ ] **Step 2: Make it UA-first, with the window-size check only reinforcing a touch/mobile UA** — replace the size-only test so a wide-or-tall desktop is never classified low-memory:

```ts
function detectLowMemoryDefault(): boolean {
	if (typeof navigator === 'undefined') return false;
	const isMobileUa = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
	if (!isMobileUa) return false; // desktop is never low-memory, regardless of window size
	if (typeof window === 'undefined') return true;
	return Math.min(window.innerWidth, window.innerHeight) <= 820;
}
```

- [ ] **Step 3: Fix the stale doc comment** (it says "at module load" but the function is called per `createParquetSource`). Update the comment to: "Evaluated per source construction so a device that rotates / resizes re-checks."

- [ ] **Step 4: Quality gate**

```bash
pnpm -w run format && pnpm -w run lint:fix && pnpm -w run check
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/query/stac-source-parquet.ts
git commit -m "fix: only treat real mobile UA as low-memory for stac-geoparquet defaults"
```

---

## Phase 3: Performance

### Task 3.1: Make `query()` non-blocking (use `conn.send()` instead of `conn.query()`)

**Files:**
- Modify: `src/lib/query/wasm.ts` (`async query(connId, sql)`, line 656; `conn.query(sql)` at line 674)

Bug: `query(connId, sql)` calls `await conn.query(sql)` (line 674), which blocks the single DuckDB worker for the full query duration, starving every other tab/query. `queryCancellable(connId, sql)` already implements the non-blocking `conn.send()` path and returns the identical `{ columns, types, rowCount, rows }` shape (verified: both build rows the same way and run through `formatDecimal`).

- [ ] **Step 1: Confirm the exact signatures and return shapes**

```bash
grep -n "async query(\|queryCancellable(" src/lib/query/wasm.ts
```
Expected: `async query(connId: string, sql: string): Promise<QueryResult>` (line 656) and `queryCancellable(connId: string, sql: string): QueryHandle` (line 1152). `QueryHandle` is `{ result: Promise<QueryResult>; cancel: () => Promise<boolean> }`. Read both bodies; confirm `query()`'s `{ columns, types, rowCount, rows }` matches what `queryCancellable`'s `result` resolves to (it does — line 1221 returns the same object).

- [ ] **Step 2: Reimplement `query()` to delegate to the non-blocking path** — replace the entire body of `query(connId, sql)` (lines 657-722) with:

```ts
	async query(connId: string, sql: string): Promise<QueryResult> {
		// Delegate to the send()-based path so a data query never blocks the
		// single DuckDB worker (conn.query() is blocking). Same return shape.
		const { result } = this.queryCancellable(connId, sql);
		return result;
	}
```
`queryCancellable` is a synchronous method that kicks off the work and returns the handle immediately; awaiting `result` yields the `QueryResult`. Class methods hoist, so ordering in the file does not matter. `queryCancellable` already wraps errors in its own catch and closes the connection in `finally`, so the old `try/finally` here is no longer needed.

- [ ] **Step 3: Quality gate + check** (no unit harness for the WASM engine; rely on `svelte-check` + manual)

```bash
pnpm -w run format && pnpm -w run lint:fix && pnpm -w run check
```
Expected: pass.

- [ ] **Step 4: Manual smoke** — note for executor: open a Parquet/CSV in TableViewer, run a query, and open a second tab; confirm queries no longer freeze the other tab. Record in commit body.

- [ ] **Step 5: Commit**

```bash
git add src/lib/query/wasm.ts
git commit -m "perf: route query() through non-blocking conn.send() path"
```

---

### Task 3.2: Avoid double-materializing map attributes in TableViewer

**Files:**
- Modify: `src/lib/components/viewers/TableViewer.svelte` (`extractMapData`, ~line 190, and its call sites)

Issue: `extractMapData(rows)` walks every column over all rows (`values = queryRows.map(r => r[col])`) on every page load, sort, page-size change, and custom query — even when `viewMode !== 'map'`. This is O(rows × cols) main-thread copying on top of the already-materialized rows.

- [ ] **Step 1: Read `extractMapData` and all call sites**

```bash
grep -n "extractMapData" src/lib/components/viewers/TableViewer.svelte
```
Read the function (~190) and each caller (~687, 779, 800, 851, 870 per the audit — re-confirm by grep).

- [ ] **Step 2: Gate the work on map mode** — wrap the body so it short-circuits when the map is not active. If `viewMode` is a rune in scope, guard at the top of `extractMapData`:

```ts
	function extractMapData(queryRows: Record<string, unknown>[]) {
		// The map attribute table is only consumed by the map view. Skip the
		// O(rows×cols) walk entirely when the table/info view is showing.
		if (viewMode !== 'map') return null;
		// ... existing extraction unchanged ...
	}
```
Ensure callers already handle a `null` return (they assign to a `$state.raw` that the map layer reads). If a caller assumes a non-null result, set the map-data state to `null` and let the map effect no-op until the user switches to map view. If switching INTO map view must trigger extraction, add a `$effect` that recomputes when `viewMode` becomes `'map'` and map data is `null` — read the existing reactive wiring first and prefer the minimal change.

- [ ] **Step 3: Quality gate + check**

```bash
pnpm -w run format && pnpm -w run lint:fix && pnpm -w run check
```

- [ ] **Step 4: Manual smoke** — note: load a wide geo table, page through in table view (should feel snappier), then switch to map view and confirm features still render. Record in commit body.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/viewers/TableViewer.svelte
git commit -m "perf: skip map-attribute extraction when not in map view"
```

---

### Task 3.3: Bound MultiCogViewer per-asset caches with `LruCache`

**Files:**
- Modify: `src/lib/components/viewers/MultiCogViewer.svelte` (`presignCache` ~line 94, `geotiffCache` ~line 117)

Issue: both are plain `Map`, diverging from the documented memory checklist (per-source caches MUST be `LruCache`-bounded, cap 64, and swept on tile/source unload). Growth is bounded per item today, but it is a latent leak and a contract violation.

- [ ] **Step 1: Read the cache declarations and every read/write/clear**

```bash
grep -n "presignCache\|geotiffCache" src/lib/components/viewers/MultiCogViewer.svelte
```
Confirm the `Map` API used: `.get`, `.set`, `.has`, `.delete`, `.clear`. `LruCache` from `utils/lru.ts` supports `get`/`set`/`has`/`delete`/`clear`.

- [ ] **Step 2: Swap both to `LruCache`** (cap 64, matching `MosaicLayer.maxCacheSize`):

```ts
	import { LruCache } from '@walkthru-earth/objex-utils';
	// ...
	const presignCache = new LruCache<string, string>(64);
	const geotiffCache = new LruCache<string, /* existing value type */>(64);
```
Use the exact value types already declared. If the existing values are `Promise<GeoTIFF>`, keep that type parameter.

- [ ] **Step 3: Confirm cleanup still clears them** — in `cleanup()`/`resetViewer()` keep the `.clear()` calls (LruCache supports `clear`).

- [ ] **Step 4: Quality gate + check**

```bash
pnpm -w run format && pnpm -w run lint:fix && pnpm -w run check
```

- [ ] **Step 5: Manual smoke** — note: open a Sentinel-2 multi-asset STAC item in MultiCogViewer, confirm channels still render and switching bands works. Record in commit body.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/viewers/MultiCogViewer.svelte
git commit -m "perf: bound MultiCogViewer asset caches with LruCache(64)"
```

---

## Phase 4: UI consistency & duplication refactors

These are larger, so each extraction lands behind the quality gate independently. Verify visually after each — there is no component unit harness.

### Task 4.1: Create a shared `ViewerHeader` component

**Files:**
- Create: `src/lib/components/viewers/ViewerHeader.svelte`

The identical title-bar block is duplicated verbatim across ~16 viewers (Image/Pdf/Raw/Model/Markdown/Code/Notebook/Database/StacTab/Media/Archive + TableToolbar).

- [ ] **Step 1: Read two representative headers to capture the canonical markup**

```bash
sed -n '150,160p' src/lib/components/viewers/ImageViewer.svelte
sed -n '175,182p' src/lib/components/viewers/PdfViewer.svelte
```
The canonical block is: a flex row with `border-b border-border px-2 py-1.5 sm:gap-2 sm:px-4`, a truncated `max-w-[120px] text-sm font-medium` title from `tab.name`, and a slot for a badge / actions.

- [ ] **Step 2: Create `ViewerHeader.svelte`** using SEMANTIC tokens (this also resolves the color-token inconsistency for headers):

```svelte
<script lang="ts">
	import type { Tab } from '@walkthru-earth/objex-utils';
	import type { Snippet } from 'svelte';

	let {
		tab,
		badge,
		actions
	}: { tab: Tab; badge?: Snippet; actions?: Snippet } = $props();
</script>

<div class="flex items-center gap-1 border-b border-border px-2 py-1.5 sm:gap-2 sm:px-4">
	<span class="max-w-[120px] truncate text-sm font-medium text-foreground sm:max-w-[200px]">
		{tab.name}
	</span>
	{#if badge}{@render badge()}{/if}
	{#if actions}
		<div class="ml-auto flex items-center gap-1 sm:gap-2">{@render actions()}</div>
	{/if}
</div>
```

- [ ] **Step 3: Quality gate** (component compiles even before adoption)

```bash
pnpm -w run format && pnpm -w run lint:fix && pnpm -w run check
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/viewers/ViewerHeader.svelte
git commit -m "feat: add shared ViewerHeader component"
```

---

### Task 4.2: Create a shared `ViewerStatus` component (loading/error/empty) and fix the two non-i18n strings

**Files:**
- Create: `src/lib/components/viewers/ViewerStatus.svelte`
- Modify: `src/lib/i18n/` (add keys if missing)

Loading state is rendered ~6 different ways; `MediaViewer:86` (`Loading {mediaType}...`) and `MarkdownViewer:239` (`Loading...`) bypass i18n.

- [ ] **Step 1: Confirm/add i18n keys** — check for a generic loading/error key:

```bash
grep -rn "loading\|error" src/lib/i18n/en* | head
```
Ensure `common.loading` and `common.error` (or the project's existing equivalent) exist in both `en` and `ar`. Add them if missing, mirroring the existing key structure.

- [ ] **Step 2: Create `ViewerStatus.svelte`**:

```svelte
<script lang="ts">
	import { t } from '../../i18n/index.svelte.js';
	import { Loader } from '@lucide/svelte'; // match the import style already used by ArchiveViewer

	let {
		kind,
		message
	}: { kind: 'loading' | 'error' | 'empty'; message?: string } = $props();
</script>

<div class="flex h-full items-center justify-center p-4">
	{#if kind === 'loading'}
		<div class="flex items-center gap-2 text-sm text-muted-foreground">
			<Loader class="size-4 animate-spin" />
			<span>{message ?? t('common.loading')}</span>
		</div>
	{:else if kind === 'error'}
		<p class="text-sm text-destructive">{message ?? t('common.error')}</p>
	{:else}
		<p class="text-sm text-muted-foreground">{message}</p>
	{/if}
</div>
```
Verify the lucide import path matches the project's convention (grep an existing viewer that imports `Loader`).

- [ ] **Step 3: Quality gate**

```bash
pnpm -w run format && pnpm -w run lint:fix && pnpm -w run check
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/viewers/ViewerStatus.svelte src/lib/i18n
git commit -m "feat: add shared ViewerStatus component with i18n loading/error"
```

---

### Task 4.3: Adopt `ViewerHeader` + `ViewerStatus` across the simple viewers

**Files:**
- Modify: `ImageViewer.svelte`, `MediaViewer.svelte`, `RawViewer.svelte`, `PdfViewer.svelte`, `ModelViewer.svelte`, `NotebookViewer.svelte`, `CodeViewer.svelte`, `MarkdownViewer.svelte` (and `DatabaseViewer.svelte`, `StacTabViewer.svelte` headers where applicable)

Do these ONE FILE PER STEP so a regression is bisectable. Pattern per file:

- [ ] **Step 1: ImageViewer** — replace the hand-rolled header `<div>` with `<ViewerHeader {tab}>{#snippet badge()}<Badge .../>{/snippet}</ViewerHeader>`, and replace loading/error markup with `<ViewerStatus kind="loading" />` / `<ViewerStatus kind="error" message={error} />`. Import both from `./ViewerHeader.svelte` / `./ViewerStatus.svelte`. Quality gate, then commit `refactor: adopt ViewerHeader/ViewerStatus in ImageViewer`.

- [ ] **Step 2: MediaViewer** — same; replace the hand-rolled `rounded bg-zinc-100 ...` pill with the `<Badge variant="secondary">` snippet, and the non-i18n `Loading {mediaType}...` with `<ViewerStatus kind="loading" message={t('media.loadingType', { type: mediaType })} />` (add that i18n key, or pass a plain `t()` string). Quality gate, commit.

- [ ] **Step 3: RawViewer** — same pattern. Quality gate, commit.
- [ ] **Step 4: PdfViewer** — same pattern. Quality gate, commit.
- [ ] **Step 5: ModelViewer** — same; convert the absolute `bg-zinc-900/80` overlay to `<ViewerStatus kind="loading" />` inside the existing overlay container if the overlay positioning matters; otherwise inline. Quality gate, commit.
- [ ] **Step 6: NotebookViewer** — same pattern. Quality gate, commit.
- [ ] **Step 7: CodeViewer** — header only (keep its own body); replace loading/error. Quality gate, commit.
- [ ] **Step 8: MarkdownViewer** — same; replace the non-i18n `Loading...` with `<ViewerStatus kind="loading" />`. Quality gate, commit.

Each step's quality gate:
```bash
pnpm -w run format && pnpm -w run lint:fix && pnpm -w run check
```
Manual: open each corresponding file type and confirm header + loading/error look right. Record per-commit.

---

### Task 4.4: Route all viewer catches through `handleLoadError` / `isAbortError`

**Files:**
- Modify: the ~15 viewers inlining `err instanceof Error ? err.message : String(err)` and/or `err instanceof DOMException && err.name === 'AbortError'` (CogViewer, MultiCogViewer, StacMosaicViewer, GeoParquetMapViewer, FlatGeobufViewer, ArchiveViewer, ZarrViewer, ZarrMapViewer, PmtilesViewer, DatabaseViewer, MarkdownViewer, PdfViewer)

`handleLoadError` and `isAbortError` (objex-utils) already silence deck.gl's `_SourceError` abort cascade; the inline variants do not.

- [ ] **Step 1: Find every inline error-formatting and abort-guard site**

```bash
grep -rn "instanceof Error ? \|err.name === 'AbortError'\|name === 'AbortError'" src/lib/components/viewers
```

- [ ] **Step 2: Per file, replace the inline catch** — set the error state via `handleLoadError(err)` for terminal errors, and gate early-returns with `isAbortError(err)`:

```ts
import { handleLoadError, isAbortError } from '@walkthru-earth/objex-utils';
// ...
} catch (err) {
	if (isAbortError(err)) return;
	error = handleLoadError(err);
}
```
Read each catch's current behavior first — some set a string, some set an object. `handleLoadError` returns the user-facing message; match the existing `error` state type (if it's `string | null`, this fits). Do one file per commit for bisectability.

- [ ] **Step 3: Quality gate per file + commit**

```bash
pnpm -w run format && pnpm -w run lint:fix && pnpm -w run check
git commit -m "refactor: route <Viewer> errors through handleLoadError/isAbortError"
```

---

### Task 4.5: Extract the duplicated signed-iframe-URL effect

**Files:**
- Create: `src/lib/utils/signed-url-effect.ts`
- Modify: `CopcViewer.svelte:9-24`, `StacMapViewer.svelte:9-20`, `CodeViewer.svelte:125-137`

The identical `$effect` (`let cancelled = false; (async () => { buildHttpsUrlAsync(tab); if (cancelled || id !== tab.id) return; ... })()`) is copy-pasted verbatim 3x.

- [ ] **Step 1: Read all three to confirm they are identical** (only the assigned target differs):

```bash
sed -n '5,28p' src/lib/components/viewers/CopcViewer.svelte
sed -n '5,24p' src/lib/components/viewers/StacMapViewer.svelte
sed -n '120,140p' src/lib/components/viewers/CodeViewer.svelte
```

- [ ] **Step 2: Create `src/lib/utils/signed-url-effect.ts`** — a helper that returns a getter + wires cleanup. Because `$effect` must run inside a component, export a function the component calls in its `<script>`:

```ts
import { buildHttpsUrlAsync } from './url.js';
import type { Tab } from '@walkthru-earth/objex-utils';

/**
 * Resolve a tab's signed HTTPS URL reactively for iframe-style viewers.
 * Call inside a component's $effect; returns a cleanup function.
 * `onResolved` runs only if the tab is still current (guards async race).
 */
export function resolveSignedTabUrl(
	tab: Tab,
	onResolved: (url: string) => void
): () => void {
	let cancelled = false;
	const id = tab.id;
	(async () => {
		const url = await buildHttpsUrlAsync(tab);
		if (cancelled || id !== tab.id) return;
		onResolved(url);
	})();
	return () => {
		cancelled = true;
	};
}
```
Confirm `buildHttpsUrlAsync` is exported from `src/lib/utils/url.ts` (it is per CLAUDE.md). Match its real signature by reading it first.

- [ ] **Step 3: Use it in each viewer** — replace the inline effect with:

```ts
$effect(() => resolveSignedTabUrl(tab, (u) => { signedUrl = u; }));
```
Adjust `signedUrl` to each file's existing state variable name.

- [ ] **Step 4: Quality gate + commit**

```bash
pnpm -w run format && pnpm -w run lint:fix && pnpm -w run check
git add src/lib/utils/signed-url-effect.ts src/lib/components/viewers/CopcViewer.svelte src/lib/components/viewers/StacMapViewer.svelte src/lib/components/viewers/CodeViewer.svelte
git commit -m "refactor: extract shared signed-iframe-URL resolver"
```

---

### Task 4.6: Add the missing cleanup contract to ZarrViewer

**Files:**
- Modify: `src/lib/components/viewers/ZarrViewer.svelte`

Bug/contract gap: ZarrViewer loads heavy zarrita state but is the one routed data viewer missing `tabResources.register(tab.id, cleanup)` and `onDestroy(cleanup)`.

- [ ] **Step 1: Read the component** to find the heavy state it holds (store, arrays, refs) and where load happens.

```bash
sed -n '1,80p' src/lib/components/viewers/ZarrViewer.svelte
```

- [ ] **Step 2: Add a `cleanup()` that nulls the heavy refs** and register it per the standard pattern:

```ts
import { onDestroy } from 'svelte';
import { tabResources } from '../../stores/tab-resources.svelte.js';
// ...inside $effect after kicking off load:
tabResources.register(tab.id, cleanup);
// ...
function cleanup() {
	// null heavy zarrita refs / state here
}
onDestroy(cleanup);
```
Match the exact refs ZarrViewer holds (from Step 1). If it has an `AbortController`, abort it in cleanup too.

- [ ] **Step 3: Quality gate**

```bash
pnpm -w run format && pnpm -w run lint:fix && pnpm -w run check
```

- [ ] **Step 4: Manual smoke** — open a Zarr store, switch tabs/close, confirm no console errors and memory is released. Record in commit body.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/viewers/ZarrViewer.svelte
git commit -m "fix: register cleanup contract in ZarrViewer"
```

---

### Task 4.7: Sweep remaining raw color tokens to semantic tokens

**Files:**
- Modify: viewers still using `text-zinc-*` / `text-red-400` / `border-zinc-*` for the elements NOT already covered by ViewerHeader/ViewerStatus

- [ ] **Step 1: Inventory remaining raw tokens**

```bash
grep -rn "text-red-400\|text-zinc-\|border-zinc-\|bg-zinc-" src/lib/components/viewers | grep -v "ViewerHeader\|ViewerStatus"
```

- [ ] **Step 2: Map each to its semantic equivalent and replace** (do per-file commits):
  - `text-red-400` → `text-destructive`
  - `text-zinc-400` / `text-zinc-500` → `text-muted-foreground`
  - `text-zinc-700 dark:text-zinc-200` → `text-foreground`
  - `border-zinc-200 dark:border-zinc-800` → `border-border`
  - `bg-zinc-100 dark:bg-zinc-800` → `bg-muted`
  Only replace where the semantic token is a faithful match; if a color is deliberately a one-off theme (e.g. MarkdownViewer's GitHub-markdown palette), leave it and note why.

- [ ] **Step 3: Quality gate per file + commit**

```bash
pnpm -w run format && pnpm -w run lint:fix && pnpm -w run check
git commit -m "style: migrate <Viewer> to semantic color tokens"
```

- [ ] **Step 4: Manual smoke** — spot-check 4-5 viewers in both light and dark themes for contrast regressions. Record.

---

## Phase 5: Mobile responsiveness

### Task 5.1: Stack horizontal resizable panes on small screens

**Files:**
- Modify: `src/lib/components/viewers/ZarrViewer.svelte` (~line 483)
- Modify: `src/lib/components/viewers/ArchiveViewer.svelte` (~line 446)
- Modify: `src/lib/components/viewers/pmtiles/PmtilesArchiveView.svelte` (~line 282)

On a 375px screen, `<ResizablePaneGroup direction="horizontal">` forces 2-3 panes into ~125px columns with drag-only handles.

- [ ] **Step 1: Read each PaneGroup usage** to see the pane structure and what the panes contain.

```bash
grep -n "ResizablePaneGroup\|ResizablePane\b\|direction=" src/lib/components/viewers/ZarrViewer.svelte src/lib/components/viewers/ArchiveViewer.svelte src/lib/components/viewers/pmtiles/PmtilesArchiveView.svelte
```

- [ ] **Step 2: Add a mobile fallback** — wrap so that below `sm` the panes render stacked (vertical flex, scrollable) and at `sm+` the resizable horizontal group is used. Minimal approach using a reactive breakpoint already present in the app (`+page.svelte` uses `matchMedia('(min-width: 640px)')` — reuse that pattern or a small `$state` bound to a media query):

```svelte
{#if isWide}
	<ResizablePaneGroup direction="horizontal"> ... </ResizablePaneGroup>
{:else}
	<div class="flex h-full flex-col overflow-y-auto"> <!-- same panes, stacked --> </div>
{/if}
```
Factor the pane contents into local snippets so they are not duplicated between the two branches. If the app already exposes a shared `isMobile`/`isWide` store, use it; otherwise add a tiny media-query `$state` in each file (or a shared `utils` helper if you do all three — DRY).

- [ ] **Step 3: Quality gate per file**

```bash
pnpm -w run format && pnpm -w run lint:fix && pnpm -w run check
```

- [ ] **Step 4: Manual smoke** — note: in a 375px viewport (devtools device mode), open a Zarr store, an archive (zip/tar), and a PMTiles archive; confirm panes stack and are scrollable. Record per commit.

- [ ] **Step 5: Commit (per file)**

```bash
git commit -m "fix: stack <X> resizable panes on small screens"
```

---

### Task 5.2: Make TableGrid column resize work on touch

**Files:**
- Modify: `src/lib/components/viewers/TableGrid.svelte` (`startResize` ~line 80-98, handle `onmousedown` ~line 263)

Bug: resize uses `onmousedown` + `mousemove`/`mouseup` only — dead on touch.

- [ ] **Step 1: Read `startResize` and the handle markup**

```bash
sed -n '78,100p' src/lib/components/viewers/TableGrid.svelte
grep -n "onmousedown\|mousemove\|mouseup" src/lib/components/viewers/TableGrid.svelte
```

- [ ] **Step 2: Convert to Pointer Events** — replace `mousedown/mousemove/mouseup` with `pointerdown/pointermove/pointerup` (pointer events cover mouse, touch, and pen). Use `setPointerCapture` so the drag tracks outside the handle:

```ts
function startResize(e: PointerEvent, colIndex: number) {
	e.preventDefault();
	(e.target as HTMLElement).setPointerCapture?.(e.pointerId);
	const startX = e.clientX;
	const startWidth = /* existing */;
	const onMove = (ev: PointerEvent) => { /* existing width math using ev.clientX */ };
	const onUp = (ev: PointerEvent) => {
		(e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
		window.removeEventListener('pointermove', onMove);
		window.removeEventListener('pointerup', onUp);
	};
	window.addEventListener('pointermove', onMove);
	window.addEventListener('pointerup', onUp);
}
```
Update the handle to `onpointerdown={(e) => startResize(e, i)}`. Keep cleanup symmetric (the existing `removeEventListener` in cleanup must reference the same event names).

- [ ] **Step 3: Widen the touch target** — the handle is `w-1.5`; add an invisible larger hit area (e.g. `before:absolute before:-inset-x-1` or wrap in a `px-1` zone) without changing the visual 1.5px line.

- [ ] **Step 4: Quality gate**

```bash
pnpm -w run format && pnpm -w run lint:fix && pnpm -w run check
```

- [ ] **Step 5: Manual smoke** — note: in devtools touch emulation, drag a column edge and confirm it resizes; confirm mouse still works. Record.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/viewers/TableGrid.svelte
git commit -m "fix: make TableGrid column resize work with pointer/touch events"
```

---

### Task 5.3: Collapse PmtilesTileInspector fixed side panels on mobile

**Files:**
- Modify: `src/lib/components/viewers/pmtiles/PmtilesTileInspector.svelte` (~lines 315, 405; `w-56 ... lg:w-64`)

- [ ] **Step 1: Read the two fixed panels**

```bash
grep -n "w-56\|lg:w-64\|shrink-0" src/lib/components/viewers/pmtiles/PmtilesTileInspector.svelte
```

- [ ] **Step 2: Make them responsive** — below `sm`, either hide behind a toggle or render full-width stacked under the map instead of as a fixed 224px side column. Minimal: change `w-56 shrink-0 ... lg:w-64` to `hidden sm:block sm:w-56 lg:w-64` plus a small toggle button to reveal on mobile, OR move them below the map in a `flex-col` on small screens. Pick the lower-churn option after reading the layout.

- [ ] **Step 3: Quality gate + manual smoke (375px) + commit**

```bash
pnpm -w run format && pnpm -w run lint:fix && pnpm -w run check
git add src/lib/components/viewers/pmtiles/PmtilesTileInspector.svelte
git commit -m "fix: make PmtilesTileInspector panels responsive on mobile"
```

---

### Task 5.4: Touch-friendly TabBar close button and StatusBar overflow

**Files:**
- Modify: `src/lib/components/layout/TabBar.svelte` (~line 63, hover-gated close)
- Modify: `src/lib/components/layout/StatusBar.svelte` (~line 25, non-wrapping row)

- [ ] **Step 1: TabBar** — the close `X` is `opacity-0 group-hover:opacity-100`, invisible on touch. Make it always visible below `sm`:

```svelte
<!-- close button class -->
class="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 ..."
```
Keep the active-tab `opacity-60` behavior at `sm+`.

- [ ] **Step 2: StatusBar** — the single flex row with several `max-w-[…]` truncated segments can clip on narrow screens. Either hide lower-priority segments below `sm` (`hidden sm:flex` on path/count/file-type chips) or add `overflow-x-auto` to the row container. Prefer hiding non-essential segments on mobile; read the row to decide which (connection name + size are essential; path + row-count are droppable).

- [ ] **Step 3: Quality gate + manual smoke (375px) + commit**

```bash
pnpm -w run format && pnpm -w run lint:fix && pnpm -w run check
git add src/lib/components/layout/TabBar.svelte src/lib/components/layout/StatusBar.svelte
git commit -m "fix: touch-visible tab close button and responsive StatusBar"
```

---

## Final verification

### Task 6.1: Full pre-merge check

**Files:** none

- [ ] **Step 1: Full quality gate + tests + both package builds**

```bash
pnpm -w run format && pnpm -w run lint:fix && pnpm -w run check
pnpm --filter @walkthru-earth/objex-utils test -- --run
pnpm -w run package && pnpm --filter @walkthru-earth/objex-utils run build
```
Expected: all pass.

- [ ] **Step 2: Confirm no `$lib/` leaked into dist**

```bash
grep -r '\$lib/' dist/ --include='*.js'
```
Expected: nothing.

- [ ] **Step 3: Add a changeset** (both packages bump together per `fixed` config)

```bash
pnpm changeset
```
Describe the audit remediation (fixes + perf + refactors). Choose the appropriate bump (patch for fixes, minor if the new `isWgs84`/`ViewerHeader`/`ViewerStatus` public exports count as features).

- [ ] **Step 4: Final manual sweep** — in a 375px viewport and a desktop viewport, open one of each major file type (table, COG, Zarr, PMTiles, GeoParquet, STAC, image, pdf) and confirm no regressions. Record results.

- [ ] **Step 5: Commit the changeset**

```bash
git add .changeset
git commit -m "chore: add changeset for audit remediation"
```

---

## Self-review notes (for the executor)

- **Phases are independent**: 1, 2, 3 can ship without 4/5. If time-boxed, do 1-3 first (highest value, lowest risk).
- **TDD applies only to pure utils** (`crs.ts`, `wkb.ts`, `app-config.ts`) — those tasks have real failing-test-first steps. Svelte component tasks use compile (`check`) + manual browser verification, which is the honest ceiling here.
- **Riskiest task is 3.2** (TableViewer map extraction gating) because it touches reactive wiring with many call sites — read the current `$effect`/state graph fully before editing, and prefer the minimal guard.
- **Do not blind-replace** FlatGeobuf's broader CRS set (Task 1.3) — its `isWgs84Geographic` is intentionally wider than the canonical set.
- The deep columnar rewrite of `queryCancellable` (changing `QueryResult.rows` from `Record[]` to columnar) was deliberately NOT included: it ripples through TableGrid, extractMapData, and every consumer. Task 3.1 (non-blocking `query()`) and 3.2 (lazy extraction) capture the high-value, low-risk subset. Flag the columnar rewrite as a future spec if profiling shows the per-row materialization is still the bottleneck.
