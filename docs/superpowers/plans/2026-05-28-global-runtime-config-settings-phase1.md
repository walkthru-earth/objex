# Global Runtime Config and Settings Panel, Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a runtime `config.json` source of truth and an in-app settings panel so hosts can customize objex without a rebuild, with per-link query-param overrides.

**Architecture:** Pure config types plus merge and precedence helpers live in `@walkthru-earth/objex-utils`. An app-side `config.svelte.ts` store fetches `static/config.json` (or a `?config=<url>` remote file) in `+layout.ts` `load` before mount. `settings.svelte.ts` is refactored to store a sparse user-overrides object and resolve each value as query param then localStorage then config then hardcoded fallback. A new `SettingsSheet.svelte` (gear icon in the sidebar) edits the user overrides. Chrome visibility is gated in `+page.svelte`.

**Tech Stack:** SvelteKit 2 (static adapter, CSR-only), Svelte 5 runes, TypeScript 5, Tailwind 4, bits-ui, pnpm 10 workspace. Pure logic tested with vitest in the objex-utils package.

---

## Testing note (read before starting)

This repo currently has **no test runner** (no vitest, no test files). Verification is `svelte-check` plus manual browser checks. The approved spec calls for unit tests on the precedence resolver and config merge, which are pure functions. Task 1 adds vitest scoped to `packages/objex-utils` so those pure functions can be tested without dragging Svelte component testing into scope. Test files are excluded from the published tarball by the package `files` field.

If you would rather not add a test runner, skip Task 1 and Task 3, move the pure helpers from Task 2 into the package without `.test.ts`, and verify them with a one-off `node` check. Everything else in the plan is unchanged.

UI and store tasks have no automated tests (consistent with the repo). Their verification gate is `pnpm -w run check` plus the manual browser steps stated in each task.

## Precedence (the core invariant)

Effective value resolves first-match-wins in this order.

1. Query parameter (per-link override)
2. localStorage (explicit user edit, sparse, only changed keys)
3. `config.json` (bundled or remote)
4. Hardcoded fallback (current behaviour)

## File structure

Create.

- `packages/objex-utils/src/app-config.ts` — pure `AppConfig` type, defaults, `mergeAppConfig`, `resolveSetting`, value coercers, `parseVisibilityParam`.
- `packages/objex-utils/src/app-config.test.ts` — vitest unit tests for the above.
- `packages/objex-utils/vitest.config.ts` — vitest config.
- `src/lib/stores/config.svelte.ts` — app-side config store, `loadConfig(basePath)`, `appConfig` reactive accessor.
- `src/lib/components/layout/SettingsSheet.svelte` — the settings panel.
- `static/config.json` — bundled default config reproducing current behaviour.

Modify.

- `packages/objex-utils/src/index.ts` — export the new module.
- `packages/objex-utils/package.json` — add vitest devDep and `test` script.
- `src/routes/+layout.ts` — add async `load` awaiting `loadConfig(base)`.
- `src/routes/+layout.svelte` — locale effect also syncs i18n from `settings.locale`.
- `src/lib/stores/settings.svelte.ts` — sparse user overrides plus resolver getters plus new getters and `reset()`.
- `src/lib/utils/url-state.ts` — add `getPanelParam()`.
- `src/lib/components/layout/Sidebar.svelte` — gear icon above `LocaleToggle`, mount `SettingsSheet`, open on `?panel=settings`.
- `src/routes/+page.svelte` — gate connection rail and file tree on `settings.showConnectionRail` / `settings.showFileTree`.
- `src/lib/i18n/en.ts` and `src/lib/i18n/ar.ts` — `settings.*` keys.
- `src/lib/stores/CLAUDE.md`, `packages/objex-utils/CLAUDE.md`, `src/lib/components/CLAUDE.md` — keep inventories accurate.

## Boundary decision (why params are read where they are read)

`url-state.ts` imports `$app/navigation`, which is SvelteKit-only and must not enter publishable store files (`config.svelte.ts`, `settings.svelte.ts`). So:

- `?config=<url>` is read inside `config.svelte.ts` via `window.location`.
- `?sidebar=` and `?tree=` are read inside `settings.svelte.ts` via `window.location`.
- `?panel=settings` is read via a new `getPanelParam()` in `url-state.ts`, consumed by `Sidebar.svelte` (which already imports `url-state.ts`).

This keeps each reader free of cross-module coupling and keeps the two stores publish-safe.

---

### Task 1: Add vitest to the objex-utils package

**Files:**
- Modify: `packages/objex-utils/package.json`
- Create: `packages/objex-utils/vitest.config.ts`

- [ ] **Step 1: Add vitest as a dev dependency**

Run:
```bash
pnpm --filter @walkthru-earth/objex-utils add -D vitest
```
Expected: vitest appears under `devDependencies` in `packages/objex-utils/package.json`.

- [ ] **Step 2: Add a test script**

In `packages/objex-utils/package.json`, add a `test` entry to `scripts` so the block reads:
```json
	"scripts": {
		"build": "tsup && node ../../scripts/verify-objex-utils-bundle.mjs",
		"verify-bundle": "node ../../scripts/verify-objex-utils-bundle.mjs",
		"test": "vitest run"
	},
```

- [ ] **Step 3: Create vitest config**

Create `packages/objex-utils/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts']
	}
});
```

- [ ] **Step 4: Verify the runner boots**

Run:
```bash
pnpm --filter @walkthru-earth/objex-utils test
```
Expected: vitest runs and reports "No test files found" (exit 0 with `vitest run` when none match, or a passing run). This confirms the runner is wired before any tests exist.

- [ ] **Step 5: Commit**
```bash
git add packages/objex-utils/package.json packages/objex-utils/vitest.config.ts pnpm-lock.yaml
git commit -m "chore(objex-utils): add vitest for pure-logic unit tests"
```

---

### Task 2: Pure config types and merge helpers (TDD)

