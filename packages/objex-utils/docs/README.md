# `@walkthru-earth/objex-utils` Developer Docs

Professional reference documentation for every public export of the package.

Each page lists the exact TypeScript signature, parameter semantics, return shape, peer-dependency requirements, and non-obvious behavior. Intended as the single source of truth for integrators.

## Install

```bash
pnpm add @walkthru-earth/objex-utils
# or
npm install @walkthru-earth/objex-utils
```

Minimum: ES2022, modern browser or Node 18+. Ships both ESM (`dist/index.js`) and CJS (`dist/index.cjs`) with full `.d.ts`.

## Optional peer dependencies

All heavy dependencies are **optional** peer dependencies. Install only the ones you touch.

| Peer | Version | Required by |
|------|---------|-------------|
| `apache-arrow` | `>=14` | `buildGeoArrowTables`, `normalizeGeomType` (indirectly) |
| `hyparquet` | `>=1.25` | `readParquetMetadata` and its extractors |
| `hyparquet-compressors` | `>=1.1` | `readParquetMetadata` (for SNAPPY/ZSTD/GZIP/etc.) |
| `yaml` | `>=2` | `parseMarkdownDocument` (lazy-loaded, only when YAML frontmatter is present) |

As of v1.2, `yaml` is loaded via dynamic `import()` inside `parseMarkdownDocument`. Consumers who do not call that function never touch `yaml` at load time.

## Reference pages

| Page | Covers |
|------|--------|
| [`geometry.md`](./geometry.md) | WKB parser, GeoArrow table builder, geometry-column detection, parameterized GEOMETRY type parser (`parseGeometryTypeCrs`, `buildTransformExpr`, `wrapWkbWithCrs`) |
| [`cog.md`](./cog.md) | Cloud-Optimized GeoTIFF pure helpers (bounds clamping, sample format labels, type guards). The render-pipeline surface stays in the Svelte components package and is NOT re-exported here. |
| [`parquet-metadata.md`](./parquet-metadata.md) | `readParquetMetadata` + CRS / bounds / geometry-types extractors |
| [`stac-geoparquet.md`](./stac-geoparquet.md) | stac-geoparquet detection (`isStacGeoparquetSchema`) and row-to-Item transforms (`stacRowToItem`, `flattenStacBbox`, `pickStacPrimaryAsset`, `resolveStacAssetHref`) |
| [`stac-facets.md`](./stac-facets.md) | Auto-faceted state for STAC viewers, `extractItemView` / `buildFacets` / `applyFacets` / `sortViews` / `hasActiveFilters` / `emptyFacetState` + `StacItemView` / `Facet*` / `FacetState` types |
| [`stac-pushdown.md`](./stac-pushdown.md) | `FacetState` → STAC API native query + CQL2-JSON translation. `sniffApiCapabilities`, `toNativeQuery`, `toCql2Filter`, `residualState` gated by what `conformsTo` advertises |
| [`stac.md`](./stac.md) | Core STAC types and classifiers (`classifyStac`, `isStacItem`, `extractRasterBandAssets`, `extractMosaicAssets`, `buildMosaicSourceMeta`, `spatialCellKey`, `resolvePresetComposite`, `hasCompositableBands`, full type surface) |
| [`stac-source.md`](./stac-source.md) | `StacSource` contract + `createApiSource` / `createStaticSource` implementations (parquet implementation lives in the Svelte components package because it requires DuckDB-WASM) |
| [`stac-hydrate.md`](./stac-hydrate.md) | `hydrateStacItems` link-walker (Catalog / Collection / FeatureCollection / STAC API), `hasStacItemsEndpoint`, `absolutizeHref` |
| [`stac-storage-extension.md`](./stac-storage-extension.md) | STAC Storage Extension v1.0.0 / v2.0.0 hints (`extractStorageHints`, `applyStorageHintsToConnection`) |
| [`storage.md`](./storage.md) | URL parsing (`parseStorageUrl`, `resolveCloudUrl`, `classifyUrl`, `isKnownBucketHost`, `STAC_API_PATH_RE`), provider registry, `StorageAdapter` interface, `UrlAdapter`, `smokeTestHref`, `detectHostBucket`, `applyStacItemStorageHints`, `connectionIdentityKey` |
| [`cog-asset.md`](./cog-asset.md) | Vendor-neutral COG asset enumeration (`extractCogAssets`, `syntheticSelfAsset`, `pickNaturalColorComposite`, `isSingleAssetComposite`, `allChannelsBand0`) |
| [`channel-composite.md`](./channel-composite.md) | RGB composite presets and URL round-trip (`PRESETS`, `applyPreset`, `compositeFromUrl`, `compositeToUrl`, `presetMatchesComposite`) |
| [`query-engine.md`](./query-engine.md) | `QueryEngine` interface and associated result/handle types |
| [`file-types.md`](./file-types.md) | File-type registry (`getFileTypeInfo`, `getViewerKind`, `getDuckDbReadFn`, ...) |
| [`formatting.md`](./formatting.md) | Display formatters, column-type classification, hex dump, CSV/JSON export, clipboard helper, notebook renderer |
| [`file-sort.md`](./file-sort.md) | `sortFileEntries`, `toggleSortField` |
| [`markdown-sql.md`](./markdown-sql.md) | Markdown + SQL block parsing (Evidence-compatible syntax) |
| [`local-storage.md`](./local-storage.md) | SSR-safe `loadFromStorage` / `persistToStorage` |
| [`app-config.md`](./app-config.md) | Runtime config schema + precedence resolver (`AppConfig`, `mergeAppConfig`, `resolveSetting`, `resolveBasemap`, `parseVisibilityParam`, `coerce*`) |
| [`map-pixel-inspect.md`](./map-pixel-inspect.md) | Framework-agnostic click-to-inspect helper (`attachPixelInspector`), minimal `MapLike` shape, per-click abort coordination |
| [`lru.md`](./lru.md) | `LruCache<K,V>` move-to-end on `get`, optional `onEvict` |
| [`errors.md`](./errors.md) | `handleLoadError`, `isAbortError` |
| [`types-constants.md`](./types-constants.md) | `Connection`, `Tab`, `FileEntry`, `WriteResult`, `Theme`, shared constants |

