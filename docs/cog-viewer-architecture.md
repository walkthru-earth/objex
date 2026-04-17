# COG Viewer Architecture & Known Issues

> Reference for CogViewer.svelte using `@developmentseed/deck.gl-geotiff` v0.4.
> Last updated: 2026-03-26

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Rendering Routes](#rendering-routes)
- [Pre-flight Pipeline](#pre-flight-pipeline)
- [Workarounds for v0.3 Bugs](#workarounds-for-v03-bugs)
- [Extracted Utilities](#extracted-utilities)
- [Upstream Issues to Track](#upstream-issues-to-track)
- [Test COGs & Results](#test-cogs--results)
- [Vite Configuration](#vite-configuration)
- [History (v0.2 → v0.3)](#history-v02--v03)

---

## Architecture Overview

The CogViewer renders Cloud-Optimized GeoTIFF (COG) files on a MapLibre map using deck.gl.

### Stack

```
┌──────────────────────────────────────────────────────┐
│  CogViewer.svelte + CogControls.svelte               │
│  ├─ Pre-flight: GeoTIFF.fromUrl() → CRS + tiling check│
│  ├─ Route: tiled-uint → COGLayer (default pipeline)  │
│  ├─ Route: tiled-int/float → COGLayer (custom pipeline)│
│  ├─ Route: non-tiled → bitmap fallback               │
│  ├─ Band/color controls → rebuild layer on change    │
│  └─ Pixel inspector → click → read tile → show values│
└──────────────────────────────────────────────────────┘
         ↓                           ↓
┌──────────────────────┐  ┌────────────────────────────────┐
│ COGLayer (v0.4)      │  │ utils/cog.ts                   │
│ ├─ RasterLayer (GPU) │  │ ├─ renderNonTiledBitmap()      │
│ ├─ TileMatrixSet     │  │ ├─ createConfigurableGetTileData│
│ └─ inferRenderPipeline│  │ ├─ readPixelAtLngLat()        │
└──────────────────────┘  │ ├─ COLOR_RAMP_STOPS, BandConfig│
         ↓                │ └─ safeClamp, clampBounds      │
┌──────────────────────┐  └────────────────────────────────┘
│ @developmentseed/    │
│   geotiff (cogeotiff)│
│ ├─ DecoderPool       │
│ ├─ Nodata masking    │
│ └─ Tile streaming    │
└──────────────────────┘
```

### Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@developmentseed/deck.gl-geotiff` | ^0.4.0 | COGLayer, GPU render pipeline, epsgResolver |
| `@developmentseed/geotiff` | ^0.4.0 | GeoTIFF reader (wraps `@cogeotiff/core`), DecoderPool |
| `@deck.gl/mapbox` | ^9.2.11 | MapboxOverlay for deck.gl ↔ MapLibre integration |
| `maplibre-gl` | ^5.20.1 | Base map + native image source (non-tiled fallback) |
| `proj4` | ^2.20.4 | CRS reprojection (non-tiled bitmap bounds only) |

### What v0.3 Handles Natively (default pipeline)

- **Photometric interpretations**: RGB, Palette, CMYK, YCbCr, CIELab, Gray (BlackIsZero/WhiteIsZero)
- **Sample formats**: **uint only** (uint8/16/32) — signed int and float need custom pipeline
- **Compressions**: LZW, JPEG, Deflate, ZSTD, WebP, LERC (via DecoderPool workers)
- **CRS resolution**: Default `epsgResolver` queries epsg.io, caches results, parses with `wkt-parser`
- **Reprojection**: GPU-based adaptive mesh (Delaunay triangulation with bounded error)
- **Nodata masking**: Automatic detection and application of mask IFDs
- **Overview selection**: Automatic resolution selection based on zoom level

---

## Rendering Routes

### Route 1: Tiled COG — Default Pipeline (uint)

**When**: `isTiled && !needsCustomPipeline()` (SampleFormat === 1/uint)

```
URL → pre-flight GeoTIFF.fromUrl()
    → filter oversized overviews
    → COGLayer({ geotiff: preflightGeotiff })
    → library's inferRenderPipeline()
    → GPU shader modules (CreateTexture, FilterNoDataVal, MaskTexture, Colormap, etc.)
    → MapboxOverlay → MapLibre
```

This is the happy path. The library handles everything:
- Opens the COG, resolves CRS via `epsgResolver`, generates TileMatrixSet
- Creates proj4 converters for reprojection
- Infers the appropriate GPU shader pipeline from photometric interpretation
- Fetches tiles on demand, decodes via DecoderPool, uploads to GPU textures

**Key props passed to COGLayer:**
- `geotiff` — pre-opened GeoTIFF instance (avoids double fetch)
- `pool` — workerless `DecoderPool()` (see [DecoderPool Workers](#3-decoderpool-workers-fail-in-vite-dev-mode))
- `signal` — AbortSignal for cancellation
- `onGeoTIFFLoad` — metadata extraction callback
- `onError` — error display callback

### Route 2: Tiled COG — Custom Pipeline (signed int / float)

**When**: `isTiled && needsCustomPipeline()` (SampleFormat === 2/int or 3/float)

```
URL → pre-flight GeoTIFF.fromUrl()
    → filter oversized overviews
    → detect non-uint via needsCustomPipeline()
    → COGLayer({ geotiff, getTileData: custom, renderTile: custom })
    → custom getTileData: fetchTile → normalize band 0 → grayscale RGBA ImageData
    → custom renderTile: returns ImageData directly to RasterLayer
    → MapboxOverlay → MapLibre
```

v0.3's `inferRenderPipeline()` throws for non-uint sample formats:
```
Error: Inferring render pipeline for non-unsigned integers not yet supported.
Found SampleFormat: 2,2,2,...
```

Our workaround: provide custom `getTileData` + `renderTile` callbacks that:
1. Fetch the tile via `image.fetchTile(x, y, { pool, signal })`
2. Extract band 0 (first band only — multi-band visualization not yet supported)
3. Normalize values to [0, 255] using GDAL statistics or data-type range fallback
4. Create grayscale RGBA `ImageData`
5. Return `ImageData` to `RasterLayer` (which accepts it directly)

**Normalization logic:**
- If GDAL `storedStats` available (band 1 min/max): use those
- Signed int fallback: `[-2^(bps-1), 2^(bps-1)-1]` (e.g., [-128, 127] for Int8)
- Float fallback: `[0, 1]` (conservative default)

### Route 3: Non-tiled TIFF (bitmap fallback)

**When**: `!isTiled`

```
URL → GeoTIFF.fromUrl() → computeGeographicBounds()
    → fetchTile(0, 0) → normalize → canvas → dataURL
    → MapLibre addSource('image') + addLayer('raster')
```

`GeoTIFFLayer` is not yet exported in v0.3 (WIP — throws "not yet implemented"). Non-tiled TIFFs are rendered as a bitmap via MapLibre's native image source:

1. Open with `GeoTIFF.fromUrl(url)` — reads first IFD
2. Compute geographic bounds via edge-sampling (5 points per edge, proj4)
3. Size gate: refuse > 100M pixels with helpful `gdal_translate` suggestion
4. Cap to GPU `MAX_TEXTURE_SIZE` (4096 mobile, 8192-16384 desktop)
5. Fetch entire raster via `fetchTile(0, 0)` (non-tiled = single strip)
6. Compute band 0 min/max, normalize to grayscale RGBA
7. Render to canvas → dataURL → MapLibre `addSource('image')` + `addLayer('raster')`

### Route 4: Unsupported CRS (error)

**When**: `geotiff.crs` throws (e.g., GeoTIFF model type 32767)

Shows error message: `Unsupported CRS: Unsupported GeoTIFF model type: 32767`

See [User-Defined CRS](#1-user-defined-crs-geotiff-model-type-32767) for details.

---

## Pre-flight Pipeline

Every COG load goes through a pre-flight phase that reads the first IFD and performs validation before creating the COGLayer:

```
1. GeoTIFF.fromUrl(url)              → opens file, reads first IFD
2. Check isTiled                      → routes to bitmap fallback if false
3. Validate CRS (geotiff.crs)        → catches unsupported model types
4. Filter oversized overviews         → prevents NaN projection errors
5. Check needsCustomPipeline()        → detects non-uint sample formats
6. Create COGLayer with appropriate props
```

The pre-flight GeoTIFF instance is passed directly to COGLayer via `geotiff: preflightGeotiff`, avoiding a redundant second HTTP fetch.

---

## Workarounds for v0.3 Bugs

### 1. User-Defined CRS (GeoTIFF Model Type 32767)

**Bug**: `@developmentseed/geotiff`'s `crsFromGeoKeys()` only handles model types 1 (Projected) and 2 (Geographic). Model type 32767 ("user-defined") throws:
```
Error: Unsupported GeoTIFF model type: 32767
```

**Affected COGs**: Mollweide, Eckert IV/VI, Goode Homolosine, Van der Grinten, Robinson, Sinusoidal — any projection that uses `GTModelTypeGeoKey = 32767` instead of the standard model type 1 with `ProjectedCSTypeGeoKey = 32767`.

**Note**: The library DOES handle user-defined projected CRS when `GTModelTypeGeoKey = 1` and `ProjectedCSTypeGeoKey = 32767` — it calls `_buildProjectedCrs(gkd)` which has an extensive switch statement covering Transverse Mercator, Lambert, Albers, Sinusoidal, and many others. The bug is specifically when `GTModelTypeGeoKey` itself is 32767.

**Our workaround**: Catch the error in pre-flight and show a clear error message.

**Proper fix**: The library's `crsFromGeoKeys()` should handle model type 32767 by checking for projection parameters (e.g., `gkd.projMethod`) and treating it as a projected CRS. This is a simple fix — just add:
```js
if (modelType === 32767 && gkd.projMethod !== null) {
  return _projectedCrs(gkd); // or _buildProjectedCrs(gkd)
}
```

**Where to track**: [`@developmentseed/geotiff`](https://github.com/developmentseed/deck.gl-raster) — file issue on `packages/geotiff/src/crs.ts`

**Additional context**: Even with this fix, some pseudo-cylindrical projections (Mollweide, Eckert) are NOT in the library's coordinate transform table (`_buildConversion` switch statement). The library supports: Transverse Mercator, Oblique Mercator, Lambert (1SP/2SP), Albers, Azimuthal Equidistant, Stereographic (polar/oblique), Equirectangular, Cassini-Soldner, Polyconic, Sinusoidal, Orthographic. Missing: Mollweide, Eckert IV/VI, Robinson, Van der Grinten, Goode Homolosine, Winkel Tripel.

### 2. Non-uint `inferRenderPipeline` (Signed Int / Float)

**Bug**: `inferRenderPipeline()` in `@developmentseed/deck.gl-geotiff` only supports `SampleFormat.Uint`. For signed int (SF=2) and float (SF=3), it throws:
```
Error: Inferring render pipeline for non-unsigned integers not yet supported.
Found SampleFormat: 2,2,2,...
```

**Our workaround**: Provide custom `getTileData`/`renderTile` callbacks via `createCustomGetTileData()` and `customRenderTile()` in `utils/cog.ts`. These read band 0, normalize to grayscale, and return `ImageData`.

**Limitations of our workaround**:
- Only renders band 0 (no multi-band visualization)
- Single grayscale channel (no color ramps or band math)
- Uses GDAL statistics or data-type range for normalization (not per-tile adaptive)

**Proper fix**: The library should extend `inferRenderPipeline` to handle signed integers and floats. For signed ints, the data could be shifted to unsigned range before GPU upload. For floats, a normalization shader module could map values to [0, 1].

**Where to track**: [`@developmentseed/deck.gl-geotiff`](https://github.com/developmentseed/deck.gl-raster) — file issue on `packages/deck.gl-geotiff/src/geotiff/render-pipeline.ts`

### 3. Oversized Overviews → NaN Projection → "Invalid number null"

**Bug**: `generateTileMatrixSet()` in `@developmentseed/geotiff` includes ALL overviews in the TileMatrixSet, even those where the overview image is smaller than a single tile (e.g., a 1×1 pixel overview with 1024×1024 tile size).

When the tile size exceeds the image size, the tile's geographic extent is MUCH larger than the actual image — for a 1×1 overview with 1024×1024 tiles, the tile extends to `1024 × cellSize` in each direction, which for the coarsest overview can cover the entire Earth multiple times over.

When `sampleReferencePointsInEPSG3857()` in `@developmentseed/deck.gl-raster` samples points within this oversized tile extent, many points fall far outside the valid domain of the source CRS (e.g., UTM zones are only valid within a 6° band). `proj4.forward()` returns `NaN` for these out-of-domain coordinates, which propagates through:

```
sampleReferencePointsInEPSG3857(tile bounds, projectTo3857)
  → proj4.forward([x, y]) returns [NaN, NaN]
  → rescaleEPSG3857ToCommonSpace([NaN, NaN]) returns [NaN, NaN]
  → makeOrientedBoundingBoxFromPoints([[NaN, NaN, 0], ...])
  → dot product with NaN → checkNumber(NaN)
  → Error: "Invalid number null"   (JSON.stringify(NaN) === "null")
```

**Note**: The error message says `null` because `JSON.stringify(NaN)` produces `"null"` — the actual value is `NaN`, not `null`.

**Our workaround**: Filter out oversized overviews in pre-flight:
```typescript
const validOverviews = geotiff.overviews.filter(
  (ov) => ov.width >= ov.tileWidth && ov.height >= ov.tileHeight
);
(geotiff as any).overviews = validOverviews;
```

This mutates the GeoTIFF's `overviews` array before passing to COGLayer. The `overviews` property is `readonly` in TypeScript but mutable at runtime.

**Impact**: For a COG with many overviews (e.g., 13 overviews for an 8192×8192 image with 1024×1024 tiles), we keep only 3-4 and discard 9-10. This means the coarsest available overview is larger than ideal — at low zoom, more tiles are loaded than necessary. At high zoom, rendering is unaffected.

**Proper fix**: `generateTileMatrixSet()` should skip overviews where `width < tileWidth || height < tileHeight`, or `sampleReferencePointsInEPSG3857()` should clamp sample points to the actual image extent.

**Where to track**:
- `generateTileMatrixSet`: [`@developmentseed/geotiff`](https://github.com/developmentseed/deck.gl-raster) — `packages/geotiff/src/tile-matrix-set.ts`
- `sampleReferencePointsInEPSG3857`: [`@developmentseed/deck.gl-raster`](https://github.com/developmentseed/deck.gl-raster) — `packages/deck.gl-raster/src/raster-tileset/raster-tile-traversal.ts`

### 4. EPSG:4326 Polar Singularity → NaN in EPSG:3857 Projection

**Bug**: `proj4.forward([lon, ±90])` from EPSG:4326 to EPSG:3857 returns `[NaN, NaN]`. The Mercator projection is mathematically undefined at the poles (lat = ±90°). In JavaScript, `Math.log(Math.tan(Math.PI/4 + Math.PI/4))` returns `NaN` due to floating-point evaluation of `tan(π/2)`.

**Affected COGs**: Any global EPSG:4326 COG with bbox extending to ±90° latitude. Example: GEBCO 2024 (86400×43200, bbox = [−180, −90, 180, 90]).

**Symptom**: `initialization of TileLayer: Invalid number null` — same as bug #3 but caused by polar NaN instead of oversized overviews. The error message says "null" because `JSON.stringify(NaN) === "null"`.

**Root cause flow**:
```
Tile at top/bottom row has corners at lat = ±90°
  → sampleReferencePointsInEPSG3857 projects sample points
  → projectTo3857(lon, ±90) calls proj4.forward([lon, ±90])
  → proj4 returns [NaN, NaN]
  → rescaleEPSG3857ToCommonSpace([NaN, NaN]) returns [NaN, NaN]
  → makeOrientedBoundingBoxFromPoints fails with NaN in dot product
```

**Our workaround** (two-part fix):

**Part A — Clamp bbox**: Override the GeoTIFF `bbox` getter to clamp latitude to ±85.051129° before `generateTileMatrixSet` uses it for the TMS `boundingBox`:
```typescript
if (preflightGeotiff.crs === 4326) {
  const [x0, y0, x1, y1] = preflightGeotiff.bbox;
  if (y0 <= -85.051129 || y1 >= 85.051129) {
    Object.defineProperty(preflightGeotiff, 'bbox', {
      value: [x0, Math.max(y0, -85.051129), x1, Math.min(y1, 85.051129)]
    });
  }
}
```

This alone is NOT sufficient — the TMS `boundingBox` is clamped, but individual tile matrices still have `pointOfOrigin` at lat=90° (from the overview transforms). Tiles in the first/last rows still project polar coordinates to NaN.

**Part B — Patch `COGLayer.prototype.setState`**: Wrap the `forwardTo3857` and `forwardTo4326` projection functions with NaN guards. When `_parseGeoTIFF` calls `setState({ forwardTo3857, ... })`, our patch intercepts and wraps the functions:

```typescript
const WM_HALF = 20037508.342789244;

function wrapProjection(fn) {
  return (x, y) => {
    const r = fn(x, y);
    if (Number.isNaN(r[0]) || Number.isNaN(r[1])) {
      return [
        Number.isNaN(r[0]) ? 0 : r[0],
        Number.isNaN(r[1]) ? (y > 0 ? WM_HALF : -WM_HALF) : r[1],
      ];
    }
    return r;
  };
}

const OrigSetState = COGLayer.prototype.setState;
COGLayer.prototype.setState = function(state) {
  if (state.forwardTo3857) state.forwardTo3857 = wrapProjection(state.forwardTo3857);
  if (state.forwardTo4326) state.forwardTo4326 = wrapProjection(state.forwardTo4326);
  return OrigSetState.call(this, state);
};
```

When proj4 returns `[NaN, NaN]` for polar coordinates, the wrapper substitutes:
- `x = 0` (center of the map)
- `y = ±WM_HALF` (edge of Web Mercator, sign matches input latitude hemisphere)

This produces valid bounding volumes for polar tiles. The tiles still render — they just get extreme-but-valid EPSG:3857 coordinates. Web Mercator can't display content beyond ±85.051129° anyway, so the visual impact is that polar tiles render at the map edge.

**Proper fix**: The library's `forwardTo3857` and `forwardTo4326` functions (created in `_parseGeoTIFF` in `cog-layer.ts`) should wrap proj4 calls with NaN guards. Alternatively, `sampleReferencePointsInEPSG3857()` should skip NaN results when sampling tile bounds.

**Where to track**:
- `_parseGeoTIFF`: [`@developmentseed/deck.gl-geotiff`](https://github.com/developmentseed/deck.gl-raster) — `packages/deck.gl-geotiff/src/cog-layer.ts` (lines where `forwardTo3857`/`forwardTo4326` are created)
- `sampleReferencePointsInEPSG3857`: [`@developmentseed/deck.gl-raster`](https://github.com/developmentseed/deck.gl-raster) — `packages/deck.gl-raster/src/raster-tileset/raster-tile-traversal.ts`

### 5. DecoderPool Workers Fail in Vite Dev Mode

**Bug**: `defaultDecoderPool()` in `@developmentseed/geotiff` creates Web Workers using:
```js
new Worker(new URL("./worker.js", import.meta.url), { type: "module" })
```

In Vite dev mode, this fails because:
- Vite's dep optimizer pre-bundles the geotiff package
- The worker URL resolves to a path through the Vite dev server
- The dev server serves the worker file with an incorrect/empty MIME type
- Firefox rejects it: `Loading Worker was blocked because of a disallowed MIME type ("")`
- Multiple `NS_ERROR_CORRUPTED_CONTENT` errors in console

The workers are created successfully (the `Worker` constructor doesn't throw), but they can't execute their script. When COGLayer tries to decode tiles through the pool, the workers silently fail.

**Our workaround**: Create a workerless `DecoderPool` and pass it explicitly:
```typescript
const pool = new DecoderPool(); // No createWorker → main-thread fallback
new COGLayer({ pool, ... });
```

When `DecoderPool` has no workers (`hasWorkers === false`), it falls back to main-thread decoding via the standard `decode()` function. This is reliable but synchronous — ZSTD decompression blocks the main thread for 50-200ms per tile.

**Impact**: Tile decoding is slower (main thread vs workers). For COGs with LZW/Deflate compression, this is barely noticeable. For ZSTD/WebP, there may be brief UI freezes during rapid scrolling.

**Note**: This issue is **dev mode only**. In production builds (`pnpm build`), Vite bundles the worker correctly and workers would work. However, we currently use the main-thread pool unconditionally for consistency. A future improvement could detect dev vs production mode.

**Related**: In our `vite.config.ts`, we set `worker: { format: 'es' }` to prevent a separate build error (`Invalid value "iife" for option "worker.format"`). This fixes the production build but does not fix the dev mode worker loading.

**Proper fix**: The `@developmentseed/geotiff` worker should be compatible with Vite's dev server. This could be achieved by:
- Using an inline worker (`new Worker(new Blob([...]))`) instead of a URL-based worker
- Or providing a Vite plugin that handles the worker URL resolution

**Where to track**: [`@developmentseed/geotiff`](https://github.com/developmentseed/deck.gl-raster) — `packages/geotiff/src/pool/pool.ts`

### 5. `GeoTIFFLayer` Not Exported (Non-tiled COGs)

**Bug**: `GeoTIFFLayer` exists in the v0.3 source but is intentionally NOT exported from the package index. The implementation throws:
```
Error: Loading GeoTIFF image data not yet implemented
```

This means non-tiled GeoTIFFs cannot use the library's built-in layer and must be handled manually.

**Our workaround**: `renderNonTiledBitmap()` in `utils/cog.ts` reads the entire raster and renders via MapLibre's native image source.

**Where to track**: [`@developmentseed/deck.gl-geotiff`](https://github.com/developmentseed/deck.gl-raster) — `packages/deck.gl-geotiff/src/geotiff-layer.ts`

---

## Extracted Utilities (`src/lib/utils/cog.ts`)

### Pure Helpers (re-exported via objex-utils)

| Export | Type | Description |
|--------|------|-------------|
| `SF_LABELS` | const | SampleFormat code → label map (`{1:'uint', 2:'int', 3:'float', ...}`) |
| `CogInfo` | interface | Metadata for the info panel (width, height, bandCount, dataType, bounds) |
| `GeoBounds` | interface | `{west, south, east, north}` |
| `safeClamp()` | fn | Clamp with NaN/Infinity fallback — use instead of `Math.max/min` |
| `clampBounds()` | fn | Clamp to web-Mercator-safe range (lon ±180, lat ±85.051129) |
| `buildDataTypeLabel()` | fn | Build label from SampleFormat + BitsPerSample (e.g., "uint8", "float32") |

### Map Helpers (depend on maplibre-gl, not re-exported)

| Export | Type | Description |
|--------|------|-------------|
| `fitCogBounds()` | fn | Responsive fit with zoom bump for small-extent COGs |
| `getMaxTextureSize()` | fn | Query GPU `MAX_TEXTURE_SIZE` from MapLibre's WebGL context |
| `cleanupNativeBitmap()` | fn | Remove MapLibre image source/layer (idempotent) |
| `renderNonTiledBitmap()` | fn | Full non-tiled bitmap pipeline (open → read → normalize → render) |

### Custom Pipeline Helpers

| Export | Type | Description |
|--------|------|-------------|
| `needsCustomPipeline()` | fn | Check if GeoTIFF needs custom pipeline (non-uint SampleFormat) |
| `needsCustomPipelineForConfig()` | fn | Check if custom pipeline needed given a `BandConfig` (non-uint, single-band mode, or non-default band order) |
| `createCustomGetTileData()` | fn | Create `getTileData` callback that normalizes band 0 to grayscale/terrain |
| `createConfigurableGetTileData()` | fn | Create `getTileData` that respects `BandConfig` — RGB multi-band or single-band with color ramp |
| `customRenderTile()` | fn | Create `renderTile` callback that returns ImageData |
| `CustomTileData` | interface | Return type from custom getTileData (`{imageData, width, height}`) |

### Band Configuration & Color Ramps

| Export | Type | Description |
|--------|------|-------------|
| `BandConfig` | interface | Band mapping config: mode (rgb/single), per-channel band indices, color ramp |
| `ColorRampId` | type | `'grayscale' \| 'terrain' \| 'viridis' \| 'magma' \| 'turbo' \| 'spectral'` |
| `COLOR_RAMP_STOPS` | const | RGB stop arrays for each color ramp |
| `interpolateRamp()` | fn | Interpolate normalized 0..1 value into a color ramp |
| `rampToGradientCss()` | fn | Generate CSS `linear-gradient` string for a ramp |
| `defaultBandConfig()` | fn | Create sensible default config based on band count and sample format |
| `isDefaultBandConfig()` | fn | Check if config matches the default (no user changes) |

### Pixel Inspection

| Export | Type | Description |
|--------|------|-------------|
| `PixelValue` | interface | Click result: lng, lat, band values, pixel row/col |
| `resolveProj4Def()` | fn | Resolve proj4 string for CRS code (returns null for EPSG:4326) |
| `readPixelAtLngLat()` | fn | Convert lnglat → source CRS → pixel coords, fetch tile, read all band values |

---

## Upstream Issues to Track

All issues are in the **[developmentseed/deck.gl-raster](https://github.com/developmentseed/deck.gl-raster)** monorepo.

| Issue | Package | File | Severity | Description |
|-------|---------|------|----------|-------------|
| Model type 32767 | `@developmentseed/geotiff` | `src/crs.ts` | High | `crsFromGeoKeys` doesn't handle user-defined model type |
| Non-uint render pipeline | `@developmentseed/deck.gl-geotiff` | `src/geotiff/render-pipeline.ts` | High | `inferRenderPipeline` only supports uint SampleFormat (v0.4 skips it when custom `getTileData`/`renderTile` provided — [PR #307](https://github.com/developmentseed/deck.gl-raster/pull/307)) |
| Oversized overviews | `@developmentseed/geotiff` | `src/tile-matrix-set.ts` | High | `generateTileMatrixSet` includes overviews smaller than tile size |
| ~~Polar NaN projection~~ | `@developmentseed/deck.gl-geotiff` | `src/cog-layer.ts` | ~~High~~ Fixed in v0.4 | Native `makeClampedForwardTo3857` clamps polar NaN via 4326→clamp→analytical 3857 fallback. `RasterReprojector.run()` has native `maxIterations` (10000) safety cap. |
| Antimeridian wrapping | `@developmentseed/deck.gl-geotiff` | `src/cog-layer.ts` | Medium | proj4 `adjust_lon` wraps ±180° longitude — [#366](https://github.com/developmentseed/deck.gl-raster/issues/366), [PR #374](https://github.com/developmentseed/deck.gl-raster/pull/374) open. Patched via `+over` flag in our pnpm patch. |
| Worker dev mode | `@developmentseed/geotiff` | `src/pool/pool.ts` | Medium | DecoderPool workers fail in Vite dev server |
| GeoTIFFLayer WIP | `@developmentseed/deck.gl-geotiff` | `src/geotiff-layer.ts` | Low | Non-tiled layer not yet implemented |
| Missing projections | `@developmentseed/geotiff` | `src/crs.ts` | Low | Mollweide, Eckert, Robinson not in CT table |

---

## Test COGs & Results

| Name | URL | CRS | Bands | Type | Compression | Route | Status |
|------|-----|-----|-------|------|-------------|-------|--------|
| NZ Aerial | `nz-imagery.s3...CC11.tiff` | EPSG:2193 | 3 | uint8 | WebP | Default | ✅ Works |
| TGE AEF | `source.coop...tge-labs...tiff` | EPSG:32610 | 64 | Int8 | ZSTD | Custom | ✅ Grayscale band 0 |
| GEBCO 2024 | `source.coop...GEBCO_2024.tif` | EPSG:4326 | 1 | Int16 | Deflate | Custom | ✅ Global bathymetry (polar clamp + NaN guard) |
| HFP 2017 | `source.coop...hfp_2017...tif` | Mollweide (32767) | 1 | uint16 | ZSTD | Error | ❌ Unsupported model type |
| Canada 01.tif | `source.coop...dataforcanada...tif` | — | — | — | — | Error | ❌ Not a valid TIFF (magic bytes `86 DE E3 4E`) |

### Testing workflow

```bash
# Standard RGB COG
http://localhost:5173/?url=https://nz-imagery.s3-ap-southeast-2.amazonaws.com/...

# Non-uint COG (should render grayscale)
http://localhost:5173/?url=https://s3.us-west-2.amazonaws.com/.../tge-labs/...

# Mollweide COG (should show CRS error)
http://localhost:5173/?url=https://s3.us-west-2.amazonaws.com/.../hfp-100/...
```

---

## Vite Configuration

### `worker.format`

```js
worker: { format: 'es' }
```

Required because `@developmentseed/geotiff`'s DecoderPool uses `new Worker(url, { type: "module" })`. Without this, Vite's production build fails with:
```
Invalid value "iife" for option "worker.format" — UMD and IIFE output formats
are not supported for code-splitting builds.
```

### `optimizeDeps.include`

```js
optimizeDeps: {
  include: [
    '@developmentseed/deck.gl-geotiff',
    '@developmentseed/geotiff',
    '@developmentseed/deck.gl-raster',
    '@developmentseed/raster-reproject',
    '@developmentseed/morecantile',
    '@developmentseed/affine',
    '@cogeotiff/core',
    'proj4',
    'wkt-parser'
  ]
}
```

All v0.3 packages and their transitive deps must be pre-bundled by Vite's optimizer. Without this, module resolution fails at runtime with import errors for internal ESM modules.

### `resolve.dedupe`

```js
resolve: {
  dedupe: ['@deck.gl/core', '@deck.gl/layers', '@deck.gl/geo-layers', '@luma.gl/core', 'proj4']
}
```

Ensures a single instance of shared libraries. `proj4` deduplication is critical — the library's internal `proj4` must be the same instance as ours to share projection caches.

---

## History (v0.2 → v0.3)

The v0.2 CogViewer was **1345 lines** with ~700 lines of workarounds:

| Workaround | Lines | Eliminated by |
|---|---|---|
| `COGLayer._parseGeoTIFF` monkey-patch | ~70 | v0.3 native Gray/PI support |
| `reconstructLayerState()` | ~130 | No monkey-patch needed |
| `patchMetadataBounds()` (Mollweide/global CRS) | ~45 | v0.3 handles reprojection internally |
| `geoKeysParser()` + `PROJ_CT_FALLBACK` + `ESRI_PROJ_MAP` | ~110 | v0.3 `epsgResolver` + `wkt-parser` |
| `buildCustomCogLayer()` (custom TileLayer) | ~190 | Custom `getTileData`/`renderTile` API |
| Custom bitmap preview (tiled Gray/Float) | ~110 | v0.3 custom pipeline callbacks |
| Dual geotiff v2/v3 library hack | ~40 | Single `@developmentseed/geotiff` |

**Dependencies removed:**
- `geotiff@^3.0.5` — replaced by `@developmentseed/geotiff` (wraps `@cogeotiff/core`)
- `geotiff-geokeys-to-proj4@^2024.4.13` — replaced by `@developmentseed/epsg` + `wkt-parser`

**New workarounds added in v0.3** (~80 lines total):
- Oversized overview filter (5 lines) — upstream bug in `generateTileMatrixSet`
- CRS validation in pre-flight (10 lines) — upstream limitation in `crsFromGeoKeys`
- EPSG:4326 polar bbox clamp (8 lines) — upstream missing NaN guard
- `COGLayer.prototype.setState` NaN projection patch (20 lines) — safety net for polar NaN (upstream partially fixed in PR #349 via Web Mercator rendering, but NaN guard retained for edge cases)
- `pnpm patch` for `@developmentseed/deck.gl-geotiff` — backports [PR #349](https://github.com/developmentseed/deck.gl-raster/pull/349) (Web Mercator CARTESIAN rendering). Remove patch when next npm release includes the fix.
- Custom pipeline for non-uint (import + 5 lines in CogViewer, ~100 lines in cog.ts) — upstream WIP
- Workerless DecoderPool (3 lines) — Vite dev mode issue

---

## History (v0.3 → v0.4)

Upgraded from `@developmentseed/deck.gl-geotiff@0.3.0` to `@0.4.0` on 2026-03-26.

**v0.4.0 natively fixed** (patches removed):
- Polar NaN projection — `makeClampedForwardTo3857` clamps via 4326→clamp→analytical 3857 fallback ([PR #349](https://github.com/developmentseed/deck.gl-raster/pull/349))
- Web Mercator rendering — CARTESIAN coordinate system + model matrix (same PR #349)
- `inferRenderPipeline` crash with custom callbacks — skipped when user provides `getTileData`/`renderTile` ([PR #307](https://github.com/developmentseed/deck.gl-raster/pull/307))
- `RasterReprojector` infinite loop — native `maxIterations` cap (default 10000)
- NaN in `sampleReferencePointsInEPSG3857` — uses `makeClampedForwardTo3857` internally
- Latitude clamping — [PR #182](https://github.com/developmentseed/deck.gl-raster/pull/182) clamps to Web Mercator bounds
- proj4 bump — fixes EPSG:3857 projection ([PR #346](https://github.com/developmentseed/deck.gl-raster/pull/346))
- TileLayer prop passthrough — `maxRequests`, `maxCacheSize`, `maxCacheByteSize`, `debounceTime`, `refinementStrategy`

**Patches reduced**: 3 patches (400+ lines) → 1 patch (24 lines):
- `@developmentseed/deck.gl-geotiff@0.4.0` — proj4 `+over` flag on 4326/3857 targets to fix antimeridian longitude wrapping ([#366](https://github.com/developmentseed/deck.gl-raster/issues/366), [PR #374](https://github.com/developmentseed/deck.gl-raster/pull/374) pending)

**Workarounds still needed** (unchanged in CogViewer.svelte):
- Oversized overview filter (5 lines)
- EPSG:4326 bbox clamp to ±85.051° (safety net — v0.4 handles most cases natively)
- CRS validation for model type 32767 (10 lines)
- Custom pipeline for non-uint COGs (~100 lines in cog.ts)
- Workerless DecoderPool (3 lines)
- Non-tiled bitmap fallback (~150 lines in cog.ts)

**Workarounds removed**:
- `COGLayer.prototype.setState` NaN guard — replaced by native `makeClampedForwardTo3857`
- NaN clamping in `sampleReferencePointsInEPSG3857` — native
- `RasterReprojector` iteration cap — native (10000 default)
- Partial tile skip (<25% coverage) — removed with PR #349's CARTESIAN rendering
- All debug `console.log`/`console.warn` from patches

---

## Upstream examples as references

The `developmentseed/deck.gl-raster/examples/` directory ships six runnable examples that document the supported wiring patterns in v0.5. The set covers `cog-basic`, `land-cover`, `naip-mosaic`, `sentinel-2`, `usgs-topo-cutline`, and `zarr-sentinel2-tci`, each pinning a distinct code path (plain COG, categorical palette, mosaic, multi-band RGB, cutline masking, Zarr). The cheatsheet at [`.claude/skills/deckgl-geotiff-raster/SKILL.md`](../.claude/skills/deckgl-geotiff-raster/SKILL.md) section 11 summarizes the pattern each one demonstrates so contributors can cross-reference an example before adding new viewer logic.

## EPSG resolver regression notes

When we swapped `epsg.io` for `@developmentseed/epsg`'s bundled CSV (see root `CLAUDE.md`), `parseWkt()` from `@developmentseed/proj` started returning `units: "unknown"` for a subset of EPSG codes whose CSV-bundled WKT has a missing or malformed root `UNIT` node. `generateTileMatrixSet` then throws `Unsupported CRS units: unknown when computing metersPerUnit`. The fix is a one-function guard, `normalizeCrsUnits()` in `utils/cog.ts`, wrapped around every `parseWkt()` output. The helper infers `degree` for geographic CRS (`projName === "longlat"`), then maps `to_meter` values of 1, 0.3048, and 1200/3937 to `meter`, `foot`, and `us survey foot` respectively. Any new EPSG resolver added elsewhere in the codebase must reuse `normalizeCrsUnits()` to avoid the same crash.
