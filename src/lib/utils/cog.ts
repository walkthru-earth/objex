import type { GetTileDataOptions, MinimalDataT } from '@developmentseed/deck.gl-geotiff';
import { inferRenderPipeline } from '@developmentseed/deck.gl-geotiff';
import type { RasterModule, RenderTileResult } from '@developmentseed/deck.gl-raster';
import {
	Colormap,
	FilterNoDataVal,
	LinearRescale
} from '@developmentseed/deck.gl-raster/gpu-modules';
import loadEpsg from '@developmentseed/epsg/all';
import epsgCsvUrl from '@developmentseed/epsg/all.csv.gz?url';
import type { GeoTIFF as GeoTIFFType, Overview } from '@developmentseed/geotiff';
import { GeoTIFF } from '@developmentseed/geotiff';
import type { EpsgResolver, ProjectionDefinition } from '@developmentseed/proj';
import { parseWkt } from '@developmentseed/proj';
import type { Device } from '@luma.gl/core';
import type maplibregl from 'maplibre-gl';
import proj4Lib from 'proj4';
import {
	buildDataTypeLabel,
	type CogInfo,
	clampBounds,
	type GeoBounds,
	SF_LABELS,
	safeClamp
} from './cog-pure.js';
import { COLORMAP_INDEX, type ColormapName, getColormapTexture } from './colormap-sprite.js';

export { buildDataTypeLabel, type CogInfo, clampBounds, type GeoBounds, SF_LABELS, safeClamp };

// ─── Constants ───────────────────────────────────────────────────

/**
 * Patches a GLSL ES 3.00 compile error in `@developmentseed/deck.gl-raster`
 * v0.6.0-alpha.1. The `Colormap` shader module injects
 * `uniform sampler2DArray colormapTexture;` without a precision qualifier,
 * which the Apple-GPU path of luma.gl's WebGL2 backend rejects with
 * `ERROR: 'sampler2DArray' : No precision specified`. In GLSL ES 3.00,
 * every sampler type other than `sampler2D`/`samplerCube` needs explicit
 * precision in fragment shaders.
 *
 * Chain this module immediately BEFORE `Colormap` in the renderPipeline so
 * the combined `fs:#decl` inject emits the precision declaration first,
 * then the sampler uniform. Remove once upstream ships the precision fix.
 */
const Sampler2DArrayPrecision = {
	name: 'sampler2darray-precision',
	fs: '',
	inject: {
		'fs:#decl': 'precision highp sampler2DArray;\n'
	}
} as const;

// `SF_LABELS` moved to `./cog-pure.ts` (re-exported above) so that
// `objex-utils` can consume it without pulling in heavy COG deps.

// ─── Color ramps ─────────────────────────────────────────────────

/**
 * Any of the 107 named ramps shipped in `@developmentseed/deck.gl-raster`'s
 * `colormaps.png` sprite (matplotlib + rio-tiler + cmocean). Rendering is
 * GPU-side via the `Colormap` shader module; switching ramps is a uniform
 * update, no tile re-decode.
 */
export type ColorRampId = ColormapName;

