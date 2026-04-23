# Cloud-Optimized GeoTIFF (COG) helpers

Pure, framework-agnostic helpers for working with Cloud-Optimized GeoTIFF metadata and bounds. No Svelte, MapLibre, deck.gl, or GeoTIFF library dependency.

Source: `src/lib/utils/cog.ts`.

> The render-pipeline helpers (`selectCogPipeline`, `createConfigurableGetTileData`, `normalizeCogGeotiff`, `createEpsgResolver`, `fitCogBounds`, `renderNonTiledBitmap`, etc.) live in the same source file but are **not** re-exported from `@walkthru-earth/objex-utils` because they pull in `@developmentseed/deck.gl-geotiff`, `@developmentseed/geotiff`, `@developmentseed/proj`, `proj4`, and `maplibre-gl`. If you need them, depend on the full Svelte package [`@walkthru-earth/objex`](https://www.npmjs.com/package/@walkthru-earth/objex) (they are re-exported from `src/lib/index.ts`) and install those optional peers yourself.

## Types

### `GeoBounds`

```ts
interface GeoBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}
```

### `CogInfo`

```ts
interface CogInfo {
  width: number;
  height: number;
  bandCount: number;
  dataType: string;      // e.g. 'uint8', 'float32', 'int16'
  bounds: GeoBounds;
  downsampled?: boolean; // true when renderNonTiledBitmap decimated the array
}
```

## Constants

### `SF_LABELS`

```ts
const SF_LABELS: Record<number, string> = {
  1: 'uint', 2: 'int', 3: 'float', 4: 'void',
  5: 'complex int', 6: 'complex float',
};
```

Human labels for the GeoTIFF SampleFormat tag.

## Functions

### `safeClamp(v, lo, hi, fallback)`

```ts
function safeClamp(v: number, lo: number, hi: number, fallback: number): number
```

Clamp `v` into `[lo, hi]`. If `v` is `NaN` or `±Infinity`, return `fallback`. Use instead of `Math.min(hi, Math.max(lo, v))` — NaN would otherwise propagate silently.

### `clampBounds(b)`

```ts
function clampBounds(b: GeoBounds): GeoBounds
```

Clamp geographic bounds to valid MapLibre Web Mercator range: ±180° longitude, ±85.051129° latitude.

### `buildDataTypeLabel(sampleFormat, bitsPerSample)`

```ts
function buildDataTypeLabel(
  sampleFormat: number,
  bitsPerSample: number
): string
```

Combine the GeoTIFF `SampleFormat` tag with `BitsPerSample` into `'uint8'`, `'int16'`, `'float32'`, etc.

## Usage outline

```ts
import {
  buildDataTypeLabel,
  clampBounds,
  safeClamp,
  SF_LABELS,
  type CogInfo,
  type GeoBounds,
} from '@walkthru-earth/objex-utils';

const label = buildDataTypeLabel(sampleFormat, bitsPerSample); // 'float32'
const safeBounds = clampBounds(bounds);
const nice = safeClamp(value, 0, 1, 0);
```
