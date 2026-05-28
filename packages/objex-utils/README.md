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

  // stac-geoparquet (detection + row → STAC Item)
  isStacGeoparquetSchema,
  stacRowToItem,
  flattenStacBbox,
  pickStacPrimaryAsset,
  resolveStacAssetHref,

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

## Usage

The package ships ESM and CommonJS builds with full TypeScript types, so it behaves the same across toolchains. Every export is a plain function, class, or constant with no framework coupling, there is no provider, context, or adapter to wire up.

ESM (browser bundlers, modern Node, TypeScript):

```ts
import { parseStorageUrl, formatFileSize } from '@walkthru-earth/objex-utils';

const parsed = parseStorageUrl('s3://my-bucket/data/');
const label = formatFileSize(1048576); // human-readable size
```

CommonJS (Node `require`):

```js
const { parseStorageUrl, formatFileSize } = require('@walkthru-earth/objex-utils');
```

Framework notes:

- React, Vue, Svelte, Solid, or vanilla JS, import the functions and call them directly. The package holds no framework state and renders no UI, so no wrapper is needed.
- Node 18+, the data utilities (`readParquetMetadata`, `parseStorageUrl`, WKB and GeoArrow builders) run server-side on the global `fetch`. Browser-only helpers such as `copyToClipboard` and `loadFromStorage` detect the missing API and no-op or return defaults rather than throwing.
- Install only the optional peers for the functions you actually call (see the table below).

## Documentation

Full per-module developer reference lives in [`docs/`](./docs/README.md), the authoritative index. Each page lists the exact TypeScript signature, parameter semantics, return shape, peer-dependency requirements, and non-obvious behavior. The areas below link a few entry points, see the [docs index](./docs/README.md) for all 24 modules.

| Area | Pages |
|------|-------|
| Geometry and raster | [`geometry`](./docs/geometry.md), [`parquet-metadata`](./docs/parquet-metadata.md), [`cog`](./docs/cog.md) (pure helpers only, the render pipeline stays in `@walkthru-earth/objex`), [`cog-asset`](./docs/cog-asset.md), [`channel-composite`](./docs/channel-composite.md) |
| STAC | [`stac`](./docs/stac.md), [`stac-geoparquet`](./docs/stac-geoparquet.md), [`stac-facets`](./docs/stac-facets.md), [`stac-pushdown`](./docs/stac-pushdown.md), [`stac-source`](./docs/stac-source.md), [`stac-hydrate`](./docs/stac-hydrate.md), [`stac-storage-extension`](./docs/stac-storage-extension.md) |
| Storage and URLs | [`storage`](./docs/storage.md) |
| Files and formatting | [`file-types`](./docs/file-types.md), [`formatting`](./docs/formatting.md) (formatters, column types, hex dump, CSV/JSON), [`file-sort`](./docs/file-sort.md) |
| App utilities | [`app-config`](./docs/app-config.md), [`types-constants`](./docs/types-constants.md), [`local-storage`](./docs/local-storage.md), [`markdown-sql`](./docs/markdown-sql.md), [`lru`](./docs/lru.md), [`map-pixel-inspect`](./docs/map-pixel-inspect.md), [`errors`](./docs/errors.md), [`query-engine`](./docs/query-engine.md) |

## Optional peer dependencies

Heavy dependencies are **optional** peers. Install only what you use.

| Peer | Required by |
|------|-------------|
| `apache-arrow >=14` | `buildGeoArrowTables` |
| `hyparquet >=1.25` | `readParquetMetadata` and friends |
| `hyparquet-compressors >=1.1` | SNAPPY / ZSTD / GZIP / LZ4 / BROTLI support in `readParquetMetadata` |
| `yaml >=2` | `parseMarkdownDocument` (lazy-loaded, only when frontmatter is present) |

As of v1.2 the `yaml` dependency is imported dynamically inside `parseMarkdownDocument`. Consumers who never call that function do not need `yaml` at all. Before v1.2 the bundle failed to load without `yaml` even for unrelated imports.

## Related

- [`@walkthru-earth/objex`](https://www.npmjs.com/package/@walkthru-earth/objex), the full Svelte 5 component library with viewers, stores, and query engine.

## License

[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
