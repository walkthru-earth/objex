# Geometry

WKB parsing, geometry-column detection, and GeoArrow table construction. Zero-copy where possible.

Source: `src/lib/utils/wkb.ts`, `src/lib/utils/geoarrow.ts`.

## Types

### `GeoType`

```ts
type GeoType =
  | 'Point'
  | 'LineString'
  | 'Polygon'
  | 'MultiPoint'
  | 'MultiLineString'
  | 'MultiPolygon'
  | 'Unknown';
```

`'Unknown'` is returned for unsupported WKB types (GeometryCollections, TINs, triangles, etc.).

### `ParsedGeometry`

```ts
interface ParsedGeometry {
  type: GeoType;
  coordinates: number[] | number[][] | number[][][] | number[][][][];
}
```

Coordinate nesting follows GeoJSON conventions.

| Type | Shape |
|------|-------|
| `Point` | `[x, y]` |
| `MultiPoint` / `LineString` | `[[x, y], ...]` |
| `MultiLineString` / `Polygon` | `[[[x, y], ...], ...]` |
| `MultiPolygon` | `[[[[x, y], ...], ...], ...]` |

### `GeoArrowGeomType`

```ts
type GeoArrowGeomType =
  | 'point'
  | 'linestring'
  | 'polygon'
  | 'multipoint'
  | 'multilinestring'
  | 'multipolygon';
```

Lowercase normalized form used by the GeoArrow builder and `@geoarrow/deck.gl-layers`.

### `GeoArrowResult`

```ts
interface GeoArrowResult {
  table: Table;                                      // apache-arrow Table
  geometryType: GeoArrowGeomType;
  bounds: [number, number, number, number];          // [minX, minY, maxX, maxY]
  sourceIndices: number[];                           // table row i → original wkbArrays[sourceIndices[i]]
}
```

`sourceIndices` lets callers map picked rows back to the original row order when mixed geometry types force a split.

## Functions

### `toBinary(value)`

```ts
function toBinary(value: unknown): Uint8Array | null
```

Normalize an arbitrary "possibly-binary" value to a `Uint8Array`.

| Input | Handling |
|-------|----------|
| `Uint8Array` | Returned as-is |
| `ArrayBuffer` | Wrapped in `new Uint8Array(buf)` |
| `number[]` | `new Uint8Array(arr)` |
| Hex string (even length, `[0-9a-fA-F]`) | Decoded to bytes |
| DuckDB `toJSON()` blob object `{0: b0, 1: b1, ...}` | Reassembled into bytes |
| Anything else | `null` |

Returns **`null`** rather than throwing on unrecognized input, so callers can fall through.

### `parseWKB(data)`

```ts
function parseWKB(data: Uint8Array): ParsedGeometry | null
```

Parse a WKB byte blob.

- Supports standard WKB, ISO WKB with Z/M flags, and EWKB with SRID prefix (PostGIS). Z/M ordinates are **dropped** — only X/Y is returned.
- Supports Point, LineString, Polygon, MultiPoint, MultiLineString, MultiPolygon.
- Returns **`null`** for truncated buffers, invalid byte-order flags, or malformed geometry.
- GeometryCollections (WKB type 7) return `{ type: 'Unknown', coordinates: [] }`.

### `findGeoColumn(schema)`

```ts
function findGeoColumn(
  schema: { name: string; type: string }[]
): string | null
```

Schema-only heuristic for locating the geometry column. Checks in priority order:

1. **Type** contains a geometry keyword (`GEOMETRY`, `POINT`, `WKB`, ...) — match wins immediately.
2. Exact well-known **name** (`geometry`, `geom`, `the_geom`, ...) **with** a binary-ish type (`BLOB`, `BINARY`, `VARBINARY`, `BYTES`).
3. Exact well-known **name**, any type.
4. Name contains a geo hint (`geom`, `geo_`, `wkb`, `wkt`, `shape`, `spatial`) with binary-ish type.
5. Name contains geo hint, any type.

