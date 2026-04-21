# Cloud-Optimized GeoTIFF (COG) helpers

Pure helpers plus lazy wrappers for rendering Cloud-Optimized GeoTIFFs with [`@developmentseed/deck.gl-geotiff`](https://github.com/developmentseed/deck.gl-geotiff) v0.5 and MapLibre GL.

The "pure" subset (types, safe-math, data-type labels, color ramps) has no native dependencies. The rendering-oriented functions pull in `@developmentseed/geotiff`, `@developmentseed/deck.gl-geotiff`, `maplibre-gl`, `proj4`, and `@developmentseed/proj` — treat all of those as **optional** peers.

Source: `src/lib/utils/cog.ts`.

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

### `BandConfig`

```ts
interface BandConfig {
  mode: 'rgb' | 'single';
  rBand: number;           // 0-indexed
  gBand: number;
  bBand: number;
  band: number;            // single-band mode selection
  colorRamp: ColorRampId;
}
```

### `RescaleConfig`

```ts
interface RescaleConfig {
  min: number;
  max: number;
}
```

### `CogTagInfo` / `ResolvedCogPipeline`

Internal-but-exported descriptors returned by `inspectCogTags` / `selectCogPipeline`. See source for the full field list; the common shape is "metadata about which rendering pipeline should be used and why."

## Pure helpers (no peer deps)

### `SF_LABELS`

```ts
const SF_LABELS: Record<number, string> = {
  1: 'uint', 2: 'int', 3: 'float', 4: 'void',
  5: 'complex int', 6: 'complex float',
};
```

Human labels for the GeoTIFF SampleFormat tag.

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

### `defaultBandConfig(bandCount, sampleFormat)`

```ts
function defaultBandConfig(bandCount: number, sampleFormat: number): BandConfig
```

Sensible initial band config: RGB mode for ≥3 bands, single-band with a terrain ramp for int/float single-band imagery.

### `isDefaultBandConfig(config, bandCount, sampleFormat)`

```ts
function isDefaultBandConfig(
  config: BandConfig,
  bandCount: number,
  sampleFormat: number
): boolean
```

`true` when `config` equals the default for this COG — used to short-circuit custom-pipeline selection.

### Color ramps

```ts
type ColorRampId = 'grayscale' | 'terrain' | 'viridis' | 'magma' | 'turbo' | 'spectral';

const COLOR_RAMP_STOPS: Record<ColorRampId, [number, number, number][]>;

function interpolateRamp(
  stops: [number, number, number][],
  t: number
): [number, number, number];

function rampToGradientCss(id: ColorRampId): string;
```

`interpolateRamp(stops, t)` returns an RGB triple for normalized `t ∈ [0, 1]` (clamped). `rampToGradientCss` produces a CSS `linear-gradient(...)` string for UI previews.

## Pipeline helpers (require peer deps)

### `inspectCogTags(geotiff)`

```ts
function inspectCogTags(geotiff: GeoTIFF): CogTagInfo
```

Centralized reader for the TIFF tags that determine which render pipeline to use (Photometric.Palette, SampleFormat, ColorMap, etc.).

### `needsCustomPipeline(geotiff)`

```ts
function needsCustomPipeline(geotiff: GeoTIFF): boolean
```

`true` when the library's `inferRenderPipeline` can't handle this COG (non-uint sample formats). Triggers the custom JS pipeline.

### `needsCustomPipelineForConfig(geotiff, config)`

```ts
function needsCustomPipelineForConfig(
  geotiff: GeoTIFF,
  config: BandConfig
): boolean
```

`true` when `config` deviates from what the library default pipeline supports (non-standard RGB band order, single-band mode, non-uint, non-palette).

### `createCustomGetTileData(geotiff)` / `customRenderTile(data)`

```ts
function createCustomGetTileData(
  geotiff: GeoTIFF
): (image, options) => Promise<CustomTileData>;

function customRenderTile(data: CustomTileData): { image: ImageData };
```

Band-0-only fallback path for non-uint COGs. Uses GDAL statistics when available, otherwise per-tile adaptive stretch, and applies the `terrain` color ramp.

### `createConfigurableGetTileData(geotiff, config)`

```ts
function createConfigurableGetTileData(
  geotiff: GeoTIFF,
  config: BandConfig
): (image, options) => Promise<CustomTileData>
```

Band-selectable variant. Honors `BandConfig.mode` (`'rgb'` vs `'single'`) and `colorRamp`.

### `isRescaleActive(cfg)` / `createRescaledPipeline(geotiff, rescale)`

```ts
function isRescaleActive(cfg: RescaleConfig): boolean;

function createRescaledPipeline(
  geotiff: GeoTIFF,
  rescale: RescaleConfig
): { getTileData: Function; renderTile: Function };
```

GPU-side LinearRescale module appended to the library default uint pipeline. Only meaningful for uint COGs whose shape / colormap falls inside the library default — see `selectCogPipeline` for the dispatch rules.

### `selectCogPipeline(geotiff, opts?)`

```ts
function selectCogPipeline(
  geotiff: GeoTIFF,
  opts?: SelectCogPipelineOptions
): ResolvedCogPipeline
```

Single entry point that returns the correct `{ getTileData, renderTile }` pair for a given COG + config. Four outcomes in priority order:

1. Custom configurable — band swap or color ramp change is active and the config is non-default.
2. Custom non-uint — Int/Float COG without an explicit config yet.
3. Library default + LinearRescale — uint COG with `rescale` active.
4. Library default — everything else (empty object is returned; `COGLayer` uses its built-ins).

### `normalizeCogGeotiff(geotiff)`

```ts
function normalizeCogGeotiff(geotiff: GeoTIFF): void
```

Apply in-place upstream workarounds:

- Drop overview IFDs smaller than one tile (cause proj4 NaN on polar projections).
- Clamp EPSG:4326 bbox to ±85.051129° latitude (Web Mercator safe range).

Idempotent — safe to call repeatedly.

### `createEpsgResolver()`

```ts
function createEpsgResolver(): (code: number) => Promise<ProjectionDefinition>
```

Async factory returning an `epsgResolver` compatible with `@developmentseed/deck.gl-geotiff`'s `COGLayer` prop of the same name. Looks up numeric EPSG codes in the bundled `@developmentseed/epsg` gzipped CSV and parses each WKT with `parseWkt()` from `@developmentseed/proj`. Throws a clear `Error` if the code is not present.

Replaces runtime `epsg.io` fetches — first COG per session pulls the CSV (~200 KB gzipped) once.

### Pixel / CRS helpers

```ts
function readPixelAtLngLat(
  geotiff: GeoTIFF,
  lng: number,
  lat: number,
  proj4Def: string | null,
  pool: any,
  signal?: AbortSignal
): Promise<PixelValue | null>;

function resolveProj4Def(
  crs: number | unknown,
  signal: AbortSignal
): Promise<string | null>;
```

`readPixelAtLngLat` converts `(lng, lat)` into source CRS, then pixel coords, and reads every band. Returns `null` when outside the raster.

`resolveProj4Def` returns a proj4-compatible WKT/ProjJSON string for a CRS identifier, or `null` for WGS84 / unknown.

### MapLibre helpers

```ts
function getMaxTextureSize(map: maplibregl.Map): number;     // fallback 4096

function fitCogBounds(map: maplibregl.Map, b: GeoBounds): void;

function cleanupNativeBitmap(map: maplibregl.Map): void;    // idempotent

function renderNonTiledBitmap(options: {
  url: string;
  map: maplibregl.Map;
  signal?: AbortSignal;
  geotiff?: GeoTIFF;
}): Promise<CogInfo>;
```

`renderNonTiledBitmap` is the fallback path for non-tiled GeoTIFFs: opens the file, reads band 0, normalizes to grayscale RGBA (terrain ramp for single-band int/float), adds a MapLibre native `image` source. Throws when the raster exceeds 100 M pixels or projection bounds cannot be computed.

## Usage outline

```ts
import {
  defaultBandConfig,
  selectCogPipeline,
  normalizeCogGeotiff,
  createEpsgResolver,
  fitCogBounds,
  clampBounds,
} from '@walkthru-earth/objex-utils';

normalizeCogGeotiff(geotiff);
const config = defaultBandConfig(geotiff.bandCount, sampleFormat);
const pipeline = selectCogPipeline(geotiff, { bandConfig: config });
const resolver = createEpsgResolver();

// feed into COGLayer({ ...pipeline, epsgResolver: resolver })

fitCogBounds(map, clampBounds(bounds));
```
