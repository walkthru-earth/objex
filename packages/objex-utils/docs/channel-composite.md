# Channel composite presets and URL round-trip

RGB composite presets (Natural Color, False-Color IR, SWIR, ...) and the `URLSearchParams` round-trip for the unified RGB picker. Pure TypeScript, publishable via objex-utils.

Source: `packages/objex-utils/src/channel-composite.ts`.

Presets describe a semantic band-slot triple (`red`/`green`/`blue` for Natural Color, `nir`/`red`/`green` for False-Color IR, ...). Resolving a preset against a specific item walks the band-key fallbacks in [`stac`](./stac.md) (via `resolvePresetComposite`) to map slots to actual asset keys on that item. NDVI and other single-band derived presets are intentionally not in this list.

This module builds on the [`CogAsset` / `ChannelComposite`](./cog-asset.md) types and the [`BandSlot`](./stac.md) vocabulary.

## Types

### `PresetDef`

```ts
interface PresetDef {
  id: string;
  labelKey: string;
  slots: { r: BandSlot; g: BandSlot; b: BandSlot };
}
```

A preset definition. `id` is the stable string written into the URL (`?preset=...`), `labelKey` is the i18n key for its display label, and `slots` is the semantic band-slot triple ([`BandSlot`](./stac.md): `'red' | 'green' | 'blue' | 'nir' | 'swir1' | 'swir2' | 'rededge'`).

## Constants

### `PRESETS`

```ts
const PRESETS: PresetDef[]
```

The built-in preset list, in display order:

| `id` | `labelKey` | r / g / b slots |
|------|-----------|-----------------|
| `natural-color` | `map.multiCogPreset.trueColor` | `red` / `green` / `blue` |
| `false-color-ir` | `map.multiCogPreset.falseColorIR` | `nir` / `red` / `green` |
| `swir` | `map.multiCogPreset.swir` | `swir2` / `swir1` / `red` |
| `vegetation` | `map.multiCogPreset.vegetation` | `nir` / `swir1` / `red` |
| `agriculture` | `map.multiCogPreset.agriculture` | `swir1` / `nir` / `blue` |

## Functions

### `availablePresets(assets)`

```ts
function availablePresets(assets: CogAsset[]): PresetDef[]
```

Return the subset of `PRESETS` whose slot triple actually resolves on this item, i.e. every slot maps to a present asset. Use this to render only the presets that will produce a valid composite for the loaded item.

### `applyPreset(assets, preset)`

```ts
function applyPreset(assets: CogAsset[], preset: PresetDef): ChannelComposite | null
```

Resolve a preset to a `ChannelComposite` for this item. Each resolved channel binds to its asset key at band index `0`. Returns `null` when the preset's slots do not all resolve against `assets`.

### `presetMatchesComposite(preset, c, assets)`

```ts
function presetMatchesComposite(
  preset: PresetDef,
  c: ChannelComposite,
  assets: CogAsset[]
): boolean
```

`true` when the preset, resolved against `assets`, still matches the user's current composite `c`. The match requires the `r`/`g`/`b` asset keys to be equal and all three band indices on `c` to be `0`. Returns `false` when the preset does not resolve. Use this to highlight which preset (if any) corresponds to the user's current manual picks.

### `compositeFromUrl(params, assets)`

```ts
function compositeFromUrl(
  params: URLSearchParams,
  assets: CogAsset[]
): ChannelComposite | null
```

Decode a `URLSearchParams` chunk into a `ChannelComposite`.

**Format** `r=<asset>&g=<asset>&b=<asset>&band_r=<n>&band_g=<n>&band_b=<n>` plus optional `a=<asset>&band_a=<n>`. Each `band_*` defaults to `0` when absent, so legacy MultiCog URLs such as `?r=red&g=green&b=blue&preset=true-color` keep round-tripping.

**Returns** `null` when any required key (`r`, `g`, or `b`) is missing, or when any of the named `r`/`g`/`b` asset keys is not present in `assets`. The optional alpha channel is only added when its `a` key resolves to a known asset; an unresolvable `a` is silently dropped rather than failing the whole parse.

**Band clamping** Each `band_*` value is parsed as a number, floored, and clamped into `[0, bandCount - 1]` for the corresponding asset. A missing, non-finite, or negative value becomes `0`; a value at or beyond `bandCount` becomes `bandCount - 1` (or `0` when `bandCount` is non-positive).

### `compositeToUrl(c, presetId)`

```ts
function compositeToUrl(c: ChannelComposite, presetId: string | null): URLSearchParams
```

Encode a composite plus the active preset id into `URLSearchParams` for the URL hash.

**Encoding** Always writes `r`, `g`, `b` asset keys. A `band_*` key is written only when that channel's band index is non-zero (so default-band composites stay compact). The optional alpha channel adds `a` (and `band_a` when non-zero). `preset` is written only when `presetId` is non-null. The result is the inverse of `compositeFromUrl` for any composite whose band indices are valid.

## Example

```ts
import {
  PRESETS,
  availablePresets,
  applyPreset,
  presetMatchesComposite,
  compositeFromUrl,
  compositeToUrl,
} from '@walkthru-earth/objex-utils';

// Which presets work on this item?
const usable = availablePresets(assets); // subset of PRESETS

// Apply False-Color IR if it resolves.
const ir = PRESETS.find((p) => p.id === 'false-color-ir');
const composite = ir ? applyPreset(assets, ir) : null;

// Round-trip through the URL hash.
if (composite) {
  const params = compositeToUrl(composite, 'false-color-ir');
  // 'r=B08&g=B04&b=B03&preset=false-color-ir'

  const decoded = compositeFromUrl(params, assets); // ChannelComposite | null
  const active = ir ? presetMatchesComposite(ir, composite, assets) : false; // true
}
```
