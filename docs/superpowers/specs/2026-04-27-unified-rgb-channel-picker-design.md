# Unified RGB Channel Picker — Design

Date: 2026-04-27
Status: approved, scope locked

## Scope decisions (locked 2026-04-27)

1. **Mosaic**: true multi-asset mosaic from day one. Each item in the mosaic renders through `MultiCOGLayer` (or `COGLayer` when the composite collapses to one asset). The legacy single-asset `MosaicLayer` path is replaced by a per-item layer factory wired through a new `StacItemLayer` set built from the same `buildRgbLayer` helper used by `CogViewer` / `MultiCogViewer`.
2. **NDVI preset**: hidden entirely. Not in the preset list. Wire in a follow-up slice.
3. **`Single band` mode**: kept as an explicit toggle inside `CogControls` (not folded into a preset). Single-band rendering with colormap stays reachable from the panel as it is today.

## Problem

Three viewers expose RGB controls with three different shapes:

- `CogViewer` (single COG file, no STAC item): three `[Band ▾]` dropdowns (R/G/B band index inside the file).
- `MultiCogViewer` (STAC Item with ≥3 single-band raster COG assets): three `[Asset ▾]` dropdowns (R/G/B is the STAC asset key, band index is hardcoded to 0).
- `StacMosaicViewer` (catalog of items, single asset across the mosaic): one global `[Asset ▾]` plus three `[Band ▾]` dropdowns inside `CogControls` mode='single'.

Real STAC behaviour, confirmed against Element84 Earth Search:

| Collection | Asset shape |
|---|---|
| `sentinel-2-l2a` | Hybrid: 13 single-band COGs (`red`/`green`/`blue`/...) + a pre-baked 3-band `visual` (TCI.tif uint8). `raster:bands` populated. |
| `landsat-c2-l2` | Pure single-band-per-asset. `raster:bands` populated. |
| `naip` | Pure multi-band: one `image` asset, 4 bands `[red, green, blue, nir]` in one COG. `raster:bands` populated. |
| `sentinel-1-grd` | Single-band per polarization (`vh`, `vv`). |
| `cop-dem-glo-30/90` | Single-band DEM. |

Today's split UI cannot:

- Pick band 4 (NIR) of NAIP's `image` asset (MultiCogViewer assumes single-band; CogViewer has no asset context).
- Compose mixed channels in S2 where one channel comes from `visual` band 0 and another from a separate single-band asset.
- Reuse preset / URL / channel-state logic across viewers.

## Solution

The canonical pixel coordinate in STAC is `(asset_key, band_index)`. Make every channel `[Asset ▾][Band ▾]`. Same shape across all three viewers. Auto-pick the most natural and most performant default. Layer choice (`COGLayer` vs `MultiCOGLayer`) becomes a runtime detail, not a viewer mode.

## Default selection (priority order, picked once on item load)

1. **Pre-baked 3-band uint8 COG present** (`visual` / `image` / `tci`, `bandCount === 3`, `eo:bands.common_name ⊇ {red,green,blue}` or roles include `visual`): R/G/B all bind to that asset, bands 0/1/2. Single `COGLayer` path. One COG, one decoder, no per-channel range-request fanout. Fastest. Covers NAIP `image`, S2 `visual`, Maxar TCI.
2. **Common-name `red`/`green`/`blue` resolvable across separate single-band assets**: R/G/B bind to those three assets, band 0 each. `MultiCOGLayer` path. Covers Landsat C2 L2, S2 per-band, HLS.
3. **Fallback**: first three raster assets in declaration order, band 0 each.

User never has to pick anything to see natural color. URL hash (`#map?r=...&g=...&b=...&band_r=...&preset=...`) overrides default when present and asset keys still exist on the current item.

## Presets (top of style panel)

Single `Preset ▾` above the channel rows:

