# CLAUDE.md -- AI Agent Guidelines for objex

Read `CONTRIBUTING.md` for full architecture, pipeline docs, and viewer checklist.
Read `docs/*.md` for deep dives (COG viewer, DuckDB v1.5, Arrow grid, performance).

## Project

SvelteKit 2 SPA (static adapter, CSR-only), Svelte 5 runes, TypeScript 5, Tailwind CSS 4, pnpm 10.
Two npm packages: `@walkthru-earth/objex` (Svelte lib) and `@walkthru-earth/objex-utils` (pure TS).

## Key Directories

Each has its own `CLAUDE.md` with file listing, exports, usage, and mermaid diagram.

**Maintenance rule**: When you add, remove, or rename a file/export in any directory, update that directory's `CLAUDE.md` in the same compact style — keep the mermaid diagram, file table, and "used by" columns accurate. If the change affects cross-directory dependencies, update the other directory's CLAUDE.md too.

| Directory | CLAUDE.md | What |
|-----------|-----------|------|
| `src/lib/components/` | `components/CLAUDE.md` | Component tree overview |
| `src/lib/components/viewers/` | `viewers/CLAUDE.md` | 18+ per-format viewers, deps |
| `src/lib/stores/` | `stores/CLAUDE.md` | Svelte 5 rune stores |
| `src/lib/storage/` | `storage/CLAUDE.md` | S3/Azure/URL adapters |
| `src/lib/query/` | `query/CLAUDE.md` | DuckDB-WASM engine |
| `src/lib/constants.ts` | — | Shared constants (STORAGE_KEYS, WGS84_CODES, DEFAULT_TARGET_CRS, etc.) |
| `src/lib/utils/` | `utils/CLAUDE.md` | WKB, GeoArrow, format, hex, deck, clipboard, error |
| `src/lib/file-icons/` | `file-icons/CLAUDE.md` | Extension → viewer registry |
| `src/lib/i18n/` | `i18n/CLAUDE.md` | en/ar translations |
| `packages/objex-utils/` | `CLAUDE.md` | Pure TS sub-package |
| `docs/` | — | Architecture & research docs |

## Build Defines (`vite.config.ts`)

- `__APP_VERSION__` — package version string
- `__DUCKDB_WASM_VERSION__` — DuckDB-WASM version
- `__THIRD_PARTY_LICENSES__` — `{ license, packages: { name, url }[] }[]` auto-scanned from production `node_modules` by `collectThirdPartyLicenses()` (consumed by AboutSheet)
- `worker.format: 'es'` — required for `@developmentseed/geotiff` DecoderPool ESM workers
- `optimizeDeps.include` — pre-bundles all `@developmentseed/*` packages + `@cogeotiff/core`, `proj4`, `wkt-parser`

## Code Quality

```bash
pnpm -w run format      # Biome format
pnpm -w run lint:fix    # Biome lint
pnpm -w run check       # svelte-check
```

All three must pass. Biome: tabs, single quotes, semicolons, 100 char width.

## Do's

- Use `$state.raw` for arrays/objects with 100+ items (prevents deep Proxy overhead)
- Use `$state.snapshot()` before passing to deck.gl, MapLibre, DuckDB, Arrow
- Return cleanup from `$effect` (abort controllers, revoke blob URLs, null heavy refs)
- Use `onDestroy(cleanup)` as safety net alongside `$effect` cleanup
- Use `tabResources.register(tab.id, cleanup)` in every viewer for LRU eviction
- Pass `AbortSignal` to all `adapter.read()` / `fetch()` calls
- Use generation counter guard after every `await` in `$effect`
- Use `conn.send()` via `queryCancellable()` for data queries (non-blocking)
- Use `$derived.by()` to flatten derived chains (max 2-3 levels)
- Use `$state` only for small UI primitives (booleans, loading flags)
- Use relative imports (not `$lib`) in ALL files under `src/lib/` — see npm Publishing Rules below
- Use i18n `t()` for all user-facing strings
- Run `pnpm -w run format && pnpm -w run lint:fix && pnpm -w run check` before committing

## Don'ts

- Don't use `$state` on large arrays -- browser freezes from Proxy `deep_read`
- Don't mark `$effect` callbacks as `async` -- return cleanup, use inner IIFE
- Don't read reactive deps after `await` or inside `setTimeout` (not tracked)
- Don't nest `$derived` chains >2-3 levels (exponential recomputation bug)
- Don't pass Svelte proxied state to external libraries (deck.gl, MapLibre, DuckDB)
- Don't use `conn.query()` for data queries -- blocks the single DuckDB worker
- Don't skip cleanup of query handles, blob URLs, WebGL contexts, event listeners
- Don't hold module-level references to heavy objects without nulling in cleanup
- Don't add `console.log` in library code -- Vite strips them in production via config
- Don't use `$lib` alias in any file under `src/lib/` — it breaks dynamic imports in dist/ and the objex-utils tsup build (see npm Publishing Rules)
- Don't materialize all Arrow rows via `.toArray().map(r => r.toJSON())` -- use columnar access
- Don't use the shadcn CLI -- manually create/edit UI components in `src/lib/components/ui/` using bits-ui primitives (reference: https://bits-ui.com/llms.txt)

