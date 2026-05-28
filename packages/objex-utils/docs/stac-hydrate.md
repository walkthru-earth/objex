# stac-hydrate

STAC link-following hydrator. Walks a classified STAC payload into a flat `StacItem[]` by following `links[rel=item]` (Collection), `links[rel=child]` then `links[rel=item]` (Catalog), the `rel="items"` endpoint (OGC API Features / STAC API), and `links[rel=next]` pagination (FeatureCollection / STAC API). Pure async TypeScript, zero Svelte / DuckDB / deck.gl dependency. Fetches through a caller-supplied `StorageAdapter` so private buckets can be walked.

Source: `packages/objex-utils/src/stac-hydrate.ts`.

```ts
import {
  type HydrateOptions,
  type StacItemsQuery,
  type HydrateResult,
  hydrateStacItems,
  hasStacItemsEndpoint,
  absolutizeHref,
} from '@walkthru-earth/objex-utils';
```

## Concept

`classifyStac` (from [`stac`](./stac.md)) turns parsed JSON into a `StacRoutableKind`. `hydrateStacItems` takes that verdict plus the URL it was fetched from and recursively walks links into a flat item list, emitting batches as it goes for progressive rendering. It branches by variant:

- `item`: a single Item, emitted immediately with its asset hrefs absolutized.
- `item-collection`: a FeatureCollection, items accepted then `rel="next"` pages followed (when `followPagination`).
- `collection` / `catalog`: walks static `rel="item"` links if present, else the `rel="items"` endpoint (STAC API convention), else recurses into `rel="child"` links with a bounded worker pool.

All fetches route through the supplied `StorageAdapter`: absolute URLs that the optional `urlToKey` maps to a bucket key are read via `adapter.read` (so SigV4 presigning applies), foreign origins fall back to a raw `fetch`, and relative hrefs go straight to `adapter.read`.

## Types

### `HydrateOptions`

```ts
interface HydrateOptions {
  signal: AbortSignal;
  concurrency?: number;
  limit?: number;
  followPagination?: boolean;
  onBatch?: (items: StacItem[]) => void;
  onProgress?: (fetched: number, totalHinted: number | undefined) => void;
  urlToKey?: (absoluteUrl: string) => string | null;
  itemsQuery?: StacItemsQuery;
}
```

- `signal` -- required abort signal, threaded into every adapter read and `fetch`.
- `concurrency` -- max parallel fetches for item links and child walks. Default `12`.
- `limit` -- hard cap on items, catalogs larger than this are truncated. Default `2000`.
- `followPagination` -- follow `links[rel=next]` in FeatureCollections. Default `true`.
- `onBatch` -- called with each newly fetched batch for progressive rendering. Items in a batch already have absolutized asset hrefs.
- `onProgress` -- called after each emit with the running item count, `totalHinted` is always `undefined` in the current implementation.
- `urlToKey` -- maps an absolute HTTPS URL to a bucket-relative key when it belongs to the caller's connection. When it returns a non-null string, the fetch routes through `adapter.read` (SigV4) instead of cross-origin `fetch`, so private-bucket catalogs can be walked. Return `null` for foreign origins.
- `itemsQuery` -- optional native STAC API filters appended to the `rel="items"` endpoint and re-stamped on every `rel="next"` page. See `StacItemsQuery`.

### `StacItemsQuery`

```ts
interface StacItemsQuery {
  bbox?: [number, number, number, number];
  datetime?: string;
  limit?: number;
  filter?: unknown;
}
```

Native filters supported by OGC API Features / STAC API on `/items`.

- `bbox` -- WGS84 `[west, south, east, north]`, stamped as `?bbox=w,s,e,n`.
- `datetime` -- RFC 3339 instant or interval `start/end` (use `..` for open ends).
- `limit` -- per-page item count hint, floored to an integer, the server may cap it.
- `filter` -- a CQL2-JSON filter expression (STAC API Filter extension). When set it is appended as `?filter=<json>&filter-lang=cql2-json` and re-stamped onto every `rel="next"` page so cursor URLs cannot strip it.

Each param is only stamped when the URL does not already carry it, so a server that echoes the original filter on its cursor links is not double-stamped (which would corrupt the JSON). `filter` is `JSON.stringify`-ed, a stringify failure (cyclic input) is swallowed and hydration continues without the filter.

### `HydrateResult`

```ts
interface HydrateResult {
  items: StacItem[];
  truncated: boolean;
  rootBaseHref: string;
}
```

The aggregate result. `items` is the flat list capped at `limit`. `truncated` is true when the catalog exceeded `limit` or a sub-walk truncated. `rootBaseHref` echoes the `baseHref` argument the walk started from.

