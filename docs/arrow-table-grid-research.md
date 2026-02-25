# Arrow-Native Table/Grid Libraries Research

> Research date: 2026-02-25
> Context: objex SvelteKit app with DuckDB-WASM, Apache Arrow v21, Vite 7, Svelte 5 runes

## Current State in objex

The existing `TableGrid.svelte` uses a custom virtual-scroll implementation over `Record<string, any>[]` rows. In `TableViewer.svelte`, the DuckDB-WASM query engine returns `QueryResult.rows` (pre-parsed JS objects) or falls back to `tableFromIPC()` + `table.toArray().map(row => row.toJSON())`. This means **every cell** is materialized as a JS property on a JS object — the worst-case for memory and GC pressure on large datasets.

The goal: find a grid component that can consume an Arrow `Table` (or Arrow IPC bytes) directly, keeping data in columnar typed arrays, and only converting individual cells to display strings on-demand during rendering.

---

## 1. Perspective (FINOS / JP Morgan)

**Website:** https://perspective.finos.org/
**GitHub:** https://github.com/finos/perspective
**npm:** `@finos/perspective`, `@finos/perspective-viewer`, `@finos/perspective-viewer-datagrid`
**Latest:** v3.8.0 (Dec 2025)
**License:** Apache 2.0
**Weekly downloads:** ~5,000 (perspective-viewer)

### Arrow Support
- **Native Arrow ingestion** — `perspective.table(arrowIpcBytes)` accepts Arrow IPC directly. The C++/Rust engine compiled to WASM consumes Arrow natively — this is true zero-copy at the engine level.
- `table.update(arrowBytes)` for streaming updates.
- `table.view().to_arrow()` returns Arrow IPC bytes.
- The engine does its own columnar processing; you never convert rows to JS objects.

### Architecture
- WASM engine (C++/Rust compiled) runs in a Web Worker.
- `<perspective-viewer>` Custom Element wraps the engine + UI.
- `@finos/perspective-viewer-datagrid` is the table plugin, built on `regular-table` (a lightweight virtual-scroll `<table>` library, also from FINOS).
- Framework-agnostic: Custom Elements work in Svelte, React, Vue, plain HTML.

### Features
| Feature | Status |
|---------|--------|
| Virtual scroll (rows + columns) | Yes — `regular-table` handles 2B+ rows |
| Column resize | Yes (drag handle on header) |
| Column sort | Yes (click header) |
| Column filter | Yes (filter UI panel) |
| Group by / Pivot | Yes |
| Right-click context menu / copy | **Limited** — no built-in cell/row/column copy context menu. Would need custom code on top of `regular-table` events. |
| Expression columns | Yes (ExprTK-based) |
| Charts | Yes (D3FC plugin) |

### Bundle Size
- **Total loaded assets: ~6–8 MB** (WASM binary + worker + viewer + datagrid + D3FC chart plugin).
- With webpack/esbuild plugin: WASM served as separate `.wasm` file (~4 MB), rest ~2–3 MB JS.
- Without plugin (inlined): same total, but JS file is ~500 KB larger due to base64 WASM encoding.
- `@finos/perspective-viewer-datagrid` alone: ~1.17 MB (npm).

