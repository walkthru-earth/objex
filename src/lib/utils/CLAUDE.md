# utils/

**App-side utility modules only.** Framework-agnostic utilities live in `@walkthru-earth/objex-utils` (`packages/objex-utils/src/`). Files remain here when they:

1. Import a heavy graphics / browser library (`@developmentseed/*`, `@deck.gl/*`, `maplibre-gl`, `pdfjs-dist`, `shiki`, `marked`, `@babylonjs/*`, `pmtiles`, `flatgeobuf`, `@zip.js`, `zarrita`, etc.), OR
2. Depend on SvelteKit (`$app/navigation`) or Svelte stores (`stores/*`), OR
3. Use `await import()` to lazy-load any of the above (tsup with `splitting: false` would bundle the lazy import into the main chunk and explode the bundle; svelte-package emits per-file output here so the dynamic stays lazy).

If you add a NEW utility that is pure TypeScript with none of the above, add it directly to `packages/objex-utils/src/` and `export * from './<name>.js'` in `packages/objex-utils/src/index.ts`. Do not create a shim in this directory.

```mermaid
graph TD
    subgraph "Stays here (heavy / framework)"
        COG[cog.ts<br/>@developmentseed/* + proj4 + maplibre-gl]
        COGH[cog-histogram.ts<br/>@developmentseed/geotiff]
        CSP[colormap-sprite.ts<br/>@developmentseed + @luma.gl]
        DECK[deck.ts<br/>lazy @deck.gl/* + @geoarrow/deck.gl-geoarrow]
        ZARR[zarr.ts<br/>lazy zarrita + numcodecs]
        ZTAB[zarr-tab.ts<br/>Svelte stores]
        PMT[pmtiles.ts<br/>pmtiles + maplibre-gl]
        PMTT[pmtiles-tile.ts<br/>@mapbox/vector-tile + pbf]
        PDF[pdf.ts<br/>pdfjs-dist]
        MODEL[model3d.ts<br/>@babylonjs/*]
        MDN[markdown.ts<br/>marked]
        SHIKI[shiki.ts<br/>shiki]
        MAPS[map-selection.ts<br/>maplibre-gl]
        ARC[archive.ts<br/>@zip.js + tar reader]
        URL[signed-url.ts<br/>Svelte stores + presign.ts]
        US[url-state.ts<br/>$app/navigation]
    end
    DECK -.-> OBJEX[(@walkthru-earth/objex-utils)]
    COG -.-> OBJEX
    ZARR -.-> OBJEX
    URL -.-> OBJEX
    US -.-> OBJEX
```

