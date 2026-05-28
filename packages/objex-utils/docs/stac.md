# stac

Core STAC (SpatioTemporal Asset Catalog) types, shape-checks, classifiers, and asset extractors. Pure TypeScript, zero Svelte / DuckDB / deck.gl dependency, framework-agnostic. Shared by `ViewerRouter`, `StacMosaicViewer`, and `MultiCogViewer` in the main package.

Source: `packages/objex-utils/src/stac.ts`.

```ts
import {
  type StacItem,
  type StacFeatureCollection,
  type StacCollection,
  type StacCatalog,
  type StacAsset,
  type StacLink,
  type StacRoutableKind,
  type MosaicSourceMeta,
  type BandSlot,
  type BandMap,
  type RasterBandAsset,
  STAC_COG_ASSET_KEYS,
  classifyStac,
  isStacItem,
  isStacFeatureCollection,
  isStacCollection,
  isStacCatalog,
  detectMosaicCapable,
  detectMultiCogCapable,
  pickCogAssetHref,
  stacItemBbox,
  buildMosaicSourceMeta,
  spatialCellKey,
  extractSentinelBandAssets,
  hasRgbBands,
  extractRasterBandAssets,
  extractMosaicAssets,
  resolveBandSlotAssetKey,
  resolvePresetComposite,
  hasCompositableBands,
} from '@walkthru-earth/objex-utils';
```

## Types

### `StacLink`

```ts
interface StacLink {
  rel: string;
  href: string;
  type?: string;
  title?: string;
}
```

A link entry shared by Catalog / Collection / Item. The link-walker in [`stac-hydrate`](./stac-hydrate.md) keys on `rel` (`item`, `child`, `items`, `next`).

### `StacItem`

```ts
interface StacItem {
  type: 'Feature';
  stac_version: string;
  id: string;
  bbox?: [number, number, number, number];
  geometry?: unknown;
  properties?: Record<string, unknown>;
  assets?: Record<string, StacAsset>;
  collection?: string;
  links?: StacLink[];
}
```

A STAC Item is a GeoJSON Feature with a `stac_version`. `geometry` is left `unknown` because this module never parses footprints, the bbox is the only spatial field it reads.

### `StacFeatureCollection`

```ts
interface StacFeatureCollection {
  type: 'FeatureCollection';
  stac_version?: string;
  features: StacItem[];
  links?: StacLink[];
}
```

A page of Items, also the shape STAC API `/search` and `/items` endpoints return. `stac_version` is optional here because some API responses omit it at the collection level, in which case the first feature is checked instead.

### `StacCollection`

```ts
interface StacCollection {
  type: 'Collection';
  stac_version: string;
  id: string;
  description?: string;
  extent?: { spatial?: { bbox?: number[][] }; temporal?: unknown };
  links: StacLink[];
}
```

A grouping of Items with its own metadata and a required `links` array.

### `StacCatalog`

```ts
interface StacCatalog {
  type: 'Catalog';
  stac_version: string;
  id: string;
  description?: string;
  links: StacLink[];
}
```

A directory-like grouping of Catalogs / Collections / Items via `links`.

### `StacAsset`

```ts
interface StacAsset {
  href: string;
  type?: string;
  title?: string;
  roles?: string[];
  'eo:bands'?: { name?: string; common_name?: string }[];
}
```

A single asset entry within an Item. `'eo:bands'` is populated when the asset carries the EO extension band metadata, the extractors read `eo:bands[0].common_name` to map an asset to a band slot.

### `BandSlot`

```ts
type BandSlot = 'red' | 'green' | 'blue' | 'nir' | 'swir1' | 'swir2' | 'rededge';
```

A Sentinel-2-style band slot identifier, shared with the composite helpers in the app-side `utils/cog.ts`.

### `BandMap`

```ts
type BandMap = Partial<Record<BandSlot, string>>;
```

Parsed band map, each slot maps to an absolute HTTPS asset URL. Returned by `extractSentinelBandAssets`.

### `StacRoutableKind`

```ts
type StacRoutableKind =
  | { kind: 'item'; item: StacItem }
  | { kind: 'item-collection'; fc: StacFeatureCollection }
  | { kind: 'collection'; payload: StacCollection }
  | { kind: 'catalog'; payload: StacCatalog }
  | { kind: 'none' };
```

The routing verdict returned by `classifyStac`. The `kind: 'none'` variant carries no payload and signals the JSON is not STAC-shaped.

### `MosaicSourceMeta`

```ts
interface MosaicSourceMeta {
  id: string;
  bbox: [number, number, number, number];
  href: string;
}
```

A normalized mosaic source entry, the minimal shape deck.gl-geotiff's `MosaicLayer` consumes. Returned by `buildMosaicSourceMeta`.

### `RasterBandAsset`

```ts
interface RasterBandAsset {
  key: string;
  href: string;
  commonName?: string;
  bandCount?: number;
  roles?: string[];
  mediaType?: string;
  title?: string;
}
```