### Vite / SvelteKit Compatibility
- **Problematic.** There is no official Vite plugin (open issue [#1734](https://github.com/finos/perspective/issues/1734) since 2022, still unresolved).
- Has `@finos/perspective-esbuild-plugin` (esbuild ≠ Vite production build which uses Rollup).
- Perspective 3.x uses top-level `await` — requires `build.target: 'es2022'` in Vite config.
- Known build failures with Vite reported as recently as 2024 ([#2795](https://github.com/finos/perspective/issues/2795)).
- **Workaround**: load Perspective from CDN (`<script>` tag or dynamic `import()` from jsdelivr), bypassing the bundler entirely. Or use the esbuild plugin with custom Vite config.
- Being a Custom Element, it works in Svelte with `<perspective-viewer>` directly — no adapter needed.

### Verdict
**Best Arrow-native option**, but the massive bundle size and Vite integration pain are significant drawbacks. The lack of a built-in context menu for copy is also a gap.

---

## 2. regular-table (FINOS)

**GitHub:** https://github.com/finos/regular-table
**npm:** `regular-table`
**License:** Apache 2.0

### What It Is
A low-level virtual-scrolling `<table>` library that renders only visible cells. It's the rendering engine underneath Perspective's datagrid plugin, but usable standalone.

### Arrow Support
- **Not built-in**, but designed for it. You provide a `DataListener` callback: `(x0, y0, x1, y1) => { columns, data }`. The callback can read directly from Arrow column vectors without row conversion.
- Pattern: `arrowTable.getChildAt(colIdx).get(rowIdx)` inside the data listener — per-cell access from columnar arrays.

### Features
| Feature | Status |
|---------|--------|
| Virtual scroll (both axes) | Yes — tested at 2B rows x 1K columns |
| Column resize | Manual via CSS/JS — not built-in |
| Column sort | Manual — you handle it in DataListener |
| Context menu / copy | Manual — standard DOM events |

### Bundle Size
- **~30–50 KB** min+gzip (no dependencies). Extremely lightweight.

### Svelte Compatibility
- Custom Element — works anywhere. Zero framework dependencies.

### Verdict
**The "build your own" foundation.** You'd wire Arrow column access into the DataListener, then build sort/resize/context-menu yourself. High effort, maximum control, tiny bundle. Could be a good option if you want to keep the current custom approach but make it Arrow-native.

---

## 3. AG Grid

**Website:** https://www.ag-grid.com/
**npm:** `ag-grid-community` (MIT), `ag-grid-enterprise` (commercial)
**Svelte 5 wrappers:** `ag-grid-svelte5-extended` (community), `ag-grid-svelte5` (community)

### Arrow Support
- **No native Arrow support.** AG Grid expects row-based data: `rowData: any[]` where each item is a JS object. There is no columnar or Arrow data model.
- To use with DuckDB-WASM Arrow output, you'd still need `table.toArray().map(r => r.toJSON())` — the exact conversion we're trying to avoid.
- The Server-Side Row Model (SSRM) could lazily fetch pages and convert per-page, but the conversion overhead remains per-row.

### Features
| Feature | Status |
|---------|--------|
| Virtual scroll | Yes — DOM virtualization for rows + columns |
| Column resize | Yes (built-in, drag handle) |
| Column sort | Yes (built-in, click header) |
| Context menu + clipboard copy | **Enterprise only** — Community has no built-in context menu. You can build custom. |
| Column filter | Community: basic. Enterprise: advanced. |

### Bundle Size
- Community: ~200–300 KB min+gzip (modular in v33, 20–40% smaller with tree-shaking).
- Enterprise: ~500+ KB min+gzip.

### Svelte 5 Compatibility
- Community wrappers exist: [`ag-grid-svelte5-extended`](https://github.com/bn-l/ag-grid-svelte5-extended) with runes support and Svelte component cell renderers.
- Not official — community maintained, may lag AG Grid releases.

### Verdict
**Excellent feature set, zero Arrow support.** Using it means accepting full row materialization. The Enterprise paywall for context menu/clipboard is also a concern. Not recommended for Arrow-native goals.

---

## 4. TanStack Table + TanStack Virtual

**Website:** https://tanstack.com/table/latest
**npm:** `@tanstack/svelte-table`, `@tanstack/svelte-virtual`
**License:** MIT

### Arrow Support
- **No native Arrow support**, but the architecture is more flexible than AG Grid.
- `accessorFn` on column definitions lets you provide a custom function: `(row, index) => value`. The "row" type is generic — your `TData` could be the Arrow Table itself, with `accessorFn: (_row, index) => arrowColumn.get(index)`.
- However, TanStack Table fundamentally assumes `data: TData[]` — a **row-indexed array**. You'd need to create a proxy array of length `N` where each element is either a dummy or a lightweight proxy.
- Virtual scrolling via `@tanstack/svelte-virtual` works independently.

### Possible Arrow Integration Pattern
```typescript
// Create a "fake" row array of length N for TanStack
const rowProxy = Array.from({ length: arrowTable.numRows }, (_, i) => i);

// Column defs access Arrow columns directly
const columns = arrowTable.schema.fields.map((field, colIdx) => ({
  id: field.name,
  header: field.name,
  accessorFn: (_rowIdx: number, rowIndex: number) => {
    return arrowTable.getChildAt(colIdx)?.get(rowIndex);
  }
}));
```
This avoids row-object creation but still has overhead: TanStack creates internal row model objects per visible row, and the proxy array allocation for millions of rows is not free (~8 bytes per pointer for 1M rows = 8 MB).

### Features
| Feature | Status |
|---------|--------|
| Virtual scroll | Yes (via @tanstack/svelte-virtual) |
| Column resize | Yes (built-in, header drag) |
| Column sort | Yes (built-in) |
| Context menu / copy | Manual — not built-in |
| Column filter | Yes (built-in) |

### Bundle Size
- `@tanstack/svelte-table`: ~30 KB min+gzip (headless, no DOM).
- `@tanstack/svelte-virtual`: ~5 KB min+gzip.
- Total: ~35 KB + your own CSS/markup.

### Svelte 5 Compatibility
- Official Svelte adapter exists. Known issue: [#866](https://github.com/TanStack/virtual/issues/866) tracks Svelte 5 support — resolved in recent versions.
- Headless architecture means full control over markup — works naturally with Tailwind.

### Verdict
**Best DX for Svelte, but Arrow integration is a workaround, not native.** The accessor pattern avoids `toJSON()` per row but still requires a dummy array and TanStack's internal row model overhead. Good middle ground if you want rich features without a massive bundle.

---

## 5. Tabulator

**Website:** https://tabulator.info/
**License:** MIT
**Svelte docs:** https://tabulator.info/docs/6.3/svelte

### Arrow Support
- **None.** Expects row arrays/objects, JSON, or AJAX endpoints.

### Features
| Feature | Status |
|---------|--------|
| Virtual DOM rendering | Yes |
| Column resize | Yes |
| Column sort | Yes |
| Context menu / copy | Clipboard module built-in |
| Column filter | Yes |

### Bundle Size
- ~80–100 KB min+gzip.

### Svelte Compatibility
- Works via `onMount` wrapper. Not Svelte 5 runes-native.

### Verdict
Feature-rich and MIT, but no Arrow path. Similar trade-off to AG Grid Community but with clipboard built in and smaller bundle. Still requires full row conversion.

---

## 6. Custom Arrow-Native Grid (DIY on `regular-table` or raw DOM)

### Architecture
Build a thin wrapper that:
1. Takes an Arrow `Table` (or IPC bytes) as input.
2. Uses columnar access: `table.getChildAt(colIdx).get(rowIdx)` for on-demand cell rendering.
3. Uses virtual scrolling (either `regular-table` or your own, similar to current `TableGrid.svelte`).
4. Sort: send `ORDER BY` to DuckDB-WASM, get new Arrow result (no client-side sort needed).
5. Column resize: CSS resize handles (already have some infra for this).
6. Context menu: custom `contextmenu` event handler.

### Arrow Column Access Performance
Apache Arrow JS provides O(1) random access per cell:
```typescript
const col = table.getChildAt(colIdx);    // Vector<T>
const val = col.get(rowIdx);              // typed access, no object allocation
```
For the visible viewport (~50 rows x ~20 cols = 1,000 cells), this is 1,000 typed-array lookups — negligible cost.

### Integration with Current DuckDB-WASM Setup
The `QueryResult.arrowBytes` is already available. Instead of:
```typescript
const table = tableFromIPC(result.arrowBytes);
rows = table.toArray().map((row: any) => row.toJSON()); // O(N*M) allocations
```
Do:
```typescript
const table = tableFromIPC(result.arrowBytes);
// Pass table directly to grid — no row conversion
```

### Estimated Effort
- Modify `TableGrid.svelte` to accept `Arrow.Table` instead of `rows: Record<string, any>[]`.
- Replace row-based iteration with columnar cell access.
- Add column resize drag handles (~100 lines).
- Add context menu (~150 lines).
- ~1–2 days of work. No new dependencies.

---

## Comparison Matrix

| Library | Arrow Zero-Copy | Bundle Size | Svelte 5 | Virtual Scroll | Col Resize | Col Sort | Context Menu / Copy | License | Vite Compat |
|---------|----------------|-------------|----------|---------------|------------|----------|-------------------|---------|-------------|
| **Perspective** | **Native** (WASM engine) | ~6–8 MB total | Custom Element (works) | 2B+ rows | Yes | Yes | No (manual) | Apache 2.0 | **Poor** (no Vite plugin) |
| **regular-table** | Via DataListener | ~30–50 KB | Custom Element | 2B+ rows | Manual | Manual | Manual | Apache 2.0 | Good |
| **AG Grid Community** | None | ~200–300 KB | Community wrapper | Yes | Yes | Yes | **Enterprise only** | MIT | Good |
| **TanStack Table** | Partial (accessorFn hack) | ~35 KB | Official adapter | Yes | Yes | Yes | Manual | MIT | Good |
| **Tabulator** | None | ~80–100 KB | onMount wrapper | Yes | Yes | Yes | Built-in | MIT | Good |
| **Custom (DIY)** | **Full** (columnar access) | 0 KB (no dep) | Native Svelte 5 | Current impl | Manual | DuckDB ORDER BY | Manual | N/A | N/A |

---

## 7. Quak (manzt/quak) — investigated in detail

**GitHub:** https://github.com/manzt/quak
**Demo:** https://manzt.github.io/quak
**License:** MIT
**Tech stack:** TypeScript, @uwdata/mosaic-core, @uwdata/mosaic-sql, @uwdata/flechette (Arrow), @preact/signals-core, htl

### How It Works (source code analysis)

Quak's `DataTable` extends Mosaic's `MosaicClient`. Key architectural patterns:

1. **Append-on-scroll** (NOT virtual scroll): Rows are appended to the real DOM as the user scrolls down. When `scrollHeight - scrollTop < rows * rowHeight * 1.5`, the next batch is loaded. No spacer `<tr>` hacks, no placeholder divs. This gives natural, smooth scrolling.

2. **Batch loading via Mosaic coordinator**: Calls `this.requestQuery(query)` to fetch next batch from DuckDB, with `coordinator.prefetch()` for the batch after that. Batches arrive as `flech.Table` (flechette Arrow tables).

3. **Row rendering**: Uses `HTMLTableRowElement.cloneNode(true)` from a template row, then fills `td.textContent` directly. No framework overhead per row — raw DOM manipulation.

4. **Column resize**: Each `<th>` has a `.resize-handle` div. Mousedown → track `clientX` delta → update `th.style.width` via preact signals. Double-click resets to default width. Min width = 125px.

5. **Sort**: Click header cycles `unset → asc → desc → unset`. Sort sends new SQL `ORDER BY` to DuckDB via Mosaic coordinator (server-side sort, not client-side).

6. **Column summaries**: Each column header has a mini histogram (numeric/date) or value-counts bar chart (categorical). These are separate Mosaic clients connected to the coordinator.

7. **Shadow DOM**: Uses Shadow DOM for style isolation. Custom CSS with CSS variables.

8. **Directional scroll**: Custom wheel event handler that separates horizontal vs vertical scroll to prevent diagonal drift.

9. **Status bar**: Shows "N of M rows" with filtered count.

### Why We Can't Use Quak Directly

- **Tightly coupled to Mosaic coordinator** — the DataTable IS a `MosaicClient`. It doesn't accept raw data; it queries through the coordinator.
- **Uses @preact/signals-core** for reactivity — conflicts with Svelte 5 runes.
- **Uses htl** (Hypertext Literal) for DOM creation — different paradigm from Svelte templates.
- **Shadow DOM** — makes styling integration with Tailwind/app theme difficult.
- **No context menu / clipboard** — not built in.

### What We Should Adopt from Quak

1. **Append-on-scroll pattern** — eliminates the spacer row / min-height hack causing the infinite scroll bug
2. **Column resize with drag handles** — the exact implementation pattern (mousedown → track delta → update width)
3. **Directional scroll** — separate horizontal vs vertical wheel handling
4. **Row height = 22px**, column width = 125px defaults
5. **template row cloning** — for batch DOM operations (though Svelte's `{#each}` is already efficient)
6. **Sort cycling: unset → asc → desc → unset** — already have this
7. **Type display** — gray subtext showing data type under column name

---

## Recommendations

### FINAL DECISION: Option A — Rewrite Custom Grid (quak-inspired)

**Why:** Zero new dependencies, native Svelte 5, quak-proven UX patterns, fixes the scroll bug.

---

## Detailed Implementation Plan

### Bug Fix: Infinite Scroll

**Root cause:** Current `TableGrid.svelte` uses virtual scrolling with:
- `<div style="min-height: {totalHeight + ROW_HEIGHT}px">` — creates oversized scroll container
- Spacer `<tr>` elements above/below visible rows
- On trackpad momentum scrolling, user flies past content into empty spacer space

**Fix:** Replace virtual scroll with append-on-scroll (quak pattern):
- Render first 100 rows immediately
- On scroll near bottom (`scrollHeight - scrollTop < clientHeight * 1.5`), append next batch
- No spacer elements, no min-height hacks — just a real `<table>` that grows

### Files to Modify

#### 1. `src/lib/components/viewers/TableGrid.svelte` — FULL REWRITE

```svelte
<script lang="ts">
// Props (same interface as current, backward compatible)
let {
  columns, rows, totalRows = 0, columnTypes = {},
  sortColumn = null, sortDirection = null, onSort
} = $props();

// ── Progressive rendering ──
const INITIAL_ROWS = 100;
const BATCH_SIZE = 100;
let renderedCount = $state(0);
let containerEl: HTMLDivElement | undefined = $state();

// Reset on data change
$effect(() => { rows; renderedCount = Math.min(INITIAL_ROWS, rows.length); });

const displayRows = $derived(rows.slice(0, renderedCount));

function onScroll(e: Event) {
  const el = e.target as HTMLDivElement;
  if (renderedCount < rows.length && el.scrollHeight - el.scrollTop < el.clientHeight * 2) {
    renderedCount = Math.min(renderedCount + BATCH_SIZE, rows.length);
  }
}

// ── Resizable columns ──
const DEFAULT_WIDTH = 150;
const MIN_WIDTH = 60;
let columnWidths = $state<Record<string, number>>({});

function startResize(col: string, e: MouseEvent) {
  e.preventDefault(); e.stopPropagation();
  const startX = e.clientX;
  const startW = columnWidths[col] || DEFAULT_WIDTH;
  function onMove(ev: MouseEvent) { columnWidths[col] = Math.max(MIN_WIDTH, startW + ev.clientX - startX); }
  function onUp() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// ── Right-click context menu ──
let ctxMenu = $state<{ x: number; y: number; value: string; rowData: Record<string,any>; colName: string } | null>(null);

function handleContextMenu(e: MouseEvent, value: any, row: Record<string,any>, col: string) {
  e.preventDefault();
  ctxMenu = { x: e.clientX, y: e.clientY, value: formatCell(value, columnCategories[col]), rowData: row, colName: col };
}

async function copyToClipboard(text: string) { await navigator.clipboard.writeText(text); ctxMenu = null; }
async function copyCell() { if (ctxMenu) await copyToClipboard(ctxMenu.value); }
async function copyRow() { if (ctxMenu) await copyToClipboard(JSON.stringify(ctxMenu.rowData, null, 2)); }
async function copyColumn() {
  if (!ctxMenu) return;
  const col = ctxMenu.colName;
  await copyToClipboard(rows.map(r => r[col] == null ? 'NULL' : String(r[col])).join('\n'));
}

// ── Sort (existing logic, unchanged) ──
function handleHeaderClick(col: string) { /* same cycling logic */ }

// ── Cell formatting (existing, unchanged) ──
function formatCell(value: any, category: TypeCategory): string { /* same */ }
</script>

<!-- Close context menu on outside click -->
<svelte:window onclick={() => ctxMenu = null} />

<div bind:this={containerEl} class="flex-1 overflow-auto" onscroll={onScroll}>
  <table style="table-layout: fixed; width: {50 + columns.reduce((s, c) => s + (columnWidths[c] || DEFAULT_WIDTH), 0)}px;">
    <colgroup>
      <col style="width: 50px" />
      {#each columns as col}
        <col style="width: {columnWidths[col] || DEFAULT_WIDTH}px" />
      {/each}
    </colgroup>
    <thead class="sticky top-0 z-10">
      <tr>
        <th class="...">#</th>
        {#each columns as col}
          <th class="group relative ..." onclick={() => handleHeaderClick(col)}>
            <div class="flex items-center gap-1.5">
              <span class="type-badge">{typeLabel(category)}</span>
              <span class="truncate">{col}</span>
              <!-- sort indicator -->
            </div>
            <div class="text-[11px] text-muted-foreground">{columnTypes[col]}</div>
            <!-- RESIZE HANDLE -->
            <div
              class="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-400"
              onmousedown={(e) => startResize(col, e)}
              role="separator"
            ></div>
          </th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each displayRows as row, i}
        <tr class="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
          <td class="text-muted-foreground">{i + 1}</td>
          {#each columns as col}
            <td oncontextmenu={(e) => handleContextMenu(e, row[col], row, col)}>
              {formatCell(row[col], columnCategories[col])}
            </td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<!-- Context menu portal -->
{#if ctxMenu}
  <div class="fixed z-50 rounded border shadow-lg ..." style="left:{ctxMenu.x}px;top:{ctxMenu.y}px">
    <button onclick={copyCell}>Copy Cell</button>
    <button onclick={copyRow}>Copy Row (JSON)</button>
    <button onclick={copyColumn}>Copy Column</button>
  </div>
{/if}
```

#### 2. `src/lib/i18n/en.ts` — Add context menu keys

```typescript
'table.copyCell': 'Copy Cell',
'table.copyRow': 'Copy Row (JSON)',
'table.copyColumn': 'Copy Column',
```

#### 3. `src/lib/i18n/ar.ts` — Arabic translations

```typescript
'table.copyCell': 'نسخ الخلية',
'table.copyRow': 'نسخ الصف (JSON)',
'table.copyColumn': 'نسخ العمود',
```

#### 4. `src/lib/components/viewers/TableViewer.svelte` — No changes needed

The existing `rows: Record<string, any>[]` interface stays. The grid rewrite is internal only.

### Style Changes

| Aspect | Before | After |
|--------|--------|-------|
| Data font | `text-xs` (12px) | `text-[13px]` |
| Row height | 32px | 28px (denser, like quak) |
| Header | Single line with type badge | Column name + type name below |
| Column width | Fixed max-width 300px | Resizable, default 150px, min 60px |
| Null values | Styled badge | Gray italic text (quak style) |
| Scroll | Virtual with spacer hacks | Append-on-scroll (quak pattern) |
| Context menu | None | Copy cell/row/column |

### Phase 2 (Future): Arrow Zero-Copy

Once the grid rewrite is stable, optionally:
1. Pass `arrowBytes` from `executeQuery()` to TableGrid
2. Use `tableFromIPC(arrowBytes)` inside the grid
3. Access cells via `table.getChildAt(colIdx).get(rowIdx)`
4. Only materialize visible cells to strings
5. Saves ~10x memory for large result sets

This is a separate PR — the grid rewrite (Phase 1) keeps the existing `rows[]` interface.

---

## Sources

- [Perspective FINOS — JS docs](https://perspective.finos.org/guide/explanation/javascript.html)
- [Perspective GitHub](https://github.com/finos/perspective)
- [Perspective 3.0.0 announcement](https://github.com/finos/perspective/discussions/2716)
- [Perspective Vite plugin issue #1734](https://github.com/finos/perspective/issues/1734)
- [Perspective build failure #2795](https://github.com/finos/perspective/issues/2795)
- [@finos/perspective-esbuild-plugin](https://www.npmjs.com/package/@finos/perspective-esbuild-plugin)
- [@finos/perspective-viewer-datagrid](https://www.npmjs.com/package/@finos/perspective-viewer-datagrid)
- [regular-table GitHub](https://github.com/finos/regular-table)
- [regular-table 2B rows example](https://github.com/finos/regular-table/blob/master/examples/two_billion_rows.md)
- [Glide Data Grid GitHub (React-only)](https://github.com/glideapps/glide-data-grid)
- [AG Grid Community npm](https://www.npmjs.com/package/ag-grid-community)
- [AG Grid bundle size optimization](https://blog.ag-grid.com/minimising-bundle-size/)
- [AG Grid context menu (Enterprise)](https://www.ag-grid.com/javascript-data-grid/context-menu/)
- [AG Grid clipboard (Enterprise)](https://www.ag-grid.com/javascript-data-grid/clipboard/)
- [ag-grid-svelte5-extended](https://github.com/bn-l/ag-grid-svelte5-extended)
- [TanStack Table docs](https://tanstack.com/table/latest)
- [TanStack Virtual Svelte example](https://tanstack.com/virtual/v3/docs/framework/svelte/examples/table)
- [TanStack Virtual Svelte 5 issue #866](https://github.com/TanStack/virtual/issues/866)
- [TanStack Table column defs](https://tanstack.com/table/v8/docs/guide/column-defs)
- [Tabulator Svelte docs](https://tabulator.info/docs/6.3/svelte)
- [DuckDB Arrow zero-copy integration](https://duckdb.org/2021/12/03/duck-arrow)
- [DuckDB-WASM query docs](https://duckdb.org/docs/stable/clients/wasm/query)
- [Zero-copy Arrow with WASM (Kyle Barron)](https://observablehq.com/@kylebarron/zero-copy-apache-arrow-with-webassembly)
- [arrow-js-ffi (zero-copy Arrow from WASM)](https://github.com/kylebarron/arrow-js-ffi)
- [Apache Arrow JS docs](https://arrow.apache.org/docs/js/)
- [Arquero + Arrow integration](https://observablehq.com/@uwdata/arquero-and-apache-arrow)
- [Custom AG Grid context menu (Community workaround)](https://blog.cuso45.com/posts/ag-grid-custom-context-menu/)
- [Motif Analytics: DuckDB + Arrow + Web Workers](https://motifanalytics.medium.com/my-browser-wasmt-prepared-for-this-using-duckdb-apache-arrow-and-web-workers-in-real-life-e3dd4695623d)
