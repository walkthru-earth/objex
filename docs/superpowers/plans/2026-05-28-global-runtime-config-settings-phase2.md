# Global Runtime Config Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the two remaining config-only fields, `basemaps`/`defaultBasemap` and `connections`, into the live app so a host can change the basemap list and preloaded buckets from `config.json` (or `?config=<url>`) without a rebuild.

**Architecture:** Phase 1 already loads and merges `config.json` into `appConfig` and exposes a precedence-resolving `settings` store. Phase 2 adds (1) a pure `resolveBasemap()` selector in `objex-utils`, a sparse `basemapId` user override in the settings store, and a basemap picker section in `SettingsSheet`, with `MapContainer` reading the resolved basemap instead of its two hardcoded CartoDB URLs (hardcoded URLs stay as the no-config fallback); and (2) a `loadConfigConnections()` seeding path in `Sidebar` that replaces the single hardcoded `loadDemoConnection()` with iteration over `appConfig.value.connections` (anonymous ones auto-load, private ones save as rows and prompt for credentials through the existing `ensureCredentials` flow), keeping the Source Cooperative demo as the empty-config fallback.

**Tech Stack:** Svelte 5 runes, TypeScript 5, MapLibre GL (vector style URL or raster `StyleSpecification`), vitest (objex-utils only), `@walkthru-earth/objex-utils` pure package.

---

## Background the implementer needs

- `config.json` schema already includes `basemaps`, `defaultBasemap`, and `connections`. They are merged and coerced today (`packages/objex-utils/src/app-config.ts`) but consumed nowhere. The bundled `static/config.json` defines `positron` (vector, light) + `dark-matter` (vector, dark) whose URLs are the exact CartoDB styles `MapContainer` hardcodes, plus one anonymous Source Cooperative connection. So a correctly wired Phase 2 reproduces today's behaviour byte-for-byte from the bundled config.
- `DEFAULT_APP_CONFIG` (the fallback when config fetch/parse fails, status `error`) has `basemaps: []`, `defaultBasemap: {}`, `connections: []`. Phase 2 MUST treat these empty cases as "fall back to the current hardcoded behaviour" so a config failure never blanks the map or the first-run demo bucket.
- `MapContainer.svelte` is the single map host for every map viewer (8 call sites). None pass a `style` prop, so all of them currently render `MAP_STYLES[settings.resolved]`. Changing `MapContainer`'s internal style resolution changes every map viewer at once. The `style` prop (used by no one today) must keep overriding everything when present.
- The settings store keeps a **sparse** `UserSettings` object (only keys the user explicitly changed). A user-picked basemap is such a key.
- Per-file import convention: `.svelte` components under `src/lib/` use the `$lib/...` alias for static imports (svelte-package resolves these); `.ts` store/util files use relative imports. Match the file you are editing. Pure logic goes in `objex-utils` and is imported as `@walkthru-earth/objex-utils`.
- Run from the repo root. Verification commands: `pnpm --filter @walkthru-earth/objex-utils run test`, `pnpm -w run check`, `pnpm -w run format`, `pnpm -w run lint:fix`.

---

## File Structure

- `packages/objex-utils/src/app-config.ts` — add `resolveBasemap()` (pure selector). Modify.
- `packages/objex-utils/src/app-config.test.ts` — add `resolveBasemap` tests. Modify.
- `src/lib/stores/settings.svelte.ts` — add `basemapId` getter + `setBasemap()`, sparse `UserSettings.basemapId`. Modify.
- `src/lib/components/viewers/map/MapContainer.svelte` — resolve basemap from config; build raster style; keep hardcoded fallback. Modify.
- `src/lib/components/layout/SettingsSheet.svelte` — add Map section basemap picker. Modify.
- `src/lib/i18n/en.ts` and `src/lib/i18n/ar.ts` — add `settings.map`, `settings.basemapAuto` keys. Modify.
- `src/lib/components/layout/Sidebar.svelte` — replace `loadDemoConnection()` call with `loadConfigConnections()`; keep `loadDemoConnection()` as fallback. Modify.
- `src/lib/stores/CLAUDE.md`, `packages/objex-utils/CLAUDE.md`, `src/lib/components/CLAUDE.md` — inventory updates. Modify.
- `.changeset/<name>.md` — changeset. Create.