**Files:**
- Create: `packages/objex-utils/src/app-config.ts`
- Test: `packages/objex-utils/src/app-config.test.ts`
- Modify: `packages/objex-utils/src/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/objex-utils/src/app-config.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
	coerceBool,
	coercePositiveInt,
	coerceTheme,
	DEFAULT_APP_CONFIG,
	mergeAppConfig,
	parseVisibilityParam,
	resolveSetting
} from './app-config.js';

describe('resolveSetting', () => {
	it('returns the first defined candidate', () => {
		expect(resolveSetting(undefined, null, 'c', 'd')).toBe('c');
		expect(resolveSetting(false, true)).toBe(false); // false is defined
		expect(resolveSetting(undefined, undefined)).toBeUndefined();
	});
});

describe('parseVisibilityParam', () => {
	it('maps hide/show to booleans, else undefined', () => {
		expect(parseVisibilityParam('hide')).toBe(false);
		expect(parseVisibilityParam('show')).toBe(true);
		expect(parseVisibilityParam('')).toBeUndefined();
		expect(parseVisibilityParam(null)).toBeUndefined();
		expect(parseVisibilityParam('yes')).toBeUndefined();
	});
});

describe('coercers', () => {
	it('coerceTheme accepts only known themes', () => {
		expect(coerceTheme('dark')).toBe('dark');
		expect(coerceTheme('neon')).toBeUndefined();
		expect(coerceTheme(5)).toBeUndefined();
	});
	it('coercePositiveInt floors positive finite numbers', () => {
		expect(coercePositiveInt(10.9)).toBe(10);
		expect(coercePositiveInt(0)).toBeUndefined();
		expect(coercePositiveInt(-3)).toBeUndefined();
		expect(coercePositiveInt('10')).toBeUndefined();
	});
	it('coerceBool accepts only booleans', () => {
		expect(coerceBool(true)).toBe(true);
		expect(coerceBool('true')).toBeUndefined();
	});
});

describe('mergeAppConfig', () => {
	it('returns base unchanged for non-object input', () => {
		expect(mergeAppConfig(DEFAULT_APP_CONFIG, null)).toEqual(DEFAULT_APP_CONFIG);
		expect(mergeAppConfig(DEFAULT_APP_CONFIG, 'nope')).toEqual(DEFAULT_APP_CONFIG);
		expect(mergeAppConfig(DEFAULT_APP_CONFIG, [1, 2])).toEqual(DEFAULT_APP_CONFIG);
	});

	it('applies partial defaults and ignores garbage fields', () => {
		const merged = mergeAppConfig(DEFAULT_APP_CONFIG, {
			defaults: { theme: 'dark', featureLimit: 50, junk: 1 },
			bogus: true
		});
		expect(merged.defaults.theme).toBe('dark');
		expect(merged.defaults.featureLimit).toBe(50);
		expect(merged.defaults.locale).toBe('en'); // untouched
	});

	it('merges ui toggles independently', () => {
		const merged = mergeAppConfig(DEFAULT_APP_CONFIG, {
			ui: { showConnectionRail: false }
		});
		expect(merged.ui.showConnectionRail).toBe(false);
		expect(merged.ui.showFileTree).toBe(true);
		expect(merged.ui.showSettings).toBe(true);
	});

	it('filters basemaps to well-formed entries', () => {
		const merged = mergeAppConfig(DEFAULT_APP_CONFIG, {
			basemaps: [
				{ id: 'a', label: 'A', type: 'vector', url: 'https://x/style.json' },
				{ id: 'bad' }, // dropped, missing url/type/label
				{ id: 'b', label: 'B', type: 'raster', url: 'https://y/{z}/{x}/{y}.png', variant: 'dark' }
			]
		});
		expect(merged.basemaps.map((b) => b.id)).toEqual(['a', 'b']);
		expect(merged.basemaps[1].variant).toBe('dark');
	});

	it('filters connection seeds to entries with name and bucket', () => {
		const merged = mergeAppConfig(DEFAULT_APP_CONFIG, {
			connections: [
				{ name: 'Pub', provider: 's3', bucket: 'b', region: 'us-west-2', anonymous: true },
				{ provider: 's3' } // dropped, missing name and bucket
			]
		});
		expect(merged.connections).toHaveLength(1);
		expect(merged.connections[0].name).toBe('Pub');
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
pnpm --filter @walkthru-earth/objex-utils test
```
Expected: FAIL with a module-resolution error for `./app-config.js` (file does not exist yet).

- [ ] **Step 3: Implement the module**