| File | Key exports | Heavy / framework dep | Used by |
|------|-------------|-----------------------|---------|
| `cog.ts` | `selectCogPipeline()`, `createConfigurableGetTileData()`, `buildCustomRenderTile()`, `readPixelAtLngLat()`, `inspectCogTags()`, `normalizeCogGeotiff()`, `defaultBandConfig()`, `defaultRescaleForGeotiff()`, `buildHistogramFromGeotiff()`, `percentileFromHistogram()`, `mapResolutionMetersPerPixel()`, `selectOverviewForResolution()`, `createEpsgResolver()`, full render-pipeline surface. Re-exports `SF_LABELS`, `safeClamp`, `clampBounds`, `buildDataTypeLabel`, `CogInfo`, `GeoBounds` from `objex-utils` so in-repo callers keep working | `@developmentseed/*` (geotiff, deck.gl-geotiff, deck.gl-raster, epsg, proj), `@chunkd/*`, `@luma.gl/core`, `proj4`, `wkt-parser`, `maplibre-gl` | CogViewer, MultiCogViewer, StacMosaicViewer, CogControls |
| `cog-histogram.ts` | `HISTOGRAM_BINS`, `readGdalStats()`, `streamHistogram()` | `@developmentseed/geotiff` | cog.ts, CogViewer, MultiCogViewer |
| `colormap-sprite.ts` | `loadColormapSprite()`, `getColormapTexture()`, `COLORMAP_NAMES`, `COLORMAP_SPRITE_URL`, re-exports `COLORMAP_INDEX` / `ColormapName` | `@developmentseed/deck.gl-raster/gpu-modules`, `@luma.gl/core` | cog.ts |
| `deck.ts` | `hoverCursor()`, `geojsonFillColor()`, `geojsonLineColor()`, `loadDeckModules()`, `loadGeoArrowModules()`, `createGeoArrowOverlay()`, `createGeoArrowLayers()`, `buildSelectionLayer()`, `GEOMETRY_COLORS`. `GeoArrowResult` type imported from `@walkthru-earth/objex-utils` | lazy `await import('@deck.gl/mapbox' | '@deck.gl/layers' | '@geoarrow/deck.gl-geoarrow')` , kept lazy via svelte-package per-file output | FlatGeobufViewer, GeoParquetMapViewer |
| `zarr.ts` | `ZARR_MARKER_FILES`, `detectZarrMarkers()`, `extractZarrStoreUrl()`, `fetchHierarchy()`, `probeHierarchy()`, `buildV3Tree()`, `buildV2Tree()`, `discoverV3Children()`, `listS3Children()`, `ensureCodecsRegistered()`, `detectGeoZarr()`, `inferDims()`, `formatCodecs()`, `formatChunkKeys()`, `computeChunkCount()`, `computeChunkSize()`, `computeUncompressed()`, `dtypeByteSize()`, `formatShape()`, `DIM_LIKE_NAMES`, `ZarrNode`, `ZarrHierarchy`, `GeoZarrInfo`. `formatFileSize` imported from `@walkthru-earth/objex-utils` | lazy `await import('zarrita')` , kept lazy via svelte-package per-file output | ZarrViewer, ZarrMapViewer, +page.svelte |
| `zarr-tab.ts` | `openZarrTab()` | `stores/tabs.svelte.js` | FileTreeSidebar, +page.svelte |
| `pmtiles.ts` | `getPmtilesProtocol()`, `loadPmtiles()`, `buildPmtilesLayers()`, `TILE_TYPE_LABELS`, `COMPRESSION_LABELS`, `VectorLayerInfo`, `PmtilesMetadata` | `pmtiles`, `maplibre-gl` | PmtilesMapView, PmtilesArchiveView, PmtilesViewer |
| `pmtiles-tile.ts` | `decodeMvtTile()`, `tileMimeType()`, `layerHue()`, `DecodedTile`, `DecodedLayer`, `DecodedFeature` | `@mapbox/vector-tile`, `pbf`, `pmtiles` | PmtilesTileInspector |
| `pdf.ts` | `loadPdfDocument()` | `pdfjs-dist` | PdfViewer |
| `model3d.ts` | `createModelScene()`, `loadModel()` | `@babylonjs/core`, `@babylonjs/loaders` | ModelViewer |
| `markdown.ts` | `renderMarkdown()`, `detectRTL()` | `marked` | MarkdownViewer |
| `shiki.ts` | `highlightCode()`, `highlightCodeReversed()`, `extensionToShikiLang()`, `getTheme()`, `getReversedTheme()` | `shiki` | PmtilesArchiveView, NotebookViewer, CodeViewer, MarkdownViewer |
| `map-selection.ts` | `setupSelectionLayer()`, `updateSelection()` | `maplibre-gl` | PmtilesMapView, MapViewer |
| `archive.ts` | `streamZipEntriesFromUrl()`, `streamTarEntriesFromUrl()`, `listContents()` | `@zip.js/zip.js` | ArchiveViewer |
| `signed-url.ts` | `buildHttpsUrl()`, `buildHttpsUrlForConnection()`, `buildHttpsUrlAsync()`, `buildDuckDbUrl()`, `buildDuckDbUrlAsync()`, `buildStorageUrl()`, `canStreamDirectly()`. `buildHttpsUrl(tab)` delegates to `buildHttpsUrlForConnection(conn, path, opts?)` — the provider-aware base builder (`buildProviderBaseUrl` + Azure container/blob + SAS) shared with FileTreeSidebar's "Copy HTTP URL" (which passes `{ encode: true }` for percent-encoded segments). The `Async` variants presign for `signed-s3` via `storage/presign.ts` (SigV4 query-string auth) and share a private `tryPresignTab()` helper, viewers that hand the URL to an external fetcher (iframe, range reader, `<img>`) must `await` them | Svelte stores (connections, credentials), `storage/presign.ts` | All raster / map / iframe viewers (CogViewer, TableViewer, FlatGeobufViewer, ArchiveViewer, MediaViewer, CopcViewer, PdfViewer, ZarrMapViewer, StacMapViewer, ZarrViewer, CodeViewer, ImageViewer, PmtilesViewer, PmtilesMapView, TableToolbar, TabBar), FileTreeSidebar |
| `media-query.svelte.ts` | `useIsWide()` — reactive `{ value: boolean }` object backed by `matchMedia('(min-width: 640px)')`. Svelte 5 runes module; must be called inside a component or `.svelte.ts` context. SSR-safe (`typeof window` guard). | none (matchMedia only) | ZarrViewer, ArchiveViewer, PmtilesArchiveView |
| `signed-url-effect.ts` | `resolveSignedTabUrl(tab, onResolved)` — wraps the async signed-URL resolution pattern for iframe-style viewers. Manages the cancel flag and tab-id race guard; caller returns the cleanup from `$effect`. Depends on `signed-url.ts` | `signed-url.ts` (Svelte stores) | CopcViewer, StacMapViewer, CodeViewer |
| `url-state.ts` | `syncUrlParam()`, `updateUrlView()`, `getUrlView()`, `pickViewMode<T>()`, `getUrlViewParams()` / `updateUrlViewParams()`, `getUrlPrefix()`, `hasUrlParam()`, `setRawUrlParam()`, `clearUrlState()`, `buildUrlParam()` | `$app/navigation` (SvelteKit) | Sidebar, FileTreeSidebar, TableViewer, ZarrViewer, CodeViewer, PmtilesViewer, StacTabViewer, MultiCogViewer, +page.svelte |

## Promoted to `@walkthru-earth/objex-utils`

The following utilities used to live here but were moved into the isolated package because they are pure TypeScript and consumable from any framework (Svelte, React, Vue, Node):

`channel-composite`, `clipboard`, `cloud-url`, `cog-asset`, `cog-info`, `column-types`, `connection-identity`, `error`, `export`, `file-sort`, `format`, `geoarrow`, `geometry-type`, `hex`, `host-detection`, `local-storage`, `lru`, `map-pixel-inspect`, `markdown-sql`, `markdown-sql-context`, `notebook`, `parquet-metadata`, `stac`, `stac-facets`, `stac-geoparquet`, `stac-hydrate`, `stac-pushdown`, `stac-source`, `stac-source-api`, `stac-source-static`, `stac-storage-extension`, `storage-smoketest`, `storage-url`, `wkb`.

Import them as:

```ts
import { parseWKB, formatFileSize, classifyStac } from '@walkthru-earth/objex-utils';
```

(NOT as `../utils/wkb.js` or `$lib/utils/wkb.js`, those shim paths no longer exist.)
