# Zarr Viewer Architecture

## Dependencies

| Package | Version | Role |
|---------|---------|------|
| `zarrita` | 0.7.1 | JS Zarr v2/v3 reader (string dtype, sharding, vlen-utf8) |
| `@carbonplan/zarr-layer` | 0.4.3 | MapLibre custom layer for tiled Zarr rendering (legacy path) |
| `@developmentseed/deck.gl-zarr` | 0.6.0-alpha.1 | deck.gl Zarr layer for GeoZarr-convention stores (new path) |
| `@developmentseed/geozarr` | 0.6.0-alpha.1 | GeoZarr metadata parser + validator |
| `@zarrita/storage` | bundled | FetchStore with `getRange` for sharding range requests |

### Upstream repos

- **zarrita**: [manzt/zarrita.js](https://github.com/manzt/zarrita.js)
- **zarr-layer**: [carbonplan/zarr-layer](https://github.com/carbonplan/zarr-layer)

## Zarr Format Support Matrix

| Feature | Zarr v2 | Zarr v3 | Notes |
|---------|---------|---------|-------|
| Consolidated metadata | `.zmetadata` | `zarr.json` with `consolidated_metadata` | Preferred — single fetch |
| Non-consolidated | `.zgroup`/`.zarray`/`.zattrs` probing | Per-child `zarr.json` fetch | Requires child discovery |
| Child discovery (conventions) | N/A | `multiscales.layout[].asset` | Multiscales convention |
| Child discovery (S3 listing) | N/A | `listS3Children()` XML listing | Fallback when no conventions match |
| Child discovery (zarrita) | `probeHierarchy()` | `probeHierarchy()` | Last resort — opens as array or group |
| String dtype | `v2:U*`, `v2:S*` | `"string"` + `vlen-utf8` codec | zarrita 0.6.0+ (PR #329) |
| Sharding | N/A | `sharding_indexed` codec | zarrita supports via range requests |
| numcodecs-wrapped codecs | N/A | `numcodecs.zlib`, `numcodecs.shuffle`, etc. | `ensureCodecsRegistered()` aliases |

## Detection & Routing

### Zarr Store Detection

Zarr stores are detected through multiple paths depending on how the user opens them:

```
URL with marker suffix          → extractZarrStoreUrl() strips suffix → Zarr viewer
  e.g. .../store/zarr.json

URL with marker filename        → ZARR_MARKER_FILES.has(fileName) → opens parent as Zarr
  (handles query params)

URL with .zarr/.zr3 extension   → getFileTypeInfo('zarr') → Zarr viewer
  e.g. .../data.zarr

URL without extension            → probeUrlForZarr() HEAD requests → Zarr viewer
  e.g. .../aef-mosaic             probes {url}/zarr.json, {url}/.zmetadata
                                  Sidebar browses into dir → FileBrowser auto-detects

Directory with .zarr suffix      → storage adapter sets extension: 'zarr'
  (in tree sidebar)               → isViewerDir() → opens viewer on click

Directory without .zarr suffix   → handleNodeClick() loads children
  (in tree sidebar)               → detectZarrMarkers() → opens viewer AND expands folder
                                   → icon changes to purple Layers via detectedZarrPaths

Directory in file browser        → $effect auto-detects via detectZarrMarkers()
                                   → auto-opens Zarr viewer (tracked in Set to avoid re-trigger)

Clicking zarr.json/.zmetadata    → opens in CodeViewer (JSON syntax highlighting)
  (in tree or file browser)        → detectJsonKind() shows "Zarr v2/v3" badge
                                   → "Open as Zarr" button opens parent as Zarr store
```

### Marker Files

`ZARR_MARKER_FILES` in `utils/zarr.ts`:
- `zarr.json` → Zarr v3
- `.zmetadata` → Zarr v2 consolidated
- `.zgroup` → Zarr v2 group
- `.zarray` → Zarr v2 array
- `.zattrs` → Zarr v2/v3 attributes

### Viewer Constants

- `VIEWER_DIR_EXTENSIONS` in `constants.ts`: `Set(['zarr', 'zr3'])` — directories with these suffixes get Zarr icon and one-click viewer opening
- File-icons registry maps `.zarr` and `.zr3` to `viewer: 'zarr'`

## Hierarchy Fetch Pipeline

`fetchHierarchy()` in `utils/zarr.ts` tries these in order:

1. **Zarr v3 consolidated**: `GET {url}/zarr.json` → `buildV3Tree()` if `consolidated_metadata` present
2. **Zarr v3 non-consolidated**: same fetch → `discoverV3Children()` if no `consolidated_metadata`
   - Tries `multiscales.layout[].asset` convention first
   - Falls back to `listS3Children()` (S3 XML listing with `delimiter=/`)
   - Probes each child with `GET {child}/zarr.json`
3. **Zarr v2 consolidated**: `GET {url}/.zmetadata` → `buildV2Tree()`
4. **Zarr v2/fallback**: `probeHierarchy()` via zarrita `open()`

## Dual-path Map Rendering

`ZarrMapViewer.svelte` runs two independent rendering paths and picks between them per tab.

1. **GeoZarr path** (`@developmentseed/deck.gl-zarr`). `utils/zarr.ts::detectGeoZarr(hierarchy)` walks the hierarchy looking for a node whose attributes carry `multiscales` + a spatial convention (`spatial`, `spatial:dimensions`, `spatial:shape`) + CRS info (`geo-proj`, `proj:code`, `proj:wkt2`, `proj:projjson`, `crs`, `crs_wkt`). On a non-null return, `tryAddGeoZarrLayer` dynamic-imports `@developmentseed/deck.gl-zarr` and mounts `ZarrLayer` through `MapboxOverlay`. A shared `createEpsgResolver()` instance backs the new layer, matching the single-COG viewer's bundled EPSG database pattern. Errors during GeoZarr setup are caught and the caller falls back to path (2).
2. **Carbonplan path** (`@carbonplan/zarr-layer`). Unchanged from prior releases, keeps the 10 k-tile guard, proj4 LCC builder, `ensureCodecsRegistered` for `numcodecs.`-prefixed codecs (zlib, shuffle), and `onLoadingStateChange` error propagation.

The selector sliders, variable dropdown, and click-popup behavior are identical across both paths — only the layer implementation differs.

### Version pins
zarrita bumped `0.6.2 → 0.7.1` as part of the v0.6 family bump. `pnpm.overrides` forces 0.7.1 across the tree so `@carbonplan/zarr-layer@0.4.3` (which declares `zarrita@^0.6.1`) runs on the same major. If carbonplan publishes an update that requires a different zarrita major, remove the override and either dual-install via aliasing or drop the legacy path.

### carbonplan patch (`patches/@carbonplan__zarr-layer@0.4.3.patch`)
zarrita 0.7 removed `tryWithConsolidated`. `@carbonplan/zarr-layer@0.4.3` calls it from `_ZarrStore` during `_onAddAsync`, which under the 0.7 override throws `(void 0) is not a function`. The patch replaces both call sites with `Promise.resolve(baseStore)`. The library's own `_loadV2` fetches `.zmetadata` manually on the next tick, so behavior for consolidated v2 stores is preserved, and v3 stores never took that branch.

## Map View

### When Map Button Shows

`mapArrays` filter in `ZarrViewer.svelte`:
- Array must have `shape.length >= 2`
- Must have spatial dimension pair (y/x, lat/lon, latitude/longitude)
- All non-spatial dimensions must have root-level coordinate arrays

### Safety Guards

`ZarrMapViewer.svelte` checks before adding the layer:
- **Tile count guard**: if spatial dimensions produce >10,000 tiles at base resolution, shows error instead of rendering. Arrays without multiscale pyramids at global extent would trigger thousands of concurrent chunk requests.
- **Spatial dimension detection**: must find lat+lon pair, or have proj4 string from `spatial_ref` attributes
- **Error handling**: `onLoadingStateChange` callback catches zarr-layer errors; `try/catch` wraps `map.addLayer()`

### Known Limitations

- **No multiscale pyramid → no map view**: arrays like `tge-labs/aef-mosaic/embeddings` (shape `[9, 64, 1859584, 4009984]`) are too large without overviews. The tile guard prevents browser hangs.
- **zarr-layer probes `.zmetadata`**: even for v3-only stores, zarr-layer's internal `_ZarrStore` probes `.zmetadata` (returns 404). This is expected behavior, not from our code.
- **String coordinate dimensions**: zarrita 0.6.1 supports `data_type: "string"`, but zarr-layer shows them as index-based selectors (0..N) rather than displaying the string labels.

## Upstream Issues to Track

### zarrita (manzt/zarrita.js)

| Issue | Status | Impact |
|-------|--------|--------|
| #345 Shard index fetched multiple times | Open | Performance with sharded stores |
| #324 Chunk decoding on web workers | Open | Main thread blocking for large chunks |
| #317 AbortSignal support | Open | Can't cancel in-flight chunk fetches |
| #315 Shuffle codec | Open | We work around with `ensureCodecsRegistered()` |
| #310 Codec registry extensibility | Open | Would clean up our numcodecs workarounds |
| #305 String dtype support | Closed (v0.6.0) | Fixed — PR #329 merged 2026-01-23 |

### zarr-layer (carbonplan/zarr-layer)

| Issue | Status | Impact |
|-------|--------|--------|
| #47 Visible seams between tiles | Open | Visual artifacts |
| #44 Datatree roots support | Open | Would improve nested store handling |
| #42 GeoZarr convention support (PR) | Draft | Auto-detect CRS/bounds from GeoZarr attrs |
| #41 BatchedFetchStore for shard caching (PR) | Open | Performance with sharded stores |
| #45 Datatree support (PR) | Draft | Multi-resolution stores |

## File Map

| File | Role |
|------|------|
| `src/lib/utils/zarr.ts` | Metadata parsing, tree building, marker detection, S3 listing |
| `src/lib/utils/zarr-tab.ts` | `openZarrTab()` — centralized Zarr tab creation helper |
| `src/lib/components/viewers/ZarrViewer.svelte` | Inspector: tree view + detail panel, map/inspect toggle |
| `src/lib/components/viewers/ZarrMapViewer.svelte` | Map: MapLibre + @carbonplan/zarr-layer, dim selectors |
| `src/lib/components/viewers/CodeViewer.svelte` | `detectJsonKind()` shows Zarr v2/v3 badge + "Open as Zarr" button |
| `src/lib/components/browser/FileBrowser.svelte` | Auto-detect Zarr in directory listings, banner + auto-open |
| `src/lib/components/browser/FileTreeSidebar.svelte` | Detect Zarr on folder click, icon update via `detectedZarrPaths` |
| `src/lib/components/layout/Sidebar.svelte` | URL `?url=` auto-connect — browses into extensionless dirs |
| `src/routes/+page.svelte` | URL-based Zarr detection (`extractZarrStoreUrl`, `probeUrlForZarr`) |
| `src/lib/constants.ts` | `VIEWER_DIR_EXTENSIONS` |
| `src/lib/file-icons/index.ts` | `.zarr`/`.zr3` → viewer mapping |
| `src/lib/storage/browser-cloud.ts` | Sets `extension: 'zarr'` for `.zarr`/`.zr3` directories |

## Test URLs

- **v3 consolidated**: `s3://us-west-2.opendata.source.coop/zarr/geozarr-tests/zarr_no_compression.zarr/`
- **v3 non-consolidated (S3 listing fallback)**: `s3://us-west-2.opendata.source.coop/tge-labs/aef-mosaic/zarr.json`
- **v3 with string dtype + sharding**: `s3://us-west-2.opendata.source.coop/tge-labs/aef-mosaic/` (embeddings array — too large for map, inspect only)