Create `packages/objex-utils/src/app-config.ts`:
```ts
import type { Theme } from '../../../src/lib/types.js';

/** A basemap option a host can offer. Consumed in Phase 2. */
export interface BasemapConfig {
	id: string;
	label: string;
	type: 'vector' | 'raster';
	url: string;
	variant?: 'light' | 'dark';
}

/** A preloaded connection definition. Never carries secrets. Consumed in Phase 2. */
export interface ConnectionSeed {
	name: string;
	provider: string;
	bucket: string;
	region?: string;
	endpoint?: string;
	anonymous?: boolean;
	authMethod?: 'sigv4' | 'sas-token';
	rootPrefix?: string;
}

export interface AppConfigDefaults {
	theme: Theme;
	locale: string;
	featureLimit: number;
	mosaicItemLimit: number;
}

export interface AppConfigUi {
	showConnectionRail: boolean;
	showFileTree: boolean;
	showSettings: boolean;
}

export interface AppConfig {
	defaults: AppConfigDefaults;
	ui: AppConfigUi;
	basemaps: BasemapConfig[];
	defaultBasemap: { light?: string; dark?: string };
	connections: ConnectionSeed[];
}

/** Hardcoded fallback. Matches current app behaviour when no config is present. */
export const DEFAULT_APP_CONFIG: AppConfig = {
	defaults: { theme: 'system', locale: 'en', featureLimit: 1000, mosaicItemLimit: 2000 },
	ui: { showConnectionRail: true, showFileTree: true, showSettings: true },
	basemaps: [],
	defaultBasemap: {},
	connections: []
};

type JsonObject = Record<string, unknown>;

function asObject(v: unknown): JsonObject | undefined {
	return v && typeof v === 'object' && !Array.isArray(v) ? (v as JsonObject) : undefined;
}

export function coerceTheme(v: unknown): Theme | undefined {
	return v === 'light' || v === 'dark' || v === 'system' ? v : undefined;
}

export function coerceString(v: unknown): string | undefined {
	return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export function coercePositiveInt(v: unknown): number | undefined {
	return typeof v === 'number' && Number.isFinite(v) && v >= 1 ? Math.floor(v) : undefined;
}

export function coerceBool(v: unknown): boolean | undefined {
	return typeof v === 'boolean' ? v : undefined;
}

/** First defined (non-null, non-undefined) candidate wins. Encodes the precedence chain. */
export function resolveSetting<T>(...candidates: (T | null | undefined)[]): T | undefined {
	for (const c of candidates) {
		if (c !== null && c !== undefined) return c;
	}
	return undefined;
}

/** Maps the ?sidebar / ?tree visibility param to a boolean, or undefined when absent or invalid. */
export function parseVisibilityParam(value: string | null): boolean | undefined {
	if (value === 'hide') return false;
	if (value === 'show') return true;
	return undefined;
}

function coerceBasemaps(v: unknown): BasemapConfig[] | undefined {
	if (!Array.isArray(v)) return undefined;
	const out: BasemapConfig[] = [];
	for (const raw of v) {
		const o = asObject(raw);
		if (!o) continue;
		const id = coerceString(o.id);
		const label = coerceString(o.label);
		const url = coerceString(o.url);
		const type = o.type === 'vector' || o.type === 'raster' ? o.type : undefined;
		if (!id || !label || !url || !type) continue;
		const variant = o.variant === 'light' || o.variant === 'dark' ? o.variant : undefined;
		out.push({ id, label, url, type, ...(variant ? { variant } : {}) });
	}
	return out;
}

function coerceConnections(v: unknown): ConnectionSeed[] | undefined {
	if (!Array.isArray(v)) return undefined;
	const out: ConnectionSeed[] = [];
	for (const raw of v) {
		const o = asObject(raw);
		if (!o) continue;
		const name = coerceString(o.name);
		const bucket = coerceString(o.bucket);
		if (!name || !bucket) continue;
		out.push({
			name,
			bucket,
			provider: coerceString(o.provider) ?? 's3',
			...(coerceString(o.region) ? { region: coerceString(o.region) } : {}),
			...(coerceString(o.endpoint) ? { endpoint: coerceString(o.endpoint) } : {}),
			...(coerceBool(o.anonymous) !== undefined ? { anonymous: coerceBool(o.anonymous) } : {}),
			...(o.authMethod === 'sigv4' || o.authMethod === 'sas-token'
				? { authMethod: o.authMethod }
				: {}),
			...(coerceString(o.rootPrefix) ? { rootPrefix: coerceString(o.rootPrefix) } : {})
		});
	}
	return out;
}

/**
 * Merge an untrusted JSON value over a base config, defaults-only.
 * Unknown fields are ignored. Malformed values fall back to the base.
 * Never reads secrets.
 */
export function mergeAppConfig(base: AppConfig, override: unknown): AppConfig {
	const o = asObject(override);
	if (!o) return base;
	const d = asObject(o.defaults) ?? {};
	const u = asObject(o.ui) ?? {};
	const db = asObject(o.defaultBasemap) ?? {};
	return {
		defaults: {
			theme: coerceTheme(d.theme) ?? base.defaults.theme,
			locale: coerceString(d.locale) ?? base.defaults.locale,
			featureLimit: coercePositiveInt(d.featureLimit) ?? base.defaults.featureLimit,
			mosaicItemLimit: coercePositiveInt(d.mosaicItemLimit) ?? base.defaults.mosaicItemLimit
		},
		ui: {
			showConnectionRail: coerceBool(u.showConnectionRail) ?? base.ui.showConnectionRail,
			showFileTree: coerceBool(u.showFileTree) ?? base.ui.showFileTree,
			showSettings: coerceBool(u.showSettings) ?? base.ui.showSettings
		},
		basemaps: coerceBasemaps(o.basemaps) ?? base.basemaps,
		defaultBasemap: {
			light: coerceString(db.light) ?? base.defaultBasemap.light,
			dark: coerceString(db.dark) ?? base.defaultBasemap.dark
		},
		connections: coerceConnections(o.connections) ?? base.connections
	};
}
```

- [ ] **Step 4: Export from the package index**

In `packages/objex-utils/src/index.ts`, add after the `clipboard` export line (keep alphabetical by basename, `app-config` sorts before `channel-composite`). Insert just before the `// Channel composite presets` block:
```ts
// App runtime config (pure types + merge + precedence resolver)
export * from './app-config.js';
```

- [ ] **Step 5: Run tests to verify they pass**

Run:
```bash
pnpm --filter @walkthru-earth/objex-utils test
```
Expected: PASS, all tests green.

- [ ] **Step 6: Build the package to confirm the bundle verifier is happy**

Run:
```bash
pnpm --filter @walkthru-earth/objex-utils run build
```
Expected: tsup builds and `verify-objex-utils-bundle.mjs` reports no forbidden imports (app-config imports only a type, erased at build).

- [ ] **Step 7: Commit**
```bash
git add packages/objex-utils/src/app-config.ts packages/objex-utils/src/app-config.test.ts packages/objex-utils/src/index.ts
git commit -m "feat(objex-utils): add pure AppConfig types, merge, and precedence resolver"
```

---

### Task 3: Bundled default config file

**Files:**
- Create: `static/config.json`

- [ ] **Step 1: Create the bundled config**

Create `static/config.json` reproducing today's behaviour. Basemaps and connections are filled in now so the file format is complete from day one (consumed in Phase 2).
```json
{
  "defaults": {
    "theme": "system",
    "locale": "en",
    "featureLimit": 1000,
    "mosaicItemLimit": 2000
  },
  "ui": {
    "showConnectionRail": true,
    "showFileTree": true,
    "showSettings": true
  },
  "basemaps": [
    { "id": "positron", "label": "Positron", "type": "vector", "url": "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json", "variant": "light" },
    { "id": "dark-matter", "label": "Dark Matter", "type": "vector", "url": "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json", "variant": "dark" }
  ],
  "defaultBasemap": { "light": "positron", "dark": "dark-matter" },
  "connections": [
    { "name": "Source Cooperative", "provider": "s3", "bucket": "us-west-2.opendata.source.coop", "region": "us-west-2", "anonymous": true }
  ]
}
```

- [ ] **Step 2: Verify it is valid JSON**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('static/config.json','utf8')); console.log('ok')"
```
Expected: `ok`

- [ ] **Step 3: Commit**
```bash
git add static/config.json
git commit -m "feat(config): add bundled static/config.json default"
```

---

### Task 4: App-side config store

**Files:**
- Create: `src/lib/stores/config.svelte.ts`

- [ ] **Step 1: Create the store**

Create `src/lib/stores/config.svelte.ts`:
```ts
import { type AppConfig, DEFAULT_APP_CONFIG, mergeAppConfig } from '@walkthru-earth/objex-utils';

export type ConfigStatus = 'pending' | 'bundled' | 'custom' | 'error';

let config = $state.raw<AppConfig>(DEFAULT_APP_CONFIG);
let status = $state<ConfigStatus>('pending');

/** Reactive accessor for the loaded config and its load status. */
export const appConfig = {
	get value(): AppConfig {
		return config;
	},
	get status(): ConfigStatus {
		return status;
	}
};