---

## Task 1: Pure `resolveBasemap()` selector in objex-utils

**Files:**
- Modify: `packages/objex-utils/src/app-config.ts`
- Test: `packages/objex-utils/src/app-config.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/objex-utils/src/app-config.test.ts`:

```ts
import { resolveBasemap } from './app-config.js';
import type { AppConfig } from './app-config.js';

function cfgWith(over: Partial<AppConfig>): AppConfig {
	return { ...DEFAULT_APP_CONFIG, ...over };
}

describe('resolveBasemap', () => {
	const positron = { id: 'positron', label: 'Positron', type: 'vector' as const, url: 'p', variant: 'light' as const };
	const dark = { id: 'dark-matter', label: 'Dark Matter', type: 'vector' as const, url: 'd', variant: 'dark' as const };
	const osm = { id: 'osm', label: 'OSM', type: 'raster' as const, url: 'o' };

	it('returns undefined when no basemaps are configured', () => {
		expect(resolveBasemap(DEFAULT_APP_CONFIG, 'light', undefined)).toBeUndefined();
	});

	it('honours an explicit user pick regardless of theme', () => {
		const cfg = cfgWith({ basemaps: [positron, dark, osm], defaultBasemap: { light: 'positron', dark: 'dark-matter' } });
		expect(resolveBasemap(cfg, 'dark', 'osm')).toEqual(osm);
		expect(resolveBasemap(cfg, 'light', 'osm')).toEqual(osm);
	});

	it('ignores a user pick that no longer exists and falls through', () => {
		const cfg = cfgWith({ basemaps: [positron, dark], defaultBasemap: { light: 'positron', dark: 'dark-matter' } });
		expect(resolveBasemap(cfg, 'dark', 'gone')).toEqual(dark);
	});

	it('falls back to defaultBasemap for the variant', () => {
		const cfg = cfgWith({ basemaps: [positron, dark], defaultBasemap: { light: 'positron', dark: 'dark-matter' } });
		expect(resolveBasemap(cfg, 'light', undefined)).toEqual(positron);
		expect(resolveBasemap(cfg, 'dark', undefined)).toEqual(dark);
	});

	it('falls back to first basemap matching the variant when no default set', () => {
		const cfg = cfgWith({ basemaps: [positron, dark], defaultBasemap: {} });
		expect(resolveBasemap(cfg, 'dark', undefined)).toEqual(dark);
	});

	it('falls back to the first basemap when nothing matches the variant', () => {
		const cfg = cfgWith({ basemaps: [osm], defaultBasemap: {} });
		expect(resolveBasemap(cfg, 'light', undefined)).toEqual(osm);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @walkthru-earth/objex-utils run test`
Expected: FAIL with `resolveBasemap is not exported` / `is not a function`.

- [ ] **Step 3: Implement `resolveBasemap`**

Append to `packages/objex-utils/src/app-config.ts` (after `mergeAppConfig`):

```ts
/**
 * Pick the basemap a map should render. Precedence: explicit user pick (when it
 * still exists in the configured list) > the configured default for the theme
 * variant > the first basemap matching the variant > the first basemap of any
 * variant. Returns undefined when no basemaps are configured, signalling the
 * caller to fall back to its hardcoded default.
 */
export function resolveBasemap(
	config: AppConfig,
	variant: 'light' | 'dark',
	userId: string | undefined
): BasemapConfig | undefined {
	const list = config.basemaps;
	if (list.length === 0) return undefined;
	if (userId) {
		const picked = list.find((b) => b.id === userId);
		if (picked) return picked;
	}
	const defaultId = config.defaultBasemap[variant];
	if (defaultId) {
		const byDefault = list.find((b) => b.id === defaultId);
		if (byDefault) return byDefault;
	}
	return list.find((b) => b.variant === variant) ?? list[0];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @walkthru-earth/objex-utils run test`
