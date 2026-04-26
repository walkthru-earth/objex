# stac-facets

Auto-faceted client-side filter / sort / projection helpers for STAC item collections. Pure TypeScript, framework-agnostic. Useful when you want a STAC viewer (or any UI) to show a filter panel that adapts to the loaded dataset rather than hardcoding controls that may not have variance.

```ts
import {
  type StacItemView,
  type Facet,
  type NumericFacet,
  type EnumFacet,
  type DatetimeFacet,
  type FacetSet,
  type FacetState,
  type FacetSort,
  type NumericFacetField,
  type EnumFacetField,
  extractItemView,
  buildFacets,
  applyFacets,
  sortViews,
  hasActiveFilters,
  emptyFacetState,
  DATETIME_HISTOGRAM_BINS,
} from '@walkthru-earth/objex-utils';
```

## Concept

A typical STAC viewer pipeline is:

1. Hydrate items into a flat `StacItem[]`.
2. Project each item into a slim `StacItemView` (id, bbox, datetime, cloud cover, platform, etc.) once, and never re-walk the heavy `properties` / `assets` again at filter time.
3. Build a `FacetSet` from the projected views. The builder *auto-detects* which controls have variance: numeric facets only emit when there are >=2 distinct finite values, enum facets only when >=2 distinct values, datetime histogram with `DATETIME_HISTOGRAM_BINS = 32` fixed-width bins.
4. Maintain a `FacetState` (filter selection) in component state.
5. Filter via `applyFacets(views, state)` (pure, never mutates), sort via `sortViews(views, sort)`, render.

This module covers steps 2-5 and the type surface the UI consumes.

## Types

### `StacItemView`

```ts
interface StacItemView {
  id: string;
  collection?: string;
  bbox?: [number, number, number, number];
  datetime?: string;
  endDatetime?: string;
  cloudCover?: number;
  gsd?: number;
  platform?: string;
  constellation?: string;
  instruments?: string[];
  epsg?: number;
  thumbnailHref?: string;
  assetRoles?: string[];
  raw: StacItem;
}
```

The slim projection a faceting / strip / inspector layer reads. `raw` is kept as an escape hatch (the inspector's raw-JSON view, the `flyTo` bbox fallback when the projection lacks one).

### `Facet`, `NumericFacet`, `EnumFacet`, `DatetimeFacet`

Discriminated union with `kind: 'numeric' | 'enum' | 'datetime'`. Numeric facets carry `min`/`max`/`step`/`histogram?`; enum facets carry `values: { value, count }[]`; datetime facets carry an ISO `min`/`max` and a 32-bin histogram.

### `FacetSet`

```ts
interface FacetSet {
  numeric: Partial<Record<NumericFacetField, NumericFacet>>;
  enum: Partial<Record<EnumFacetField, EnumFacet>>;
  datetime?: DatetimeFacet;
}
```

The shape `buildFacets()` returns. Only fields with variance appear, so a UI can iterate the keys and skip rendering controls that would not narrow this dataset.

### `FacetState`

```ts
interface FacetState {
  cloudCover?: { min?: number; max?: number };
  gsd?: { min?: number; max?: number };
  datetime?: { min?: string; max?: string };
  collection?: string[];
  platform?: string[];
  constellation?: string[];
  instruments?: string[];
  assetRoles?: string[];
  epsg?: number[];
}
```

What the UI reads / writes. Open-bound ranges (one of `min` / `max` undefined) are valid. Empty arrays are treated as no constraint.

### `FacetSort`

```ts
type FacetSort =
  | 'datetime-desc'
  | 'datetime-asc'
  | 'cloud-asc'
  | 'cloud-desc'
  | 'gsd-asc'
  | 'gsd-desc';
```

Items missing the sort field always sink to the bottom regardless of asc/desc.

## Functions

### `extractItemView(item)`

```ts
function extractItemView(item: StacItem): StacItemView;
```

Pure projection. Reads `properties.datetime`, `properties.start_datetime` / `properties.end_datetime`, `properties['eo:cloud_cover']`, `properties.gsd`, `properties.platform`, `properties.constellation`, `properties.instruments`, `properties['proj:epsg']` / `properties['proj:code']`, and the first asset whose `roles` includes `'thumbnail'` / `'overview'` / `'visual'` (in that order). Returns a `StacItemView` with `raw: item`.

Non-finite numerics, missing properties, and malformed CRS strings are normalized to `undefined`.

### `buildFacets(views)`

```ts
function buildFacets(views: readonly StacItemView[]): FacetSet;
```

Auto-detects which facets have variance. Numeric facets emit when there are >=2 distinct finite values; enum facets emit when there are >=2 distinct values. The datetime facet emits an ISO `min`/`max` plus a 32-bin histogram (`DATETIME_HISTOGRAM_BINS`) when the views span more than one day.

### `applyFacets(views, state)`

```ts
function applyFacets(views: readonly StacItemView[], state: FacetState): StacItemView[];
```

Pure filter. Every constraint in `state` must match. Numeric ranges treat absent items as failing the constraint; enum arrays match if the item's value is in the array (or, for `instruments` / `assetRoles`, if any of the item's values is in the array).

### `sortViews(views, sort)`

```ts
function sortViews(views: readonly StacItemView[], sort: FacetSort): StacItemView[];
```

Stable sort. Items missing the sort field sink to the bottom regardless of direction.

### `hasActiveFilters(state)`

```ts
function hasActiveFilters(state: FacetState): boolean;
```

True if any field constrains. Use to short-circuit filter computation on hot paths (e.g. only filter the source list when active).

### `emptyFacetState()`

```ts
function emptyFacetState(): FacetState;
```

Stable empty constant suitable for `$state(emptyFacetState())`.

## Constants

### `DATETIME_HISTOGRAM_BINS`

`32`. Fixed bin count for the datetime facet histogram so the consumer UI can size its bars without re-computing.

## Recipe: build a faceted item strip

```ts
import {
  extractItemView,
  buildFacets,
  applyFacets,
  emptyFacetState,
  hasActiveFilters,
  type FacetState,
} from '@walkthru-earth/objex-utils';

const views = items.map(extractItemView);
const facets = buildFacets(views);
let state: FacetState = emptyFacetState();

function setFilter(next: FacetState): void {
  state = next;
  const filtered = hasActiveFilters(state) ? applyFacets(views, state) : views;
  renderStrip(filtered);
  renderFootprints(filtered);
}
```

## Caveats

- This module is **client-side only**. For server push-down (STAC API native parameters and CQL2-JSON), pair it with [`stac-pushdown`](./stac-pushdown.md): translate the `FacetState` into a native query, send to the server, then `applyFacets(views, residualState(state, caps))` for whatever the server could not honor.
- `buildFacets` is O(n) over `views`. For very large catalogs (>50 k items) call it once per committed render set, not per filter change.
- The datetime histogram bins are computed in UTC (`Date.parse` / `Date.UTC`). A consumer rendering local-time tick labels is responsible for the timezone conversion.