- `Natural color` (default, computed by priority above)
- `False-color IR` (NIR/Red/Green)
- `SWIR` (SWIR2/SWIR1/Red)
- `Vegetation` (NIR/SWIR1/Red)
- `Agriculture` (SWIR1/NIR/Blue)
- `Custom` (auto-selected when user manually edits any channel)

NDVI / single-band derived presets are explicitly **not** in the list for this slice. They will be wired as a follow-up.

Presets that don't resolve on the current item are hidden. Preset application calls `resolvePresetComposite(assets, slotTriple)` (already exists) and writes the resolved `(asset, band)` pairs into channel state.

## Component / module surface

### New: `src/lib/components/viewers/cog/ChannelPicker.svelte`

One row, two dropdowns. Props:

```ts
type ChannelPickerProps = {
  channel: 'r' | 'g' | 'b' | 'a';
  label: string;            // 'R' / 'G' / 'B' / 'A'
  colorClass: string;       // 'text-red-400' etc
  assets: CogAsset[];       // see below
  assetKey: string;
  bandIndex: number;
  onChange: (next: { assetKey: string; bandIndex: number }) => void;
  allowNone?: boolean;      // alpha row
};
```

Behaviour:

- Asset `<select>`: lists every asset in `assets`. Shows `key (commonName)` if `commonName` known, plus a `bands=N` suffix when `N > 1`.
- Band column: when `assetByKey(assetKey).bandCount === 1`, render plain text `Band 1` (no `<select>`). Otherwise render a `<select>` with `Band 1..N`. Ensures Sentinel-2 / Landsat (90% case) reads as three uniform rows of single-asset picks, while NAIP / S2 `visual` exposes the full band picker.
- `allowNone` (alpha): adds `(none)` option that emits `assetKey: ''`.

Used by `CogViewer`, `MultiCogViewer`, `StacMosaicViewer` via `CogControls`.

### New: `src/lib/utils/cog-asset.ts`

Pure TS, no Svelte deps. Single source of truth for the asset model used by all three viewers.

```ts
export interface CogAsset {
  key: string;              // STAC asset key, or 'self' for plain CogViewer
  href: string;
  bandCount: number;        // from raster:bands.length, else 1 until probed
  dtype?: string;           // raster:bands[0].data_type when known
  eoCommon: string[];       // eo:bands[].common_name (lowercased), aligned to bandIndex
  roles: string[];
  bandCountKnown: boolean;  // false → lazy-probe on first use
}

export function extractCogAssets(item: StacItem): CogAsset[];
// Filter: image/tiff* AND not (roles ∋ thumbnail|overview|metadata).
// No bandCount filter — keep both visual (3) and per-band (1).

export function syntheticSelfAsset(href: string, probedBandCount?: number): CogAsset;
// For CogViewer: { key: 'self', href, bandCount: probedBandCount ?? 1, ... }

export function pickNaturalColorComposite(assets: CogAsset[]): {
  composite: ChannelComposite;
  source: 'visual-asset' | 'rgb-bands' | 'fallback';
} | null;
// Implements the priority list above.

export function isSingleAssetComposite(c: ChannelComposite): boolean;
// True when c.r.assetKey === c.g.assetKey === c.b.assetKey. Drives layer dispatch.
```

`extractRasterBandAssets()` and `extractMosaicAssets()` in `utils/stac.ts` are kept as thin wrappers over `extractCogAssets()` for backwards compatibility (objex-utils consumers), filtering as before. Internally all three viewers move to `extractCogAssets()`.

### New: `src/lib/utils/channel-composite.ts`

Pure TS. State shape, preset resolution, URL round-trip.

