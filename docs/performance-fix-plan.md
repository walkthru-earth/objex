# Performance Fix Plan — Execution Order

> For AI agent context: each phase is independent and can be executed as a single task.
> Phases are ordered by dependency — later phases may depend on earlier ones.

---

## Phase 1: Storage Layer — AbortSignal Support

**Goal:** Enable cancellation of in-flight HTTP requests when tabs switch or close.

### Step 1.1: Update `StorageAdapter` Interface

**File:** `src/lib/storage/adapter.ts`

Add optional `signal` parameter to all methods:
```ts
export interface StorageAdapter {
  list(path: string, signal?: AbortSignal): Promise<FileEntry[]>;
  read(path: string, offset?: number, length?: number, signal?: AbortSignal): Promise<Uint8Array>;
  head(path: string, signal?: AbortSignal): Promise<FileEntry>;
  listPage?(path: string, continuationToken?: string, pageSize?: number, signal?: AbortSignal): Promise<ListPage>;
  put(key: string, data: Uint8Array, contentType?: string): Promise<WriteResult>;
  delete(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<{ deleted: number }>;
  copy(srcKey: string, destKey: string): Promise<WriteResult>;
  readonly supportsWrite: boolean;
}
```

### Step 1.2: Implement Signal in S3 Adapter

**File:** `src/lib/storage/browser-cloud.ts`

- Update `listPage()`, `list()`, `read()`, `head()` signatures to accept `signal`
- Pass `signal` to `cloudFetch()` calls: `cloudFetch(url, { signal })` and `cloudFetch(url, { headers, signal })`

### Step 1.3: Implement Signal in Azure Adapter

**File:** `src/lib/storage/browser-azure.ts`

- Same pattern: pass `signal` to `fetch()` calls

### Step 1.4: Implement Signal in URL Adapter

**File:** `src/lib/storage/url-adapter.ts`

- Pass `signal` to `fetch()` calls

### Step 1.5: Update FileTreeSidebar

**File:** `src/lib/components/browser/FileTreeSidebar.svelte`

- No change needed — tree operations should NOT be aborted on tab switch (tree is shared)

### Step 1.6: Update Browser Store

**File:** `src/lib/stores/browser.svelte.ts`

- Pass signal where applicable (optional — browse operations are user-initiated)

**Dependencies:** None. This is foundational.

---

## Phase 2: Viewer Cleanup — AbortController + tabResources

**Goal:** Every viewer properly cancels in-flight loads and registers with tabResources.

### Pattern to Apply

Each viewer should follow this pattern:
```ts
let abortController = new AbortController();

function cleanup() {
  abortController.abort();
  // null out heavy state
}

$effect(() => {
  if (!tab) return;
  const unregister = tabResources.register(tab.id, cleanup);
  return unregister;
});

$effect(() => {
  if (!tab) return;
  abortController.abort();
  abortController = new AbortController();
  loadXxx(abortController.signal);
});

onDestroy(cleanup);
```

### Step 2.1: Fix MapViewer

**File:** `src/lib/components/viewers/MapViewer.svelte`

- Add `cleanup()` function that nulls `geojsonData`
- Add `tabResources.register(tab.id, cleanup)`
- Add `AbortController` to `loadGeoJson()` — pass signal to `adapter.read()`
- Add `onDestroy(cleanup)`

### Step 2.2: Fix NotebookViewer

**File:** `src/lib/components/viewers/NotebookViewer.svelte`

- Add `cleanup()` that clears `rawContent` and `container.innerHTML`
- Add `tabResources.register(tab.id, cleanup)`
- Add generation counter or AbortController to `loadNotebook()`
- Add `onDestroy(cleanup)`

### Step 2.3: Fix DatabaseViewer

**File:** `src/lib/components/viewers/DatabaseViewer.svelte`

- Remove the dead `adapter.read()` call (line ~44-45)
- Add `cleanup()` that runs `DETACH db` on DuckDB and clears state
- Add `tabResources.register(tab.id, cleanup)`
- Add `onDestroy(cleanup)`

### Step 2.4: Fix CodeViewer

**File:** `src/lib/components/viewers/CodeViewer.svelte`

- Add `AbortController` to `loadCode()` — pass signal to `adapter.read()`
- The blob URL `$effect` cleanup is already correct
- Add `tabResources.register()` for `rawCode`/`html` state cleanup

### Step 2.5: Fix MarkdownViewer

**File:** `src/lib/components/viewers/MarkdownViewer.svelte`

- Add `AbortController` to `loadMarkdown()` — pass signal to `adapter.read()`
- Already has `tabResources.register()` — verify it aborts in-flight loads