function readConfigParam(): string | null {
	if (typeof window === 'undefined') return null;
	try {
		return new URL(window.location.href).searchParams.get('config');
	} catch {
		return null;
	}
}

/**
 * Fetch and merge the runtime config. Awaited in +layout.ts `load` so the
 * config is ready before any component mounts. A `?config=<url>` param loads a
 * remote file (status `custom`), otherwise the bundled `static/config.json`
 * (status `bundled`). Any failure falls back to defaults (status `error`) and
 * the app still boots.
 */
export async function loadConfig(basePath: string): Promise<void> {
	const customUrl = readConfigParam();
	const url = customUrl ?? `${basePath}/config.json`;
	try {
		const res = await fetch(url, { headers: { accept: 'application/json' } });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const json: unknown = await res.json();
		config = mergeAppConfig(DEFAULT_APP_CONFIG, json);
		status = customUrl ? 'custom' : 'bundled';
	} catch (err) {
		console.warn('[objex] config load failed, using defaults', err);
		config = DEFAULT_APP_CONFIG;
		status = 'error';
	}
}
```

- [ ] **Step 2: Type-check**

Run:
```bash
pnpm -w run check
```
Expected: no new errors from `config.svelte.ts`. (The store is not yet consumed, so this just confirms it compiles.)

- [ ] **Step 3: Commit**
```bash
git add src/lib/stores/config.svelte.ts
git commit -m "feat(config): add runtime config store with loadConfig"
```

---

### Task 5: Load config before mount

**Files:**
- Modify: `src/routes/+layout.ts`

- [ ] **Step 1: Add the async load**

Replace the entire contents of `src/routes/+layout.ts` with:
```ts
import { base } from '$app/paths';
import { loadConfig } from '$lib/stores/config.svelte.js';

export const prerender = true;
export const ssr = false;

export const load = async () => {
	await loadConfig(base);
	return {};
};
```

- [ ] **Step 2: Type-check**

Run:
```bash
pnpm -w run check
```
Expected: no errors.

- [ ] **Step 3: Manual verification**

Run `pnpm -w run dev`, open the app, and in the browser devtools Network tab confirm a request to `/config.json` (or `<base>/config.json`) returns 200. In the console there should be no config warning.

- [ ] **Step 4: Commit**
```bash
git add src/routes/+layout.ts
git commit -m "feat(config): fetch config in layout load before mount"
```

---

### Task 6: Refactor settings store to resolver getters

**Files:**
- Modify: `src/lib/stores/settings.svelte.ts`

This is the central change. The store keeps a sparse `UserSettings` object (only keys the user changed) and resolves each effective value through the precedence chain. It no longer applies theme/locale to the document at construction. Existing getter and setter names are preserved so current consumers are unaffected.

- [ ] **Step 1: Replace the store implementation**

Replace the entire contents of `src/lib/stores/settings.svelte.ts` with:
```ts
import {
	loadFromStorage,
	parseVisibilityParam,
	persistToStorage,
	resolveSetting
} from '@walkthru-earth/objex-utils';
import { STORAGE_KEYS } from '../constants.js';
import type { Locale } from '../i18n/index.svelte.js';
import type { Theme } from '../types.js';
import { appConfig } from './config.svelte.js';

/** Only keys the user explicitly changed are stored, so config edits still reach untouched keys. */
interface UserSettings {
	theme?: Theme;
	locale?: Locale;
	featureLimit?: number;
	mosaicItemLimit?: number;
	showConnectionRail?: boolean;
	showFileTree?: boolean;
}

function loadUser(): UserSettings {
	return loadFromStorage<UserSettings>(STORAGE_KEYS.SETTINGS, {});
}

