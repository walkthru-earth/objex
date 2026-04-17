import type { GetTileDataOptions, MinimalDataT } from '@developmentseed/deck.gl-geotiff';
import { inferRenderPipeline } from '@developmentseed/deck.gl-geotiff';
import type { RenderTileResult } from '@developmentseed/deck.gl-raster';
import { LinearRescale } from '@developmentseed/deck.gl-raster/gpu-modules';
import loadEpsg from '@developmentseed/epsg/all';
import epsgCsvUrl from '@developmentseed/epsg/all.csv.gz?url';
import type { GeoTIFF as GeoTIFFType, Overview } from '@developmentseed/geotiff';
import { GeoTIFF } from '@developmentseed/geotiff';
import type { EpsgResolver, ProjectionDefinition } from '@developmentseed/proj';
import { parseWkt } from '@developmentseed/proj';
import type { Device } from '@luma.gl/core';
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

// ─── Color ramps ─────────────────────────────────────────────────

export type ColorRampId = 'grayscale' | 'terrain' | 'viridis' | 'magma' | 'turbo' | 'spectral';

export const COLOR_RAMP_STOPS: Record<ColorRampId, [number, number, number][]> = {
	grayscale: [
		[0, 0, 0],
		[255, 255, 255]
	],
	terrain: [
		[0, 0, 128],
		[0, 100, 200],
		[0, 154, 80],
		[120, 180, 50],
		[200, 170, 60],
		[180, 120, 50],
		[140, 90, 40],
		[200, 200, 200],
		[255, 255, 255]
	],
	viridis: [
		[68, 1, 84],
		[72, 36, 117],
		[64, 67, 135],
		[52, 94, 141],
		[33, 145, 140],
		[43, 176, 127],
		[95, 201, 97],
		[186, 222, 39],
		[253, 231, 37]
	],
	magma: [
		[0, 0, 4],
		[22, 11, 57],
		[67, 15, 98],
		[114, 24, 114],
		[161, 48, 104],
		[206, 82, 83],
		[237, 132, 62],
		[251, 192, 75],
		[252, 253, 191]
	],
	turbo: [
		[48, 18, 59],
		[31, 82, 188],
		[23, 158, 227],
		[47, 212, 161],
		[121, 238, 104],
		[193, 241, 57],
		[245, 206, 27],
		[253, 141, 31],
		[213, 47, 24]
	],
	spectral: [
		[158, 1, 66],
		[213, 62, 79],
		[244, 109, 67],
		[253, 174, 97],
		[254, 224, 139],
		[255, 255, 191],
		[230, 245, 152],
		[171, 221, 164],
		[94, 79, 162]
	]
};

/** Interpolate a normalized value (0..1) into an RGB color from a ramp. */
export function interpolateRamp(
	stops: [number, number, number][],
	t: number
): [number, number, number] {
	const n = stops.length - 1;
	const idx = Math.max(0, Math.min(n, t * n));
	const lo = Math.floor(idx);
	const hi = Math.min(lo + 1, n);
	const f = idx - lo;
	return [
		Math.round(stops[lo][0] + f * (stops[hi][0] - stops[lo][0])),
		Math.round(stops[lo][1] + f * (stops[hi][1] - stops[lo][1])),
		Math.round(stops[lo][2] + f * (stops[hi][2] - stops[lo][2]))
	];
}

/** Generate a CSS linear-gradient string for a color ramp. */
export function rampToGradientCss(id: ColorRampId): string {
	const stops = COLOR_RAMP_STOPS[id];
	const colors = stops.map(
		(s, i) => `rgb(${s[0]},${s[1]},${s[2]}) ${((i / (stops.length - 1)) * 100).toFixed(0)}%`
	);
	return `linear-gradient(to right, ${colors.join(', ')})`;
}

// ─── Band configuration ─────────────────────────────────────────

export interface BandConfig {
	mode: 'rgb' | 'single';
	/** 0-indexed band indices for RGB channels */
	rBand: number;
	gBand: number;
	bBand: number;
	/** 0-indexed band index for single-band mode */
	band: number;
	colorRamp: ColorRampId;
}