A vendor-neutral raster band asset description carrying the bits a MultiCOG band picker needs to populate dropdowns and resolve presets. `key` is the STAC asset key exactly as it appears in `item.assets` (`red`, `B04`, `image`, `analytic`, ...), it lines up 1:1 with `MultiCOGLayer.sources`'s record key. Returned by `extractRasterBandAssets` and `extractMosaicAssets`.

## Constants

### `STAC_COG_ASSET_KEYS`

```ts
const STAC_COG_ASSET_KEYS = ['visual', 'image', 'data', 'rendered_preview'] as const;
```

Asset keys providers use for the single "display COG" asset, in priority order. `pickCogAssetHref` scans these after any caller-preferred key.

## Functions

### `isStacItem(json)`

```ts
function isStacItem(json: unknown): json is StacItem;
```

Shape-check: true when `json.type === 'Feature'` and `json.stac_version` is a string. Type guard.

### `isStacFeatureCollection(json)`

```ts
function isStacFeatureCollection(json: unknown): json is StacFeatureCollection;
```

True when `json.type === 'FeatureCollection'` with a non-empty `features` array. A `stac_version` string passes immediately, otherwise the first feature is run through `isStacItem`. Empty `features` returns false. Type guard.

### `isStacCollection(json)`

```ts
function isStacCollection(json: unknown): json is StacCollection;
```

True when `json.type === 'Collection'` with a `stac_version` string and a `links` array. Type guard.

### `isStacCatalog(json)`

```ts
function isStacCatalog(json: unknown): json is StacCatalog;
```

True when `json.type === 'Catalog'` with a `stac_version` string and a `links` array. Type guard.

### `classifyStac(json)`

```ts
function classifyStac(json: unknown): StacRoutableKind;
```

Classify arbitrary parsed JSON into one of the STAC routing buckets. Checks in order: Item, FeatureCollection (item-collection), Collection, Catalog, falling back to `{ kind: 'none' }`. This is the entry point that decides which viewer or `StacSource` implementation to build.

### `pickCogAssetHref(item, preferred?)`

```ts
function pickCogAssetHref(item: StacItem, preferred?: string): string | null;
```

Pick the COG-ish asset href from an Item. Priority:

1. The named asset under `preferred` when given and it has an href.
2. The first of `STAC_COG_ASSET_KEYS` (`visual`, `image`, `data`, `rendered_preview`) that exists.
3. Any asset whose `type` (lowercased) contains `"tiff"`.

Returns `null` when nothing matches.

### `detectMosaicCapable(item)`

```ts
function detectMosaicCapable(item: StacItem): boolean;
```

True when the Item exposes both a bbox (`stacItemBbox`) and a COG-ish asset (`pickCogAssetHref`), the minimum for a single source in a mosaic.

### `detectMultiCogCapable(item)`

```ts
function detectMultiCogCapable(item: StacItem): boolean;
```

True when the Item has Sentinel-2 RGB bands (`hasRgbBands(extractSentinelBandAssets(item))`) or at least three compositable single-band raster COGs (`hasCompositableBands(extractRasterBandAssets(item))`). Drives whether `MultiCogViewer` is offered for the Item.

### `stacItemBbox(item)`

```ts
function stacItemBbox(item: StacItem): [number, number, number, number] | null;
```

Read the WGS84 bbox as `[minX, minY, maxX, maxY]`, coercing each component with `Number()`. Returns `null` when `item.bbox` is absent or shorter than four entries. Extra entries (a 6-element 3D bbox) are tolerated, only the first four are read.

### `buildMosaicSourceMeta(input, assetKey?)`

```ts
function buildMosaicSourceMeta(
  input:
    | StacItem
    | { id?: string; bbox: [number, number, number, number] | number[]; href: string },
  assetKey?: string
): MosaicSourceMeta | null;
```

Normalize either a full STAC Item or a plain `{ id?, bbox, href }` record into a `MosaicSourceMeta`. For an Item it derives bbox via `stacItemBbox` and href via `pickCogAssetHref(item, assetKey)`, returning `null` if either is missing. For a plain record it requires a 4+ element `bbox` array and a string `href`. The `id` falls back to the href when no id is present.

### `spatialCellKey(item, bbox)`

```ts
function spatialCellKey(item: StacItem, bbox: [number, number, number, number]): string;
```

Compute a stable per-footprint cell key, used to dedupe revisits when the caller wants only the freshest scene per footprint. STAC providers default to descending-datetime sort, so the first item seen per key is the newest. Resolution order:

1. STAC `properties['grid:code']`, prefixed `g:`.
2. Sentinel-2 MGRS triplet `properties['mgrs:utm_zone']` + `['mgrs:latitude_band']` + `['mgrs:grid_square']`, prefixed `m:`.
3. `properties['s2:mgrs_tile']`, prefixed `m:`.
4. The supplied `bbox` rounded to three decimals, prefixed `b:`, so non-S2 providers still dedupe.

### `extractSentinelBandAssets(item)`

