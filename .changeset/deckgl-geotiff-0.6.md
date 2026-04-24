---
'@walkthru-earth/objex': minor
'@walkthru-earth/objex-utils': minor
---

Bump the `@developmentseed/deck.gl-geotiff` family to `0.6.0-alpha.1` and add two new viewers plus a dual-path Zarr renderer. No breaking changes to existing tabs, and CogViewer behavior is unchanged.

### What's new

- **StacMosaicViewer** (renamed from SentinelMosaicViewer, wrapped in a new `StacTabViewer`). `ViewerRouter` now detects STAC Items / FeatureCollections / Collections / Catalogs via a 256 KB adapter peek (`utils/stac.ts::classifyStac`) and mounts a tab wrapper with `Map` / `STAC Browser` / `JSON` buttons (URL hash `#map` / `#stac-browser` / `#code`, shareable). The user can always toggle back to the third-party stac-browser iframe. For Collection / Catalog inputs, `utils/stac-hydrate.ts::hydrateStacItems` walks `links[rel=item|child|next]` with a 12-way concurrency pool and a 2000-item cap, emitting progressive batches so the MosaicLayer starts rendering after ~1–2s. Each inner COG still runs through `selectCogPipeline`, so palette-indexed short-circuits, non-uint custom pipelines, LinearRescale, and `normalizeCogGeotiff` (overview strip + polar bbox clamp) all apply per scene. Shared `DecoderPool` and `createEpsgResolver` across every inner source.
- **MultiCogViewer.** STAC Item JSON routes here when `eo:bands.common_name` or MPC/Element 84/AWS asset-key heuristics identify at least the red/green/blue Sentinel-2 bands. Preset dropdown (True Color / False-Color IR / SWIR / Vegetation / Agriculture) drives the v0.6 `MultiCOGLayer.composite` prop, and a `FilterNoDataVal` + `LinearRescale` pipeline (0..0.3 default for L2A reflectance) mask scene edges and stretch contrast.
- **Zarr dual path.** `utils/zarr.ts::detectGeoZarr` inspects hierarchy attributes for the GeoZarr convention (`multiscales` + spatial + CRS). Matching stores render via `@developmentseed/deck.gl-zarr` `ZarrLayer` on `MapboxOverlay`; anything else falls through to the existing `@carbonplan/zarr-layer` path with its 10 k-tile guard and numcodecs codec aliases.
- **New utilities.** `utils/stac.ts` (STAC item/FeatureCollection shape checks, Sentinel band extraction, bbox helper). `utils/cog.ts` gains `buildMosaicSourceMeta`, `buildBandRenderPipeline` (composes `FilterNoDataVal` + `LinearRescale` in GPU-correct order). `utils/zarr.ts` gains `detectGeoZarr` and `zarrTileToImageData`.
- **CogControls `mode` prop.** Accepts `'single'` (default, full band + color-ramp UI) or `'multi'` (rescale slider only). MultiCogViewer uses the new mode; existing CogViewer is unchanged.

### Package bumps

`@developmentseed/deck.gl-geotiff`, `deck.gl-raster`, `geotiff`, `proj`, `epsg`: `^0.5.0 → ^0.6.0-alpha.1`. New deps: `@developmentseed/deck.gl-zarr@^0.6.0-alpha.1` (pulls in `@developmentseed/geozarr` transitively). `zarrita` bumped `^0.6.2 → ^0.7.1`, forced across the tree via `pnpm.overrides` so `@carbonplan/zarr-layer@^0.4.3` runs on the same major.

### Patches

`patches/@developmentseed__deck.gl-geotiff@0.5.0.patch` renamed and re-attached as `@0.6.0-alpha.1.patch`. Both hunks (proj4 `+over` antimeridian fix, `inferRenderPipeline` re-export) still apply unchanged, upstream tickets [#366](https://github.com/developmentseed/deck.gl-raster/issues/366) and [PR #374](https://github.com/developmentseed/deck.gl-raster/pull/374) remain open.

New patch `patches/@carbonplan__zarr-layer@0.4.3.patch` replaces two calls to `zarr.tryWithConsolidated()` with `Promise.resolve(baseStore)`. The helper was removed in zarrita 0.7, and the override above forces 0.7 across the tree, which otherwise surfaced as a runtime `(void 0) is not a function` inside `_onAddAsync` when mounting the legacy ZarrLayer. Consolidated metadata (`.zmetadata`) is still fetched manually by the library's own `_loadV2`, so skipping the helper is behavior-preserving.

### Vite config

`optimizeDeps.include` extended with `@developmentseed/deck.gl-zarr` and its `geozarr` + `raster-reproject` leaves, plus `zarrita` itself.