Expected: PASS (all `resolveBasemap` cases plus the pre-existing suite).

- [ ] **Step 5: Verify the export surfaces from the package index**

Run: `cd packages/objex-utils && grep -n "app-config" src/index.ts`
Expected: `export * from './app-config.js';` (already present, so `resolveBasemap` is re-exported automatically). No edit needed.

- [ ] **Step 6: Commit**

```bash
git add packages/objex-utils/src/app-config.ts packages/objex-utils/src/app-config.test.ts
git commit -m "feat(objex-utils): add resolveBasemap config selector"
```

---

## Task 2: Sparse `basemapId` override in the settings store

**Files:**
- Modify: `src/lib/stores/settings.svelte.ts`

- [ ] **Step 1: Add `basemapId` to the sparse `UserSettings` interface**

In `src/lib/stores/settings.svelte.ts`, extend the interface (after `showFileTree`):

```ts
interface UserSettings {
	theme?: Theme;
	locale?: Locale;
	featureLimit?: number;
	mosaicItemLimit?: number;
	showConnectionRail?: boolean;
	showFileTree?: boolean;
	basemapId?: string;
}
```

- [ ] **Step 2: Add the getter and setter**

In the returned store object, add the getter after `treeLockedByParam` and the setter after `setShowFileTree`:

```ts
		/** The user-picked basemap id, or undefined to follow config/theme defaults. */
		get basemapId(): string | undefined {
			return user.basemapId;
		},
```

```ts
		setBasemap(id: string | undefined) {
			if (id === undefined) {
				const { basemapId: _omit, ...rest } = user;
				user = rest;
			} else {
				user = { ...user, basemapId: id };
			}
			persist();
		},
```

- [ ] **Step 3: Type-check**

Run: `pnpm -w run check`
Expected: PASS (no usages yet; the new members compile).

- [ ] **Step 4: Commit**

```bash
git add src/lib/stores/settings.svelte.ts
git commit -m "feat(settings): add sparse basemapId override and setBasemap"
```

---

## Task 3: Wire `MapContainer` to the resolved basemap

**Files:**
- Modify: `src/lib/components/viewers/map/MapContainer.svelte`

This task changes how the single shared map host picks its style. The hardcoded `MAP_STYLES` constant stays as the fallback for empty/failed config. Style swaps are keyed by a stable string (`basemap id + variant`) so the existing theme-swap `$effect` does not thrash on object identity when a raster `StyleSpecification` object is produced.

- [ ] **Step 1: Add imports**

In the `<script>` block of `src/lib/components/viewers/map/MapContainer.svelte`, after the existing `settings` import (line 6), add:

```ts
import { resolveBasemap } from '@walkthru-earth/objex-utils';
import { appConfig } from '$lib/stores/config.svelte.js';
```

- [ ] **Step 2: Add the style builder and replace the `resolvedStyle` derived**

Replace the single line:

```ts
const resolvedStyle = $derived(style ?? MAP_STYLES[settings.resolved]);
```

with:

```ts
function toMapStyle(
	variant: 'light' | 'dark'
): string | maplibregl.StyleSpecification {
	const bm = resolveBasemap(appConfig.value, variant, settings.basemapId);
	if (!bm) return MAP_STYLES[variant];
	if (bm.type === 'raster') {
		return {
			version: 8,
			sources: {
				'objex-basemap': { type: 'raster', tiles: [bm.url], tileSize: 256 }
			},
			layers: [{ id: 'objex-basemap', type: 'raster', source: 'objex-basemap' }]
		};
	}
	return bm.url;
}

const resolvedBasemap = $derived(
	style ? undefined : resolveBasemap(appConfig.value, settings.resolved, settings.basemapId)
);
const resolvedStyle = $derived(style ?? toMapStyle(settings.resolved));
// Stable identity for style-swap comparison: a raster StyleSpecification is a
// fresh object on every derive, so compare by basemap id + variant instead.
const styleKey = $derived(
	style ? 'custom' : `${resolvedBasemap?.id ?? 'fallback'}:${settings.resolved}`
);
```

- [ ] **Step 3: Track the style key instead of the style value**