```ts
function extractSentinelBandAssets(item: StacItem): BandMap;
```

Map a Sentinel-2 Item's assets to a `BandMap`. For each asset with an href it prefers `eo:bands[0].common_name` (lowercased, when it is a recognized `BandSlot`), then falls back to asset-key heuristics for Microsoft Planetary Computer / Element 84 / AWS S2 L2A bucket conventions (`B04`, `B03`, `nir08`, `swir16`, ...). First match per slot wins. Returns an empty map when no bands are identifiable so callers can fall back to a different viewer.

### `hasRgbBands(map)`

```ts
function hasRgbBands(map: BandMap): boolean;
```

True when `map` carries `red`, `green`, and `blue`, enough for a True Color composite.

### `extractRasterBandAssets(item)`

```ts
function extractRasterBandAssets(item: StacItem): RasterBandAsset[];
```

Enumerate every asset that looks like a single-band raster COG suitable for compositing in `MultiCOGLayer`. Inclusion rules:

- `type` must match `image/(tiff|geotiff)` (case-insensitive, COG profile suffix allowed) when present. A missing `type` is permitted, since some catalogs omit it for COGs.
- Assets whose `roles` include `thumbnail`, `overview`, or `metadata` are dropped.
- Pre-baked multi-band visuals (`raster:bands.length > 1` or `eo:bands.length > 1`) are dropped, compositing needs single-band sources, the multi-band visual belongs in `CogViewer`.

`bandCount` is reported as `1` when neither band tag is present, so vendor catalogs that omit `eo:bands` are still pickable. Callers wanting strictness can filter on `bandCount === 1`.

### `resolveBandSlotAssetKey(assets, slot)`

```ts
function resolveBandSlotAssetKey(
  assets: RasterBandAsset[],
  slot: BandSlot
): string | undefined;
```

Resolve a semantic band slot to an asset key on this Item. Priority:

1. The first asset whose `commonName` equals the slot.
2. The first asset whose `key` appears in the vendor fallback list for the slot (`B04`, `red-jp2`, ...).

Returns the asset key (NOT the href) so callers can plumb it into `composite: { r, g, b }` and look it up in `extractRasterBandAssets()`. Returns `undefined` when no asset resolves.

### `resolvePresetComposite(assets, composite)`

```ts
function resolvePresetComposite(
  assets: RasterBandAsset[],
  composite: { r: BandSlot; g: BandSlot; b: BandSlot }
): { r: string; g: string; b: string } | null;
```

Resolve a preset's R/G/B `BandSlot` triple into asset keys for this Item via `resolveBandSlotAssetKey`. Returns `null` when any of the three required slots cannot be resolved, so the caller can disable the preset rather than half-apply it.

### `hasCompositableBands(assets)`

```ts
function hasCompositableBands(assets: RasterBandAsset[]): boolean;
```

True when at least three single-band raster COG assets exist, so a manual RGB pick is viable.

### `extractMosaicAssets(item)`

```ts
function extractMosaicAssets(item: StacItem): RasterBandAsset[];
```

Same media-type and role filtering as `extractRasterBandAssets`, but does NOT drop multi-band assets. Used by the mosaic asset picker, where a 3-band pre-baked `visual` TCI is a legitimate choice alongside per-band single-band COGs. `bandCount` is reported only when known (`raster:bands.length` or `eo:bands.length`), otherwise left `undefined` so the consuming UI can probe the COG.

## Example

```ts
import {
  classifyStac,
  buildMosaicSourceMeta,
  detectMultiCogCapable,
  extractRasterBandAssets,
  resolvePresetComposite,
  spatialCellKey,
  stacItemBbox,
  type StacItem,
  type MosaicSourceMeta,
} from '@walkthru-earth/objex-utils';

const json: unknown = await fetch(url).then((r) => r.json());
const routed = classifyStac(json);

if (routed.kind === 'item-collection') {
  // Build a deduped mosaic, freshest scene per footprint.
  const seen = new Set<string>();
  const sources: MosaicSourceMeta[] = [];
  for (const item of routed.fc.features) {
    const bbox = stacItemBbox(item);
    if (!bbox) continue;
    const key = spatialCellKey(item, bbox);
    if (seen.has(key)) continue; // first per key is newest (datetime-desc)
    seen.add(key);
    const meta = buildMosaicSourceMeta(item);
    if (meta) sources.push(meta);
  }
}

if (routed.kind === 'item') {
  const item: StacItem = routed.item;
  if (detectMultiCogCapable(item)) {
    const bands = extractRasterBandAssets(item);
    // Natural color = red / green / blue slots.
    const rgb = resolvePresetComposite(bands, { r: 'red', g: 'green', b: 'blue' });
    if (rgb) {
      // rgb = { r: 'B04', g: 'B03', b: 'B02' } (or whatever keys the catalog uses)
    }
  }
}
```

## Peer dependencies

None. Every function is pure and runtime-agnostic, operating only on already-parsed JSON objects.
