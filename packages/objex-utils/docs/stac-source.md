# stac-source

The `StacSource` contract, a unified async-iterable interface over the three STAC ingestion paths (STAC API, stac-geoparquet, self-contained static catalog) so a viewer has one orchestration loop and the UI can branch on capability flags instead of hard-coded discovery modes. Pure TypeScript, zero Svelte / maplibre / deck.gl / DuckDB on the import graph.

Source: `packages/objex-utils/src/stac-source.ts`.

```ts
import {
  type StacSource,
  type StacSourceKind,
  type StacSourceCapabilities,
  type StacSourceRequest,
  type StacSourceBatch,
  emptyPushdown,
  createApiSource,
  createStaticSource,
} from '@walkthru-earth/objex-utils';
```

## Concept

A `StacSource` is constructed synchronously (no await, so the orchestrator can read `capabilities.kind` before any I/O) and exposes a single `query(req)` returning an `AsyncIterable<StacSourceBatch>`. Each batch reports the subset of the filter the engine pushed down (`pushedDown`) and the subset the caller must still apply client-side (`residual`, via `applyFacets` from [`stac-facets`](./stac-facets.md)). The split is per batch, not per source: a parquet file with a STRUCT `properties` column can push `eo:cloud_cover` while a sibling with an opaque `properties` cannot.

Two implementations ship here, `createApiSource` and `createStaticSource`. The third path, the stac-geoparquet `StacSource`, lives in the Svelte components package (`@walkthru-earth/objex`) under `query/`, because it needs DuckDB-WASM. It is deliberately NOT exported from `objex-utils` so the `utils/` side stays free of heavy deps.

## Types

### `StacSourceKind`

```ts
type StacSourceKind = 'api' | 'parquet' | 'static';
```

Which underlying engine drives the source. Used by the viewer to pick atomic-swap-vs-append, by the UI to choose copy and badges, and by tests.

### `StacSourceCapabilities`

```ts
interface StacSourceCapabilities {
  kind: StacSourceKind;
  label: string;
  countAvailable: boolean;
  streaming: boolean;
  hivePartitioned?: boolean;
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
```

Read at construction (synchronous) and by the filter UI to decide which controls to disable or badge as "client-side only".

- `label` - human-readable HUD label, e.g. `"STAC API"`, `"stac-geoparquet"`, `"Static catalog"`.
- `countAvailable` - true when a cheap `count(filter, bbox)` exists, so the UI can surface "Y of X".
- `streaming` - true when `query()` yields multiple batches before completing.
- `hivePartitioned` - true when the source is a hive-partitioned parquet directory (set by the parquet source). Lets the viewer hint at the discovery model without inspecting `kind === 'parquet'` alone, since the same `kind` also covers single-file stac-geoparquet.
- `pushdown` - the *ceiling* of what this source kind can push. Exhaustive: every `FacetState` facet has a flag, so adding a new facet is a compile-time error in every consumer until handled. The actual per-request push-down is reported in each batch's `pushedDown`.

### `StacSourceRequest`

```ts
interface StacSourceRequest {
  bbox: [number, number, number, number];
  filter: FacetState;
  limit: number;
  pageSize?: number;
  signal: AbortSignal;
}
```

Per-query inputs.

- `bbox` - WGS84 viewport `[west, south, east, north]`, required. Sources that cannot push bbox still receive it, they stream the whole set and rely on the caller's residual filter.
- `filter` - the active `FacetState` (from `stac-facets`).
- `limit` - hard item cap for the request.
- `pageSize` - optional per-page hint for paginating sources, the server may ignore it.
- `signal` - required. Sources MUST throw `DOMException("Aborted", "AbortError")` on abort, never silently complete.

### `StacSourceBatch`

```ts
interface StacSourceBatch {
  items: StacItem[];
  pushedDown: FacetState;
  residual: FacetState;
  done: boolean;
  totalHinted?: number;
}
```

One yielded batch.

- `items` - the items in this batch (empty on the terminal `done` batch).
- `pushedDown` - the subset of `filter` the source / engine already applied, reported so the UI can show "pushed".
- `residual` - the subset the caller must still apply via `applyFacets(views, residual)`.
- `done` - true on the final batch. The iterator's own end-of-iteration also signals completion, this flag lets a caller break the loop the moment a single-yield source finishes.
- `totalHinted` - best-effort total matching count, when the source knows it.

### `StacSource`

```ts
interface StacSource {
  capabilities: StacSourceCapabilities;
  query(req: StacSourceRequest): AsyncIterable<StacSourceBatch>;
  count?(filter: FacetState, bbox: StacSourceRequest['bbox'], signal: AbortSignal): Promise<number>;
}
```

The contract every implementation satisfies. `count` is optional, surfaced as "Y of X" only when present (and `capabilities.countAvailable` is true). Neither shipped implementation here defines `count`.

## Functions

### `emptyPushdown()`

```ts
function emptyPushdown(): StacSourceCapabilities['pushdown'];
```

Return an all-false push-down flag set, a terse base for capability declarations. Spread it and flip on only the flags a source supports, e.g. `{ ...emptyPushdown(), bbox: true, datetime: true }`.

