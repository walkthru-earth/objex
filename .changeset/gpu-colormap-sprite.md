---
'@walkthru-earth/objex': minor
'@walkthru-earth/objex-utils': minor
---

GPU colormap sprite, histogram slider, and 4-band COG fix.

### GPU `Colormap` sprite with 107 ramps

Single-band COGs and mosaics now render through the v0.6 `Colormap` shader module sampling `@developmentseed/deck.gl-raster/gpu-modules/colormaps.png` (256x107 RGBA, matplotlib + rio-tiler + cmocean). Switching ramps is a uniform update on `colormapIndex`, no tile re-decode. The CPU baker normalizes band N into `color.r` with `r = 1 + round(t * 254)` and reserves `r = 0` as a nodata sentinel so `FilterNoDataVal({ value: 0 })` discards those fragments before the ramp sample.

New helper module `utils/colormap-sprite.ts` decodes the sprite once per session and caches the uploaded `sampler2DArray` texture per luma.gl `Device` via a `WeakMap`. Exports `COLORMAP_INDEX` (all 107 names), `COLORMAP_NAMES` (sorted), `loadColormapSprite()`, `getColormapTexture(device)`, and `spriteBackgroundStyle(name, heightPx)` for CSS previews.

`CogControls.svelte` previews every ramp by slicing the sprite as a CSS background-image. Curated 10-ramp "pinned" grid (gray, terrain, viridis, magma, turbo, spectral, inferno, plasma, cividis, rdylgn), plus a search field and a scrollable full list of all 107.

### Histogram behind the rescale slider

`selectCogPipeline` now accepts an `onHistogram?: (bins: Uint32Array) => void` callback. The CPU baker emits a 64-bin histogram (`HISTOGRAM_BIN_COUNT`) built over the tile's valid samples, stored in `CogViewer` / `StacMosaicViewer` as `$state.raw<Uint32Array>` and rendered by `CogControls` as an SVG bar chart behind the rescale sliders. The active `[min, max]` window draws as a translucent band so the slider visualizes what it is actually clipping.

`rescaleApplicable` now returns `true` when `bandConfig.mode === 'single'` in addition to the legacy uint-RGB case. The single-band path builds its pipeline as `[Sampler2DArrayPrecision, FilterNoDataVal, LinearRescale?, Colormap]`, so the slider stretches `color.r` before the ramp lookup.

### NAIP 4-band opacity fix + dynamic band detection

`needsCustomPipelineForConfig` now forces the CPU path for `geotiff.count === 4` in RGB mode, so the 4th NAIP band is no longer silently interpreted as alpha by the library-default RGBA pipeline.

`StacMosaicViewer` detects band count + `SampleFormat` dynamically on the first COG that `MosaicLayer.getSource` resolves (via `geotiff.count` and `cachedTags.sampleFormat`), reseeds `bandConfig` via `defaultBandConfig(count, sf)`, and updates `<CogControls bandCount=...>` so 4-band imagery exposes all four bands in the picker. Previously the mosaic hard-coded 3 bands.

### `Sampler2DArrayPrecision` shim

`@developmentseed/deck.gl-raster@0.6.0-alpha.1`'s `Colormap` module injects `uniform sampler2DArray colormapTexture;` without a precision qualifier, which the Apple-GPU path of luma.gl's WebGL2 backend rejects with `ERROR: 'sampler2DArray' : No precision specified`. Local shim `Sampler2DArrayPrecision` (in `utils/cog.ts`) injects `precision highp sampler2DArray;` at `fs:#decl` and is chained immediately before `Colormap` in `buildCustomRenderTile`. Remove once upstream fixes.

### Dead code removed

Retired `COLOR_RAMP_STOPS`, `ColorRampId`, `interpolateRamp`, `rampToGradientCss`, and `customRenderTile` from `utils/cog.ts`. All superseded by the sprite path. `ColorRampId` is now a type alias for `ColormapName` (all 107 entries).

### `objex-utils`

Bump coordinated with the main package via the `fixed` changeset config. No new re-exports, `colormap-sprite.ts` is not published because it depends on luma.gl `Device` / WebGL2. Consumers who want GPU colormap rendering should depend on the full `@walkthru-earth/objex` package.
