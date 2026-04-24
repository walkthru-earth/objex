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
| [`geometry.md`](./geometry.md) | WKB parser, GeoArrow table builder, geometry-column detection |
| [`cog.md`](./cog.md) | Cloud-Optimized GeoTIFF helpers (pipeline selection, band configs, color ramps, bounds clamping) |
| [`parquet-metadata.md`](./parquet-metadata.md) | `readParquetMetadata` + CRS / bounds / geometry-types extractors |
| [`stac-geoparquet.md`](./stac-geoparquet.md) | stac-geoparquet detection (`isStacGeoparquetSchema`) and row-to-Item transforms (`stacRowToItem`, `flattenStacBbox`, `pickStacPrimaryAsset`, `resolveStacAssetHref`) |
| [`storage.md`](./storage.md) | URL parsing (`parseStorageUrl`, `resolveCloudUrl`), provider registry, `StorageAdapter` interface, `UrlAdapter` |
| [`query-engine.md`](./query-engine.md) | `QueryEngine` interface and associated result/handle types |
| [`file-types.md`](./file-types.md) | File-type registry (`getFileTypeInfo`, `getViewerKind`, `getDuckDbReadFn`, ...) |
| [`formatting.md`](./formatting.md) | Display formatters, column-type classification, hex dump, CSV/JSON export |
| [`file-sort.md`](./file-sort.md) | `sortFileEntries`, `toggleSortField` |
| [`markdown-sql.md`](./markdown-sql.md) | Markdown + SQL block parsing (Evidence-compatible syntax) |
| [`local-storage.md`](./local-storage.md) | SSR-safe `loadFromStorage` / `persistToStorage` |
| [`errors.md`](./errors.md) | `handleLoadError` |
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

All modules re-export from `src/lib/` in the [objex](https://github.com/walkthru-earth/objex) monorepo. The re-export list lives at [`packages/objex-utils/src/index.ts`](../src/index.ts).

## Versioning & releases

Both `@walkthru-earth/objex` and `@walkthru-earth/objex-utils` ship together via Changesets with a `fixed` config, so their versions stay in lockstep. See [`RELEASE.md`](../../../RELEASE.md) in the monorepo root.

## License

[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