/** Create a sensible default band config based on COG metadata. */
export function defaultBandConfig(bandCount: number, sampleFormat: number): BandConfig {
	if (bandCount >= 3) {
		return {
			mode: 'rgb',
			rBand: 0,
			gBand: 1,
			bBand: 2,
			band: 0,
			colorRamp: 'viridis'
		};
	}
	return {
		mode: 'single',
		rBand: 0,
		gBand: 0,
		bBand: 0,
		band: 0,
		colorRamp: sampleFormat === 2 || sampleFormat === 3 ? 'terrain' : 'viridis'
	};
}

/** Check if the config matches the default for this COG (no user changes). */
export function isDefaultBandConfig(
	config: BandConfig,
	bandCount: number,
	sampleFormat: number
): boolean {
	const def = defaultBandConfig(bandCount, sampleFormat);
	return (
		config.mode === def.mode &&
		config.rBand === def.rBand &&
		config.gBand === def.gBand &&
		config.bBand === def.bBand &&
		config.band === def.band &&
		config.colorRamp === def.colorRamp
	);
}

// ─── TIFF tag inspection ─────────────────────────────────────────

export interface CogTagInfo {
	/** TIFF SampleFormat[0] value. 1=uint, 2=int, 3=float. Defaults to 1 when absent. */
	sampleFormat: number;
	/** True when SampleFormat[0] === 1 (unsigned integer). */
	isUint: boolean;
	/**
	 * True when Photometric === 3 (Palette) and the ColorMap tag is present.
	 * These COGs should defer to the library's default Colormap GPU module,
	 * not our custom JS pipeline, so the embedded palette renders correctly.
	 */
	isPaletteIndexed: boolean;
}

/**
 * Inspect the TIFF tags that drive pipeline selection. Centralizes the
 * Photometric.Palette === 3 magic number and the SampleFormat fallback in one
 * place so viewers don't reimplement raw tag reads. Photometric values come
 * from the @cogeotiff/core Photometric enum.
 */
export function inspectCogTags(geotiff: GeoTIFFType): CogTagInfo {
	const tags = geotiff.cachedTags;
	const sampleFormat = tags.sampleFormat?.[0] ?? 1;
	return {
		sampleFormat,
		isUint: sampleFormat === 1,
		isPaletteIndexed: tags.photometric === 3 && Boolean(tags.colorMap)
	};
}

/**
 * Check if a given band config requires a custom pipeline (vs library default).
 * Library default only works for uint with standard RGB band order, or for
 * palette-indexed uint COGs where the embedded ColorMap tag auto-renders.
 */
export function needsCustomPipelineForConfig(geotiff: GeoTIFFType, config: BandConfig): boolean {
	const tags = geotiff.cachedTags;
	const sf = tags.sampleFormat;
	const isUint = sf !== null && sf[0] === 1;
	if (!isUint) return true;
	// Palette-indexed uint COGs with an embedded ColorMap tag are auto-rendered
	// by the library via its Colormap GPU module. Defer to the default pipeline
	// only while the user has not changed the default band config.
	// Photometric.Palette === 3 in @cogeotiff/core.
	if (
		tags.photometric === 3 &&
		tags.colorMap &&
		isDefaultBandConfig(config, geotiff.count, sf[0])
	) {
		return false;
	}
	if (config.mode === 'single') return true;
	if (config.rBand !== 0 || config.gBand !== 1 || config.bBand !== 2) return true;
	return false;
}

// ─── Linear rescale (GPU shader module, default pipeline only) ───

/**
 * Min/max rescale values applied via the `LinearRescale` shader module. Values
 * are in normalized shader space [0, 1]. Default `{ min: 0, max: 1 }` is a
 * no-op and the library-default pipeline is used as-is.
 */
export interface RescaleConfig {
	min: number;
	max: number;
}

export const DEFAULT_RESCALE: RescaleConfig = { min: 0, max: 1 };

/** True when the rescale values would produce a visible change on the GPU. */
export function isRescaleActive(cfg: RescaleConfig): boolean {
	return cfg.min !== DEFAULT_RESCALE.min || cfg.max !== DEFAULT_RESCALE.max;
}

