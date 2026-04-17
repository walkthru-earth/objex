# Mosaic Layer, STAC-driven Design Doc

Status, Draft
Owner, TBD
Related, `docs/cog-viewer-architecture.md`, `src/lib/components/viewers/CogViewer.svelte`, `src/lib/utils/cog.ts`

## 1. Goal

Render a client-side raster mosaic of N Cloud Optimized GeoTIFFs selected by a STAC FeatureCollection (or an equivalent lightweight JSON of `{bbox, href}` items). No tile server, no backend. Each scene is fetched directly from object storage over HTTP range requests, mosaicked on the GPU by `@developmentseed/deck.gl-geotiff` v0.5's `MosaicLayer`, and drawn into the existing MapLibre canvas via `MapboxOverlay`. The viewer should feel like a multi scene extension of `CogViewer`, so all of the COG workarounds (oversized overviews, non uint scene handling, EPSG:4326 clamping, main thread DecoderPool in dev) apply per inner COG.

## 2. Input Shapes

Two accepted inputs, primary and fallback.

### (a) Primary, STAC FeatureCollection or pre baked item list

A STAC FeatureCollection fetched by URL, or a pre baked JSON array of items. Both normalize to the same in memory shape.

```ts
type MosaicItem = {
  id: string;
  bbox: [number, number, number, number]; // WGS84, minX minY maxX maxY
  href: string;                            // absolute COG URL
  thumbnailHref?: string;                  // optional preview
  datetime?: string;                       // ISO, for sidebar sort
  properties?: Record<string, unknown>;    // STAC properties passthrough
};
```

Accepted source formats,

- STAC FeatureCollection, each feature's `assets.image.href` (or a configured asset key like `visual`, `data`, `B04`) becomes `href`. `bbox` comes from the feature.
- Pre baked `[{ id, bbox, href, ... }]` JSON, ideal for static catalogs shipped alongside data.

The distinction is detected by peeking at the JSON root, `{ type: "FeatureCollection", features: [...] }` vs a bare array.

### (b) Fallback, list of COG URLs

User supplies only `[ "s3://bucket/scene1.tif", ... ]`. For each URL we do a pre flight `GeoTIFF.fromUrl(url)` to read `bbox` and `crs` from the header, then project to WGS84 if needed. This costs one range request per scene up front and is strictly a convenience. Recommend shape (a) so bbox is known without header fetches.

## 3. Layer Shape

The viewer builds a single `MosaicLayer` from the normalized item list. Sketch,

```ts
import { MosaicLayer, COGLayer } from '@developmentseed/deck.gl-geotiff';
import { GeoTIFF } from '@developmentseed/geotiff';

const layer = new MosaicLayer({
  id: `mosaic-${tab.id}`,
  sources: items, // MosaicItem[], stable reference
  maxCacheSize: 8, // tune, open question below

  // Open each source lazily, MosaicLayer caches the returned GeoTIFF
  getSource: async (item) => {
    return await GeoTIFF.fromUrl(item.href);
  },

  // Render one source as an inner COGLayer. Array order is z order.
  renderSource: (item, { data }) => {
    const geotiff = data as GeoTIFF;
    const customProps = buildCustomProps(geotiff, bandConfig); // non uint path
    return new COGLayer({
      id: `mosaic-${tab.id}-${item.id}`,
      geotiff,
      pool,
      ...customProps,
      opacity: perSceneOpacity.get(item.id) ?? 1,
    });
  },
});
```

Notes,

- `sources` order is the draw order, item 0 is drawn first, last item is on top. Document this in the sidebar and persist a user reorderable list.
- `getSource` runs once per item and is cached by `MosaicLayer` up to `maxCacheSize`. Eviction closes older `GeoTIFF` handles, plan a cleanup hook on tab destroy.
- `renderSource` fires per visible tile batch, it must be cheap and deterministic. Rebuild triggers when `bandConfig` or per scene opacity change.

## 4. Where Existing Helpers Slot In

From `src/lib/utils/cog.ts`,

- `needsCustomPipeline`, `needsCustomPipelineForConfig`, decide per scene whether to pass `getTileData` and `renderTile` into the inner `COGLayer`.
- `createConfigurableGetTileData(geotiff, bandConfig)`, reused verbatim for band selection and color ramp handling on non uint scenes.
- `createCustomGetTileData(geotiff)`, fallback when there is no `bandConfig` yet.
- `customRenderTile`, wraps `ImageData` into `{ image }` for v0.5's `RenderTileResult`.
- `clampBounds`, `fitCogBounds`, reused for first time camera framing across the union of item bboxes.
- `resolveProj4Def`, `readPixelAtLngLat`, could power a per scene pixel inspector if a click hits a known item bbox. Out of scope for v1, noted for later.

