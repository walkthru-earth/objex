import type { GeoTIFF as GeoTIFFType, Overview } from '@developmentseed/geotiff';
import { GeoTIFF } from '@developmentseed/geotiff';
import type maplibregl from 'maplibre-gl';
import proj4Lib from 'proj4';

// ─── Constants ───────────────────────────────────────────────────

/** SampleFormat tag value → human label. */
export const SF_LABELS: Record<number, string> = {
	1: 'uint',
	2: 'int',
	3: 'float',
	4: 'void',
	5: 'complex int',
	6: 'complex float'
};

const BITMAP_SOURCE = 'geotiff-bitmap-src';
const BITMAP_LAYER = 'geotiff-bitmap-layer';

// ─── Types ───────────────────────────────────────────────────────

export interface GeoBounds {
	west: number;
	south: number;
	east: number;
	north: number;
}

export interface CogInfo {
	width: number;
	height: number;
	bandCount: number;
	dataType: string;
	bounds: GeoBounds;
	downsampled?: boolean;
}

// ─── Pure helpers ────────────────────────────────────────────────

/** Safely clamp a number to a range, treating NaN/Infinity as the fallback. */
export function safeClamp(v: number, lo: number, hi: number, fallback: number): number {
	return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;
}

/** Clamp geographic bounds to valid MapLibre web-Mercator range. */
export function clampBounds(b: GeoBounds): GeoBounds {
	return {
		west: safeClamp(b.west, -180, 180, -180),
		south: safeClamp(b.south, -85.051129, 85.051129, -85.051129),
		east: safeClamp(b.east, -180, 180, 180),
		north: safeClamp(b.north, -85.051129, 85.051129, 85.051129)
	};
}

/**
 * Build a data-type label from GeoTIFF sample format and bits per sample.
 * e.g. "uint8", "float32", "int16"
 */
export function buildDataTypeLabel(sampleFormat: number, bitsPerSample: number): string {
	return `${SF_LABELS[sampleFormat] ?? `sf${sampleFormat}`}${bitsPerSample ?? ''}`;
}

// ─── Map helpers (depend on maplibre-gl) ─────────────────────────

/**
 * Query the GPU's MAX_TEXTURE_SIZE from MapLibre's WebGL context.
 * Falls back to 4096 (lowest common denominator for mobile GPUs).
 */
export function getMaxTextureSize(map: maplibregl.Map): number {
	try {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const gl = (map as any).painter?.context?.gl as WebGL2RenderingContext | null;
		if (gl) return gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
	} catch {
		/* fallback */
	}
	return 4096;
}

/**
 * Fit the map to COG bounds with responsive padding.
 * Uses smaller padding on mobile to zoom in closer, ensuring overviews load
 * properly instead of appearing black at very low zoom levels.
 * After fitting, bumps zoom +2 when the viewport settles at a very low level.
 */
export function fitCogBounds(map: maplibregl.Map, b: GeoBounds): void {
	const isMobile = window.innerWidth < 640;
	const viewportMin = Math.min(window.innerWidth, window.innerHeight);
	const padding = isMobile ? 5 : Math.max(10, Math.round(viewportMin * 0.04));
	map.fitBounds(
		[
			[b.west, b.south],
			[b.east, b.north]
		],
		{ padding, maxZoom: 18, speed: 1.2, maxDuration: 2000 }
	);
	const lonSpan = b.east - b.west;
	const latSpan = b.north - b.south;
	const isLargeExtent = lonSpan > 90 || latSpan > 45;
	if (!isLargeExtent) {
		map.once('moveend', () => {
			const z = map.getZoom();
			const minZoom = isMobile ? 10 : 8;
			if (z < minZoom) {
				map.zoomTo(z + 2, { duration: 500 });
			}
		});
	}
}

/** Remove the native bitmap source/layer from the map (idempotent). */
export function cleanupNativeBitmap(map: maplibregl.Map): void {
	try {
		if (map.getLayer(BITMAP_LAYER)) map.removeLayer(BITMAP_LAYER);
	} catch {
		/* already removed */
	}
	try {
		if (map.getSource(BITMAP_SOURCE)) map.removeSource(BITMAP_SOURCE);
	} catch {
		/* already removed */
	}
}

// ─── Non-tiled bitmap rendering ──────────────────────────────────

/**
 * Compute geographic bounds (WGS84) from a GeoTIFF's native CRS bbox
 * using edge-sampling for accuracy with non-linear projections.
 */