Change the swap-state variable. Replace:

```ts
let currentStyleUrl: string | maplibregl.StyleSpecification | null = null;
```

with:

```ts
let currentStyleKey: string | null = null;
```

In `initMap()`, replace:

```ts
	currentStyleUrl = resolvedStyle;
```

with:

```ts
	currentStyleKey = styleKey;
```

Replace the theme/basemap swap `$effect`:

```ts
$effect(() => {
	const newStyle = resolvedStyle;
	if (map && currentStyleUrl !== newStyle && !style) {
		currentStyleUrl = newStyle;
		map.setStyle(newStyle);
	}
});
```

with:

```ts
$effect(() => {
	const nextKey = styleKey;
	const nextStyle = resolvedStyle;
	if (map && currentStyleKey !== nextKey && !style) {
		currentStyleKey = nextKey;
		map.setStyle(nextStyle);
	}
});
```

- [ ] **Step 4: Type-check**

Run: `pnpm -w run check`
Expected: PASS. (`maplibregl.StyleSpecification` is the existing imported type; the raster object literal must satisfy it. If TS complains the `version` literal needs narrowing, change `version: 8` to `version: 8 as const`.)

- [ ] **Step 5: Manual verification (golden path + regression)**

Run: `pnpm -w run dev`, open a map viewer (e.g. a GeoParquet or COG file).
- With the bundled `static/config.json`, the basemap must look identical to before (Positron in light, Dark Matter in dark). Toggle theme and confirm the basemap swaps once, with no flicker loop.
- Temporarily edit `static/config.json` to add a raster basemap, e.g. `{ "id": "osm", "label": "OSM Raster", "type": "raster", "url": "https://tile.openstreetmap.org/{z}/{x}/{y}.png" }`, set `defaultBasemap.light` to `"osm"`, hard-reload, and confirm raster tiles render. Revert the edit afterward.
If you cannot run a browser, say so explicitly rather than claiming success.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/viewers/map/MapContainer.svelte
git commit -m "feat(config): render basemap from config with hardcoded fallback"
```

---

## Task 4: Basemap picker section in `SettingsSheet`

**Files:**
- Modify: `src/lib/components/layout/SettingsSheet.svelte`
- Modify: `src/lib/i18n/en.ts`
- Modify: `src/lib/i18n/ar.ts`

- [ ] **Step 1: Add i18n keys (en)**

In `src/lib/i18n/en.ts`, inside the `// Settings` block, after the line `'settings.interface': 'Interface',` (line 72) add:

```ts
	'settings.map': 'Map',
	'settings.basemapAuto': 'Auto (match theme)',
```

- [ ] **Step 2: Add i18n keys (ar)**

In `src/lib/i18n/ar.ts`, after `'settings.interface': 'الواجهة',` (line 72) add:

```ts
	'settings.map': 'الخريطة',
	'settings.basemapAuto': 'تلقائي (حسب السمة)',
```

- [ ] **Step 3: Render the Map section**

In `src/lib/components/layout/SettingsSheet.svelte`, add a `<section>` immediately after the closing `</section>` of the Language block (the section ending at line 114) and before the Data section. The section renders only when the config provides basemaps:

```svelte
				<!-- Map -->
				{#if appConfig.value.basemaps.length > 0}
					<section class="flex flex-col gap-2">
						<h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
							{t('settings.map')}
						</h3>
						<div class="flex flex-wrap gap-2">
							<button
								class="rounded-md border px-3 py-1.5 text-sm transition-colors {settings.basemapId ===
								undefined
									? 'border-primary bg-primary/10 text-primary'
									: 'border-border text-muted-foreground hover:text-foreground'}"
								onclick={() => settings.setBasemap(undefined)}
							>
								{t('settings.basemapAuto')}
							</button>
							{#each appConfig.value.basemaps as bm (bm.id)}
								<button
									class="rounded-md border px-3 py-1.5 text-sm transition-colors {settings.basemapId ===
									bm.id
										? 'border-primary bg-primary/10 text-primary'
										: 'border-border text-muted-foreground hover:text-foreground'}"
									onclick={() => settings.setBasemap(bm.id)}
								>
									{bm.label}
								</button>
							{/each}
						</div>
					</section>
				{/if}
```

