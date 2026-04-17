# Sentinel-2 MultiCOG Viewer, Design Doc

Status, draft. Not yet implemented. No code changes, no package changes.

## 1. Goal

Render a Sentinel-2 L2A scene as user-selectable band composites inside an objex tab, powered by `MultiCOGLayer` from `@developmentseed/deck.gl-geotiff` v0.5. The viewer takes a set of per-band COG URLs (B02, B03, B04, B08, B11, B12, optionally B8A) and composes them on the GPU into preset RGB outputs (True Color, False-Color IR, SWIR, Vegetation, Agriculture). Per-band rescale controls drive the `LinearRescale` shader module, and a `FilterNoDataVal` stage masks scene edges. Reuses our existing `utils/cog.ts` helpers (`clampBounds`, `fitCogBounds`, `cleanupNativeBitmap`, `safeClamp`) and the `MapContainer` component. NDVI, cloud masking, and custom reprojection stay out of scope.

## 2. Entry Points

Three candidate triggers, listed by recommended order.

**Primary, STAC Item URL.** User pastes or opens a URL pointing at a STAC Item JSON (Microsoft Planetary Computer, Element 84, AWS S2 L2A public bucket). File extension is `.json` but the viewer is selected by shape, not extension. Detection runs in `utils/url.ts` or a new `utils/stac.ts` via a lightweight fetch that parses `stac_version`, `assets`, and checks for a Sentinel-2 collection id pattern (`sentinel-2-l2a`, `S2_L2A`). If matched, `ViewerRouter` routes to `SentinelScenesViewer` instead of `CodeViewer`. Band URLs come from `item.assets[BXX].href`.

**Secondary, folder of band TIFFs.** A directory containing `B02.tif`, `B03.tif`, `B04.tif`, `B08.tif` (case-insensitive) detected by `FileBrowser` or `FileTreeSidebar`, producing a virtual "Sentinel-2 scene" entry, similar to the current Zarr directory detection pattern (marker files trigger folder promotion). The URL scheme is the folder path itself. Simple, offline-friendly, does not require STAC.

**Tertiary, manual composition.** A new "Compose scene" command in the file tree context menu that lets users pick 4 to 6 band files and builds an in-memory band map. Lowest priority, builds on the secondary path.

Recommendation, ship the **Primary STAC Item** path first. It covers the most common use case (Planetary Computer links) and the detection logic is a single JSON fetch with a fallback to `CodeViewer` on miss. Add the folder detector in a follow-up.

## 3. Layer Shape

Code sketch only, illustrative, not a final implementation.

```ts
import { MultiCOGLayer } from '@developmentseed/deck.gl-geotiff';
import { LinearRescale, FilterNoDataVal } from '@developmentseed/deck.gl-raster';
import { clampBounds, fitCogBounds } from '../../utils/cog.js';

// Band URL map built from STAC Item or folder listing
type BandSlot = 'red' | 'green' | 'blue' | 'nir' | 'swir1' | 'swir2' | 'rededge';
type BandMap = Partial<Record<BandSlot, string>>;

// Preset, resolved to slot names in `sources`
interface Preset {
  id: 'true-color' | 'false-color-ir' | 'swir' | 'vegetation' | 'agriculture';
  label: string;
  composite: { r: BandSlot; g: BandSlot; b: BandSlot };
}

const PRESETS: Preset[] = [
  { id: 'true-color',     label: 'True Color',        composite: { r: 'red',   g: 'green', b: 'blue'  } },
  { id: 'false-color-ir', label: 'False-Color IR',    composite: { r: 'nir',   g: 'red',   b: 'green' } },
  { id: 'swir',           label: 'SWIR',              composite: { r: 'swir2', g: 'swir1', b: 'red'   } },
  { id: 'vegetation',     label: 'Vegetation',        composite: { r: 'nir',   g: 'swir1', b: 'red'   } },
  { id: 'agriculture',    label: 'Agriculture',       composite: { r: 'swir1', g: 'nir',   b: 'blue'  } },
];

// Build sources object from the band map
const sources = Object.fromEntries(
  Object.entries(bandMap).map(([slot, url]) => [slot, { url }])
);

const layer = new MultiCOGLayer({
  id: `s2-multicog-${tab.id}`,
  sources,
  composite: activePreset.composite,
  renderPipeline: [
    { module: FilterNoDataVal, props: { noDataVal: 0 } },
    { module: LinearRescale,    props: {
      rescaleMin: rescale.min, // e.g. 0.0
      rescaleMax: rescale.max, // e.g. 0.3 for L2A reflectance
    } },
  ],
  onGeoTIFFLoad: (_tiff, { geographicBounds }) => {
    const clamped = clampBounds(geographicBounds);
    if (!hasFittedOnce) { fitCogBounds(map, clamped); hasFittedOnce = true; }
  },
});
```