/**
 * Build a `getTileData` + `renderTile` pair that reuses the library-default
 * uint pipeline (via `inferRenderPipeline`) and appends `LinearRescale` to the
 * returned render pipeline. Only safe to use when the default pipeline would
 * have been chosen anyway, i.e. `needsCustomPipelineForConfig(geotiff, cfg)`
 * is false. For non-uint or custom band configs the custom JS pipeline already
 * bakes RGBA in CPU and a GPU rescale would be cosmetic.
 *
 * `inferRenderPipeline` needs the GPU `Device` which arrives in the first
 * tile's `GetTileDataOptions`, so the pipeline is built lazily on first call.
 */
export function createRescaledPipeline(
	geotiff: GeoTIFFType,
	rescale: RescaleConfig
): {
	getTileData: (
		image: GeoTIFFType | Overview,
		options: GetTileDataOptions
	) => Promise<MinimalDataT>;
	renderTile: (data: MinimalDataT) => RenderTileResult;
} {
	let builtFor: Device | null = null;
	let defaultGetTileData:
		| ((image: GeoTIFFType | Overview, options: GetTileDataOptions) => Promise<MinimalDataT>)
		| null = null;
	let defaultRenderTile: ((data: MinimalDataT) => RenderTileResult) | null = null;

	function ensureBuilt(device: Device): void {
		if (builtFor === device && defaultGetTileData && defaultRenderTile) return;
		const inferred = inferRenderPipeline(geotiff, device);
		// `inferRenderPipeline` returns generic callbacks. `MinimalDataT` is the
		// contractual superset used by COGLayer — safe upcast.
		defaultGetTileData = inferred.getTileData as unknown as (
			image: GeoTIFFType | Overview,
			options: GetTileDataOptions
		) => Promise<MinimalDataT>;
		defaultRenderTile = inferred.renderTile as unknown as (data: MinimalDataT) => RenderTileResult;
		builtFor = device;
	}

	return {
		getTileData: async (image, options) => {
			ensureBuilt(options.device);
			return defaultGetTileData!(image, options);
		},
		renderTile: (data) => {
			const base = defaultRenderTile!(data);
			const pipeline = base.renderPipeline ?? [];
			return {
				...base,
				renderPipeline: [
					...pipeline,
					{ module: LinearRescale, props: { rescaleMin: rescale.min, rescaleMax: rescale.max } }
				]
			};
		}
	};
}

// ─── GeoTIFF normalization for COGLayer ──────────────────────────

// Web Mercator's safe latitude limit. EPSG:4326 bboxes outside ±85.051129° hit
// out-of-domain proj4 NaN when the library generates its tile matrix set.
const WM_LAT_LIMIT = 85.051129;

/**
 * Apply the two upstream-bug workarounds a GeoTIFF needs before being handed
 * to `COGLayer`:
 * 1. Strip oversized overviews (image smaller than tile size). These produce
 *    out-of-domain proj4 NaN during pre-flight reprojection.
 * 2. Clamp EPSG:4326 bbox to Web Mercator's safe range. Global 4326 COGs with
 *    ±90° extents crash the tile matrix generator.
 *
 * Mutates the GeoTIFF in place. Safe to call repeatedly. Kept out of the
 * Svelte component so MultiCOG/Mosaic can apply the same fix per sub-COG.
 */
export function normalizeCogGeotiff(geotiff: GeoTIFFType): void {
	const validOverviews = geotiff.overviews.filter(
		(ov) => ov.width >= ov.tileWidth && ov.height >= ov.tileHeight
	);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(geotiff as any).overviews = validOverviews;

	if (geotiff.crs === 4326) {
		const [x0, y0, x1, y1] = geotiff.bbox;
		const clamped = [
			Math.max(x0, -180),
			Math.max(y0, -WM_LAT_LIMIT),
			Math.min(x1, 180),
			Math.min(y1, WM_LAT_LIMIT)
		] as [number, number, number, number];
		if (clamped[0] !== x0 || clamped[1] !== y0 || clamped[2] !== x1 || clamped[3] !== y1) {
			Object.defineProperty(geotiff, 'bbox', {
				value: clamped,
				writable: false,
				configurable: true
			});
		}
	}
}

// ─── Pipeline dispatch ────────────────────────────────────────────