Each inner `COGLayer` therefore inherits the same oversized overview stripping and EPSG:4326 bbox clamping that `CogViewer.buildAndAddLayer` already performs. Factor that preflight into a shared helper, `prepareGeotiffForLayer(geotiff)`, and call it inside `getSource` after the `fromUrl` resolves.

## 5. UI

Layout,

- Left pane, scene list. One row per item showing `id`, `datetime`, WxH bbox label, optional thumbnail (uses `thumbnailHref` or an `<img>` onto the COG overview when small). Click flies the map to that item's bbox.
- Per scene controls on each row, visibility toggle, opacity slider 0..1, drag handle to reorder z.
- Top bar, same `{t('cog.style')}` and `{t('map.info')}` buttons as `CogViewer`. Style applies globally to every inner `COGLayer` for v1, per scene styling is out of scope.
- Bottom status, loaded N of M sources, total bytes transferred via the shared adapter.

Reorder and opacity changes rebuild the `MosaicLayer` props with a new `sources` array and a new `perSceneOpacity` map. Keep the stable `id` so deck.gl does not rebuild the whole layer.

## 6. Viewer File Plan

New files,

- `src/lib/components/viewers/MosaicViewer.svelte`, follows the project viewer pattern (`$state.raw` for the items array, AbortController, `tabResources.register`, `onDestroy` cleanup, single `$effect` for load, generation counter after awaits).
- `src/lib/components/viewers/mosaic/SceneList.svelte`, sidebar list with drag, opacity, toggle.
- `src/lib/components/viewers/mosaic/MosaicControls.svelte`, style controls, mirror of `CogControls`.
- `src/lib/utils/mosaic.ts`, pure helpers, `parseStacFeatureCollection(json)`, `normalizeMosaicItems(input)`, `unionBbox(items)`, `prepareGeotiffForLayer(geotiff)` (extracted from `CogViewer`). Published via `src/lib/index.ts` if useful to library consumers.

Routing,

- Add `ViewerRouter` entry `viewerKind === 'mosaic'` with dynamic import of `MosaicViewer.svelte`.
- Extension detection, `getViewerKind` recognises `.mosaic.json` as pre baked, and any `.json` whose root parses to a `FeatureCollection` with at least one feature having an `assets.<key>.href` ending in a raster extension. Sniffing happens in the CodeViewer "Open as Mosaic" button path, matching the Zarr marker file pattern.
- URL flow, `openUrlTab` treats `.mosaic.json` as a mosaic tab directly. Bare STAC links continue to open in `StacMapViewer` unless the user explicitly picks Mosaic.

All viewers must follow the pattern in root `CLAUDE.md`, cleanup must abort the load, null the items array, close cached `GeoTIFF` handles, and remove the overlay.

Update `src/lib/components/viewers/CLAUDE.md` with a new row and update the mermaid graph with a `VR -->|mosaic| MOS[MosaicViewer]` edge.

## 7. Unknowns, Open Questions

1. Catalog discovery. Do we only accept a dropped URL, or do we expose a minimal STAC catalog browser (browse `links.child`, pick a collection, pick items)? The existing `StacMapViewer` iframe covers browsing, maybe link "Open as Mosaic" from there once item count is reasonable.
2. STAC API search vs static only. First cut should accept static FeatureCollections. Supporting `POST /search` needs request shaping, pagination, and auth handling, punt to v2.
3. GeoTIFF header cache. `MosaicLayer.maxCacheSize` evicts, what is a sensible default for browsers, 8, 16, dynamic by memory pressure? Needs measurement on real datasets.
4. Asset key selection. STAC items can expose many assets, `visual`, `data`, `B04`. UI needs an asset picker when `assets.image` is absent. Default to `visual` then first asset with a `image/tiff; application=geotiff` media type.
5. Concurrency. If 50 items are visible, `getSource` will race 50 `GeoTIFF.fromUrl` calls. Throttle via a small semaphore, or trust the browser's HTTP/2 multiplexing? Same question for the `DecoderPool`, one shared pool across all sources is cheapest.

## 8. Out of Scope for v1

- STAC API search pagination and filter pushdown.
- Server side cloud filtering by STAC properties (`eo:cloud_cover < 10`), users should pre filter their FeatureCollection.
- Per scene band or color ramp configs, v1 applies one style globally.
- Pixel inspector across the mosaic, v1 shows only map rendering.
- Temporal animation or time slider.
- Write back, this is a read only viewer.
- Non COG raster formats, plain TIFFs, HDF, NetCDF.