Notes on pipeline behavior.

- `FilterNoDataVal` with `noDataVal: 0` zeroes out scene-edge stripes (S2 L2A uses 0 for no-data).
- `LinearRescale` takes already-normalized RGB (0 to 1 range) from the default uint16 pipeline. Sentinel-2 L2A reflectance is scaled uint16 (divide by 10000 for reflectance), default library normalization handles the first step. A reasonable slider range is 0.0 to 0.4.
- `MultiCOGLayer` handles 10 m (B02, B03, B04, B08) and 20 m (B05, B11, B12) resolution mixing on the GPU, no manual resampling needed.
- No custom `getTileData` or `renderTile`, the library default uint pipeline applies because S2 L2A bands are uint16 SampleFormat 1.

## 4. UI

Two options.

**Option A, reuse `CogControls.svelte` with a new mode.** Add a `'multicog'` mode to `BandConfig` or a sibling `MultiCogConfig` type. Add preset dropdown at the top, replace the per-channel band picker with per-slot rescale sliders. Feasible but couples two unrelated panels.

**Option B, new `MultiCogControls.svelte` sub-component.** Preferred. Clean slate, avoids polluting the single-COG controls. Shape below.

```svelte
<!-- MultiCogControls.svelte, sketch -->
<script lang="ts">
  import type { Preset } from '../../utils/multicog.js';
  let { presets, activePresetId, rescale, onPresetChange, onRescaleChange }: {
    presets: Preset[];
    activePresetId: string;
    rescale: { min: number; max: number };
    onPresetChange: (id: string) => void;
    onRescaleChange: (r: { min: number; max: number }) => void;
  } = $props();
</script>

<!-- preset dropdown, min slider, max slider, reset button -->
```

Panel lives in the same top-right slot as `CogControls`, toggled by a "Style" button in the overlay badge row. Same visual language as `CogViewer`.

For v1, one global `rescaleMin` / `rescaleMax` pair applied to all 3 channels. Per-band rescale is future work (would need 3 separate `LinearRescale` stages or a custom `CompositeBands` wrapping module).

## 5. Viewer File Plan

**New files.**

- `src/lib/components/viewers/SentinelScenesViewer.svelte`, top-level viewer, follows the project viewer pattern (abortController, `tabResources.register`, `$state.raw`, `onDestroy(cleanup)`, generation counter after awaits). Reads the STAC Item JSON (or folder listing) via the storage adapter, builds the `BandMap`, constructs `MultiCOGLayer`, installs via `MapboxOverlay` on the shared `MapContainer`.
- `src/lib/components/viewers/MultiCogControls.svelte`, preset dropdown plus rescale sliders, emits change events to the parent.
- `src/lib/utils/multicog.ts`, pure module, exports `PRESETS`, `BandMap`, `BandSlot`, `Preset`, `parseStacItem(item)`, `discoverBandFolder(entries)`. No Svelte deps, publishable through `lib/index.ts` and `packages/objex-utils`.

**Files to update.**

- `src/lib/components/viewers/ViewerRouter.svelte`, add a route branch when the incoming tab is detected as a Sentinel-2 scene. Detection happens upstream (see below), this file just dispatches on a `tab.kind` value like `'sentinel-scene'` or a new flag on `Tab`.
- `src/lib/utils/url.ts` or new `src/lib/utils/stac.ts`, add `detectStacItem(url, signal)` returning `{ isSentinel2L2a, bandMap }` or null. Called from `openUrlTab()` in `+page.svelte` and from `FileBrowser` when a JSON file is double-clicked.
- `src/lib/file-icons/` registry, add an icon mapping for the synthetic `sentinel-scene` kind (reuse the raster icon, or add a dedicated S2 tile icon).
- `src/lib/components/viewers/CLAUDE.md`, add a row for `SentinelScenesViewer` in the viewer table with `utils/multicog`, `utils/cog`, `MultiCogControls` as deps.
- `src/lib/components/viewers/CogViewer.svelte` stays untouched. The new viewer is a sibling, not a mode of the existing one.
- `src/lib/utils/CLAUDE.md`, add `multicog.ts` to the Published table.
- `src/lib/index.ts` and `packages/objex-utils/src/index.ts`, export the new pure utilities.