## Functions

### `hydrateStacItems(root, baseHref, adapter, opts)`

```ts
function hydrateStacItems(
  root: StacRoutableKind,
  baseHref: string,
  adapter: StorageAdapter,
  opts: HydrateOptions
): Promise<HydrateResult>;
```

Walk `root` into a flat `StacItem[]`.

- `root` -- the classified payload from `classifyStac`. A `kind: 'none'` root yields an empty, non-truncated result.
- `baseHref` -- the URL `root` was fetched from. All relative hrefs (child links, item links, asset hrefs) resolve against this.
- `adapter` -- the `StorageAdapter` every fetch routes through (see `urlToKey` for the routing rule).
- `opts` -- see `HydrateOptions`.

Behavior by `root.kind`:

- `item` -- emits the single Item (asset hrefs absolutized against `baseHref`) and returns immediately, never truncated.
- `item-collection` -- accepts every valid feature, then follows `rel="next"` recursively when `followPagination` and the running count is under `limit`. The `itemsQuery` is re-stamped on each next URL.
- `collection` / `catalog` -- if the payload has static `rel="item"` links it fetches them with the worker pool. Otherwise, when no static item links exist, it tries the single `rel="items"` endpoint (with `itemsQuery` applied) and consumes it as a paginated FeatureCollection. A Catalog (or an item-link-less Collection) then also recurses into `rel="child"` links with up to `concurrency` workers, each child re-entering `hydrateStacItems` with a `limit` reduced by the count already gathered.

Aborting via `opts.signal` stops the walk, in-flight reads reject with the adapter's abort behavior. Dead links and unreachable children are skipped, not fatal, so a partial catalog still hydrates. The returned `items` is sliced to `limit`.

The `rel="items"` versus `rel="item"` distinction is load-bearing: STAC API endpoints (earth-search, planetary-computer, pgstac) advertise a single `rel="items"` link to a paginated FeatureCollection, while static self-contained catalogs use one `rel="item"` link per item file. The walker only consults the items endpoint when no static item links are present.

### `hasStacItemsEndpoint(payload)`

```ts
function hasStacItemsEndpoint(payload: StacCollection | StacCatalog): boolean;
```

True when `payload` exposes a `rel="items"` link, the OGC API Features / STAC API convention. Lets callers detect a server-backed collection up front and switch to viewport-scoped fetching (passing an `itemsQuery` bbox) instead of walking every page of a static catalog.

### `absolutizeHref(href, baseHref)`

```ts
function absolutizeHref(href: string, baseHref: string): string;
```

Resolve a possibly-relative href against `baseHref` via `new URL(href, baseHref)`. Hrefs that already carry an `http(s):`, `s3:`, or `azure:` scheme are returned unchanged. A `new URL` failure returns the original `href` unchanged. STAC catalogs commonly use `./child/foo.json` or `../foo.json`, both of which resolve correctly.

## Example

```ts
import {
  classifyStac,
  hydrateStacItems,
  hasStacItemsEndpoint,
  type StacItem,
} from '@walkthru-earth/objex-utils';
import type { StorageAdapter } from '@walkthru-earth/objex-utils';

async function loadCatalog(
  url: string,
  adapter: StorageAdapter,
  bbox: [number, number, number, number],
  signal: AbortSignal,
) {
  const json = await fetch(url, { signal }).then((r) => r.json());
  const root = classifyStac(json);
  if (root.kind === 'none') throw new Error('Not a STAC payload');

  // Map our own bucket's HTTPS URLs back to keys so private reads use SigV4.
  const urlToKey = (abs: string): string | null => {
    const prefix = 'https://my-bucket.s3.amazonaws.com/';
    return abs.startsWith(prefix) ? abs.slice(prefix.length) : null;
  };

  // Viewport-scope when the server supports it; otherwise walk everything.
  const itemsQuery =
    (root.kind === 'collection' || root.kind === 'catalog') &&
    hasStacItemsEndpoint(root.payload)
      ? { bbox, limit: 250 }
      : undefined;

  const all: StacItem[] = [];
  const { items, truncated } = await hydrateStacItems(root, url, adapter, {
    signal,
    limit: 2000,
    itemsQuery,
    urlToKey,
    onBatch: (batch) => all.push(...batch), // render progressively
  });

  return { items, truncated };
}
```

## Peer dependencies

None bundled. `hydrateStacItems` and `createApiSource` / `createStaticSource` (see [`stac-source`](./stac-source.md)) depend only on the caller-supplied `StorageAdapter` interface (re-exported from this package's host-side surface) and the global `fetch` for foreign origins. No DuckDB, Svelte, maplibre, or deck.gl on the import graph.
