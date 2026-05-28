---
'@walkthru-earth/objex': patch
'@walkthru-earth/objex-utils': patch
---

Upgrade the `@developmentseed/deck.gl-{raster,geotiff,zarr,epsg,proj,geotiff}` stack from 0.6.1 to 0.7.0 and slim the pnpm patch set.

- 0.7.0 forwards `onTileLoad` / `onTileError` / `onTileUnload` / `onViewportLoad` through `RasterTileLayer` natively (deck.gl-raster PR #546), so the entire `deck.gl-raster` pnpm patch was removed.
- `MosaicLayer` now forwards `debounceTime` natively and renamed its tile callbacks to source-level props (`onSourceLoad` / `onSourceError` / `onSourceUnload` / `onViewportLoad`). `StacMosaicViewer` migrated from `onTileUnload` to `onSourceUnload`, and that hunk was dropped from the geotiff patch.
- The remaining geotiff patch keeps only three hunks that upstream still does not ship by default. The proj4 `+over` antimeridian fix, the `inferRenderPipeline` re-export, and the `r16unorm` to `r32float` Firefox/macOS texture fallback.
- `MinimalTileData` now imports from `@developmentseed/deck.gl-raster` (it is no longer re-exported by `deck.gl-geotiff`).
