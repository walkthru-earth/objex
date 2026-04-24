---
'@walkthru-earth/objex': minor
---

STAC mosaic pixel inspection and stricter STAC JSON routing.

### Mosaic pixel inspection + info panel

`StacMosaicViewer` now exposes the same `Info` button and pixel-inspection overlay that `CogViewer` has. Clicking a pixel inside a STAC Catalog / Collection / ItemCollection / stac-geoparquet tab surfaces the sampled band values plus the matching source id, and the info panel lists source count, detected band count, data type (captured as `buildDataTypeLabel(sampleFormat, bitsPerSample)` on the first resolved COG), and union bounds.

A `geotiffCache: Map<string, Promise<GeoTIFF>>` is populated inside `getSource` and reused both for `MosaicLayer` rebuilds and for the map-click handler, so clicks do not trigger a second HTTP fetch. The click handler reverse-iterates `itemsRef` to match mosaic z-order, finds the topmost source whose bbox contains the click, and calls `readPixelAtLngLat(...)` against that source's cached `GeoTIFF`.

New translations `stac.mosaicInfo` and `stac.mosaicSourcesLabel` for English and Arabic.

### Stop routing plain JSON through StacTabViewer

`ViewerRouter::detectStac` now propagates `classifyStac(parsed)`'s `{ kind: 'none' }` result in both the 256 KB peek branch and the full-read fallback. Previously any JSON that parsed returned `{ kind: 'stac', classified: { kind: 'none' } }`, which still mounted `StacTabViewer` and exposed the `stac-map` and `STAC Browser` buttons on files that were not STAC at all (including GeoJSON FeatureCollections that fail the STAC shape checks). Plain JSON now falls through to `CodeViewer` as intended.