- [ ] **Step 4: Type-check**

Run: `pnpm -w run check`
Expected: PASS. (`settings.basemapId`/`setBasemap` from Task 2, `appConfig.value.basemaps` already imported in the file.)

- [ ] **Step 5: Manual verification**

Run dev, open Settings (gear icon). Confirm the Map section lists "Auto (match theme)" + the configured basemaps, picking one swaps the live map and persists across reload, and "Auto (match theme)" reverts to the theme-driven default. With a config that has no basemaps (temporarily blank the `basemaps` array), the Map section must not render.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/layout/SettingsSheet.svelte src/lib/i18n/en.ts src/lib/i18n/ar.ts
git commit -m "feat(settings): add basemap picker section"
```

---

## Task 5: Config-driven default connections in `Sidebar`

**Files:**
- Modify: `src/lib/components/layout/Sidebar.svelte`

Replaces the single hardcoded demo connection with iteration over `appConfig.value.connections`. Anonymous seeds auto-load and the first one is browsed (matching today's zero-click demo). Private seeds are saved as rows; the user clicking them triggers the existing `ensureCredentials` prompt via `handleBrowseConnection`. When the config has no connections (failed load or a host that cleared them), fall back to the existing `loadDemoConnection()` so first-run behaviour never regresses.

- [ ] **Step 1: Swap the first-run call to the new seeding function**

In `src/lib/components/layout/Sidebar.svelte`, in the first-visit `$effect` (lines 47-55), replace:

```ts
			if (connections.items.length === 0 && !new URL(window.location.href).searchParams.has('url')) {
				await loadDemoConnection();
			}
```

with:

```ts
			if (connections.items.length === 0 && !new URL(window.location.href).searchParams.has('url')) {
				await loadConfigConnections();
			}
```

- [ ] **Step 2: Add `loadConfigConnections()` next to `loadDemoConnection()`**

Immediately before the existing `async function loadDemoConnection()` (line 191), add:

```ts
async function loadConfigConnections() {
	const seeds = appConfig.value.connections;
	if (seeds.length === 0) {
		// No configured connections (e.g. config failed to load): preserve the
		// historic first-run demo bucket so the empty app is never a dead end.
		await loadDemoConnection();
		return;
	}
	let firstAnon: Connection | null = null;
	for (const seed of seeds) {
		const { id } = await connections.save({
			name: seed.name,
			provider: seed.provider,
			endpoint: seed.endpoint ?? '',
			bucket: seed.bucket,
			region: seed.region ?? '',
			anonymous: seed.anonymous ?? false,
			...(seed.authMethod ? { authMethod: seed.authMethod } : {}),
			...(seed.rootPrefix ? { rootPrefix: seed.rootPrefix } : {})
		});
		const conn = connections.getById(id);
		if (conn && conn.anonymous && !firstAnon) firstAnon = conn;
	}
	// Auto-open the first public bucket so the demo flow stays zero-click.
	// Private seeds remain as un-browsed rows; clicking one runs the normal
	// ensureCredentials prompt via handleBrowseConnection.
	if (firstAnon) {
		browser.browse(firstAnon);
		syncUrlParam(firstAnon);
	}
}
```

Leave `loadDemoConnection()` unchanged (now only reached as the empty-config fallback).

- [ ] **Step 3: Type-check**

Run: `pnpm -w run check`
Expected: PASS. (`appConfig` and `Connection` are already imported in `Sidebar.svelte`; `connections.save` takes a `ConnectionConfig` whose required fields are exactly `name/provider/endpoint/bucket/region/anonymous`.)

- [ ] **Step 4: Manual verification**

- Clear localStorage (`localStorage.clear()` in devtools), reload with no `?url=`. With the bundled config, Source Cooperative must auto-load and be browsed exactly as before.
- Add a second public bucket and a private bucket to `static/config.json` connections, clear storage, reload: both extra rows appear in the connection rail, the first anonymous bucket is browsed, and clicking the private row opens the credential dialog. Revert the edit afterward.
- With config status `error` (temporarily point `?config=` at a 404), confirm the demo bucket still loads via the fallback.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/layout/Sidebar.svelte
git commit -m "feat(config): seed default connections from config with demo fallback"
```