## Implementations

### `createApiSource(kind, deps)` (`stac-source-api.ts`)

```ts
function createApiSource(kind: StacRoutableKind, deps: StacApiSourceDeps): StacSource;

interface StacApiSourceDeps {
  adapter: StorageAdapter;
  baseHref: string;
  urlToKey?: (absoluteUrl: string) => string | null;
  concurrency?: number;
}
```

Wraps `hydrateStacItems` (see [`stac-hydrate`](./stac-hydrate.md)) with `itemsQuery` push-down. `kind` is the classified payload (a Collection / Catalog with a `rel="items"` endpoint, or a STAC API `item-collection` page), the factory validates before dispatching, this function does not re-validate.

Advertised `capabilities.pushdown` is the CQL2 ceiling: `bbox`, `datetime`, `collection`, `cloudCover`, `gsd`, `platform`, `constellation`, `instruments`. `epsg` and `assetRoles` stay false. `streaming` is true, `countAvailable` is false.

Per-request behavior:

- On the first `query()`, lazily sniffs the source's `conformsTo` (via [`sniffApiCapabilities`](./stac-pushdown.md)) once and caches the resolved promise, later queries never re-fetch the root. The sniff reads `conformsTo` inline from the Collection / Catalog / item-collection payload when present, else fetches `baseHref` (routing through the adapter when `urlToKey` resolves it). Any failure degrades to a slice-1 fallback of `bbox` + `datetime` only, so the source never throws on construction or first query.
- Translates `req.filter` into a native query via `toNativeQuery` (bbox + datetime + CQL2 filter), maps it onto a `StacItemsQuery`, and threads it into `hydrateStacItems` so it rides every `rel="next"` page.
- Reports the actually-pushed `FacetState` by inverting `residualState`: `residual = residualState(req.filter, caps)` and `pushedDown = filter - residual`. Both ride every batch unchanged. `collections` cannot be stamped on `/items` (hydrate walks per-collection), so a collection constraint stays in the residual for the caller to apply client-side.
- Bridges hydrate's callback-based `onBatch` into the async iterable via an internal promise queue. Abort pushes a terminal `DOMException("Aborted", "AbortError")` that the iterator throws.

### `createStaticSource(kind, deps)` (`stac-source-static.ts`)

```ts
function createStaticSource(kind: StacRoutableKind, deps: StacStaticSourceDeps): StacSource;

interface StacStaticSourceDeps {
  adapter: StorageAdapter;
  baseHref: string;
  urlToKey?: (absoluteUrl: string) => string | null;
  concurrency?: number;
}
```

Wraps `hydrateStacItems` with NO `itemsQuery`. The entire advertised tree is fetched and the caller filters everything client-side. Capabilities advertise an all-false `pushdown` (via `emptyPushdown()`), `label: 'Static catalog'`, `streaming: true`, `countAvailable: false`. Every batch reports `pushedDown: {}` and `residual: req.filter`. Same internal promise-queue bridge and the same abort contract as the API source.

### The parquet source (not exported here)

The stac-geoparquet `StacSource` (`kind: 'parquet'`) lives in the Svelte components package `@walkthru-earth/objex` under `query/`, because it needs DuckDB-WASM to read parquet and push down predicates. It is intentionally absent from `objex-utils` so this package's import graph stays free of heavy deps. To use the row-level transforms it relies on, see [`stac-geoparquet`](./stac-geoparquet.md), which is pure and does ship here.

## Example

```ts
import {
  classifyStac,
  createApiSource,
  createStaticSource,
  hasStacItemsEndpoint,
  applyFacets,
  extractItemView,
  emptyFacetState,
  type StacSource,
  type StacSourceBatch,
} from '@walkthru-earth/objex-utils';
import type { StorageAdapter } from '@walkthru-earth/objex-utils';

async function build(url: string, adapter: StorageAdapter): Promise<StacSource> {
  const json = await fetch(url).then((r) => r.json());
  const kind = classifyStac(json);
  const serverBacked =
    (kind.kind === 'collection' || kind.kind === 'catalog') &&
    hasStacItemsEndpoint(kind.payload);
  const deps = { adapter, baseHref: url };
  return serverBacked ? createApiSource(kind, deps) : createStaticSource(kind, deps);
}

async function run(source: StacSource, bbox: [number, number, number, number]) {
  const filter = emptyFacetState();
  const controller = new AbortController();
  const collected: ReturnType<typeof extractItemView>[] = [];

  for await (const batch of source.query({
    bbox,
    filter,
    limit: 2000,
    signal: controller.signal,
  })) {
    // Only re-filter what the engine could NOT push down.
    const views = batch.items.map(extractItemView);
    collected.push(...applyFacets(views, batch.residual));
    if (batch.done) break;
  }

  return collected;
}
```

## Peer dependencies

None bundled. The implementations depend only on the caller-supplied `StorageAdapter` interface (re-exported from this package's host-side surface) and the pure sibling modules [`stac-hydrate`](./stac-hydrate.md), [`stac-pushdown`](./stac-pushdown.md), and [`stac-facets`](./stac-facets.md). No DuckDB, Svelte, maplibre, or deck.gl.
