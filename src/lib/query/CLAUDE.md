# query/

DuckDB-WASM query engine. Single worker, cancellable queries.

```mermaid
graph TD
    A[index.ts<br/>getQueryEngine] -->|lazy init| B[wasm.ts<br/>WasmQueryEngine]
    B -->|conn.send| C[DuckDB Worker]
    B -->|conn.cancelSent| C
    B -->|db.terminate| C
    D[engine.ts] -->|types| A
```

| File | Exports |
|------|---------|
| `engine.ts` | `QueryEngine` (interface), `QueryResult`, `MapQueryResult`, `SchemaField`, `QueryHandle`, `MapQueryHandle`, `QueryCancelledError` |
| `wasm.ts` | `WasmQueryEngine` — implements QueryEngine, manages DuckDB-WASM lifecycle |
| `index.ts` | `getQueryEngine()` — singleton factory, re-exports all types |

- `conn.send()` for data queries (non-blocking, cancellable)
- `conn.query()` only for fast metadata queries
- `enable_geoparquet_conversion = false` set at DB init