```ts
export type ChannelRef = { assetKey: string; bandIndex: number };
export type ChannelComposite = { r: ChannelRef; g: ChannelRef; b: ChannelRef; a?: ChannelRef };

export interface PresetDef {
  id: string;
  labelKey: string;
  slots: { r: BandSlot; g: BandSlot; b: BandSlot };
}

export const PRESETS: PresetDef[] = [...];           // moved from MultiCogViewer

export function availablePresets(assets: CogAsset[]): PresetDef[];
export function applyPreset(assets: CogAsset[], preset: PresetDef): ChannelComposite | null;
export function compositeFromUrl(params: URLSearchParams, assets: CogAsset[]): ChannelComposite | null;
export function compositeToUrl(c: ChannelComposite, presetId: string | null): URLSearchParams;
export function presetMatchesComposite(p: PresetDef, c: ChannelComposite, assets: CogAsset[]): boolean;
```

URL hash format: `#map?r=red&band_r=0&g=green&band_g=0&b=blue&band_b=0&preset=true-color`. `band_*` defaults to 0 when absent (preserves the existing `?r=&g=&b=` shape so old shareable links keep working).

### New: `src/lib/components/viewers/cog/buildRgbLayer.ts`

```ts
export function buildRgbLayer(opts: {
  id: string;
  assets: CogAsset[];
  composite: ChannelComposite;
  rescale: RescaleConfig;
  presignHref: (href: string) => Promise<string>;
  pool: DecoderPool | null;
  epsgResolver: EpsgResolver;
  signal: AbortSignal;
  onLoad?: (info: { bounds: GeoBounds }) => void;
}): Promise<COGLayer | MultiCOGLayer>;
```

Decision rule:

- `isSingleAssetComposite(composite) && allChannelsBand0(composite)` → caller's existing `CogViewer` path (set `bandConfig` on the existing `COGLayer`). Don't construct here; return a `BandConfig` patch instead so the caller updates the live layer in place.
- `isSingleAssetComposite(composite) && !allChannelsBand0(composite)` → `COGLayer` with `bandConfig: { mode: 'rgb', rBand, gBand, bBand }` from the chosen bands.
- Otherwise → `MultiCOGLayer` with `composite: { r: assetKeyR, g: assetKeyG, b: assetKeyB }` and band 0 (current limitation; flagged as Known Limitation below).

This collapses today's two parallel layer-build paths (`CogViewer.buildLayer` and `MultiCogViewer.buildAndAddLayer`) into one helper. Each viewer's `$effect` calls it the same way.

### Modified: `src/lib/components/viewers/CogControls.svelte`

The discriminated-union (`mode='single' | 'multi'`) collapses to one shape:

```ts
type Props = {
  assets: CogAsset[];
  composite: ChannelComposite;
  onCompositeChange: (next: ChannelComposite) => void;
  presets: PresetDef[];
  activePresetId: string;
  onPresetChange: (id: string) => void;
  rescale: RescaleConfig;
  rescaleApplicable: boolean;
  onRescaleChange: (r: RescaleConfig) => void;
  histogram?: Uint32Array | null;
  // single-band-with-colormap branch (kept; only renders when composite collapses to 1 band)
  singleBand?: { band: number; colorRamp: ColorRampId } | null;
  onSingleBandChange?: (s: { band: number; colorRamp: ColorRampId }) => void;
};
```

Rendering tree:

1. `Preset ▾` (when `presets.length > 0`)
2. Three `<ChannelPicker>` rows (R/G/B), optional 4th (A) if `composite.a` is set or the panel exposes an "add alpha" affordance — keep the current MultiCog parity (always show A row when `assets.length ≥ 4`).
3. Mode toggle (`RGB` / `Single band`) — kept as today. When `Single band` is selected, the three `ChannelPicker` rows hide and a single band selector + ramp picker appears in their place.
4. Single-band band selector + ramp picker (107-entry sprite, search, pinned grid) — rendered when mode is `Single band`. Identical to today's panel.
5. Rescale slider with histogram overlay.

### Modified: `src/lib/components/viewers/CogViewer.svelte`