export function resolveTheme(theme: Theme): 'light' | 'dark' {
	if (theme !== 'system') return theme;
	if (typeof window === 'undefined') return 'light';
	return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function readVisibilityParam(name: string): boolean | undefined {
	if (typeof window === 'undefined') return undefined;
	try {
		return parseVisibilityParam(new URL(window.location.href).searchParams.get(name));
	} catch {
		return undefined;
	}
}

function createSettingsStore() {
	let user = $state<UserSettings>(loadUser());

	// Query params are static for the session, read once.
	const railParam = readVisibilityParam('sidebar');
	const treeParam = readVisibilityParam('tree');

	function persist() {
		persistToStorage(STORAGE_KEYS.SETTINGS, user);
	}

	function cfg() {
		return appConfig.value;
	}

	function effTheme(): Theme {
		return resolveSetting(user.theme, cfg().defaults.theme, 'system') as Theme;
	}

	return {
		get theme(): Theme {
			return effTheme();
		},
		get resolved(): 'light' | 'dark' {
			return resolveTheme(effTheme());
		},
		get locale(): Locale {
			return resolveSetting(user.locale, cfg().defaults.locale as Locale, 'en') as Locale;
		},
		get featureLimit(): number {
			return resolveSetting(user.featureLimit, cfg().defaults.featureLimit, 1000) as number;
		},
		get mosaicItemLimit(): number {
			return resolveSetting(user.mosaicItemLimit, cfg().defaults.mosaicItemLimit, 2000) as number;
		},
		get showConnectionRail(): boolean {
			return resolveSetting(
				railParam,
				user.showConnectionRail,
				cfg().ui.showConnectionRail,
				true
			) as boolean;
		},
		get showFileTree(): boolean {
			return resolveSetting(treeParam, user.showFileTree, cfg().ui.showFileTree, true) as boolean;
		},
		/** True when a link param is forcing the connection-rail visibility. */
		get railLockedByParam(): boolean {
			return railParam !== undefined;
		},
		/** True when a link param is forcing the file-tree visibility. */
		get treeLockedByParam(): boolean {
			return treeParam !== undefined;
		},
		setTheme(t: Theme) {
			user = { ...user, theme: t };
			persist();
		},
		setLocale(l: Locale) {
			user = { ...user, locale: l };
			persist();
		},
		setFeatureLimit(n: number) {
			user = { ...user, featureLimit: Math.max(1, Math.floor(n)) };
			persist();
		},
		setMosaicItemLimit(n: number) {
			user = { ...user, mosaicItemLimit: Math.max(1, Math.floor(n)) };
			persist();
		},
		setShowConnectionRail(v: boolean) {
			user = { ...user, showConnectionRail: v };
			persist();
		},
		setShowFileTree(v: boolean) {
			user = { ...user, showFileTree: v };
			persist();
		},
		/** Clear all user overrides, reverting every value to config or hardcoded fallback. */
		reset() {
			user = {};
			persist();
		}
	};
}

export const settings = createSettingsStore();
```

- [ ] **Step 2: Type-check**

Run:
```bash
pnpm -w run check
```
Expected: no errors. Existing consumers (`ThemeToggle`, `LocaleToggle`, `TableViewer`, `MapContainer`, `StacMosaicViewer`, etc.) use `theme`, `resolved`, `locale`, `featureLimit`, `mosaicItemLimit`, `setTheme`, `setLocale`, `setFeatureLimit`, `setMosaicItemLimit`, all preserved.

- [ ] **Step 3: Commit**
```bash
git add src/lib/stores/settings.svelte.ts
git commit -m "feat(settings): resolve values through query/localStorage/config/fallback chain"
```

---

### Task 7: Sync i18n locale after config load

The settings store no longer calls `setLocale` at construction. The layout already has an effect that applies dir/lang to the document. Extend it to also push the effective locale into the i18n module so `t()` reflects a config-provided default locale and user changes.

**Files:**
- Modify: `src/routes/+layout.svelte`

- [ ] **Step 1: Update the locale effect**

In `src/routes/+layout.svelte`, change the import on line 5 from:
```ts
import { getDir } from '$lib/i18n/index.svelte.js';
```
to:
```ts
import { getDir, setLocale } from '$lib/i18n/index.svelte.js';
```

Then replace the locale effect (currently lines 33-37):
```ts
// Apply locale dir and lang to html element
$effect(() => {
	const root = document.documentElement;
	root.dir = getDir();
	root.lang = settings.locale;
});
```
with:
```ts
// Sync i18n with the effective (config-aware) locale, then apply dir/lang.
$effect(() => {
	setLocale(settings.locale);
	const root = document.documentElement;
	root.dir = getDir();
	root.lang = settings.locale;
});
```

- [ ] **Step 2: Type-check**

Run:
```bash
pnpm -w run check
```
Expected: no errors.

- [ ] **Step 3: Manual verification**

With `pnpm -w run dev` running, temporarily edit `static/config.json` to set `"locale": "ar"` and `"theme": "dark"`, hard-reload with cleared localStorage (devtools, Application, Clear storage). The app should load in Arabic (RTL) and dark mode. Revert the edit afterward.

- [ ] **Step 4: Commit**
```bash
git add src/routes/+layout.svelte
git commit -m "feat(settings): sync i18n locale from effective settings after config load"
```

---

### Task 8: Add the panel query-param getter

**Files:**
- Modify: `src/lib/utils/url-state.ts`

- [ ] **Step 1: Add the getter**

In `src/lib/utils/url-state.ts`, add after `hasUrlParam()` (after line 170, before `clearUrlState`):
```ts
/**
 * Read the `?panel=` param (e.g. `?panel=settings`) to auto-open a panel on load.
 */
export function getPanelParam(): string | null {
	try {
		return new URL(window.location.href).searchParams.get('panel');
	} catch {
		return null;
	}
}
```

- [ ] **Step 2: Type-check**

Run:
```bash
pnpm -w run check
```
Expected: no errors.

- [ ] **Step 3: Commit**
```bash
git add src/lib/utils/url-state.ts
git commit -m "feat(config): add getPanelParam url-state getter"
```

---

### Task 9: Add settings i18n keys

**Files:**
- Modify: `src/lib/i18n/en.ts`
- Modify: `src/lib/i18n/ar.ts`

- [ ] **Step 1: Add English keys**

In `src/lib/i18n/en.ts`, add this block immediately after the `// Theme` block (after the `'theme.tooltip'` line, around line 64):
```ts
	// Settings
	'settings.title': 'Settings',
	'settings.tooltip': 'Settings',
	'settings.appearance': 'Appearance',
	'settings.language': 'Language',
	'settings.data': 'Data',
	'settings.interface': 'Interface',
	'settings.rowLimit': 'Default row limit',
	'settings.rowLimitHelp': 'Rows loaded per page in the table viewer.',
	'settings.mosaicLimit': 'STAC item limit',
	'settings.mosaicLimitHelp': 'Maximum STAC items loaded into a mosaic.',
	'settings.showConnectionRail': 'Connection sidebar',
	'settings.showFileTree': 'File tree',
	'settings.lockedByLink': 'Controlled by a link parameter',
	'settings.copyConfig': 'Copy config JSON',
	'settings.copied': 'Copied',
	'settings.reset': 'Reset to defaults',
	'settings.customConfig': 'Custom config loaded',
```

- [ ] **Step 2: Add Arabic keys**

In `src/lib/i18n/ar.ts`, add the matching block in the corresponding location (after the theme keys):
```ts
	// Settings
	'settings.title': 'الإعدادات',
	'settings.tooltip': 'الإعدادات',
	'settings.appearance': 'المظهر',
	'settings.language': 'اللغة',
	'settings.data': 'البيانات',
	'settings.interface': 'الواجهة',
	'settings.rowLimit': 'حد الصفوف الافتراضي',
	'settings.rowLimitHelp': 'عدد الصفوف المحملة لكل صفحة في عارض الجدول.',
	'settings.mosaicLimit': 'حد عناصر STAC',
	'settings.mosaicLimitHelp': 'أقصى عدد لعناصر STAC المحملة في الفسيفساء.',
	'settings.showConnectionRail': 'شريط الاتصالات الجانبي',
	'settings.showFileTree': 'شجرة الملفات',
	'settings.lockedByLink': 'يتم التحكم به عبر معامل الرابط',
	'settings.copyConfig': 'نسخ إعدادات JSON',
	'settings.copied': 'تم النسخ',
	'settings.reset': 'إعادة الضبط الافتراضي',
	'settings.customConfig': 'تم تحميل إعدادات مخصصة',
```

- [ ] **Step 3: Type-check**

Run:
```bash
pnpm -w run check
```
Expected: no errors.

- [ ] **Step 4: Commit**
```bash
git add src/lib/i18n/en.ts src/lib/i18n/ar.ts
git commit -m "feat(i18n): add settings panel translation keys"
```

---

### Task 10: Build the settings panel

**Files:**
- Create: `src/lib/components/layout/SettingsSheet.svelte`

This mirrors `AboutSheet.svelte` (bottom sheet). It edits the settings store and exposes Copy config JSON, Reset, and a custom-config indicator. It uses native inputs to avoid depending on UI primitives that may not exist.

- [ ] **Step 1: Create the component**

Create `src/lib/components/layout/SettingsSheet.svelte`:
```svelte
<script lang="ts">
import CheckIcon from '@lucide/svelte/icons/check';
import CopyIcon from '@lucide/svelte/icons/copy';
import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle
} from '$lib/components/ui/sheet/index.js';
import { t } from '$lib/i18n/index.svelte.js';
import { appConfig } from '$lib/stores/config.svelte.js';
import { settings } from '$lib/stores/settings.svelte.js';
import type { Theme } from '$lib/types.js';

interface Props {
	open: boolean;
}

let { open = $bindable(false) }: Props = $props();

const themes: Theme[] = ['light', 'dark', 'system'];

let copied = $state(false);

function buildExportConfig(): string {
	const cfg = appConfig.value;
	const exported = {
		defaults: {
			theme: settings.theme,
			locale: settings.locale,
			featureLimit: settings.featureLimit,
			mosaicItemLimit: settings.mosaicItemLimit
		},
		ui: {
			showConnectionRail: settings.showConnectionRail,
			showFileTree: settings.showFileTree,
			showSettings: cfg.ui.showSettings
		},
		basemaps: cfg.basemaps,
		defaultBasemap: cfg.defaultBasemap,
		connections: cfg.connections
	};
	return JSON.stringify(exported, null, 2);
}

async function copyConfig() {
	await navigator.clipboard.writeText(buildExportConfig());
	copied = true;
	setTimeout(() => (copied = false), 1500);
}
</script>

<Sheet bind:open>
	<SheetContent side="bottom" class="max-h-[85vh] sm:mx-auto sm:max-w-lg sm:rounded-t-lg">
		<SheetHeader>
			<SheetTitle>{t('settings.title')}</SheetTitle>
			<SheetDescription class="sr-only">{t('settings.title')}</SheetDescription>
		</SheetHeader>

		<div class="flex flex-col gap-6 overflow-y-auto px-4 py-6 sm:px-6">
			{#if appConfig.status === 'custom'}
				<div class="rounded-md bg-primary/10 px-3 py-1.5 text-xs text-primary">
					{t('settings.customConfig')}
				</div>
			{/if}

			<!-- Appearance -->
			<section class="flex flex-col gap-2">
				<h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
					{t('settings.appearance')}
				</h3>
				<div class="flex gap-2">
					{#each themes as th}
						<button
							class="flex-1 rounded-md border px-3 py-1.5 text-sm transition-colors {settings.theme === th ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'}"
							onclick={() => settings.setTheme(th)}
						>
							{t(`theme.${th}`)}
						</button>
					{/each}
				</div>
			</section>

			<!-- Language -->
			<section class="flex flex-col gap-2">
				<h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
					{t('settings.language')}
				</h3>
				<div class="flex gap-2">
					<button
						class="flex-1 rounded-md border px-3 py-1.5 text-sm transition-colors {settings.locale === 'en' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'}"
						onclick={() => settings.setLocale('en')}
					>
						English
					</button>
					<button
						class="flex-1 rounded-md border px-3 py-1.5 text-sm transition-colors {settings.locale === 'ar' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'}"
						onclick={() => settings.setLocale('ar')}
					>
						العربية
					</button>
				</div>
			</section>

			<!-- Data -->
			<section class="flex flex-col gap-3">
				<h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
					{t('settings.data')}
				</h3>
				<label class="flex flex-col gap-1 text-sm">
					<span>{t('settings.rowLimit')}</span>
					<input
						type="number"
						min="1"
						class="rounded-md border border-border bg-background px-2 py-1 text-sm"
						value={settings.featureLimit}
						onchange={(e) => settings.setFeatureLimit(Number(e.currentTarget.value))}
					/>
					<span class="text-xs text-muted-foreground">{t('settings.rowLimitHelp')}</span>
				</label>
				<label class="flex flex-col gap-1 text-sm">
					<span>{t('settings.mosaicLimit')}</span>
					<input
						type="number"
						min="1"
						class="rounded-md border border-border bg-background px-2 py-1 text-sm"
						value={settings.mosaicItemLimit}
						onchange={(e) => settings.setMosaicItemLimit(Number(e.currentTarget.value))}
					/>
					<span class="text-xs text-muted-foreground">{t('settings.mosaicLimitHelp')}</span>
				</label>
			</section>

			<!-- Interface -->
			<section class="flex flex-col gap-3">
				<h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
					{t('settings.interface')}
				</h3>
				<label class="flex items-center justify-between gap-2 text-sm">
					<span class="flex flex-col">
						<span>{t('settings.showConnectionRail')}</span>
						{#if settings.railLockedByParam}
							<span class="text-xs text-muted-foreground">{t('settings.lockedByLink')}</span>
						{/if}
					</span>
					<input
						type="checkbox"
						class="size-4"
						disabled={settings.railLockedByParam}
						checked={settings.showConnectionRail}
						onchange={(e) => settings.setShowConnectionRail(e.currentTarget.checked)}
					/>
				</label>
				<label class="flex items-center justify-between gap-2 text-sm">
					<span class="flex flex-col">
						<span>{t('settings.showFileTree')}</span>
						{#if settings.treeLockedByParam}
							<span class="text-xs text-muted-foreground">{t('settings.lockedByLink')}</span>
						{/if}
					</span>
					<input
						type="checkbox"
						class="size-4"
						disabled={settings.treeLockedByParam}
						checked={settings.showFileTree}
						onchange={(e) => settings.setShowFileTree(e.currentTarget.checked)}
					/>
				</label>
			</section>

			<!-- Footer actions -->
			<div class="flex items-center justify-between gap-2 border-t pt-4">
				<button
					class="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
					onclick={() => settings.reset()}
				>
					<RotateCcwIcon class="size-3.5" />
					{t('settings.reset')}
				</button>
				<button
					class="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
					onclick={copyConfig}
				>
					{#if copied}
						<CheckIcon class="size-3.5" />
						{t('settings.copied')}
					{:else}
						<CopyIcon class="size-3.5" />
						{t('settings.copyConfig')}
					{/if}
				</button>
			</div>
		</div>
	</SheetContent>
</Sheet>
```

- [ ] **Step 2: Type-check**

Run:
```bash
pnpm -w run check
```
Expected: no errors. (The component is not yet mounted but must compile.)

- [ ] **Step 3: Commit**
```bash
git add src/lib/components/layout/SettingsSheet.svelte
git commit -m "feat(settings): add SettingsSheet panel"
```

---

### Task 11: Add the gear icon to the sidebar

**Files:**
- Modify: `src/lib/components/layout/Sidebar.svelte`

- [ ] **Step 1: Add imports**

In `src/lib/components/layout/Sidebar.svelte`, add the settings icon import with the other `@lucide/svelte/icons` imports (after line 7):
```ts
import SettingsIcon from '@lucide/svelte/icons/settings';
```
Add the new component and store imports alongside the existing layout imports (after the `import ThemeToggle` line, line 33):
```ts
import SettingsSheet from './SettingsSheet.svelte';
import { appConfig } from '$lib/stores/config.svelte.js';
import { getPanelParam } from '$lib/utils/url-state.js';
```
Note: `clearUrlState` and `syncUrlParam` are already imported from `url-state.js` on line 29. Merge `getPanelParam` into that existing import instead of adding a duplicate line:
```ts
import { clearUrlState, getPanelParam, syncUrlParam } from '$lib/utils/url-state.js';
```

- [ ] **Step 2: Add state and auto-open effect**

After the existing `let aboutOpen = $state(false);` line (line 35), add:
```ts
let settingsOpen = $state(false);

// Open the settings panel on load when ?panel=settings is present.
$effect(() => {
	if (appConfig.value.ui.showSettings && getPanelParam() === 'settings') {
		settingsOpen = true;
	}
});
```

- [ ] **Step 3: Add the gear button above LocaleToggle**

Replace the bottom-actions block (currently lines 360-364):
```svelte
		<!-- Bottom actions -->
		<div class="mt-auto flex flex-col items-center gap-1 pt-2">
			<LocaleToggle />
			<ThemeToggle />
		</div>
```
with:
```svelte
		<!-- Bottom actions -->
		<div class="mt-auto flex flex-col items-center gap-1 pt-2">
			{#if appConfig.value.ui.showSettings}
				<Tooltip>
					<TooltipTrigger>
						<button
							class="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
							onclick={() => { settingsOpen = true; }}
							aria-label={t('settings.tooltip')}
						>
							<SettingsIcon class="size-4" />
						</button>
					</TooltipTrigger>
					<TooltipContent side="right">{t('settings.tooltip')}</TooltipContent>
				</Tooltip>
			{/if}
			<LocaleToggle />
			<ThemeToggle />
		</div>
```

- [ ] **Step 4: Mount the sheet**

After the existing `<AboutSheet bind:open={aboutOpen} />` line (line 368), add:
```svelte
<SettingsSheet bind:open={settingsOpen} />
```

- [ ] **Step 5: Type-check**

Run:
```bash
pnpm -w run check
```
Expected: no errors.

- [ ] **Step 6: Manual verification**

With `pnpm -w run dev` running, confirm a gear icon appears above the language button in the left rail. Click it, the settings panel opens. Change the theme to dark, the app switches and the choice persists across reload. Open `/?panel=settings`, the panel auto-opens on load.

- [ ] **Step 7: Commit**
```bash
git add src/lib/components/layout/Sidebar.svelte
git commit -m "feat(settings): add sidebar gear icon and panel auto-open"
```

---

### Task 12: Gate chrome visibility in the page

**Files:**
- Modify: `src/routes/+page.svelte`

- [ ] **Step 1: Import the settings store**

In `src/routes/+page.svelte`, add with the other store imports (after the `import { connections }` line, line 24):
```ts
import { settings } from '$lib/stores/settings.svelte.js';
```

- [ ] **Step 2: Gate the desktop connection rail and file tree**

Replace the desktop layout block (currently lines 391-419):
```svelte
	{#if isDesktop}
		<!-- Desktop layout: Icon Rail + Stable Flex Layout -->
		<Sidebar />
		<div class="flex flex-1 overflow-hidden">
			{#if desktopSidebarOpen && hasBrowserConnection && browser.activeConnection}
				<div class="h-full w-64 shrink-0 border-e border-zinc-200 xl:w-72 dark:border-zinc-800">
					<FileTreeSidebar connection={browser.activeConnection} initialPath={initialFilePath} />
				</div>
			{/if}
```
with:
```svelte
	{#if isDesktop}
		<!-- Desktop layout: Icon Rail + Stable Flex Layout -->
		{#if settings.showConnectionRail}
			<Sidebar />
		{/if}
		<div class="flex flex-1 overflow-hidden">
			{#if desktopSidebarOpen && hasBrowserConnection && browser.activeConnection && settings.showFileTree}
				<div class="h-full w-64 shrink-0 border-e border-zinc-200 xl:w-72 dark:border-zinc-800">
					<FileTreeSidebar connection={browser.activeConnection} initialPath={initialFilePath} />
				</div>
			{/if}
```

- [ ] **Step 3: Gate the mobile sheet contents**

In the mobile sheet body (currently lines 463-470), replace:
```svelte
				<div class="flex min-h-0 flex-1">
					<Sidebar />
					{#if hasBrowserConnection && browser.activeConnection}
						<div class="flex-1 overflow-hidden">
							<FileTreeSidebar connection={browser.activeConnection} initialPath={initialFilePath} />
						</div>
					{/if}
				</div>
```
with:
```svelte
				<div class="flex min-h-0 flex-1">
					{#if settings.showConnectionRail}
						<Sidebar />
					{/if}
					{#if hasBrowserConnection && browser.activeConnection && settings.showFileTree}
						<div class="flex-1 overflow-hidden">
							<FileTreeSidebar connection={browser.activeConnection} initialPath={initialFilePath} />
						</div>
					{/if}
				</div>
```

- [ ] **Step 4: Type-check**

Run:
```bash
pnpm -w run check
```
Expected: no errors.

- [ ] **Step 5: Manual verification**

With `pnpm -w run dev` running:
- Open `/?url=https://s3.us-west-2.amazonaws.com/us-west-2.opendata.source.coop/&sidebar=hide&tree=hide`. The connection rail and file tree are hidden, the viewer area fills the screen.
- Open `/?tree=hide` only. The rail shows, the file tree stays hidden.
- In the settings panel (when no link param), toggle File tree off and confirm it hides and the choice persists across reload.
- Confirm the Interface toggles in the panel are disabled and show the "Controlled by a link parameter" note when the matching query param is present.

- [ ] **Step 6: Commit**
```bash
git add src/routes/+page.svelte
git commit -m "feat(config): gate connection rail and file tree on settings visibility"
```

---

### Task 13: Update directory CLAUDE.md inventories

**Files:**
- Modify: `src/lib/stores/CLAUDE.md`
- Modify: `packages/objex-utils/CLAUDE.md`
- Modify: `src/lib/components/CLAUDE.md`

- [ ] **Step 1: Update stores/CLAUDE.md**

In `src/lib/stores/CLAUDE.md`, add a row to the file table for the new store and update the settings row exports. Add this row near the top of the table:
```
| `config.svelte.ts` | `appConfig` (`.value`, `.status`), `loadConfig(basePath)`, `ConfigStatus` | +layout.ts, settings.svelte.ts, Sidebar, SettingsSheet |
```
Update the existing `settings.svelte.ts` row to list the new getters:
```
| `settings.svelte.ts` | `settings` (theme, resolved, locale, featureLimit, mosaicItemLimit, showConnectionRail, showFileTree, railLockedByParam, treeLockedByParam, setters + reset) | LocaleToggle, ThemeToggle, SettingsSheet, scroll-area, TableViewer, FlatGeobufViewer, GeoParquetMapViewer, MapContainer, CodeMirrorEditor, StacMosaicViewer, +layout.svelte, +page.svelte |
```
Add to the mermaid graph a node `CFG2[config.svelte.ts]` feeding `SET`:
```
    CFG2[config.svelte.ts] --> SET
```

- [ ] **Step 2: Update objex-utils/CLAUDE.md**

In `packages/objex-utils/CLAUDE.md`, add a bullet to the "Sibling modules" list:
```
- **app-config**: `AppConfig`, `AppConfigDefaults`, `AppConfigUi`, `BasemapConfig`, `ConnectionSeed` (types), `DEFAULT_APP_CONFIG`, `mergeAppConfig()`, `resolveSetting()`, `parseVisibilityParam()`, `coerceTheme()`, `coerceString()`, `coercePositiveInt()`, `coerceBool()`. Pure config schema, defaults-only merge of untrusted JSON, and the first-match-wins precedence resolver. Imports only the `Theme` type from `src/lib/types`.
```

- [ ] **Step 3: Update components/CLAUDE.md**

In `src/lib/components/CLAUDE.md`, in the `layout` subgraph of the mermaid diagram add `SB --> SS[SettingsSheet]`, and update the `layout/` row file count and description to mention the settings panel:
```
    | `layout/` | 9 | Sidebar, tabs, status bar, toggles, about sheet, settings sheet | +page.svelte, +layout.svelte |
```

- [ ] **Step 4: Commit**
```bash
git add src/lib/stores/CLAUDE.md packages/objex-utils/CLAUDE.md src/lib/components/CLAUDE.md
git commit -m "docs: update CLAUDE.md inventories for config store and settings panel"
```

---

### Task 14: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Format, lint, type-check**

Run:
```bash
pnpm -w run format && pnpm -w run lint:fix && pnpm -w run check
```
Expected: all three pass with no errors.

- [ ] **Step 2: Run the package unit tests**

Run:
```bash
pnpm --filter @walkthru-earth/objex-utils test
```
Expected: PASS.

- [ ] **Step 3: Build the package**

Run:
```bash
pnpm --filter @walkthru-earth/objex-utils run build
```
Expected: tsup build and bundle verifier pass.

- [ ] **Step 4: Verify the published lib still builds**

Run:
```bash
pnpm -w run package
```
Expected: `svelte-package` plus `publint` succeed. Then confirm no `$lib` leaked into the dist for the new files:
```bash
grep -r '\$lib/' dist/ --include='*.js' | grep -E 'config|settings' || echo "clean"
```
Expected: `clean` (the new store files use relative and package imports, no `$lib`).

- [ ] **Step 5: Manual smoke test of the golden paths**

With `pnpm -w run dev` running, verify in the browser:
1. Default load works (demo connection, basemap, theme) exactly as before.
2. Gear icon opens the panel, theme/language/limits change and persist across reload.
3. Copy config JSON copies a valid config that, when written to `static/config.json`, reproduces the current state.
4. Reset to defaults clears overrides.
5. `?sidebar=hide&tree=hide` produces a viewer-only layout, the panel toggles show the locked-by-link note.
6. `?config=<url>` pointing at a copy of `static/config.json` served elsewhere loads and shows the "Custom config loaded" badge. A malformed remote config falls back to defaults with a single console warning and the app still boots.

- [ ] **Step 6: Final commit if any formatting changes were applied**
```bash
git add -A
git commit -m "chore: formatting pass for config + settings feature"
```

- [ ] **Step 7: Add a changeset**

Run `pnpm changeset`, choose a minor bump for both packages, and describe the feature: runtime config.json plus settings panel with query-param overrides.
```bash
git add .changeset
git commit -m "chore: add changeset for runtime config + settings panel"
```

---

## Self-review

**Spec coverage.**
- Runtime config.json loaded at boot, Tasks 3, 4, 5.
- Remote `?config=<url>` with defaults-only merge, no secrets, custom indicator, Tasks 2, 4, 10.
- Precedence query then localStorage then config then fallback, Tasks 2, 6.
- Sparse localStorage so config edits reach untouched keys, Task 6.
- Settings panel with Appearance, Language, Data, Interface, Copy config JSON, Reset, custom indicator, Task 10.
- Gear icon above the language button, gated by `showSettings`, `?panel=settings` auto-open, Task 11.
- Individual query params `?sidebar`, `?tree`, `?panel`, `?config`, Tasks 4, 6, 8.
- Chrome visibility gating for connection rail and file tree, Task 12.
- Theme, language, query-limit wired through the panel, Tasks 6, 10.
- Security, no secrets in config, untrusted-defaults merge, no eval, Tasks 2, 4.
- Phase 2 fields (basemaps, connections) present in the schema but not wired to consumers, Tasks 2, 3 (consumers deferred to Phase 2 by design).
- Testing, unit tests for resolver and merge, Tasks 1, 2, manual checks throughout, Task 14.

**Placeholder scan.** No TBD, TODO, or "implement later". Every code step shows complete code. The only deferred items are Phase 2 consumers, which are explicitly out of scope per the approved phasing decision.

**Type consistency.** `AppConfig`, `appConfig.value`, `appConfig.status`, `loadConfig(basePath)`, `mergeAppConfig`, `resolveSetting`, `parseVisibilityParam` are used identically across Tasks 2, 4, 6, 10. Settings getter and setter names (`theme`, `resolved`, `locale`, `featureLimit`, `mosaicItemLimit`, `showConnectionRail`, `showFileTree`, `railLockedByParam`, `treeLockedByParam`, `setTheme`, `setLocale`, `setFeatureLimit`, `setMosaicItemLimit`, `setShowConnectionRail`, `setShowFileTree`, `reset`) match between Task 6 (definition) and Tasks 10, 11, 12 (consumers). `getPanelParam` matches between Task 8 (definition) and Task 11 (consumer).
