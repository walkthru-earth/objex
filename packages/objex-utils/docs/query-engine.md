# Query engine

Interfaces only. `@walkthru-earth/objex-utils` does not ship a DuckDB-WASM implementation; the objex app provides one (`src/lib/query/wasm.ts`). Use `QueryEngine` as the shape your own engine must implement, or that downstream consumers of your library can depend on.

Source: `src/lib/query/engine.ts`.

## Types

### `QueryResult`

```ts
interface QueryResult {
  columns: string[];
  types: string[];
  rowCount: number;
  rows: Record<string, any>[];   // already materialized
}
```

Pre-parsed rows avoid the Arrow version-mismatch surface in DuckDB-WASM (ships Arrow v17 internally while the project may use Arrow v21).

### `MapQueryResult`

```ts
interface MapQueryResult {
  wkbArrays: Uint8Array[];                                     // geometry column as raw WKB
  geometryType: string;                                        // e.g. 'POLYGON'
  attributes: Map<string, { values: any[]; type: string }>;    // non-geometry columns, columnar
  rowCount: number;
}
```

Raw columnar shape for map rendering — feed straight into [`buildGeoArrowTables`](./geometry.md#buildgeoarrowtables).

### `SchemaField`

```ts
interface SchemaField {
  name: string;
  type: string;       // DuckDB type string, e.g. 'VARCHAR', 'GEOMETRY(EPSG:27700)'
  nullable: boolean;
}
```

### `QuerySource`

```ts
interface QuerySource {
  ref: string;          // FROM-clause expression, e.g. read_parquet('...url...') or "db"."schema"."table"
  filePath?: string;    // optional shortcut for Parquet file metadata queries
}
```

### Cancellation

```ts
interface QueryHandle {
  result: Promise<QueryResult>;
  cancel(): Promise<boolean>;    // true if cancelled, false if already completed
}

interface MapQueryHandle {
  result: Promise<MapQueryResult>;
  cancel(): Promise<boolean>;
}

class QueryCancelledError extends Error {
  name: 'QueryCancelledError';
}
```

The cancellable variants are how `objex` drives long-running queries — `cancel()` invokes DuckDB's `conn.send()` cancel path so the single worker isn't held hostage by an abandoned tab.

## `QueryEngine` interface

```ts
interface QueryEngine {
  query(connId: string, sql: string): Promise<QueryResult>;

  queryForMap(
    connId: string,
    sql: string,
    geomCol: string,
    geomColType: string,
    sourceCrs?: string | null
  ): Promise<MapQueryResult>;

  getSchema(connId: string, source: QuerySource): Promise<SchemaField[]>;
  getRowCount(connId: string, source: QuerySource): Promise<number>;
  detectCrs(
    connId: string,
    source: QuerySource,
    geomCol: string
  ): Promise<string | null>;

  getSchemaAndCrs?(
    connId: string,
    source: QuerySource,
    findGeoCol: (schema: SchemaField[]) => string | null
  ): Promise<{ schema: SchemaField[]; geomCol: string | null; crs: string | null }>;

  queryCancellable?(connId: string, sql: string): QueryHandle;
  queryForMapCancellable?(
    connId: string,
    sql: string,
    geomCol: string,
    geomColType: string,
    sourceCrs?: string | null
  ): MapQueryHandle;

  forceCancel?(): Promise<void>;
  registerFileBuffer?(name: string, buffer: Uint8Array): Promise<void>;
  dropFile?(name: string): Promise<void>;

  releaseMemory(): Promise<void>;
  dispose(): Promise<void>;
}
```

### Methods at a glance

| Method | Required? | Notes |
|--------|-----------|-------|
| `query` | yes | Fire-and-forget query returning pre-parsed rows. |
| `queryForMap` | yes | Geometry-aware query. `geomColType` lets the engine decide whether to wrap in `ST_AsWKB` / `ST_Transform`. `sourceCrs` (e.g. `'EPSG:27700'`) is only used when the geometry column does not have a parameterized GEOMETRY type; pass `null` for WGS84. |
| `getSchema` / `getRowCount` | yes | Metadata helpers. `QuerySource.ref` is the FROM expression — works for both files and catalog tables. |
| `detectCrs` | yes | Returns e.g. `'EPSG:27700'` or `null` (WGS84 / unknown). |
| `getSchemaAndCrs` | optional | Single round-trip combining the three above. `findGeoCol` is injected so the engine can inspect the schema without owning the heuristic. |
| `queryCancellable` / `queryForMapCancellable` | optional | Prefer these in UIs. Falls back to non-cancellable when absent. |
| `forceCancel` | optional | Kill any in-flight query across all handles. |
| `registerFileBuffer` / `dropFile` | optional | Register an in-memory file in DuckDB's VFS (used for ATTACH'd catalogs, drag-and-drop). |
| `releaseMemory` | yes | Trim DuckDB buffer pools (e.g. after closing large tabs). |
| `dispose` | yes | Tear down the connection fully. |

### Implementation checklist

- Serialize rows with BigInt-safe JSON (see [`jsonReplacerBigInt`](./formatting.md#jsonreplacerbigint)).
- Wrap geometry selects with `ST_AsWKB(...)` before Arrow export — DuckDB-WASM cannot Arrow-export `GEOMETRY` yet ([duckdb/duckdb-wasm#2187](https://github.com/duckdb/duckdb-wasm/issues/2187)).
- Return `rowCount` even when the result is streamed; consumers display progress.
- Surface cancellation via `QueryCancelledError` so UIs can distinguish "user aborted" from real failures.
