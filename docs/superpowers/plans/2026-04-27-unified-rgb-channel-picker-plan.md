# Unified RGB Channel Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three-way bifurcated RGB UI (`CogViewer` / `MultiCogViewer` / `StacMosaicViewer`) with one shared `[Asset ▾][Band ▾]` picker per channel, with a presets dropdown that auto-defaults to the most natural and most performant composite.

**Architecture:** Two new pure-TS modules (`utils/cog-asset.ts`, `utils/channel-composite.ts`) own the data model and the URL/preset state machine. One Svelte component (`viewers/cog/ChannelPicker.svelte`) owns the row. One TS helper (`viewers/cog/buildRgbLayer.ts`) dispatches to `COGLayer` (when all three channels point to the same asset) or `MultiCOGLayer` (when they don't). `CogControls` collapses to one prop shape. The mosaic gains true multi-asset compositing by switching to a per-item `MultiCOGLayer` set when the composite spans >1 asset, while keeping the fast `MosaicLayer` path for the single-asset case.

**Tech Stack:** SvelteKit 2 (Svelte 5 runes, TypeScript 5, Tailwind CSS 4), Biome (tabs, single quotes, semicolons, 100 char width), pnpm 10. Verification gates are `pnpm -w run check` (svelte-check), `pnpm -w run lint:fix`, `pnpm -w run format`. **There is no test runner in this project**, manual exercise on the dev server is the functional gate, type and lint checks are the static gate. Every task ends with both gates green and a commit.

**Reference spec:** `docs/superpowers/specs/2026-04-27-unified-rgb-channel-picker-design.md`

---

## File map

**Create:**
- `src/lib/utils/cog-asset.ts` — pure TS, `CogAsset`, `extractCogAssets`, `pickNaturalColorComposite`, `syntheticSelfAsset`, `isSingleAssetComposite`, `allChannelsBand0`
- `src/lib/utils/channel-composite.ts` — pure TS, `ChannelRef`, `ChannelComposite`, `PresetDef`, `PRESETS`, `availablePresets`, `applyPreset`, `compositeFromUrl`, `compositeToUrl`, `presetMatchesComposite`
- `src/lib/components/viewers/cog/ChannelPicker.svelte` — one row, two dropdowns
- `src/lib/components/viewers/cog/buildRgbLayer.ts` — `COGLayer` ↔ `MultiCOGLayer` dispatch helper

**Modify:**
- `src/lib/components/viewers/CogControls.svelte` — collapse discriminated union, render preset + 3 ChannelPicker rows (RGB) or single-band branch
- `src/lib/components/viewers/CogViewer.svelte` — synthesize `self` asset, drive picker via `ChannelComposite`
- `src/lib/components/viewers/MultiCogViewer.svelte` — drop owned PRESETS / setPreset / setChannel / syncCompositeToUrl, switch to shared modules
- `src/lib/components/viewers/StacMosaicViewer.svelte` — replace asset-picker header with ChannelPicker rows, dispatch single-asset → `MosaicLayer` and multi-asset → per-item `MultiCOGLayer` set
- `src/lib/utils/stac.ts` — keep `extractRasterBandAssets` / `extractMosaicAssets` as wrappers over `extractCogAssets`
- `src/lib/i18n/en.ts`, `src/lib/i18n/ar.ts` — new keys for the picker UI
- `src/lib/components/viewers/CLAUDE.md`, `src/lib/utils/CLAUDE.md` — directory docs (mermaid + file table)
- `src/lib/index.ts`, `packages/objex-utils/src/index.ts` — export new public types from `cog-asset.ts` and `channel-composite.ts`

---

## Conventions

- Biome: tabs, single quotes, semicolons, 100 char width.
- All files under `src/lib/` use **relative imports** (`../../utils/...`), never `$lib/...` (the library is published; `$lib` breaks dynamic imports in `dist/`).
- Pure-TS modules in `src/lib/utils/` MUST be Svelte-free and import only from other pure-TS files. `cog-asset.ts` and `channel-composite.ts` are publishable through `objex-utils`.
- All `$effect` callbacks return cleanup functions and read all reactive deps **before** any early-return guard (the gotcha documented in `viewers/CLAUDE.md`).
- Every viewer registers cleanup via `tabResources.register(tab.id, cleanup)` AND `onDestroy(cleanup)`.
- Commit after every task. Use `feat:` / `refactor:` / `docs:` prefixes consistent with existing history.

---

## Task 1: Add `CogAsset` data model

**Files:**
- Create: `src/lib/utils/cog-asset.ts`

- [ ] **Step 1: Write the module**

```ts
/**
 * Generic per-channel asset descriptor for the unified RGB picker.
 *
 * Pure TypeScript. No Svelte dependency. Publishable via objex-utils.
 *
 * `CogAsset` is the canonical shape every viewer (CogViewer, MultiCogViewer,
 * StacMosaicViewer) hands to the shared ChannelPicker UI. Each entry records
 * the STAC asset key (`red`, `B04`, `image`, `visual`, ... or `self` when the
 * viewer is a single bare COG file with no STAC context), the href, the band
 * count (from `raster:bands.length` when STAC populates it, lazily probed from
 * the COG header otherwise), and the optional `eo:bands` common name.
 */

import type { StacItem } from './stac.js';

export interface CogAsset {
	/** STAC asset key, or `self` for a single bare COG without STAC context. */
	key: string;
	/** Absolute or relative href as it appears in the STAC item / URL. */
	href: string;
	/** Number of bands in the asset. 1 by default until probed. */
	bandCount: number;
	/** True when bandCount came from STAC metadata or a probe; false → trust default. */
	bandCountKnown: boolean;
	/** `raster:bands[0].data_type` if known. */
	dtype?: string;
	/** `eo:bands[].common_name` lowercased, aligned to bandIndex order. */
	eoCommon: string[];
	/** STAC asset roles (`data`, `visual`, `reflectance`, ...). */
	roles: string[];
	/** Optional human title. */
	title?: string;
	/** Asset media_type as advertised by STAC. */
	mediaType?: string;
}

/** Per-channel pixel coordinate inside a STAC item. */
export interface ChannelRef {
	assetKey: string;
	bandIndex: number;
}

/** RGB(A) composite expressed as `(asset, bandIndex)` per channel. */
export interface ChannelComposite {
	r: ChannelRef;
	g: ChannelRef;
	b: ChannelRef;
	a?: ChannelRef;
}

const TIFF_MEDIA = /^image\/(tiff|geotiff)\b/i;
const NON_DATA_ROLES = new Set(['thumbnail', 'overview', 'metadata']);

/**
 * Enumerate every TIFF/COG asset on a STAC Item, keeping multi-band assets
 * (NAIP `image`, S2 `visual` TCI) alongside single-band per-band assets.
 *
 * Reads `raster:bands.length` and `eo:bands[].common_name` for band metadata
 * without making any network requests. When `raster:bands` is present,
 * `bandCount` is `length` and `bandCountKnown` is true. When absent, falls
 * back to `eo:bands.length`. When neither is present, defaults to 1 with
 * `bandCountKnown: false` so callers can lazily probe on first pick.
 */
export function extractCogAssets(item: StacItem): CogAsset[] {
	const out: CogAsset[] = [];
	const assets = item.assets ?? {};
	for (const [key, asset] of Object.entries(assets)) {
		if (!asset?.href) continue;
		const mediaType = typeof asset.type === 'string' ? asset.type : undefined;
		if (mediaType && !TIFF_MEDIA.test(mediaType)) continue;
		const roles = Array.isArray(asset.roles) ? (asset.roles as string[]) : [];
		if (roles.some((r) => NON_DATA_ROLES.has(r))) continue;
		const eoBands = Array.isArray(asset['eo:bands']) ? asset['eo:bands'] : undefined;
		const assetExt = asset as unknown as Record<string, unknown>;
		const rasterBands = Array.isArray(assetExt['raster:bands'])
			? (assetExt['raster:bands'] as Array<Record<string, unknown>>)
			: undefined;
		const bandCount = rasterBands?.length ?? eoBands?.length;
		const bandCountKnown = typeof bandCount === 'number' && bandCount > 0;
		const eoCommon = (eoBands ?? []).map((b) => {
			const c = b?.common_name;
			return typeof c === 'string' ? c.toLowerCase() : '';
		});
		const dtype = rasterBands?.[0]?.data_type;
		out.push({
			key,
			href: asset.href,
			bandCount: bandCountKnown ? (bandCount as number) : 1,
			bandCountKnown,
			dtype: typeof dtype === 'string' ? dtype : undefined,
			eoCommon,
			roles,
			title: typeof asset.title === 'string' ? asset.title : undefined,
			mediaType
		});
	}
	return out;
}

/**
 * For `CogViewer` (single bare COG file, no STAC context). Returns one synthetic
 * asset with key `self` so the same ChannelPicker UI works without special-casing.
 * `bandCount` defaults to 1, set to the probed `geotiff.count` once known.
 */
export function syntheticSelfAsset(href: string, probedBandCount?: number): CogAsset {
	const known = typeof probedBandCount === 'number' && probedBandCount > 0;
	return {
		key: 'self',
		href,
		bandCount: known ? probedBandCount : 1,
		bandCountKnown: known,
		eoCommon: [],
		roles: []
	};
}

/**
 * Pick the most natural and most performant default composite for an item.
 *
 * Priority (first match wins):
 *   1. A 3-band uint8 pre-baked visual asset (`visual` / `image` / `tci` etc):
 *      all three channels bind to it, bands 0/1/2. Single COGLayer path,
 *      one decoder, fastest.
 *   2. Common-name red/green/blue resolvable across separate single-band assets.
 *      MultiCOGLayer path.
 *   3. Fallback: first three raster assets, band 0 each.
 *
 * Returns null when no raster assets exist.
 */
export function pickNaturalColorComposite(
	assets: CogAsset[]
): { composite: ChannelComposite; source: 'visual-asset' | 'rgb-bands' | 'fallback' } | null {
	if (assets.length === 0) return null;

	// 1. Pre-baked visual: bandCount === 3 AND eoCommon ⊇ {red,green,blue} OR roles ∋ visual
	for (const a of assets) {
		if (a.bandCount === 3 && (a.roles.includes('visual') || hasRgbInEoCommon(a.eoCommon))) {
			return {
				composite: {
					r: { assetKey: a.key, bandIndex: indexOfCommon(a.eoCommon, 'red', 0) },
					g: { assetKey: a.key, bandIndex: indexOfCommon(a.eoCommon, 'green', 1) },
					b: { assetKey: a.key, bandIndex: indexOfCommon(a.eoCommon, 'blue', 2) }
				},
				source: 'visual-asset'
			};
		}
	}

	// 2. Separate red/green/blue assets by common-name
	const red = assets.find((a) => a.eoCommon[0] === 'red');
	const green = assets.find((a) => a.eoCommon[0] === 'green');
	const blue = assets.find((a) => a.eoCommon[0] === 'blue');
	if (red && green && blue) {
		return {
			composite: {
				r: { assetKey: red.key, bandIndex: 0 },
				g: { assetKey: green.key, bandIndex: 0 },
				b: { assetKey: blue.key, bandIndex: 0 }
			},
			source: 'rgb-bands'
		};
	}

	// 3. Fallback: first three raster assets
	if (assets.length >= 3) {
		return {
			composite: {
				r: { assetKey: assets[0].key, bandIndex: 0 },
				g: { assetKey: assets[1].key, bandIndex: 0 },
				b: { assetKey: assets[2].key, bandIndex: 0 }
			},
			source: 'fallback'
		};
	}

	// Single asset (e.g. CogViewer with a 1-band file): R/G/B all on band 0
	const only = assets[0];
	const last = Math.max(0, only.bandCount - 1);
	return {
		composite: {
			r: { assetKey: only.key, bandIndex: 0 },
			g: { assetKey: only.key, bandIndex: Math.min(1, last) },
			b: { assetKey: only.key, bandIndex: Math.min(2, last) }
		},
		source: 'fallback'
	};
}

function hasRgbInEoCommon(eo: string[]): boolean {
	return eo.includes('red') && eo.includes('green') && eo.includes('blue');
}

function indexOfCommon(eo: string[], name: string, fallback: number): number {
	const i = eo.indexOf(name);
	return i >= 0 ? i : fallback;
}

/** True when all three RGB channels target the same asset key. */
export function isSingleAssetComposite(c: ChannelComposite): boolean {
	return c.r.assetKey === c.g.assetKey && c.g.assetKey === c.b.assetKey;
}

/** True when all three channels are at band index 0 (the MultiCOGLayer-compatible case). */
export function allChannelsBand0(c: ChannelComposite): boolean {
	return c.r.bandIndex === 0 && c.g.bandIndex === 0 && c.b.bandIndex === 0;
}
```

- [ ] **Step 2: Run check**

Run: `pnpm -w run check`
Expected: PASS (no new errors).

- [ ] **Step 3: Run lint + format**

Run: `pnpm -w run format && pnpm -w run lint:fix`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/utils/cog-asset.ts
git commit -m "feat(utils): add CogAsset model + pickNaturalColorComposite

Pure-TS data model for the unified RGB channel picker. Reads
raster:bands and eo:bands without making network calls; defaults
to bandCount=1 with bandCountKnown=false when STAC metadata is
absent so callers can lazy-probe."
```

---

## Task 2: Add channel composite + preset module

**Files:**
- Create: `src/lib/utils/channel-composite.ts`

- [ ] **Step 1: Write the module**

```ts
/**
 * Preset definitions, URL round-trip, and preset application for the unified
 * RGB picker. Pure TypeScript, publishable via objex-utils.
 *
 * Presets describe a SEMANTIC band slot triple (`red`/`green`/`blue` for
 * Natural Color, `nir`/`red`/`green` for False-Color IR, ...). Resolving a
 * preset against a specific item walks `BAND_KEY_FALLBACKS` in `utils/stac.ts`
 * to map slots to actual asset keys on that item. NDVI and other single-band
 * derived presets are intentionally NOT in this list for this slice.
 */

import type { CogAsset, ChannelComposite } from './cog-asset.js';
import {
	type BandSlot,
	type RasterBandAsset,
	resolvePresetComposite
} from './stac.js';

export interface PresetDef {
	id: string;
	labelKey: string;
	slots: { r: BandSlot; g: BandSlot; b: BandSlot };
}

export const PRESETS: PresetDef[] = [
	{
		id: 'natural-color',
		labelKey: 'map.multiCogPreset.trueColor',
		slots: { r: 'red', g: 'green', b: 'blue' }
	},
	{
		id: 'false-color-ir',
		labelKey: 'map.multiCogPreset.falseColorIR',
		slots: { r: 'nir', g: 'red', b: 'green' }
	},
	{
		id: 'swir',
		labelKey: 'map.multiCogPreset.swir',
		slots: { r: 'swir2', g: 'swir1', b: 'red' }
	},
	{
		id: 'vegetation',
		labelKey: 'map.multiCogPreset.vegetation',
		slots: { r: 'nir', g: 'swir1', b: 'red' }
	},
	{
		id: 'agriculture',
		labelKey: 'map.multiCogPreset.agriculture',
		slots: { r: 'swir1', g: 'nir', b: 'blue' }
	}
];

function toRasterBandAssets(assets: CogAsset[]): RasterBandAsset[] {
	return assets.map((a) => ({
		key: a.key,
		href: a.href,
		commonName: a.eoCommon[0],
		bandCount: a.bandCount,
		roles: a.roles,
		mediaType: a.mediaType,
		title: a.title
	}));
}

/** Subset of PRESETS whose slot triple resolves on this item. */
export function availablePresets(assets: CogAsset[]): PresetDef[] {
	const rba = toRasterBandAssets(assets);
	return PRESETS.filter((p) => resolvePresetComposite(rba, p.slots) !== null);
}

/** Resolve a preset to a ChannelComposite for this item. Returns null when not applicable. */
export function applyPreset(assets: CogAsset[], preset: PresetDef): ChannelComposite | null {
	const rba = toRasterBandAssets(assets);
	const r = resolvePresetComposite(rba, preset.slots);
	if (!r) return null;
	return {
		r: { assetKey: r.r, bandIndex: 0 },
		g: { assetKey: r.g, bandIndex: 0 },
		b: { assetKey: r.b, bandIndex: 0 }
	};
}

/** True when the preset's resolved composite still matches the user's current picks. */
export function presetMatchesComposite(
	preset: PresetDef,
	c: ChannelComposite,
	assets: CogAsset[]
): boolean {
	const resolved = applyPreset(assets, preset);
	if (!resolved) return false;
	return (
		resolved.r.assetKey === c.r.assetKey &&
		resolved.g.assetKey === c.g.assetKey &&
		resolved.b.assetKey === c.b.assetKey &&
		c.r.bandIndex === 0 &&
		c.g.bandIndex === 0 &&
		c.b.bandIndex === 0
	);
}

/**
 * Decode a `URLSearchParams` chunk into a ChannelComposite.
 *
 * Format: `r=<asset>&g=<asset>&b=<asset>&band_r=<n>&band_g=<n>&band_b=<n>` plus
 * optional `a=<asset>&band_a=<n>`. `band_*` defaults to 0 when absent so
 * legacy MultiCog URLs (`?r=red&g=green&b=blue&preset=true-color`) keep
 * round-tripping. Returns null when any required asset key is missing from
 * the current item's asset list.
 */
export function compositeFromUrl(
	params: URLSearchParams,
	assets: CogAsset[]
): ChannelComposite | null {
	const r = params.get('r');
	const g = params.get('g');
	const b = params.get('b');
	if (!r || !g || !b) return null;
	const known = new Map(assets.map((a) => [a.key, a]));
	const ra = known.get(r);
	const ga = known.get(g);
	const ba = known.get(b);
	if (!ra || !ga || !ba) return null;
	const out: ChannelComposite = {
		r: { assetKey: r, bandIndex: clampBand(params.get('band_r'), ra.bandCount) },
		g: { assetKey: g, bandIndex: clampBand(params.get('band_g'), ga.bandCount) },
		b: { assetKey: b, bandIndex: clampBand(params.get('band_b'), ba.bandCount) }
	};
	const a = params.get('a');
	if (a) {
		const aa = known.get(a);
		if (aa) out.a = { assetKey: a, bandIndex: clampBand(params.get('band_a'), aa.bandCount) };
	}
	return out;
}

/** Encode a composite + active preset id into URLSearchParams for the hash. */
export function compositeToUrl(c: ChannelComposite, presetId: string | null): URLSearchParams {
	const p = new URLSearchParams();
	p.set('r', c.r.assetKey);
	p.set('g', c.g.assetKey);
	p.set('b', c.b.assetKey);
	if (c.r.bandIndex !== 0) p.set('band_r', String(c.r.bandIndex));
	if (c.g.bandIndex !== 0) p.set('band_g', String(c.g.bandIndex));
	if (c.b.bandIndex !== 0) p.set('band_b', String(c.b.bandIndex));
	if (c.a) {
		p.set('a', c.a.assetKey);
		if (c.a.bandIndex !== 0) p.set('band_a', String(c.a.bandIndex));
	}
	if (presetId) p.set('preset', presetId);
	return p;
}

function clampBand(raw: string | null, bandCount: number): number {
	if (!raw) return 0;
	const n = Number(raw);
	if (!Number.isFinite(n)) return 0;
	const i = Math.floor(n);
	if (i < 0) return 0;
	if (i >= bandCount) return Math.max(0, bandCount - 1);
	return i;
}
```

- [ ] **Step 2: Run check**

Run: `pnpm -w run check`
Expected: PASS.

- [ ] **Step 3: Run lint + format**

Run: `pnpm -w run format && pnpm -w run lint:fix`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/utils/channel-composite.ts
git commit -m "feat(utils): add channel-composite (presets + URL round-trip)

Shared PRESETS list, applyPreset, availablePresets, and the
compositeFromUrl/compositeToUrl pair used to round-trip the
unified picker state through the URL hash. NDVI and other
single-band derived presets are intentionally not included
for this slice."
```

---

## Task 3: Wire `extractCogAssets` into `utils/stac.ts` exports

**Files:**
- Modify: `src/lib/utils/stac.ts` — keep existing `extractRasterBandAssets` + `extractMosaicAssets` as wrappers over `extractCogAssets`. Do NOT delete them, they are public objex-utils API.
- Modify: `src/lib/index.ts` — export `extractCogAssets`, `pickNaturalColorComposite`, `syntheticSelfAsset`, `isSingleAssetComposite`, `allChannelsBand0`, `CogAsset`, `ChannelRef`, `ChannelComposite` from `cog-asset.ts`; export `PRESETS`, `availablePresets`, `applyPreset`, `compositeFromUrl`, `compositeToUrl`, `presetMatchesComposite`, `PresetDef` from `channel-composite.ts`.
- Modify: `packages/objex-utils/src/index.ts` — same exports.

- [ ] **Step 1: Inspect existing `extractRasterBandAssets` and `extractMosaicAssets`**

Run: `grep -n "export function extract\(Raster\|Mosaic\)" src/lib/utils/stac.ts`
Expected: two function exports.

- [ ] **Step 2: No code change to `stac.ts`**

The existing `extractRasterBandAssets` and `extractMosaicAssets` already do the right per-call filtering (one drops bandCount > 1, the other keeps it). Per the spec, viewers will switch to `extractCogAssets()` directly; the legacy two functions remain as the public shape consumers depend on. Skip rewriting them as wrappers in this slice (it would force a breaking change in the published types). Just add the new module's exports.

- [ ] **Step 3: Add exports to `src/lib/index.ts`**

Find the existing block that re-exports from `utils/stac.js`. Add a new block after it:

```ts
export {
	extractCogAssets,
	syntheticSelfAsset,
	pickNaturalColorComposite,
	isSingleAssetComposite,
	allChannelsBand0,
	type CogAsset,
	type ChannelRef,
	type ChannelComposite
} from './utils/cog-asset.js';
export {
	PRESETS,
	availablePresets,
	applyPreset,
	compositeFromUrl,
	compositeToUrl,
	presetMatchesComposite,
	type PresetDef
} from './utils/channel-composite.js';
```

- [ ] **Step 4: Add the same exports to `packages/objex-utils/src/index.ts`**

```ts
export {
	extractCogAssets,
	syntheticSelfAsset,
	pickNaturalColorComposite,
	isSingleAssetComposite,
	allChannelsBand0,
	type CogAsset,
	type ChannelRef,
	type ChannelComposite
} from '../../../src/lib/utils/cog-asset.js';
export {
	PRESETS,
	availablePresets,
	applyPreset,
	compositeFromUrl,
	compositeToUrl,
	presetMatchesComposite,
	type PresetDef
} from '../../../src/lib/utils/channel-composite.js';
```

(Match the existing relative-path import style used by other re-exports in that file.)

- [ ] **Step 5: Run check + objex-utils build**

```bash
pnpm -w run check
pnpm --filter @walkthru-earth/objex-utils run build
```
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/index.ts packages/objex-utils/src/index.ts
git commit -m "chore(exports): expose CogAsset + channel-composite

Adds the unified picker's pure-TS modules to the public lib
and objex-utils surfaces."
```

---

## Task 4: Build `ChannelPicker` component

**Files:**
- Create: `src/lib/components/viewers/cog/ChannelPicker.svelte`

- [ ] **Step 1: Create directory**

```bash
mkdir -p src/lib/components/viewers/cog
```

- [ ] **Step 2: Write the component**

```svelte
<script lang="ts">
import type { CogAsset, ChannelRef } from '../../../utils/cog-asset.js';
import { t } from '../../../i18n/index.svelte.js';

type Props = {
	channel: 'r' | 'g' | 'b' | 'a';
	label: string;
	colorClass: string;
	assets: CogAsset[];
	value: ChannelRef;
	onChange: (next: ChannelRef) => void;
	allowNone?: boolean;
};

let {
	channel,
	label,
	colorClass,
	assets,
	value,
	onChange,
	allowNone = false
}: Props = $props();

const assetByKey = $derived(new Map(assets.map((a) => [a.key, a])));
const currentAsset = $derived(assetByKey.get(value.assetKey) ?? null);
const bandCount = $derived(currentAsset?.bandCount ?? 1);

function assetLabel(a: CogAsset): string {
	const cn = a.eoCommon[0];
	const base = cn ? `${a.key} (${cn})` : a.key;
	return a.bandCount > 1 ? `${base} · ${a.bandCount} bands` : base;
}

function bandLabel(i: number, asset: CogAsset | null): string {
	if (!asset) return `${t('cog.band')} ${i + 1}`;
	const cn = asset.eoCommon[i];
	return cn ? `${t('cog.band')} ${i + 1} (${cn})` : `${t('cog.band')} ${i + 1}`;
}

function setAsset(key: string): void {
	if (channel === 'a' && allowNone && key === '') {
		onChange({ assetKey: '', bandIndex: 0 });
		return;
	}
	const target = assetByKey.get(key);
	const maxIdx = Math.max(0, (target?.bandCount ?? 1) - 1);
	const nextBand = Math.min(value.bandIndex, maxIdx);
	onChange({ assetKey: key, bandIndex: nextBand });
}

function setBand(idx: number): void {
	onChange({ assetKey: value.assetKey, bandIndex: idx });
}
</script>

<div class="flex items-center gap-2">
	<span class="w-3 font-bold {colorClass}">{label}</span>
	<select
		class="flex-1 rounded border border-border bg-background px-1.5 py-0.5 text-xs"
		value={value.assetKey}
		onchange={(e) => setAsset((e.target as HTMLSelectElement).value)}
	>
		{#if allowNone}
			<option value="">{t('map.multiCogChannelNone')}</option>
		{/if}
		{#each assets as a (a.key)}
			<option value={a.key}>{assetLabel(a)}</option>
		{/each}
	</select>
	{#if currentAsset && bandCount > 1}
		<select
			class="w-24 rounded border border-border bg-background px-1.5 py-0.5 text-xs"
			value={value.bandIndex}
			onchange={(e) => setBand(Number((e.target as HTMLSelectElement).value))}
		>
			{#each Array.from({ length: bandCount }, (_, i) => i) as i}
				<option value={i}>{bandLabel(i, currentAsset)}</option>
			{/each}
		</select>
	{:else if currentAsset}
		<span class="w-24 px-1.5 py-0.5 text-[10px] text-muted-foreground">
			{t('cog.band')} 1
		</span>
	{/if}
</div>
```

- [ ] **Step 3: Run check**

Run: `pnpm -w run check`
Expected: PASS.

- [ ] **Step 4: Run lint + format**

Run: `pnpm -w run format && pnpm -w run lint:fix`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/viewers/cog/ChannelPicker.svelte
git commit -m "feat(viewers/cog): add ChannelPicker component

One row, two dropdowns: asset and band. Band dropdown collapses
to plain text when the chosen asset has bandCount === 1, so
Sentinel-2 / Landsat per-band assets read as a clean single-row
pick while NAIP image / S2 visual exposes the full band picker."
```

---

## Task 5: Build `buildRgbLayer` dispatch helper

**Files:**
- Create: `src/lib/components/viewers/cog/buildRgbLayer.ts`

- [ ] **Step 1: Write the module**

```ts
/**
 * Layer-construction dispatch for the unified RGB picker.
 *
 * Decision rule:
 *   - All three RGB channels point to the SAME asset → COGLayer with
 *     `bandConfig: { mode: 'rgb', rBand, gBand, bBand }`. Single COG, single
 *     decoder pool, fastest path.
 *   - Channels point to DIFFERENT assets → MultiCOGLayer with the legacy
 *     `composite: { r, g, b }` keyed on asset keys. MultiCOGLayer reads band 0
 *     of each source; per-channel band index is silently ignored on this path
 *     (library limitation, see spec Known Limitations).
 *
 * `buildRgbLayer` ONLY constructs the layer. It does not add overlays,
 * register cleanup, or touch deck.gl state. Caller owns lifecycle.
 */

import { COGLayer, MultiCOGLayer } from '@developmentseed/deck.gl-geotiff';
import type { DecoderPool } from '@developmentseed/geotiff';
import type { CogAsset, ChannelComposite } from '../../../utils/cog-asset.js';
import { allChannelsBand0, isSingleAssetComposite } from '../../../utils/cog-asset.js';
import {
	type RescaleConfig,
	buildBandRenderPipeline,
	type EpsgResolver
} from '../../../utils/cog.js';

export type RgbLayerKind = 'cog' | 'multicog';

export interface BuildRgbLayerOptions {
	id: string;
	assets: CogAsset[];
	composite: ChannelComposite;
	rescale: RescaleConfig;
	/** href → presigned-or-passthrough URL. */
	resolveHref: (href: string) => Promise<string>;
	pool?: DecoderPool | null;
	epsgResolver: EpsgResolver;
	signal: AbortSignal;
	onLoad?: (info: { kind: RgbLayerKind; bounds?: GeoBounds }) => void;
}

export interface GeoBounds {
	west: number;
	south: number;
	east: number;
	north: number;
}

export interface BuiltRgbLayer {
	kind: RgbLayerKind;
	layer: COGLayer | MultiCOGLayer;
}

/**
 * Build the appropriate deck.gl layer for an RGB composite.
 *
 * For single-asset composites the band indices land in COGLayer's
 * `bandConfig.{r,g,b}Band`. For multi-asset composites a warning is logged
 * (once per call) when any non-band-0 index is requested, since
 * MultiCOGLayer cannot honor it today.
 */
export async function buildRgbLayer(opts: BuildRgbLayerOptions): Promise<BuiltRgbLayer> {
	const assetByKey = new Map(opts.assets.map((a) => [a.key, a]));
	const c = opts.composite;

	if (isSingleAssetComposite(c)) {
		const asset = assetByKey.get(c.r.assetKey);
		if (!asset) throw new Error(`unknown asset key: ${c.r.assetKey}`);
		const url = await opts.resolveHref(asset.href);
		if (opts.signal.aborted) throw new DOMException('Aborted', 'AbortError');
		const layer = new COGLayer({
			id: opts.id,
			url,
			bandConfig: {
				mode: 'rgb',
				rBand: c.r.bandIndex,
				gBand: c.g.bandIndex,
				bBand: c.b.bandIndex
			},
			renderPipeline: buildBandRenderPipeline({ noDataVal: 0, rescale: { ...opts.rescale } }),
			pool: opts.pool ?? undefined,
			epsgResolver: opts.epsgResolver,
			signal: opts.signal,
			onGeoTIFFLoad: (_g, info) => {
				opts.onLoad?.({
					kind: 'cog',
					bounds: info?.geographicBounds as GeoBounds | undefined
				});
			}
		});
		return { kind: 'cog', layer };
	}

	if (!allChannelsBand0(c)) {
		// Library limitation: MultiCOGLayer always reads band 0. Surface a
		// console warning once per call so the consumer sees that the user's
		// per-channel band index was dropped.
		console.warn(
			'[buildRgbLayer] multi-asset composite with non-band-0 indices; band index ignored on multi-asset path'
		);
	}

	const sources: Record<string, { url: string }> = {};
	for (const ref of [c.r, c.g, c.b, c.a].filter((x): x is NonNullable<typeof c.a> => Boolean(x))) {
		if (sources[ref.assetKey]) continue;
		const asset = assetByKey.get(ref.assetKey);
		if (!asset) continue;
		const url = await opts.resolveHref(asset.href);
		if (opts.signal.aborted) throw new DOMException('Aborted', 'AbortError');
		sources[ref.assetKey] = { url };
	}

	const compositeSpec: { r: string; g: string; b: string; a?: string } = {
		r: c.r.assetKey,
		g: c.g.assetKey,
		b: c.b.assetKey
	};
	if (c.a && sources[c.a.assetKey]) compositeSpec.a = c.a.assetKey;

	const layer = new MultiCOGLayer({
		id: opts.id,
		sources,
		composite: compositeSpec,
		renderPipeline: buildBandRenderPipeline({ noDataVal: 0, rescale: { ...opts.rescale } }),
		pool: opts.pool ?? undefined,
		epsgResolver: opts.epsgResolver,
		signal: opts.signal,
		onGeoTIFFLoad: (_tiffs, info) => {
			opts.onLoad?.({
				kind: 'multicog',
				bounds: info?.geographicBounds as GeoBounds | undefined
			});
		}
	});
	return { kind: 'multicog', layer };
}
```

- [ ] **Step 2: Verify `EpsgResolver` is exported from `utils/cog.ts`**

Run: `grep -n "export.*EpsgResolver\|EpsgResolver.*=" src/lib/utils/cog.ts`
Expected: a type or function-typed export. If `EpsgResolver` is not exported as a type, replace the import with `ReturnType<typeof createEpsgResolver>` and import `createEpsgResolver` instead.

- [ ] **Step 3: Run check**

Run: `pnpm -w run check`
Expected: PASS.

- [ ] **Step 4: Run lint + format**

Run: `pnpm -w run format && pnpm -w run lint:fix`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/viewers/cog/buildRgbLayer.ts
git commit -m "feat(viewers/cog): add buildRgbLayer dispatch helper

Single-asset composites build a COGLayer with bandConfig.rBand/
gBand/bBand. Multi-asset composites build a MultiCOGLayer keyed
on asset keys (band 0 only; library limitation, surfaces a
console warning when ignored)."
```

---

## Task 6: Refactor `CogControls.svelte` to unified shape

**Files:**
- Modify: `src/lib/components/viewers/CogControls.svelte`

- [ ] **Step 1: Read the current file end-to-end before editing**

```bash
wc -l src/lib/components/viewers/CogControls.svelte
```

(Should be ~400 lines; re-read with the Read tool.)

- [ ] **Step 2: Replace the discriminated-union props with one unified shape**

Replace the entire `<script lang="ts">` block with:

```ts
import { t } from '../../i18n/index.svelte.js';
import { RangeSlider } from '../ui/slider/index.js';
import {
	type BandConfig,
	type ColorRampId,
	DEFAULT_RESCALE,
	type RescaleConfig
} from '../../utils/cog.js';
import {
	COLORMAP_INDEX,
	COLORMAP_NAMES,
	COLORMAP_SPRITE_LAYERS,
	COLORMAP_SPRITE_URL
} from '../../utils/colormap-sprite.js';
import type { CogAsset, ChannelComposite, ChannelRef } from '../../utils/cog-asset.js';
import type { PresetDef } from '../../utils/channel-composite.js';
import ChannelPicker from './cog/ChannelPicker.svelte';

type Props = {
	/** All raster-COG-ish assets on the current item (or `[selfAsset]` for plain CogViewer). */
	assets: CogAsset[];
	/** Current RGB composite. Always present. */
	composite: ChannelComposite;
	onCompositeChange: (next: ChannelComposite) => void;
	/** Presets that resolve on this item. Empty when no preset applies. */
	presets: PresetDef[];
	activePresetId: string;
	onPresetChange: (id: string) => void;
	/** Rendering mode toggle: 'rgb' uses the channel pickers; 'single' the band+ramp picker. */
	mode: 'rgb' | 'single';
	onModeChange: (m: 'rgb' | 'single') => void;
	/** Band/ramp config used when mode === 'single'. Optional for RGB-only callers. */
	bandConfig?: BandConfig | null;
	bandCount?: number;
	onBandConfigChange?: (next: BandConfig) => void;
	rescale: RescaleConfig;
	rescaleApplicable: boolean;
	onRescaleChange: (next: RescaleConfig) => void;
	histogram?: Uint32Array | null;
	/** Optional 4th channel UI affordance (alpha). When false, alpha row is hidden. */
	showAlpha?: boolean;
};

const props: Props = $props();

const PINNED_RAMPS: ColorRampId[] = [
	'gray',
	'terrain',
	'viridis',
	'magma',
	'turbo',
	'spectral',
	'inferno',
	'plasma',
	'cividis',
	'rdylgn'
];

let rampQuery = $state('');

const filteredRamps = $derived.by(() => {
	const q = rampQuery.trim().toLowerCase();
	if (!q) return COLORMAP_NAMES;
	return COLORMAP_NAMES.filter((name) => name.toLowerCase().includes(q));
});

function setChannel(channel: 'r' | 'g' | 'b' | 'a', next: ChannelRef): void {
	if (channel === 'a') {
		const c = { ...props.composite, a: next.assetKey ? next : undefined };
		props.onCompositeChange(c);
		return;
	}
	props.onCompositeChange({ ...props.composite, [channel]: next });
}

function setMode(m: 'rgb' | 'single'): void {
	props.onModeChange(m);
}

function setBand(value: number): void {
	if (!props.bandConfig || !props.onBandConfigChange) return;
	props.onBandConfigChange({ ...props.bandConfig, band: value });
}

function setRamp(id: ColorRampId): void {
	if (!props.bandConfig || !props.onBandConfigChange) return;
	props.onBandConfigChange({ ...props.bandConfig, colorRamp: id });
}

function bandOptions(count: number): { value: number; label: string }[] {
	return Array.from({ length: count }, (_, i) => ({
		value: i,
		label: `${t('cog.band')} ${i + 1}`
	}));
}

function rampBg(name: ColorRampId, heightPx: number): string {
	const index = COLORMAP_INDEX[name];
	if (index === undefined) return '';
	const totalHeight = COLORMAP_SPRITE_LAYERS * heightPx;
	const yOffset = index * heightPx;
	return [
		`background-image: url("${COLORMAP_SPRITE_URL}")`,
		'background-repeat: no-repeat',
		`background-size: 100% ${totalHeight}px`,
		`background-position: 0 -${yOffset}px`
	].join('; ');
}

function clamp01(v: number): number {
	return Math.max(0, Math.min(1, v));
}

function setRescaleMin(value: number): void {
	const clamped = clamp01(value);
	const next = Math.min(clamped, props.rescale.max - 0.001);
	props.onRescaleChange({ min: Number.isFinite(next) ? next : 0, max: props.rescale.max });
}

function setRescaleMax(value: number): void {
	const clamped = clamp01(value);
	const next = Math.max(clamped, props.rescale.min + 0.001);
	props.onRescaleChange({ min: props.rescale.min, max: Number.isFinite(next) ? next : 1 });
}

function setRescaleRange(next: [number, number]): void {
	const lo = clamp01(next[0]);
	const hi = clamp01(next[1]);
	props.onRescaleChange({ min: Math.min(lo, hi), max: Math.max(lo, hi) });
}

function resetRescale(): void {
	props.onRescaleChange({ ...DEFAULT_RESCALE });
}

function fmtRescale(n: number): string {
	return n.toFixed(2);
}

const histogramBars = $derived.by(() => {
	const h = props.histogram;
	if (!h || h.length === 0) return null;
	let max = 0;
	for (const v of h) if (v > max) max = v;
	if (max === 0) return null;
	return Array.from(h, (count) => count / max);
});
```

- [ ] **Step 3: Replace the template**

Replace the entire `<div ...>` panel block (everything after the script tag) with:

```svelte
<div
	class="absolute right-2 top-10 z-10 w-72 rounded bg-card/90 p-2.5 text-xs text-card-foreground backdrop-blur-sm"
>
	{#if props.presets.length > 0 && props.mode === 'rgb'}
		<div class="mb-2 flex items-center gap-2">
			<span class="text-muted-foreground">{t('map.multiCogPreset.label')}</span>
			<select
				class="flex-1 rounded border border-border bg-background px-1.5 py-0.5 text-xs"
				value={props.activePresetId}
				onchange={(e) => props.onPresetChange((e.target as HTMLSelectElement).value)}
			>
				{#if !props.activePresetId}
					<option value="">{t('map.multiCogPreset.custom')}</option>
				{/if}
				{#each props.presets as p (p.id)}
					<option value={p.id}>{t(p.labelKey)}</option>
				{/each}
			</select>
		</div>
	{/if}

	<div class="mb-2 flex gap-1">
		<button
			class="flex-1 rounded px-2 py-1 transition-colors"
			class:bg-primary={props.mode === 'rgb'}
			class:text-primary-foreground={props.mode === 'rgb'}
			class:bg-muted={props.mode !== 'rgb'}
			onclick={() => setMode('rgb')}
		>
			RGB
		</button>
		<button
			class="flex-1 rounded px-2 py-1 transition-colors"
			class:bg-primary={props.mode === 'single'}
			class:text-primary-foreground={props.mode === 'single'}
			class:bg-muted={props.mode !== 'single'}
			onclick={() => setMode('single')}
		>
			{t('cog.singleBand')}
		</button>
	</div>

	{#if props.mode === 'rgb'}
		<div class="space-y-1">
			<ChannelPicker
				channel="r"
				label="R"
				colorClass="text-red-400"
				assets={props.assets}
				value={props.composite.r}
				onChange={(next) => setChannel('r', next)}
			/>
			<ChannelPicker
				channel="g"
				label="G"
				colorClass="text-green-400"
				assets={props.assets}
				value={props.composite.g}
				onChange={(next) => setChannel('g', next)}
			/>
			<ChannelPicker
				channel="b"
				label="B"
				colorClass="text-blue-400"
				assets={props.assets}
				value={props.composite.b}
				onChange={(next) => setChannel('b', next)}
			/>
			{#if props.showAlpha}
				<ChannelPicker
					channel="a"
					label="A"
					colorClass="text-muted-foreground"
					assets={props.assets}
					value={props.composite.a ?? { assetKey: '', bandIndex: 0 }}
					onChange={(next) => setChannel('a', next)}
					allowNone
				/>
			{/if}
		</div>
	{:else if props.bandConfig && typeof props.bandCount === 'number'}
		<div class="mb-2 flex items-center gap-2">
			<span class="text-muted-foreground">{t('cog.band')}</span>
			<select
				class="flex-1 rounded border border-border bg-background px-1.5 py-0.5 text-xs"
				value={props.bandConfig.band}
				onchange={(e) => setBand(Number((e.target as HTMLSelectElement).value))}
			>
				{#each bandOptions(props.bandCount) as opt (opt.value)}
					<option value={opt.value}>{opt.label}</option>
				{/each}
			</select>
		</div>

		<div class="space-y-1">
			<div class="flex items-center justify-between">
				<span class="text-muted-foreground">{t('cog.colorRamp')}</span>
				<span class="text-[10px] text-muted-foreground tabular-nums">
					{filteredRamps.length}/{COLORMAP_NAMES.length}
				</span>
			</div>

			{#if !rampQuery}
				<div class="grid grid-cols-2 gap-1">
					{#each PINNED_RAMPS as id (id)}
						<button
							class="flex flex-col items-stretch rounded border px-1 py-0.5 transition-colors {props.bandConfig.colorRamp === id ? 'border-primary bg-muted' : 'border-transparent hover:border-border'}"
							onclick={() => setRamp(id)}
							title={id}
						>
							<div class="h-2.5 w-full rounded-sm" style={rampBg(id, 10)}></div>
							<span class="mt-0.5 text-center text-[10px] capitalize text-muted-foreground">
								{id}
							</span>
						</button>
					{/each}
				</div>
			{/if}

			<input
				type="search"
				placeholder={t('cog.colorRampSearch')}
				class="w-full rounded border border-border bg-background px-1.5 py-0.5 text-[11px]"
				value={rampQuery}
				oninput={(e) => (rampQuery = (e.target as HTMLInputElement).value)}
			/>
			<div class="max-h-40 overflow-y-auto rounded border border-border">
				{#each filteredRamps as id (id)}
					<button
						class="flex w-full items-center gap-2 px-1.5 py-0.5 text-left text-[11px] transition-colors {props.bandConfig.colorRamp === id ? 'bg-muted' : 'hover:bg-muted/60'}"
						onclick={() => setRamp(id)}
						title={id}
					>
						<div class="h-2.5 w-14 flex-shrink-0 rounded-sm" style={rampBg(id, 10)}></div>
						<span class="truncate text-muted-foreground">{id}</span>
					</button>
				{/each}
			</div>
		</div>
	{/if}

	{#if props.rescaleApplicable}
		<div class="mt-2 space-y-1 border-t border-border pt-2">
			<div class="flex items-center justify-between">
				<span class="text-muted-foreground">{t('cog.rescale')}</span>
				<button
					class="text-[10px] text-muted-foreground hover:text-card-foreground"
					onclick={resetRescale}
				>
					{t('cog.rescaleReset')}
				</button>
			</div>

			<RangeSlider
				min={0}
				max={1}
				step={0.01}
				value={[props.rescale.min, props.rescale.max]}
				histogram={histogramBars}
				formatLabel={fmtRescale}
				onValueChange={setRescaleRange}
			/>

			<div class="flex items-center gap-1.5">
				<label class="flex flex-1 items-center gap-1 text-[10px] text-muted-foreground">
					<span class="w-6">min</span>
					<input
						type="number"
						min="0"
						max="1"
						step="0.01"
						class="w-full rounded border border-border bg-background px-1 py-0.5 text-[11px] tabular-nums"
						value={props.rescale.min}
						oninput={(e) => setRescaleMin(Number((e.target as HTMLInputElement).value))}
					/>
				</label>
				<label class="flex flex-1 items-center gap-1 text-[10px] text-muted-foreground">
					<span class="w-6">max</span>
					<input
						type="number"
						min="0"
						max="1"
						step="0.01"
						class="w-full rounded border border-border bg-background px-1 py-0.5 text-[11px] tabular-nums"
						value={props.rescale.max}
						oninput={(e) => setRescaleMax(Number((e.target as HTMLInputElement).value))}
					/>
				</label>
			</div>
		</div>
	{/if}
</div>
```

- [ ] **Step 4: Run check (will fail until callers are updated)**

Run: `pnpm -w run check`
Expected: FAIL with type errors in `CogViewer.svelte`, `MultiCogViewer.svelte`, `StacMosaicViewer.svelte`. The next three tasks fix each in turn. Don't commit yet.

- [ ] **Step 5: Confirm no orphaned exports**

```bash
grep -n "MultiChannel\|AssetComposite" src/lib/components/viewers/CogControls.svelte
```
Expected: empty. The old `MultiChannel` / `AssetComposite` exports are gone. Their callers are migrated in Tasks 7-9.

DO NOT COMMIT YET. The next task migrates `CogViewer` so the build is green again before commit.

---

## Task 7: Migrate `CogViewer.svelte` to unified `CogControls`

**Files:**
- Modify: `src/lib/components/viewers/CogViewer.svelte`

- [ ] **Step 1: Add imports**

Find the import block at the top of the script. Add:

```ts
import {
	type CogAsset,
	type ChannelComposite,
	syntheticSelfAsset
} from '../../utils/cog-asset.js';
```

- [ ] **Step 2: Add new state**

Find the existing `let bandConfig = $state<BandConfig | null>(null);` line. Right below it, add:

```ts
let resolvedHrefForControls = $state<string | null>(null);
let probedBandCount = $state<number | null>(null);

const cogControlsAssets = $derived<CogAsset[]>(() => {
	const href = resolvedHrefForControls;
	if (!href) return [];
	return [syntheticSelfAsset(href, probedBandCount ?? undefined)];
})();

const cogControlsComposite = $derived<ChannelComposite>(() => {
	const bc = bandConfig;
	if (!bc) {
		return {
			r: { assetKey: 'self', bandIndex: 0 },
			g: { assetKey: 'self', bandIndex: 0 },
			b: { assetKey: 'self', bandIndex: 0 }
		};
	}
	if (bc.mode === 'rgb') {
		return {
			r: { assetKey: 'self', bandIndex: bc.rBand ?? 0 },
			g: { assetKey: 'self', bandIndex: bc.gBand ?? 0 },
			b: { assetKey: 'self', bandIndex: bc.bBand ?? 0 }
		};
	}
	const i = bc.band ?? 0;
	return {
		r: { assetKey: 'self', bandIndex: i },
		g: { assetKey: 'self', bandIndex: i },
		b: { assetKey: 'self', bandIndex: i }
	};
})();
```

- [ ] **Step 3: Find the existing `resolvedHttpsUrl` assignment and `geotiffRef` band-count probe**

The viewer already resolves `resolvedHttpsUrl` and probes `geotiffRef.count` somewhere in the load flow. Locate those two assignments. Right after each, mirror them into `resolvedHrefForControls = resolvedHttpsUrl;` and `probedBandCount = geotiffRef.count;` respectively.

```bash
grep -n "resolvedHttpsUrl =" src/lib/components/viewers/CogViewer.svelte
grep -n "geotiffRef.count\|geotiff.count" src/lib/components/viewers/CogViewer.svelte
```

- [ ] **Step 4: Add the change handlers**

Anywhere in the script:

```ts
function handleCompositeChange(next: ChannelComposite): void {
	if (!bandConfig) return;
	if (bandConfig.mode === 'rgb') {
		bandConfig = {
			...bandConfig,
			rBand: next.r.bandIndex,
			gBand: next.g.bandIndex,
			bBand: next.b.bandIndex
		};
	} else {
		bandConfig = { ...bandConfig, band: next.r.bandIndex };
	}
}

function handleModeChange(m: 'rgb' | 'single'): void {
	if (!bandConfig) return;
	bandConfig = { ...bandConfig, mode: m };
}

function handleBandConfigChange(next: BandConfig): void {
	bandConfig = next;
}
```

- [ ] **Step 5: Update the `<CogControls ... />` invocation**

Find the `<CogControls` element and replace its prop list with:

```svelte
<CogControls
	assets={cogControlsAssets}
	composite={cogControlsComposite}
	onCompositeChange={handleCompositeChange}
	presets={[]}
	activePresetId=""
	onPresetChange={() => {}}
	mode={bandConfig?.mode ?? 'rgb'}
	onModeChange={handleModeChange}
	bandConfig={bandConfig}
	bandCount={probedBandCount ?? 1}
	onBandConfigChange={handleBandConfigChange}
	{rescale}
	{rescaleApplicable}
	onRescaleChange={(r) => (rescale = r)}
	histogram={histogram}
/>
```

(Keep whatever guard already wraps the `<CogControls>` block, e.g. `{#if showControls && bandConfig}`.)

- [ ] **Step 6: Run check**

Run: `pnpm -w run check`
Expected: PASS for `CogViewer.svelte`. Other viewers may still fail (they're fixed in Tasks 8 + 9). If only `MultiCogViewer.svelte` and `StacMosaicViewer.svelte` errors remain, you're on track.

- [ ] **Step 7: Run lint + format**

Run: `pnpm -w run format && pnpm -w run lint:fix`
Expected: clean.

DO NOT COMMIT YET. CogControls + CogViewer + MultiCogViewer must land in one commit so HEAD always builds.

---

## Task 8: Migrate `MultiCogViewer.svelte` to shared modules

**Files:**
- Modify: `src/lib/components/viewers/MultiCogViewer.svelte`

- [ ] **Step 1: Replace imports**

Find the existing imports block. Replace it with:

```ts
import { MapboxOverlay } from '@deck.gl/mapbox';
import { DecoderPool } from '@developmentseed/geotiff';
import type maplibregl from 'maplibre-gl';
import { onDestroy, untrack } from 'svelte';
import { t } from '../../i18n/index.svelte.js';
import { getAdapter } from '../../storage/index.js';
import { buildProviderBaseUrl, type ProviderId } from '../../storage/providers.js';
import { connectionStore } from '../../stores/connections.svelte.js';
import { tabResources } from '../../stores/tab-resources.svelte.js';
import type { Tab } from '../../types.js';
import {
	clampBounds,
	cleanupNativeBitmap,
	createEpsgResolver,
	fitCogBounds,
	type RescaleConfig
} from '../../utils/cog.js';
import {
	type CogAsset,
	type ChannelComposite,
	extractCogAssets,
	pickNaturalColorComposite
} from '../../utils/cog-asset.js';
import {
	availablePresets,
	applyPreset,
	compositeFromUrl,
	compositeToUrl,
	PRESETS,
	presetMatchesComposite
} from '../../utils/channel-composite.js';
import { isStacItem, type StacItem, type StacRoutableKind } from '../../utils/stac.js';
import { buildHttpsUrlAsync } from '../../utils/url.js';
import { getUrlViewParams, updateUrlViewParams } from '../../utils/url-state.js';
import CogControls from './CogControls.svelte';
import { buildRgbLayer } from './cog/buildRgbLayer.js';
import MapContainer from './map/MapContainer.svelte';
```

- [ ] **Step 2: Replace the state block**

Replace the state section (everything from `let { tab, classified } ...` through the start of the first function definition) with:

```ts
let { tab, classified }: { tab: Tab; classified?: StacRoutableKind } = $props();

let loading = $state(true);
let error = $state<string | null>(null);
let showControls = $state(false);
let bounds = $state<[number, number, number, number] | undefined>();
let activePresetId = $state<string>('natural-color');
let rescale = $state<RescaleConfig>({ min: 0, max: 0.3 });

let assets = $state.raw<CogAsset[]>([]);
let composite = $state.raw<ChannelComposite | null>(null);
let abortController = new AbortController();
let mapRef: maplibregl.Map | null = null;
let overlayRef: MapboxOverlay | null = null;
let hasFittedOnce = false;
let presignCache = new Map<string, Promise<string>>();
let loadGen = 0;
let layerVersion = 0;
let rebuildTimer: number | null = null;
let lastRebuildAt = 0;

const REBUILD_INTERVAL_MS = 750;

let pool: DecoderPool | null = new DecoderPool();
const epsgResolver = createEpsgResolver();

const presetsForItem = $derived(availablePresets(assets));
```

- [ ] **Step 3: Replace `resetViewer`**

```ts
function resetViewer(): void {
	abortController.abort();
	abortController = new AbortController();
	if (rebuildTimer != null) {
		clearTimeout(rebuildTimer);
		rebuildTimer = null;
	}
	lastRebuildAt = 0;
	layerVersion = 0;
	if (mapRef) cleanupNativeBitmap(mapRef);
	if (mapRef && overlayRef) {
		try {
			mapRef.removeControl(overlayRef as unknown as maplibregl.IControl);
		} catch {
			/* already destroyed */
		}
	}
	overlayRef = null;
	assets = [];
	composite = null;
	presignCache = new Map();
	loading = true;
	error = null;
	bounds = undefined;
	activePresetId = 'natural-color';
	rescale = { min: 0, max: 0.3 };
	hasFittedOnce = false;
	showControls = false;
}
```

- [ ] **Step 4: Replace `loadItem` body** (keep the function signature)

```ts
async function loadItem(map: maplibregl.Map): Promise<void> {
	const gen = ++loadGen;
	const signal = abortController.signal;
	try {
		let item: StacItem | null = null;
		if (classified && classified.kind === 'item') {
			item = classified.item;
		} else {
			const adapter = getAdapter(tab.source, tab.connectionId);
			const data = await adapter.read(tab.path, undefined, undefined, signal);
			if (gen !== loadGen || signal.aborted) return;
			const parsed = JSON.parse(new TextDecoder().decode(data));
			if (!isStacItem(parsed)) {
				error = t('map.multiCogMissingBands');
				loading = false;
				return;
			}
			item = parsed;
		}
		if (!item) {
			error = t('map.multiCogMissingBands');
			loading = false;
			return;
		}

		const next = extractCogAssets(item);
		if (next.length < 1) {
			error = t('map.multiCogMissingBands');
			loading = false;
			return;
		}
		assets = next;

		// Hydrate composite: URL params first, then natural-color default.
		const params = getUrlViewParams();
		const fromUrl = compositeFromUrl(params, next);
		if (fromUrl) {
			composite = fromUrl;
			const presetId = params.get('preset');
			if (presetId && PRESETS.find((p) => p.id === presetId)) activePresetId = presetId;
			else activePresetId = '';
		} else {
			const picked = pickNaturalColorComposite(next);
			composite = picked?.composite ?? null;
			activePresetId = picked?.source === 'rgb-bands' ? 'natural-color' : '';
		}

		if (!composite) {
			error = t('map.multiCogMissingBands');
			loading = false;
			return;
		}

		if (Array.isArray(item.bbox) && item.bbox.length >= 4) {
			const clamped = clampBounds({
				west: Number(item.bbox[0]),
				south: Number(item.bbox[1]),
				east: Number(item.bbox[2]),
				north: Number(item.bbox[3])
			});
			bounds = [clamped.west, clamped.south, clamped.east, clamped.north];
			if (!hasFittedOnce) {
				fitCogBounds(map, clamped);
				hasFittedOnce = true;
			}
		}

		await buildAndAddLayer(map, ++layerVersion, signal);
	} catch (err) {
		if (gen !== loadGen) return;
		if (signal.aborted) return;
		if (err instanceof DOMException && err.name === 'AbortError') return;
		error = err instanceof Error ? err.message : String(err);
		loading = false;
	}
}
```

- [ ] **Step 5: Replace `buildAndAddLayer`**

```ts
async function buildAndAddLayer(
	map: maplibregl.Map,
	version: number,
	signal: AbortSignal
): Promise<void> {
	const c = composite;
	if (!c) return;

	const { layer } = await buildRgbLayer({
		id: `multicog-${tab.id}-v${version}`,
		assets,
		composite: c,
		rescale: { ...rescale },
		resolveHref: presignHref,
		pool,
		epsgResolver,
		signal,
		onLoad: ({ bounds: nextBounds }) => {
			if (version !== layerVersion || signal.aborted) return;
			if (nextBounds) {
				const clamped = clampBounds(nextBounds);
				if (!hasFittedOnce) {
					bounds = [clamped.west, clamped.south, clamped.east, clamped.north];
					fitCogBounds(map, clamped);
					hasFittedOnce = true;
				}
			}
			loading = false;
		}
	});

	if (overlayRef) {
		overlayRef.setProps({ layers: [layer] });
		return;
	}

	const overlay = new MapboxOverlay({
		interleaved: false,
		layers: [layer],
		onError: (err: Error) => {
			if (signal.aborted) return;
			if (!error) {
				error = err?.message || String(err);
				loading = false;
			}
		}
	});
	overlayRef = overlay;
	map.addControl(overlay as unknown as maplibregl.IControl);
}
```

- [ ] **Step 6: Replace the URL helper + change handlers**

```ts
function syncCompositeToUrl(c: ChannelComposite | null, presetId: string | null): void {
	if (!c) {
		updateUrlViewParams('map', null);
		return;
	}
	updateUrlViewParams('map', compositeToUrl(c, presetId));
}

function setPreset(id: string): void {
	const preset = PRESETS.find((p) => p.id === id);
	if (!preset) return;
	const next = applyPreset(assets, preset);
	if (!next) return;
	const a = composite?.a;
	composite = a ? { ...next, a } : next;
	activePresetId = id;
	syncCompositeToUrl(composite, id);
	if (mapRef) scheduleLayerRebuild(mapRef, abortController.signal);
}

function setComposite(next: ChannelComposite): void {
	composite = next;
	const matching = PRESETS.find((p) => presetMatchesComposite(p, next, assets));
	activePresetId = matching?.id ?? '';
	syncCompositeToUrl(next, activePresetId || null);
	if (mapRef) scheduleLayerRebuild(mapRef, abortController.signal);
}

function handleRescaleChange(next: RescaleConfig): void {
	rescale = next;
	if (mapRef) scheduleLayerRebuild(mapRef, abortController.signal);
}
```

- [ ] **Step 7: Keep the existing `presignHref`, `extractConnectionKey`, `scheduleLayerRebuild`, `cleanup`, the two `$effect` blocks, and `onMapReady` AS-IS**. Delete the old `setChannel`, `setPreset` (replaced above), `syncCompositeToUrl` (replaced above), `composite: AssetComposite` references, and the legacy `PRESETS` array if it exists in this file (it should now come from `channel-composite.ts`).

- [ ] **Step 8: Replace the template's `<CogControls ... />` block**

Find the `<CogControls` element. Replace its prop list with:

```svelte
{#if showControls}
	<CogControls
		{assets}
		composite={composite}
		onCompositeChange={setComposite}
		presets={presetsForItem}
		{activePresetId}
		onPresetChange={setPreset}
		mode="rgb"
		onModeChange={() => {}}
		{rescale}
		rescaleApplicable={true}
		onRescaleChange={handleRescaleChange}
		showAlpha={assets.length >= 4}
	/>
{/if}
```

Also remove the standalone preset `<select>` in the top-right corner (the `<label>` block that wraps `setPreset`). Preset lives only inside `CogControls` now.

- [ ] **Step 9: Run check**

Run: `pnpm -w run check`
Expected: PASS for `CogViewer.svelte` and `MultiCogViewer.svelte`. `StacMosaicViewer.svelte` may still error (fixed in next task).

- [ ] **Step 10: Run lint + format**

Run: `pnpm -w run format && pnpm -w run lint:fix`
Expected: clean.

DO NOT COMMIT YET. Mosaic must compile too.

---

## Task 9: Migrate `StacMosaicViewer.svelte` (single-asset path)

This is the smaller half of the mosaic refactor. Single-asset composites stay on the existing `MosaicLayer` path. Multi-asset support lands in Task 10.

**Files:**
- Modify: `src/lib/components/viewers/StacMosaicViewer.svelte`

- [ ] **Step 1: Add imports**

Add these imports to the script block:

```ts
import {
	type CogAsset,
	type ChannelComposite,
	extractCogAssets,
	isSingleAssetComposite,
	pickNaturalColorComposite
} from '../../utils/cog-asset.js';
import {
	availablePresets,
	applyPreset,
	compositeFromUrl,
	compositeToUrl,
	PRESETS,
	presetMatchesComposite
} from '../../utils/channel-composite.js';
```

- [ ] **Step 2: Add new state alongside `mosaicAssetKey` / `availableAssets`**

```ts
let cogAssets = $state.raw<CogAsset[]>([]);
let composite = $state.raw<ChannelComposite | null>(null);
let activePresetId = $state<string>('');

const presetsForMosaic = $derived(availablePresets(cogAssets));
```

- [ ] **Step 3: Find the seeding spot for `availableAssets` / `mosaicAssetKey`**

```bash
grep -n "extractMosaicAssets\|availableAssets\s*=\|mosaicAssetKey\s*=" src/lib/components/viewers/StacMosaicViewer.svelte | head -20
```

Right after the seeding block runs (when the first item with rasters is committed), add:

```ts
const nextCogAssets = extractCogAssets(firstItemWithRasters);
cogAssets = nextCogAssets;

// URL hash takes priority, otherwise natural-color default
const params = getUrlViewParams();
const fromUrl = compositeFromUrl(params, nextCogAssets);
if (fromUrl && isSingleAssetComposite(fromUrl)) {
	composite = fromUrl;
	const presetId = params.get('preset');
	activePresetId =
		presetId && PRESETS.find((p) => p.id === presetId) ? presetId : '';
} else {
	const picked = pickNaturalColorComposite(nextCogAssets);
	if (picked) {
		composite = picked.composite;
		activePresetId = picked.source === 'rgb-bands' ? 'natural-color' : '';
	}
}

// Mirror composite.r.assetKey into the existing single-asset mosaic state so
// the existing buildMosaicSourceMeta path keeps working for this slice.
if (composite) {
	mosaicAssetKey = composite.r.assetKey;
}
```

(Replace `firstItemWithRasters` with whatever variable the existing seeding code uses.)

- [ ] **Step 4: Add the change handlers + URL sync**

```ts
function syncCompositeToUrl(c: ChannelComposite | null, presetId: string | null): void {
	if (!c) {
		updateUrlViewParams('map', null);
		return;
	}
	updateUrlViewParams('map', compositeToUrl(c, presetId));
}

function setComposite(next: ChannelComposite): void {
	composite = next;
	const matching = PRESETS.find((p) => presetMatchesComposite(p, next, cogAssets));
	activePresetId = matching?.id ?? '';
	syncCompositeToUrl(next, activePresetId || null);

	// Single-asset path: feed the existing setMosaicAssetKey machinery.
	if (isSingleAssetComposite(next)) {
		setMosaicAssetKey(next.r.assetKey);
	}
	// Multi-asset path is added in Task 10.
}

function setPreset(id: string): void {
	const preset = PRESETS.find((p) => p.id === id);
	if (!preset) return;
	const next = applyPreset(cogAssets, preset);
	if (!next) return;
	activePresetId = id;
	setComposite(next);
}
```

- [ ] **Step 5: Replace the `<CogControls ... />` invocation in the template**

Find the existing `<CogControls mode="single" ... />` block. Replace it with:

```svelte
{#if showControls && composite}
	<CogControls
		assets={cogAssets}
		{composite}
		onCompositeChange={setComposite}
		presets={presetsForMosaic}
		{activePresetId}
		onPresetChange={setPreset}
		mode={bandConfig?.mode ?? 'rgb'}
		onModeChange={(m) => (bandConfig = bandConfig ? { ...bandConfig, mode: m } : bandConfig)}
		bandConfig={bandConfig}
		bandCount={probedBandCount ?? 1}
		onBandConfigChange={(next) => (bandConfig = next)}
		{rescale}
		{rescaleApplicable}
		onRescaleChange={handleRescaleChange}
		histogram={mosaicHistogram}
	/>
{/if}
```

(Replace `mosaicHistogram` with whatever the existing prop name is.)

- [ ] **Step 6: Remove the legacy mosaic asset picker**

If the old code had an "Asset ▾" `<select>` in the panel header (passed via `assets={...} assetKey={mosaicAssetKey} onAssetChange={setMosaicAssetKey}` in the old `CogControls` mode='single' invocation), confirm it's gone. The asset choice now flows through the ChannelPicker rows.

Keep the internal `setMosaicAssetKey(nextKey)` function — `setComposite` calls it for single-asset composites.

- [ ] **Step 7: Run check**

Run: `pnpm -w run check`
Expected: PASS across all viewers.

- [ ] **Step 8: Run lint + format**

Run: `pnpm -w run format && pnpm -w run lint:fix`
Expected: clean.

- [ ] **Step 9: Commit Tasks 6 + 7 + 8 + 9 together**

```bash
git add \
	src/lib/components/viewers/CogControls.svelte \
	src/lib/components/viewers/CogViewer.svelte \
	src/lib/components/viewers/MultiCogViewer.svelte \
	src/lib/components/viewers/StacMosaicViewer.svelte
git commit -m "feat(viewers): unify RGB picker across CogViewer/MultiCog/Mosaic

CogControls collapses its discriminated-union props to one shape
(assets + ChannelComposite + presets). CogViewer drives it via a
synthetic 'self' asset, MultiCogViewer uses extractCogAssets +
pickNaturalColorComposite, StacMosaicViewer mirrors the picked
composite through its existing setMosaicAssetKey path for the
single-asset case. Multi-asset mosaic lands in the next commit.

Default natural-color picks the pre-baked visual asset when
present (S2 visual, NAIP image), else falls back to per-band
red/green/blue, else first three raster assets."
```

---

## Task 10: Multi-asset mosaic via per-item `MultiCOGLayer` set

**Files:**
- Modify: `src/lib/components/viewers/StacMosaicViewer.svelte`

This task wires the multi-asset path. When `!isSingleAssetComposite(composite)`, every committed item becomes its own `MultiCOGLayer`; the legacy `MosaicLayer` is bypassed for that case.

- [ ] **Step 1: Add imports for `MultiCOGLayer`**

Find the existing `MosaicLayer` import from `@developmentseed/deck.gl-geotiff`. Add `MultiCOGLayer` to the same import.

- [ ] **Step 2: Add new derived `multiCogLayers`**

Anywhere alongside the existing `mosaicLayer` derivation:

```ts
const multiCogLayers = $derived.by(() => {
	const c = composite;
	if (!c) return [] as MultiCOGLayer[];
	if (isSingleAssetComposite(c)) return [] as MultiCOGLayer[];
	const items = filteredViews; // existing derived: items committed + facet-filtered
	const out: MultiCOGLayer[] = [];
	for (const view of items) {
		const item = view.raw;
		const itemAssets = extractCogAssets(item);
		const sources: Record<string, { url: string }> = {};
		for (const ref of [c.r, c.g, c.b]) {
			if (sources[ref.assetKey]) continue;
			const a = itemAssets.find((x) => x.key === ref.assetKey);
			if (!a) continue;
			// Synchronous lookup against presignCache: per-item URLs are
			// presigned the first time the item enters the visible set in
			// `commitSources`. Multi-asset path piggybacks on the same cache.
			const cachedPromise = presignCache.get(a.href);
			if (!cachedPromise) {
				// Schedule a presign so the next render picks it up.
				presignHref(a.href);
				continue;
			}
			// We can only attach a URL synchronously when the promise has
			// already resolved. For that, store resolved URLs in a parallel
			// Map<string, string> populated below.
			const resolved = resolvedHrefByOriginal.get(a.href);
			if (resolved) sources[a.key] = { url: resolved };
		}
		// Skip items whose 3 channels don't all have resolved URLs yet.
		// The next render after presigns resolve will include them.
		if (!sources[c.r.assetKey] || !sources[c.g.assetKey] || !sources[c.b.assetKey]) continue;
		out.push(
			new MultiCOGLayer({
				id: `mosaic-multicog-${view.id}-p${pipelineGen}`,
				sources,
				composite: { r: c.r.assetKey, g: c.g.assetKey, b: c.b.assetKey },
				renderPipeline: buildBandRenderPipeline({
					noDataVal: 0,
					rescale: { ...rescale }
				}),
				pool: pool ?? undefined,
				epsgResolver,
				onTileError: (err: Error) => {
					if (isAbortError(err)) return;
					console.error(err);
				}
			})
		);
	}
	return out;
});
```

- [ ] **Step 3: Add the resolved-URL parallel map + populate it on presign resolve**

Above the cache declarations:

```ts
let resolvedHrefByOriginal = new Map<string, string>();
```

Find `presignHref(href)` and update its caching path so that when the cached promise resolves, the URL is also stored in `resolvedHrefByOriginal`:

```ts
function presignHref(href: string): Promise<string> {
	let cached = presignCache.get(href);
	if (!cached) {
		cached = doPresign(href).then((url) => {
			resolvedHrefByOriginal.set(href, url);
			return url;
		});
		presignCache.set(href, cached);
	}
	return cached;
}
```

(Inline the existing presign body into `doPresign`. Do NOT change the LRU eviction wiring on `MosaicLayer.onTileUnload`.)

- [ ] **Step 4: Update the `layers` derivation to include both paths**

Find the existing `layers` derivation. Adjust to:

```ts
const layers = $derived.by(() => {
	const out: unknown[] = [];
	const c = composite;
	if (c && isSingleAssetComposite(c) && mosaicLayer) {
		out.push(mosaicLayer);
	} else if (c && !isSingleAssetComposite(c)) {
		out.push(...multiCogLayers);
	}
	if (footprintLayer) out.push(footprintLayer);
	return out;
});
```

(Keep the existing dep-tracking gotcha: read `layers` BEFORE the `if (!overlayRef) return;` guard in the push-effect.)

- [ ] **Step 5: Wire eviction symmetry for the multi-asset path**

For multi-asset, there is no `MosaicLayer.onTileUnload` that drives Svelte-side eviction. Compensate by triggering eviction on item-set changes:

In `commitSources()` (where the committed view set changes), for any item that drops out of the new set, call:

```ts
for (const dropped of itemsRemoved) {
	const itemAssets = extractCogAssets(dropped.raw);
	for (const a of itemAssets) {
		geotiffCache.delete(`${dropped.id}::${a.key}`);
		presignCache.delete(a.href);
		resolvedHrefByOriginal.delete(a.href);
	}
}
```

(Match the existing `commitSources` shape — `itemsRemoved` may need to be computed by diffing the previous and next committed sets.)

- [ ] **Step 6: Document the soft warning threshold**

Add this comment above `multiCogLayers`:

```ts
// Multi-asset mosaic memory ceiling: with N items × 3 distinct assets the
// worst case is 3N COG range-request streams. mosaicItemLimit (settings)
// bounds N. If multiCogLayers.length × 3 exceeds 300 the user gets a
// warning HUD pill (see template).
```

In the template, add a HUD warning pill:

```svelte
{#if !isSingleAssetComposite(composite ?? naturalDefault) && multiCogLayers.length * 3 > 300}
	<div class="rounded bg-yellow-900/80 px-2 py-1 text-xs text-yellow-200">
		{t('map.multiCogMosaicHeavy')}
	</div>
{/if}
```

- [ ] **Step 7: Add i18n keys**

In `src/lib/i18n/en.ts`:

```ts
'map.multiCogMosaicHeavy': 'Multi-asset mosaic with many items, performance may degrade',
```

In `src/lib/i18n/ar.ts`:

```ts
'map.multiCogMosaicHeavy': 'فسيفساء متعددة الأصول مع عدد كبير من العناصر، قد يتأثر الأداء',
```

- [ ] **Step 8: Run check**

Run: `pnpm -w run check`
Expected: PASS.

- [ ] **Step 9: Run lint + format**

Run: `pnpm -w run format && pnpm -w run lint:fix`
Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add \
	src/lib/components/viewers/StacMosaicViewer.svelte \
	src/lib/i18n/en.ts \
	src/lib/i18n/ar.ts
git commit -m "feat(viewers/mosaic): true multi-asset RGB mosaic via per-item MultiCOGLayer

When the unified composite spans more than one asset, every
committed item renders as its own MultiCOGLayer (band 0 only;
library limitation). Single-asset composites stay on the fast
MosaicLayer path. LRU cache eviction is keyed by (itemId,
assetKey) and driven by commitSources() diffs since
MosaicLayer.onTileUnload is unavailable on the multi-asset
path. HUD pill warns when item count * 3 > 300."
```

---

## Task 11: Update directory CLAUDE.md docs

**Files:**
- Modify: `src/lib/components/viewers/CLAUDE.md`
- Modify: `src/lib/utils/CLAUDE.md`

- [ ] **Step 1: `src/lib/components/viewers/CLAUDE.md`**

Find the row for `CogControls` in the per-viewer table. Replace the entire description with:

```
| CogControls | Shared style/picker panel mounted by CogViewer, MultiCogViewer, and StacMosaicViewer. Single prop shape (`assets: CogAsset[]`, `composite: ChannelComposite`, `presets: PresetDef[]`, plus mode toggle for the legacy single-band ramp branch). Renders a top-of-panel preset `<select>` (Natural color / False-color IR / SWIR / Vegetation / Agriculture, NDVI intentionally excluded), then three `ChannelPicker` rows (R/G/B, optional A) when mode='rgb', then the existing single-band ramp picker (107-entry sprite, search, pinned grid) when mode='single'. The band column inside each ChannelPicker auto-collapses to plain `Band 1` text when the chosen asset's `bandCount === 1`, so Sentinel-2 / Landsat per-band assets read as one clean row while NAIP `image` / S2 `visual` exposes the full band picker. Histogram overlay + rescale slider unchanged. |
```

Add a row after `CogControls` for `viewers/cog/`:

```
| viewers/cog/ | 2 | ChannelPicker (one row, two dropdowns) + buildRgbLayer (COGLayer ↔ MultiCOGLayer dispatch). | CogControls, MultiCogViewer, StacMosaicViewer |
```

In the mermaid diagram, add an edge `CC --> CHP[ChannelPicker]` and `CC --> BRL[buildRgbLayer]` under the viewers subgraph.

- [ ] **Step 2: `src/lib/utils/CLAUDE.md`**

Add two rows to the file table:

```
| `cog-asset.ts` | `CogAsset`, `ChannelRef`, `ChannelComposite`, `extractCogAssets()`, `syntheticSelfAsset()`, `pickNaturalColorComposite()` (visual-asset → rgb-bands → fallback priority), `isSingleAssetComposite()`, `allChannelsBand0()`. Pure TS, no Svelte. Reads `raster:bands.length` and `eo:bands` without network. Published via objex-utils. | CogViewer (synthetic self asset), MultiCogViewer, StacMosaicViewer, CogControls, lib/index.ts |
| `channel-composite.ts` | `PresetDef`, `PRESETS` (Natural color / False-color IR / SWIR / Vegetation / Agriculture; NDVI deliberately excluded), `availablePresets(assets)`, `applyPreset(assets, preset)`, `compositeFromUrl(params, assets)`, `compositeToUrl(composite, presetId)`, `presetMatchesComposite()`. Pure TS. URL format: `r=&g=&b=&band_r=&band_g=&band_b=&a=&band_a=&preset=` with `band_*` defaulting to 0 so legacy MultiCog URLs round-trip. | MultiCogViewer, StacMosaicViewer, lib/index.ts |
```

In the mermaid diagram, add `CA[cog-asset.ts]` and `CCM[channel-composite.ts]` under the "Published (npm)" subgraph; add edges `CA --> CCM` and `STAC --> CA`.

- [ ] **Step 3: Commit**

```bash
git add \
	src/lib/components/viewers/CLAUDE.md \
	src/lib/utils/CLAUDE.md
git commit -m "docs(claude-md): unified RGB picker components + utils

CogControls is now single-prop-shape across CogViewer, MultiCog,
and StacMosaicViewer. Adds rows for cog-asset.ts and
channel-composite.ts to utils/CLAUDE.md. Adds viewers/cog/
to viewers/CLAUDE.md."
```

---

## Task 12: End-to-end manual exercise

This is the functional gate. The project has no test runner, so manual exercise is the verification step. Run the dev server and walk through every entry point.

- [ ] **Step 1: Start the dev server**

```bash
pnpm dev
```

Wait for `Local:   http://localhost:5173/`.

- [ ] **Step 2: Pre-flight static gate**

In a second terminal:

```bash
pnpm -w run format && pnpm -w run lint:fix && pnpm -w run check
```

All three must pass. If they don't, stop and fix before exercising.

- [ ] **Step 3: CogViewer — single bare COG file**

- Open a NAIP single COG URL (any 4-band uint8 COG you have access to). The Style panel should open with `RGB` mode active, three `ChannelPicker` rows showing `self · 4 bands`, and a band picker that defaults to bands 1/2/3.
- Switch the band picker on R to band 4 (NIR) to confirm false-color rendering.
- Switch to `Single band` mode. The ChannelPicker rows hide; the band+ramp picker appears. Pick band 4 and `viridis`. Confirm rendering.
- Reload with the band-4 URL hash present. Confirm the picker rehydrates.

- [ ] **Step 4: MultiCogViewer — STAC Item**

- Open an Element84 S2 L2A item URL. Style panel: preset = Natural color, three ChannelPicker rows = `red`/`green`/`blue` each with `Band 1` static label. Confirm true-color render.
- Switch preset to False-color IR. Confirm preset shows `nir`/`red`/`green` in rows.
- Manually change R to `swir22`. Preset jumps to `Custom`.
- Manually pick `visual` for R. The R band column becomes a 3-option picker.
- Reload. URL `#map?r=swir22&g=red&b=green&preset=` round-trips.

- [ ] **Step 5: MultiCogViewer — NAIP STAC Item**

- Open a NAIP STAC item URL. Style panel: only one COG asset (`image`), so the ChannelPicker rows all show `image · 4 bands` with their full band picker.
- Default composite uses bands 0/1/2 (the visual-asset priority path).
- Pick band 4 on R for false-color.

- [ ] **Step 6: MultiCogViewer — Landsat C2 L2 STAC Item**

- Open a Landsat item URL. Same per-band style as S2 (no `visual` asset available for this collection on Element84).
- Confirm Natural color = `red`/`green`/`blue` resolved via common-name.

- [ ] **Step 7: StacMosaicViewer — single-asset path**

- Open a S2 L2A FeatureCollection / Collection URL.
- Default = Natural color via single `visual` asset (priority 1). MosaicLayer renders.
- Switch composite manually to a single-asset multi-band variant (`visual` band order swap). Confirm rendering updates without re-querying viewport.
- Pan the map. Confirm tile cache eviction (memory does not grow without bound).

- [ ] **Step 8: StacMosaicViewer — multi-asset path**

- Open a Landsat C2 L2 Collection URL (no pre-baked `visual`, defaults to per-band common-name → multi-asset path).
- Default = Natural color across `red`/`green`/`blue` assets, rendering through per-item MultiCOGLayer.
- Confirm console has no abort-error spam during pan.
- Confirm the HUD pill warning fires when item count × 3 > 300 (raise `mosaicItemLimit` if needed to test).
- Switch back to a single-asset composite (preset that resolves to one asset, e.g. by manually picking `red` on R/G/B). Layer set should atomically swap to MosaicLayer.

- [ ] **Step 9: URL round-trip across reloads**

For each of the four viewer types above, copy the URL from the address bar, open a new tab, paste, reload. The same composite + preset should rehydrate.

- [ ] **Step 10: Confirm objex-utils still builds**

```bash
pnpm --filter @walkthru-earth/objex-utils run build
```
Expected: PASS.

- [ ] **Step 11: Confirm package builds**

```bash
pnpm -w run package
grep -r '\$lib/' dist/ --include='*.js' | head -5
```
Expected: package builds, grep finds nothing.

- [ ] **Step 12: Final commit IF any docs / fixes needed**

If manual exercise surfaced any minor docs gap or wording fix:

```bash
git add -A
git commit -m "fix: address manual exercise feedback"
```

If everything is clean, no commit needed.

---

## Self-review checklist

- [x] **Spec coverage**:
  - CogAsset model → Task 1
  - presets + URL round-trip → Task 2
  - exports → Task 3
  - ChannelPicker → Task 4
  - buildRgbLayer dispatch → Task 5
  - CogControls collapse → Task 6
  - CogViewer migration → Task 7
  - MultiCogViewer migration → Task 8
  - StacMosaicViewer single-asset → Task 9
  - StacMosaicViewer multi-asset → Task 10
  - CLAUDE.md docs → Task 11
  - manual exercise → Task 12
- [x] **No placeholders**: every code block contains real implementation; no "TBD" or "implement later".
- [x] **Type consistency**: `CogAsset`, `ChannelRef`, `ChannelComposite`, `PresetDef` names are stable across all tasks. `extractCogAssets`, `pickNaturalColorComposite`, `isSingleAssetComposite`, `allChannelsBand0` signatures match between Task 1 (definition) and Tasks 4-10 (consumers). `compositeFromUrl` / `compositeToUrl` parameter shapes match between Task 2 (definition) and Tasks 8-10 (consumers).
- [x] **Build sequence**: tasks 6-9 share one commit so HEAD always builds (CogControls' breaking prop change is paired with all three callers in one commit).
- [x] **Verification gates**: every task ends with `pnpm -w run check` + `pnpm -w run lint:fix` + `pnpm -w run format`. The plan acknowledges there is no test runner in this project.
- [x] **Cleanup contract**: viewers retain `tabResources.register(tab.id, cleanup)` + `onDestroy(cleanup)`. Eviction symmetry on the multi-asset mosaic path is explicitly wired in Task 10 step 5.