## Quick recipes

### Render a GeoParquet file on deck.gl

```ts
import {
  readParquetMetadata,
  extractEpsgFromGeoMeta,
  extractGeometryTypes,
  buildGeoArrowTables
} from '@walkthru-earth/objex-utils';

// 1. Read footer metadata (~512KB range requests, no DuckDB)
const meta = await readParquetMetadata(url);
const sourceCrs = extractEpsgFromGeoMeta(meta.geo!);   // e.g. 'EPSG:27700' or null

// 2. Get WKB buffers + attributes from your SQL engine (DuckDB-WASM, etc.)
const { wkbArrays, attributes } = await myEngine.queryForMap(...);

// 3. Build GeoArrow tables (one per geometry type)
const tables = buildGeoArrowTables(wkbArrays, attributes);

// 4. Feed into deck.gl GeoArrowLayer(s)
```

### Parse a cloud storage URL a user pasted

```ts
import { parseStorageUrl, looksLikeUrl, describeParseResult } from '@walkthru-earth/objex-utils';

const parsed = parseStorageUrl(input);
// { provider: 's3', bucket: 'my-bucket', region: 'us-east-1', endpoint: '...', prefix: '...' }

console.log(describeParseResult(parsed));
```

### Read a binary blob as a hex dump

```ts
import { generateHexDump } from '@walkthru-earth/objex-utils';

const rows = generateHexDump(bytes);
// rows: [{ offset: '00000000', hex: ['48','65','6c',...], ascii: 'Hello...' }, ...]
```

## Upstream source

Most modules now live physically inside `packages/objex-utils/src/` (each re-exported via `export *` from `index.ts`). A handful of host-side types are still re-exported from `src/lib/` so both `@walkthru-earth/objex` and `@walkthru-earth/objex-utils` share the same shapes (Connection, StorageAdapter, QueryEngine, file-icons, constants). See [`packages/objex-utils/src/index.ts`](../src/index.ts) in the [objex](https://github.com/walkthru-earth/objex) monorepo.

## Versioning & releases

Both `@walkthru-earth/objex` and `@walkthru-earth/objex-utils` ship together via Changesets with a `fixed` config, so their versions stay in lockstep. See [`RELEASE.md`](../../../RELEASE.md) in the monorepo root.

## License

[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
