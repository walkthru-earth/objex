# UI/UX, Responsive, Mobile & Performance Improvement Plan

## Current State Summary

The app has a solid foundation: Svelte 5 runes, shadcn-svelte UI primitives, a single 640px breakpoint (mobile sheet vs desktop resizable panes), and per-viewer local state. But there are systemic issues:

- **No shared loading/error UI** — each viewer reinvents its own
- **No tab lifecycle management** — tabs mount/unmount but don't clean up resources deterministically
- **Memory grows unbounded** with many open tabs (DuckDB results, map instances, WKB arrays stay in memory)
- **Heavy deps loaded eagerly** — MapLibre, deck.gl, Babylon.js imported statically in ViewerRouter
- **Single breakpoint** — no tablet optimization, no landscape mobile handling
- **Inconsistent toolbars** — TableToolbar is responsive, map viewers use ad-hoc floating UI

---

## Phase 1: Tab Lifecycle & Memory Management

> **Goal**: Tabs can be opened/closed safely without leaking memory. Many-tab scenarios stay performant.

### 1.1 — Tab resource registry

Create a central cleanup registry so viewers register disposables and the tab store can clean them up deterministically on close.

```
src/lib/stores/tab-resources.svelte.ts
```

**Design:**
```ts
// Each viewer registers cleanup callbacks when it mounts
interface TabResources {
  register(tabId: string, cleanup: () => void | Promise<void>): void;
  dispose(tabId: string): Promise<void>;
  disposeAll(): Promise<void>;
}
```

- Viewers call `tabResources.register(tab.id, () => { map.remove(); abortController.abort(); })` in their mount logic
- `tabs.close(id)` calls `await tabResources.dispose(id)` **before** removing the tab from the array
- `tabs.closeOthers(id)` disposes all except the kept tab
- Replace the current fire-and-forget DuckDB cleanup with a registered disposable

### 1.2 — Lazy viewer mounting (keep-alive vs destroy)

Currently, switching tabs unmounts the old viewer and remounts the new one. This means:
- Switching back to a table re-runs the entire DuckDB query
- Map viewers re-initialize MapLibre + deck.gl from scratch
- CogViewer re-fetches and re-parses the GeoTIFF

**Options (choose one):**

**A. Cache last N viewers (recommended)**
- Keep the last 3-5 viewer DOM trees alive but hidden (`display: none`)
- Viewers beyond the cache limit get unmounted and cleaned up via the resource registry
- Active viewer gets `display: block`
- Saves re-query cost for recently-viewed tabs

**B. Cache query results only**
- Unmount viewers on tab switch (current behavior)
- Cache the last N query results (rows, schema, mapData) in a `Map<tabId, CachedResult>`
- Viewer mounts, checks cache → skips query if hit
- Lighter than option A (no hidden DOM) but map viewers still re-init

**Recommendation**: Start with **B** (result caching) — it's simpler, avoids hidden-DOM complexity, and addresses the main pain point (re-querying). Revisit A later if map re-init is too slow.

### 1.3 — Tab limit & warnings

- Set a soft limit (e.g., 20 tabs). Show a warning badge on the tab bar when exceeded.
- Offer "Close all to the right" and "Close saved" (non-dirty) bulk actions in tab context menu.
- Show memory pressure indicator in StatusBar (if `performance.memory` is available — Chrome only).

### 1.4 — DuckDB connection pooling

Currently there's a single shared DuckDB instance. The `releaseMemory()` call in `tabs.close()` is a blunt instrument — it affects all tabs, not just the closed one.

**Improvement:**
- Track which file URLs are actively used by open tabs
- On tab close, if no other tab uses the same file URL, run `DETACH` or drop cached file references
- `releaseMemory()` only when tab count drops to 0

---

## Phase 2: Shared UI Components

> **Goal**: Eliminate per-viewer boilerplate. Consistent loading, error, and toolbar patterns.

