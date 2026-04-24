# Parquet metadata

Lightweight GeoParquet-aware metadata reader for remote Parquet files. Uses [`hyparquet`](https://github.com/hyparam/hyparquet) via HTTP range requests (~512 KB) so you can inspect schemas and geo metadata **before** DuckDB-WASM finishes booting.

Source: `src/lib/utils/parquet-metadata.ts`.

## Peer dependencies

- `hyparquet >= 1.25`
- `hyparquet-compressors >= 1.1` (SNAPPY, ZSTD, GZIP, LZ4, BROTLI)

## Types

### `GeoColumnMeta`

```ts
interface GeoColumnMeta {
  encoding: string;              // e.g. 'WKB'
  geometryTypes: string[];       // e.g. ['Polygon', 'MultiPolygon']
  crs: any | null;               // raw ProjJSON or EPSG identifier
  bbox?: number[];               // [minX, minY, maxX, maxY]  (or with Z: 6 values)
}
```

### `GeoParquetMeta`

```ts
interface GeoParquetMeta {
  primaryColumn: string;
  columns: Record<string, GeoColumnMeta>;
}
```

### `ParquetFileMetadata`

```ts
interface ParquetFileMetadata {
  rowCount: number;
  /** Leaf columns only — struct parents are flattened into their child paths. */
  schema: { name: string; type: string }[];
  /**
   * Top-level column names as written, including struct/group parents
   * (e.g. `assets`, `bbox`) that `schema` flattens away. Required for
   * stac-geoparquet detection, which keys on the `assets` struct parent.
   */
  topLevelColumns: string[];
  geo: GeoParquetMeta | null;      // null for non-geo Parquet
  legacyGeoParquet: boolean;       // true for pre-1.0 (schema_version without "version" field)
  createdBy: string | null;
  numRowGroups: number;
  compression: string | null;      // e.g. 'SNAPPY', 'ZSTD'
}
```

## Functions

### `readParquetMetadata(url)`

```ts
async function readParquetMetadata(url: string): Promise<ParquetFileMetadata>
```

Read the Parquet footer from a remote URL via range requests.

**Parameters**

| Name | Type | Meaning |
|------|------|---------|
| `url` | `string` | Full HTTPS URL. Must be CORS-accessible. `s3://` / `gs://` URIs must be resolved first (see [`resolveCloudUrl`](./storage.md#resolvecloudurl)). |

**Returns** `Promise<ParquetFileMetadata>`.

**Throws** a native error if the URL is not reachable, CORS is blocked, or the footer is malformed.

**Notes**

- The `geo` field contains the parsed `"geo"` key from Parquet file-level KV metadata. For legacy files (`schema_version` but no `version`), it is still parsed; `legacyGeoParquet` is set so callers can apply fallbacks.
- `compression` comes from the first row group's first column and is reported capitalized.

### `extractEpsgFromGeoMeta(geo)`

```ts
function extractEpsgFromGeoMeta(geo: GeoParquetMeta): string | null
```

Extract an EPSG authority code from a GeoParquet CRS block. Returns `null` for WGS84/CRS84 (no reprojection needed) or when no EPSG identifier is embedded.

**Return examples**

- `'EPSG:27700'` (British National Grid)
- `'EPSG:3857'` (Web Mercator)
- `null` (WGS84 or CRS absent)

### `extractGeometryTypes(geo)`

```ts
function extractGeometryTypes(
  geo: GeoParquetMeta
): GeoArrowGeomType[]
```

Pull the `geometry_types` array from the primary column's metadata and normalize it into [`GeoArrowGeomType`](./geometry.md#geoarrowgeomtype). Useful to skip per-row `ST_GeometryType()` calls.

### `extractBounds(geo)`

```ts
function extractBounds(
  geo: GeoParquetMeta
): [number, number, number, number] | null
```

Extract the `bbox` from the primary column. Returns `null` when absent. If the bbox has Z (`[minX, minY, minZ, maxX, maxY, maxZ]`), only the XY extent is returned.

## End-to-end example

```ts
import {
  readParquetMetadata,
  extractEpsgFromGeoMeta,
  extractGeometryTypes,
  extractBounds,
} from '@walkthru-earth/objex-utils';

const meta = await readParquetMetadata(
  'https://example.com/data.parquet'
);

console.log({
  rows: meta.rowCount,
  compression: meta.compression,
  schema: meta.schema,             // leaf columns only
  topLevel: meta.topLevelColumns,  // includes struct parents like `assets`, `bbox`
});

if (meta.geo) {
  const crs = extractEpsgFromGeoMeta(meta.geo);          // null means WGS84
  const types = extractGeometryTypes(meta.geo);          // ['polygon']
  const bbox = extractBounds(meta.geo);                  // [minX, minY, maxX, maxY] | null
  console.log({ crs, types, bbox, legacy: meta.legacyGeoParquet });
}
```