---

## Task 6: Update CLAUDE.md inventories

**Files:**
- Modify: `src/lib/stores/CLAUDE.md`
- Modify: `packages/objex-utils/CLAUDE.md`
- Modify: `src/lib/components/CLAUDE.md`

- [ ] **Step 1: settings store inventory**

In `src/lib/stores/CLAUDE.md`, in the `settings.svelte.ts` row, add `basemapId` and `setBasemap` to the listed members (after `treeLockedByParam` / within the setters list). Keep the compact style.

- [ ] **Step 2: objex-utils inventory**

In `packages/objex-utils/CLAUDE.md`, find the `app-config` entry and add `resolveBasemap` to its exported-functions list (alongside `mergeAppConfig`, `resolveSetting`, etc.).

- [ ] **Step 3: components inventory**

In `src/lib/components/CLAUDE.md`, in the `viewers/map/` row (or the MapContainer description), add a short note: MapContainer now resolves its basemap via `resolveBasemap(appConfig, theme, settings.basemapId)` and falls back to the hardcoded CartoDB styles when no basemaps are configured.

- [ ] **Step 4: Commit**

```bash
git add src/lib/stores/CLAUDE.md packages/objex-utils/CLAUDE.md src/lib/components/CLAUDE.md
git commit -m "docs: update CLAUDE.md inventories for Phase 2 basemap + connection wiring"
```

---

## Task 7: Changeset and full verification pass

**Files:**
- Create: `.changeset/<generated-name>.md`

- [ ] **Step 1: Add a changeset**

Run: `pnpm changeset`
Select both packages (they bump together via `fixed` config), choose a `minor` bump, and write a summary like: "Config-driven basemaps and default connections. Hosts can now set the basemap list, default basemap per theme, and preloaded buckets from config.json or ?config=, with a basemap picker in Settings."

- [ ] **Step 2: Full quality gate**

Run, in order:

```bash
pnpm --filter @walkthru-earth/objex-utils run test
pnpm -w run format
pnpm -w run lint:fix
pnpm -w run check
```

Expected: all pass. Fix any issues and re-run before continuing.

- [ ] **Step 3: Package build sanity (publishing surface unchanged in shape)**

Run:

```bash
pnpm -w run package
pnpm --filter @walkthru-earth/objex-utils run build
grep -rn "\$lib/" dist/ --include='*.js' || echo "no \$lib leaks"
```

Expected: both build cleanly; the `$lib` grep finds nothing (the new `MapContainer` static `$lib` import is resolved by svelte-package, so it must not appear in `dist/`).

- [ ] **Step 4: Commit**

```bash
git add .changeset
git commit -m "chore: add changeset for config-driven basemaps and connections"
```

---

## Self-review notes (already applied)

- **Spec coverage:** Phase 2 of the spec lists exactly two items, configurable basemaps wired through `MapContainer` + a basemap picker (Tasks 1, 2, 3, 4) and config-driven default connections replacing `loadDemoConnection()` with public auto-load / private prompt (Task 5). Both covered.
- **Fallback safety:** every empty-config path (no basemaps → hardcoded `MAP_STYLES`; no connections → `loadDemoConnection()`) is explicit so a config `error` status never regresses today's behaviour.
- **Type consistency:** `resolveBasemap(config, variant, userId)` signature is identical across Task 1 (definition/tests), Task 3 (`MapContainer`), and is the only new exported function. `settings.basemapId` (getter) / `settings.setBasemap(id)` (setter) names match across Tasks 2, 3, 4. `ConnectionConfig` required fields used in Task 5 match `src/lib/types.ts`.
- **Style-swap correctness:** the raster path returns a fresh `StyleSpecification` object each derive, which would make a value-equality `$effect` loop; the plan keys the swap on a stable `styleKey` string to prevent it.
