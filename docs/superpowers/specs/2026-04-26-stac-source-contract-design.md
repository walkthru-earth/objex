# StacSource Contract — Slice 1 Design

**Date:** 2026-04-26
**Status:** Implemented (slices 1-5 landed together, see "Actual scope landed" below)
**Scope:** Slice 1 of a multi-slice initiative to unify the three STAC ingestion paths (STAC API, stac-geoparquet, self-contained static catalog) behind a single contract, with `pushedDown` / `residual` reporting per batch and capability-aware UI.

This slice was originally drafted as a **zero-functional-change refactor**. It was scoped to introduce the contract and port the three existing paths behind it, with no new push-down, no UI badges, no streaming improvements.

## Actual scope landed

In the course of implementation the contract refactor and the slice 2-5 follow-ups proved to be hard to ship independently without churning the same orchestration loop multiple times in close succession. The PR that lands this design therefore includes:

- **Slice 1**: the `StacSource` contract (`utils/stac-source.ts`), the three impls (`utils/stac-source-api.ts`, `utils/stac-source-static.ts`, `query/stac-source-parquet.ts`), the dispatch factory (`query/stac-source-factory.ts`), and the `StacMosaicViewer::loadMosaic` collapse onto a single orchestration loop.
- **Slice 2 (partial)**: `utils/stac-pushdown.ts` (`sniffApiCapabilities`, `toNativeQuery`, `toCql2Filter`, `residualState`). Wiring into `stac-source-api.ts` is staged for the immediate follow-up.
- **Slice 3 (partial)**: parquet datetime push-down with `start_datetime`/`end_datetime` interval support (catches Landsat composites / climate reanalysis). The streaming `conn.send()` cursor and property push beyond datetime stay deferred.
- **Slice 4**: NOT landed. Static-catalog extent pruning is still future work.
- **Slice 5 (UI portion)**: `StacFilterPanel`, `StacDatetimeBar`, `StacItemStrip`, `StacItemInspector`, `StacRangeSlider`, plus `utils/stac-facets.ts` (auto-faceted state derivation) and `utils/lru.ts` (bounded per-source caches required by the deck.gl viewer-memory checklist in `CLAUDE.md`).

## Non-goals still respected

- No new wire format (no CQL2 GET/POST round-tripped to a server, no `collections=` parameter beyond what `hydrateStacItems` already plumbs through).
- No POST `/search` for long filters.
- No Aggregations extension support.
- No `objex-utils` promotion (still in-app, slice 6).

---

## Goal

`StacMosaicViewer::loadMosaic` currently has three discovery-mode branches (`viewport-api`, `viewport-parquet`, `static`) that each call a different ingestion API with different shapes. After this slice it has one branch: build a `StacSource` for the tab, then `for await` over `source.query(req)`. Every existing behavior (atomic-swap, dedupe, coalesced rebuild, abort filtering) is preserved by being lifted up the call stack from the per-branch helpers into the orchestrator.

This unblocks:
- Slice 2: wire `sniffApiCapabilities` + `toNativeQuery` + `toCql2Filter` into the API source. Widens its declared capabilities, no orchestrator changes.
- Slice 3: turn parquet into a real stream via `conn.send()` and push down `(properties->>'eo:cloud_cover')::DOUBLE` etc. Widens parquet capabilities, no orchestrator changes.
- Slice 4: prune child links by `extent.spatial` / `extent.temporal` in the static source. Widens static capabilities (bbox/datetime become true), no orchestrator changes.
- Slice 5: capability-aware filter panel (badges, "Y of X" totals, disabled-state). Reads `source.capabilities`, no source changes.
- Slice 6: `git mv` `utils/stac-source*.ts` and the API/static implementations into `packages/objex-utils/`. Pure mechanical move once the contract has soaked.

---

## Non-goals (explicitly out of slice 1)

- Any new wire format (no CQL2 GET/POST, no `collections=`, no SQL property push beyond what `stac-geoparquet.ts` already does).
- Static-catalog extent pruning.
- UI capability badges or "Y of X" totals.
- Aggregations extension support.
- POST `/search` for long filters.
- `objex-utils` promotion. Stays in-app this slice.

---

## External package decisions

