# @walkthru-earth/objex-utils

[![npm](https://img.shields.io/npm/v/@walkthru-earth/objex-utils?color=cb3837)](https://www.npmjs.com/package/@walkthru-earth/objex-utils)
[![License: CC BY 4.0](https://img.shields.io/badge/license-CC%20BY%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by/4.0/)

Pure TypeScript utilities extracted from [objex](https://github.com/walkthru-earth/objex) — zero Svelte dependency. Works with any JS framework or Node.js.

## Install

```bash
pnpm add @walkthru-earth/objex-utils
```

## Usage

```ts
import {
  // WKB / Geometry
  parseWKB,
  findGeoColumn,
  buildGeoArrowTables,

  // Storage URLs
  parseStorageUrl,
  looksLikeUrl,

  // Parquet metadata
  readParquetMetadata,
  extractEpsgFromGeoMeta,
  extractBounds,

  // File type registry
  getFileTypeInfo,
  getViewerKind,
  getMimeType,
  isQueryable,

  // Formatting
  formatFileSize,
  formatDate,
  formatValue,
  jsonReplacerBigInt,

  // Column types
  classifyType,
  typeColor,
  typeLabel,

  // Hex dump
  generateHexDump,

  // Error handling
  handleLoadError,

  // Constants
  WGS84_CODES,
  DEFAULT_TARGET_CRS,
  STORAGE_KEYS,
} from '@walkthru-earth/objex-utils';
```

## Exports

| Export | Description |
|--------|-------------|
| `parseWKB()` | Parse WKB binary into coordinates with geometry type classification |
| `findGeoColumn()` | 5-priority heuristic to detect geometry columns in tabular data |
| `buildGeoArrowTables()` | Convert WKB arrays to GeoArrow tables for deck.gl rendering |
| `parseStorageUrl()` | Parse S3/GCS/Azure/R2 URLs into provider, bucket, key |
| `readParquetMetadata()` | Read Parquet file metadata via HTTP range requests (hyparquet) |
| `getFileTypeInfo()` | Map file extensions to viewer kind, category, icon, and MIME type |
| `formatFileSize()` | Human-readable file sizes (1024-based: KB, MB, GB) |
| `formatValue()` | Format any value for display (handles BigInt, Date, objects, null) |
| `generateHexDump()` | Generate hex dump rows from binary data |
| `classifyType()` | Classify SQL/Arrow column types into categories |
| `handleLoadError()` | Normalize errors, silently skip AbortError |
| `WGS84_CODES` | Set of EPSG codes considered WGS84 (4326, 4979) |

## Optional Peer Dependencies

Heavy dependencies are optional — only install what you use:

- `apache-arrow` — required for `buildGeoArrowTables()`
- `hyparquet` + `hyparquet-compressors` — required for `readParquetMetadata()`

## Related

- [`@walkthru-earth/objex`](https://www.npmjs.com/package/@walkthru-earth/objex) — Full Svelte 5 component library with viewers, stores, and query engine

## License

[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
