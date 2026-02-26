# Performance Fix — File Map and Dependencies

> For AI agent: this maps every affected file to its issues, which phase fixes it,
> and what other files depend on it. Use this to plan execution order.

---

## Core Infrastructure (Fix First)

### `src/lib/storage/adapter.ts`
- **Phase:** 1.1
- **Issues:** No `signal` parameter on read/head/list/listPage
- **Change:** Add `signal?: AbortSignal` to `read()`, `head()`, `list()`, `listPage()`
- **Depended on by:** All storage adapters, all viewers, FileTreeSidebar, browser store

### `src/lib/storage/browser-cloud.ts`
- **Phase:** 1.2, 6.2
- **Issues:** No signal propagation to fetch; `createFetcher()` recreates AwsClient per call
- **Change:** Pass signal to cloudFetch; cache AwsClient per connection
- **Depends on:** `adapter.ts` (interface)
- **Depended on by:** All S3/R2/GCS/MinIO/Storj viewers and file tree

### `src/lib/storage/browser-azure.ts`
- **Phase:** 1.3
- **Issues:** No signal propagation to fetch
- **Change:** Pass signal to fetch calls
- **Depends on:** `adapter.ts` (interface)
- **Depended on by:** All Azure viewers and file tree

### `src/lib/storage/url-adapter.ts`
- **Phase:** 1.4
- **Issues:** No signal propagation to fetch
- **Change:** Pass signal to fetch calls
- **Depends on:** `adapter.ts` (interface)
- **Depended on by:** URL-based viewers (direct HTTPS file access)

### `src/lib/storage/index.ts`
- **Phase:** 6.1
- **Issues:** `getAdapter()` creates new adapter instance on every call
- **Change:** Cache adapters per connectionId
- **Depends on:** All adapter implementations
- **Depended on by:** All callers of `getAdapter()`

---

## Query Engine

### `src/lib/query/wasm.ts`
- **Phase:** 4.1, 7.2
- **Issues:** Double materialization (rows + arrowBytes); worker blob URL not revoked
- **Change:** Split `query()` into `query()` (rows) and `queryArrow()` (IPC bytes); revoke blob URL
- **Depends on:** DuckDB-WASM library
- **Depended on by:** `TableViewer`, `DatabaseViewer`, `SqlEditor`, `GeoParquetMapViewer`

### `src/lib/query/engine.ts`
- **Phase:** 4.1
- **Issues:** Interface needs split method signatures
- **Change:** Add `queryArrow()` to `QueryEngine` interface
- **Depends on:** None
- **Depended on by:** `wasm.ts`, all query callers

---

## Viewers — High Priority

### `src/lib/components/viewers/MapViewer.svelte`
- **Phase:** 2.1, 3.4
- **Issues:** No tabResources; no AbortController; geojsonData not freed on LRU eviction
- **Change:** Add cleanup(), tabResources.register(), AbortController, $state.raw for geojsonData
- **Depends on:** `adapter.ts` (for signal), `tab-resources.svelte.ts`
- **Depended on by:** None (leaf component)

### `src/lib/components/viewers/DatabaseViewer.svelte`
- **Phase:** 2.3, 4.2
- **Issues:** Dead adapter.read(); no tabResources; no onDestroy; DuckDB never DETACHed
- **Change:** Remove dead read; add cleanup with DETACH; add tabResources; use queryArrow()
- **Depends on:** `wasm.ts` (for queryArrow), `adapter.ts` (for signal)
- **Depended on by:** None (leaf component)

### `src/lib/components/viewers/TableViewer.svelte`
- **Phase:** 3.2, 4.2, 4.4
- **Issues:** rows should be $state.raw; uses query() which double-buffers; stale loadStage write
- **Change:** $state.raw for rows; use query() rows-only variant; guard catch handler
- **Depends on:** `wasm.ts` (for split query), `TableGrid.svelte` (receives rows prop)
- **Depended on by:** None (leaf component)

### `src/lib/components/viewers/NotebookViewer.svelte`
- **Phase:** 2.2
- **Issues:** No tabResources; no onDestroy; no load cancellation
- **Change:** Add cleanup(), tabResources.register(), onDestroy, generation counter
- **Depends on:** `adapter.ts` (for signal), `tab-resources.svelte.ts`
- **Depended on by:** None (leaf component)

---

## Viewers — Medium Priority

### `src/lib/components/viewers/CodeViewer.svelte`
- **Phase:** 2.4
- **Issues:** No AbortController on loadCode; no tabResources for data cleanup
- **Change:** Add AbortController, tabResources.register()
- **Depends on:** `adapter.ts` (for signal)

### `src/lib/components/viewers/MarkdownViewer.svelte`
- **Phase:** 2.5, 7.1
- **Issues:** No AbortController on loadMarkdown; mermaid re-initialized every render
- **Change:** Add AbortController; init-once guard for mermaid
- **Depends on:** `adapter.ts` (for signal)

### `src/lib/components/viewers/ImageViewer.svelte`
- **Phase:** 2.6
- **Issues:** No AbortController (but has proper cleanup otherwise)
- **Change:** Add AbortController to loadImage()
- **Depends on:** `adapter.ts` (for signal)

