# File-type registry

Central mapping between file extensions and everything objex needs to render or query them — icon, color, viewer, MIME type, DuckDB read function.

Source: `src/lib/file-icons/index.ts`.

## Types

### `FileCategory`

```ts
type FileCategory =
  | 'data' | 'geo' | 'code' | 'document' | 'config'
  | 'image' | 'video' | 'audio' | 'archive'
  | 'database' | '3d' | 'other';
```

### `ViewerKind`

```ts
type ViewerKind =
  | 'table' | 'image' | 'video' | 'audio' | 'markdown' | 'code'
  | 'cog' | 'pmtiles' | 'flatgeobuf' | 'pdf' | '3d' | 'archive'
  | 'database' | 'zarr' | 'copc' | 'notebook' | 'raw';
```

Use this to drive viewer routing in your own UI.

### `DuckDbReadFn`

```ts
type DuckDbReadFn = 'read_parquet' | 'read_csv' | 'read_json' | 'ST_Read';
```

Which DuckDB table function should be used to ingest the file. `ST_Read` covers GDAL-backed vector formats (Shapefile, GeoPackage, FlatGeobuf, KML, GML).

### `FileTypeInfo`

```ts
interface FileTypeInfo {
  icon: string;            // Lucide icon name
  color: string;           // Tailwind color classes (light + dark)
  label: string;           // human-readable type label
  category: FileCategory;
  viewer: ViewerKind;
  queryable: boolean;
  duckdbReadFn: DuckDbReadFn | null;
  mimeType: string;
}
```

## Functions

### `getFileTypeInfo(extension, isDir?)`

```ts
function getFileTypeInfo(extension: string, isDir?: boolean): FileTypeInfo
```

Return a fully populated `FileTypeInfo` for an extension.

- `extension` is matched with or without a leading dot, case-insensitive.
- `isDir === true` short-circuits to a directory entry (folder icon, `category: 'other'`, `viewer: 'raw'`).
- Unknown extensions return the `raw` entry.

### `getViewerKind(extension)`

```ts
function getViewerKind(extension: string): ViewerKind
```

Shorthand that returns `info.viewer` only. `extension` may be a full filename or an extension.

### `getMimeType(extension)`

```ts
function getMimeType(extension: string): string
```

Return the MIME type (`application/octet-stream` fallback). Useful for `Content-Type` on uploads and `<a download>` links.

### `isQueryable(extension)`

```ts
function isQueryable(extension: string): boolean
```

`true` when the format can be queried with DuckDB (Parquet, CSV, TSV, JSONL, NDJSON, Shapefile, GeoPackage, FlatGeobuf, KML, GML, etc.).

### `getDuckDbReadFn(pathOrExt)`

```ts
function getDuckDbReadFn(pathOrExt: string): string
```

Return the DuckDB table-function name (`'read_parquet'`, `'read_csv'`, `'read_json'`, `'ST_Read'`). Falls back to `'read_parquet'` when unknown.

Accepts either a file path or a bare extension.

### `isCloudNativeFormat(pathOrExt)`

```ts
function isCloudNativeFormat(pathOrExt: string): boolean
```

`true` for formats DuckDB can query directly over HTTP range requests without buffering the whole file (`.parquet`, `.geoparquet`, `.gpq`, `.gparquet`, `.ducklake`).

### `buildDuckDbSource(pathOrExt, url)`

```ts
function buildDuckDbSource(pathOrExt: string, url: string): string
```

Return a ready-to-paste FROM-clause expression. Key behavior:

| Ext | Output |
|-----|--------|
| `.parquet` / `.geoparquet` | `read_parquet('<url>')` |
| `.csv` / `.tsv` | `read_csv('<url>')` |
| `.jsonl` / `.ndjson` | `read_json('<url>')` |
| `.json` | Unnested expression that flattens GeoJSON `features[*]` into rows with property columns + a `geometry` column |
| `.shp`, `.gpkg`, `.fgb`, `.kml`, `.gml` | `ST_Read('<url>')` |
| Unknown | `read_parquet('<url>')` fallback |

## Example

```ts
import {
  getFileTypeInfo,
  isQueryable,
  buildDuckDbSource,
} from '@walkthru-earth/objex-utils';

const info = getFileTypeInfo('streets.fgb');
// { viewer: 'flatgeobuf', category: 'geo', queryable: true, duckdbReadFn: 'ST_Read', ... }

if (isQueryable('streets.fgb')) {
  const sql = `SELECT COUNT(*) FROM ${buildDuckDbSource('streets.fgb', url)}`;
  // SELECT COUNT(*) FROM ST_Read('https://.../streets.fgb')
}
```
