# CLAUDE.md -- AI Agent Guidelines for objex

Read `CONTRIBUTING.md` for full architecture, pipeline docs, and viewer checklist.
Read `docs/*.md` for deep dives (COG viewer, DuckDB v1.5, Arrow grid, performance).

## Project

SvelteKit 2 SPA (static adapter, CSR-only), Svelte 5 runes, TypeScript 5, Tailwind CSS 4, pnpm 10.
Two npm packages: `@walkthru-earth/objex` (Svelte lib) and `@walkthru-earth/objex-utils` (pure TS).

## Key Directories

Each has its own `CLAUDE.md` with file listing, exports, and mermaid diagram.

| Directory | CLAUDE.md | What |
|-----------|-----------|------|
| `src/lib/components/` | `components/CLAUDE.md` | Component tree overview |
| `src/lib/components/viewers/` | `viewers/CLAUDE.md` | 18+ per-format viewers, deps |
| `src/lib/stores/` | `stores/CLAUDE.md` | Svelte 5 rune stores |
| `src/lib/storage/` | `storage/CLAUDE.md` | S3/Azure/URL adapters |
| `src/lib/query/` | `query/CLAUDE.md` | DuckDB-WASM engine |
| `src/lib/utils/` | `utils/CLAUDE.md` | WKB, GeoArrow, format, hex, deck |
| `src/lib/file-icons/` | `file-icons/CLAUDE.md` | Extension → viewer registry |
| `src/lib/i18n/` | `i18n/CLAUDE.md` | en/ar translations |
| `packages/objex-utils/` | `CLAUDE.md` | Pure TS sub-package |
| `docs/` | — | Architecture & research docs |

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
- Keep `$lib` alias imports only in app code -- library exports use relative paths
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
- Don't use `$lib` alias in `src/lib/storage/adapter.ts` or `url-adapter.ts` (breaks outside SvelteKit)
- Don't materialize all Arrow rows via `.toArray().map(r => r.toJSON())` -- use columnar access

## Zero-Copy / Performance Rules

- **WKB → GeoArrow**: 5-byte peek for type classification, pre-allocate exact-size `Float64Array`, direct `DataView` reads -- no intermediate JS objects
- **WGS84 pass-through**: BLOB column renamed to `__wkb` directly -- no `ST_GeomFromWKB`/`ST_AsWKB` round-trip
- **Arrow column access**: `.toArray()` for numerics (zero-copy typed array view), `.get(i)` only for complex types
- **Binary columns**: skip during map attribute extraction (not useful for tooltips)
- **Metadata bbox**: skip O(n) bounds computation when available from GeoParquet metadata
- **Known geometry type**: skip per-row `ST_GeometryType()` when `geometry_types` in metadata
- **hyparquet parallel**: read Parquet footer (~150ms) in parallel with DuckDB-WASM boot

## Edge Cases

- **geotiff v2 vs v3**: `@developmentseed/deck.gl-geotiff` bundles geotiff v2 internally. Project uses v3. NEVER pass v3 objects to library functions. See `docs/cog-viewer-architecture.md`
- **geotiff v3 Pool**: hangs in Vite dev (ESM worker import issue) -- use poolless `readRasters()`
- **COG monkey-patch**: `COGLayer.prototype._parseGeoTIFF` is patched for Gray/Float COGs. The patch catches throws on unsupported PI/SF and reconstructs state
- **`safeClamp()`**: use instead of `Math.max/min` -- NaN propagates through Math functions
- **Mollweide/global CRS**: `patchMetadataBounds()` fixes NaN from proj4 edge-sampled bounds
- **DuckDB `enable_geoparquet_conversion = false`**: prevents rejection of legacy GeoParquet (missing `"version"` field). All geometry columns read as BLOB
- **hyparquet vs DuckDB type mismatch**: hyparquet may report `GEOMETRY` (Parquet logical type) while DuckDB reports `BLOB`. Use DuckDB type for SQL, hyparquet type for display only
- **`ST_Transform` axis swap**: always use `always_xy := true` to fix EPSG authority lat/lon order
- **Legacy GeoParquet**: `schema_version` without `version` field (geopandas <0.12). The conversion bypass handles this
- **GeometryCollections (WKB type 7)**: skipped in `parseWKB` (returns Unknown), not rendered on map
- **DuckDB-WASM single worker**: all queries share one worker. Long queries block everything -- use `queryCancellable()` and cancel in cleanup
- **Large COG (360802x176500, ZSTD)**: known to hang browser -- ZSTD decompression is synchronous on main thread
- **`$derived` memory leak**: module-level runes referenced in component `$derived` may not clean up on unmount (Svelte #11817)
- **Tree rendering**: guard expanded children with `{#if node.expanded}` -- unguarded renders all nodes on mount

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

See `RELEASE.md` for the full release checklist: version bump, dry-run, GitHub Release trigger, post-publish verification, and rollback procedures.

## Reference Docs

- `RELEASE.md` -- Release checklist, version bumping, dry-run, rollback procedures
- `docs/cog-viewer-architecture.md` -- COG dual-pipeline, monkey-patch, projection edge cases
- `docs/duckdb-v1.5-geometry-upgrade.md` -- Parameterized GEOMETRY type, migration path
- `docs/arrow-table-grid-research.md` -- TableGrid rewrite, quak analysis, append-on-scroll
- `docs/svelte5-performance-guide.md` -- Reactivity patterns, $state.raw, $effect cleanup
- `docs/performance-audit.md` -- Per-viewer memory/perf audit
- `docs/duckdb-wasm-concurrency-research.md` -- Worker threading model