async function computeGeographicBounds(
	geotiff: GeoTIFF,
	signal: AbortSignal
): Promise<GeoBounds | null> {
	const crs = geotiff.crs;
	const [x0, y0, x1, y1] = geotiff.bbox;

	// EPSG:4326 — bbox is already geographic
	if (crs === 4326) {
		return clampBounds({ west: x0, south: y0, east: x1, north: y1 });
	}

	// For other CRS, resolve proj4 definition and edge-sample
	let proj4Def: string;
	if (typeof crs === 'number') {
		// Fetch proj4 string from epsg.io
		const resp = await fetch(`https://epsg.io/${crs}.proj4`, { signal });
		if (!resp.ok) return null;
		proj4Def = (await resp.text()).trim();
	} else {
		// ProjJson — try to pass directly to proj4 (limited support)
		proj4Def = JSON.stringify(crs);
	}

	try {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const conv = proj4Lib(proj4Def, 'EPSG:4326') as any;
		const N = 4;
		const pts: [number, number][] = [];
		for (let i = 0; i <= N; i++) {
			const t = i / N;
			pts.push([x0 + t * (x1 - x0), y0]);
			pts.push([x0 + t * (x1 - x0), y1]);
			pts.push([x0, y0 + t * (y1 - y0)]);
			pts.push([x1, y0 + t * (y1 - y0)]);
		}
		let w = 180;
		let s = 90;
		let e = -180;
		let n = -90;
		for (const [px, py] of pts) {
			const r = conv.forward([px, py], false);
			if (
				Number.isFinite(r[0]) &&
				Number.isFinite(r[1]) &&
				Math.abs(r[0]) <= 180 &&
				Math.abs(r[1]) <= 90
			) {
				w = Math.min(w, r[0]);
				e = Math.max(e, r[0]);
				s = Math.min(s, r[1]);
				n = Math.max(n, r[1]);
			}
		}
		if (w < e && s < n) {
			return clampBounds({ west: w, south: s, east: e, north: n });
		}
	} catch {
		/* proj4 conversion failed */
	}
	return null;
}

const MAX_NONTILED_PIXELS = 100_000_000;

/**
 * Render a non-tiled GeoTIFF as a MapLibre native image source (bitmap).
 * Opens the file with @developmentseed/geotiff, reads band 0, normalizes
 * to grayscale RGBA, and adds to the map as a raster layer.
 *
 * Returns CogInfo for the metadata panel.
 */
export async function renderNonTiledBitmap(options: {
	url: string;
	map: maplibregl.Map;
	signal: AbortSignal;
	geotiff?: GeoTIFF;
}): Promise<CogInfo> {
	const { url, map, signal } = options;

	// Open GeoTIFF (reuse if already opened for pre-flight)
	const geotiff = options.geotiff ?? (await GeoTIFF.fromUrl(url));
	if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

	const imgW = geotiff.width;
	const imgH = geotiff.height;
	const totalPixels = imgW * imgH;
	const bandCount = geotiff.count;
	const nodata = geotiff.nodata;

	// Determine data type from the underlying TIFF image
	const tiffImage = geotiff.image;
	// @cogeotiff/core TiffImage stores tag values
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const sampleFormat = (tiffImage as any).value?.('SampleFormat')?.[0] ?? 1;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const bitsPerSample = (tiffImage as any).value?.('BitsPerSample')?.[0] ?? 8;
	const dataType = buildDataTypeLabel(sampleFormat, bitsPerSample);

	// Compute geographic bounds
	const geoBounds = await computeGeographicBounds(geotiff, signal);
	if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
	if (!geoBounds) {
		throw new Error('Cannot determine geographic bounds for non-tiled GeoTIFF');
	}

	// Size gate
	if (totalPixels > MAX_NONTILED_PIXELS) {
		const info: CogInfo = { width: imgW, height: imgH, bandCount, dataType, bounds: geoBounds };
		fitCogBounds(map, geoBounds);
		throw new Error(
			`Non-tiled GeoTIFF too large (${imgW.toLocaleString()} \u00d7 ${imgH.toLocaleString()} = ` +
				`${(totalPixels / 1e6).toFixed(0)}M pixels). Convert to COG: ` +
				`gdal_translate -of COG input.tif output.tif`
		);
	}

	// Cap to GPU texture limit
	const maxTexDim = getMaxTextureSize(map);
	const needsDownsample = imgW > maxTexDim || imgH > maxTexDim;
	let readW = imgW;
	let readH = imgH;
	if (needsDownsample) {
		const scale = Math.min(maxTexDim / imgW, maxTexDim / imgH);
		readW = Math.max(1, Math.round(imgW * scale));
		readH = Math.max(1, Math.round(imgH * scale));
	}

	// Read band 0 via a single tile fetch (non-tiled → single strip)
	// For non-tiled images, fetch tile (0,0) which returns the entire image
	const tile = await geotiff.fetchTile(0, 0, { signal });
	if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

	const arr = tile.array;
	const bandData: ArrayLike<number> = arr.layout === 'band-separate' ? arr.bands[0] : arr.data;

	// Compute min/max for linear stretch
	let bMin = Infinity;
	let bMax = -Infinity;
	const len = Math.min(bandData.length, readW * readH);
	for (let i = 0; i < len; i++) {
		const v = bandData[i];
		if (nodata !== null && v === nodata) continue;
		if (!Number.isFinite(v)) continue;
		if (v < bMin) bMin = v;
		if (v > bMax) bMax = v;
	}
	if (!Number.isFinite(bMin)) {
		bMin = 0;
		bMax = 1;
	}
	const bRange = bMax - bMin || 1;

	// Normalize to grayscale RGBA
	const pixelCount = len;
	const rgba = new Uint8ClampedArray(pixelCount * 4);
	for (let i = 0; i < pixelCount; i++) {
		const v = bandData[i];
		const isND = (nodata !== null && v === nodata) || !Number.isFinite(v);
		const g = isND ? 0 : Math.round(((v - bMin) / bRange) * 255);
		const idx = i * 4;
		rgba[idx] = g;
		rgba[idx + 1] = g;
		rgba[idx + 2] = g;
		rgba[idx + 3] = isND ? 0 : 255;
	}

	// Render to canvas → data URL
	const canvas = document.createElement('canvas');
	canvas.width = readW;
	canvas.height = readH;
	const ctx = canvas.getContext('2d')!;
	ctx.putImageData(new ImageData(rgba, readW, readH), 0, 0);
	const dataUrl = canvas.toDataURL();
	canvas.width = 0;
	canvas.height = 0;

	// Add to MapLibre as native image source
	cleanupNativeBitmap(map);
	map.addSource(BITMAP_SOURCE, {
		type: 'image',
		url: dataUrl,
		coordinates: [
			[geoBounds.west, geoBounds.north],
			[geoBounds.east, geoBounds.north],
			[geoBounds.east, geoBounds.south],
			[geoBounds.west, geoBounds.south]
		]
	});
	map.addLayer({
		id: BITMAP_LAYER,
		source: BITMAP_SOURCE,
		type: 'raster',
		paint: { 'raster-opacity': 1 }
	});

	return {
		width: imgW,
		height: imgH,
		bandCount,
		dataType,
		bounds: geoBounds,
		downsampled: needsDownsample
	};
}