### 2.1 — `<ViewerShell>` wrapper component

A shared wrapper that every viewer uses:

```svelte
<ViewerShell {tab} {loading} {error} {loadStage} {loadDetails}>
  <!-- viewer content -->
</ViewerShell>
```

**Provides:**
- Centered loading spinner with optional stage text and detail list
- Cancel button (calls provided `onCancel` callback)
- Error display (centered for blocking errors, toast for non-blocking)
- Registers tab resource cleanup on mount
- Consistent padding/overflow behavior

### 2.2 — `<FloatingToolbar>` for map viewers

Unify the ad-hoc floating UI across CogViewer, PmtilesViewer, FlatGeobufViewer:

```svelte
<FloatingToolbar position="top-left | top-right | bottom-left | bottom-right">
  <FloatingToolbar.Badge>{featureCount} features</FloatingToolbar.Badge>
  <FloatingToolbar.Button onclick={toggleInfo}>
    <InfoIcon />
  </FloatingToolbar.Button>
</FloatingToolbar>
```

**Consistent:**
- Glass-morphism background (`bg-card/80 backdrop-blur-sm`)
- Consistent spacing, icon sizing, dark mode colors
- Touch-friendly hit targets (min 44x44px)

### 2.3 — `<MapContainer>` improvements

The shared MapContainer should handle:
- Basemap initialization (light/dark based on theme)
- Theme switching (re-style map when dark mode toggles)
- Navigation controls placement (responsive: bottom-right on desktop, bottom-center on mobile)
- Attribution collapse on mobile
- RTL support for map controls

### 2.4 — Unified toolbar pattern

| Viewer type | Toolbar | Mobile behavior |
|---|---|---|
| Tabular (TableViewer, DatabaseViewer) | Horizontal bar (top) | Overflow → dropdown menu |
| Map (COG, PMTiles, FGB, GeoParquet) | Floating panels | Stack vertically, smaller badges |
| Document (Code, Markdown, PDF) | Minimal bar or none | As-is |
| Media (Image, Video, Audio) | Horizontal bar (top) | Overflow → ellipsis menu (already done for ImageViewer) |

---

## Phase 3: Responsive & Mobile

> **Goal**: Usable on phones (360px+), optimized for tablets (768px+), polished on desktop.

### 3.1 — Breakpoint strategy

Currently: single breakpoint at 640px. Add intermediate breakpoints:

| Breakpoint | Target | Layout changes |
|---|---|---|
| < 640px (`default`) | Phone portrait | Sheet sidebar, single-column, compact toolbars |
| ≥ 640px (`sm:`) | Phone landscape / small tablet | Current desktop layout (keep as-is) |
| ≥ 768px (`md:`) | Tablet portrait | Wider sidebar pane (25%), better tab sizing |
| ≥ 1024px (`lg:`) | Tablet landscape / laptop | Full layout, schema panel inline |
| ≥ 1280px (`xl:`) | Desktop | Max content width, comfortable spacing |

### 3.2 — Mobile-specific improvements

**Tab bar:**
- Swipe-to-close tabs (pointer events, horizontal swipe gesture)
- Active tab indicator more prominent (full bottom border, not just 2px)
- Tab names: dynamic truncation based on available width (not fixed 120px)
- On mobile (< 640px): show only active tab name + count badge ("3 tabs"), tap to show tab list as dropdown

**Table viewer on mobile:**
- Horizontal scroll for table grid (already works but add scroll hint shadow on edges)
- Card view option: instead of table rows, show each record as a card (key-value pairs) — toggle in toolbar
- Sticky first column option for wide tables
- Pinch-to-zoom on table (optional, may conflict with browser zoom)

**Map viewers on mobile:**
- Attribute table: bottom sheet (slide-up) instead of side panel
- Feature popup: bottom card instead of tooltip
- Touch gestures: pinch-zoom, two-finger rotate (MapLibre handles this natively)
- Floating toolbar: collapse to single toggle button, expand on tap

