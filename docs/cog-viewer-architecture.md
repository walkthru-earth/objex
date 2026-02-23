# COG Viewer Architecture & Lessons Learned

> Comprehensive reference for the CogViewer.svelte rewrite using `@developmentseed/deck.gl-geotiff`.
> Last updated: 2026-02-23

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Library Internals](#library-internals)
- [Version Mismatch: geotiff v2 vs v3](#version-mismatch-geotiff-v2-vs-v3)
- [Monkey-Patch Strategy](#monkey-patch-strategy)
- [Projection & Bounds Issues](#projection--bounds-issues)
- [Compression Support](#compression-support)
- [Performance & Browser Hangs](#performance--browser-hangs)
- [Tile Matrix Oversized Overview Fix](#tile-matrix-oversized-overview-fix)
- [UI Layout](#ui-layout)
- [Test COGs & Their Characteristics](#test-cogs--their-characteristics)
- [Open Issues & Future Work](#open-issues--future-work)
- [Key File Locations](#key-file-locations)

---

## Architecture Overview

```
CogViewer.svelte
  |
  |-- Pre-flight (geotiff v3)
  |     Read first IFD -> extract metadata (PI, SF, bands, tiled?)
  |     Route to: Default Pipeline | Custom Pipeline | GeoTIFFLayer
  |
  |-- Default Pipeline (RGB/Palette/CMYK/YCbCr/CIELab, uint)
  |     COGLayer with URL string, no custom getTileData
  |     Library handles everything internally via v2 geotiff
  |
  |-- Custom Pipeline (Gray PI=0/1, float, int, multi-band non-RGB)
  |     1. Read small overview for min/max stats (v3 readRasters)
  |     2. Create COGLayer with custom getTileData + renderTile
  |     3. Monkey-patch catches inferRenderPipeline throw
  |     4. getTileData: read band 0 via v3, normalize to grayscale RGBA
  |     5. renderTile: return ImageData (GPU texture created by RasterLayer)
  |
  |-- GeoTIFFLayer (non-tiled TIFFs)
  |     Fallback for strip-based TIFFs, uses readRGB internally
  |
  |-- MapboxOverlay -> MapLibre GL map
```

### Routing Logic

```
isDefaultPipeline = (SampleFormat === 1 [uint]) AND (PhotometricInterpretation >= 2)
```

| PI Value | Meaning | Pipeline |
|----------|---------|----------|
| 0 | WhiteIsZero | Custom (Gray) |
| 1 | BlackIsZero | Custom (Gray) |
| 2 | RGB | Default |
| 3 | Palette | Default |
| 4 | TransparencyMask | Custom |
| 5 | CMYK | Default |
| 6 | YCbCr | Default |
| 8 | CIELab | Default |

---

## Library Internals

### `@developmentseed/deck.gl-geotiff` (v0.2.0)

**Exports:** `COGLayer`, `GeoTIFFLayer`, `parseCOGTileMatrixSet`, `proj`, `extractGeotiffReprojectors`, `fromGeoTransform`, `loadRgbImage`, `parseColormap`, `texture`, `MosaicLayer`, `MosaicTileset2D`

**Dependencies:** Bundles `geotiff@2.1.3` internally (NOT the project's v3).

### `COGLayer._parseGeoTIFF()` flow

```
1. fetchGeoTIFF(url)              -> opens v2 geotiff from URL
2. parseCOGTileMatrixSet(tiff)    -> creates TileMatrixSet with tile bounds
3. load all images                -> getImage(0..N)
4. geoKeysParser(geoKeys)         -> parse CRS to proj4 string
5. proj4(src, 'EPSG:4326')       -> create converter
6. onGeoTIFFLoad(tiff, {bounds})  -> SYNC callback (before inferRenderPipeline!)
7. inferRenderPipeline(fileDir)   -> THROWS for PI<2 or non-uint SF
8. setState({metadata, images..}) -> triggers renderLayers -> TileLayer
```

**Key insight:** Step 6 (`onGeoTIFFLoad`) runs BEFORE step 7 (`inferRenderPipeline`). This is how we capture the v2 GeoTIFF before the throw.

### `_getTileData()` z-to-image mapping

```javascript
// images[0] = finest (full resolution), images[N] = coarsest
// tileMatrices[0] = coarsest, tileMatrices[N] = finest
const geotiffImage = images[images.length - 1 - z];
const tileMatrix = metadata.tileMatrices[z];
```

### `inferRenderPipeline` (render-pipeline.js)

Only supports:
- `SampleFormat[0] === 1` (unsigned int) -- throws `"non-unsigned integers not yet supported"` otherwise
- `PhotometricInterpretation >= 2` -- throws `"Unsupported PhotometricInterpretation"` for 0/1

### `renderTile` return types

`renderTile: (data: DataT) => ImageData | RasterModule[]`

When `ImageData` is returned, `RasterLayer._createRenderPipeline()` creates a GPU texture:
```javascript
device.createTexture({ format: 'rgba8unorm', width, height, data: imageData.data })
```

---

## Version Mismatch: geotiff v2 vs v3

| Feature | v2 (library) | v3 (project) |
|---------|-------------|-------------|
| Package | `geotiff@2.1.3` | `geotiff@^3.0.3` |
| `fileDirectory` | Named properties (`ifd.TileWidth`, `ifd.PhotometricInterpretation`) | `actualizedFields` Map (`ifd.actualizedFields.get(262)`) |
| Pool | `new Pool()` with `pool.bindParameters()` | `new Pool()` with different Worker structure |
| Compression | LZW, JPEG, Deflate, PackBits, Adobe Deflate | + ZSTD (50000), WebP (50001), LERC (34887) |

### Critical rule: NEVER pass v3 objects to library functions

Passing v3 GeoTIFF/Pool objects to the library causes `pool.bindParameters is not a function` because the Pool APIs differ between versions.

**Solution:** Always pass URL strings to `COGLayer`/`GeoTIFFLayer`. The library opens its own v2 GeoTIFF internally.

### v3 metadata access patterns

```typescript
// v3 getters (used in pre-flight)
firstImage.isTiled                                    // boolean
firstImage.getSampleFormat()                          // 1=uint, 2=int, 3=float
firstImage.getSamplesPerPixel()                       // band count
firstImage.getBitsPerSample()                         // e.g. 8, 16, 32
firstImage.getGDALNoData()                            // number | null
firstImage.getWidth() / getHeight()
firstImage.fileDirectory.actualizedFields.get(262)    // PhotometricInterpretation
firstImage.fileDirectory.getValue('Compression')      // Compression tag (259)
```

---

## Monkey-Patch Strategy

### Why

`inferRenderPipeline` throws for Gray/float COGs, preventing `setState` from running. Without state, the TileLayer never renders.

### How

```javascript
// Guard against HMR double-patching
const _origParse = COGLayer.__origParseGeoTIFF ?? COGLayer.prototype._parseGeoTIFF;
COGLayer.__origParseGeoTIFF = _origParse;

COGLayer.prototype._parseGeoTIFF = async function() {
  try {
    await _origParse.call(this);
  } catch (err) {
    if (this.props.getTileData && this.props.renderTile && capturedV2Geotiff) {
      // Reconstruct state from captured v2 GeoTIFF
      const metadata = await parseCOGTileMatrixSet(capturedV2Geotiff, gkParser);
      patchMetadataBounds(metadata);  // Fix NaN/extreme coords
      // ... load images, skip oversized overviews, create reprojectors ...
      this.setState({ metadata, forwardReproject, inverseReproject, images, ... });
    } else if (this.props.onError) {
      this.props.onError(err);
    }
  }
};
```

### `capturedV2Geotiff` lifecycle

- Set in `handleGeoTIFFLoad` callback (called by library's `_parseGeoTIFF` at step 6)
- Used in catch handler to reconstruct state
- Module-level variable (shared across instances -- potential race with multiple tabs)

---

## Projection & Bounds Issues

### Problem: `deck.gl lngLatToWorld` assertion

```javascript
// deck.gl/core web-mercator-utils.js
assert(Number.isFinite(lat) && lat >= -90 && lat <= 90, "invalid latitude");
```

### Causes

1. **Mollweide corners outside ellipse:** The bounding box of a Mollweide projection is rectangular, but the valid domain is elliptical. The 4 corners of the bbox are OUTSIDE the ellipse. `proj4(mollweide -> WGS84)` returns extreme longitudes (e.g. +/-277 deg) for these corners.

2. **EPSG:4326 at +/-90.002 deg:** Some COGs extend slightly beyond the poles (e.g. origin at 90.0022 deg). `lat = -90.002` fails the `lat >= -90` assertion.

3. **Web Mercator singularity at +/-90 deg:** Even exact +/-90 deg latitude produces `Infinity` in Mercator math: `Math.log(Math.tan(PI/4 + PI/4))` = `Math.log(Infinity)` = `Infinity`.

### Where bounds are used in the library

| Location | What | Problem |
|----------|------|---------|
| `metadata.wgsBounds` | Geographic extent for frustum culling | NaN/extreme values crash TileLayer init |
| `metadata.projectTo3857` | CRS -> EPSG:3857 for tile bounding volumes | NaN for out-of-domain points |
| `metadata.projectToWgs84` | CRS -> WGS84 for display | NaN for edge tiles |
| `forwardReproject` | CRS -> WGS84 for adaptive mesh in RasterLayer | Used for rendering, must be clamped |

### Fix: `patchMetadataBounds()`

```javascript
function patchMetadataBounds(metadata) {
  // 1. Clamp wgsBounds to valid Web Mercator range
  metadata.wgsBounds = {
    lowerLeft:  [safeClamp(lon, -180, 180, -180), safeClamp(lat, -85.05, 85.05, -85.05)],
    upperRight: [safeClamp(lon, -180, 180,  180), safeClamp(lat, -85.05, 85.05,  85.05)]
  };

  // 2. Wrap projectTo3857 — return [0,0] for NaN/Infinity
  metadata.projectTo3857 = (point) => {
    const r = origTo3857(point);
    return (isFinite(r[0]) && isFinite(r[1])) ? r : [0, 0];
  };

  // 3. Wrap projectToWgs84 — clamp to valid range
  metadata.projectToWgs84 = (point) => {
    const r = origToWgs84(point);
    return [safeClamp(r[0], -180, 180, 0), safeClamp(r[1], -85.05, 85.05, 0)];
  };
}
```

### Fix: Clamped `forwardReproject` in monkey-patch

```javascript
const forwardReproject = (x, y) => {
  const r = converter.forward([x, y], false);
  return [
    isFinite(r[0]) ? clamp(r[0], -180, 180) : 0,
    isFinite(r[1]) ? clamp(r[1], -85.051129, 85.051129) : 0
  ];
};
```

### Important: `safeClamp` vs `Math.max/min`

```javascript
Math.max(-180, Math.min(180, NaN))  // => NaN (WRONG!)
safeClamp(NaN, -180, 180, -180)     // => -180 (correct fallback)
```

---

## Compression Support

### TIFF Compression Tags (tag 259)

| Code | Method | geotiff v2 | geotiff v3 |
|------|--------|-----------|-----------|
| 1 | None | Yes | Yes |
| 5 | LZW | Yes | Yes |
| 6 | Old JPEG | No | No |
| 7 | JPEG | Yes | Yes |
| 8 | Deflate | Yes | Yes |
| 32773 | PackBits | Yes | Yes |
| 32946 | Adobe Deflate | Yes | Yes |
| 34887 | LERC | No | Yes |
| 50000 | Zstandard (ZSTD) | **No** | **Yes** |
| 50001 | WebP | No | Yes |

### Strategy for unsupported v2 compressions

When the COG uses ZSTD/WebP/LERC compression:
1. The library's v2 `readRasters()` will throw `"Unknown compression method identifier: 50000"`
2. Our custom `getTileData` uses **v3 images** (lazily cached by dimensions) which support these codecs
3. Stats pre-flight also uses v3 `readRasters` (which works because it runs before the library)

### Reading compression from v3

```typescript
const compression = firstImage.fileDirectory.getValue('Compression') || 1;
```

---

## Performance & Browser Hangs

### CRITICAL: geotiff v3 Pool hangs in Vite dev

**Symptom:** Browser completely freezes when loading tiles.

**Root cause:** `new Pool()` from geotiff v3 creates Web Workers. In Vite dev mode, these workers need to load ESM modules via `import()`. Vite's dev server may not serve worker module requests correctly, causing workers to hang silently. `pool.bindParameters()` returns a Promise that never resolves -> `readRasters()` hangs -> all tile loading blocks.

**Proof:** Stats `readRasters` without a pool works fine (same COG, same compression). Only pool-based tile loading hangs.

**Fix:** Do NOT use a v3 Pool. Call `readRasters` without a pool. Decompression happens on the main thread but is async (WASM init via `WebAssembly.instantiate` is non-blocking). Per-tile decompression is ~5-10ms for 512x512 tiles -- acceptable.

**Tradeoff:** No parallel decompression across workers. If this becomes a bottleneck, investigate:
- Building geotiff v3 workers with Vite's worker bundling
- Using `navigator.hardwareConcurrency` with `OffscreenCanvas` workers
- Checking if geotiff v3 Pool works correctly in production (non-dev) builds

### Redundant work in monkey-patch

`parseCOGTileMatrixSet` is called **twice** for custom pipeline COGs:
1. Inside `_origParse` (library code, result lost when it throws)
2. In our catch handler (to reconstruct state)

Each call iterates all image IFDs via HTTP range requests. However, geotiff.js caches images after first access, so the second call is fast (~50ms total from cached data). Not worth optimizing unless profiling shows otherwise.

### HFP COG (360802x176500) -- still hangs

Despite removing the Pool, the HFP Mollweide COG (360802x176500, ZSTD, UInt16) may still cause browser issues. Possible remaining causes:

1. **RasterLayer adaptive mesh for Mollweide:** The reprojection mesh for Mollweide has extreme distortion at the edges. The adaptive mesh refinement in RasterLayer may create very fine meshes (thousands of vertices) for edge tiles, overwhelming the GPU.

2. **ZSTD WASM initialization:** First-time ZSTD decompression requires loading and compiling a WASM module. This may block the main thread briefly during compilation.

3. **Many concurrent range requests:** Even at the coarsest zoom, the tile traversal may try to prefetch tiles at multiple zoom levels, creating many concurrent HTTP requests.

4. **GPU texture memory:** Each tile creates a 512x512 RGBA texture (1MB). At fine zoom levels with many visible tiles, GPU memory could be exhausted.

### Performance optimization ideas (not yet implemented)

- Check compression at pre-flight; only use v3 for ZSTD/WebP/LERC; use v2 images (with library pool) for LZW/Deflate/JPEG
- Limit concurrent tile requests via `maxRequests` prop on COGLayer
- Use `requestAnimationFrame` batching for RGBA normalization
- Profile with Chrome DevTools Performance tab to identify exact bottleneck

---

## Tile Matrix Oversized Overview Fix

### Problem

When an overview image is smaller than the tile size (e.g., 1x1 pixel overview with 1024x1024 tiles), `parseCOGTileMatrixSet` computes tile bounds that span the entire globe:

```
cellSize = baseTransform[0] * (fullWidth / overviewWidth)
// For fullWidth=8192, overviewWidth=1, cellSize = 8192 * 100m = 819,200m
// Tile bounds = cellSize * tileWidth = 819,200 * 1024 = 838,860,800m (way beyond Earth)
```

When these extreme bounds are projected to EPSG:3857, they produce NaN.

### Fix

Skip overviews where image dimensions < tile dimensions:

```javascript
// tileMatrices[0]=coarsest, images[0]=finest (reverse mapping)
let firstValidZ = 0;
for (let z = 0; z < metadata.tileMatrices.length; z++) {
  const img = images[images.length - 1 - z];
  const tm = metadata.tileMatrices[z];
  if (img.getWidth() >= tm.tileWidth && img.getHeight() >= tm.tileHeight) {
    firstValidZ = z;
    break;
  }
}
if (firstValidZ > 0) {
  metadata.tileMatrices = metadata.tileMatrices.slice(firstValidZ);
  images = images.slice(0, images.length - firstValidZ);
}
```

### Example: 64-band COG (8192x8192, tileWidth=1024)

14 overviews down to 1x1. After fix, skip overviews smaller than 1024x1024:
- Skipped: 1x1, 2x2, 4x4, 8x8, 16x16, 32x32, 64x64, 128x128, 256x256, 512x512
- First valid: 1024x1024 (or next larger)

---

## UI Layout

### Overlay stacking (fixed in this rewrite)

Before: error div and cogInfo div both at `absolute left-2 top-2` -- overlapped when both visible.

After: wrapped in a flex column container:

```svelte
<div class="pointer-events-none absolute left-2 top-2 flex flex-col gap-1.5">
  {#if loading} ... {/if}
  {#if cogInfo} ... {/if}
  {#if error}
    <div class="pointer-events-auto ...">  <!-- interactive for error text selection -->
      {error}
    </div>
  {/if}
</div>
```

---

## Test COGs & Their Characteristics

### NLCD (works with default pipeline)

- URL: `s3://ds-deck.gl-raster-public/cog/Annual_NLCD_LndCov_2024_CU_C1V1.tif`
- CRS: Albers Equal Area
- 1 band, Byte (UInt8), PI=3 (Palette), LZW
- 6 overviews, NoData=250
- **Route:** Default pipeline (uint + PI >= 2)

### HFP 2017/2019 (Mollweide, custom pipeline, HANGS)

- URL: `s3://us-west-2.opendata.source.coop/vizzuality/hfp-100/hfp_2017_100m_v1-2_cog.tif`
- CRS: Mollweide (custom, no EPSG code)
- 360802x176500, 1 band, UInt16, PI=1 (Gray), ZSTD, NoData=65535
- 10 overviews (down to 352x172)
- **Route:** Custom pipeline (PI=1)
- **Issues:** Mollweide corner reprojection NaN, ZSTD needs v3, browser hang

### Deforestation Carbon (EPSG:4326, Float32)

- URL: `s3://us-west-2.opendata.source.coop/vizzuality/lg-land-carbon-data/deforest_carbon_by_human_lu_50km_1000m_cog.tif`
- CRS: EPSG:4326
- 40076x20038, 1 band, Float32, PI=1 (Gray), LZW
- 7 overviews (down to 313x156)
- **Route:** Custom pipeline (SF=3 float)
- **Issues:** Bounds at +/-90.002 deg, inferRenderPipeline throws for SF=3

### 64-band COG (UTM, ZSTD, Int8)

- URL: `s3://us-west-2.opendata.source.coop/tge-labs/aef/v1/annual/2021/10N/x06839lqyyiw2qz7y-0000008192-0000008192.tiff`
- CRS: UTM zone 10N (EPSG:32610)
- 8192x8192, 64 bands, Int8, PI=1, ZSTD, tileWidth=1024
- 14 overviews (down to 1x1)
- **Route:** Custom pipeline (PI=1, SF=2 int)
- **Issues:** Oversized tile matrices for tiny overviews, ZSTD needs v3

---

## Open Issues & Future Work

### Browser hang with large Mollweide COGs
The HFP COG still hangs despite Pool removal. Needs profiling with Chrome DevTools to identify exact bottleneck (RasterLayer mesh, WASM init, GPU memory, or concurrent requests).

### Band selector UI
For multi-band COGs (e.g., 64-band), a band-to-RGB channel assignment UI would be useful. Currently only band 0 is rendered as grayscale.

### Color ramps
Single-band COGs are rendered as grayscale (linear stretch from min to max). Scientific COGs often need specific color ramps (viridis, magma, terrain, etc.).

### NoData handling for default pipeline
The default pipeline doesn't handle NoData for Palette COGs -- NoData pixels render with whatever palette color they map to instead of being transparent.

### Library upstream fixes
The following issues exist in `@developmentseed/deck.gl-geotiff` itself:
- `inferRenderPipeline` should handle Gray/float COGs
- `computeWgs84BoundingBox` should sample edge midpoints, not just corners
- `parseCOGTileMatrixSet` should skip overviews smaller than tile size
- Bundled geotiff v2 doesn't support ZSTD/WebP/LERC

---

## Key File Locations

| File | Purpose |
|------|---------|
| `src/lib/components/viewers/CogViewer.svelte` | Main viewer component |
| `src/lib/components/viewers/map/MapContainer.svelte` | Shared MapLibre container |
| `src/lib/utils/url.ts` | URL builders (HTTPS, S3, DuckDB) |
| `node_modules/@developmentseed/deck.gl-geotiff/dist/cog-layer.js` | COGLayer source |
| `node_modules/@developmentseed/deck.gl-geotiff/dist/geotiff/render-pipeline.js` | inferRenderPipeline |
| `node_modules/@developmentseed/deck.gl-geotiff/dist/cog-tile-matrix-set.js` | parseCOGTileMatrixSet |
| `node_modules/@developmentseed/deck.gl-geotiff/dist/geotiff/geotiff.js` | fetchGeoTIFF, getGeographicBounds |
| `node_modules/@developmentseed/deck.gl-geotiff/dist/geotiff-reprojection.js` | extractGeotiffReprojectors |
| `node_modules/.pnpm/.../deck.gl-raster/dist/raster-tileset/raster-tile-traversal.js` | Tile frustum culling |
| `node_modules/.pnpm/.../deck.gl-raster/dist/raster-layer.js` | RasterLayer (GPU textures) |
| `node_modules/geotiff/dist-node/compression/index.js` | v3 supported compressions |
| `node_modules/geotiff/dist-node/pool.js` | v3 Pool (Web Workers) |