Surveyed the JS STAC ecosystem before committing to the in-house design. Survey output summary:

| Package | Decision | Reason |
|---|---|---|
| `stac-ts` | **Adopt slice 1** (additive) | Types-only, 0 runtime deps, MIT, current. Replaces hand-rolled `StacItem`/`StacCollection`/`StacCatalog`/`StacAsset`/`StacLink` interfaces. |
| `@radiantearth/stac-fields` | Defer to inspector polish slice | Framework-agnostic property label catalog. Good for `StacItemInspector`. Out of scope here. |
| `cql2-wasm` | Watch | Only relevant if we ever accept user-pasted CQL2 text. Lazy-load if so. |
| `stac-wasm` (rustac) | Watch | Future Arrow-only stac-geoparquet path beside DuckDB. Not slice 1. |
| `stac-js` | Skip | No abort/concurrency/walker. Drags `urijs` + `stac-migrate`. Our `stac-hydrate.ts` already does more. |
| `@developmentseed/stac-react` | Skip | React-19-locked alpha. |
| `@ogcapi-js/features` | Skip | No `/search` POST, no CQL2-JSON, no AbortSignal. |
| `@radiantearth/stac-browser` | Skip as dep | Vue SPA, no library entry. |
| `dyno-cql`, `cql2-js`, `cql2-filters-parser` | Skip | Wrong target / heavy / abandoned. |

Hand-rolled code that survives unchanged: `utils/stac-pushdown.ts`, `utils/stac-hydrate.ts`, `utils/stac-facets.ts`, `utils/stac-geoparquet.ts`, every type guard and helper in `utils/stac.ts`.

### `stac-ts` adoption details

