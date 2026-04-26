# stac-pushdown

Translate a `FacetState` into a native STAC API query plus CQL2-JSON, gated by what the endpoint advertises in `conformsTo`. Pair with [`stac-facets`](./stac-facets.md): push as much as the server supports, then apply the residual client-side.

```ts
import {
  type StacApiCapabilities,
  type StacNativeQuery,
  type ToNativeQueryOptions,
  sniffApiCapabilities,
  toNativeQuery,
  toCql2Filter,
  residualState,
} from '@walkthru-earth/objex-utils';
```

Pure TypeScript, zero runtime deps.

## Concept

A STAC API `/conformance` (or the `conformsTo` array on the landing page) advertises which extensions the endpoint implements. Different endpoints support different subsets:

- Earth Search v1: OGC API Features + STAC API Item Search + Filter (CQL2).
- Microsoft Planetary Computer: same as Earth Search plus Sortables / Queryables.
- A vanilla `pystac-server` with no Filter ext: bbox + datetime only, the rest must be done client-side.

`sniffApiCapabilities(conformsTo)` returns a flag set the rest of the module branches on. `toNativeQuery` emits whatever the endpoint can honor as native query params (`bbox`, `datetime`, `collections`); `toCql2Filter` emits a CQL2-JSON expression for the cloud-cover / GSD / platform / constellation / instruments / collection-when-no-native-cap dimensions; `residualState` returns the subset of `FacetState` neither was able to push, so the caller can apply it client-side via `applyFacets` (from `stac-facets`).

## Types

### `StacApiCapabilities`

```ts
interface StacApiCapabilities {
  bbox: boolean;
  datetime: boolean;
  collections: boolean;
  cql2: boolean;
  queryables: boolean;
}
```

Every flag matches a regex against entries in the `conformsTo` array. False when the URI is absent, true when present.

### `StacNativeQuery`

```ts
interface StacNativeQuery {
  bbox?: [number, number, number, number];
  datetime?: string;
  collections?: string[];
  limit?: number;
  filter?: unknown;
  'filter-lang'?: 'cql2-json';
}
```

Superset of the standard `StacItemsQuery`. `filter` carries the CQL2-JSON object when the endpoint supports the Filter ext; absent otherwise.

### `ToNativeQueryOptions`

```ts
interface ToNativeQueryOptions {
  limit?: number;
  collections?: string[];
}
```

`collections` lets the caller force a single-collection scope when classifying a Collection or Catalog (the Filter ext is not the right tool to constrain collection at the protocol level).

## Functions

### `sniffApiCapabilities(conformsTo)`

```ts
function sniffApiCapabilities(conformsTo: readonly string[] | undefined): StacApiCapabilities;
```

Regex-matches OGC API Features + STAC API Item Search + Filter extension URIs. Returns all-false when `conformsTo` is missing or empty.

### `toNativeQuery(state, caps, opts?)`

```ts
function toNativeQuery(
  state: FacetState,
  caps: StacApiCapabilities,
  opts?: ToNativeQueryOptions
): StacNativeQuery;
```

Translates a `FacetState` into the native query shape. Drops anything the endpoint cannot honor. The caller still applies the residual client-side via `applyFacets(views, residualState(state, caps))`.

When `caps.cql2 === true` the cloud-cover / GSD / platform / constellation / instruments dimensions are baked into a CQL2-JSON `filter` plus `'filter-lang': 'cql2-json'`. When `caps.cql2 === false` they stay in the residual.

### `toCql2Filter(state, caps)`

```ts
function toCql2Filter(state: FacetState, caps: StacApiCapabilities): unknown | null;
```

Emits the CQL2-JSON expression for the dimensions `caps.cql2` covers (cloud cover, GSD, platform, constellation, instruments, and collection when there is no native `collections=` cap). Returns `null` when nothing is pushable. Useful when callers want to compose the filter into a different request shape (POST `/search` with extra fields, etc.).

### `residualState(state, caps)`

```ts
function residualState(state: FacetState, caps: StacApiCapabilities): FacetState;
```

Subtract everything `toNativeQuery` (or a hypothetical `toCql2Filter`) would push, return the rest. Pass to `applyFacets(views, residual)` to handle the client-side leftovers.

## Recipe: STAC API source with push-down

```ts
import {
  sniffApiCapabilities,
  toNativeQuery,
  residualState,
  applyFacets,
  extractItemView,
  type FacetState,
} from '@walkthru-earth/objex-utils';

async function loadFiltered(endpoint: string, state: FacetState) {
  const landing = await fetch(endpoint).then((r) => r.json());
  const caps = sniffApiCapabilities(landing.conformsTo);

  const query = toNativeQuery(state, caps, { limit: 250 });
  const url = new URL(`${endpoint}/search`);
  for (const [k, v] of Object.entries(query)) {
    url.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }

  const fc = await fetch(url).then((r) => r.json());
  const views = fc.features.map(extractItemView);
  const residual = residualState(state, caps);
  return applyFacets(views, residual);
}
```

## Caveats

- The CQL2-JSON shape is the **JSON encoding** (RFC 8259 / OGC 21-065). Some servers only accept the **text encoding** at `/search` query strings, in which case POST to `/search` with `Content-Type: application/json` and a body of `{ "filter": <cql2-json>, "filter-lang": "cql2-json", ... }`.
- `sniffApiCapabilities` is regex-based; it does not fetch `/queryables` to verify which property keys the server actually exposes. If your caller enables push-down for a property the server does not index, the server may reject the request or silently return zero results. Test against your target catalogs.
- This module does **not** retry, paginate, or AbortSignal-handle. Wrap the request layer yourself.
- For a fully-orchestrated viewer (link-walking, abort, atomic-swap, item caps, footprint hover), see `StacMosaicViewer` in the main `@walkthru-earth/objex` package.
