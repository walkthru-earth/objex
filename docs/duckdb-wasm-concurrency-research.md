# DuckDB-WASM Concurrency, Threading & Query Cancellation

Research date: 2026-02-26

---

## 1. Threading Model

### Default: Single-Threaded

DuckDB-WASM is **single-threaded by default**. The WASM module runs inside **one Web Worker** (browser) or Worker Thread (Node.js), and that worker processes all queries **sequentially** on a single thread.

The `AsyncDuckDB` class is a thin RPC layer on the main thread that posts messages to the Web Worker and awaits responses. It does **not** enable parallelism -- it merely prevents the main/UI thread from blocking.

```
Main Thread (UI)                Web Worker (single thread)
     |                                |
     |-- postMessage(RUN_QUERY) ----> |
     |   (awaits Promise)             |-- executes query synchronously
     |                                |-- postMessage(QUERY_RESULT)
     |<--- onMessage(result) ---------|
     |   (resolves Promise)           |
```

### Three WASM Bundles

| Bundle | File                  | Threading    | Exception Handling | Requirements |
|--------|-----------------------|--------------|--------------------|--------------|
| **MVP** | `duckdb-mvp.wasm`    | Single       | JS-emulated (slow) | All browsers (Chrome 57+) |
| **EH**  | `duckdb-eh.wasm`     | Single       | Native WASM        | Chrome 95+, Firefox 100+ |
| **COI** | `duckdb-coi.wasm`    | **Multi (pthread)** | Native WASM + SIMD | Cross-Origin Isolation headers |

The COI (Cross-Origin Isolated) bundle enables **multi-threaded query execution** via `SharedArrayBuffer` + Emscripten pthreads. It requires the server to send:
```
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Opener-Policy: same-origin
```

**Our project uses MVP/EH only** (no COI bundle configured in `src/lib/query/wasm.ts`), so we are strictly single-threaded.

### What COI Multi-Threading Actually Does

Even with COI, **query execution is parallelized internally** (morsel-driven parallelism within a single query). It does NOT enable multiple independent queries running in parallel -- the worker still processes one query at a time; it just uses multiple threads for that one query.

---

## 2. Multiple Connections & Concurrent Queries

### Connections Share One Worker