## Zero-Copy / Performance Rules

- **WKB → GeoArrow**: 5-byte peek for type classification, pre-allocate exact-size `Float64Array`, direct `DataView` reads -- no intermediate JS objects
- **WGS84 pass-through**: BLOB column renamed to `__wkb` directly -- no `ST_GeomFromWKB`/`ST_AsWKB` round-trip
- **Arrow column access**: `.toArray()` for numerics (zero-copy typed array view), `.get(i)` only for complex types
- **Binary columns**: skip during map attribute extraction (not useful for tooltips)
- **Metadata bbox**: skip O(n) bounds computation when available from GeoParquet metadata
- **Known geometry type**: skip per-row `ST_GeometryType()` when `geometry_types` in metadata
- **hyparquet parallel**: read Parquet footer (~150ms) in parallel with DuckDB-WASM boot

## Map / deck.gl Viewer Memory Checklist

Applies to any viewer that drives a long-lived deck.gl / MapLibre layer set whose source list mutates with user interaction (pan, viewport reload, time-range change). The classic failure is "panning grows memory forever" — Svelte-side caches keyed by source id keep heavy objects alive after the layers that referenced them have unmounted. Audit every new viewer against these rules:

- **Bound every per-source cache**: `Map<sourceId, GeoTIFF | Promise>` or `Map<href, presignedUrl>` MUST be wrapped in `LruCache` from `utils/lru.ts` (or an equivalent eviction strategy). Unbounded `Map`s leak across viewport reloads even when deck.gl tears the layer tree down, because the closures inside `getSource` / `getTileData` are not what holds the entries — the Svelte module-level reference is. Default cap: 64 (matches `MosaicLayer.maxCacheSize`).
- **Wire deck.gl `onTileUnload` → cache eviction**: When the parent `TileLayer` / `MosaicLayer` evicts a tile, delete the matching entries from every per-source Svelte cache (`geotiffCache`, `presignCache`, per-source `histograms`, etc.). Track a reverse `Map<sourceId, href>` if presign keys are hrefs. This ties Svelte's working set to deck.gl's actual visible-tile set, so memory tracks the screen, not the pan history.
- **Match `maxCacheSize` to the LRU cap**: The TileLayer cache and the Svelte LRU should share the same upper bound so eviction signals are symmetric. Don't leave `maxCacheSize: 8` while the Svelte cache is unbounded — that hides the leak.
- **Coalesce layer rebuilds during streaming hydration**: If the data source emits paged batches (e.g. STAC API), do NOT rebuild the layer per page. A version-bumped `MosaicLayer` discards deck.gl's parent TileLayer cache and remounts every visible sub-layer, restarting per-source raster fetches mid-pan. Schedule one rebuild on the first batch (so the user sees results immediately) and a final flush after the stream completes; skip everything in between.
- **Split `AbortController`s by lifetime**: Use one viewer-lifetime controller for in-flight tile / range fetches (must survive viewport reloads) and a separate per-pan controller for hydration / pagination. Aborting the wrong controller cascades into deck.gl's COG range reads as `_SourceError("Failed to fetch")` and floods the console.
- **Filter `AbortError` from default `console.error`**: deck.gl's `TileLayer.onTileError` defaults to `console.error`. Override with `(err) => { if (isAbortError(err)) return; console.error(err); }`. Same on `MapboxOverlay.onError`. Never swallow non-abort errors silently.
- **Snapshot Svelte state before passing to deck.gl**: `MosaicLayer({ sources: $state.snapshot(itemsRef) })`. Building a Flatbush spatial index over a Svelte Proxy triggers deep `deep_read` on every probe and freezes the browser.
- **Atomic source swap on viewport reload**: Don't clear `itemsRef = []` then refill. Replace it in one assignment on the first accepted batch of the new viewport so deck.gl keeps painting the previous mosaic until new sources arrive.
- **Destroy `DecoderPool` once on tab close**, not per rebuild. Share across all sub-layers.
- **Cleanup contract**: Every viewer registers via `tabResources.register(tab.id, cleanup)` AND has `onDestroy(cleanup)`. Cleanup must: abort both controllers, clear timers, remove map controls / event listeners, clear all caches, null heavy refs, destroy the decoder pool.

## Edge Cases

