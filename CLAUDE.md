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

## Edge Cases

- **COG v0.5 workarounds**: See `docs/cog-viewer-architecture.md` for full details. v0.5 keeps the v0.4 native fixes (polar NaN via `makeClampedForwardTo3857`, mesh iteration cap, Web Mercator CARTESIAN rendering). v0.5 changes the `renderTile` return shape to `{ image?, renderPipeline? }` (our `customRenderTile` wraps `ImageData` in `{ image }`). Remaining workarounds:
  - Oversized overviews (image < tile size) are filtered in pre-flight to prevent out-of-domain proj4 NaN
  - Non-uint COGs (Int8/16, Float32/64) use custom `getTileData`/`renderTile` (library still only auto-renders uint). User band/color changes also trigger custom pipeline via `createConfigurableGetTileData`
  - EPSG:4326 global bbox is clamped to ±85.051129° before `generateTileMatrixSet` (safety net)
  - User-defined CRS (GeoTIFF model type 32767, e.g. Mollweide) shows error, not supported by `@developmentseed/geotiff`
  - DecoderPool workers fail in Vite dev mode, using main-thread `DecoderPool()` (no workers)
  - Antimeridian longitude wrapping, pnpm patch adds proj4 `+over` flag ([#366](https://github.com/developmentseed/deck.gl-raster/issues/366) still open in v0.5)
  - v0.5's `LinearRescale` shader module is wired via `CogControls`. `createRescaledPipeline()` in `utils/cog.ts` wraps `inferRenderPipeline` (re-exported through our pnpm patch) and appends `LinearRescale` to the returned pipeline. Slider is hidden whenever `needsCustomPipelineForConfig` is true (non-uint, palette-indexed, mode=single, non-standard RGB band order) because the custom JS pipeline bakes RGBA in CPU and a GPU rescale would be cosmetic
  - v0.5's `CutlineBbox` shader module takes prop `{ bbox: [minX, minY, maxX, maxY] }` in mercator meters (EPSG:3857), not lnglat
  - Palette-indexed uint COGs with an embedded `ColorMap` tag (Photometric.Palette === 3) defer to the library default pipeline so the embedded palette renders correctly. `needsCustomPipelineForConfig` short-circuits when the user has not changed the default band config
- **Local EPSG resolver**: `createEpsgResolver()` in `utils/cog.ts` looks up numeric EPSG codes in `@developmentseed/epsg`'s bundled gzipped CSV via `loadEpsg()` and parses each WKT with `parseWkt()` from `@developmentseed/proj`. Passed to `COGLayer` as the `epsgResolver` prop. Replaces runtime `epsg.io` fetches. First COG per session downloads `all.csv.gz` once, cached for the session
- **wkt-parser `units = "unknown"` gotcha**: wkt-parser sets `def.units` from the WKT `UNIT` node. Some entries in the bundled EPSG CSV have a missing or malformed UNIT node, so `parseWkt()` returns `units: "unknown"`, which makes `generateTileMatrixSet` throw `Unsupported CRS units: unknown when computing metersPerUnit`. `normalizeCrsUnits()` in `utils/cog.ts` is applied to every resolver output, inferring `degree` for `longlat`, `meter` for `to_meter === 1` or missing, `foot` for 0.3048, and `us survey foot` for 1200/3937
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
- **Zarr non-consolidated v3**: stores without `consolidated_metadata` in zarr.json (e.g. TCI.zarr) use `discoverV3Children()` which parses multiscales convention to discover child arrays. When no convention matches, falls back to S3 XML listing (`listS3Children()`) to discover subdirectories
- **Zarr directory detection**: directories without `.zarr`/`.zr3` suffix (e.g. `aef-mosaic/`) are detected via marker files (`zarr.json`, `.zmetadata`, etc.). FileTreeSidebar checks children on click (opens zarr AND expands folder, updates icon). FileBrowser auto-opens via `$effect` (tracked by Set to prevent re-trigger). URL handler probes `{url}/zarr.json` for extensionless paths. Sidebar browses into extensionless dirs instead of opening raw tab. Marker files open in CodeViewer with Zarr badge + "Open as Zarr" button
- **Zarr string dtype**: zarrita 0.6.1+ supports `data_type: "string"` (PR manzt/zarrita.js#329). `@carbonplan/zarr-layer` v0.4.2 uses zarrita externally (not bundled). Must clear Vite cache (`rm -rf node_modules/.vite`) after upgrading
- **Zarr sharding_indexed**: zarrita supports sharding via range requests (`getRange` with `suffixLength`). But arrays without multiscale pyramids hang the browser at global zoom — `ZarrMapViewer` guards against >10k tiles
- **Zarr large arrays without pyramids**: e.g. `tge-labs/aef-mosaic` embeddings `[9,64,1859584,4009984]` with `sharding_indexed` codec. ZarrMapViewer shows error instead of flooding the browser with chunk requests. GDAL 3.12 also can't read this (`Unsupported codec: sharding_indexed`)
- **Cloud protocol URLs**: `resolveCloudUrl()` in `url.ts` converts `s3://` → HTTPS with AWS region auto-detection from bucket name. Called once in `openUrlTab()` (+page.svelte) as single entry point -- never duplicate in individual viewers

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