All connections created via `db.connect()` share the **same single Web Worker** and the same DuckDB database instance. From [GitHub Issue #394](https://github.com/duckdb/duckdb-wasm/issues/394), maintainer **ankoh** confirmed:

> "DuckDB runs 1-query-at-a-time in the web worker... limited to executing 1 query at a time in your instance"

### What Happens When Two Tabs/Components Send Queries Simultaneously?

Since our `getDB()` returns a singleton `AsyncDuckDB` instance, both tabs share the same worker. When two `conn.query()` calls are in flight:

1. Both messages are posted to the Web Worker's message queue via `postMessage()`
2. The worker's `onMessage` handler processes them **sequentially** (JavaScript event loop)
3. The first query runs to completion, its result is posted back
4. Only then does the second query begin execution
5. Both Promises on the main thread eventually resolve, but the second one waits for the first

**They serialize -- the second query blocks until the first finishes.** There is no deadlock or error, just queuing delay.

### The `Promise.all` Pattern (Cosmetic Only)

The maintainers suggest this pattern, but it does NOT provide true parallelism:

```typescript
const results = await Promise.all([
  conn1.query('SELECT ...'),  // queued first
  conn2.query('SELECT ...'),  // queued second, waits for first
]);
```

This is purely a JavaScript convenience -- both promises are created immediately, but the worker processes them sequentially. The only benefit is reducing event loop overhead from sequential `await`.

---

## 3. Query Cancellation API

### Available Methods

DuckDB-WASM exposes cancellation through two related APIs:

#### `AsyncDuckDBConnection.cancelSent(): Promise<boolean>`

```typescript
// On the connection object
const success = await conn.cancelSent();
```

This is the high-level API. Under the hood it calls:

#### `AsyncDuckDB.cancelPendingQuery(conn: number): Promise<boolean>`

```typescript
// On the database object
const success = await db.cancelPendingQuery(connectionId);
```

### How Cancellation Works Internally

The cancellation chain:

```
conn.cancelSent()
  -> AsyncDuckDB.cancelPendingQuery(connId)
    -> postMessage(CANCEL_PENDING_QUERY, connId) to worker
      -> WorkerDispatcher handles message
        -> DuckDBBindings.cancelPendingQuery(connId)
          -> C++ WebDB::Connection::CancelPendingQuery()
```

The C++ implementation (`lib/src/webdb.cc`):

```cpp
bool WebDB::Connection::CancelPendingQuery() {
    if (current_pending_query_result_ != nullptr && current_query_result_ == nullptr) {
        current_pending_query_was_canceled_ = true;
        current_pending_query_result_.reset();
        current_pending_statements_.clear();
        return true;
    } else {
        return false;
    }
}
```

### Critical Limitation: Only Works with `send()`, NOT `query()`

**`cancelSent()` only cancels queries started via `conn.send()` (streaming/pending mode).**

The `send()` method uses a poll-based execution model:
1. `startPendingQuery()` -- initiates the query
2. `pollPendingQuery()` -- repeatedly polls for results
3. Between polls, `cancelPendingQuery()` can set the cancellation flag
4. On next poll, the flag is checked and the query is aborted

The `query()` method (which our project uses exclusively) calls `runQuery()`, which executes the query **synchronously and to completion** on the worker thread. There is **no opportunity to cancel** because:
- The worker is blocked executing C++ code
- The cancel message sits in the worker's message queue
- The message queue is only processed after the current synchronous call returns
- By then, the query is already done

### The Fundamental Problem

```
Main Thread                   Web Worker
     |                            |
     |-- RUN_QUERY(sql) -------> |
     |                            |-- duckdb_web_query_run_buffer() [BLOCKING]
     |-- CANCEL_PENDING -------> |   (message queued, cannot be processed)
     |                            |   ...still executing...
     |                            |   ...still executing...
     |                            |<- query finishes
     |                            |-- processes CANCEL message (too late!)
     |<-- QUERY_RESULT -----------|
```

### Using `send()` for Cancellable Queries

To make queries cancellable, you must use `send()` instead of `query()`:

```typescript
const conn = await db.connect();

// Start the query (non-blocking)
const reader = await conn.send('SELECT * FROM huge_table');

// Later, from another context (e.g., user clicks Cancel):
const wasCanceled = await conn.cancelSent();
// wasCanceled === true if cancellation was accepted

// The reader will throw an error on next iteration
try {
  for await (const batch of reader) {
    // process batch...
  }
} catch (e) {
  // "query was canceled"
}
```

**However**, cancellation granularity is coarse: at least one "chunk" of tuples must be processed before the cancel flag is checked. For queries that spend all their time in a single long-running operator (e.g., COPY, large JOIN), the cancel may not be honored until that operator completes a chunk.

---

## 4. What Happens If You Call `conn.close()` During a Running Query?

`conn.close()` calls `db.disconnect(connId)`, which posts a `DISCONNECT` message to the worker. The same serialization problem applies:

- If a synchronous `runQuery()` is executing, the DISCONNECT message queues behind it
- The disconnect will only happen after the query finishes
- This means `close()` is not a way to cancel a running query

### Nuclear Option: `db.terminate()`

```typescript
await db.terminate(); // kills the Web Worker immediately
```

This calls `worker.terminate()` which **forcefully kills the worker thread**. The query stops immediately, but:
- All database state is lost
- All pending promises will never resolve (they become orphaned)
- You must create a new `AsyncDuckDB` instance and re-instantiate from scratch
- Registered files, loaded extensions, etc. must be re-loaded

This is the only way to truly stop a synchronous `runQuery()` that is already executing.

---

## 5. Relevant GitHub Issues

| Issue/Discussion | Title | Status | Key Takeaway |
|---|---|---|---|
| [#394](https://github.com/duckdb/duckdb-wasm/issues/394) | Suggested way to handle read-only concurrency | Closed | Confirmed 1-query-at-a-time per worker instance |
| [#1723](https://github.com/duckdb/duckdb-wasm/issues/1723) | Asynchronous HTTP reads | **Open** | Worker is blocked in C++ callstack during I/O, restricting to single blocking HTTP reads |
| [#1588](https://github.com/duckdb/duckdb-wasm/issues/1588) | `AsyncDuckDB.instantiate` emits "worker terminated with 1 pending requests" | Open | Worker termination with pending operations causes hangs |
| [#1904](https://github.com/duckdb/duckdb-wasm/issues/1904) | Memory not released after query execution | Open | Memory management issues with WASM's 4GB limit |
| [#1963](https://github.com/duckdb/duckdb-wasm/discussions/1963) | Is it possible to run multiple queries at the same time? | Answered | Multiple statements in one call only returns first result |
| [#1484](https://github.com/duckdb/duckdb-wasm/discussions/1484) | Accessing DuckDB with 2 functions independently | Answered | Must share database instance across functions |
| [duckdb#5938](https://github.com/duckdb/duckdb/issues/5938) | Add conn.interrupt() to Python API | Closed (merged) | DuckDB core has `duckdb_interrupt()` but it is NOT exposed in WASM bindings |
| [duckdb#13868](https://github.com/duckdb/duckdb/discussions/13868) | Query interrupt wait times | Open | Even `interrupt()` has 30+ second latency ~40% of the time on heavy ops |

---

## 6. Implications for Our Project

### Current State (in `src/lib/query/wasm.ts`)

Our `WasmQueryEngine` has these characteristics:

1. **Singleton DB instance** (`dbPromise`) -- all queries share one worker
2. **Uses `conn.query()` everywhere** -- queries are non-cancellable
3. **Creates a new connection per query** (`await db.connect()`) -- good practice, but does not enable parallelism since they share the same worker
4. **MVP/EH bundles only** -- strictly single-threaded

### What This Means Practically

- If a user is on a large GeoParquet file and the viewer triggers `getSchema()` + `getRowCount()` + `queryForMap()`, they execute sequentially
- A long-running `queryForMap()` (with ST_Transform, ST_AsWKB on millions of rows) blocks ALL other DuckDB operations
- The user's custom SQL query in the editor cannot run until the viewer query finishes
- There is no way to cancel a `conn.query()` call once it starts

### Potential Workarounds

**Option A: Use `send()` + `cancelSent()` for user-initiated queries**
- Switch from `conn.query(sql)` to `conn.send(sql)` for queries that should be cancellable
- Collect results from the `AsyncRecordBatchStreamReader`
- Call `conn.cancelSent()` when user clicks Cancel
- Downside: more complex code, cancel granularity is coarse

**Option B: `terminate()` + reinitialize as emergency cancel**
- Kill the worker entirely and recreate the DB
- Works for all query types
- Downside: loses all state, slow (re-downloads WASM + extensions)

**Option C: Web Worker timeout wrapper**
- Wrap `conn.query()` in a `Promise.race` with a timeout
- On timeout, call `db.terminate()` and reinitialize
- Gives the user a timeout-based cancel mechanism

**Option D: Multiple AsyncDuckDB instances (separate workers)**
- Create two independent `AsyncDuckDB` instances with separate workers
- One for viewer queries, one for user SQL
- True parallelism (separate workers = separate threads)
- Downside: doubles memory usage, each needs its own extensions loaded, no shared state between them

---

## 7. Summary

| Question | Answer |
|---|---|
| Is DuckDB-WASM truly single-threaded? | **Yes**, by default (MVP/EH bundles). COI bundle adds intra-query parallelism but still processes one query at a time. |
| Can two connections run queries in parallel? | **No**. All connections share one Web Worker. Queries serialize. |
| Can you cancel a `conn.query()` call? | **No**. It runs synchronously on the worker. Cancel messages queue behind it. |
| Can you cancel a `conn.send()` call? | **Yes**, via `conn.cancelSent()`. Works between poll intervals. Granularity is coarse. |
| What does `conn.close()` do during a query? | **Nothing immediate**. The close message queues behind the running query. |
| What does `db.terminate()` do? | **Kills the worker immediately**. All state is lost. Must reinitialize. |
| Is `duckdb_interrupt()` available in WASM? | **No**. It exists in DuckDB core (C/Python/Rust) but is NOT exposed in the WASM bindings. |
