# Performance Audit — Full Application Review

> Generated: 2026-02-26
> Scope: Memory management, resource cleanup, connection lifecycle, thread management

---

## Table of Contents

1. [Critical Issues (Must Fix)](#1-critical-issues-must-fix)
2. [Medium Issues (Should Fix)](#2-medium-issues-should-fix)
3. [Low Priority (Nice to Fix)](#3-low-priority-nice-to-fix)
4. [Svelte 5 Reactivity Issues](#4-svelte-5-reactivity-issues)
5. [What's Already Done Well](#5-whats-already-done-well)

---

## 1. Critical Issues (Must Fix)

### 1.1 No AbortController on Storage Adapters — In-Flight Fetches Cannot Be Cancelled

**Problem:** `StorageAdapter.read()` has no `signal` parameter. When a user switches tabs, the previous viewer's `fetch()` continues downloading the full file in the background. For large files (video, GeoJSON, PDFs) this wastes bandwidth and memory.

**Affected files:**
- `src/lib/storage/adapter.ts` — interface needs `signal?: AbortSignal` on `read()`, `head()`, `list()`, `listPage()`
- `src/lib/storage/browser-cloud.ts` — pass signal to `cloudFetch()`
- `src/lib/storage/browser-azure.ts` — pass signal to `fetch()`
- `src/lib/storage/url-adapter.ts` — pass signal to `fetch()`
- All 9+ viewers that call `adapter.read()` without cancellation:
  - `src/lib/components/viewers/CodeViewer.svelte`
  - `src/lib/components/viewers/MarkdownViewer.svelte`
  - `src/lib/components/viewers/MapViewer.svelte`
  - `src/lib/components/viewers/ImageViewer.svelte`
  - `src/lib/components/viewers/MediaViewer.svelte`
  - `src/lib/components/viewers/NotebookViewer.svelte`
  - `src/lib/components/viewers/ModelViewer.svelte`
  - `src/lib/components/viewers/PdfViewer.svelte`
  - `src/lib/components/viewers/RawViewer.svelte`
  - `src/lib/components/viewers/DatabaseViewer.svelte`

**Fix pattern:**
```ts
// adapter.ts
read(path: string, offset?: number, length?: number, signal?: AbortSignal): Promise<Uint8Array>;

// Each viewer's $effect:
$effect(() => {
  if (!tab) return;
  const ac = new AbortController();
  loadFile(ac.signal);
  return () => ac.abort();
});
```

**Impact:** High — prevents wasted bandwidth, reduces memory pressure on tab switching.

---

### 1.2 `$state` Used on Large Arrays — Should Be `$state.raw`

**Problem:** Svelte 5's `$state` wraps arrays in deep `Proxy` objects. For arrays with 1000+ items (table rows, file tree nodes, GeoJSON features), this causes:
- `deep_read` freezes when passed to non-rune code
- Proxy overhead on every array access
- Memory bloat from proxy wrappers

**Affected files and variables:**
- `src/lib/components/viewers/TableGrid.svelte` — `rows` prop (up to 5000 items)
- `src/lib/components/browser/FileTreeSidebar.svelte` — `rootNodes` (up to 3000+ items)
- `src/lib/components/viewers/FlatGeobufViewer.svelte` — `features` array
- `src/lib/components/viewers/MapViewer.svelte` — `geojsonData` (large GeoJSON)
- `src/lib/components/viewers/TableViewer.svelte` — `rows` state
- `src/lib/components/viewers/ArchiveViewer.svelte` — entry arrays
- `src/lib/stores/query-history.svelte.ts` — `entries` array (bounded at 200)

**Fix:** Replace `$state<T[]>([])` with `$state.raw<T[]>([])` for all large datasets. Update mutations from `.push()` to reassignment (`arr = [...arr, newItem]`).

**Impact:** High — prevents browser freezes on large datasets, reduces GC pressure.

---

### 1.3 DuckDB Query Results Double-Buffered

**Problem:** Every `conn.query()` result is materialized three times simultaneously:
1. DuckDB WASM heap (Arrow Table)
2. `rows: Record<string,any>[]` via `.toArray().map(r => r.toJSON())`
3. `arrowBytes: Uint8Array` via `tableToIPC(result)`

For TableViewer (the main consumer), only `rows` is used — `arrowBytes` is computed and discarded. This doubles peak memory for every query.

**Affected files:**
- `src/lib/query/wasm.ts` — `query()` method (lines ~231–270)
- `src/lib/components/viewers/TableViewer.svelte` — only uses `result.rows`
- `src/lib/components/viewers/DatabaseViewer.svelte` — only uses `result.arrowBytes`
- `src/lib/components/editor/SqlEditor.svelte` — uses both

**Fix:** Split into `query()` (returns rows only) and `queryArrow()` (returns IPC bytes). Or make `arrowBytes` lazy — only compute when accessed.

**Impact:** High — halves peak memory for table queries.

---

### 1.4 DatabaseViewer Dead `adapter.read()` Call

**Problem:** `DatabaseViewer.svelte` line ~44-45 reads the entire `.duckdb` file into a `Uint8Array` via `adapter.read()`, then never uses the `data` variable. The file is downloaded completely and immediately garbage collected.

**Affected file:** `src/lib/components/viewers/DatabaseViewer.svelte`

**Fix:** Remove the dead `adapter.read()` call. DuckDB attaches via httpfs URL, not via a downloaded buffer.

**Impact:** High for `.duckdb` files — eliminates a full redundant download.

---

### 1.5 DuckDB Queries Cannot Be Cancelled

**Problem:** `TableViewer` uses a `loadGeneration` counter to ignore stale results, but `conn.query()` in DuckDB-WASM continues running and consuming memory/network until it completes. There is no `AbortSignal` mechanism for DuckDB-WASM queries.

**Affected files:**
- `src/lib/query/wasm.ts` — all query methods
- `src/lib/components/viewers/TableViewer.svelte` — `loadGeneration` is a workaround, not a fix
- `src/lib/components/viewers/GeoParquetMapViewer.svelte` — no cancellation at all

**Fix:** This is a DuckDB-WASM limitation. Mitigations:
1. Add a `busy` flag to `WasmQueryEngine` so callers know a query is in flight
2. Consider `conn.cancelSent()` if the DuckDB-WASM version supports it
3. At minimum, ensure `loadGeneration` guard covers ALL state writes (currently `loadStage = ''` in the catch path runs unconditionally)

**Impact:** Medium — reduces wasted work, prevents stale state writes.

---

## 2. Medium Issues (Should Fix)

### 2.1 Missing `tabResources.register()` on Several Viewers

**Problem:** The `tabResources` registry enables LRU eviction — when a user opens >5 tabs, the oldest inactive tab's resources are freed. Viewers without registration keep data in memory indefinitely until the tab is closed.

| Viewer | Heavy data held | Missing |
|---|---|---|
| `MapViewer.svelte` | `geojsonData` (full GeoJSON) | `tabResources.register()` |
| `NotebookViewer.svelte` | rendered HTML cells, `rawContent` | `tabResources.register()`, `onDestroy` |
| `DatabaseViewer.svelte` | `rows`, `tables` arrays | `tabResources.register()`, `onDestroy`, DuckDB DETACH |
| `CodeViewer.svelte` | `rawCode`, `html` strings | `tabResources.register()` (has `$effect` cleanup for blob URL, but not for data) |

**Fix:** Add `cleanup()` function and `tabResources.register(tab.id, cleanup)` via `$effect` to each viewer.

---

### 2.2 CogViewer Module-Level GeoTIFF References Not Nulled

**Problem:** `capturedV2Geotiff` and `currentV3Tiff` are module-level variables that hold GeoTIFF objects. `cleanup()` does not null them, so after a tab is closed, these references linger.

**Affected file:** `src/lib/components/viewers/CogViewer.svelte`

**Fix:** Add `capturedV2Geotiff = null; currentV3Tiff = null;` to `cleanup()`.

---

### 2.3 GeoParquetMapViewer `wkbArraysRef` Not Nulled in Cleanup

**Problem:** `wkbArraysRef` holds direct references to `Uint8Array[]` WKB geometry data (potentially 10s of MB). `cleanup()` nulls `geoArrowState` but not `wkbArraysRef`.

**Affected file:** `src/lib/components/viewers/GeoParquetMapViewer.svelte`

**Fix:** Add `wkbArraysRef = [];` to `cleanup()`.

---

### 2.4 PmtilesMapView — No `onDestroy`, Inspect Popup Leak

**Problem:** `PmtilesMapView.svelte` has no `onDestroy` hook. If the user has inspect mode active and navigates away, the `inspectPopup` is never removed and `mapRef` is never nulled.

**Affected file:** `src/lib/components/viewers/pmtiles/PmtilesMapView.svelte`

**Fix:** Add `onDestroy(() => { inspectPopup?.remove(); inspectPopup = null; mapRef = null; })`.

---

### 2.5 `getAdapter()` Creates New `AwsClient` on Every HTTP Operation

**Problem:** `createFetcher()` is called inside each adapter method (not at construction). Each call creates a new `AwsClient` instance including SigV4 setup.

**Affected files:**
- `src/lib/storage/browser-cloud.ts` — `createFetcher()` called in every method
- `src/lib/storage/index.ts` — `getAdapter()` creates new adapter instances every call

**Fix:** Cache the fetcher per connection. Either:
1. Cache `AwsClient` in the adapter constructor
2. Cache adapter instances in `getAdapter()` keyed by `connectionId`

---

### 2.6 TableGrid `document` Listeners Leak on Mid-Drag Tab Close

**Problem:** Column resize adds `document.addEventListener('mousemove/mouseup')`. If the tab is closed while a drag is in progress, `mouseup` never fires and both listeners persist on `document` permanently.

**Affected file:** `src/lib/components/viewers/TableGrid.svelte`

**Fix:** Track the listeners and remove them in component cleanup:
```ts
let activeResizeCleanup: (() => void) | null = null;
onDestroy(() => activeResizeCleanup?.());
```

---

### 2.7 Mermaid.js Re-Initialized on Every Markdown Render

**Problem:** `mermaid.initialize({...})` is called every time a markdown file is loaded. Mermaid is a global singleton — repeated initialization resets global state and is wasteful.

**Affected file:** `src/lib/components/viewers/MarkdownViewer.svelte`

**Fix:** Add a module-level `mermaidInitialized` flag. Initialize once on first use.

---

### 2.8 No Concurrent Request Limiting

**Problem:** Opening many tabs rapidly fires many parallel `adapter.read()` calls with no back-pressure. The browser limits concurrent HTTP/2 connections per origin (~100), but JS memory is unbounded.

**Affected files:**
- All viewers that load on mount
- `src/lib/components/browser/FileTreeSidebar.svelte` — rapid scroll can trigger many `listPage()` calls

**Fix:** Add a simple semaphore/queue to `getAdapter()` or a shared `fetchWithLimit()` utility. Limit to ~6 concurrent requests.

---

## 3. Low Priority (Nice to Fix)

### 3.1 DuckDB Worker Blob URL Never Revoked

**File:** `src/lib/query/wasm.ts` lines 77-79
**Fix:** Add `URL.revokeObjectURL(workerUrl)` after `new Worker(workerUrl)`.

### 3.2 DuckDB Worker Never Terminated

**File:** `src/lib/query/wasm.ts` — `dispose()` only runs `CHECKPOINT`, never `worker.terminate()` or `db.close()`.
**Note:** Acceptable for SPA — the worker lives for the page session. But prevents runtime DuckDB reset.

### 3.3 `tabViewModes` Map Grows Unbounded

**File:** `src/routes/+page.svelte` — `tabViewModes` Map accumulates entries for closed tabs.
**Fix:** Clean up entries in the tab close handler.

### 3.4 `setTimeout` for Clipboard State Never Cancelled

**Files:** `CodeViewer.svelte`, `MarkdownViewer.svelte`, `NotebookViewer.svelte`, `TabBar.svelte`, `TableToolbar.svelte`, `TableGrid.svelte`
**Fix:** Store timeout IDs and `clearTimeout()` on destroy. Low severity — Svelte 5 rune writes to destroyed components are no-ops.

### 3.5 `connections.svelte.ts` — `testWithConfig()` Temp Connection in localStorage

**Problem:** Temp connection is written to localStorage before the test. If browser crashes mid-test, it persists.
**Fix:** Don't persist to localStorage during the test — keep the temp connection in-memory only and persist only on success.

### 3.6 PMTiles Protocol Never Removed

**File:** `src/lib/components/viewers/pmtiles/PmtilesMapView.svelte`
**Note:** `addProtocol('pmtiles', ...)` is idempotent and the handler references the library module, not per-instance data. Low risk.

---

## 4. Svelte 5 Reactivity Issues

### 4.1 `$state` on Large Arrays — Use `$state.raw`

Svelte 5's `$state` wraps arrays in deep Proxy objects. For arrays with 1000+ items, this causes performance issues including `deep_read` freezes. Use `$state.raw` for large datasets that are replaced wholesale (not mutated).

### 4.2 Async `$effect` Anti-Pattern

Many viewers use `$effect(() => { loadXxx(); })` where `loadXxx` is async. The `$effect` callback cannot be async (it must return a cleanup function, not a Promise). The correct pattern:

```ts
$effect(() => {
  const deps = tab; // read deps synchronously
  const ac = new AbortController();
  loadXxx(ac.signal); // fire-and-forget async
  return () => ac.abort(); // cleanup cancels
});
```

### 4.3 `$derived` Chain Depth

Avoid `$derived` chains deeper than 2-3 levels due to exponential recomputation bug (Svelte issue #15936). Flatten by writing intermediate values to `$state`.

---

## 5. What's Already Done Well

- **`tabResources` registry** — solid LRU eviction pattern for viewer cleanup
- **PdfViewer** — best resource management: `PDFDocumentLoadingTask.destroy()`, `PDFDocumentProxy.destroy()`, dual registration
- **ImageViewer / MediaViewer** — correct `URL.revokeObjectURL()` lifecycle
- **FlatGeobufViewer** — proper AbortController + stream cancellation
- **CogViewer** — thorough AbortController checked at every async step
- **ArchiveViewer** — correct abort + stream cancel + buffer cleanup
- **DuckDB connection lifecycle** — every `db.connect()` has matching `conn.close()` in `finally`
- **CodeViewer blob URL** — `$effect` return correctly revokes blob URL
- **TableGrid column resize** — self-removing `mouseup` listener (correct under normal flow)
- **MapContainer** — `map.remove()` in `onDestroy` properly disposes WebGL
- **FileTreeSidebar** — IntersectionObserver in Svelte action with proper `destroy()` disconnect
- **Shiki highlighter** — module-level singleton, loaded once, reused everywhere