Returns the first matching `name`, or `null` if no heuristic hits. Use `findGeoColumnFromRows` as a fallback when the schema is not informative.

### `findGeoColumnFromRows(rows, schema)`

```ts
function findGeoColumnFromRows(
  rows: Record<string, unknown>[],
  schema: { name: string; type: string }[]
): string | null
```

Row-based probe. Samples the first row and classifies values:

- Binary-typed columns: tests for WKB magic bytes (endian flag 0x00/0x01 + valid geometry type).
- Other columns: probes hex-encoded WKB, WKT strings starting with `POINT(`, `LINESTRING(`, etc., and GeoJSON geometry objects (`{type: 'Point', coordinates: [...]}`).

Returns the first column whose value looks geometry-shaped, or `null`.

### `normalizeGeomType(raw)`

```ts
function normalizeGeomType(raw: string): GeoArrowGeomType
```

Map a DuckDB `ST_GeometryType()` result (`'POINT'`, `'ST_Polygon'`, etc., case-insensitive, optional `ST_` prefix) to a `GeoArrowGeomType`. Unknown input falls back to `'polygon'`.

### `buildGeoArrowTables(wkbArrays, attributes, knownGeomType?)`

```ts
function buildGeoArrowTables(
  wkbArrays: Uint8Array[],
  attributes: Map<string, { values: any[]; type: string }>,
  knownGeomType?: GeoArrowGeomType
): GeoArrowResult[]
```

Build one or more Arrow `Table` objects keyed by geometry type, ready for `@geoarrow/deck.gl-layers`.

**Parameters**

| Name | Type | Meaning |
|------|------|---------|
| `wkbArrays` | `Uint8Array[]` | Per-row WKB binary. Entries may be empty / invalid — they are skipped. |
| `attributes` | `Map<name, { values, type }>` | Non-geometry columns. `values.length` must equal `wkbArrays.length`. `type` is a DuckDB/Arrow type string used for Arrow dtype inference (numeric → Float64, bool → Bool, everything else → Utf8). |
| `knownGeomType` | optional | If provided (e.g. from GeoParquet metadata), classification is skipped — all WKBs are assumed to share this type, and one `GeoArrowResult` is returned. |

**Behavior**

- **Zero-copy geometry ingest.** A 5-byte peek classifies each WKB; coordinates are read directly into pre-allocated `Float64Array` backings with no intermediate JS objects.
- **Mixed-type splitting.** If `knownGeomType` is not provided and the rows span multiple types (e.g. `Polygon` and `MultiPolygon`), rows are partitioned and one `GeoArrowResult` is emitted per non-empty group.
- **Bounds.** Each result carries a computed `[minX, minY, maxX, maxY]`. When splitting, each group sees its own tight bounds.
- **Attribute propagation.** Attribute values follow the split via `sourceIndices`.
- **Empty / unknown WKBs** are silently dropped.

**Returns** `GeoArrowResult[]` — empty array if no rows have parseable geometries.

**Peer dependencies**

- `apache-arrow` (used to construct the returned `Table`).

**Example**

```ts
import { buildGeoArrowTables, normalizeGeomType } from '@walkthru-earth/objex-utils';

const wkbArrays: Uint8Array[] = rows.map(r => r.geometry);
const attributes = new Map([
  ['id', { values: rows.map(r => r.id), type: 'BIGINT' }],
  ['name', { values: rows.map(r => r.name), type: 'VARCHAR' }]
]);

// When you know the type from GeoParquet metadata:
const [result] = buildGeoArrowTables(wkbArrays, attributes, normalizeGeomType('POLYGON'));

// When you do not:
const results = buildGeoArrowTables(wkbArrays, attributes);
for (const r of results) {
  console.log(r.geometryType, r.table.numRows, r.bounds);
}
```