/**
 * Resolved COGLayer data props. Empty object means "library default pipeline".
 * Spread into `new COGLayer({ ..., ...resolved })` to activate.
 *
 * COGLayer's data-prop types are a discriminated XOR and the four pipelines we
 * dispatch to return different DataT shapes (`CustomTileData`, `MinimalDataT`).
 * Typing this as `Record<string, any>` matches the `customProps` pattern
 * already used at the COGLayer boundary and keeps the dispatch site simple.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ResolvedCogPipeline = Record<string, any>;

export interface SelectCogPipelineOptions {
	/** Active band/color config, or null/undefined when not yet resolved. */
	bandConfig?: BandConfig | null;
	/** Linear rescale GPU module values. No-op when omitted or at defaults. */
	rescale?: RescaleConfig;
}

/**
 * Decide which getTileData/renderTile pair COGLayer should use for a GeoTIFF.
 * Four outcomes, in priority order:
 *
 * 1. Custom configurable (band swap, color ramp) — when bandConfig is active
 *    and needsCustomPipelineForConfig is true (non-uint, mode=single, or
 *    non-standard RGB band order).
 * 2. Custom non-uint (Int/Float source) — when no bandConfig yet but the
 *    GeoTIFF itself forces custom handling.
 * 3. Library default + LinearRescale — uint path is fine AND the user moved
 *    the rescale slider away from defaults.
 * 4. Library default — returns `{}`, caller spreads into COGLayer props.
 *
 * Pure dispatch. Kept separate from the Svelte component so MultiCOG/Mosaic
 * viewers can call it per sub-COG without re-implementing the decision tree.
 */
export function selectCogPipeline(
	geotiff: GeoTIFFType,
	opts: SelectCogPipelineOptions = {}
): ResolvedCogPipeline {
	const { bandConfig, rescale } = opts;
	const useCustom = bandConfig
		? needsCustomPipelineForConfig(geotiff, bandConfig)
		: needsCustomPipeline(geotiff);

	if (useCustom && bandConfig) {
		return {
			getTileData: createConfigurableGetTileData(geotiff, bandConfig),
			renderTile: customRenderTile
		};
	}
	if (useCustom) {
		return {
			getTileData: createCustomGetTileData(geotiff),
			renderTile: customRenderTile
		};
	}
	if (rescale && isRescaleActive(rescale)) {
		const pipeline = createRescaledPipeline(geotiff, rescale);
		return {
			getTileData: pipeline.getTileData,
			renderTile: pipeline.renderTile
		};
	}
	return {};
}

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

// ─── Terrain color ramp ──────────────────────────────────────────

/** Terrain-inspired color ramp: deep blue → green → brown → white. */
const TERRAIN_RAMP: [number, number, number][] = [
	[0, 0, 128], // deep water
	[0, 100, 200], // shallow water
	[0, 154, 80], // lowland green
	[120, 180, 50], // mid green
	[200, 170, 60], // savanna
	[180, 120, 50], // brown
	[140, 90, 40], // dark brown
	[200, 200, 200], // rock
	[255, 255, 255] // snow / peak
];

