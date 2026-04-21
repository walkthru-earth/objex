# @walkthru-earth/objex-utils

[![npm](https://img.shields.io/npm/v/@walkthru-earth/objex-utils?color=cb3837)](https://www.npmjs.com/package/@walkthru-earth/objex-utils)
[![License: CC BY 4.0](https://img.shields.io/badge/license-CC%20BY%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by/4.0/)

Pure TypeScript utilities extracted from [objex](https://github.com/walkthru-earth/objex). Zero Svelte dependency. Works with any JS framework or Node 18+.

Built for high-performance geospatial pipelines: WKB parsing, GeoArrow table construction, GeoParquet footer reading via range requests, cloud URL parsing, and a 200+ extension file-type registry.

## Install

```bash
pnpm add @walkthru-earth/objex-utils
# or
npm install @walkthru-earth/objex-utils
```

## At a glance

```ts
import {
  // WKB / GeoArrow
  parseWKB,
  findGeoColumn,
  buildGeoArrowTables,

  // Parquet metadata (hyparquet, range requests)
  readParquetMetadata,
  extractEpsgFromGeoMeta,
  extractBounds,

  // Storage URLs
  parseStorageUrl,
  resolveCloudUrl,
  looksLikeUrl,

  // File-type registry
  getFileTypeInfo,
  getViewerKind,
  getDuckDbReadFn,
  isQueryable,

  // Formatting / classification / hex / CSV / JSON
  formatFileSize,
  formatValue,
  classifyType,
  generateHexDump,
  serializeToCsv,
  serializeToJson,

  // Error handling
  handleLoadError,

  // Constants
  WGS84_CODES,
  DEFAULT_TARGET_CRS,
  STORAGE_KEYS,
} from '@walkthru-earth/objex-utils';
```

## Documentation

Full per-module developer reference lives in [`docs/`](./docs/README.md). Each page lists the exact TypeScript signature, parameter semantics, return shape, peer-dependency requirements, and non-obvious behavior.

| Page | Covers |
|------|--------|
| [`docs/geometry.md`](./docs/geometry.md) | WKB parser, GeoArrow builder, geometry-column detection |
| [`docs/cog.md`](./docs/cog.md) | Cloud-Optimized GeoTIFF pipeline helpers, band configs, color ramps |
| [`docs/parquet-metadata.md`](./docs/parquet-metadata.md) | `readParquetMetadata` + CRS / bounds / geometry-type extractors |
| [`docs/storage.md`](./docs/storage.md) | URL parsing, provider registry, `StorageAdapter`, `UrlAdapter` |
| [`docs/query-engine.md`](./docs/query-engine.md) | `QueryEngine` interface + handle / result types |
| [`docs/file-types.md`](./docs/file-types.md) | File-type registry: `getFileTypeInfo`, `getViewerKind`, `getDuckDbReadFn`, … |
| [`docs/formatting.md`](./docs/formatting.md) | Display formatters, column-type classification, hex dump, CSV/JSON export |
| [`docs/file-sort.md`](./docs/file-sort.md) | `sortFileEntries`, `toggleSortField` |
| [`docs/markdown-sql.md`](./docs/markdown-sql.md) | Markdown + SQL block parsing (Evidence-compatible) |
| [`docs/local-storage.md`](./docs/local-storage.md) | SSR-safe `loadFromStorage` / `persistToStorage` |
| [`docs/errors.md`](./docs/errors.md) | `handleLoadError` |
| [`docs/types-constants.md`](./docs/types-constants.md) | `Connection`, `Tab`, `FileEntry`, `WriteResult`, `Theme`, shared constants |

## Optional peer dependencies

Heavy dependencies are **optional** peers. Install only what you use.

| Peer | Required by |
|------|-------------|
| `apache-arrow >=14` | `buildGeoArrowTables` |
| `hyparquet >=1.25` | `readParquetMetadata` and friends |
| `hyparquet-compressors >=1.1` | SNAPPY / ZSTD / GZIP / LZ4 / BROTLI support in `readParquetMetadata` |
| `yaml >=2` | `parseMarkdownDocument` (lazy-loaded — only when frontmatter is present) |

As of v1.2 the `yaml` dependency is imported dynamically inside `parseMarkdownDocument`. Consumers who never call that function do not need `yaml` at all. Before v1.2 the bundle failed to load without `yaml` even for unrelated imports.

## Related

- [`@walkthru-earth/objex`](https://www.npmjs.com/package/@walkthru-earth/objex) — Full Svelte 5 component library with viewers, stores, and query engine.

## License

[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