// ─── Custom pipeline for non-uint COGs ───────────────────────────

/** Result type returned by our custom getTileData. */
export interface CustomTileData {
	imageData: ImageData;
	width: number;
	height: number;
}

/**
 * Check whether a GeoTIFF needs a custom render pipeline.
 * v0.3's inferRenderPipeline only supports unsigned integers (SampleFormat 1).
 * Signed int (2) and float (3) need custom getTileData/renderTile.
 */
export function needsCustomPipeline(geotiff: GeoTIFFType): boolean {
	const tags = geotiff.cachedTags;
	const sf = tags.sampleFormat;
	// sampleFormat is null or not uint → needs custom
	return sf === null || sf[0] !== 1;
}

/**
 * Create custom getTileData for non-uint COGs.
 * Reads band 0, normalizes to grayscale RGBA, returns ImageData.
 */
export function createCustomGetTileData(geotiff: GeoTIFFType) {
	// Pre-compute normalization range from stored GDAL statistics if available
	const stats = geotiff.storedStats;
	let globalMin: number | null = null;
	let globalMax: number | null = null;
	if (stats) {
		const band1Stats = stats.get(1); // GDAL uses 1-based indexing
		if (band1Stats) {
			globalMin = band1Stats.min ?? null;
			globalMax = band1Stats.max ?? null;
		}
	}

	// Fallback: infer from data type
	const tags = geotiff.cachedTags;
	const sf = tags.sampleFormat?.[0] ?? 1;
	const bps = tags.bitsPerSample?.[0] ?? 8;

	if (globalMin === null || globalMax === null) {
		if (sf === 2) {
			// Signed integer
			const half = 2 ** (bps - 1);
			globalMin = -half;
			globalMax = half - 1;
		} else {
			// Float — no known range, use 0..1 as default
			globalMin = 0;
			globalMax = 1;
		}
	}

	const rangeMin = globalMin;
	const rangeMax = globalMax;
	const range = rangeMax - rangeMin || 1;

	return async (
		image: GeoTIFFType | Overview,
		options: { x: number; y: number; pool: unknown; signal?: AbortSignal }
	): Promise<CustomTileData> => {
		const tile = await image.fetchTile(options.x, options.y, {
			boundless: false,
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			pool: options.pool as any,
			signal: options.signal
		});

		const arr = tile.array;
		const { width, height, nodata } = arr;
		const bandData: ArrayLike<number> = arr.layout === 'band-separate' ? arr.bands[0] : arr.data;

		// Normalize to grayscale RGBA
		const pixelCount = width * height;
		const rgba = new Uint8ClampedArray(pixelCount * 4);
		for (let i = 0; i < pixelCount; i++) {
			const v = bandData[i];
			const isND = (nodata !== null && v === nodata) || !Number.isFinite(v);
			const g = isND ? 0 : Math.round(((v - rangeMin) / range) * 255);
			const idx = i * 4;
			rgba[idx] = g;
			rgba[idx + 1] = g;
			rgba[idx + 2] = g;
			rgba[idx + 3] = isND ? 0 : 255;
		}

		return {
			imageData: new ImageData(rgba, width, height),
			width,
			height
		};
	};
}

/**
 * Custom renderTile for non-uint COGs.
 * Returns the ImageData directly — RasterLayer accepts ImageData.
 */
export function customRenderTile(data: CustomTileData): ImageData {
	return data.imageData;
}
