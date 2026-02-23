# DuckDB v1.5 (Variegata) — GEOMETRY & CRS Upgrade Guide

> **Purpose**: Reference for upgrading objex when DuckDB v1.5 + spatial v1.5 ship.
> **Last updated**: 2026-02-23

---

## 1. What's Changing

DuckDB v1.5 moves `GEOMETRY` from the spatial extension into **core DuckDB**. The type becomes parameterized with CRS, gains columnar compression ("shredding"), native statistics, and filter pushdown.

### PR Tracker (all merged into `v1.5-variegata`)

| Part | DuckDB Core PR | What |
|------|---------------|------|
| 1 | [#19136](https://github.com/duckdb/duckdb/pull/19136) | `GEOMETRY` logical type in core |
| 2 | [#19203](https://github.com/duckdb/duckdb/pull/19203) | Geometry statistics (extent + sub-type tracking) |
| 3 | [#19439](https://github.com/duckdb/duckdb/pull/19439) | Filter pushdown via `&&` bbox intersection |
| 4 | [#19476](https://github.com/duckdb/duckdb/pull/19476) | Parquet + Arrow support for GEOMETRY |
| 4b | [#19848](https://github.com/duckdb/duckdb/pull/19848) | WKB conversion adjustments |
| 5 | [#20143](https://github.com/duckdb/duckdb/pull/20143) | **Type-level CRS tracking** (`GEOMETRY('EPSG:4326')`) |
| 6 | [#20281](https://github.com/duckdb/duckdb/pull/20281) | **Geometry shredding** (columnar compression) |
| 7 | [#20721](https://github.com/duckdb/duckdb/pull/20721) | Extended CRS support, axis order settings |

| Part | Spatial Extension PR | What |
|------|---------------------|------|
| — | [#713](https://github.com/duckdb/duckdb-spatial/pull/713) | Core GEOMETRY type + GDAL rework |
| — | [#757](https://github.com/duckdb/duckdb-spatial/pull/757) | CRS propagation through all ST_* functions + `geometry_always_xy` setting |

---

## 2. Parameterized GEOMETRY Type with CRS

### New syntax

```sql
-- Column with CRS
CREATE TABLE t1(g GEOMETRY('EPSG:4326'));

-- Query CRS
SELECT ST_CRS(g) FROM t1;  -- → 'EPSG:4326'

-- Override CRS (reinterpret, no transform)
SELECT ST_SetCRS(g, 'EPSG:3857') FROM t1;
```

### CRS mismatch protection (bind-time error)

```sql
-- ERROR: Cannot cast GEOMETRY with CRS 'EPSG:3857' to GEOMETRY with CRS 'EPSG:4326'
INSERT INTO t1 VALUES (ST_SetCRS('POINT (0 1)', 'EPSG:3857'));
```

Implicit cast between `GEOMETRY` (no CRS) and `GEOMETRY('EPSG:4326')` is allowed in both directions — CRS is "just metadata."

### CRS string formats accepted

- `AUTH:CODE` — e.g., `'EPSG:4326'`, `'OGC:CRS84'`
- Full PROJJSON
- Full WKT2

Two CRS values are equal if their `id` matches, then `name`, then full string comparison.

---

## 3. ST_Transform Changes

### New 2-argument overload (source CRS inferred from type)

```sql
-- NEW: source CRS read from geometry type parameter
ST_Transform(geom, 'EPSG:4326')
ST_Transform(geom, 'EPSG:4326', always_xy := true)

-- Requires that geom has a typed CRS, otherwise BinderException
```

### Existing overloads (unchanged)

```sql
ST_Transform(geom, source_crs, target_crs)
ST_Transform(geom, source_crs, target_crs, always_xy)
```

---

## 4. Axis Order: `geometry_always_xy` Global Setting

The #1 confusion point with DuckDB spatial — EPSG:4326 defines lat/lon but data is almost always lon/lat.

### New setting

```sql
SET geometry_always_xy = true;   -- Force lon/lat (x/y) for all functions
SET geometry_always_xy = false;  -- Use CRS authority axis order (current default)
```

### Warning on unset

When `geometry_always_xy` is not explicitly set, functions like `ST_Transform`, `ST_Distance_Spheroid`, etc. emit a warning:

> `'ST_Transform' assumes the axis order of the input geometry to be the same as defined by the source CRS. In the future this will change to always assume [EASTING, NORTHING] regardless of CRS definition.`

### Future default

The default **will change** to `always_xy = true` in a future version.

### CRS propagation through functions

All geometry-returning functions in spatial now propagate CRS. Mixing geometries with different CRS in functions like `ST_Intersection` produces a bind-time error.

---

## 5. Geometry Shredding (Columnar Compression)

When an entire row group contains the same geometry sub-type (e.g., all `POINT XY`), the storage engine "shreds" the column:

- `POINT (XY)` → `STRUCT(x DOUBLE, y DOUBLE)` internally
- Coordinates get ALP-compressed
- Ring/part offsets get RLE/delta/dictionary encoded
- **~2x compression ratio** vs blob storage

Caveats:
- `GEOMETRYCOLLECTION` is never shredded
- Mixed sub-types within a row group → no shredding (no overhead either)
- EMPTY geometries prevent shredding

---

## 6. GeoArrow by Default

`GEOMETRY` now defaults to GeoArrow when converting to/from Arrow. No need to call `register_geoarrow_extensions()`.

---

## 7. Native Parquet GEOMETRY/GEOGRAPHY (Format 2.11+)

Apache Parquet Format 2.11 (March 2025) added first-class `GEOMETRY` and `GEOGRAPHY` logical types:

```thrift
struct GeometryType {
  1: optional string crs;  // Default: "OGC:CRS84"
}

struct GeographyType {
  1: optional string crs;       // Default: "OGC:CRS84"
  2: optional EdgeInterpolationAlgorithm algorithm;  // Default: SPHERICAL
}
```

### Key differences

| Aspect | GEOMETRY | GEOGRAPHY |
|--------|----------|-----------|
| Edge interpolation | Linear/planar | Spherical (configurable) |
| CRS default | OGC:CRS84 | OGC:CRS84 |
| Use case | Projected coords, local analysis | Global lon/lat, geodesic |
| Edge algorithms | N/A | SPHERICAL, VINCENTY, THOMAS, ANDOYER, KARNEY |

### Native geospatial statistics (per row group)

```thrift
struct GeospatialStatistics {
  1: optional BoundingBox bbox;          // xmin, xmax, ymin, ymax, zmin, zmax, mmin, mmax
  2: optional list<i32> geospatial_types; // WKB type codes present
}
```

- Bbox per-row-group in `ColumnMetaData` (not a separate convention)
- Enables spatial predicate pushdown in any Parquet reader
- `geospatial_types` tells readers which geometry types are present
- Antimeridian wraparound: `xmin > xmax` means crossing the antimeridian

### Relationship to GeoParquet

| Aspect | GeoParquet 1.1 | Native Parquet 2.11 | GeoParquet 2.0 (planned) |
|--------|---------------|---------------------|--------------------------|
| Type system | Convention (metadata key) | First-class logical type | Unified with native |
| Bbox stats | Separate bbox columns | Built into ColumnMetaData | Uses native stats |
| CRS | PROJJSON in metadata | String in type annotation | Aligned |
| Encoding | WKB in BYTE_ARRAY | WKB in BYTE_ARRAY | May add GeoArrow |
| Reader support | Needs GeoParquet-aware reader | Any Parquet reader sees type | Unified |

DuckDB v1.5 already writes files that are **both valid GeoParquet and valid native geometry Parquet**.

### Engine support status

| Engine | Status |
|--------|--------|
| DuckDB v1.5 | Read + Write + Stats + Pushdown (merged) |
| Apache Arrow (Rust) | Geospatial stats + extension type (merged) |
| parquet-java | Type annotations + statistics (merged) |
| Apache Iceberg | Geo type spec (merged), XZ2 spatial partitioning |
| parquet-wasm, hyparquet | Not yet |

---

## 8. What to Change in objex When Upgrading

### CRS detection (`wasm.ts: detectCrs`)

**Current**: Parse `parquet_kv_metadata` for GeoParquet "geo" key, then parse `parquet_schema()` for `logical_type` string.

**After v1.5**: Can simplify to:
```sql
SELECT ST_CRS(geom_col) FROM table LIMIT 1;
```
Or just check the column type — it will be `GEOMETRY('EPSG:XXXX')` directly.

Keep the old path as fallback for pre-v1.5 files.

### ST_Transform (`wasm.ts: queryForMap`, `TableViewer.svelte: buildDefaultSql`)

**Current**:
```sql
ST_Transform(geom, 'EPSG:XXXX', 'EPSG:4326', always_xy := true)
```

**After v1.5**: If the geometry column has a typed CRS, can use the 2-arg form:
```sql
ST_Transform(geom, 'EPSG:4326')
```

Or set globally:
```sql
SET geometry_always_xy = true;
```

### Geometry column type detection

**Current**: Check for `GEOMETRY`, `WKB_BLOB`, `BLOB`, `BINARY`, etc.

**After v1.5**: The type string will be `GEOMETRY(epsg:4326)` — update type checks to handle the parameterized form (e.g., `upper.startsWith('GEOMETRY')`).

### GeoArrow conversion

**After v1.5**: DuckDB outputs GeoArrow by default when converting to Arrow. Could potentially skip our manual `buildGeoArrowTables` pipeline and consume the Arrow table directly from DuckDB-WASM. Needs testing — the DuckDB-WASM Arrow output may already match what `@geoarrow/deck.gl-layers` expects.

### Spatial filter pushdown

**After v1.5**: Native `&&` operator with bbox stats enables spatial filtering at the Parquet row-group level. For large files, add viewport-based spatial filtering:
```sql
SELECT * FROM table WHERE geom && ST_MakeEnvelope(xmin, ymin, xmax, ymax)
```

---

## 9. Current objex Workarounds (pre-v1.5)

These workarounds are in place until we upgrade to DuckDB v1.5:

### `always_xy := true` on ST_Transform

We manually pass `always_xy := true` to every `ST_Transform` call because the current DuckDB spatial respects the CRS authority axis order by default, which swaps lon/lat for most EPSG codes:

```typescript
// wasm.ts:278 and TableViewer.svelte:100
geomExpr = `ST_Transform(${geomExpr}, '${sourceCrs}', 'EPSG:4326', always_xy := true)`;
```

### Manual CRS detection from Parquet metadata

We detect CRS by parsing `parquet_kv_metadata` (GeoParquet "geo" key) and `parquet_schema()` (native Parquet 2.11 `logical_type` string), since the current DuckDB doesn't expose CRS on the column type.

### Manual WKB → GeoArrow conversion

We parse WKB binaries and build GeoArrow Arrow tables manually in `geoarrow.ts` because current DuckDB-WASM doesn't output GeoArrow natively.

---

## 10. References

- [DuckDB Spatial v1.5 branch](https://github.com/duckdb/duckdb-spatial/tree/v1.5-variegata)
- [DuckDB v1.5 branch](https://github.com/duckdb/duckdb/tree/v1.5-variegata)
- [Parquet Format 2.11 Geospatial spec](https://github.com/apache/parquet-format/blob/master/Geospatial.md)
- [Parquet LogicalTypes — Geometry](https://github.com/apache/parquet-format/blob/master/LogicalTypes.md#geometry)
- [GeoParquet spec](https://geoparquet.org/releases/v1.1.0/)
- [duckdb-spatial issue #441 — Parameterize types with CRS](https://github.com/duckdb/duckdb-spatial/issues/441)
- [duckdb-spatial issue #474 — Axis mapping management](https://github.com/duckdb/duckdb-spatial/issues/474)
- [duckdb-spatial issue #16 — Axis order explanation](https://github.com/duckdb/duckdb-spatial/issues/16)