**SQL editor on mobile:**
- Collapse by default on mobile (show "Edit SQL" toggle)
- Full-screen modal when editing (better keyboard experience)
- Larger touch targets for Run/Format buttons

### 3.3 — Safe areas & viewport

```css
/* Handle notch/dynamic island on iOS */
padding-top: env(safe-area-inset-top);
padding-bottom: env(safe-area-inset-bottom);

/* Prevent iOS Safari address bar resize jank */
height: 100dvh; /* dynamic viewport height */
```

Update `+layout.svelte` to use `100dvh` instead of `h-screen` (which uses `100vh` and doesn't account for mobile browser chrome).

### 3.4 — Touch improvements

- Add `touch-action: manipulation` to interactive elements (prevents 300ms tap delay)
- Resizable pane handle: increase touch target to 32px on mobile (currently 20px)
- Long-press on file tree items → context menu (rename, delete, copy URL)
- Swipe-right from left edge → open sidebar sheet (gesture navigation)

---

## Phase 4: Performance

> **Goal**: Fast initial load, smooth interactions, efficient memory usage.

### 4.1 — Lazy-load heavy viewers in ViewerRouter

Currently only CogViewer uses dynamic import. Add lazy loading for all heavy viewers:

```svelte
<!-- ViewerRouter.svelte -->
{#if viewerKind === 'table'}
  <TableViewer {tab} />
{:else if viewerKind === 'pmtiles'}
  {#await import('./PmtilesViewer.svelte') then { default: PmtilesViewer }}
    <PmtilesViewer {tab} />
  {/await}
{:else if viewerKind === 'flatgeobuf'}
  {#await import('./FlatGeobufViewer.svelte') then { default: FlatGeobufViewer }}
    <FlatGeobufViewer {tab} />
  {/await}
{:else if viewerKind === '3d'}
  {#await import('./ModelViewer.svelte') then { default: ModelViewer }}
    <ModelViewer {tab} />
  {/await}
{:else if viewerKind === 'database'}
  {#await import('./DatabaseViewer.svelte') then { default: DatabaseViewer }}
    <DatabaseViewer {tab} />
  {/await}
...
```

**Viewers to lazy-load** (sorted by bundle weight):
1. **ModelViewer** — Babylon.js (~2MB)
2. **PmtilesViewer** — MapLibre + pmtiles
3. **FlatGeobufViewer** — MapLibre + deck.gl + flatgeobuf
4. **DatabaseViewer** — DuckDB-WASM (already loaded if TableViewer was used, but not always)
5. **ZarrViewer** — zarrita + carbonplan/zarr-layer
6. **MarkdownViewer** — Milkdown + Mermaid (already lazy-loads Milkdown internally)

**Keep eagerly loaded** (lightweight):
- TableViewer (most common viewer, DuckDB likely already initialized)
- CodeViewer (Shiki is reasonable size)
- ImageViewer, MediaViewer, RawViewer (tiny, native elements)
- ArchiveViewer (zip.js is moderate)
- PdfViewer (pdf.js is heavy but commonly used — consider lazy if not)

### 4.2 — Code splitting verification

Run `pnpm build` and analyze the chunk output. Verify that lazy-loaded viewers create separate chunks. Add Vite `manualChunks` if needed:

```ts
// vite.config.ts
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        'maplibre': ['maplibre-gl'],
        'deckgl': ['@deck.gl/core', '@deck.gl/layers', '@deck.gl/geo-layers'],
        'babylon': ['@babylonjs/core', '@babylonjs/loaders'],
        'duckdb': ['@duckdb/duckdb-wasm'],
      }
    }
  }
}
```

### 4.3 — Virtual scrolling improvements

TableGrid already has virtual scrolling. Extend to:
- **File tree** — large buckets with 10K+ files should virtualize the tree
- **Archive viewer** — large ZIPs with many entries should virtualize the file list
- **Schema panel** — tables with 500+ columns should virtualize

### 4.4 — Idle tab resource release

When a tab is inactive for > 5 minutes:
- Drop cached query rows (can re-query when tab re-activates)
- Release map instance WebGL context (browsers limit to ~8-16 active contexts)
- Keep lightweight metadata (schema, column names) so toolbar stays populated

Implementation: `requestIdleCallback` + tab activity timestamp tracking.

### 4.5 — Loading performance

- **DuckDB preload**: Start DuckDB initialization on first page load (not on first query). Use `requestIdleCallback` to init during idle time.
- **Parallel metadata reads**: For Parquet files, schema + CRS + row count can be fetched in parallel (partially done already with `getSchemaAndCrs`).
- **Prefetch adjacent files**: When browsing a folder, prefetch schema for the next few Parquet files in the list.

---

## Phase 5: State Management Unification

> **Goal**: Consistent patterns, no hidden dependencies, predictable state flow.

### 5.1 — Extract viewer state machine

Every viewer follows the same lifecycle: `idle → loading → loaded | error`. Extract this:

```ts
// src/lib/stores/viewer-state.svelte.ts
export function createViewerState<T>() {
  let status = $state<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  let data = $state<T | null>(null);
  let error = $state<string | null>(null);
  let loadStage = $state('');
  let loadDetails = $state<string[]>([]);
  let generation = 0;

  return {
    get status() { return status; },
    get data() { return data; },
    get error() { return error; },
    get loadStage() { return loadStage; },
    get loadDetails() { return loadDetails; },

    startLoad(stage?: string) {
      generation++;
      status = 'loading';
      error = null;
      loadStage = stage ?? '';
      loadDetails = [];
      return generation;
    },

    setStage(stage: string, gen: number) {
      if (gen !== generation) return; // stale
      loadStage = stage;
    },

    addDetail(detail: string, gen: number) {
      if (gen !== generation) return;
      loadDetails = [...loadDetails, detail];
    },

    finish(result: T, gen: number) {
      if (gen !== generation) return;
      data = result;
      status = 'loaded';
      loadStage = '';
    },

    fail(err: string, gen: number) {
      if (gen !== generation) return;
      error = err;
      status = 'error';
      loadStage = '';
    },

    cancel() {
      generation++;
      status = 'idle';
      loadStage = '';
    },

    reset() {
      generation++;
      status = 'idle';
      data = null;
      error = null;
      loadStage = '';
      loadDetails = [];
    }
  };
}
```

**Benefits:**
- Replaces 10+ manually-managed `loading`, `error`, `loadStage`, `loadGeneration` variables per viewer
- Built-in stale-load cancellation (generation counter)
- Plugs directly into `<ViewerShell>` for consistent UI

### 5.2 — URL state synchronization

Formalize the URL ↔ component state sync:

```ts
// src/lib/utils/url-sync.svelte.ts
export function createUrlSync(options: {
  getView: () => string;
  setView: (view: string) => void;
  tabId: () => string;
}) {
  // Reads hash on mount, writes hash on view change
  // Clears hash on tab switch (non-initial)
  // Single source of truth pattern
}
```

This replaces the scattered `getUrlView()` / `updateUrlView()` calls across TableViewer, CodeViewer, ZarrViewer, and ViewerRouter.

### 5.3 — Remove `files.svelte.ts` if unused

The audit found `files.svelte.ts` may be dead code. Verify and remove.

### 5.4 — Convert non-rune state to runes

`loadGeneration` in TableViewer (line 55) is a plain `let` — should be `$state(0)` or kept as a plain number (it's intentionally non-reactive, used only for cancellation checks). Document the pattern.

### 5.5 — Consolidate theme listener

Settings store registers a system theme media query listener at module level (never cleaned up). Layout also registers one with proper cleanup. Remove the module-level one, keep only the `$effect` in `+layout.svelte`.

---

## Phase 6: Polish & Accessibility

> **Goal**: Production-quality feel, WCAG 2.1 AA compliance.

### 6.1 — Accessibility

- Add `aria-label` to all icon-only buttons (toolbar toggles, close buttons, nav controls)
- Add `aria-live="polite"` to streaming progress badges (FlatGeobuf feature count, archive scan count)
- Add `role="tablist"` / `role="tab"` / `role="tabpanel"` to tab bar + viewer area
- Keyboard: Arrow keys to navigate tabs, Escape to close active tab
- Focus trap in sheet/dialog overlays (bits-ui likely handles this, verify)
- Skip-to-content link for keyboard users

### 6.2 — Animations & transitions

- Tab switch: subtle crossfade (`transition:fade={{ duration: 100 }}`)
- Sidebar panel open/close: slide transition
- Loading → loaded: fade-in content
- Error states: shake animation on error badge
- Keep all animations under 200ms for perceived responsiveness
- Respect `prefers-reduced-motion` media query

### 6.3 — Empty states

Design empty state illustrations/messages for:
- No connection configured → "Connect to cloud storage to get started"
- No tabs open → "Open a file from the sidebar"
- Empty folder → "This folder is empty"
- Query returns 0 rows → "No results"
- No geometry detected → "No spatial data found in this file"

---

## Implementation Priority

| Phase | Effort | Impact | Priority |
|---|---|---|---|
| **1.1** Tab resource registry | Medium | High (fixes memory leaks) | **P0** |
| **1.2** Result caching (option B) | Medium | High (UX for tab switching) | **P0** |
| **4.1** Lazy-load heavy viewers | Low | High (initial load speed) | **P0** |
| **2.1** ViewerShell component | Medium | Medium (DRY, consistency) | **P1** |
| **5.1** Viewer state machine | Medium | Medium (consistency, DRY) | **P1** |
| **3.3** Safe areas + dvh | Low | Medium (mobile usability) | **P1** |
| **3.2** Mobile table/map UX | High | High (mobile experience) | **P1** |
| **2.2** FloatingToolbar | Low | Medium (consistency) | **P2** |
| **4.4** Idle tab resource release | Medium | Medium (long sessions) | **P2** |
| **3.1** Breakpoint strategy | Medium | Medium (tablet experience) | **P2** |
| **4.2** Code splitting | Low | Medium (bundle size) | **P2** |
| **1.3** Tab limit & warnings | Low | Low (edge case) | **P3** |
| **1.4** DuckDB connection pooling | High | Medium (many-tab perf) | **P3** |
| **6.1** Accessibility | Medium | Medium (compliance) | **P3** |
| **6.2** Animations | Low | Low (polish) | **P3** |
| **6.3** Empty states | Low | Low (polish) | **P3** |

---

## Suggested Implementation Order

```
Sprint 1 (Foundation):
  1.1  Tab resource registry
  1.2  Result caching
  4.1  Lazy-load heavy viewers
  5.3  Remove dead files.svelte.ts
  5.5  Consolidate theme listener

Sprint 2 (Shared components):
  5.1  Viewer state machine
  2.1  ViewerShell wrapper
  2.2  FloatingToolbar
  2.3  MapContainer improvements

Sprint 3 (Mobile):
  3.3  Safe areas + dvh
  3.2  Mobile-specific improvements (table card view, bottom sheets, SQL editor)
  3.4  Touch improvements
  3.1  Breakpoint strategy

Sprint 4 (Performance):
  4.2  Code splitting verification
  4.3  Virtual scrolling extensions
  4.4  Idle tab resource release
  4.5  Loading performance (DuckDB preload, prefetch)

Sprint 5 (Polish):
  1.3  Tab limit & warnings
  5.2  URL state sync
  6.1  Accessibility
  6.2  Animations
  6.3  Empty states
```
