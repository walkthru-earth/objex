# Performance Optimization — DuckDB/Arrow/WKB Pipeline

## Implemented Changes

### Phase 1: Zero-Copy WKB → GeoArrow (geoarrow.ts rewrite)

**Before**: WKB bytes → `parseWKB()` JS objects → `number[]` accumulator → `Float64Array`
- 3 allocations per geometry
- Double parse: once to classify type, once to extract coordinates
- Recursive DataView reads through parseWKB

**After**: WKB bytes → direct `DataView.getFloat64()` → pre-allocated `Float64Array`
- 1 allocation per geometry (exact-size Float64Array)
- Type classification reads only 5 bytes (not full geometry)
- Two-pass for lines/polygons: count first → pre-allocate → extract
- No intermediate JS objects (`ParsedGeometry`, `number[][]`)
- EWKB/ISO Z/M/SRID flags handled in shared `readWkbHeader()`

**`knownGeomType` fast path**: When GeoParquet metadata provides `geometry_types`,
the classification pass is skipped entirely — all WKBs go directly to the builder.

### Phase 2: Instant Parquet Metadata (hyparquet)

**Before**: DuckDB-WASM boots (3-5s) → `getSchemaAndCrs()` → `getRowCount()`
- 3 DuckDB SQL queries just for metadata
- UI blocked until DuckDB boots

**After**: `readParquetMetadata()` via hyparquet (~150ms, single range request)
- Row count from footer metadata (no SQL needed)
- Schema from Parquet column descriptors
- CRS from GeoParquet "geo" key-value metadata
- Geometry types from metadata (no per-row `ST_GeometryType()`)
- Bounds from metadata bbox (no client-side computation)

**DuckDB boot runs in parallel** — by the time hyparquet returns metadata,
DuckDB may still be loading. The data query starts as soon as DuckDB is ready.

**Fallback**: If hyparquet fails (CORS, auth, non-Parquet), falls back to DuckDB metadata queries.

### Phase 3: Skipped Redundant Queries

| Query | When Skipped | Saved |
|-------|-------------|-------|
| `getSchemaAndCrs()` | hyparquet metadata available | ~500ms (2 range requests) |
| `getRowCount()` | hyparquet row count from footer | ~200ms (1 range request) |
| `ST_GeometryType()` per row | metadata `geometry_types` has single type | Computation per row |
| Bounds computation | metadata `bbox` available | O(n) coordinate scan |
| WKB classification pass | `knownGeomType` provided | O(n) full WKB parse |

## Architecture

```
File Open → [PARALLEL]
  ├── hyparquet: readParquetMetadata(url)  ← ~150ms, 1 range request
  │   └── Returns: schema, rowCount, CRS, geometryTypes, bbox
  └── DuckDB: getQueryEngine()            ← ~3-5s, WASM + extensions

hyparquet returns first:
  → UI shows: columns, row count, CRS, geometry info
  → knownGeomType set (skips classification)
  → metadataBounds set (skips computation)
  → totalRows set (skips getRowCount query)

DuckDB ready:
  → Execute data query (LIMIT pageSize OFFSET 0)
  → WKB extraction from results
  → buildGeoArrowTables(wkbs, attrs, knownGeomType)  ← zero-copy
  → deck.gl rendering
```

## Dependencies Added

- `hyparquet` (~10KB minzipped) — Pure JS Parquet footer reader
- `hyparquet-compressors` — Codecs for gzip/brotli/zstd/lz4

## Future Improvements

- **TanStack Table**: Replace custom TableGrid with @tanstack/svelte-table + @tanstack/svelte-virtual
- **Spatial viewport filtering**: Add `WHERE geom && ST_MakeEnvelope(bounds)` when map pans
- **Streaming table rows**: Use hyparquet `onChunk()` for progressive first-page display
- **Column projection**: Only fetch columns visible in the table viewport
- **arrow-js-ffi**: Zero-copy Arrow data transfer from DuckDB-WASM (eliminates Arrow version mismatch)
