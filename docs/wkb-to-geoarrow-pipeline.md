# WKB to GeoArrow pipeline in objex

A traced reference for the WKB to GeoArrow conversion path used by
`@walkthru-earth/objex` and `@walkthru-earth/objex-utils`. Every claim
below cites the file and line that backs it. The intent is to make the
public Slack reply to Kyle Barron defensible line by line.

## 1. Overview

Objex reads geospatial tables (GeoParquet, native Parquet `GEOMETRY`,
GeoJSON, etc.) through DuckDB-WASM, then renders them on a deck.gl map
via `@geoarrow/deck.gl-layers`. The bridge between DuckDB's Arrow output
and the GeoArrow-typed Arrow tables that deck.gl-layers expects is
`buildGeoArrowTables` in `packages/objex-utils/src/geoarrow.ts` (re-exported through `src/lib/index.ts` and the `@walkthru-earth/objex-utils` entry point). It walks raw WKB
bytes directly into pre-allocated `Float64Array` and `Int32Array`
buffers and wraps them with the correct nested Arrow type and
`ARROW:extension:name` metadata. No GeoJSON, no `parseWKB()`, no
per-row JS allocation on the geometry hot path.

The path is allocation-aware because every other approach we tried
(parsing to GeoJSON first, calling `tableFromIPC` across the
DuckDB-WASM and project Arrow versions, asking DuckDB for native
GeoArrow output) either broke on data, allocated megabytes of garbage
per frame, or hit upstream bugs that have not yet been fixed.

## 2. Public API

### `buildGeoArrowTables`

`packages/objex-utils/src/geoarrow.ts:737-788`. Exported through both
`src/lib/index.ts:147` and `packages/objex-utils/src/index.ts:147`.

```ts
export function buildGeoArrowTables(
    wkbArrays: Uint8Array[],
    attributes: Map<string, { values: any[]; type: string }>,
    knownGeomType?: GeoArrowGeomType
): GeoArrowResult[]
```

`GeoArrowGeomType` is the lowercase set
`'point' | 'linestring' | 'polygon' | 'multipoint' | 'multilinestring' | 'multipolygon'`
(`packages/objex-utils/src/geoarrow.ts:25-31`). `GeoArrowResult` is
`{ table: arrow.Table, geometryType, bounds: [minX, minY, maxX, maxY], sourceIndices: number[] }`
(`:33-39`).

Real call site (single-table viewer):

```svelte
const geoArrowResults = buildGeoArrowTables(
    result.wkbArrays,
    result.attributes,
    effectiveGeomType
);
```

`src/lib/components/viewers/GeoParquetMapViewer.svelte:133-137`.

The exact npm version exporting this is `@walkthru-earth/objex-utils@1.3.1`
(`packages/objex-utils/package.json:3`).

### `normalizeGeomType(raw)`

`packages/objex-utils/src/geoarrow.ts:42-51`. Maps DuckDB `ST_GeometryType()`
output (`POLYGON`, `ST_MULTIPOLYGON`, etc., case-insensitive) to the
`GeoArrowGeomType` enum. Unknown input falls back to `'polygon'`. The
fallback is load-bearing because deck.gl-layers will throw if the
declared type does not match the Arrow extension name on the column.

## 3. End-to-end data cycle

Numbered trace from "user opens a GeoParquet file" to deck.gl frame.

1.  User selects a `.parquet` (or stac-geoparquet) tab.
    `ViewerRouter` mounts `TableViewer.svelte`.
