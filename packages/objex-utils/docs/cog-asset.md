# COG asset enumeration

Vendor-neutral per-channel COG asset descriptors for the unified RGB picker. Pure TypeScript, no Svelte dependency. Reads `raster:bands.length` and `eo:bands` from STAC metadata without any network access.

Source: `packages/objex-utils/src/cog-asset.ts`.

`CogAsset` is the canonical shape every objex raster viewer (`CogViewer`, `MultiCogViewer`, `StacMosaicViewer`) hands to the shared ChannelPicker UI. The `self` key is used when the viewer is a single bare COG file with no STAC context.

## Types

### `CogAsset`

```ts
interface CogAsset {
  key: string;
  href: string;
  bandCount: number;
  bandCountKnown: boolean;
  dtype?: string;
  eoCommon: string[];
  roles: string[];
  title?: string;
  mediaType?: string;
}
```

| Field | Meaning |
|-------|---------|
| `key` | STAC asset key (`red`, `B04`, `image`, `visual`, ...), or `'self'` for a single bare COG without STAC context. |
| `href` | Absolute or relative href as it appears in the STAC item / URL. |
| `bandCount` | Number of bands in the asset. `1` by default until a band source is found or the COG header is probed. |
| `bandCountKnown` | `true` when `bandCount` came from STAC metadata or a probe; `false` means the default `1` is a placeholder and the caller should lazily probe on first pick. |
| `dtype` | `raster:bands[0].data_type` if known. |
| `eoCommon` | `eo:bands[].common_name` (or unified `bands[].common_name`) lowercased, aligned to band-index order. Entries are `''` where no common name is present. |
| `roles` | STAC asset roles (`data`, `visual`, `reflectance`, ...). |
| `title` | Optional human title. |
| `mediaType` | Asset media type as advertised by STAC. |

### `ChannelRef`

```ts
interface ChannelRef {
  assetKey: string;
  bandIndex: number;
}
```

A single per-channel pixel coordinate inside a STAC item: which asset, and which band within it.

### `ChannelComposite`

```ts
interface ChannelComposite {
  r: ChannelRef;
  g: ChannelRef;
  b: ChannelRef;
  a?: ChannelRef;
}
```

An RGB(A) composite, one `ChannelRef` per channel. The alpha channel is optional.

## Functions

### `extractCogAssets(item)`

```ts
function extractCogAssets(item: StacItem): CogAsset[]
```

Enumerate every TIFF/COG asset on a STAC Item, keeping multi-band assets (NAIP `image`, Sentinel-2 `visual` TCI) alongside single-band per-band assets.

**Filtering** Only assets with an `href` and a TIFF/GeoTIFF media type (`image/tiff` or `image/geotiff`, case-insensitive) are kept. Assets whose `type` is absent are still kept. Assets whose roles include `thumbnail`, `overview`, or `metadata` are skipped.

**`bandCount` source priority** (first present wins):

1. `asset.bands` (STAC 1.1 unified bands array)
2. `asset['raster:bands']` (STAC 1.0 raster extension)
3. `asset['eo:bands']` (STAC 1.0 eo extension)
4. `item.properties.bands` (STAC 1.1 item-level bands, applies to all assets that do not override their own)

The item-level fallback covers catalogs (Hamilton NAIP-style 4-band COGs) which keep band metadata at the item-properties level while the single `data` asset carries none of its own. When none of the four sources yields a positive count, `bandCount` defaults to `1` with `bandCountKnown: false`.

**`eoCommon` source** Independent of the `bandCount` source. Prefers `eo:bands` (the only field guaranteed to carry `common_name` before STAC 1.1), then the unified `bands`, then item-level `properties.bands`. `raster:bands` is skipped for this lookup because it typically has no `common_name`.

**`dtype` source** First entry's `data_type` from `raster:bands`, then unified `bands`, then item-level `bands`.

**Returns** `CogAsset[]`, in the order assets appear on the item.

### `syntheticSelfAsset(href, probedBandCount?)`

```ts
function syntheticSelfAsset(href: string, probedBandCount?: number): CogAsset
```

Build a single synthetic asset with key `'self'` for `CogViewer` (a single bare COG file, no STAC context) so the same ChannelPicker UI works without special-casing.

**Parameters**

| Name | Type | Meaning |
|------|------|---------|
| `href` | `string` | The COG URL. |
| `probedBandCount` | `number` (optional) | The probed `geotiff.count`, once known. |

`bandCount` defaults to `1` with `bandCountKnown: false`. When `probedBandCount` is a positive number, `bandCount` is set to it and `bandCountKnown` becomes `true`. `eoCommon` and `roles` are empty arrays.

### `pickNaturalColorComposite(assets)`

```ts
function pickNaturalColorComposite(
  assets: CogAsset[]
): { composite: ChannelComposite; source: 'visual-asset' | 'rgb-bands' | 'fallback' } | null
```

Pick the most natural and most performant default composite for an item.

**Priority** (first match wins):

1. **`'visual-asset'`** -- a 3-band pre-baked visual asset (`bandCount === 3` and either `roles` contains `visual` or `eoCommon` contains all of `red`/`green`/`blue`). All three channels bind to that one asset, using the `eoCommon` index for each color where present and falling back to bands 0/1/2. Single-layer path, one decoder, fastest.
2. **`'rgb-bands'`** -- separate single-band assets resolvable by common name, where `eoCommon[0]` is `red`, `green`, and `blue` respectively across three distinct assets. Each channel binds to its asset at band 0.
3. **`'fallback'`** -- the first three raster assets, band 0 each. When fewer than three assets exist, the single remaining asset is reused for all three channels: R at band 0, G at `min(1, last)`, B at `min(2, last)`, where `last = max(0, bandCount - 1)`.

**Returns** `{ composite, source }`, or `null` when `assets` is empty.

### `isSingleAssetComposite(c)`

```ts
function isSingleAssetComposite(c: ChannelComposite): boolean
```

`true` when all three RGB channels (`r`, `g`, `b`) target the same asset key. The optional alpha channel is not considered.

### `allChannelsBand0(c)`

```ts
function allChannelsBand0(c: ChannelComposite): boolean
```

`true` when all three RGB channels are at band index `0` (the MultiCOGLayer-compatible case). The optional alpha channel is not considered.

## Example

```ts
import {
  extractCogAssets,
  syntheticSelfAsset,
  pickNaturalColorComposite,
  isSingleAssetComposite,
  allChannelsBand0,
} from '@walkthru-earth/objex-utils';

// From a STAC item:
const assets = extractCogAssets(item);
const pick = pickNaturalColorComposite(assets);
if (pick) {
  console.log(pick.source); // 'visual-asset' | 'rgb-bands' | 'fallback'
  console.log(isSingleAssetComposite(pick.composite)); // true for a pre-baked visual
  console.log(allChannelsBand0(pick.composite));        // true for the rgb-bands path
}

// From a single bare COG:
const self = syntheticSelfAsset('https://example.com/scene.tif', 4);
// { key: 'self', bandCount: 4, bandCountKnown: true, eoCommon: [], roles: [], ... }
```
