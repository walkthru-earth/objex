# DuckDB-WASM Upgrade Analysis (2026-03-29)

## TL;DR

Cannot upgrade `@duckdb/duckdb-wasm` past `1.33.1-dev20.0`. The stoi crash (#2199) is the hard blocker. **Tested dev41.0 on 2026-03-29: crash persists.** PR #2200 did NOT fix it. A fix to `duckdb/duckdb` core (`arrow_duck_schema.cpp` lines 191/230) is required.

## Versions

| Package | Installed | Latest | Notes |
|---------|-----------|--------|-------|
| `@duckdb/duckdb-wasm` | `1.33.1-dev20.0` | `1.33.1-dev41.0` (next) | Pinned, dev20 is also npm `latest` tag |
| `apache-arrow` | `^21.1.0` | 21.x | DuckDB-WASM bundles v17 internally |
| `@geoarrow/deck.gl-layers` | `^0.3.1` | `0.3.1` stable, `0.4.0-beta.6` | No upgrade needed |

## Root cause deep dive: stoi crash

### The vulnerable C++ code

**File**: `duckdb/duckdb` repo, `src/function/table/arrow/arrow_duck_schema.cpp`

**duckdb-wasm submodule pin**: `7dbb2e646fea939a89f10a55aa98c474cbb0c098` (DuckDB v1.5.1)

Two instances of the same pattern:

**Line 190-194** (fixed-size binary `w:NN`):
```cpp
} else if (format[0] == 'w') {
    string parameters = format.substr(format.find(':') + 1);
    auto fixed_size = NumericCast<idx_t>(std::stoi(parameters));
    auto type_info = make_uniq<ArrowStringInfo>(fixed_size);
    return make_uniq<ArrowType>(LogicalType::BLOB, std::move(type_info));
```

**Line 229-231** (fixed-size list `+w:NN`):
```cpp
} else if (format[0] == '+' && format[1] == 'w') {
    std::string parameters = format.substr(format.find(':') + 1);
    auto fixed_size = NumericCast<idx_t>(std::stoi(parameters));
```

**The bug**: `format.find(':')` scans the ENTIRE string for the first colon. The Arrow C Data Interface spec defines `w:NN` with the colon always at position 1. But if the format string somehow contains CRS metadata with `:` characters (e.g. from `GEOMETRY('EPSG:4326')`), find grabs the wrong colon and `std::stoi()` receives non-numeric text.

### The fix (two lines)

```cpp
// Line 191: was format.substr(format.find(':') + 1)
string parameters = format.substr(2);  // Arrow spec: w:NN, colon always at pos 1

// Line 230: was format.substr(format.find(':') + 1)
std::string parameters = format.substr(3);  // Arrow spec: +w:NN, colon always at pos 2
```

### Where to submit the fix

**Primary**: `duckdb/duckdb` (core repo). The file is in the core, not duckdb-wasm.
**Propagation**: duckdb-wasm uses duckdb as a git submodule at `submodules/duckdb`. After the fix merges in duckdb core, duckdb-wasm bumps the submodule pin, then publishes a new npm build.

### PR #2200 may already fix this as a side effect

The `geoarrow.wkb` extension is registered at DB init in `arrow_type_extension.cpp` (line 566):
```cpp
config.RegisterArrowExtension(
    {"geoarrow.wkb", ArrowGeometry::PopulateSchema, ArrowGeometry::GetType, ...});
```

When the extension is found, `ArrowGeometry::PopulateSchema` sets `schema.format = "z"` (variable binary). CRS goes in `ARROW:extension:metadata` as JSON, never in the format string. The `GetTypeFromFormat` parser with the vulnerable `w:` path should never be reached for GEOMETRY columns.

PR #2200 fixed the DATA conversion path (extension_type_cast in webdb.cc). The SCHEMA conversion path already used the registered extension. BUT there may be code paths where the format string is constructed without going through the extension system.

**Test dev41.0 before making a core PR.** If the stoi crash is gone, PR #2200 was sufficient and only the defensive fix to `arrow_duck_schema.cpp` is needed (non-urgent hardening).

### How to test

```bash
# In the project:
pnpm add @duckdb/duckdb-wasm@1.33.1-dev41.0
# Then load a GeoParquet file with CRS metadata that triggered the stoi crash
# If it works: PR #2200 fixed it. Submit defensive fix to duckdb core as hardening.
# If it crashes: The stoi bug needs a direct fix. Fork duckdb/duckdb, fix lines 191/230, test.
```

### Full code flow for GeoParquet in WASM

```
read_parquet('file.parquet')
  └─ DuckDB Parquet reader scans file
     └─ Detects GeoParquet metadata → creates GEOMETRY('EPSG:4326') type
        └─ Results ready for WASM IPC transfer

webdb.cc: MaterializeQueryResult()
  ├─ ArrowConverter::ToArrowSchema(types, names, options)
  │   └─ SetArrowFormat() for each column
  │       ├─ type.HasAlias() → true for GEOMETRY
  │       ├─ SetArrowExtension() → finds geoarrow.wkb (registered at DB init)
  │       │   └─ ArrowGeometry::PopulateSchema → format = "z", metadata = CRS JSON
  │       └─ RETURNS (never reaches the switch/default path)
  │
  ├─ arrow::ImportSchema() → Apache Arrow C++ reads the C Data Interface
  │
  └─ ArrowConverter::ToArrowArray(chunk, &array, options, extension_type_cast)
      ├─ Before PR #2200: extension_type_cast = empty → GEOMETRY not handled → crash/error
      └─ After PR #2200: extension_type_cast populated → ArrowGeometry::DuckToArrow runs
```

## Three blocking issues

### 1. `stoi: no conversion` crash

- **Upstream**: duckdb/duckdb-wasm#2199, walkthru-earth/objex#5
- **Root cause**: `arrow_duck_schema.cpp` lines 191/230
- **Status**: Root cause identified (Maxxen, 2026-03-29). No fix PR yet. May be fixed by PR #2200 in dev41.0.

### 2. GEOMETRY Arrow export — FIXED

- **Upstream**: duckdb/duckdb-wasm#2187, PR #2200
- **Fix**: merged 2026-03-26, in dev41.0
- **Status**: Fixed but not consumable due to Arrow version mismatch

### 3. Arrow v17 vs v21 mismatch

- **Upstream**: duckdb/duckdb-wasm#2008
- **Long-term blocker**: DuckDB-WASM bundles arrow@17, project uses @21
- `tableToIPC`/`tableFromIPC` loses data across versions
- Forces `.toJSON()` extraction and manual WKB→GeoArrow pipeline

## Workaround chain

| Workaround | File(s) | Upstream issue | Removable when |
|---|---|---|---|
| Pin to dev20.0 | `package.json` | #2199 stoi crash | Fix confirmed in npm build |
| `ST_AsWKB()` wrappers | `wasm.ts:444`, `TableViewer:133` | #2187 + #2008 | Arrow export + versions align |
| `.toJSON()` extraction | `wasm.ts:354-381` | #2008 | DuckDB-WASM arrow@21+ |
| Manual WKB→GeoArrow | `geoarrow.ts` (789 lines) | All three | All three resolved |
| Conversion retry | `TableViewer:583-597` | #2199 | Fix confirmed |
| Legacy GeoParquet | `TableViewer:440-447` | N/A | Keep indefinitely |

## @geoarrow/deck.gl-layers analysis

- v0.3.1 = latest stable (what we use). v0.4.0-beta.6 = beta.
- Library requires native GeoArrow-encoded Arrow Tables, not WKB.
- All examples use pre-built `.feather` files, zero DuckDB usage.
- Our manual WKB→GeoArrow pipeline is the correct approach.
- `@geoarrow/geoparquet-wasm` could bypass DuckDB for geometry, but major architecture change.

## Test result (2026-03-29)

Upgraded to `1.33.1-dev41.0` and tested with `suitability_analysis_of_aq.parquet`:
- `DESCRIBE SELECT * FROM read_parquet(...)` → **stoi: no conversion** (crash)
- `SELECT * ... ST_AsWKB("geom") ... FROM read_parquet(...)` → **stoi: no conversion** (crash)
- After `SET enable_geoparquet_conversion = false`, retry → **stoi: no conversion** (crash)
- All queries crash at `read_parquet()` level. PR #2200 did NOT fix this.
- **Reverted to dev20.0.**

## Action plan

1. **Fork `duckdb/duckdb`**, fix `arrow_duck_schema.cpp` lines 191 and 230 (replace `format.find(':')` with fixed offset)
2. **Submit PR** to duckdb/duckdb with the fix
3. **Wait for** duckdb-wasm to bump the submodule and publish a new npm build
4. **Then upgrade** duckdb-wasm (no objex code changes needed, verified by code review)
5. **Keep ST_AsWKB() wrappers** regardless (Arrow v17/v21 mismatch remains)
6. **Stay on @geoarrow/deck.gl-layers@0.3.1** (v0.4 is beta)

## Testing checklist for upgrade

```bash
# After bumping @duckdb/duckdb-wasm:
# 1. GeoParquet file that triggered stoi crash (CRS metadata with EPSG code)
# 2. Legacy GeoParquet (geopandas <0.12, no "version" field)
# 3. GeoParquet with non-WGS84 CRS (e.g. EPSG:27700)
# 4. Shapefile via ST_ReadSHP
# 5. Custom SQL with ST_Point / ST_Transform
# 6. Verify map rendering with all geometry types
# 7. Verify table pagination still works (Arrow row extraction)
```