2.  DuckDB-WASM boots via `getDB()` in `src/lib/query/wasm.ts:80-371`.
    The init sequence is order-sensitive:
    1.  `await duckdb.instantiate(...)`.
    2.  OPFS open (registered handle path or `opfs://` scheme),
        `:144-247`.
    3.  Single combined query at `:259-261`:
        `SELECT * FROM duckdb_coordinate_systems(); INSTALL httpfs;
        LOAD httpfs; INSTALL spatial; LOAD spatial;`. The
        `duckdb_coordinate_systems()` call MUST come before the
        explicit `LOAD spatial` to warm PROJ. This is the
        objex workaround for
        [`duckdb-wasm#2199`](https://github.com/duckdb/duckdb-wasm/issues/2199),
        the `stoi: no conversion` crash on GeoParquet with CRS
        metadata. Comment at `:254-258`.
    4.  `SET GLOBAL geometry_always_xy = true` at `:271`. Forces
        lon/lat axis order on DuckDB v1.5 so GeoParquet / GeoJSON
        convention holds and `ST_Transform` does not emit warnings.
    5.  Memory tuning batched after, `:303-339`.
3.  `TableViewer` resolves storage (`resolveTableSourceAsync(tab)` at
    `src/lib/components/viewers/TableViewer.svelte:313`) which presigns
    `s3://` to HTTPS for `signed-s3` connections via
    `storage/presign.ts`. `configureStorage` in `wasm.ts:936-1009`
    detects presigned refs via `isHttpsSourceRef()` and skips all S3
    SETs (`:944-947`).
4.  Schema and CRS detection. For Parquet, `readParquetMetadata` runs
    via hyparquet first
    (`TableViewer.svelte:345`), in parallel with the DuckDB boot. If
    the file is GeoParquet, the primary geometry column, its CRS, the
    geometry types, and bbox are extracted from the `geo` KV metadata.
    `knownGeomType` is set on the viewer when the metadata advertises
    a single type (`TableViewer.svelte:406-407`).
5.  Hyparquet reports the physical Parquet type (`BLOB` for legacy,
    `GEOMETRY` for native). DuckDB v1.5 reports
    `GEOMETRY('EPSG:...')` with CRS in the type. `TableViewer` re-asks
    DuckDB for the schema after init and refreshes `geoColType` so the
    SQL builder picks the right path
    (`TableViewer.svelte:489-515`).
6.  SQL build. `buildDefaultSql` at `TableViewer.svelte:110-162`:
    - If column type is spatial (`GEOMETRY`, `GEOGRAPHY`, `POINT`,
      etc., test at `:122-129`), project `ST_AsWKB(geom) AS __wkb`.
    - If column type is `BLOB`/`BYTEA` AND the file is WGS84 (no
      `sourceCrs`), project the column directly as
      `__wkb` (`:133-135`). This is the
      "WGS84 pass-through" mentioned in `CLAUDE.md`. No
      `ST_GeomFromWKB` / `ST_AsWKB` round-trip.
    - Otherwise wrap with `ST_GeomFromGeoJSON` or
      `wrapWkbWithCrs`, run `ST_Transform(..., DEFAULT_TARGET_CRS)`
      (OGC:CRS84), then `ST_AsWKB(...)` (`:139-149`).
    - SQL is `SELECT * EXCLUDE(geom_col), <wkbExpr> FROM <source>`.
7.  Execute. Cancellable streaming query through
    `WasmQueryEngine.queryCancellable` (`wasm.ts:1130-1224`), which
    uses `conn.send(sql)` (non-blocking) and iterates Arrow
    `RecordBatch`es. Binary columns are explicitly `.slice()`-copied
    out of the batch buffer because the streaming reader can reuse
    those buffers between batches (`wasm.ts:1184-1186`).
8.  `TableViewer` collects all rows into JS objects, then
    `extractMapData(rows)` (`TableViewer.svelte:164-191`) rebuilds the
    map payload: it walks the rows, runs `toBinary(row.__wkb)`
    (`wkb.ts:39-64`) to coerce arrays / hex strings / DuckDB
    `toJSON()` blobs back to `Uint8Array`, and builds the
    `attributes: Map<name, { values, type }>` keyed by column name.
    The geometry type is sniffed once from the first WKB via
    `parseWKB()` (`TableViewer.svelte:177`).
9.  `mapData` is passed as a prop to `GeoParquetMapViewer`. Its
    `loadGeoData` (`GeoParquetMapViewer.svelte:108-179`) calls
    `buildGeoArrowTables(result.wkbArrays, result.attributes,
    effectiveGeomType)`. `effectiveGeomType` is `knownGeomType` for
    saved queries, `undefined` for user-edited queries (because the
    user may have joined a different table or returned mixed types,
    `:131-132`).
10. `buildGeoArrowTables` returns one `GeoArrowResult` per
    non-empty type group. The viewer hands each to
    `createGeoArrowLayers` in `utils/deck.ts:174-182`, which
    dispatches by `geometryType` to `GeoArrowScatterplotLayer`
    (`point`/`multipoint`), `GeoArrowPathLayer`
    (`linestring`/`multilinestring`), or `GeoArrowPolygonLayer`
    (everything else, currently `polygon`/`multipolygon`). Lazy import
    at `utils/deck.ts:67-74`. The layers are mounted on a
    `MapboxOverlay` (deck.gl `interleaved: false`).

Streaming variant `queryForMapCancellable` at `wasm.ts:1307-1448` is
defined and projects the same `__wkb` column; the active
GeoParquetMapViewer path currently consumes the buffered `MapQueryResult`
that `TableViewer` builds from the row stream.

## 4. WKB parser internals

`packages/objex-utils/src/geoarrow.ts:63-587`. All reads go through `DataView`.
There is exactly one allocation per call: the pre-sized
`Float64Array` / `Int32Array` typed arrays that back the Arrow buffers.
The only auxiliary allocations are `Uint8Array` views over the same
underlying `ArrayBuffer` used to recursively peek into nested
geometries. There are no JS object allocations per row.

### 4.1 Header peek

`readWkbHeader(wkb)` at `:73-110`. 5-byte header plus optional SRID:

- Byte 0 is the byte-order marker (`0x01` little-endian, `0x00`
  big-endian). NDR / XDR are handled per nested geometry, because
  every nested geometry carries its own header (see Multi* notes
  below).
- Bytes 1 to 4 are `uint32` `rawType`. EWKB flags are stripped:
  `0x80000000` (Z), `0x40000000` (M), `0x20000000` (SRID). When SRID
  is present, header grows from 5 to 9 bytes.
- ISO WKB extended ranges are detected after EWKB flags are
  stripped (`:91-104`). `1001..1006 → Z`, `2001..2006 → M`,
  `3001..3006 → ZM`. Implementation is `if (type > 3000) ... else if
  (type > 2000) ... else if (type > 1000)`, so the range checks are
  open intervals from the codebase's point of view, see
  "Corrections" section.
- `coordStride = (2 + dims) * 8` so the inner loops simply step
  `off += h.coordStride` and still read only `x` and `y`. Z and M
  values are skipped, never stored.

Allocation count: 1 `DataView` (`:76`) plus 1 returned 4-field plain
object (`:109`). The header peek itself does not allocate per
coordinate.

### 4.2 Type classification

`classifyWkbType(wkb)` at `:113-132`. Reads the header then maps base
WKB type 1 to 6 to the `GeoArrowGeomType` enum. Returns `null` for
type 7 (GeometryCollection) and anything outside the 1 to 6 window
(including curved types 8 to 17 and `TIN`/`Triangle`).

### 4.3 Bounds tracker

`expandBounds(b, x, y)` at `:148-154`. Inline scalar checks. `NaN` is
explicitly filtered, so `POINT EMPTY` (which writes `NaN,NaN` per the
SFA-1.2 / EWKB convention) does not pollute the bbox.

### 4.4 Per-type builders

All builders take `(wkbs: Uint8Array[], b: BoundsTracker)` and return
`arrow.Data`.

#### Point (`buildPointData`, `:173-194`)

Single pass. Pre-allocates `new Float64Array(n * 2)`, walks each WKB,
reads 2 `getFloat64` calls at `h.dataOffset` and `h.dataOffset + 8`.
Malformed WKB (header read fails or `type !== 1`) is written as
`(0, 0)` and not added to bounds. The `(0, 0)` fallback is a known
imprecision, see Limitations.

#### LineString (`buildLineStringData`, `:200-245`)

Two-pass. Pass 1 reads `numPts` per geometry and computes the
cumulative `geomOffsets: Int32Array(n + 1)`. Pass 2 pre-allocates
`coords: Float64Array(totalCoords * 2)` and writes coordinates with
`off += h.coordStride` per point. Type asserted as `2`, mismatched
rows contribute zero coords (their offset is the previous cumulative
value, so they show up in the Arrow `List` as zero-length entries
rather than throwing).

#### Polygon (`buildPolygonData`, `:252-323`)

Two-pass. Counts rings and coords in pass 1, then writes both
`ringOffsets: Int32Array(totalRings + 1)` and
`coords: Float64Array(totalCoords * 2)` in pass 2. Output is
`List<List<FixedSizeList<2, Float64>>>` (polygons of rings of
coords).

#### MultiPoint (`buildMultiPointData`, `:326-382`)

Per-inner-point WKB header. Each inner point in a MultiPoint is a
full WKB (header + 2 doubles), per the SFA-1.2 / EWKB / ISO specs.
For each inner point the builder constructs a temporary
`Uint8Array(wkb.buffer, wkb.byteOffset + off, ...)` and calls
`readWkbHeader` on it (`:355-357`). The intent of that view is to
read the inner endianness flag and the inner ISO Z/M bits per
inner point, so a MultiPoint whose inner Points have a different
byte order or Z/M flag than the outer header is still decoded
correctly. The allocation cost is one `Uint8Array` view per inner
point and one transient header object (also one per inner point).
For an N-point MultiPoint that is `N` views and `N` header objects
per row, plus the typed array writes. See Open Questions for a path
to eliminate this.

#### MultiLineString (`buildMultiLineStringData`, `:388-473`)

Two-pass. Each inner LineString carries its own WKB header, same
pattern as MultiPoint. Pass 1 counts both `numLines` and
`totalCoords`. Pass 2 fills three buffers,
`geomOffsets: Int32Array(n + 1)`,
`lineOffsets: Int32Array(totalLines + 1)`, and
`coords: Float64Array(totalCoords * 2)`.

#### MultiPolygon (`buildMultiPolygonData`, `:479-587`)

Two-pass. Each inner Polygon WKB carries its own header. Pass 1
counts polygons, rings, coords. Pass 2 writes
`polyOffsets`, `ringOffsets`, `coords`. Output is the four-level
nest `List<List<List<FixedSizeList<2, Float64>>>>`.

### 4.5 Arrow output shape and extension metadata

Coordinate type is shared: a `FixedSizeList(2, Field('xy',
Float64))` (`:158-159`). The per-geometry Arrow shape is:

| geometry        | Arrow type                                          |
|-----------------|-----------------------------------------------------|
| point           | `FixedSizeList<2, Float64>`                         |
| linestring      | `List<FixedSizeList<2, Float64>>`                   |
| polygon         | `List<List<FixedSizeList<2, Float64>>>`             |
| multipoint      | `List<FixedSizeList<2, Float64>>`                   |
| multilinestring | `List<List<FixedSizeList<2, Float64>>>`             |
| multipolygon    | `List<List<List<FixedSizeList<2, Float64>>>>`       |

Field metadata written on the `geometry` field (`:689-700`):

```
ARROW:extension:name = geoarrow.<type>
ARROW:extension:metadata = JSON({
    crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } }
})
```

The CRS is always CRS84 because DuckDB has already projected to
`DEFAULT_TARGET_CRS = 'OGC:CRS84'` upstream via the `ST_Transform`
inside `buildDefaultSql`.

### 4.6 Attribute handling

`buildAttributeColumns(indices, attributes)` at `:592-654`.

For each attribute column (a `Map<string, { values, type }>`):

- Sample the first 100 non-null values via `typeof v === 'number'`
  (`:603-611`). If every sampled value is a number (or null), the
  column is treated as numeric: a `Float64Array(n)` is filled with
  `values[indices[i]] ?? NaN` and wrapped as Arrow `Float64`
  (`:613-618`).
- Otherwise the column is treated as `Utf8`. A single `TextEncoder` is
  reused, strings are encoded once each (`:619-650`), offsets are
  pre-allocated.

The `type` field on the attribute entry is **not** read by the
builder. The docs in
`packages/objex-utils/docs/geometry.md:162` claim type is used for
Arrow dtype inference (`bool → Bool`, etc.); the code does not do
this. See Corrections.

Consequences:

- `BigInt` and `Uint32Array`-backed `DECIMAL` values fail the
  `typeof === 'number'` test and get coerced to strings via
  `String(...)`. However the row collector in `wasm.ts` already
  rewrites `DECIMAL` cells to formatted decimal strings
  (`wasm.ts:550-575`) and reads typed-array views via
  `extractColumnBulk` (`:583-602`), so the attribute values that
  reach the builder are already plain JS numbers or strings.
- `BIGINT` columns survive Arrow as `BigInt` per cell when read via
  per-row `.toJSON()` in `query()` (`wasm.ts:682-691`). In that path
  the values reach `buildAttributeColumns` as `bigint`, fail the
  numeric sample, and get coerced to strings via `String(big)`
  in the Utf8 branch.
- Date / Timestamp / Bool columns are coerced to strings the same
  way unless the sampled rows happen to be numbers.

### 4.7 Sub-table assembly

`buildSingleTable` at `:657-725`. Constructs one Arrow
`RecordBatch` and wraps it in a single-batch `Table`. The schema is
`[geometry, ...attributes]`. The struct child layout (`:710-715`) is
identical: `Struct({ fields, length: n, children: [geomData,
...attrCols.data] })`.

### 4.8 Top-level entry point

`buildGeoArrowTables` at `:737-788`:

- If `wkbArrays.length === 0`, return `[]` (`:742`).
- If `knownGeomType` is provided, build one table with
  `indices = [0, 1, ..., n-1]` and return it as a 1-element array
  (`:745-750`). No per-row classification, no dropping, no group
  partitioning.
- Otherwise classify per row (`:755-766`). Rows that
  `classifyWkbType` rejects (header read fails or base type is not
  1 to 6, see Limitations for the exact set) are silently dropped.
  Each accepted row is appended to its type group along with its
  original index.
- For each non-empty group, build a table with the group's WKBs and
  indices (`:773-776`). All groups share a single `globalBounds`
  tracker, which is then stamped onto every result so callers can
  fit the map to a single union bbox (`:778-785`).

## 5. Supported / not supported matrix

| Input                                          | Supported | Behavior |
|-----------------------------------------------|-----------|---------|
| Point / LineString / Polygon                  | yes       | Direct read |
| MultiPoint / MultiLineString / MultiPolygon   | yes       | Direct read |
| ISO WKB Z (`1001..1006`)                      | yes       | Z stripped, only XY written, `coordStride = 24` |
| ISO WKB M (`2001..2006`)                      | yes       | M stripped, only XY written, `coordStride = 24` |
| ISO WKB ZM (`3001..3006`)                     | yes       | Both stripped, `coordStride = 32` |
| ISO range 4xxx and higher                     | partial   | The `if (type > 3000)` branch strips 3000 and leaves a positive type; if that residue lands on 1..6 the row is decoded with the wrong stride. See Corrections. |
| EWKB Z flag (`0x80000000`)                    | yes       | Z stripped, `coordStride = 24` |
| EWKB M flag (`0x40000000`)                    | yes       | M stripped, `coordStride = 24` |
| EWKB SRID (`0x20000000`)                      | yes       | SRID byte range skipped, header grows to 9 bytes, SRID itself is not read or kept |
| EWKB ZM combined                              | yes       | `coordStride = 32` |
| Big-endian (XDR) at every nesting level       | yes       | Each nested geometry's own header is read for endianness |
| Mixed endianness within one row               | yes       | Inner geometry headers are re-read per nested geometry |
| GeometryCollection (type 7)                   | no        | `classifyWkbType` returns null, row dropped. Also true when `knownGeomType` is provided. |
| Curved geometries (CircularString, etc.)      | no        | Same as above, dropped |
| TIN / Triangle / PolyhedralSurface (15 to 17) | no        | Same, dropped |
| EMPTY (e.g. POINT EMPTY)                      | partial   | Point EMPTY writes `(NaN, NaN)`; the typed array gets `NaN, NaN` since `getFloat64` is direct, and `expandBounds` ignores NaN. LineString / Polygon EMPTY have `numPts = 0` and produce zero-length offsets, which is valid Arrow. Polygon with `numRings = 0` produces an empty ring list. So EMPTY round-trips structurally but the coordinate values for Point EMPTY are NaN. |
| Zero-coord ring inside a Polygon              | yes       | The ring becomes a zero-length offset entry; nothing breaks |
| Null entries in `wkbArrays`                   | partial   | `readWkbHeader` returns null for `length < 5`. For longer null-like inputs (e.g. a `Uint8Array(5)` of zeros), `wkb[0]` is `0` (XDR), `getUint32(1, false) === 0`, classifier returns null, row dropped. For an actual `null` element passed into `wkbArrays`, the index access at `wkb.length` would throw, since the call site `extractMapData` filters out null via `toBinary` (`TableViewer.svelte:171-173`) before constructing the array, this is not exercised in practice. |
| Truncated / corrupt WKB after the header      | partial   | The loop reads past the buffer end if the inner `numPts` is wrong, `DataView.getFloat64` past EOB throws `RangeError`. The builders do not catch this; the call site in `GeoParquetMapViewer` has a try/catch around the whole `loadGeoData` that maps the error to a banner. There is no per-row recovery. |
| `knownGeomType` mismatched against actual WKB | partial   | Builders check `h.type !== expected` and write `(0, 0)` / zero-length offsets for the mismatched row but do not drop it, so `table.numRows === wkbArrays.length` (`sourceIndices` is identity). |
| GeoJSON input                                 | no        | Caller's responsibility, `buildDefaultSql` converts GeoJSON columns to WKB upstream via `ST_AsWKB(ST_GeomFromGeoJSON(...))`. |
| WKT input                                     | no        | Same as above, must be converted by the caller before this stage. |

## 6. Performance properties

Evidence from the source.

| Geometry        | Allocations per row (geometry hot path)                                              | Citation                              |
|-----------------|--------------------------------------------------------------------------------------|---------------------------------------|
| point           | 1 `DataView`, 1 header object                                                        | `geoarrow.ts:185-187`                 |
| linestring      | 1 `DataView`, 1 header object per pass (so 2 total over both passes)                 | `geoarrow.ts:208-234`                 |
| polygon         | 1 `DataView`, 1 header object per pass                                               | `geoarrow.ts:259-300`                 |
| multipoint      | 1 `DataView`, 1 header object per pass plus `N` inner `Uint8Array` views and `N` inner header objects per row, where `N = numPoints` | `geoarrow.ts:347-371` |
| multilinestring | 1 `DataView`, 1 header object per pass plus `L` inner `Uint8Array` views + headers per row, where `L = numLines` (pass 1 reads each inner header; pass 2 re-reads it) | `geoarrow.ts:395-451` |
| multipolygon    | 1 `DataView`, 1 header object per pass plus `P` inner views + headers per row in each of pass 1 and pass 2 (note `innerDv` is created twice per polygon) | `geoarrow.ts:487-555` |

Bulk allocations:

- Coordinates buffer is one `Float64Array(totalCoords * 2)` per type
  group (`geoarrow.ts:217, :277, :344, :421, :520`).
- Offsets are one `Int32Array(n + 1)` (`Int32Array(totalRings + 1)`,
  `Int32Array(totalPolys + 1)`, etc.) per nesting level. For
  `MultiLineString` and `MultiPolygon` the outermost
  `geomOffsetsArr` is a plain `number[]` first and converted to
  `Int32Array` once (`geoarrow.ts:419, :517`); for the simpler types
  the outer offsets are typed-array from the start.
- Arrow object creation: 1 `Field` + 1 `FixedSizeList` shared at
  module load (`:158-159`), then per call: 1 `makeData` per nesting
  level + 1 `Schema` + 1 `Struct` + 1 `RecordBatch` + 1 `Table`.

Bytes per row at full saturation:

- Point: 16 bytes coord output (no offsets).
- LineString of `n` vertices: `16n` bytes coords + 4 bytes offsets.
- Polygon: `16 * Σ vertices` bytes coords + `4 * rings` ring offsets +
  4 bytes geom offset.
- Same multiplicative for Multi* with the inner geometry counts.

Two-pass is required because Arrow `makeData` needs final pre-sized
buffers; growing a `Float64Array` would force `slice` calls and burn
the zero-copy property.

## 7. DuckDB-WASM workarounds in play

Each of these affects the WKB to GeoArrow pipeline but is not in the
builder itself.

### 7.1 `stoi: no conversion` prelude

`wasm.ts:254-264`. `SELECT * FROM duckdb_coordinate_systems()` runs
before the explicit `LOAD spatial` to warm PROJ. Without it any
GeoParquet with CRS metadata trips
[`duckdb-wasm#2199`](https://github.com/duckdb/duckdb-wasm/issues/2199).
Reordering this is a regression.

### 7.2 `ST_AsWKB(...)` wrap on geometry columns

[`duckdb-wasm#2187`](https://github.com/duckdb/duckdb-wasm/issues/2187)
makes DuckDB-WASM's Arrow exporter throw
`Unsupported type: GEOMETRY`. Every geometry projection therefore goes
through `ST_AsWKB(...)`. Call sites:

- `TableViewer.svelte:149` (`buildDefaultSql`).
- `wasm.ts:755` (`queryForMap`).
- `wasm.ts:1353` (`queryForMapCancellable`).

For the WGS84 BLOB pass-through path (`isWkbBlob && !sourceCrs`) the
column is projected directly with no `ST_AsWKB`, since the value is
already standard WKB bytes (`TableViewer.svelte:133-135`, mirrored at
`wasm.ts:732-735` and `wasm.ts:1340-1342`). This is the "skip
ST_GeomFromWKB / ST_AsWKB round-trip" rule from the project
`CLAUDE.md`.

### 7.3 Arrow v17 vs v21 mismatch

`wasm.ts:655-657` and `wasm.ts:1180-1186` reference
[`duckdb-wasm#2008`](https://github.com/duckdb/duckdb-wasm/issues/2008).
DuckDB-WASM bundles `apache-arrow@17`, the project consumes `21`.
Crossing the version boundary through `tableToIPC` / `tableFromIPC`
loses rows on DECIMAL, GEOMETRY, and other mismatched types, which is
why every row is converted with `result.toArray().map(row => row.toJSON())`
or per-batch `batch.toArray()` instead. This is also why a manual
WKB to GeoArrow pipeline must stay even when DuckDB starts emitting
native GeoArrow columns: until the bundled Arrow versions match, the
project cannot read cross-version Arrow tables safely.

### 7.4 `geometry_always_xy = true`

`wasm.ts:271`. Sets the database-global axis-order flag so DuckDB v1.5
emits coordinates in lon/lat (X/Y) order, matching GeoParquet 1.1 and
GeoJSON. Without it `ST_Transform` warns on every call and the
coordinates that reach the WKB builder may be swapped depending on
which CRS the source declared.

### 7.5 GEOMETRY type detection

`wasm.ts:379-389` (`isSpatialColumnType`) and `:401-409`
(`extractCrsFromTypeString`). DuckDB v1.5's `GEOMETRY('EPSG:...')`
parameterised type is the canonical CRS source for any column
projection. `TableViewer.svelte:489-515` refreshes `geoColType` after
DuckDB boots so the SQL builder always sees the v1.5 form even when
hyparquet originally reported the legacy `BLOB` form.

### 7.6 Legacy GeoParquet fallback

`TableViewer.svelte:474-484`. When hyparquet reports `legacyGeoParquet`
(geopandas <0.12 with `schema_version` but no `version`), the
viewer issues `SET enable_geoparquet_conversion = false` per
connection and falls back to the BLOB pass-through path. The known CRS
is re-attached via `ST_SetCRS(ST_GeomFromWKB(...))` in
`buildTransformExpr` upstream.

## 8. Consumer wiring

The single consumer of `buildGeoArrowTables` in the repo is
`GeoParquetMapViewer.svelte`. It mounts deck.gl via
`MapboxOverlay` (`utils/deck.ts:67-74, :161-169`) and dispatches to one of
three `@geoarrow/deck.gl-layers` classes via
`createLayerForResult` at `utils/deck.ts:86-151`:

- `point` / `multipoint` → `GeoArrowScatterplotLayer`.
- `linestring` / `multilinestring` → `GeoArrowPathLayer`.
- `polygon` / `multipolygon` → `GeoArrowPolygonLayer`.

The deck.gl module set is lazy-imported in `loadGeoArrowModules`
(`utils/deck.ts:67-74`), so a tab that never opens a GeoParquet map
never pays the bundle cost.

`FlatGeobufViewer` uses the GeoJSON overlay path
(`utils/deck.ts:53-62`), not the GeoArrow path.
`StacMosaicViewer`, `CogViewer`, and `MultiCogViewer` render rasters
through `MosaicLayer` / `COGLayer` / `MultiCOGLayer` from
`@developmentseed/deck.gl-geotiff` and do not call `buildGeoArrowTables`
at all.

`parseWKB` (the allocation-heavier GeoJSON-producing parser in
`packages/objex-utils/src/wkb.ts`) is used only off the hot path:

- `TableViewer.svelte:177` sniffs the geometry type of the first WKB
  row once.
- `GeoParquetMapViewer.svelte:157, :189` builds a single selected
  Feature for the yellow QGIS-style outline on click.
- `stac-geoparquet.ts` and `stac-source-parquet.ts` use it to decode
  STAC item geometries one at a time when materialising
  `StacGeoparquetRow` to STAC Items (`query/stac-source-parquet.ts:415`).

None of these run per frame.

## 9. Known limitations and gotchas

- The ISO type range check at `geoarrow.ts:94-104` uses
  `if (type > 3000) { type -= 3000; ... } else if (type > 2000) { ... }
  else if (type > 1000) { ... }`. Strictly, ISO WKB only assigns
  `1001..1006`, `2001..2006`, and `3001..3006`. The naive `> 3000`
  branch will subtract 3000 from a hypothetical type `4001` and yield
  base type 1001, which then will not classify as 1..6 anyway, but
  the intent is range-bound (`1001 <= type <= 1006` for Z, etc.). For
  every value the SFA-1.2 spec produces, the implementation is
  correct. For non-standard producers, see Corrections.
- `point` builder writes `(0, 0)` for a bad header (`:181-184`).
  These rows still count in `n`, so `sourceIndices` is identity and
  `table.numRows` matches `wkbArrays.length`. Downstream tooltips on
  these rows will report whatever attributes the original row had and
  draw at the equator.
- `knownGeomType` short-circuits all classification; mismatched rows
  silently contribute zero or `(0, 0)` to the output (see `:180, :209,
  :262, :337, :397, :489`).
- `buildAttributeColumns` samples only 100 values and only checks
  `typeof === 'number'`. If a numeric column starts with 100 nulls
  followed by numbers, the column is mistyped as `Utf8` and every
  later number is `String(...)`-coerced.
- `BigInt` attributes get stringified, see 4.6. DuckDB BIGINT columns
  arriving through `queryCancellable` come in as `bigint`, then are
  written as strings in the Arrow `Utf8` branch.
- The pipeline does not yet preserve EWKB SRID. The SRID byte range is
  skipped (`geoarrow.ts:82`). All output is stamped with the CRS84
  extension metadata because DuckDB has already projected upstream.
- MultiPoint, MultiLineString, MultiPolygon allocate one transient
  `Uint8Array` view + one transient header object per inner geometry,
  per pass. For a MultiPolygon with 1000 inner polygons that is
  2000+ transient objects per row.
- Two passes scan the WKB twice. There is no SIMD or wasm
  decompression in the builder, just `DataView`.
- Arrow `Int32Array` offsets cap addressable child elements per
  `List` at `2^31 - 1`. A single GeoArrow result with more than
  ~2.1 billion coordinates would overflow `coords.length` to a
  negative `Int32`. We have never seen this in practice but the
  builders do not assert.
- `setProps({ layers })` re-runs the GPU upload for each new
  `GeoArrowResult` because the Arrow `Table` identity changes each
  call. There is no `Table` reuse / append-on-scroll yet, see
  `docs/arrow-table-grid-research.md` for the parallel research on the
  TableGrid side.
- The pipeline assumes XY axis order in the input WKB. DuckDB is
  responsible for that invariant via `geometry_always_xy = true`. If a
  caller hands `buildGeoArrowTables` lat/lon WKB directly (bypassing
  DuckDB), the map will draw on the wrong continent.

## 10. Open questions and revisit-soon items

- The per-inner-point view allocation in MultiPoint / MultiLineString /
  MultiPolygon could be avoided by reading the inner endianness byte
  and inner type word with two `DataView.getUint8` / `getUint32`
  calls relative to `wkb.buffer`, instead of constructing a
  `Uint8Array` view and re-calling `readWkbHeader`. Worth a
  micro-benchmark on a Multi* heavy STAC catalog before changing.
- The two-pass over MultiLineString / MultiPolygon re-creates an
  inner `DataView`/`Uint8Array` view per inner geometry on each pass.
  Pass 1 could record the precomputed inner header offsets in a
  small auxiliary `Int32Array` for pass 2 to consume, avoiding the
  re-decode.
- Attribute type inference should consult the supplied DuckDB / Arrow
  `type` string instead of sniffing 100 values. `Bool` and date /
  timestamp columns should land as their native Arrow types so
  deck.gl tooltips show the right thing without per-cell coercion. The
  docs at `packages/objex-utils/docs/geometry.md:162` already promise
  this behaviour.
- A native DuckDB to GeoArrow path will only become possible once
  DuckDB-WASM either upgrades Arrow to v21+ or stops exporting
  `GEOMETRY` columns as `Binary` with a custom Arrow extension that the
  bundled Arrow cannot construct. Both are upstream blockers, see
  `docs/duckdb-wasm-upgrade-analysis.md`.
- 32-bit offset overflow could in principle be turned into a hard
  assertion at `geoarrow.ts:301`, `:453`, `:556` so a future regression
  on huge catalogs is loud instead of silent.
- The `(0, 0)` fallback for Point on bad header could be replaced with
  a dropped row + a non-identity `sourceIndices` for consistency with
  the rest of the pipeline. Trade-off, today the row count matches
  the user's `wkbArrays` exactly which keeps the attribute table in
  TableViewer aligned.

## Corrections to draft reply

The following claims in the original draft Slack reply need
revising:

1.  **"Point is single-pass per claim"**: confirmed, `buildPointData`
    is single-pass (`geoarrow.ts:177-191`). No correction needed.
2.  **"5-byte WKB header peek via `readWkbHeader` (around `:73`) and
    `classifyWkbType` (around `:113`)"**: lines confirmed.
    `readWkbHeader` is at `:73`, `classifyWkbType` at `:113`. No
    allocations beyond 1 `DataView` and 1 returned header object,
    as stated.
3.  **Per-type line numbers**: confirmed.
    - LineString `:200` (declared at `:200`, body to `:245`).
    - Polygon `:252` to `:323`.
    - MultiPoint `:326` to `:382`.
    - MultiLineString `:388` to `:473`.
    - MultiPolygon `:479` to `:587`.
4.  **"MultiPoint per-inner-point WKB header allocation, Uint8Array
    view per inner point (`:356`)"**: confirmed at `:355-357`. The
    same pattern repeats in MultiLineString
    (`:404-409, :433-440`) and MultiPolygon
    (`:497-502, :533-538`). The draft only called out MultiPoint;
    the reply should disclose all three Multi* types do this.
5.  **"Attribute classification: numeric Float64 or string Utf8,
    sample first 100 non-null values"**: confirmed
    (`:603-611`). What is NOT in the code, despite the project's own
    documentation claiming it: bool / date / timestamp / decimal /
    bigint dtype-aware paths. All non-numeric types reach the `Utf8`
    branch. BigInt is `String(bigint)`-coerced. The draft should
    walk this back.
6.  **"`sourceIndices` maps back to original index. Merged bounds per
    group"**: half-correct. With `knownGeomType` it is identity, no
    rows are dropped or partitioned. Without `knownGeomType`, the
    indices map per-group and the bounds are merged across all
    groups (one shared bounds object, stamped onto every result at
    `:778-785`). So "merged bounds per group" should read "shared
    merged bounds across all groups".
7.  **"GeometryCollection dropped (`classifyWkbType` returns null)"**:
    confirmed. Also true for curves and TIN.
8.  **"ISO WKB Z/M/ZM (1001 to 3006) parsed"**: confirmed but the
    boundary check is `>` not range-bound. For a strictly valid ISO
    file there is no observable difference. For corrupted input the
    behaviour can be surprising.
9.  **"`parseWKB` is used only for tooltip / inspect / `zoomToFeature`,
    never on the GeoArrow hot path"**: confirmed in the GeoParquet
    map path. Two non-hot-path callers exist (`stac-geoparquet.ts`,
    `query/stac-source-parquet.ts`) that we did not mention in the
    draft. The reply should acknowledge `parseWKB` is also used per
    STAC item when ingesting stac-geoparquet, since the STAC item
    geometry is decoded once into a GeoJSON Geometry stored on the
    materialised STAC `Item`.
10. **"BLOB column renamed to `__wkb`, WGS84 pass-through"**:
    confirmed (`TableViewer.svelte:133-135`). The pass-through
    requires both `isWkbBlob` AND `!sourceCrs`. The reply should
    state the condition exactly, not "BLOB pass-through always".
11. **"Apache Arrow v17 vs v21 mismatch (`duckdb-wasm#2008`)"**:
    confirmed at `wasm.ts:655-657, :1180-1186`. Issue link is in
    code comments. The reply can cite the comment block directly.
12. **"`geometry_always_xy = true` set globally at DB init"**:
    confirmed at `wasm.ts:271`. Worth mentioning: the project also
    sets `force_download_threshold = 2000000` and a `SET GLOBAL`
    rather than per-connection.
13. The draft claims a single npm version `1.3.1`. The repo's
    `packages/objex-utils/package.json:3` confirms version `1.3.1`.

There are also things the draft did NOT mention that should land in
the reply:

- The streaming variant `queryForMapCancellable` exists at
  `wasm.ts:1307-1448`; the active path used by GeoParquetMapViewer
  actually consumes the buffered row stream from
  `queryCancellable` indirectly via `TableViewer.extractMapData`.
- The fallback `(0, 0)` write on a bad-header Point row means
  `table.numRows` can include garbage Points without dropping rows.
- The 100-row attribute sampling is the only thing standing between a
  numeric column and a Utf8-coerced string column.

End of reference. Last verified against
`packages/objex-utils@1.3.1` on the `main` branch.