/** Interpolate a 0..1 value into a terrain RGB color. */
function terrainColor(t: number): [number, number, number] {
	const n = TERRAIN_RAMP.length - 1;
	const idx = Math.max(0, Math.min(n, t * n));
	const lo = Math.floor(idx);
	const hi = Math.min(lo + 1, n);
	const f = idx - lo;
	return [
		Math.round(TERRAIN_RAMP[lo][0] + f * (TERRAIN_RAMP[hi][0] - TERRAIN_RAMP[lo][0])),
		Math.round(TERRAIN_RAMP[lo][1] + f * (TERRAIN_RAMP[hi][1] - TERRAIN_RAMP[lo][1])),
		Math.round(TERRAIN_RAMP[lo][2] + f * (TERRAIN_RAMP[hi][2] - TERRAIN_RAMP[lo][2]))
	];
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

	// For other CRS, resolve the projection definition from the bundled EPSG
	// database (numeric codes) or fall back to ProjJSON.
	let proj4Def: string;
	if (typeof crs === 'number') {
		const wkt = await lookupEpsgWkt(crs);
		if (signal.aborted) return null;
		if (!wkt) return null;
		proj4Def = wkt;
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
	const isSingleBand = bandCount === 1;

	// Compute min/max for linear stretch (with scale/offset applied)
	let bMin = Infinity;
	let bMax = -Infinity;
	const len = Math.min(bandData.length, readW * readH);
	for (let i = 0; i < len; i++) {
		const raw = bandData[i];
		if (nodata !== null && raw === nodata) continue;
		if (!Number.isFinite(raw)) continue;
		const v = raw;
		if (v < bMin) bMin = v;
		if (v > bMax) bMax = v;
	}
	if (!Number.isFinite(bMin)) {
		bMin = 0;
		bMax = 1;
	}
	const bRange = bMax - bMin || 1;

	// Normalize to RGBA (terrain color ramp for single-band int/float)
	const pixelCount = len;
	const useTerrainRamp = isSingleBand && (sampleFormat === 2 || sampleFormat === 3);
	const rgba = new Uint8ClampedArray(pixelCount * 4);
	for (let i = 0; i < pixelCount; i++) {
		const raw = bandData[i];
		const isND = (nodata !== null && raw === nodata) || !Number.isFinite(raw);
		const idx = i * 4;
		if (isND) {
			rgba[idx] = 0;
			rgba[idx + 1] = 0;
			rgba[idx + 2] = 0;
			rgba[idx + 3] = 0;
			continue;
		}
		const t = Math.max(0, Math.min(1, (raw - bMin) / bRange));
		if (useTerrainRamp) {
			const [r, g, b] = terrainColor(t);
			rgba[idx] = r;
			rgba[idx + 1] = g;
			rgba[idx + 2] = b;
		} else {
			const gray = Math.round(t * 255);
			rgba[idx] = gray;
			rgba[idx + 1] = gray;
			rgba[idx + 2] = gray;
		}
		rgba[idx + 3] = 255;
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
 * Reads band 0, normalizes using GDAL statistics / per-tile adaptive stretch,
 * applies terrain color ramp for single-band data.
 */
export function createCustomGetTileData(geotiff: GeoTIFFType) {
	// Read Scale/Offset TIFF tags (GDAL convention for scaled datasets like DEMs)
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const tags = geotiff.cachedTags as Record<string, any>;
	// GDAL stores data-scaling Scale/Offset as TIFF tags (33550-area).
	// @developmentseed/geotiff exposes them in cachedTags but the TS type
	// doesn't declare them — access via any.
	const gdalScale: number | null = tags.scale ?? null;
	const gdalOffset: number | null = tags.offset ?? null;
	const hasScaleOffset =
		gdalScale !== null && gdalOffset !== null && (gdalScale !== 1 || gdalOffset !== 0);

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

	// If we have global stats, apply scale/offset to get real-world units
	if (globalMin !== null && globalMax !== null && hasScaleOffset) {
		globalMin = globalMin * (gdalScale ?? 1) + (gdalOffset ?? 0);
		globalMax = globalMax * (gdalScale ?? 1) + (gdalOffset ?? 0);
	}

	const bandCount = geotiff.count;
	const sf = tags.sampleFormat?.[0] ?? 1;
	const isSingleBand = bandCount === 1;

	// Shared range across all tiles — when no GDAL stats exist, the first
	// tile's scan seeds the range and subsequent tiles widen it. This
	// eliminates visible seams between tiles caused by per-tile normalization.
	let sharedMin = globalMin;
	let sharedMax = globalMax;

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

		const pixelCount = width * height;
		const scale = gdalScale ?? 1;
		const offset = gdalOffset ?? 0;

		// When no global stats, scan this tile and widen the shared range
		if (sharedMin === null || sharedMax === null) {
			let tMin = Infinity;
			let tMax = -Infinity;
			for (let i = 0; i < pixelCount; i++) {
				const raw = bandData[i];
				if (nodata !== null && raw === nodata) continue;
				if (!Number.isFinite(raw)) continue;
				const v = hasScaleOffset ? raw * scale + offset : raw;
				if (v < tMin) tMin = v;
				if (v > tMax) tMax = v;
			}
			if (Number.isFinite(tMin)) {
				sharedMin = tMin;
				sharedMax = tMax;
			} else {
				sharedMin = 0;
				sharedMax = 1;
			}
		}
		const rangeMin = sharedMin!;
		const rangeMax = sharedMax!;
		const range = rangeMax - rangeMin || 1;

		// Render to RGBA
		const rgba = new Uint8ClampedArray(pixelCount * 4);
		for (let i = 0; i < pixelCount; i++) {
			const raw = bandData[i];
			const isND = (nodata !== null && raw === nodata) || !Number.isFinite(raw);
			const idx = i * 4;
			if (isND) {
				rgba[idx] = 0;
				rgba[idx + 1] = 0;
				rgba[idx + 2] = 0;
				rgba[idx + 3] = 0;
				continue;
			}
			const v = hasScaleOffset ? raw * scale + offset : raw;
			const t = Math.max(0, Math.min(1, (v - rangeMin) / range));
			if (isSingleBand && (sf === 2 || sf === 3)) {
				// Terrain color ramp for single-band int/float (likely elevation/DEM)
				const [r, g, b] = terrainColor(t);
				rgba[idx] = r;
				rgba[idx + 1] = g;
				rgba[idx + 2] = b;
			} else {
				// Grayscale for multi-band or other types
				const gray = Math.round(t * 255);
				rgba[idx] = gray;
				rgba[idx + 1] = gray;
				rgba[idx + 2] = gray;
			}
			rgba[idx + 3] = 255;
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
 * v0.5 RasterLayer requires a RenderTileResult with `image` or `renderPipeline`.
 * We produce an ImageData and pass it through the `image` slot. deck.gl manages
 * the texture lifecycle and prepends a CreateTexture module automatically.
 */
export function customRenderTile(data: CustomTileData): { image: ImageData } {
	return { image: data.imageData };
}

// ─── Configurable custom pipeline ────────────────────────────────

/**
 * Extract band data arrays from a raster tile.
 * Returns an array of typed arrays, one per band.
 */
function extractBands(
	arr: {
		layout: string;
		bands?: ArrayLike<number>[];
		data?: ArrayLike<number>;
		count: number;
		width: number;
		height: number;
	},
	bandCount: number,
	pixelCount: number
): ArrayLike<number>[] {
	if (arr.layout === 'band-separate' && arr.bands) {
		return arr.bands as ArrayLike<number>[];
	}
	// pixel-interleaved → split into per-band arrays
	const data = arr.data!;
	const bands: ArrayLike<number>[] = [];
	for (let b = 0; b < bandCount; b++) {
		const band = new Float64Array(pixelCount);
		for (let i = 0; i < pixelCount; i++) {
			band[i] = (data as ArrayLike<number>)[i * bandCount + b];
		}
		bands.push(band);
	}
	return bands;
}

/**
 * Compute per-band min/max from an array of band data.
 * Returns [min[], max[]] for the requested band indices.
 */
function computeBandRanges(
	bands: ArrayLike<number>[],
	bandIndices: number[],
	pixelCount: number,
	nodata: number | null
): { mins: number[]; maxs: number[] } {
	const mins: number[] = [];
	const maxs: number[] = [];
	for (const bi of bandIndices) {
		const band = bands[bi];
		if (!band) {
			mins.push(0);
			maxs.push(1);
			continue;
		}
		let bMin = Infinity;
		let bMax = -Infinity;
		for (let i = 0; i < pixelCount; i++) {
			const v = band[i];
			if (nodata !== null && v === nodata) continue;
			if (!Number.isFinite(v)) continue;
			if (v < bMin) bMin = v;
			if (v > bMax) bMax = v;
		}
		mins.push(Number.isFinite(bMin) ? bMin : 0);
		maxs.push(Number.isFinite(bMax) ? bMax : 1);
	}
	return { mins, maxs };
}

/**
 * Create a configurable getTileData that respects BandConfig.
 * Supports both RGB mode (multi-band → R,G,B) and single-band mode (color ramp).
 */
export function createConfigurableGetTileData(geotiff: GeoTIFFType, config: BandConfig) {
	const bandCount = geotiff.count;

	// Shared per-band ranges across tiles (seeded on first tile, widened by subsequent)
	const sharedMins = new Map<number, number>();
	const sharedMaxs = new Map<number, number>();

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
		const pixelCount = width * height;
		const bands = extractBands(arr, bandCount, pixelCount);

		const rgba = new Uint8ClampedArray(pixelCount * 4);

		if (config.mode === 'rgb') {
			// RGB mode: map 3 bands to R, G, B
			const indices = [config.rBand, config.gBand, config.bBand];
			// Compute ranges for the 3 selected bands
			for (const bi of indices) {
				if (!sharedMins.has(bi)) {
					const { mins, maxs } = computeBandRanges(bands, [bi], pixelCount, nodata);
					sharedMins.set(bi, mins[0]);
					sharedMaxs.set(bi, maxs[0]);
				}
			}

			const rBand = bands[config.rBand];
			const gBand = bands[config.gBand];
			const bBand = bands[config.bBand];
			const rMin = sharedMins.get(config.rBand)!;
			const rMax = sharedMaxs.get(config.rBand)!;
			const gMin = sharedMins.get(config.gBand)!;
			const gMax = sharedMaxs.get(config.gBand)!;
			const bMin = sharedMins.get(config.bBand)!;
			const bMax = sharedMaxs.get(config.bBand)!;
			const rRange = rMax - rMin || 1;
			const gRange = gMax - gMin || 1;
			const bRange = bMax - bMin || 1;

			for (let i = 0; i < pixelCount; i++) {
				const rv = rBand?.[i] ?? 0;
				const gv = gBand?.[i] ?? 0;
				const bv = bBand?.[i] ?? 0;
				const isND =
					(nodata !== null && (rv === nodata || gv === nodata || bv === nodata)) ||
					!Number.isFinite(rv);
				const idx = i * 4;
				if (isND) {
					rgba[idx] = 0;
					rgba[idx + 1] = 0;
					rgba[idx + 2] = 0;
					rgba[idx + 3] = 0;
				} else {
					rgba[idx] = Math.round(Math.max(0, Math.min(1, (rv - rMin) / rRange)) * 255);
					rgba[idx + 1] = Math.round(Math.max(0, Math.min(1, (gv - gMin) / gRange)) * 255);
					rgba[idx + 2] = Math.round(Math.max(0, Math.min(1, (bv - bMin) / bRange)) * 255);
					rgba[idx + 3] = 255;
				}
			}
		} else {
			// Single-band mode: normalize + color ramp
			const bi = config.band;
			const bandData = bands[bi];
			if (!sharedMins.has(bi) && bandData) {
				const { mins, maxs } = computeBandRanges(bands, [bi], pixelCount, nodata);
				sharedMins.set(bi, mins[0]);
				sharedMaxs.set(bi, maxs[0]);
			}
			const rangeMin = sharedMins.get(bi) ?? 0;
			const rangeMax = sharedMaxs.get(bi) ?? 1;
			const range = rangeMax - rangeMin || 1;
			const rampStops = COLOR_RAMP_STOPS[config.colorRamp];

			for (let i = 0; i < pixelCount; i++) {
				const raw = bandData?.[i] ?? 0;
				const isND = (nodata !== null && raw === nodata) || !Number.isFinite(raw);
				const idx = i * 4;
				if (isND) {
					rgba[idx] = 0;
					rgba[idx + 1] = 0;
					rgba[idx + 2] = 0;
					rgba[idx + 3] = 0;
				} else {
					const t = Math.max(0, Math.min(1, (raw - rangeMin) / range));
					const [r, g, b] = interpolateRamp(rampStops, t);
					rgba[idx] = r;
					rgba[idx + 1] = g;
					rgba[idx + 2] = b;
					rgba[idx + 3] = 255;
				}
			}
		}

		return { imageData: new ImageData(rgba, width, height), width, height };
	};
}

// ─── Pixel inspection ────────────────────────────────────────────

export interface PixelValue {
	lng: number;
	lat: number;
	values: number[];
	row: number;
	col: number;
}

// ─── EPSG resolution via bundled database ────────────────────────

/**
 * Look up the WKT string for an EPSG code from the bundled
 * `@developmentseed/epsg` database. The CSV is streamed, gunzipped and parsed
 * once on first use, subsequent lookups share the cached map via the
 * `loadEpsg()` internal singleton promise.
 */
async function lookupEpsgWkt(code: number): Promise<string | null> {
	const db = await loadEpsg(epsgCsvUrl);
	return db.get(code) ?? null;
}

// Units that `@developmentseed/proj` `metersPerUnit` accepts.
const ACCEPTED_CRS_UNITS = new Set([
	'm',
	'metre',
	'meter',
	'meters',
	'foot',
	'us survey foot',
	'degree'
]);

/**
 * Normalize a parsed projection definition so `generateTileMatrixSet` can
 * compute metersPerUnit. wkt-parser sets `units = wkt.UNIT.name.toLowerCase()`
 * and some EPSG WKT entries in the bundled database have a missing or
 * non-standard UNIT node, which surfaces as `units = "unknown"` and a downstream
 * throw. Infer the unit from `to_meter` or projection type when possible.
 */
function normalizeCrsUnits(def: ProjectionDefinition): ProjectionDefinition {
	const current = def.units?.toLowerCase();
	if (current && ACCEPTED_CRS_UNITS.has(current)) return def;
	if (def.projName === 'longlat') {
		def.units = 'degree';
		return def;
	}
	const toMeter = def.to_meter;
	if (toMeter === undefined || Math.abs(toMeter - 1) < 1e-9) {
		def.units = 'meter';
	} else if (Math.abs(toMeter - 0.3048) < 1e-9) {
		def.units = 'foot';
	} else if (Math.abs(toMeter - 1200 / 3937) < 1e-9) {
		def.units = 'us survey foot';
	}
	return def;
}

/**
 * Create an async EPSG resolver for `@developmentseed/deck.gl-geotiff`.
 * Looks up the numeric EPSG code in the bundled WKT database and returns the
 * `ProjectionDefinition` produced by `parseWkt`. Throws a clear error when the
 * code is not present in the database.
 */
export function createEpsgResolver(): EpsgResolver {
	const cache = new Map<number, ProjectionDefinition>();
	return async (code: number): Promise<ProjectionDefinition> => {
		const cached = cache.get(code);
		if (cached) return cached;
		const wkt = await lookupEpsgWkt(code);
		if (!wkt) {
			throw new Error(`EPSG:${code} not found in bundled projection database`);
		}
		const def = normalizeCrsUnits(parseWkt(wkt));
		cache.set(code, def);
		return def;
	};
}

/**
 * Resolve a proj4-compatible definition for a CRS read from a GeoTIFF.
 * For numeric EPSG codes this returns the WKT string from the bundled EPSG
 * database, which `proj4()` accepts directly. For ProjJSON it falls back to a
 * JSON string. Returns null for EPSG:4326 (no conversion needed) or when the
 * code is not present in the database.
 */
export async function resolveProj4Def(
	crs: number | unknown,
	_signal: AbortSignal
): Promise<string | null> {
	if (crs === 4326) return null;
	if (typeof crs === 'number') {
		return lookupEpsgWkt(crs);
	}
	// ProjJSON — stringify for proj4
	return JSON.stringify(crs);
}

/**
 * Read pixel values at a given lng/lat from a GeoTIFF.
 * Converts WGS84 → source CRS → pixel coords, fetches the tile, reads all bands.
 */
export async function readPixelAtLngLat(
	geotiff: GeoTIFFType,
	lng: number,
	lat: number,
	proj4Def: string | null,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	pool: any,
	signal?: AbortSignal
): Promise<PixelValue | null> {
	// Convert WGS84 to source CRS
	let srcX = lng;
	let srcY = lat;
	if (proj4Def) {
		try {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const conv = proj4Lib(proj4Def, 'EPSG:4326') as any;
			[srcX, srcY] = conv.inverse([lng, lat]);
		} catch {
			return null;
		}
	}

	// Get pixel indices (row, col)
	const [row, col] = geotiff.index(srcX, srcY);
	if (row < 0 || row >= geotiff.height || col < 0 || col >= geotiff.width) return null;

	// Compute tile indices
	const tileX = Math.floor(col / geotiff.tileWidth);
	const tileY = Math.floor(row / geotiff.tileHeight);

	// Fetch tile
	const tile = await geotiff.fetchTile(tileX, tileY, { pool, signal });
	const arr = tile.array;

	// Read all band values at this pixel
	const localCol = col - tileX * arr.width;
	const localRow = row - tileY * arr.height;
	const pixelIndex = localRow * arr.width + localCol;

	const values: number[] = [];
	if (arr.layout === 'band-separate') {
		for (let b = 0; b < arr.count; b++) {
			values.push((arr as { bands: ArrayLike<number>[] }).bands[b][pixelIndex]);
		}
	} else {
		for (let b = 0; b < arr.count; b++) {
			values.push((arr as { data: ArrayLike<number> }).data[pixelIndex * arr.count + b]);
		}
	}

	return { lng, lat, values, row, col };
}