**Pattern compliance checklist for the new viewer.**

- `let { tab }: { tab: Tab } = $props()`.
- `let data = $state.raw<BandMap | null>(null)`.
- One `$effect` per tab change, abort on cleanup, generation counter guarding every `await`.
- `tabResources.register(tab.id, cleanup)` inside the `$effect`.
- `AbortController` passed to all `adapter.read()` and `fetch()` calls.
- Cleanup nulls `mapRef`, `overlayRef`, all GeoTIFF refs, removes the overlay from MapLibre.
- `onDestroy(cleanup)` as a safety net.
- All user-facing strings through `t()` from `i18n`.
- Relative imports only (`../../utils/cog.js`), no `$lib/`.

## 6. Unknowns and Open Questions

1. **STAC Item discovery shape.** Different Sentinel-2 STAC providers use different asset keys (`B02` vs `blue` vs `visual`). Do we hardcode a provider map (MS PC, Element 84, AWS), do we rely on `eo:bands` common-name fields, or do we ask users to point at specific band URLs? Recommendation, start with `eo:bands.common_name` parsing and fall back to key-name heuristics.
2. **Where does the folder detector live.** Zarr uses marker files and a probe in `FileBrowser`. Do we follow the same pattern for S2 band folders, or do we keep discovery STAC-only for v1?
3. **Is this viewer visible in the published npm package.** `CogViewer` and most viewers ship. This one pulls `MultiCOGLayer` which adds footprint. Publish as part of `@walkthru-earth/objex` or keep it app-only in `src/routes/`?
4. **Rescale range ergonomics.** Sentinel-2 L2A uint16 reflectance divided by 10000 means a "0 to 0.3" slider gives the UI experience users expect. Do we label the slider as reflectance (0.0 to 1.0) or as raw DN (0 to 10000)? Affects whether the control shows decimals.
5. **Projection safety net.** S2 L2A scenes are per-UTM-zone (32601 through 32660). `CogViewer` resolves proj4 defs via `resolveProj4Def` and epsg.io. Do we assume `MultiCOGLayer` handles that internally through its own `epsgResolver`, or do we pre-wire one using `@developmentseed/epsg` + `parseWkt` to avoid network calls? Upstream `sentinel-2` example does not configure one explicitly, worth confirming before shipping.

## 7. Out of Scope

Explicitly excluded from this design.

- **NDVI and other index shaders.** NDVI needs a custom inline shader module (`color.r = (nir - red) / (nir + red)`), the pattern from the `naip-mosaic` upstream example. That is a separate design and may share the preset dropdown but writes its own `renderPipeline` with a custom module. Revisit after v1 ships.
- **Reprojection customization.** The library handles CRS via its built-in `epsgResolver`. No custom `RasterReprojector` wiring, no `makeClampedForwardTo3857` override. UTM-zone Sentinel-2 scenes are covered by the default path.
- **Cloud masking via SCL band.** The L2A Scene Classification Layer (`SCL`) would drive a `MaskTexture` shader stage. Not included in v1, requires an extra COG slot, a UI toggle for classes, and a LUT build step.
- **Thermal or Sentinel-1 SAR.** Different sensors, different pipelines.
- **Write-back or export.** Read-only rendering.
- **Pixel inspector.** `CogViewer` has one via `readPixelAtLngLat`. Adding it for 6+ bands is doable but not in v1.

## 8. Risk and Size Estimate

- `MultiCOGLayer` is new to objex. Expect one or two sessions spent tracing the default pipeline and confirming rescale behavior on S2 L2A tiles.
- STAC Item parsing is 100 to 200 lines of pure TS, testable in isolation.
- Viewer component mirrors `CogViewer` structure, roughly 250 to 350 lines. Controls around 100 lines.
- Total, small-to-medium feature, 1 to 2 working days once the unknowns in section 6 are decided.
