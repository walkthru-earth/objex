# DuckDB Init / SET Queries

All `SET`, `SET GLOBAL`, `INSTALL`, and `LOAD` statements issued against DuckDB-WASM, in execution order. Sources: `src/lib/query/wasm.ts`, `src/lib/components/viewers/TableViewer.svelte`.

## 1. Extension bootstrap (DB init, once per session)

`src/lib/query/wasm.ts:282`

```sql
SELECT * FROM duckdb_coordinate_systems();
INSTALL httpfs;
LOAD httpfs;
INSTALL spatial;
LOAD spatial;
```

Ordering is load-bearing. The `duckdb_coordinate_systems()` call must run BEFORE the explicit `LOAD spatial` to warm the PROJ default CRS registry, working around [duckdb/duckdb-wasm#2199](https://github.com/duckdb/duckdb-wasm/issues/2199) ("stoi: no conversion" on GeoParquet with CRS metadata).

## 2. Global geometry / httpfs tuning (DB init)

`src/lib/query/wasm.ts:293`, `:300`

```sql
SET GLOBAL geometry_always_xy = true;
SET GLOBAL force_download_threshold = 2000000;
```

- `geometry_always_xy = true`, forces lon/lat (x/y) axis order across all connections, matches GeoJSON/GeoParquet convention.
- `force_download_threshold = 2000000`, httpfs downloads files smaller than 2 MB in one shot instead of range-requesting.

## 3. Memory / threading tuning (DB init, per environment)

`src/lib/query/wasm.ts:325`-`:361`. Always set:

```sql
SET preserve_insertion_order = false;
```

Then one of three branches, executed as a single batched query.

### 3a. OPFS spill active

```sql
SET memory_limit = '2GB';       -- '900MB' on mobile
SET threads = <min(4, cores/2)>; -- min(2, cores/2) on mobile
SET temp_directory = '.tmp';
```

### 3b. Mobile, no OPFS spill

```sql
SET memory_limit = '900MB';
SET threads = 1;
SET temp_directory = '.tmp';
```

### 3c. Desktop, no OPFS spill

```sql
SET threads = <min(2, cores/2)>;
SET temp_directory = '.tmp';
```

`memory_limit` is left at DuckDB defaults so queries can use the full WASM heap (~3 GiB).

## 4. Per-query storage config (only for `signed-s3` connections)

`src/lib/query/wasm.ts:998`-`:1019`. Batched into a single `;`-joined statement per query.

```sql
SET s3_access_key_id = '<creds.accessKey>';
SET s3_secret_access_key = '<creds.secretKey>';
SET s3_region = '<connection.region>';
SET s3_endpoint = '<endpointHost>';
SET s3_use_ssl = false;   -- only when endpoint starts with http://
SET s3_url_style = 'path';
```

Skipped entirely when:
- `sourceRef` is a presigned HTTPS URL (`isHttpsSourceRef`), or
- access mode is `public-https` or `sas-https` (the URL is self-authenticating).

`s3_url_style = 'path'` is always set when the block runs, virtual-hosted style breaks for buckets with dots.

## 5. Legacy GeoParquet fallback (per-connection, on demand)

`src/lib/components/viewers/TableViewer.svelte:484`, `:635`

```sql
SET enable_geoparquet_conversion = false;
```

Set per-connection when `schema_version` is present without `version` (geopandas < 0.12). Geometry columns then read as BLOB, the known CRS from hyparquet metadata is re-attached via `ST_SetCRS(ST_GeomFromWKB(...))`.