### `src/lib/components/viewers/MediaViewer.svelte`
- **Phase:** 2.6
- **Issues:** No AbortController (but has proper cleanup otherwise)
- **Change:** Add AbortController to loadMedia()
- **Depends on:** `adapter.ts` (for signal)

### `src/lib/components/viewers/ModelViewer.svelte`
- **Phase:** 2.6
- **Issues:** No AbortController
- **Change:** Add AbortController to loadModelFile()
- **Depends on:** `adapter.ts` (for signal)

### `src/lib/components/viewers/PdfViewer.svelte`
- **Phase:** 2.6
- **Issues:** No AbortController on adapter.read() (has PDF task cancellation)
- **Change:** Add AbortController to loadPdfData()
- **Depends on:** `adapter.ts` (for signal)

### `src/lib/components/viewers/RawViewer.svelte`
- **Phase:** 2.6
- **Issues:** No AbortController (low severity — 8KB max read)
- **Change:** Add AbortController to loadHexDump()
- **Depends on:** `adapter.ts` (for signal)

### `src/lib/components/viewers/CogViewer.svelte`
- **Phase:** 5.1
- **Issues:** capturedV2Geotiff/currentV3Tiff not nulled in cleanup; canvas not zeroed
- **Change:** Null module-level refs in cleanup(); zero canvas dimensions after toDataURL()
- **Depends on:** None
- **Depended on by:** None (leaf component)

### `src/lib/components/viewers/GeoParquetMapViewer.svelte`
- **Phase:** 5.2
- **Issues:** wkbArraysRef not nulled in cleanup
- **Change:** Add `wkbArraysRef = []` to cleanup()
- **Depends on:** None

### `src/lib/components/viewers/pmtiles/PmtilesMapView.svelte`
- **Phase:** 2.7
- **Issues:** No onDestroy; inspectPopup leak; mapRef not nulled
- **Change:** Add onDestroy with popup removal and ref nulling
- **Depends on:** None

### `src/lib/components/viewers/FlatGeobufViewer.svelte`
- **Phase:** 3.3
- **Issues:** features should be $state.raw (currently correct cleanup otherwise)
- **Change:** Change features to $state.raw
- **Depends on:** None

---

## Other Components

### `src/lib/components/viewers/TableGrid.svelte`
- **Phase:** 7.4
- **Issues:** document listeners leak on mid-drag tab close
- **Change:** Track resize cleanup function; add onDestroy
- **Depends on:** None

### `src/lib/components/browser/FileTreeSidebar.svelte`
- **Phase:** 3.1 (optional)
- **Issues:** $state on rootNodes (200 items per page, acceptable)
- **Change:** Consider $state.raw if perf issues observed
- **Depends on:** `adapter.ts` (already uses listPage with signal not needed for tree)

### `src/lib/components/editor/SqlEditor.svelte`
- **Phase:** 4.2
- **Issues:** Uses combined query result (both rows and arrowBytes)
- **Change:** Use appropriate query variant
- **Depends on:** `wasm.ts` (for split query)

---

## Stores

### `src/lib/stores/connections.svelte.ts`
- **Phase:** 7.5
- **Issues:** testWithConfig() persists temp connection to localStorage
- **Change:** Keep temp connection in-memory only during test
- **Depends on:** None

### `src/lib/stores/tab-resources.svelte.ts`
- **Phase:** None (already correct)
- **Depended on by:** All viewers that register cleanup

### `src/lib/stores/tabs.svelte.ts`
- **Phase:** None (already correct, minor recentOrder note)
- **Depended on by:** All tab-aware components

---

## Pages

### `src/routes/+page.svelte`
- **Phase:** 7.3
- **Issues:** tabViewModes Map never cleaned on tab close
- **Change:** Delete entries on tab close
- **Depends on:** `tabs.svelte.ts` (tab close events)

---

## Execution Order Summary

```
PARALLEL GROUP A (Foundation):
  Phase 1: adapter.ts → browser-cloud.ts → browser-azure.ts → url-adapter.ts

PARALLEL GROUP B (Independent fixes):
  Phase 3: $state.raw migration (all viewers)
  Phase 4: DuckDB query split (wasm.ts → engine.ts → callers)
  Phase 5: CogViewer + GeoParquet cleanup
  Phase 7: Minor fixes (all independent)

SEQUENTIAL (depends on Group A):
  Phase 2: Viewer AbortController + tabResources (needs Phase 1 signal support)
  Phase 6: Adapter caching (needs Phase 1 done first)
```

### Minimum viable improvement (highest ROI, fewest files):
1. `$state.raw` on TableViewer rows (Phase 3.2) — 1 file
2. Remove DatabaseViewer dead read (Phase 4.3) — 1 file
3. Null CogViewer GeoTIFF refs (Phase 5.1) — 1 file
4. Null GeoParquet wkbArraysRef (Phase 5.2) — 1 file
5. Add tabResources to MapViewer (Phase 2.1 partial) — 1 file
6. Add tabResources to NotebookViewer (Phase 2.2 partial) — 1 file