- Drops its own band-selector logic, passes `[syntheticSelfAsset(href, probedBandCount)]` as `assets` and a `composite` derived from current `bandConfig`.
- Probes the file's `geotiff.count` once on first tile (existing behaviour); when known, updates the synthetic asset's `bandCount` so the band dropdown becomes interactive.
- `onCompositeChange` writes back into `bandConfig` (single-asset path).

### Modified: `src/lib/components/viewers/MultiCogViewer.svelte`

- `PRESETS`, `setPreset`, `setChannel`, `syncCompositeToUrl` deleted; replaced by `channel-composite.ts` exports.
- `composite` state moves from `AssetComposite` to `ChannelComposite` (gains per-channel `bandIndex`, defaults 0).
- `buildAndAddLayer` becomes a thin call to `buildRgbLayer`.
- The standalone preset `<select>` in the top-right corner is removed; preset lives inside `CogControls` only.
- Default preset selection on load uses `pickNaturalColorComposite()` instead of hardcoded `'true-color'`.

### Modified: `src/lib/components/viewers/StacMosaicViewer.svelte`

This is the largest delta. Today's mosaic uses `MosaicLayer` (single-asset-per-source). With true multi-asset mosaic from day one, every item in the mosaic needs to render through whichever layer the composite implies:

- Single-asset composite (all R/G/B point to same asset) → keep `MosaicLayer` for that case (fastest path; preserves today's behaviour for S2 `visual` mosaic, NAIP, single-band-per-asset mosaics).
- Multi-asset composite (R/G/B point to different assets) → switch to a per-item `MultiCOGLayer` set. Render mode dispatched by `isSingleAssetComposite(composite)`.

**Architecture for multi-asset mosaic:**

- New helper `buildMosaicLayers(items, composite, ...)` returns either `[MosaicLayer]` (single-asset path, today's behaviour) or `[MultiCOGLayer, MultiCOGLayer, ...]` (one per item, multi-asset path).
- The per-item `MultiCOGLayer` path loses `MosaicLayer`'s automatic tile-cache eviction. Compensate by:
  - Capping the rendered set to `mosaicItemLimit` (existing setting).
  - Bounding `geotiffCache` and `presignCache` via `LruCache` (cap = SOURCE_CACHE_MAX = 64) keyed by `(itemId, assetKey)`.
  - Wiring each `MultiCOGLayer.onTileError` and `onTileUnload`-equivalent (range-aborts) into the same eviction signals MosaicLayer used.
  - Throttling layer rebuilds the same way `MultiCogViewer.scheduleLayerRebuild` does today (REBUILD_INTERVAL_MS = 750) so rescale-slider drags don't spawn N overlapping rebuilds.
- The mosaic asset picker (today's "Asset ▾" above the RGB toggle) is replaced by the same three `ChannelPicker` rows (and optional A row). Asset choice and band index are both independent per channel.
- `availableAssets` (mosaic-wide) is computed from `extractCogAssets(firstItemWithRasters)` and recomputed whenever a new item enters the committed set with assets the previous representative didn't have.
- On any composite change, the existing in-place swap path (today's `setMosaicAssetKey`) is generalized: `setMosaicComposite(next)` remaps `committedViews[].raw` through `buildMosaicSourceMeta` for every channel asset that changed, drops affected `geotiffCache` / `presignCache` entries, clears `bandConfig` + `probedBandCount`, and bumps `pipelineGen`. No viewport re-query, no pagination loss.
- URL round-trip uses the same `compositeFromUrl` / `compositeToUrl` shape (`r=&g=&b=&band_r=&band_g=&band_b=&preset=`).

**Performance ceiling for multi-asset mosaic** (documented, not enforced this slice): with N items and 3 distinct assets, the worst case is 3N COG range-request streams. The existing `mosaicItemLimit` (default 100) bounds N. If the user picks a composite that brings range request count above an empirical threshold (~300), surface a HUD warning. Tracker issue if a hard cap is needed later.

## Layer dispatch summary

| Composite shape | Layer | Status |
|---|---|---|
| 1 asset, 3 bands 0/1/2 | `COGLayer` (default rgb pipeline) | New default for NAIP/visual, today CogViewer-only |
| 1 asset, custom band indices | `COGLayer` with `bandConfig.{r,g,b}Band` | Today CogViewer-only |
| 3 distinct assets, all band 0 | `MultiCOGLayer` | Today MultiCogViewer's only mode |
| 3 distinct assets, custom band indices | `MultiCOGLayer` band-0-only | **Known Limitation** — would need library change. Disable band picker when `!isSingleAsset && bandCount > 1` and surface a tooltip. |
| Mosaic, single asset, any band index | `MosaicLayer` | New: per-band-index inside chosen asset |
| Mosaic, multi-asset, all band 0 | per-item `MultiCOGLayer` set | New, day one |
| Mosaic, multi-asset, custom band index | per-item `MultiCOGLayer` set, band-0-only on multi-asset rows | Same library limitation as MultiCog above |

## Performance plan

- `extractCogAssets()` reads `raster:bands.length` from STAC; **zero network** on item load for Element84 / MS Planetary Computer / Landsat C2 / NAIP (all populate it).
- When `raster:bands` is absent on an asset, mark `bandCountKnown: false`, default `bandCount` to 1, and **lazy-probe only the asset the user explicitly picks** (one COG header range request, cached in the existing `geotiffCache`).
- Default natural-color path always picks single-asset `visual` when available → one decoder pool, one COG, instead of three.
- No change to existing throttle (`REBUILD_INTERVAL_MS = 750`) on rescale/composite changes.

## URL round-trip

- New shape: `#map?r=<asset>&g=<asset>&b=<asset>&band_r=<n>&band_g=<n>&band_b=<n>&a=<asset>&band_a=<n>&preset=<id>`
- Backwards compatible: when `band_*` is absent, defaults to 0. Existing `?r=red&g=green&b=blue&preset=true-color` links keep working.
- `compositeFromUrl()` validates every asset key against current item's assets; falls back to natural-color default on any miss.

## Code-deletion / reuse audit

| Removed / inlined | Reason |
|---|---|
| `CogControls` `mode='multi'` branch | Subsumed by `ChannelPicker` rows |
| `MultiCogViewer.PRESETS`, `setPreset`, `setChannel`, `syncCompositeToUrl` | Moved to `channel-composite.ts`, shared across all three viewers |
| `MultiCogViewer` standalone preset `<select>` (top-right) | Lives in `CogControls` only |
| `CogViewer`'s ad-hoc `bandConfig` rgb selector logic | Replaced by `ChannelPicker` over synthetic `self` asset |
| `StacMosaicViewer` standalone "Asset ▾" header | Replaced by `ChannelPicker` rows (R is the asset choice; G and B slaved to R for now) |

| Kept / shared | Reason |
|---|---|
| `extractRasterBandAssets`, `extractMosaicAssets` | Public objex-utils API; reimplemented as wrappers over `extractCogAssets` |
| `resolveBandSlotAssetKey`, `resolvePresetComposite` | Used inside `applyPreset` |
| `buildBandRenderPipeline`, `RescaleConfig`, `LinearRescale` plumbing | No change |
| `geotiffCache`, `presignCache`, LRU eviction tied to `MosaicLayer.onTileUnload` | No change |

## Build sequence

1. Add `utils/cog-asset.ts` (`CogAsset`, `extractCogAssets`, `pickNaturalColorComposite`, `syntheticSelfAsset`, `isSingleAssetComposite`).
2. Add `utils/channel-composite.ts` (`PRESETS` minus NDVI, `availablePresets`, `applyPreset`, URL helpers). Move from MultiCogViewer.
3. Add `components/viewers/cog/ChannelPicker.svelte`.
4. Add `components/viewers/cog/buildRgbLayer.ts` (single-asset → COGLayer / patch existing layer; multi-asset → MultiCOGLayer).
5. Refactor `CogControls.svelte` to the new prop shape, drop discriminated union. Render three `ChannelPicker` rows + preset; keep the `RGB` / `Single band` toggle and the existing single-band ramp picker as-is.
6. Refactor `MultiCogViewer.svelte` to use new shared modules. Verify Element84 S2 + Landsat + NAIP items render correctly with new defaults. Verify URL round-trip backwards compatible.
7. Refactor `CogViewer.svelte` to use `ChannelPicker` over synthetic self-asset.
8. Refactor `StacMosaicViewer.svelte` — single-asset path (preserves today's `MosaicLayer` behaviour with the new `ChannelPicker` UI replacing the old "Asset ▾" header). Verify atomic asset swap still works.
9. Add multi-asset mosaic path to `StacMosaicViewer`: per-item `MultiCOGLayer` set when `!isSingleAssetComposite(composite)`. Wire LRU caches keyed by `(itemId, assetKey)`, throttle layer rebuilds on rescale-slider drags, dispatch by composite shape on every change.
10. Update `viewers/CLAUDE.md` and `utils/CLAUDE.md` with new file table entries, mermaid edges, and the unified panel description.
11. Run `pnpm -w run format && pnpm -w run lint:fix && pnpm -w run check`. Manually exercise: CogViewer (NAIP single-tif), MultiCogViewer (S2 item, NAIP item via STAC, Landsat item), StacMosaicViewer (S2 collection single-asset `visual`, S2 collection multi-asset `red/green/blue`, NAIP collection single-asset `image`, Landsat collection multi-asset `red/green/blue`). Confirm:
    - Default load shows natural color with no clicks.
    - Switching presets works on every collection where `availablePresets` is non-empty.
    - URL `#map?r=...&band_r=2&...` round-trips on reload.
    - Band dropdown collapses to plain text when `bandCount === 1`.
    - NAIP `image` exposes bands 1-4 in the dropdown; band 4 (NIR) selectable on R for false-color.
    - Multi-asset mosaic on Landsat C2 L2 renders without console floods, abort errors stay filtered, pan/zoom does not leak `MultiCOGLayer` instances.

## Known limitations / out of scope

- **Mixed-asset + custom band index per channel** is not supported (`MultiCOGLayer` reads band 0). Surface as a disabled band dropdown with a tooltip when the composite spans multiple assets and any of them has `bandCount > 1`.
- **NDVI preset** is hidden. Wiring single-band-derived expressions through the layer pipeline is a separate slice.
- **Eager probing of all assets** when `raster:bands` is absent is intentionally not done. Lazy probe only the picked asset.
- **Multi-asset mosaic memory ceiling**: per-item `MultiCOGLayer` instancing trades MosaicLayer's tile-cache eviction for a layer-instance-per-item model. Bounded by `mosaicItemLimit` and per-source LRU caches; document the soft warning threshold.

## Risks

- Mosaic refactor is invasive: replacing single-asset `MosaicLayer` with per-item `MultiCOGLayer` for multi-asset composites is the largest mechanical change in this slice. Risk surface: tile-cache eviction symmetry, abort controller scoping, layer-instance lifetime under pan/zoom. Land single-asset path first (which preserves `MosaicLayer`), then multi-asset, behind the same composite-shape dispatch.
- Removing `CogControls` discriminated union breaks any external consumer of `objex` lib that reads `mode='single' | 'multi'`. The components live in `src/lib/components/viewers/`, which IS published. Audit `lib/index.ts` exports — `CogControls` is not currently exported, so the change is internal.
- Single-band ramp UI moves from a top-level mode to a preset. Users with muscle memory for the `Single band` button lose it. Mitigation: keep the toggle as a hidden affordance in v1 or expose `Colorize single band` as a preset.

## Open questions for review

Resolved — see "Scope decisions" at top.