### Step 2.6: Fix ImageViewer, MediaViewer, ModelViewer, PdfViewer, RawViewer

**Files:** All in `src/lib/components/viewers/`

- Add `AbortController` to each load function
- Pass `signal` to `adapter.read()` calls
- ImageViewer and MediaViewer already have proper `tabResources` + `onDestroy`

### Step 2.7: Fix PmtilesMapView

**File:** `src/lib/components/viewers/pmtiles/PmtilesMapView.svelte`

- Add `onDestroy(() => { inspectPopup?.remove(); inspectPopup = null; mapRef = null; })`

**Dependencies:** Phase 1 (signal support on adapters).

---

## Phase 3: `$state.raw` Migration for Large Arrays

**Goal:** Replace `$state` with `$state.raw` on all large data arrays to eliminate Proxy overhead.

### Step 3.1: FileTreeSidebar

**File:** `src/lib/components/browser/FileTreeSidebar.svelte`

Change:
```ts
let rootNodes = $state<TreeNode[]>([]);
```
To:
```ts
let rootNodes = $state.raw<TreeNode[]>([]);
```

**Important:** TreeNode children are currently mutated in-place (`node.children = [...]`, `node.expanded = true`). With `$state.raw`, these mutations won't trigger reactivity. Two approaches:
1. Keep `rootNodes` as `$state.raw` but use `rootNodes = [...rootNodes]` to trigger top-level reactivity after child mutations
2. Or keep `$state` for now if the tree is always <1000 visible nodes (since collapsed subtrees aren't in the DOM)

**Recommendation:** Keep `$state` for TreeNode (mutations needed), but set `PAGE_SIZE = 200` limits the rendered count. The real performance win is the lazy loading, not the proxy elimination.

### Step 3.2: TableViewer / TableGrid

**File:** `src/lib/components/viewers/TableViewer.svelte`

Change `rows` to `$state.raw`:
```ts
let rows = $state.raw<Record<string, any>[]>([]);
```
This is safe — `rows` is always replaced wholesale (`rows = result.rows`), never mutated.

**File:** `src/lib/components/viewers/TableGrid.svelte`

The `rows` prop comes from the parent. No change needed in the child — it receives a plain array.

### Step 3.3: FlatGeobufViewer

**File:** `src/lib/components/viewers/FlatGeobufViewer.svelte`

Change `features` to `$state.raw`:
```ts
let features = $state.raw<GeoJSON.Feature[]>([]);
```
Safe — features are appended via reassignment during streaming (`features = [...features, ...batch]`).

### Step 3.4: MapViewer

**File:** `src/lib/components/viewers/MapViewer.svelte`

Change `geojsonData` to `$state.raw` — it's a large GeoJSON object replaced wholesale.

### Step 3.5: ArchiveViewer

**File:** `src/lib/components/viewers/ArchiveViewer.svelte`

Change `entries` state to `$state.raw` if it holds a large array.

**Dependencies:** None. Independent of other phases.

---

## Phase 4: DuckDB Query Optimization

**Goal:** Eliminate double-buffering and dead reads in the query engine.

### Step 4.1: Split `query()` Into Two Methods

**File:** `src/lib/query/wasm.ts`

```ts
// For TableViewer — returns rows only, no IPC serialization
async query(connId: string, fileUrl: string, sql: string, opts?: QueryOptions): Promise<QueryResult> {
  // ... execute SQL ...
  const rows = result.toArray().map(row => row.toJSON());
  return { columns, types, rowCount, rows };
  // NO arrowBytes computation
}

// For DatabaseViewer / SqlEditor — returns IPC bytes
async queryArrow(connId: string, fileUrl: string, sql: string): Promise<ArrowQueryResult> {
  // ... execute SQL ...
  const arrowBytes = new Uint8Array(tableToIPC(result));
  return { columns, types, rowCount, arrowBytes };
  // NO rows materialization
}
```

### Step 4.2: Update Callers

**Files:**
- `src/lib/components/viewers/TableViewer.svelte` — use `engine.query()` (rows only)
- `src/lib/components/viewers/DatabaseViewer.svelte` — use `engine.queryArrow()` (IPC only)
- `src/lib/components/editor/SqlEditor.svelte` — use `engine.query()` for display, `engine.queryArrow()` for export

### Step 4.3: Remove Dead Read in DatabaseViewer

**File:** `src/lib/components/viewers/DatabaseViewer.svelte`

Remove: `const data = await adapter.read(tab.path);` — the DuckDB file is loaded via httpfs, not via adapter download.

### Step 4.4: Guard Stale State Writes

**File:** `src/lib/components/viewers/TableViewer.svelte`

Change the `getRowCount` catch handler:
```ts
.catch(() => {
  if (thisGen === loadGeneration) loadStage = '';
});
```

**Dependencies:** None. Independent of other phases.

---

## Phase 5: CogViewer and GeoParquet Cleanup

**Goal:** Fix module-level reference leaks in map viewers.

### Step 5.1: CogViewer GeoTIFF Cleanup

**File:** `src/lib/components/viewers/CogViewer.svelte`

Add to `cleanup()`:
```ts
capturedV2Geotiff = null;
currentV3Tiff = null;
```

Also zero out canvas dimensions after `toDataURL()`:
```ts
canvas.width = 0;
canvas.height = 0;
```

### Step 5.2: GeoParquetMapViewer WKB Cleanup

**File:** `src/lib/components/viewers/GeoParquetMapViewer.svelte`

Add to `cleanup()`:
```ts
wkbArraysRef = [];
```

**Dependencies:** None.

---

## Phase 6: Adapter Caching and Request Limiting

**Goal:** Reduce redundant object creation and limit concurrent requests.

### Step 6.1: Cache Adapter Instances

**File:** `src/lib/storage/index.ts`

```ts
const adapterCache = new Map<string, StorageAdapter>();

export function getAdapter(source: 'remote' | 'url', connectionId?: string): StorageAdapter {
  if (source === 'url') return new UrlAdapter(); // stateless, no cache needed

  const key = `${source}:${connectionId}`;
  let adapter = adapterCache.get(key);
  if (!adapter) {
    // ... create adapter ...
    adapterCache.set(key, adapter);
  }
  return adapter;
}

// Call on connection delete/update
export function clearAdapterCache(connectionId: string) {
  adapterCache.delete(`remote:${connectionId}`);
}
```

### Step 6.2: Cache AwsClient in BrowserCloudAdapter

**File:** `src/lib/storage/browser-cloud.ts`

Move `createFetcher()` from per-method to constructor or lazy-init:
```ts
private _fetcher: ((url: string, init?: RequestInit) => Promise<Response>) | null = null;

private getFetcher(): (url: string, init?: RequestInit) => Promise<Response> {
  if (!this._fetcher) {
    this._fetcher = createFetcher(this.getConnection());
  }
  return this._fetcher;
}
```

**Note:** Credentials may change — invalidate cache on credential update.

### Step 6.3: Add Concurrent Request Limiter (Optional)

**New file:** `src/lib/utils/fetch-pool.ts`

Simple semaphore limiting to 6 concurrent fetches. Wrap `adapter.read()` calls.

**Dependencies:** Phase 1 (for signal support integration).

---

## Phase 7: Minor Fixes

### Step 7.1: Mermaid Init-Once Guard

**File:** `src/lib/components/viewers/MarkdownViewer.svelte`

```ts
let mermaidReady = false;
async function ensureMermaidInit() {
  if (mermaidReady) return (await import('mermaid')).default;
  const mermaid = (await import('mermaid')).default;
  mermaid.initialize({ startOnLoad: false, ... });
  mermaidReady = true;
  return mermaid;
}
```

### Step 7.2: DuckDB Worker Blob URL Revocation

**File:** `src/lib/query/wasm.ts`

After `new Worker(workerUrl)`, add:
```ts
URL.revokeObjectURL(workerUrl);
```

### Step 7.3: `tabViewModes` Cleanup

**File:** `src/routes/+page.svelte`

Delete entries from `tabViewModes` Map when tabs are closed.

### Step 7.4: TableGrid Resize Listener Cleanup

**File:** `src/lib/components/viewers/TableGrid.svelte`

Track active resize listeners and clean up on destroy:
```ts
let resizeCleanup: (() => void) | null = null;

function startResize(col: string, e: MouseEvent) {
  // ... existing code ...
  resizeCleanup = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };
  // ...
}

onDestroy(() => resizeCleanup?.());
```

### Step 7.5: `testWithConfig` — Don't Persist Temp Connection

**File:** `src/lib/stores/connections.svelte.ts`

Keep temp connection in-memory only during test. Don't call `persistToLocalStorage()` for the temp addition.

**Dependencies:** None.

---

## File Dependency Graph

```
Phase 1: adapter.ts → browser-cloud.ts, browser-azure.ts, url-adapter.ts
            ↓
Phase 2: All viewers (depend on Phase 1 for signal param)
            ↓
Phase 6: index.ts, browser-cloud.ts (adapter caching, depends on Phase 1)

Phase 3: Independent — $state.raw migration
Phase 4: Independent — DuckDB query split
Phase 5: Independent — viewer cleanup fixes
Phase 7: Independent — minor fixes
```

Phases 3, 4, 5, 7 can all be executed in parallel.
Phases 1 → 2 → 6 must be sequential.