// Previously this file hosted a handcoded `COLOR_RAMP_STOPS` table plus
// `interpolateRamp` / `rampToGradientCss` helpers used by both the CPU
// single-band baker and the CogControls UI preview. All callers migrated
// to the shipped `colormaps.png` sprite (107 ramps, GPU-sampled via the
// `Colormap` shader module). See `utils/colormap-sprite.ts`.

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
	if (bandCount >= 3 && bandCount <= 4) {
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
	// GPU textures accept 1-4 channels; COGs with more samples per pixel (embeddings,
	// hyperspectral, multi-band features) must route through the CPU pipeline which
	// reads selected band indices and bakes RGBA. Otherwise the library throws
	// "Unsupported SamplesPerPixel N" in verifySamplesPerPixel.
	if (geotiff.count > 4) return true;
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
	// 4-band uint (e.g. NAIP RGB+NIR) must route through the CPU pipeline.
	// The library default maps all 4 samples to RGBA, turning the extra band
	// into a variable alpha channel even when it is not an alpha declaration.
	// The custom pipeline explicitly picks 3 bands and bakes alpha=255.
	if (geotiff.count === 4) return true;
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
 * Pick a sensible default `RescaleConfig` for a freshly opened COG. The slider
 * operates in normalized shader space [0, 1], but the GPU's hardware
 * normalization (`r8unorm` / `r16unorm` in `MultiCOGLayer`, or the library
 * default uint pipeline elsewhere) collapses raw integer values onto that
 * range by dividing by the format's max (255 for uint8, 65535 for uint16).
 *
 * For uint8 visual COGs (Sentinel-2 `visual` TCI, NAIP `image`) the natural
 * land brightness sits around raw 50-100, so `max: 0.3` (≈ raw 76) gives a
 * nicely contrasted preview. For uint16 reflectance bands (Sentinel-2 raw
 * `nir` / `swir16` / `red`, Landsat C2 L2 `*_B*`) typical land surfaces sit at
 * raw 800-3000 (reflectance × 10000), which is `0.012-0.046` after r16unorm.
 * `max: 0.3` would render those near-black; `max: 0.05` (≈ raw 3277) keeps
 * vegetation, soil, and water in the visible range while leaving headroom for
 * brighter targets.
 *
 * Float / int sample formats fall back to the conservative `{0, 1}` no-op so
 * the user can dial in their own range via the slider.
 */
export function defaultRescaleForGeotiff(geotiff: GeoTIFFType): RescaleConfig {
	const tags = geotiff.cachedTags;
	const sampleFormat = tags.sampleFormat?.[0] ?? 1;
	if (sampleFormat !== 1) return { ...DEFAULT_RESCALE };
	const bps = tags.bitsPerSample?.[0] ?? 8;
	if (bps <= 8) return { min: 0, max: 0.3 };
	return { min: 0, max: 0.05 };
}

/**
 * Build a 64-bin histogram of band 0 from a GeoTIFF's smallest overview, in
 * the same shader-space [0, 1] coordinate system the rescale slider operates
 * on (raw / 65535 for uint16, raw / 255 for uint8, raw clamped to [0, 1] for
 * float). Used by viewers on the multi-asset MultiCOGLayer path to give the
 * rescale slider a histogram backdrop without hooking per-tile sampling into
 * the layer.
 *
 * Returns null if the smallest overview cannot be fetched. Skips the GeoTIFF's
 * declared nodata value and non-finite values.
 */
/**
 * Walk a cumulative histogram (`HISTOGRAM_BIN_COUNT` bins covering [0, 1])
 * and return the shader-space value at percentile `p` (0..1). Returns null
 * when the histogram is empty. Linearly interpolates within the matching bin
 * so the result is monotonic across calls with adjacent percentiles, instead
 * of jumping in `1/HISTOGRAM_BIN_COUNT` increments.
 */
export function percentileFromHistogram(histogram: Uint32Array | null, p: number): number | null {
	if (!histogram || histogram.length !== HISTOGRAM_BIN_COUNT) return null;
	let total = 0;
	for (let i = 0; i < HISTOGRAM_BIN_COUNT; i++) total += histogram[i];
	if (total === 0) return null;
	const target = total * Math.max(0, Math.min(1, p));
	let acc = 0;
	for (let i = 0; i < HISTOGRAM_BIN_COUNT; i++) {
		const next = acc + histogram[i];
		if (next >= target) {
			const frac = histogram[i] === 0 ? 0 : (target - acc) / histogram[i];
			return (i + frac) / HISTOGRAM_BIN_COUNT;
		}
		acc = next;
	}
	return 1;
}

export async function buildHistogramFromGeotiff(
	geotiff: GeoTIFFType,
	signal?: AbortSignal
): Promise<Uint32Array | null> {
	const tags = geotiff.cachedTags;
	const sampleFormat = tags.sampleFormat?.[0] ?? 1;
	const bps = tags.bitsPerSample?.[0] ?? 8;
	const norm = sampleFormat === 1 ? (bps <= 8 ? 255 : 65535) : 1;
	const nodata = geotiff.nodata;

	const overviews = geotiff.overviews ?? [];
	const sourceImage = overviews.length ? overviews[overviews.length - 1] : geotiff;
	try {
		const tile = await sourceImage.fetchTile(0, 0, { signal });
		if (signal?.aborted) return null;
		const arr = tile.array;
		const data: ArrayLike<number> = arr.layout === 'band-separate' ? arr.bands[0] : arr.data;
		const stride = arr.layout === 'band-separate' ? 1 : (arr.count ?? 1);
		const histogram = new Uint32Array(HISTOGRAM_BIN_COUNT);
		let counted = 0;
		const len = data.length;
		for (let i = 0; i < len; i += stride) {
			const raw = data[i];
			if (!Number.isFinite(raw)) continue;
			if (nodata !== null && raw === nodata) continue;
			const t = sampleFormat === 1 ? raw / norm : Math.max(0, Math.min(1, raw));
			if (t < 0 || t > 1) continue;
			const bin = Math.min(HISTOGRAM_BIN_COUNT - 1, Math.floor(t * HISTOGRAM_BIN_COUNT));
			histogram[bin]++;
			counted++;
		}
		console.debug('[buildHistogramFromGeotiff] OK', {
			usingOverview: overviews.length > 0,
			sampleFormat,
			bps,
			norm,
			nodata,
			layout: arr.layout,
			count: arr.count,
			tilePixels: len,
			counted,
			nonZeroBins: histogram.reduce((acc, v) => acc + (v > 0 ? 1 : 0), 0)
		});
		if (counted === 0) return null;
		return histogram;
	} catch (err) {
		console.warn('[buildHistogramFromGeotiff] fetchTile failed', {
			usingOverview: overviews.length > 0,
			err
		});
		return null;
	}
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

export interface BandRenderPipelineOptions {
	/** Value treated as "no-data" and zeroed out by `FilterNoDataVal`. */
	noDataVal?: number | null;
	/** Linear rescale applied after no-data masking. Omit for no rescaling. */
	rescale?: RescaleConfig;
}

/**
 * Build a `renderPipeline` array for `MultiCOGLayer` / raster mosaics.
 * Combines optional `FilterNoDataVal` + `LinearRescale` stages in the order
 * the GPU expects (no-data mask first, then rescale).
 */
export function buildBandRenderPipeline(opts: BandRenderPipelineOptions = {}): RasterModule[] {
	const modules: RasterModule[] = [];
	if (opts.noDataVal !== undefined && opts.noDataVal !== null) {
		modules.push({
			module: FilterNoDataVal,
			props: { noDataVal: opts.noDataVal }
		});
	}
	if (opts.rescale && isRescaleActive(opts.rescale)) {
		modules.push({
			module: LinearRescale,
			props: { rescaleMin: opts.rescale.min, rescaleMax: opts.rescale.max }
		});
	}
	return modules;
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
			renderTile: buildCustomRenderTile(bandConfig, rescale)
		};
	}
	if (useCustom) {
		// Synthesize a single-band config so the GPU Colormap path still
		// applies when a non-uint COG renders without a user-chosen ramp.
		const fallbackSf = geotiff.cachedTags.sampleFormat?.[0] ?? 1;
		const fallbackConfig = defaultBandConfig(geotiff.count, fallbackSf);
		return {
			getTileData: createCustomGetTileData(geotiff),
			renderTile: buildCustomRenderTile(fallbackConfig, rescale)
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

// ─── Types & pure helpers ────────────────────────────────────────
// `GeoBounds`, `CogInfo`, `safeClamp`, `clampBounds`, `buildDataTypeLabel`
// live in `./cog-pure.ts` and are re-exported at the top of this file.

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
	/**
	 * `sampler2DArray` colormap texture for single-band renders. Set by
	 * `createConfigurableGetTileData` / `createCustomGetTileData` when the
	 * first tile resolves the device-bound sprite texture; `undefined` for
	 * RGB-mode tiles (no colormap needed). Passed through to `renderTile`
	 * so the Colormap shader module can bind it on every layer.
	 */
	colormapTexture?: Texture;
	/**
	 * Normalized `color.r` sentinel value for nodata pixels in single-band
	 * mode. The `Colormap` shader module overwrites all 4 output channels
	 * from the 1D ramp sample, destroying the α=0 flag, so we reserve
	 * `r = 0` for nodata and renormalize valid data into `(0, 1]`.
	 * `FilterNoDataVal` then discards matching fragments before the ramp
	 * lookup. `undefined` for RGB tiles.
	 */
	nodataSentinel?: number;
	/**
	 * Per-tile 64-bin normalized histogram (0..1, nodata excluded) baked during
	 * single-band CPU decoding. `undefined` for RGB tiles. deck.gl's TileLayer
	 * caches the returned tile object, so this array is retained alongside the
	 * bitmap without a rebake on pan/zoom revisits. Summing the histograms of
	 * currently-visible tiles, via the TileLayer `onViewportLoad` hook, gives a
	 * cloud-native "histogram of what COG tiles the viewport currently shows at
	 * the active overview level", matching COG pyramid behavior.
	 */
	histogram?: Uint32Array;
}

// Avoid pulling in the @luma.gl/core Texture type at the top of the file via
// a value import; the existing top-level `Device` import is `type`-only.
type Texture = import('@luma.gl/core').Texture;

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
 * Shared options for the CPU tile-baking factories.
 *
 * The previous `onHistogram` callback accumulated a single closure-owned buffer
 * across every tile ever baked, which grew unbounded on pan/zoom and never
 * reflected "what the viewport currently shows". Histograms are now attached
 * per tile to `CustomTileData.histogram` and aggregated by the viewer from
 * TileLayer's `onViewportLoad(visibleTiles)` hook, matching COG overview-level
 * behavior (few big tiles when zoomed out, small AOI-scoped tiles when zoomed
 * in) and reusing deck.gl's tile cache for free.
 */
export type CustomGetTileDataOptions = Record<string, never>;

/** Number of histogram buckets produced by the CPU bake. */
export const HISTOGRAM_BIN_COUNT = 64;

/**
 * Create custom getTileData for non-uint COGs.
 * Reads band 0, normalizes using GDAL statistics / per-tile adaptive stretch,
 * bakes a grayscale `r`-channel image so the GPU `Colormap` shader module
 * (wired downstream by `selectCogPipeline`) can apply the ramp by sampling
 * `colormaps.png`. Reserves `r = 0` for nodata so `FilterNoDataVal` can
 * discard those fragments before the ramp sample.
 */
export function createCustomGetTileData(
	geotiff: GeoTIFFType,
	_opts: CustomGetTileDataOptions = {}
) {
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
	const isSingleBand = bandCount === 1;

	// Shared range across all tiles — when no GDAL stats exist, the first
	// tile's scan seeds the range and subsequent tiles widen it. This
	// eliminates visible seams between tiles caused by per-tile normalization.
	let sharedMin = globalMin;
	let sharedMax = globalMax;

	// Resolve the sprite texture from the first tile's device; reuse per-device.
	let texturePromise: Promise<Texture> | null = null;

	return async (
		image: GeoTIFFType | Overview,
		options: { x: number; y: number; pool: unknown; signal?: AbortSignal; device: Device }
	): Promise<CustomTileData> => {
		if (isSingleBand && !texturePromise) {
			texturePromise = getColormapTexture(options.device);
		}

		const [tile, colormapTexture] = await Promise.all([
			image.fetchTile(options.x, options.y, {
				boundless: false,
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				pool: options.pool as any,
				signal: options.signal
			}),
			texturePromise ?? Promise.resolve<Texture | undefined>(undefined)
		]);

		const arr = tile.array;
		const { width, height, nodata } = arr;
		const bandData: ArrayLike<number> = arr.layout === 'band-separate' ? arr.bands[0] : arr.data;

		const pixelCount = width * height;
		const scale = gdalScale ?? 1;
		const offset = gdalOffset ?? 0;

		// Allocate per-tile histogram so deck.gl's tile cache retains it with
		// the tile object. The viewer sums histograms of visible tiles from
		// TileLayer's `onViewportLoad` hook, no shared accumulator needed.
		const histogram = isSingleBand ? new Uint32Array(HISTOGRAM_BIN_COUNT) : null;

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

		// Render to RGBA. For single-band we bake normalized value into the
		// `r` channel and reserve `r = 0` for nodata (see CustomTileData
		// docs). Multi-band non-uint keeps the plain grayscale + α=255
		// output so the default library pipeline consumes it unchanged.
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
			if (isSingleBand) {
				// Reserve r=0 for nodata; valid data maps to [1, 255].
				const gray = 1 + Math.round(t * 254);
				rgba[idx] = gray;
				rgba[idx + 1] = 0;
				rgba[idx + 2] = 0;
				if (histogram) {
					const bin = Math.min(HISTOGRAM_BIN_COUNT - 1, Math.floor(t * HISTOGRAM_BIN_COUNT));
					histogram[bin]++;
				}
			} else {
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
			height,
			colormapTexture: isSingleBand ? colormapTexture : undefined,
			nodataSentinel: isSingleBand ? 0 : undefined,
			histogram: histogram ?? undefined
		};
	};
}

/**
 * Custom renderTile for COGs that use the CPU pipeline. For RGB mode (and
 * legacy multi-band non-uint), the `image` slot carries a fully-baked RGBA
 * `ImageData` and there is nothing to append on the GPU. For single-band
 * mode, the image carries a normalized `r`-channel and this function
 * appends `FilterNoDataVal` (to discard r=0 nodata sentinels), optional
 * `LinearRescale` (brightness/contrast slider), and the sprite-based
 * `Colormap` module so switching ramps is a uniform update — no tile
 * re-decode required. The `colormapTexture` is stashed on `data` by the
 * corresponding `getTileData` factory; if the sprite failed to resolve we
 * fall back to the plain grayscale image.
 */
export function buildCustomRenderTile(
	config: BandConfig,
	rescale?: RescaleConfig
): (data: CustomTileData) => RenderTileResult {
	return (data) => {
		if (config.mode === 'rgb' || !data.colormapTexture) {
			return { image: data.imageData };
		}
		const colormapIndex = COLORMAP_INDEX[config.colorRamp] ?? COLORMAP_INDEX.viridis;
		const pipeline: RasterModule[] = [
			{
				module: FilterNoDataVal,
				props: { value: (data.nodataSentinel ?? 0) / 255 }
			}
		];
		if (rescale && isRescaleActive(rescale)) {
			pipeline.push({
				module: LinearRescale,
				props: { rescaleMin: rescale.min, rescaleMax: rescale.max }
			});
		}
		pipeline.push(
			// Precision shim must come before Colormap, its `fs:#decl` inject
			// declares `precision highp sampler2DArray;` so the subsequent
			// sampler uniform compiles on WebGL2 / Apple GPU.
			{ module: Sampler2DArrayPrecision, props: {} },
			{
				module: Colormap,
				props: {
					colormapTexture: data.colormapTexture,
					colormapIndex,
					reversed: false
				}
			}
		);
		return { image: data.imageData, renderPipeline: pipeline };
	};
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
 * Supports RGB mode (multi-band → R,G,B with alpha=255, fully baked) and
 * single-band mode (band N normalized into the `r` channel; the ramp is
 * applied downstream by the GPU `Colormap` module via `buildCustomRenderTile`).
 */
export function createConfigurableGetTileData(
	geotiff: GeoTIFFType,
	config: BandConfig,
	_opts: CustomGetTileDataOptions = {}
) {
	const bandCount = geotiff.count;

	// Shared per-band ranges across tiles (seeded on first tile, widened by subsequent)
	const sharedMins = new Map<number, number>();
	const sharedMaxs = new Map<number, number>();

	// Resolve the sprite texture from the first tile's device; reuse per-device.
	let texturePromise: Promise<Texture> | null = null;

	return async (
		image: GeoTIFFType | Overview,
		options: { x: number; y: number; pool: unknown; signal?: AbortSignal; device: Device }
	): Promise<CustomTileData> => {
		if (config.mode === 'single' && !texturePromise) {
			texturePromise = getColormapTexture(options.device);
		}

		const [tile, colormapTexture] = await Promise.all([
			image.fetchTile(options.x, options.y, {
				boundless: false,
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				pool: options.pool as any,
				signal: options.signal
			}),
			texturePromise ?? Promise.resolve<Texture | undefined>(undefined)
		]);

		const arr = tile.array;
		const { width, height, nodata } = arr;
		const pixelCount = width * height;
		const bands = extractBands(arr, bandCount, pixelCount);

		const rgba = new Uint8ClampedArray(pixelCount * 4);

		// Per-tile histogram, cached by deck.gl's tile cache with the tile
		// object. Cloud-native by construction: at each zoom level, COG only
		// decodes the overview tiles that cover the viewport, so the summed
		// histogram naturally reflects "what the user is looking at right now".
		const histogram = config.mode === 'single' ? new Uint32Array(HISTOGRAM_BIN_COUNT) : null;

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
			// Single-band mode: normalize the selected band into the `r`
			// channel and reserve `r = 0` as a nodata sentinel that
			// `FilterNoDataVal` discards before the `Colormap` GPU lookup.
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
					rgba[idx] = 1 + Math.round(t * 254);
					rgba[idx + 1] = 0;
					rgba[idx + 2] = 0;
					rgba[idx + 3] = 255;
					if (histogram) {
						const bin = Math.min(HISTOGRAM_BIN_COUNT - 1, Math.floor(t * HISTOGRAM_BIN_COUNT));
						histogram[bin]++;
					}
				}
			}
		}

		return {
			imageData: new ImageData(rgba, width, height),
			width,
			height,
			colormapTexture: config.mode === 'single' ? colormapTexture : undefined,
			nodataSentinel: config.mode === 'single' ? 0 : undefined,
			histogram: histogram ?? undefined
		};
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