- Add `stac-ts` to `dependencies` of both root `package.json` and `packages/objex-utils/package.json` (types from imported packages must be in `dependencies` so consumers' `tsc` resolves them transitively from our `.d.ts`, per the existing npm Publishing Rules).
- `utils/stac.ts` becomes a thin re-export of `stac-ts`'s types under our existing names so callsites do not change. Every runtime export stays where it is.
- **Risk to verify before merging slice 1:** `stac-ts`'s `StacAsset.href` is required (`string`). Several callsites read `asset?.href` defensively. If `stac-ts` has stricter optional-field shapes than ours, we keep our local types instead of swapping and treat `stac-ts` as documentation. Verification step: a `tsc --noEmit` pass against the swap is gating.

If verification fails, the type-swap is dropped from this slice (and from the project — we keep our types) and only the contract refactor lands. The contract design is independent of the type-swap decision.

---

## Contract

Lives at `src/lib/utils/stac-source.ts`. Pure TypeScript. Forbidden imports: anything from `query/`, `storage/`, `components/`, `stores/`, deck.gl, maplibre, Svelte. Allowed: `stac-ts` types, `utils/stac.ts`, `utils/stac-facets.ts`, `utils/stac-pushdown.ts`.

```ts
import type { StacItem } from './stac.js';
import type { FacetState } from './stac-facets.js';

export type StacSourceKind = 'api' | 'parquet' | 'static';

export interface StacSourceCapabilities {
  kind: StacSourceKind;
  /** Human-readable label for the HUD. e.g. "STAC API", "stac-geoparquet", "Static catalog". */
  label: string;
  /** True when count(filter, bbox) is cheap. UI surfaces "Y of X". */
  countAvailable: boolean;
  /** True when query() yields multiple batches before completing. */
  streaming: boolean;
  /** Per-dimension push-down support. UI badges and disabled-state read off this. */
  pushdown: {
    bbox: boolean;
    datetime: boolean;
    collection: boolean;
    cloudCover: boolean;
    gsd: boolean;
    epsg: boolean;
    platform: boolean;
    constellation: boolean;
    instruments: boolean;
    assetRoles: boolean;
  };
}

export interface StacSourceRequest {
  bbox: [number, number, number, number];
  filter: FacetState;
  limit: number;
  /** Per-page hint for sources that paginate. Server may ignore. */
  pageSize?: number;
  signal: AbortSignal;
}

export interface StacSourceBatch {
  items: StacItem[];
  /** Subset of filter applied server/engine-side. UI reports as "pushed". */
  pushedDown: FacetState;
  /** Subset of filter the caller still has to apply via applyFacets(). */
  residual: FacetState;
  /** True when no more batches will arrive for this request. */
  done: boolean;
  /** Best-effort hint of total matching items, when the source knows. */
  totalHinted?: number;
}

export interface StacSource {
  capabilities: StacSourceCapabilities;
  query(req: StacSourceRequest): AsyncIterable<StacSourceBatch>;
  count?(
    filter: FacetState,
    bbox: StacSourceRequest['bbox'],
    signal: AbortSignal
  ): Promise<number>;
}
```

### Hard rules baked in

- No Svelte / maplibre / deck.gl / DuckDB on the contract import graph. Enforced by file location and grep pre-commit.
- Every method takes an `AbortSignal`. The async iterator throws `DOMException("Aborted", "AbortError")` on abort, never silently completes.
- Source construction is **synchronous** so the viewer can branch on `capabilities` at mount before awaiting anything.
- Capability surface is exhaustive (every facet field listed). Adding a new facet is a compile-time error in every consumer until they handle it.
- `pushedDown` + `residual` are reported **per batch**, not per source. A parquet file whose `properties` is a STRUCT can push `eo:cloud_cover` while a sibling file whose `properties` is opaque cannot — both behind the same source.

---

## File layout

```
src/lib/utils/
  stac-source.ts             ← contract (types + capability surface). Pure TS.
  stac-source-api.ts         ← createApiSource(). Wraps hydrateStacItems + sniffApiCapabilities.
  stac-source-static.ts      ← createStaticSource(). Wraps hydrateStacItems for self-contained catalogs.
src/lib/query/
  stac-source-parquet.ts     ← createParquetSource(). DuckDB-bound. Replaces stac-geoparquet.ts.
  stac-source-factory.ts     ← createStacSourceForTab(tab, classified, deps). Dispatch.
```

`src/lib/query/stac-geoparquet.ts` is **renamed** to `stac-source-parquet.ts`. The existing public export `queryStacGeoparquetFeatureCollection` is preserved as a thin wrapper around `createParquetSource(...).query(...)` collected into a `FeatureCollection` so external callers (none today, verified by grep) continue to compile.

---

## Implementation rules per source (slice 1)

| Source | Capabilities reported | Streaming | Notes |
|---|---|---|---|
| API (`createApiSource`) | `bbox: true, datetime: true`, all others `false`. `countAvailable: false`, `streaming: true`. Label `"STAC API"`. | yes (one yield per `hydrateStacItems` `onBatch`) | Wraps existing `hydrateStacItems({itemsQuery: {bbox, datetime, limit}})`. Each `onBatch` becomes one `StacSourceBatch` with `pushedDown = {datetime: from-filter, ...}` and `residual = filter-minus-pushed`. `sniffApiCapabilities` is read but the result is **not** acted on this slice — slice 2 widens push-down. |
| Parquet (`createParquetSource`) | `bbox: true`, all others `false`. `countAvailable: true`, `streaming: false`. Label `"stac-geoparquet"`. | no (single yield, `done: true`) | Wraps current `queryStacGeoparquetFeatureCollection`. One batch, `done: true`. `count(filter, bbox)` runs `SELECT COUNT(*) FROM ${ref} WHERE ST_Intersects(geometry, ST_MakeEnvelope(...))`. Slice 3 turns this into a real stream and widens push-down. |
| Static (`createStaticSource`) | All `false`. `streaming: true`. Label `"Static catalog"`. | yes | Wraps `hydrateStacItems` without `itemsQuery`. Reports nothing pushed. Slice 4 adds extent-pruning, which lifts `bbox` and `datetime` to `true`. |

### Dispatch (`createStacSourceForTab`)

```ts
function createStacSourceForTab(
  tab: Tab,
  classified: StacRoutableKind,
  deps: {
    adapter: StorageAdapter;
    queryEngine: QueryEngine;
    urlToKey?: (absoluteUrl: string) => string | null;
    baseHref: string;
  }
): StacSource {
  const ext = (tab.extension ?? '').toLowerCase();
  if (ext === 'parquet' || ext === 'geoparquet') {
    return createParquetSource(tab, deps.queryEngine);
  }
  if (classified.kind === 'collection' || classified.kind === 'catalog') {
    if (hasStacItemsEndpoint(classified.payload)) {
      return createApiSource(classified, deps);
    }
    return createStaticSource(classified, deps);
  }
  if (classified.kind === 'item-collection') {
    if (tabLooksLikeStacApi(tab.path)) return createApiSource(classified, deps);
    return createStaticSource(classified, deps);
  }
  if (classified.kind === 'item') {
    return createStaticSource(classified, deps);
  }
  // 'none' is unreachable — caller filters first.
  throw new Error(`Unsupported STAC kind: ${classified.kind}`);
}
```

The factory is the **only** module allowed to import both `utils/stac-source-*.ts` and `query/stac-source-parquet.ts` together.

---

## `StacMosaicViewer::loadMosaic` collapse

Three branches become one. Sketch:

```ts
async function loadMosaic(map: maplibregl.Map): Promise<void> {
  const gen = ++loadGen;
  const signal = hydrationController.signal;

  stage = 'classify';
  let kind: StacRoutableKind;
  if (classified && classified.kind !== 'none') {
    kind = classified;
  } else {
    const ext = (tab.extension ?? '').toLowerCase();
    if (ext === 'parquet' || ext === 'geoparquet') {
      // parquet path classifies via schema, not JSON parse
      kind = { kind: 'item-collection', fc: { type: 'FeatureCollection', features: [] } };
    } else {
      const data = await adapter.read(tab.path, undefined, undefined, signal);
      if (gen !== loadGen || signal.aborted) return;
      kind = classifyStac(JSON.parse(new TextDecoder().decode(data)));
    }
  }
  if (kind.kind === 'none') {
    error = t('map.mosaicEmpty');
    loading = false;
    return;
  }

  const baseHref = await buildHttpsUrlAsync(tab);
  const source = createStacSourceForTab(tab, kind, {
    adapter,
    queryEngine: await getQueryEngine(),
    urlToKey: extractConnectionKey,
    baseHref
  });
  discoveryMode = source.capabilities.kind;
  if (source.capabilities.streaming && source.capabilities.kind !== 'static') {
    setupViewportReload(map);
  } else {
    teardownViewportReload();
  }

  stage = 'fetch';
  stageHinted = itemLimit;
  let firstBatch = true;
  let firstBatchRebuilt = false;
  const cellCounts = new Map<string, number>();
  const dedupeByCell = timeRange === 'latest';
  let acceptedCount = 0;
  let fetchedItemCount = 0;

  try {
    for await (const batch of source.query({
      bbox: viewportBbox(map),
      filter: filterState,
      limit: itemLimit,
      signal
    })) {
      if (gen !== loadGen || signal.aborted) return;
      fetchedItemCount += batch.items.length;
      stageFetched = fetchedItemCount;

      // residual filter applies on the items the source could not narrow
      const residualFilteredItems = applyFacetsToItems(batch.items, batch.residual);

      const accepted: MosaicSourceMeta[] = [];
      const acceptedViews: StacItemView[] = [];
      for (const item of residualFilteredItems) {
        const normalized = buildMosaicSourceMeta(item);
        if (!normalized) continue;
        if (dedupeByCell) {
          const key = spatialCellKey(item, normalized.bbox);
          const seen = cellCounts.get(key) ?? 0;
          if (seen >= LATEST_KEEP_PER_CELL) continue;
          cellCounts.set(key, seen + 1);
        }
        accepted.push(normalized);
        acceptedViews.push(extractItemView(item));
      }
      if (accepted.length === 0) {
        if (batch.done) break;
        continue;
      }
      acceptedCount += accepted.length;
      for (const src of accepted) presignHref(src.href);

      const apiBacked = source.capabilities.kind === 'api';
      if (apiBacked && firstBatch) {
        itemsRef = accepted.slice().reverse();
        itemViewsRef = acceptedViews.slice().reverse();
        firstBatch = false;
      } else if (apiBacked) {
        itemsRef = [...accepted.slice().reverse(), ...itemsRef];
        itemViewsRef = [...acceptedViews.slice().reverse(), ...itemViewsRef];
      } else {
        itemsRef = [...itemsRef, ...accepted];
        itemViewsRef = [...itemViewsRef, ...acceptedViews];
      }
      sourceCount = itemsRef.length;

      // existing fit-bounds-once + rebuild-coalescing logic preserved verbatim
      // ...

      if (apiBacked) {
        if (!firstBatchRebuilt) {
          firstBatchRebuilt = true;
          scheduleLayerRebuild(map);
        }
      } else {
        scheduleLayerRebuild(map);
      }
      loading = false;

      if (batch.done) break;
    }
    if (gen !== loadGen) return;
    if (acceptedCount === 0 && !signal.aborted) {
      // empty-viewport / no-COG-assets distinction stays
    }
    if (!signal.aborted) {
      stage = 'render';
      flushPendingRebuild(map);
      stage = 'done';
      lastRefreshAt = performance.now();
    }
  } catch (err) {
    if (gen !== loadGen) return;
    if (signal.aborted) return;
    if (isAbortError(err)) return;
    error = err instanceof Error ? err.message : String(err);
    stage = 'error';
    loading = false;
  }
}
```

`applyFacetsToItems` is a small in-viewer helper that maps `StacItem[] → StacItemView[]`, runs `applyFacets(views, residual)`, and returns the surviving `StacItem[]` by id-set membership. Reuses existing pure-TS modules.

`apiBacked` is now `source.capabilities.kind === 'api'`. The existing `discoveryMode` field (typed `'viewport-api' | 'viewport-parquet' | 'static'`) is replaced with a single `kind` derived from `source.capabilities.kind` (typed `'api' | 'parquet' | 'static'`). The existing `isViewportMode` derivation becomes `kind !== 'static'`. All i18n keys (`stac.modeViewportApi`, `stac.modeViewportParquet`, `stac.modeStatic`) are kept; the template just reads `kind` to pick which key to render. No new translation keys.

`applyFacetsToItems(items, residual)` is a small private helper inside `StacMosaicViewer.svelte` (or `utils/stac-facets.ts` if we want it shared from the start — slice 1 keeps it private to avoid widening the published API surface before slice 6). It maps `StacItem[] → StacItemView[]` via `extractItemView`, runs `applyFacets`, then filters the original `StacItem[]` by surviving `id` set.

`tabLooksLikeStacApi` already lives in `StacMosaicViewer.svelte` as a private helper using `STAC_API_PATH_RE` from `utils/storage-url.ts`. Slice 1 lifts it into `utils/stac-source-factory.ts` so the dispatch can use it. The original viewer-private copy is removed.

---

## Memory + abort behavior — preserved

All existing behavior survives the refactor unchanged:

- Two AbortControllers (`abortController` viewer-lifetime, `hydrationController` per-pan). The contract takes the per-pan signal.
- `LruCache` for `geotiffCache` / `presignCache` and the reverse `sourceHrefById` map.
- `MosaicLayer.onTileUnload` drives Svelte-side cache eviction.
- Coalesced layer rebuilds (`scheduleLayerRebuild`, `flushPendingRebuild`, `REBUILD_INTERVAL_MS = 750`).
- API-mode atomic source swap on first batch, append on subsequent batches.
- API-mode "rebuild only on first batch + final flush", static/parquet "rebuild per batch".
- `isAbortError` filtering on `MosaicLayer.onTileError` and `MapboxOverlay.onError`.

The only difference is where the orchestration lives: instead of three branches each owning their own atomic-swap / append logic, the orchestrator owns it once and dispatches on `source.capabilities.kind`.

---

## CLAUDE.md updates

- `src/lib/utils/CLAUDE.md`: add `stac-source.ts`, `stac-source-api.ts`, `stac-source-static.ts` to the file table. Note the contract rules (no DuckDB / Svelte / maplibre).
- `src/lib/query/CLAUDE.md`: replace `stac-geoparquet.ts` row with `stac-source-parquet.ts` row. Add `stac-source-factory.ts` row noting it is the only place that imports across `utils/` + `query/` STAC sources together.
- `src/lib/components/viewers/CLAUDE.md`: update the StacMosaicViewer row's "Two ingestion paths" sentence to "Single `StacSource`-driven ingestion path with three implementations behind it (`api`, `parquet`, `static`), dispatched by `createStacSourceForTab`. The viewer reads `source.capabilities.kind` for HUD copy and atomic-swap behavior."

---

## Risks + verification

| Risk | Mitigation |
|---|---|
| `stac-ts` types stricter than ours, breaks compile | `tsc --noEmit` is gating. If broken, drop the type-swap from slice 1, keep contract refactor only. |
| Viewer's atomic-swap edge cases regress | Manual smoke test: open a STAC API tab (Earth Search), pan, verify previous mosaic keeps painting until new batch arrives. |
| `firstBatch` semantics differ between API streaming and parquet single-yield | Single-yield parquet bypasses `firstBatch` block by setting `apiBacked = false` (parquet's kind is `parquet`, not `api`). Append path is correct for it. |
| `discoveryMode` state diverges from `source.capabilities.kind` | Treat `discoveryMode` as a derived view of `source.capabilities.kind`, not a separately-mutated field. Set once at source construction, never reassigned during a query. |
| External callers of `queryStacGeoparquetFeatureCollection` regress | Grep confirms zero external callers today. Keep the export as a thin wrapper around `createParquetSource(...).query(...)` for safety. |
| `objex-utils` accidentally pulls DuckDB | Forbidden by file location (parquet impl is in `query/`, not `utils/`). `pnpm pack` + tarball inspection in pre-publish checklist still gates. |

---

## Acceptance criteria

1. `pnpm -w run format && pnpm -w run lint:fix && pnpm -w run check` passes.
2. `pnpm -w run package` and `pnpm --filter @walkthru-earth/objex-utils run build` both succeed.
3. `grep -r '\$lib/' dist/ --include='*.js'` finds nothing.
4. Manual smoke: STAC API tab (Earth Search), stac-geoparquet tab (`source.coop/aef_index`), self-contained Catalog tab — all three open, pan, filter, refresh without regression.
5. `StacMosaicViewer.svelte`'s `loadMosaic` has one `for await` loop, not three branches.
6. `discoveryMode` references in the template and the HUD pull from `source.capabilities` directly or via a derived field.
7. No DuckDB / Svelte / maplibre / deck.gl import appears in `src/lib/utils/stac-source.ts`, `stac-source-api.ts`, or `stac-source-static.ts` (verified by grep).
8. The three CLAUDE.md files (`utils/`, `query/`, `components/viewers/`) reflect the new layout.

---

## Slice plan beyond this doc

| Slice | Scope | Touches |
|---|---|---|
| 1 (this) | Contract + zero-functional-change port | `utils/stac-source*.ts`, `query/stac-source-parquet.ts`, `query/stac-source-factory.ts`, `StacMosaicViewer.svelte`, three CLAUDE.md files |
| 2 | API push-down: `sniffApiCapabilities` + `toNativeQuery` + `toCql2Filter` wired in. Optional POST `/search` for long filters. | `utils/stac-source-api.ts`, `utils/stac-hydrate.ts` (CQL2 + collections params) |
| 3 | Parquet streaming + property push-down: `(properties->>'eo:cloud_cover')::DOUBLE` + collection/platform pushdown via DuckDB SQL. `conn.send()` for streaming. | `query/stac-source-parquet.ts` only |
| 4 | Static-catalog extent pruning: skip child links whose `extent.spatial`/`extent.temporal` does not intersect the viewport. | `utils/stac-source-static.ts`, `utils/stac-hydrate.ts` |
| 5 | UI capability viz: badges per filter row (pushed vs client), "Y of X" totals, disabled-state for unfilterable fields, mid-query spinner per facet. | `StacFilterPanel.svelte`, `StacMosaicViewer.svelte` |
| 6 | Promote `utils/stac-source.ts` + `stac-source-api.ts` + `stac-source-static.ts` into `packages/objex-utils/`. | `git mv` + `packages/objex-utils/src/index.ts` re-exports |

Each slice is independently shippable. Slices 2-4 are parallelizable (different files). Slice 5 depends on 2/3/4 to have something interesting to surface. Slice 6 depends on 1 having soaked at least one minor release.