- **COG v0.6.1 workarounds**: See `docs/cog-viewer-architecture.md` for full details. The project tracks `@developmentseed/deck.gl-{raster,geotiff,zarr,epsg,proj} v0.6.1` (bumped from `0.6.0-alpha.1`). v0.6.1 reorganizes the layer hierarchy: `COGLayer` and `MultiCOGLayer` now extend a new `RasterTileLayer` from `@developmentseed/deck.gl-raster` (PRs #480 #499). `COGLayer` exposes `signal?: AbortSignal` as an officially documented prop, threading abort through tile fetches. `MosaicLayer.sources` is now reactive to in-place updates by reference (PR #511) — our viewers still bump a content-hashed id (`mosaicId`) on commit, but a future cleanup can drop the id-bump trick once we trust upstream's reactive path under streaming hydration. PR #514 (BREAKING in 0.6.0) switched non-paletted COGs from nearest to linear sampling on the data texture; this is a visual-only change, no API impact. PR #473 added a hard error for projections with missing `units`, but our `normalizeCrsUnits()` in `utils/cog.ts` runs first and infers `degree`/`meter`/`foot`/`us survey foot` from `projName` / `to_meter`, so we never trip the upstream throw. The `MinimalDataT` type was renamed `MinimalTileData` and re-exported from `deck.gl-raster`. v0.6.1 ships `precision highp sampler2DArray;` in the `Colormap` shader module, so the local `Sampler2DArrayPrecision` shim was deleted from `utils/cog.ts`. Remaining workarounds:
  - Oversized overviews (image < tile size) are filtered in pre-flight to prevent out-of-domain proj4 NaN
  - Non-uint COGs (Int8/16, Float32/64) use custom `getTileData`/`renderTile` (library still only auto-renders uint). User band/color changes also trigger custom pipeline via `createConfigurableGetTileData`
  - EPSG:4326 global bbox is clamped to ±85.051129° before `geoTiffToDescriptor` (safety net)
  - User-defined CRS (GeoTIFF model type 32767, e.g. Mollweide) shows error, not supported by `@developmentseed/geotiff`
  - DecoderPool workers fail in Vite dev mode, using main-thread `DecoderPool()` (no workers)
  - Antimeridian longitude wrapping, pnpm patch adds proj4 `+over` flag ([#366](https://github.com/developmentseed/deck.gl-raster/issues/366) and [PR #374](https://github.com/developmentseed/deck.gl-raster/pull/374) both still open in v0.6.1). Patch also forwards `onTileLoad`/`onTileError`/`onTileUnload`/`onViewportLoad` (and `debounceTime` for `MosaicLayer`) through to the inner `TileLayer`; in v0.6.1 the COGLayer `TileLayer` instantiation moved into `RasterTileLayer._renderTileLayer`, so the callback-pass-through patch now lives in `patches/@developmentseed__deck.gl-raster@0.6.1.patch` (was previously in the geotiff package). The geotiff patch keeps the proj4 `+over` antimeridian fix, the `inferRenderPipeline` re-export from index, the MosaicLayer callback wiring, and the `r16unorm` → `r32float` Firefox/macOS fallback in `MultiCOGLayer.createBandTexture`.
  - v0.6.1's `LinearRescale` shader module is wired via `CogControls`. For the library-default uint RGB path, `createRescaledPipeline()` in `utils/cog.ts` wraps `inferRenderPipeline` (re-exported through our pnpm patch) and appends `LinearRescale`. For the custom single-band CPU + GPU Colormap path, `buildCustomRenderTile()` appends `LinearRescale` between `FilterNoDataVal` and `Colormap` so the slider rescales `color.r` before the ramp lookup (no longer hidden in single-band mode). `rescaleApplicable` in `CogViewer` now returns true whenever `bandConfig.mode === 'single'` in addition to the legacy uint-RGB case.
  - v0.6.1's `CutlineBbox` shader module takes prop `{ bbox: [minX, minY, maxX, maxY] }` in mercator meters (EPSG:3857), not lnglat
  - Palette-indexed uint COGs with an embedded `ColorMap` tag (Photometric.Palette === 3) defer to the library default pipeline so the embedded palette renders correctly. `needsCustomPipelineForConfig` short-circuits when the user has not changed the default band config
  - **v0.6 `Colormap` sprite + GPU ramps**: single-band COGs and mosaics render their color ramp via the shipped `@developmentseed/deck.gl-raster/gpu-modules/colormaps.png` sprite (256×107, 107 matplotlib/rio-tiler/cmocean ramps). `utils/colormap-sprite.ts` decodes the sprite once per session (`loadColormapSprite`) and uploads a `sampler2DArray` texture once per `Device` (`getColormapTexture`, WeakMap-keyed). The CPU baker normalizes band N into the `r` channel and reserves `r=0` as a nodata sentinel so `FilterNoDataVal({value: 0})` discards those fragments before `Colormap` samples `colormapTexture` at layer `colormapIndex = COLORMAP_INDEX[config.colorRamp]`. Switching ramps is a uniform update, not a tile re-decode. `CogControls.svelte` renders previews by slicing the sprite as a CSS `background-image` inline (sprite URL + per-row offset), with a curated pinned grid + search + all-107 scroll list. The baker also emits a 64-bin histogram (`HISTOGRAM_BIN_COUNT`) via `opts.onHistogram`, which `CogViewer` / `StacMosaicViewer` store in `$state.raw<Uint32Array>` and pass to `CogControls` as an overlay behind the rescale sliders.
- **Local EPSG resolver**: `createEpsgResolver()` in `utils/cog.ts` looks up numeric EPSG codes in `@developmentseed/epsg`'s bundled gzipped CSV via `loadEpsg()` and parses each WKT with `parseWkt()` from `@developmentseed/proj`. Passed to `COGLayer` as the `epsgResolver` prop. Replaces runtime `epsg.io` fetches. First COG per session downloads `all.csv.gz` once, cached for the session
- **wkt-parser `units = "unknown"` gotcha**: wkt-parser sets `def.units` from the WKT `UNIT` node. Some entries in the bundled EPSG CSV have a missing or malformed UNIT node, so `parseWkt()` returns `units: "unknown"`, which makes `geoTiffToDescriptor` throw `Source projection is missing 'units' property` (in 0.6.1, hardened by PR #473) or the older `Unsupported CRS units: unknown when computing metersPerUnit`. `normalizeCrsUnits()` in `utils/cog.ts` is applied to every resolver output, inferring `degree` for `longlat`, `meter` for `to_meter === 1` or missing, `foot` for 0.3048, and `us survey foot` for 1200/3937. We always normalize before handing the projection to `COGLayer`, so the upstream throw in 0.6.1 is preempted.
- **`safeClamp()`**: use instead of `Math.max/min` -- NaN propagates through Math functions (now in `utils/cog.ts`)
- **DuckDB v1.5 GEOMETRY type**: GeoParquet columns read as `GEOMETRY('EPSG:...')` with CRS in type. `geometry_always_xy = true` set globally at DB init. For legacy GeoParquet (missing `"version"` field), `enable_geoparquet_conversion = false` is set per-connection as fallback
- **hyparquet vs DuckDB type mismatch**: hyparquet reports physical type (BLOB/GEOMETRY), DuckDB v1.5 reports `GEOMETRY('EPSG:...')`. After DuckDB boots, schema is refreshed from DuckDB for accurate type
- **`ST_Transform` axis order**: `geometry_always_xy = true` set globally at DB init. Use 2-arg `ST_Transform(geom, target_crs)` when CRS is in type, 3-arg `ST_Transform(geom, source, target)` otherwise
- **Legacy GeoParquet**: `schema_version` without `version` field (geopandas <0.12). Detected by hyparquet; `enable_geoparquet_conversion = false` set per-connection, falls back to BLOB handling
- **DuckDB-WASM `stoi` bug**: `stoi: no conversion` crash on GeoParquet with CRS metadata ([duckdb/duckdb-wasm#2199](https://github.com/duckdb/duckdb-wasm/issues/2199), tracked in [walkthru-earth/objex#5](https://github.com/walkthru-earth/objex/issues/5)). Root cause is a PROJ default-CRS registration timing bug under WASM. Worked around in `wasm.ts` init by running `SELECT * FROM duckdb_coordinate_systems()` BEFORE the explicit `LOAD spatial` (ordering is critical). TableViewer keeps the `enable_geoparquet_conversion = false` retry as a fallback for true legacy GeoParquet files. Current pin: `1.33.1-dev53.0`, DuckLake 1.0 catalogs (storage v68) load correctly. See `docs/ducklake-wasm-support.md`
- **DuckDB-WASM ATTACH ignores s3_endpoint**: `ATTACH 's3://...'` always resolves against `*.s3.amazonaws.com` regardless of `SET s3_endpoint`. Workaround: download catalog via storage adapter, register in VFS with `db.registerFileBuffer()`, ATTACH from local path. `read_parquet('s3://...')` works correctly (uses httpfs which respects s3_endpoint)
- **`DETACH IF EXISTS` defensively avoided**: older DuckDB-WASM dev builds did not support `DETACH IF EXISTS` syntax. `DatabaseViewer` uses plain `DETACH` wrapped in try/catch for safety across dev builds
- **DuckDB-WASM GEOMETRY Arrow export**: WASM Arrow layer throws `Unsupported type: GEOMETRY` ([duckdb/duckdb-wasm#2187](https://github.com/duckdb/duckdb-wasm/issues/2187)). All geometry queries wrap with `ST_AsWKB()` to convert to WKB_BLOB before Arrow serialization
- **DuckDB-WASM Arrow v17 mismatch**: DuckDB-WASM bundles apache-arrow v17, project uses v21 ([duckdb/duckdb-wasm#2008](https://github.com/duckdb/duckdb-wasm/issues/2008)). Cross-version `tableToIPC`/`tableFromIPC` loses data. Blocks native GeoArrow consumption — manual WKB→GeoArrow pipeline must stay
- **GeometryCollections (WKB type 7)**: skipped in `parseWKB` (returns Unknown), not rendered on map
- **DuckDB-WASM single worker**: all queries share one worker. Long queries block everything -- use `queryCancellable()` and cancel in cleanup
- **Large COG (360802x176500, ZSTD, Mollweide)**: unsupported CRS (model type 32767) -- shows error message. ZSTD decoded on main thread (DecoderPool workers disabled)
- **`$derived` memory leak**: module-level runes referenced in component `$derived` may not clean up on unmount (Svelte #11817)
- **Tree rendering**: guard expanded children with `{#if node.expanded}` -- unguarded renders all nodes on mount
- **Zarr numcodecs-wrapped codecs**: Zarr v3 stores from Python zarr-python use `numcodecs.` prefix (e.g. `numcodecs.shuffle`, `numcodecs.zlib`). zarrita only registers bare names. `ensureCodecsRegistered()` in `zarr.ts` adds aliases + byte shuffle implementation. Must be awaited before creating `ZarrLayer`
- **zarrita 0.7 + carbonplan zarr-layer**: `@carbonplan/zarr-layer@0.4.3` was built against zarrita 0.6 and calls `zarr.tryWithConsolidated()`, which zarrita 0.7 removed. Since `pnpm.overrides` forces 0.7.1 across the tree, mounting the legacy `ZarrLayer` failed with `(void 0) is not a function` inside `_onAddAsync`. `patches/@carbonplan__zarr-layer@0.4.3.patch` replaces both call sites with `Promise.resolve(baseStore)` — `_loadV2` still fetches `.zmetadata` manually, so consolidated v2 behavior is preserved. Revisit when carbonplan publishes a zarrita 0.7-compatible release
- **Zarr non-consolidated v3**: stores without `consolidated_metadata` in zarr.json (e.g. TCI.zarr) use `discoverV3Children()` which parses multiscales convention to discover child arrays. When no convention matches, falls back to S3 XML listing (`listS3Children()`) to discover subdirectories
- **Zarr directory detection**: directories without `.zarr`/`.zr3` suffix (e.g. `aef-mosaic/`) are detected via marker files (`zarr.json`, `.zmetadata`, etc.). FileTreeSidebar checks children on click (opens zarr AND expands folder, updates icon). FileBrowser auto-opens via `$effect` (tracked by Set to prevent re-trigger). URL handler probes `{url}/zarr.json` for extensionless paths. Sidebar browses into extensionless dirs instead of opening raw tab. Marker files open in CodeViewer with Zarr badge + "Open as Zarr" button
- **Zarr string dtype**: zarrita 0.6.1+ supports `data_type: "string"` (PR manzt/zarrita.js#329). `@carbonplan/zarr-layer` v0.4.2 uses zarrita externally (not bundled). Must clear Vite cache (`rm -rf node_modules/.vite`) after upgrading
- **Zarr sharding_indexed**: zarrita supports sharding via range requests (`getRange` with `suffixLength`). But arrays without multiscale pyramids hang the browser at global zoom — `ZarrMapViewer` guards against >10k tiles
- **Zarr large arrays without pyramids**: e.g. `tge-labs/aef-mosaic` embeddings `[9,64,1859584,4009984]` with `sharding_indexed` codec. ZarrMapViewer shows error instead of flooding the browser with chunk requests. GDAL 3.12 also can't read this (`Unsupported codec: sharding_indexed`)
- **Cloud protocol URLs**: `resolveCloudUrl()` in `url.ts` converts `s3://` → HTTPS with AWS region auto-detection from bucket name. Called once in `openUrlTab()` (+page.svelte) as single entry point -- never duplicate in individual viewers
- **Connection access mode**: `getAccessMode(conn)` in `storage/providers.ts` returns `public-https | sas-https | signed-s3` and is the single source of truth for how HTTP clients (DuckDB httpfs, COG/Zarr/PMTiles, fetch/img/video) should read a connection's files. `buildDuckDbUrl()` returns `s3://` only for `signed-s3`; `canStreamDirectly()` wraps `isPubliclyStreamable()`; `configureStorage()` in `query/wasm.ts` skips all S3 SETs for non-`signed-s3` modes. Do NOT add new `provider === 'azure'` or `anonymous && endpoint` branches for URL routing -- call `getAccessMode()` / `isPubliclyStreamable()` instead. Adapter selection (`storage/index.ts`) stays provider-based because Azure uses a different API class
- **Presigned HTTPS URLs for `signed-s3`**: `buildHttpsUrlAsync()` and `buildDuckDbUrlAsync()` (in `utils/url.ts`) upgrade `s3://bucket/key` to a SigV4-query-string-signed HTTPS URL via `storage/presign.ts` (`aws4fetch.signQuery`, 7d expiry, the S3 max). Any viewer that hands the URL to an external fetcher (iframes, COG/PMTiles/FGB/Zarr range readers, `<img>`/`<video>`, pdf.js) must await the async version so GCS's S3-compatible endpoint does not reject the `Authorization` preflight. Migrated viewers: `TableViewer` (via `resolveTableSourceAsync`), `CogViewer`, `CopcViewer`, `PmtilesViewer`, `FlatGeobufViewer`, `ArchiveViewer`, `CodeViewer`, `StacMapViewer`, `ZarrViewer`, `ZarrMapViewer`. `TableViewer` re-populates the editor with the signed SQL only if the user has not edited it during the await. `configureStorage(conn, connId, sourceRef?)` in `query/wasm.ts` detects presigned refs via `isHttpsSourceRef()` and skips all S3 SETs (self-authenticating URL) — every call site threads either `source.ref` or the raw `sql`, so the skip fires on every query path, not just tab open. When `connection.endpoint` is empty for non-`s3` providers (e.g. auto-detected GCS), it falls back to `resolveProviderEndpoint()` so DuckDB does not silently route to AWS. External crawling iframes (stac-browser, developmentseed/stac-map) still break on private buckets because child links inside the manifest are not themselves presigned — only the top manifest is
- **DuckDB-WASM Arrow DECIMAL rewriting**: DuckDB-WASM returns DECIMAL columns as Arrow `Decimal128` buffers whose values are `BigInt` or a `Uint32Array` of little-endian words — stringifying either gives garbage (`"12345,0,0,0"`). `query()` / `queryCancellable()` in `query/wasm.ts` derive column types from `String(field.type)` on the Arrow schema, so `decimalScale()` must match Arrow's `toString()` output `Decimal[precision e ±scale]` (e.g. `Decimal[10e+2]`) **and** the DuckDB DESCRIBE form (`DECIMAL(10,2)`) — the regex handles both. `isNumericArrowType()` explicitly excludes DECIMAL so values route through the decimal path; `formatDecimal()` then rewrites each cell to a scaled decimal string. Regression landed in v1.2+ when the initial regex only matched the DESCRIBE form and silently no-op'd on every real DECIMAL column
- **Hive-partitioned stac-geoparquet directories**: A `tab.path` ending in `/` (or opted in via `CreateStacSourceDeps.useHivePartitioning`) is treated as a hive-partitioned parquet root. `looksLikeHivePartitionedParquet(tab, deps)` in `query/stac-source-factory.ts` is the single entry point, and `query/stac-source-parquet.ts::createParquetSource(tab, connectionId, options)` switches the FROM target to `read_parquet('<root>/**/*.parquet', hive_partitioning=true, union_by_name=true)`. `union_by_name=true` is required because partitioned writes drift over time (new columns added per partition). DuckDB then prunes partition columns out of the predicate so a viewport `bbox` / `datetime` filter only touches matching partitions, mirroring lazycogs' `DuckdbClient(use_hive_partitioning=True)`. Capability surface advertises `hivePartitioned: true` so `StacMosaicViewer`'s HUD can hint at the discovery model. `CreateStacSourceDeps.debugExplain` adds a one-shot `EXPLAIN` log against the rewritten SQL, gated because EXPLAIN costs an extra worker round-trip.
- **STAC API CQL2 push-down (slice 2 wired)**: `utils/stac-source-api.ts::createApiSource` now sniffs the API's `conformsTo` once via `sniffApiCapabilities` (caching `StacApiCapabilities`), then runs `toNativeQuery(facetState, caps)` per request. When the API advertises the Filter extension, `toCql2Filter` emits CQL2-JSON for cloud cover, gsd, platform, constellation, instruments, and collection (when no native `collections` cap), and the result rides on `StacItemsQuery.filter` via `?filter=<json>&filter-lang=cql2-json`, re-stamped onto every `rel="next"` URL in `applyItemsQuery`. The actually-pushed subset is reported as `pushedDown` and the leftover as `residual` per batch (via `subtractState`), so the viewer client-side filters only what the API could not honor. Falls back to slice-1 (bbox + datetime only) when sniff fails or the API does not advertise Filter.
- **Open-time storage smoke test + overview-aware pixel inspector (design rules)**: New raster viewers should mirror two patterns landed this session. (1) Run `smokeTestHref(presignedUrl, signal)` from `utils/storage-smoketest.ts` at mount, before kicking off a deck.gl layer tree, and on failure render an amber HUD pill (`stac.smokeWarning` + `stac.smokeWarningHint`) so presign / CORS / 403 issues surface at viewer open instead of as a generic `_SourceError("Failed to fetch")` from the tile layer. (2) On click-to-inspect, compute the screen GSD via `mapResolutionMetersPerPixel(zoom, lat)` from `utils/cog.ts`, pick the overview via `selectOverviewForResolution(geotiff, gsd)`, and thread it into `readPixelAtLngLat(geotiff, lng, lat, {overview})` so the readout matches whichever overview deck.gl is actually painting, instead of forcing a full-res fetch on every click. Both patterns are now in `CogViewer`, `MultiCogViewer` (per-channel), and `StacMosaicViewer` (z-ordered topmost source).
- **stac-geoparquet detection + href resolution**: `ViewerRouter::detectStacGeoparquet` sniffs `.parquet`/`.geoparquet` via `readParquetMetadata(url).topLevelColumns`, NOT `.schema`. `.schema` flattens struct parents like `assets` and `bbox` away, and `isStacGeoparquetSchema` keys on `assets`. Matching tabs mount `StacTabViewer`, which wraps its root in `<Tooltip.Provider>`, the in-template `Tooltip.Root` instances (parquet-disabled STAC Browser tooltip, private-bucket iframe tooltips) throw `Context "Tooltip.Provider" not found` without an ancestor provider and the whole viewer unmounts, silently falling back to plain TableViewer. In `query/stac-source-parquet.ts` (the parquet `StacSource` impl), asset hrefs are resolved per-row against `{parquet_dir}/{item.id}/`. stactools writes each item JSON at `{catalog_dir}/{item.id}/{item.id}.json` and bakes `./foo.tif` hrefs relative to that path, so resolving against the parquet URL strips the item-id subfolder and every COG 404s
- **Shareable-URL hash preservation across eager → remote tab migration**: A `?url=<s3/https>[#view]` link opens an eager tab (`eagerUrlTabId(url)` from `stores/tabs.svelte.ts`) in `+page.svelte::openUrlTab` *before layout mounts*. If host-detection recognizes the provider, `Sidebar::handleAutoDetection` closes the eager tab and opens a remote tab after awaiting `saveHostConnection` + `ensureCredentials`. During that await window `tabs.active` is transiently null, so the tab-sync `$effect` in `+page.svelte` MUST NOT call `clearUrlState()`. The authoritative "migration in progress" signal is `tabs.migrating` (set by `Sidebar::handleAutoDetection` via `tabs.beginMigration()` / `tabs.endMigration()`), NOT `hasUrlParam()`. **Do not regress to `hasUrlParam()` as the migration guard** — it stays true after any user-initiated close, so on mobile (where `Sidebar` is inside `<Sheet.Root>` and remounts on every Sheet open) it caused `handleAutoDetection` to re-fire on the stale `?url=` and reopen the tab the user had just closed. With `tabs.migrating`, user-initiated closes leave the flag false, so the tab-sync effect cleanly clears `?url=`/`#hash` and subsequent Sidebar mounts find nothing to auto-open. The `?url=` param and incoming `#table/#map/#stac/#inspect` hash survive to the remote viewer's mount, where each viewer (`TableViewer`, `PmtilesViewer`, `ZarrViewer`, `CodeViewer`, `StacTabViewer`) reads its hash via `pickViewMode(...)` at init. The eager-tab-id format is owned by `eagerUrlTabId(url)` -- never hand-construct `` `url:${...}` ``. All `url-state.ts` mutators funnel through `writeLocation()` which skips `replaceState` when the URL is unchanged, avoiding navigation-pipeline thrash on every tab-sync effect fire
- **Shareable-URL hash preservation across `ViewerRouter` async STAC detection**: For `.json` and `.parquet` tabs, `ViewerRouter` runs an async classifier (`detectStac` 256 KB peek + `classifyStac`, or `detectStacGeoparquet` schema sniff) that transits through `stacRoute = { kind: 'pending' }` before resolving to `'stac'` or `'none'`. While pending, `ViewerRouter` mounts an empty pane for `viewerKind === 'table' | 'code' | 'raw'` instead of falling through to plain `TableViewer` / `CodeViewer`. **Do not regress this gate** — without it, the transient viewer reads the URL hash, picks a default `viewMode`, and may stamp `updateUrlView(...)` over a hash that the eventual `StacTabViewer` mount would own (e.g. `?url=...collection.json#map` getting clobbered to `#stac-browser` by `CodeViewer`'s STAC auto-switch). Companion invariant at the viewer level: every viewer with a `viewMode` derives its initial value through `pickViewMode<T>(validModes, defaultMode)` from `utils/url-state.ts`, which validates the hash against the viewer's vocabulary and falls back to `defaultMode` WITHOUT rewriting the URL. A viewer MUST NOT call `updateUrlView(...)` for a hash it doesn't recognise — that hash is owned by another viewer and the rewrite is what creates the bug. CodeViewer's `stacAutoSwitch` is gated on `!urlView` (empty hash only) for exactly this reason; loosening it to `urlView !== 'code'` reintroduces the `#map` → `#stac-browser` regression

## npm Publishing Rules

Everything under `src/lib/` is published to npm via `svelte-package`. Follow these rules to prevent broken packages:

### Import Rules
- **NEVER use `$lib/` in any file under `src/lib/`** — use relative imports (`../types.js`, `../constants.js`)
- `svelte-package` resolves static `$lib/` imports, but **dynamic `import()` with `@vite-ignore` is NOT resolved** — it ships as-is and crashes at runtime
- `$app/` and `$env/` imports are SvelteKit-only — files using them must NOT be in `src/lib/`
- App-only code (analytics, layout CSS, route logic) belongs in `src/routes/`, not `src/lib/`

### Exports Map (`package.json`)
- Every export entry MUST have all three conditions: `"types"`, `"svelte"`, and `"import"`
- `"svelte"` is only recognized by Svelte tooling; `"import"` is needed for non-Svelte ESM consumers
- When adding a new public utility, add it to both `src/lib/index.ts` AND `packages/objex-utils/src/index.ts`

### Files Field
- The `"files"` field excludes `CLAUDE.md`, `assets/`, and test files from the npm tarball
- After adding new non-code files to `src/lib/`, verify they don't leak into the tarball: `pnpm pack --pack-destination /tmp && tar tf /tmp/*.tgz | grep <filename>`

### Dependency Classification
- `dependencies`: packages imported by code in `src/lib/` (shipped to consumers)
- `devDependencies`: packages only used in `src/routes/`, build tooling, or dev server
- App-only packages (`posthog-js`, `@fontsource/*`) must be in `devDependencies`
- Run `pnpm -w run package` + `pnpm --filter @walkthru-earth/objex-utils run build` to verify both packages build

### Pre-Publish Checklist
```bash
pnpm -w run format && pnpm -w run lint:fix && pnpm -w run check
pnpm -w run package                                    # builds dist/ + publint
pnpm --filter @walkthru-earth/objex-utils run build     # builds objex-utils
grep -r '\$lib/' dist/ --include='*.js'                 # must find nothing
pnpm pack --pack-destination /tmp                       # inspect tarball
```

## Viewer Pattern

Every viewer must follow this pattern:

```svelte
<script lang="ts">
  let { tab } = $props();
  let data = $state.raw<Type | null>(null);
  let abortCtrl = new AbortController();

  $effect(() => {
    const gen = ++loadGen;
    abortCtrl = new AbortController();

    (async () => {
      const result = await adapter.read(tab.path, undefined, undefined, abortCtrl.signal);
      if (gen !== loadGen) return; // stale
      data = result;
    })();

    tabResources.register(tab.id, cleanup);
    return () => { abortCtrl.abort(); };
  });

  function cleanup() { data = null; /* null all heavy refs */ }
  onDestroy(cleanup);
</script>
```

## Releasing

Uses **Changesets** for automated versioning, changelogs, and npm publishing with trusted publishing (OIDC).

- `pnpm changeset` — add a changeset to your PR (both packages bump together via `fixed` config)
- Merging to `main` auto-creates a "Version Packages" PR with version bumps + CHANGELOG
- Merging the version PR auto-publishes to npm with provenance + creates GitHub Release

See `RELEASE.md` for full details, trusted publishing setup, dry-run, and rollback procedures.

## Reference Docs

- `RELEASE.md` -- Release checklist, version bumping, dry-run, rollback procedures
- `docs/cog-viewer-architecture.md` -- COG viewer v0.5 architecture, workarounds, upstream issues to track
- `docs/duckdb-v1.5-geometry-upgrade.md` -- Parameterized GEOMETRY type, migration path
- `docs/arrow-table-grid-research.md` -- TableGrid rewrite, quak analysis, append-on-scroll
- `docs/svelte5-performance-guide.md` -- Reactivity patterns, $state.raw, $effect cleanup
- `docs/performance-audit.md` -- Per-viewer memory/perf audit
- `docs/performance-optimization.md` -- Performance optimization strategies
- `docs/performance-fix-plan.md` -- Performance fix implementation plan
- `docs/performance-file-map.md` -- Performance-related file map
- `docs/duckdb-wasm-concurrency-research.md` -- Worker threading model
- `docs/archive-range-request-research.md` -- Archive range request research
- `docs/ipynb-viewer-research.md` -- Jupyter notebook viewer research
- `docs/notebook-viewer-research.md` -- Notebook viewer implementation research
- `docs/ui-ux-improvement-plan.md` -- UI/UX improvement plan
- `docs/zarr-viewer-architecture.md` -- Zarr viewer architecture, detection, library versions, upstream issues
- `docs/duckdb-wasm-upgrade-analysis.md` -- DuckDB-WASM upgrade blockers (stoi crash, Arrow mismatch, GeoArrow export), workaround chain, action plan
- `docs/ducklake-wasm-support.md` -- DuckLake 0.4+ WASM support research, compatibility tables, integration architecture
- `docs/colormap-tag-investigation.md` -- Palette-indexed COG rendering, ColorMap TIFF tag short-circuit in `needsCustomPipelineForConfig`
- `docs/multicog-sentinel2-design.md` -- MultiCOGLayer wiring design for Sentinel-2 style multi-asset scenes
- `docs/mosaic-layer-stac-design.md` -- MosaicLayer + STAC catalog integration design
