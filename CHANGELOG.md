# @walkthru-earth/objex

## 1.1.0

### Minor Changes

- [`72f9e24`](https://github.com/walkthru-earth/objex/commit/72f9e24c1b7086e2f5d766849e8418f0114842ea) Thanks [@yharby](https://github.com/yharby)! - Extract framework-agnostic utilities for cross-framework reuse

  New exports in both packages:

  - **cloud-url**: `resolveCloudUrl()`, `getNativeScheme()`, `safeDecodeURIComponent()` — cloud protocol URL conversion
  - **file-sort**: `sortFileEntries()`, `toggleSortField()` — file entry sorting with directory-first precedence
  - **local-storage**: `loadFromStorage()`, `persistToStorage()` — generic localStorage helpers with SSR safety
  - **export**: `serializeToCsv()`, `serializeToJson()`, `escapeCsvField()` — pure data serialization (Node.js-compatible)
  - **markdown-sql**: `parseMarkdownDocument()`, `interpolateTemplates()`, `markSqlBlocks()` — markdown with SQL block parsing
  - **providers**: `PROVIDERS`, `PROVIDER_IDS`, `getProvider()`, `buildProviderBaseUrl()`, `buildEndpointFromTemplate()`, `isGcsProvider()` — cloud storage provider registry

  Bug fixes:

  - Fix `$lib` import in `connections.svelte.ts` testWithConfig cleanup
  - Fix missing BigInt handling in CSV/JSON export serialization

## 1.0.0

### Major Changes

- [`ff8f1b8`](https://github.com/walkthru-earth/objex/commit/ff8f1b89907769f7837838f2559d3800b3fbc027) Thanks [@yharby](https://github.com/yharby)! - First stable release.

  - Svelte 5 component library for exploring geospatial object storage (S3, GCS, Azure, R2)
  - 18+ file-format viewers (Parquet, GeoParquet, PMTiles, COG, Zarr, FlatGeobuf, 3D, PDF, and more)
  - DuckDB-WASM query engine with cancellable queries
  - Zero-copy WKB → GeoArrow pipeline for map rendering
  - Pure TS utilities package (`objex-utils`) with WKB parser, GeoArrow builder, storage URL parser, Parquet metadata reader
  - All `$lib/` imports replaced with relative paths for correct npm packaging
  - Exports map includes `"import"` condition for non-Svelte consumers
