<script lang="ts">
import { MapboxOverlay } from '@deck.gl/mapbox';
import { COGLayer, parseCOGTileMatrixSet, proj } from '@developmentseed/deck.gl-geotiff';
import { fromUrl } from 'geotiff';
import { toProj4 } from 'geotiff-geokeys-to-proj4';
import type maplibregl from 'maplibre-gl';
import proj4Lib from 'proj4';
import { onDestroy, untrack } from 'svelte';
import { t } from '$lib/i18n/index.svelte.js';
import { tabResources } from '$lib/stores/tab-resources.svelte.js';
import type { Tab } from '$lib/types';
import { buildHttpsUrl } from '$lib/utils/url.js';
import MapContainer from './map/MapContainer.svelte';

// ─── Helpers ─────────────────────────────────────────────────────

const SF_LABELS: Record<number, string> = {
	1: 'uint',
	2: 'int',
	3: 'float',
	4: 'void',
	5: 'complex int',
	6: 'complex float'
};

/**
 * GeoTIFF projection code → proj4 mapping for projections that
 * geotiff-geokeys-to-proj4 doesn't recognise (returns longlat fallback).
 * Key = ProjCoordTransGeoKey value from GeoTIFF spec section 6.3.3.3.
 */
const PROJ_CT_FALLBACK: Record<number, string> = {
	11: '+proj=moll', // CT_Mollweide
	12: '+proj=eck4', // CT_EckertIV
	13: '+proj=eck6', // CT_EckertVI
	14: '+proj=vandg', // CT_VanDerGrinten
	15: '+proj=robin', // CT_Robinson
	16: '+proj=sinu' // CT_Sinusoidal
};

/**
 * ESRI PE String PROJECTION name → proj4 +proj parameter.
 * Many GeoTIFFs (especially from ArcGIS/rasterio) embed the projection
 * as an ESRI PE String in PCSCitationGeoKey rather than setting
 * ProjCoordTransGeoKey. This map handles common pseudo-cylindrical
 * and other projections that toProj4 can't parse.
 */
const ESRI_PROJ_MAP: Record<string, string> = {
	Mollweide: '+proj=moll',
	Eckert_IV: '+proj=eck4',
	Eckert_VI: '+proj=eck6',
	Van_der_Grinten_I: '+proj=vandg',
	Robinson: '+proj=robin',
	Sinusoidal: '+proj=sinu',
	Goode_Homolosine: '+proj=igh',
	Winkel_Tripel: '+proj=wintri'
};

/**
 * Try to extract a proj4 string from ESRI PE String in PCSCitationGeoKey.
 * Returns null if no recognized projection is found.
 */
function tryParseEsriCitation(geoKeys: Record<string, unknown>): string | null {
	const citation = geoKeys.PCSCitationGeoKey as string | undefined;
	if (!citation) return null;

	// Extract PROJECTION["Name"] from the ESRI PE string
	const match = citation.match(/PROJECTION\["([^"]+)"\]/);
	if (!match) return null;

	const projName = match[1];
	const proj4Proj = ESRI_PROJ_MAP[projName];
	if (!proj4Proj) return null;

	// Extract parameters
	const params: Record<string, number> = {};
	const paramRe = /PARAMETER\["([^"]+)",([\s\S]*?)\]/g;
	for (const m of citation.matchAll(paramRe)) {
		params[m[1]] = parseFloat(m[2]);
	}

	const lon0 = params.Central_Meridian ?? params.central_meridian ?? 0;
	const fe = params.False_Easting ?? params.false_easting ?? 0;
	const fn = params.False_Northing ?? params.false_northing ?? 0;

	return `${proj4Proj} +lon_0=${lon0} +x_0=${fe} +y_0=${fn} +datum=WGS84 +units=m +no_defs`;
}

/**
 * Custom GeoKeys parser using geotiff-geokeys-to-proj4.
 * Bypasses the default proj4 EPSG lookup (which fails for non-standard CRS codes
 * like EPSG:32767) by parsing GeoKeys directly into a proj4 definition string.
 *
 * Falls back to manual proj4 construction for user-defined projections
 * detected via ProjCoordTransGeoKey or ESRI PE String in PCSCitationGeoKey.
 */
async function geoKeysParser(
	geoKeys: Record<string, unknown>
): Promise<proj.ProjectionInfo | null> {
	try {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const projDef = toProj4(geoKeys as any);
		const def = projDef.proj4 as string;

		// Detect misdetected CRS: toProj4 returns +proj=longlat for projections
		// it doesn't handle. Check two sources:
		// 1. ProjCoordTransGeoKey (GeoTIFF standard projection codes)
		// 2. ESRI PE String in PCSCitationGeoKey (common in ArcGIS/rasterio output)
		if (def.includes('+proj=longlat')) {
			let corrected: string | null = null;

			// Try ProjCoordTransGeoKey first
			const ct = geoKeys.ProjCoordTransGeoKey as number | undefined;
			if (ct && PROJ_CT_FALLBACK[ct]) {
				const lon0 = (geoKeys.ProjNatOriginLongGeoKey ??
					geoKeys.ProjCenterLongGeoKey ??
					0) as number;
				const fe = (geoKeys.ProjFalseEastingGeoKey ?? 0) as number;
				const fn = (geoKeys.ProjFalseNorthingGeoKey ?? 0) as number;
				corrected = `${PROJ_CT_FALLBACK[ct]} +lon_0=${lon0} +x_0=${fe} +y_0=${fn} +datum=WGS84 +units=m +no_defs`;
			}

			// Try ESRI PE String in PCSCitationGeoKey
			if (!corrected) {
				corrected = tryParseEsriCitation(geoKeys);
			}

			if (corrected) {
				console.log(`[COG:geokeys] corrected CRS from longlat → ${corrected}`);
				return {
					def: corrected,
					parsed: proj.parseCrs(corrected),
					coordinatesUnits: 'metre' as proj.SupportedCrsUnit
				};
			}
		}

		return {
			def,
			parsed: proj.parseCrs(def),
			coordinatesUnits: projDef.coordinatesUnits as proj.SupportedCrsUnit
		};
	} catch {
		return null;
	}
}

/**
 * Query the browser's WebGL MAX_TEXTURE_SIZE from a MapLibre map.
 * This is the hard limit for any single texture upload (canvas, tile, image source).
 * Falls back to 4096 (lowest common denominator for mobile GPUs).
 */
function getMaxTextureSize(map: maplibregl.Map): number {
	try {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const gl = (map as any).painter?.context?.gl as WebGL2RenderingContext | null;
		if (gl) return gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
	} catch {
		/* fallback */
	}
	return 4096;
}

/** Safely clamp a number to a range, treating NaN/Infinity as the fallback. */
function safeClamp(v: number, lo: number, hi: number, fallback: number): number {
	return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;
}

/** Clamp geographic bounds to valid MapLibre web-Mercator range. */
function clampBounds(b: { west: number; south: number; east: number; north: number }) {
	return {
		west: safeClamp(b.west, -180, 180, -180),
		south: safeClamp(b.south, -85.051129, 85.051129, -85.051129),
		east: safeClamp(b.east, -180, 180, 180),
		north: safeClamp(b.north, -85.051129, 85.051129, 85.051129)
	};
}

/**
 * Fit the map to COG bounds with responsive padding.
 * Uses smaller padding on mobile to zoom in closer, ensuring overviews load
 * properly instead of appearing black at very low zoom levels.
 * After fitting, bumps zoom +1 when the viewport settles at a very low level.
 */
function fitCogBounds(
	map: maplibregl.Map,
	b: { west: number; south: number; east: number; north: number }
) {
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
	// On small screens, fitBounds settles at a zoom too low for overviews
	// to render (appears black). Bump zoom so the first overview tile loads.
	// Skip for large-extent COGs — bumping zoom at global scale pushes the
	// TileLayer into its finest overview, requesting hundreds of tiles.
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

/**
 * Fix metadata from parseCOGTileMatrixSet for projections where corner
 * reprojection produces NaN/extreme values (Mollweide, global EPSG:4326, etc.).
 * Clamps wgsBounds and wraps projectTo3857/projectToWgs84 with safe fallbacks.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function patchMetadataBounds(metadata: any) {
	// Clamp wgsBounds — corners of projections like Mollweide can be
	// outside the valid domain, producing extreme longitudes (e.g. ±277°)
	// or latitudes slightly outside [-90,90] (e.g. EPSG:4326 at ±90.002°).
	// deck.gl's lngLatToWorld asserts lat ∈ [-90,90].
	const wb = metadata.wgsBounds;
	if (wb) {
		metadata.wgsBounds = {
			lowerLeft: [
				safeClamp(wb.lowerLeft[0], -180, 180, -180),
				safeClamp(wb.lowerLeft[1], -85.051129, 85.051129, -85.051129)
			],
			upperRight: [
				safeClamp(wb.upperRight[0], -180, 180, 180),
				safeClamp(wb.upperRight[1], -85.051129, 85.051129, 85.051129)
			]
		};
	}

	// Wrap projectTo3857 — out-of-domain points produce NaN/Infinity in EPSG:3857
	const origTo3857 = metadata.projectTo3857;
	if (origTo3857) {
		metadata.projectTo3857 = (point: [number, number]) => {
			const r = origTo3857(point);
			if (Number.isFinite(r[0]) && Number.isFinite(r[1])) return r;
			// Sign-based edge fallback: map out-of-domain points to the
			// nearest edge of EPSG:3857 instead of the origin, reducing
			// adaptive mesh distortion for edge tiles.
			return [
				point[0] >= 0 ? 20037508.34 : -20037508.34,
				point[1] >= 0 ? 20037508.34 : -20037508.34
			];
		};
	}

	// Wrap projectToWgs84 — clamp extreme lon/lat from edge reprojection
	const origToWgs84 = metadata.projectToWgs84;
	if (origToWgs84) {
		metadata.projectToWgs84 = (point: [number, number]) => {
			const r = origToWgs84(point);
			return [safeClamp(r[0], -180, 180, 0), safeClamp(r[1], -85.051129, 85.051129, 0)];
		};
	}
}

// ─── Monkey-patch COGLayer._parseGeoTIFF ─────────────────────────
// The library's inferRenderPipeline throws/hangs for PI=0/1 (Gray) and
// non-uint SampleFormat. For custom pipelines (getTileData/renderTile),
// skip _origParse entirely and reconstruct state from our v3 GeoTIFF.
// For default pipelines, _origParse runs normally with a timeout guard.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let capturedV2Geotiff: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentV3Tiff: any = null;

// Guard against HMR re-patching: always reference the true original
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _origParse = (COGLayer as any).__origParseGeoTIFF ?? COGLayer.prototype._parseGeoTIFF;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(COGLayer as any).__origParseGeoTIFF = _origParse;

/** Shared reconstruction: build layer state from a geotiff (v2 or v3). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function reconstructLayerState(layer: any, geotiff: any) {
	const t0 = performance.now();
	const gkParser = layer.props.geoKeysParser;

	console.log('[COG:reconstruct] parsing tile matrix set...');
	const metadata = await parseCOGTileMatrixSet(geotiff, gkParser);
	patchMetadataBounds(metadata);

	const image = await geotiff.getImage();
	const imageCount = await geotiff.getImageCount();
	let images: unknown[] = [];
	for (let i = 0; i < imageCount; i++) {
		images.push(await geotiff.getImage(i));
	}

	const allLevels = images.map((img, i) => {
		const im = img as { getWidth(): number; getHeight(): number };
		return `  [${i}] ${im.getWidth()}×${im.getHeight()}`;
	});
	console.log(
		`[COG:reconstruct] ${imageCount} IFDs, ${metadata.tileMatrices.length} tile matrices\n${allLevels.join('\n')}`
	);

	// Skip overviews smaller than tile size — their tile bounds span
	// most of the globe and produce NaN when projected to Web Mercator.
	let firstValidZ = 0;
	for (let z = 0; z < metadata.tileMatrices.length; z++) {
		const img = images[images.length - 1 - z] as {
			getWidth(): number;
			getHeight(): number;
		};
		const tm = metadata.tileMatrices[z];
		if (img.getWidth() >= tm.tileWidth && img.getHeight() >= tm.tileHeight) {
			firstValidZ = z;
			break;
		}
	}
	if (firstValidZ > 0) {
		console.log(`[COG:reconstruct] skipping ${firstValidZ} sub-tile overviews`);
		metadata.tileMatrices = metadata.tileMatrices.slice(firstValidZ);
		images = images.slice(0, images.length - firstValidZ);
	}

	// Cap zoom levels — decompression runs synchronously on the main
	// thread (WASM). Too many fine levels overwhelms the browser.
	// Also cap by image dimension: skip levels where the overview has
	// more than MAX_DIM_PER_LEVEL pixels in any direction (too many tiles
	// would be visible at once, blocking the main thread on decode).
	const MAX_TILE_LEVELS = 12;
	const MAX_DIM_PER_LEVEL = 8_192;
	if (metadata.tileMatrices.length > MAX_TILE_LEVELS) {
		const trimmed = metadata.tileMatrices.length - MAX_TILE_LEVELS;
		console.log(
			`[COG:reconstruct] capping zoom: trimming ${trimmed} levels (>${MAX_TILE_LEVELS} max)`
		);
		metadata.tileMatrices = metadata.tileMatrices.slice(0, MAX_TILE_LEVELS);
		images = images.slice(images.length - MAX_TILE_LEVELS);
	}
	// Trim finest levels whose source images are too large
	let dimTrimCount = 0;
	while (images.length > 1) {
		const finest = images[0] as { getWidth(): number; getHeight(): number };
		if (finest.getWidth() <= MAX_DIM_PER_LEVEL && finest.getHeight() <= MAX_DIM_PER_LEVEL) break;
		dimTrimCount++;
		images.shift();
		metadata.tileMatrices.pop();
	}
	if (dimTrimCount > 0) {
		console.log(
			`[COG:reconstruct] trimmed ${dimTrimCount} finest levels (>${MAX_DIM_PER_LEVEL}px per dim)`
		);
	}

	const finalLevels = images.map((img, i) => {
		const im = img as { getWidth(): number; getHeight(): number };
		return `  z${i}: ${im.getWidth()}×${im.getHeight()}`;
	});
	console.log(
		`[COG:reconstruct] final: ${images.length} levels, ${metadata.tileMatrices.length} tile matrices\n${finalLevels.join('\n')}`
	);

	const sourceProjection = await gkParser(image.getGeoKeys());
	if (!sourceProjection) throw new Error('Could not determine source projection');
	console.log(`[COG:reconstruct] CRS: ${sourceProjection.def.substring(0, 80)}...`);

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const converter = proj4Lib(sourceProjection.def, 'EPSG:4326') as any;
	const forwardReproject = (x: number, y: number) => {
		const r = converter.forward([x, y], false);
		const lon = Number.isFinite(r[0]) ? Math.max(-180, Math.min(180, r[0])) : x >= 0 ? 180 : -180;
		const lat = Number.isFinite(r[1])
			? Math.max(-85.051129, Math.min(85.051129, r[1]))
			: y >= 0
				? 85.051129
				: -85.051129;
		return [lon, lat];
	};
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const inverseReproject = (x: number, y: number) => converter.inverse([x, y], false);

	layer.setState({
		metadata,
		forwardReproject,
		inverseReproject,
		images,
		defaultGetTileData: null,
		defaultRenderTile: null
	});

	// Trigger onGeoTIFFLoad so the component updates info panel and fits bounds.
	// When we skip _origParse the library never calls this callback itself.
	if (layer.props.onGeoTIFFLoad && metadata.wgsBounds) {
		const wb = metadata.wgsBounds;
		const geographicBounds = {
			west: wb.lowerLeft[0],
			south: wb.lowerLeft[1],
			east: wb.upperRight[0],
			north: wb.upperRight[1]
		};
		console.log(
			`[COG:reconstruct] triggering onGeoTIFFLoad with bounds: ` +
				`W${geographicBounds.west.toFixed(2)} S${geographicBounds.south.toFixed(2)} ` +
				`E${geographicBounds.east.toFixed(2)} N${geographicBounds.north.toFixed(2)}`
		);
		layer.props.onGeoTIFFLoad(geotiff, { projection: null, geographicBounds });
	}

	console.log(`[COG:reconstruct] done in ${(performance.now() - t0).toFixed(0)}ms`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
COGLayer.prototype._parseGeoTIFF = async function (this: any) {
	const hasCustomPipeline = this.props.getTileData && this.props.renderTile;
	console.log(
		`[COG:patch] _parseGeoTIFF called — customPipeline=${hasCustomPipeline}, hasV3Tiff=${!!currentV3Tiff}`
	);

	// ── Custom pipeline (Gray / float / int) ──
	// Skip _origParse entirely — it hangs for Gray/float COGs because
	// inferRenderPipeline fails internally without throwing to our catch.
	// Reconstruct directly from our pre-opened v3 geotiff.
	if (hasCustomPipeline && currentV3Tiff) {
		console.log('[COG:patch] custom pipeline → skipping _origParse, reconstructing from v3 tiff');
		try {
			await reconstructLayerState(this, currentV3Tiff);
			console.log('[COG:patch] custom pipeline reconstruction succeeded');
		} catch (err) {
			console.error('[COG:patch] custom pipeline reconstruction failed:', err);
			if (this.props.onError) {
				this.props.onError(err instanceof Error ? err : new Error(String(err)));
			}
		}
		return;
	}

	// ── Default pipeline (RGB / Palette / CMYK) ──
	// Run the library's original parser with a timeout guard.
	const TIMEOUT_MS = 15_000;
	console.log(`[COG:patch] default pipeline → running _origParse with ${TIMEOUT_MS}ms timeout`);
	const t0 = performance.now();
	try {
		await Promise.race([
			_origParse.call(this),
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error('COG parsing timed out')), TIMEOUT_MS)
			)
		]);
		console.log(`[COG:patch] _origParse completed in ${(performance.now() - t0).toFixed(0)}ms`);
	} catch (err) {
		console.warn(
			`[COG:patch] _origParse failed after ${(performance.now() - t0).toFixed(0)}ms:`,
			err instanceof Error ? err.message : err
		);
		// Only attempt reconstruction for custom pipeline COGs (Gray/float/int)
		// that have getTileData/renderTile props. Default pipeline COGs need
		// the library's inferRenderPipeline to set defaultGetTileData — without
		// it the library throws "getTileData is not a function".
		const hasCustomPipeline = this.props.getTileData && this.props.renderTile;
		const geotiff = capturedV2Geotiff || currentV3Tiff;
		console.log(
			`[COG:patch] fallback — customPipeline=${!!hasCustomPipeline}, hasV2=${!!capturedV2Geotiff}, hasV3=${!!currentV3Tiff}`
		);
		if (hasCustomPipeline && geotiff) {
			try {
				await reconstructLayerState(this, geotiff);
				console.log('[COG:patch] fallback reconstruction succeeded');
			} catch (reconstructErr) {
				console.error('[COG:patch] fallback reconstruction failed:', reconstructErr);
				if (this.props.onError) {
					this.props.onError(
						reconstructErr instanceof Error ? reconstructErr : new Error(String(reconstructErr))
					);
				}
			}
		} else if (this.props.onError) {
			this.props.onError(err instanceof Error ? err : new Error(String(err)));
		}
	}
};

// ─── Props & State ───────────────────────────────────────────────

let { tab }: { tab: Tab } = $props();

let loading = $state(true);
let error = $state<string | null>(null);
let showInfo = $state(false);
let bounds = $state<[number, number, number, number] | undefined>();
let cogInfo = $state<{
	width: number;
	height: number;
	bandCount: number;
	dataType: string;
	bounds: { west: number; south: number; east: number; north: number };
	downsampled?: boolean;
} | null>(null);

let abortController = new AbortController();
let mapRef: maplibregl.Map | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let overlayRef: any = null;

// Native MapLibre image source for non-tiled GeoTIFFs (bypasses deck.gl)
const BITMAP_SOURCE = 'geotiff-bitmap-src';
const BITMAP_LAYER = 'geotiff-bitmap-layer';

function cleanupNativeBitmap() {
	if (!mapRef) return;
	try {
		if (mapRef.getLayer(BITMAP_LAYER)) mapRef.removeLayer(BITMAP_LAYER);
	} catch {
		/* already removed */
	}
	try {
		if (mapRef.getSource(BITMAP_SOURCE)) mapRef.removeSource(BITMAP_SOURCE);
	} catch {
		/* already removed */
	}
}

// ─── Tab change reset ───────────────────────────────────────────

$effect(() => {
	if (!tab) return;
	const _tabId = tab.id;
	untrack(() => {
		abortController.abort();
		abortController = new AbortController();
		// Remove previous overlay/sources from map before loading new COG
		cleanupNativeBitmap();
		if (mapRef && overlayRef) {
			try {
				mapRef.removeControl(overlayRef);
			} catch {
				// map may already be destroyed
			}
		}
		overlayRef = null;
		loading = true;
		error = null;
		cogInfo = null;
		bounds = undefined;
		capturedV2Geotiff = null;
		currentV3Tiff = null;
		// Re-trigger loading if map is already initialized (tab switch).
		// On first mount mapRef is null — onMapReady will handle it.
		if (mapRef) {
			loadCog(mapRef);
		}
	});
});

// ─── Map ready ──────────────────────────────────────────────────

function onMapReady(map: maplibregl.Map) {
	mapRef = map;
	loadCog(map);
}

async function loadCog(map: maplibregl.Map) {
	const signal = abortController.signal;
	const loadT0 = performance.now();

	try {
		const url = buildHttpsUrl(tab);
		console.group(`[COG] loadCog: ${url}`);

		// Pre-flight: read first IFD with geotiff@3 (single small range request)
		console.log('[COG] opening GeoTIFF via geotiff@3...');
		const tiffT0 = performance.now();
		const tiff = await fromUrl(url, {}, signal);
		currentV3Tiff = tiff; // expose to monkey-patch as fallback
		const firstImage = await tiff.getImage();
		if (signal.aborted) return;
		console.log(`[COG] first IFD loaded in ${(performance.now() - tiffT0).toFixed(0)}ms`);

		// ─── v3-compatible metadata access ───
		// Load deferred GDAL_NODATA tag (42113) — geotiff v3 defers large/custom
		// TIFF tags and throws if accessed synchronously before loading.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await (firstImage as any).fileDirectory?.loadValue?.(42113);
		const isTiled = firstImage.isTiled;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const pi = (firstImage as any).fileDirectory?.actualizedFields?.get?.(262) as
			| number
			| undefined;
		const sfVal = firstImage.getSampleFormat();
		const bandCount = firstImage.getSamplesPerPixel();
		const bpsVal = firstImage.getBitsPerSample();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const compression = (firstImage as any).fileDirectory?.Compression ?? 'unknown';
		const tileWidth = isTiled ? firstImage.getTileWidth() : 'N/A';
		const tileHeight = isTiled ? firstImage.getTileHeight() : 'N/A';
		const noData = firstImage.getGDALNoData();

		// Routing: default pipeline = uint (SF=1) + PI >= 2 (RGB/Palette/CMYK/YCbCr/CIELab)
		const isUint = sfVal === 1;
		const isDefaultPipeline = isUint && pi !== undefined && pi >= 2;

		// Data type label for info panel
		const dataType = `${SF_LABELS[sfVal] ?? `sf${sfVal}`}${bpsVal ?? ''}`;

		console.log(
			`[COG] pre-flight metadata:\n` +
				`  dimensions: ${firstImage.getWidth()}×${firstImage.getHeight()}\n` +
				`  tiled: ${isTiled} (${tileWidth}×${tileHeight})\n` +
				`  PI: ${pi} (${pi === 0 || pi === 1 ? 'Gray' : pi === 2 ? 'RGB' : pi === 3 ? 'Palette' : `code ${pi}`})\n` +
				`  sampleFormat: ${sfVal} (${SF_LABELS[sfVal] ?? 'unknown'})\n` +
				`  bitsPerSample: ${bpsVal}\n` +
				`  bands: ${bandCount}\n` +
				`  compression: ${compression}\n` +
				`  noData: ${noData}\n` +
				`  pipeline: ${isDefaultPipeline ? 'DEFAULT (library)' : 'CUSTOM (Gray/float/int)'}\n` +
				`  route: ${isTiled ? (isDefaultPipeline ? 'tiled-default' : 'tiled-custom') : 'non-tiled-bitmap'}`
		);

		// Compute geographic bounds with edge sampling — the library's
		// getGeographicBounds uses only 4 corners, which is inaccurate for
		// projections where edges curve (UTM at high latitudes, Mollweide,
		// sinusoidal). Sampling edge midpoints captures the true extent.
		let preFlightBounds: { west: number; south: number; east: number; north: number } | null = null;
		try {
			const boundsT0 = performance.now();
			const geoKeys = firstImage.getGeoKeys() as Record<string, unknown> | null;
			const projInfo = geoKeys ? await geoKeysParser(geoKeys) : null;
			if (projInfo) {
				const bbox = firstImage.getBoundingBox();
				const [x0, y0, x1, y1] = bbox;
				console.log(
					`[COG] bounds: native bbox=[${x0.toFixed(2)}, ${y0.toFixed(2)}, ${x1.toFixed(2)}, ${y1.toFixed(2)}], ` +
						`CRS=${String(projInfo.def).substring(0, 60)}`
				);
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const conv = proj4Lib(projInfo.def, 'EPSG:4326') as any;
				const N = 4; // samples per edge (including endpoints = 5 points)
				const pts: [number, number][] = [];
				for (let i = 0; i <= N; i++) {
					const t = i / N;
					pts.push([x0 + t * (x1 - x0), y0]); // bottom edge
					pts.push([x0 + t * (x1 - x0), y1]); // top edge
					pts.push([x0, y0 + t * (y1 - y0)]); // left edge
					pts.push([x1, y0 + t * (y1 - y0)]); // right edge
				}
				let w = 180,
					s = 90,
					e = -180,
					n = -90;
				let validCount = 0;
				let rejectedSamples: string[] = [];
				for (const [px, py] of pts) {
					const r = conv.forward([px, py], false);
					if (
						Number.isFinite(r[0]) &&
						Number.isFinite(r[1]) &&
						Math.abs(r[0]) <= 180 &&
						Math.abs(r[1]) <= 90
					) {
						validCount++;
						w = Math.min(w, r[0]);
						e = Math.max(e, r[0]);
						s = Math.min(s, r[1]);
						n = Math.max(n, r[1]);
					} else if (rejectedSamples.length < 4) {
						rejectedSamples.push(
							`(${px.toFixed(2)},${py.toFixed(2)})→(${r[0]?.toFixed(2)},${r[1]?.toFixed(2)})`
						);
					}
				}
				if (w < e && s < n) {
					preFlightBounds = clampBounds({ west: w, south: s, east: e, north: n });
				}
				console.log(
					`[COG] bounds computed in ${(performance.now() - boundsT0).toFixed(0)}ms: ` +
						`${validCount}/${pts.length} valid points` +
						(preFlightBounds
							? ` → W${preFlightBounds.west.toFixed(2)} S${preFlightBounds.south.toFixed(2)} E${preFlightBounds.east.toFixed(2)} N${preFlightBounds.north.toFixed(2)}`
							: ' → FAILED') +
						(rejectedSamples.length > 0
							? `\n  rejected samples: ${rejectedSamples.join(', ')}`
							: '')
				);
			}
		} catch (boundsErr) {
			console.warn('[COG] bounds computation failed:', boundsErr);
		}
		if (signal.aborted) return;

		// Shared onGeoTIFFLoad callback — populates info panel and fits bounds.
		// Also captures the library's internal v2 GeoTIFF for the monkey-patch.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const handleGeoTIFFLoad = (
			v2tiff: any,
			{
				geographicBounds
			}: {
				projection: unknown;
				geographicBounds: { west: number; south: number; east: number; north: number };
			}
		) => {
			capturedV2Geotiff = v2tiff;
			const clamped = preFlightBounds || clampBounds(geographicBounds);
			console.log(
				`[COG] onGeoTIFFLoad fired — using ${preFlightBounds ? 'pre-flight' : 'library'} bounds, ` +
					`loading took ${(performance.now() - loadT0).toFixed(0)}ms`
			);
			cogInfo = {
				width: firstImage.getWidth(),
				height: firstImage.getHeight(),
				bandCount,
				dataType,
				bounds: clamped
			};
			bounds = [clamped.west, clamped.south, clamped.east, clamped.north];
			fitCogBounds(map, clamped);
			loading = false;
		};

		// Shared error handler
		const handleError = (err: Error) => {
			if (signal.aborted) return true;
			const msg = err?.message || String(err);
			if (
				msg.includes('Request failed') ||
				msg.includes('NetworkError') ||
				msg.includes('Failed to fetch')
			) {
				error = t('map.cogCorsError');
			} else {
				error = msg;
			}
			loading = false;
			return true;
		};

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		let layer: any;

		if (isTiled && isDefaultPipeline) {
			// ── Tiled COG, default pipeline (RGB / Palette / CMYK / YCbCr / CIELab) ──
			console.log('[COG] route: tiled-default → creating COGLayer with library pipeline');
			layer = new COGLayer({
				id: 'cog-layer',
				geotiff: url,
				geoKeysParser,
				onError: handleError,
				onGeoTIFFLoad: handleGeoTIFFLoad
			});
		} else if (isTiled) {
			// ── Tiled COG, custom single-band pipeline (Gray / float / int) ──
			// Render a moderate overview as a single bitmap via MapLibre image
			// source. Per-tile WASM ZSTD/LZW decode on the main thread blocks
			// the UI for 200-1000ms per tile, making the TileLayer approach
			// unusable for large Gray/float COGs (hundreds of visible tiles).
			// A bitmap preview loads one overview in a single async read.
			if (!preFlightBounds) {
				throw new Error('Cannot determine geographic bounds for custom-pipeline COG');
			}
			console.log('[COG] route: tiled-custom → bitmap preview from overview');
			const customT0 = performance.now();
			const maxTexDim = getMaxTextureSize(map);
			// Cap preview at 4096 to balance quality vs ZSTD decode time.
			// A 4096×2000 overview (~8M pixels) decodes in 1-3 seconds.
			const PREVIEW_MAX = Math.min(maxTexDim, 4096);

			// Find the best overview: largest that fits within PREVIEW_MAX.
			// Iterate from finest (IFD 0) to coarsest, pick first that fits.
			const imageCount = await tiff.getImageCount();
			let previewImage = firstImage;
			let previewIdx = 0;
			for (let i = 0; i < imageCount; i++) {
				const img = await tiff.getImage(i);
				const w = img.getWidth();
				const h = img.getHeight();
				if (w <= PREVIEW_MAX && h <= PREVIEW_MAX) {
					previewImage = img;
					previewIdx = i;
					break;
				}
			}
			if (signal.aborted) return;

			const pvW = previewImage.getWidth();
			const pvH = previewImage.getHeight();
			console.log(`[COG] preview: IFD #${previewIdx} ${pvW}×${pvH} (maxTex=${maxTexDim})`);

			const noData = firstImage.getGDALNoData();
			const readT0 = performance.now();
			const rasters = await previewImage.readRasters({
				samples: [0],
				signal
			});
			if (signal.aborted) return;
			console.log(`[COG] preview: readRasters took ${(performance.now() - readT0).toFixed(0)}ms`);

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const band = (rasters as any)[0] as ArrayLike<number>;
			let bMin = Infinity;
			let bMax = -Infinity;
			for (let i = 0; i < band.length; i++) {
				const v = band[i];
				if (noData !== null && v === noData) continue;
				if (!Number.isFinite(v)) continue;
				if (v < bMin) bMin = v;
				if (v > bMax) bMax = v;
			}
			if (!Number.isFinite(bMin)) {
				bMin = 0;
				bMax = 1;
			}
			const bRange = bMax - bMin || 1;
			console.log(`[COG] preview band stats: min=${bMin}, max=${bMax}, noData=${noData}`);

			const rgba = new Uint8ClampedArray(pvW * pvH * 4);
			for (let i = 0; i < band.length; i++) {
				const v = band[i];
				const isND = (noData !== null && v === noData) || !Number.isFinite(v);
				const g = isND ? 0 : Math.round(((v - bMin) / bRange) * 255);
				const idx = i * 4;
				rgba[idx] = g;
				rgba[idx + 1] = g;
				rgba[idx + 2] = g;
				rgba[idx + 3] = isND ? 0 : 255;
			}

			const canvas = document.createElement('canvas');
			canvas.width = pvW;
			canvas.height = pvH;
			const ctx = canvas.getContext('2d')!;
			ctx.putImageData(new ImageData(rgba, pvW, pvH), 0, 0);
			const dataUrl = canvas.toDataURL();

			const clamped = preFlightBounds;
			cogInfo = {
				width: firstImage.getWidth(),
				height: firstImage.getHeight(),
				bandCount,
				dataType,
				bounds: clamped,
				downsampled: true
			};
			bounds = [clamped.west, clamped.south, clamped.east, clamped.north];
			fitCogBounds(map, clamped);

			cleanupNativeBitmap();
			map.addSource(BITMAP_SOURCE, {
				type: 'image',
				url: dataUrl,
				coordinates: [
					[clamped.west, clamped.north],
					[clamped.east, clamped.north],
					[clamped.east, clamped.south],
					[clamped.west, clamped.south]
				]
			});
			map.addLayer({
				id: BITMAP_LAYER,
				source: BITMAP_SOURCE,
				type: 'raster',
				paint: { 'raster-opacity': 1 }
			});

			loading = false;
			layer = null;
			console.log(`[COG] preview rendered in ${(performance.now() - customT0).toFixed(0)}ms`);
		} else {
			// ── Non-tiled TIFF — render as bitmap ──
			console.log('[COG] route: non-tiled-bitmap');
			// GeoTIFFLayer is broken: it passes `texture` to RasterLayer but
			// RasterLayer expects `renderPipeline`, causing a Symbol.iterator
			// crash in MeshTextureLayer. Read the raster ourselves instead.
			if (!preFlightBounds) {
				throw new Error('Cannot determine geographic bounds for non-tiled GeoTIFF');
			}

			const imgW = firstImage.getWidth();
			const imgH = firstImage.getHeight();
			const totalPixels = imgW * imgH;

			// Size gates — non-tiled TIFFs are read as a single strip-based
			// blob (no random tile access). Protect against OOM / browser hang.
			const MAX_NONTILED_PIXELS = 100_000_000; // 100M — refuse above
			// Use actual GPU texture limit instead of a hardcoded value.
			// High-end desktop GPUs: 16384, mobile/integrated: 4096–8192.
			const maxTexDim = getMaxTextureSize(map);

			console.log(
				`[COG] non-tiled: ${imgW}×${imgH} = ${(totalPixels / 1e6).toFixed(1)}M px, maxTex=${maxTexDim}`
			);

			if (totalPixels > MAX_NONTILED_PIXELS) {
				console.warn(
					`[COG] non-tiled: REFUSED — ${(totalPixels / 1e6).toFixed(0)}M px > ${MAX_NONTILED_PIXELS / 1e6}M limit`
				);
				const clamped = preFlightBounds;
				cogInfo = { width: imgW, height: imgH, bandCount, dataType, bounds: clamped };
				bounds = [clamped.west, clamped.south, clamped.east, clamped.north];
				fitCogBounds(map, clamped);
				throw new Error(
					`Non-tiled GeoTIFF too large (${imgW.toLocaleString()} × ${imgH.toLocaleString()} = ` +
						`${(totalPixels / 1e6).toFixed(0)}M pixels). Convert to COG: ` +
						`gdal_translate -of COG input.tif output.tif`
				);
			}

			// Cap output to GPU texture limit — keeps RGBA array + canvas within
			// what this browser/device can actually upload as a single texture.
			const needsDownsample = imgW > maxTexDim || imgH > maxTexDim;
			let readW = imgW;
			let readH = imgH;
			if (needsDownsample) {
				const scale = Math.min(maxTexDim / imgW, maxTexDim / imgH);
				readW = Math.max(1, Math.round(imgW * scale));
				readH = Math.max(1, Math.round(imgH * scale));
			}

			if (needsDownsample) {
				console.log(`[COG] non-tiled: downsampling ${imgW}×${imgH} → ${readW}×${readH}`);
			}

			const readT0 = performance.now();
			const noData = firstImage.getGDALNoData();
			const rasters = await firstImage.readRasters({
				samples: [0],
				signal,
				...(needsDownsample ? { width: readW, height: readH } : {})
			});
			if (signal.aborted) return;
			console.log(`[COG] non-tiled: readRasters took ${(performance.now() - readT0).toFixed(0)}ms`);

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const band = (rasters as any)[0] as ArrayLike<number>;
			let bMin = Infinity;
			let bMax = -Infinity;
			for (let i = 0; i < band.length; i++) {
				const v = band[i];
				if (noData !== null && v === noData) continue;
				if (!Number.isFinite(v)) continue;
				if (v < bMin) bMin = v;
				if (v > bMax) bMax = v;
			}
			if (!Number.isFinite(bMin)) {
				bMin = 0;
				bMax = 1;
			}
			const bRange = bMax - bMin || 1;
			console.log('[COG] non-tiled band 0 stats:', {
				bMin,
				bMax,
				bRange,
				noData,
				len: band.length,
				readW,
				readH,
				maxTexDim,
				downsampled: needsDownsample
			});

			const rgba = new Uint8ClampedArray(readW * readH * 4);
			for (let i = 0; i < band.length; i++) {
				const v = band[i];
				const isND = (noData !== null && v === noData) || !Number.isFinite(v);
				const g = isND ? 0 : Math.round(((v - bMin) / bRange) * 255);
				const idx = i * 4;
				rgba[idx] = g;
				rgba[idx + 1] = g;
				rgba[idx + 2] = g;
				rgba[idx + 3] = isND ? 0 : 255;
			}

			// Render via MapLibre native image source — bypasses deck.gl
			// entirely, avoiding WebGL texture upload issues in Firefox.
			const canvas = document.createElement('canvas');
			canvas.width = readW;
			canvas.height = readH;
			const ctx = canvas.getContext('2d')!;
			ctx.putImageData(new ImageData(rgba, readW, readH), 0, 0);
			const dataUrl = canvas.toDataURL();

			const clamped = preFlightBounds;
			cogInfo = {
				width: imgW,
				height: imgH,
				bandCount,
				dataType,
				bounds: clamped,
				downsampled: needsDownsample
			};
			bounds = [clamped.west, clamped.south, clamped.east, clamped.north];
			fitCogBounds(map, clamped);

			cleanupNativeBitmap();
			map.addSource(BITMAP_SOURCE, {
				type: 'image',
				url: dataUrl,
				coordinates: [
					[clamped.west, clamped.north], // top-left
					[clamped.east, clamped.north], // top-right
					[clamped.east, clamped.south], // bottom-right
					[clamped.west, clamped.south] // bottom-left
				]
			});
			map.addLayer({
				id: BITMAP_LAYER,
				source: BITMAP_SOURCE,
				type: 'raster',
				paint: { 'raster-opacity': 1 }
			});

			loading = false;
			layer = null; // no deck.gl layer needed
		}

		// Attach deck.gl overlay to the map (skip for native bitmap path)
		if (layer) {
			console.log('[COG] attaching deck.gl overlay to map...');
			const overlay = new MapboxOverlay({
				interleaved: false,
				layers: [layer],
				onError: (err: Error) => {
					if (!error && !signal.aborted) {
						error = err?.message || String(err);
						loading = false;
					}
				}
			});
			overlayRef = overlay;

			if (map.loaded()) {
				map.addControl(overlay as unknown as maplibregl.IControl);
			} else {
				map.once('load', () => map.addControl(overlay as unknown as maplibregl.IControl));
			}
			console.log('[COG] overlay attached');
		}
		console.log(`[COG] loadCog completed in ${(performance.now() - loadT0).toFixed(0)}ms`);
		console.groupEnd();
	} catch (err) {
		if (signal.aborted) return;
		console.error(`[COG] loadCog failed after ${(performance.now() - loadT0).toFixed(0)}ms:`, err);
		console.groupEnd();
		error = err instanceof Error ? err.message : String(err);
		loading = false;
	}
}

// ─── Custom single-band COGLayer builder ────────────────────────
// Uses our geotiff@3 pre-flight to compute min/max stats for normalization,
// then passes the URL to COGLayer so the library opens its own v2 GeoTIFF.
// The monkey-patched _parseGeoTIFF catches inferRenderPipeline's throw
// and reconstructs state from the captured v2 GeoTIFF.

async function buildCustomCogLayer(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	tiff: any,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	firstImage: any,
	url: string,
	signal: AbortSignal,
	onError: (err: Error) => boolean,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	onGeoTIFFLoad: any
) {
	// Compute global min/max from a small overview for normalization
	const imageCount = await tiff.getImageCount();
	console.log(`[COG:custom] ${imageCount} IFDs, searching for stats overview (64–1024px wide)...`);
	let statsImage = firstImage;
	let statsIfdIdx = 0;
	for (let i = imageCount - 1; i >= 1; i--) {
		const img = await tiff.getImage(i);
		const w = img.getWidth();
		if (w >= 64 && w <= 1024) {
			statsImage = img;
			statsIfdIdx = i;
			break;
		}
	}
	console.log(
		`[COG:custom] stats from IFD #${statsIfdIdx}: ${statsImage.getWidth()}×${statsImage.getHeight()}`
	);
	if (signal.aborted) return null;

	const noData = firstImage.getGDALNoData();

	// For large images without a suitable overview, sample a center crop
	let statsWindow: [number, number, number, number] | undefined;
	if (statsImage.getWidth() > 1024) {
		const cx = Math.floor(statsImage.getWidth() / 2);
		const cy = Math.floor(statsImage.getHeight() / 2);
		const half = 512;
		statsWindow = [
			Math.max(0, cx - half),
			Math.max(0, cy - half),
			Math.min(statsImage.getWidth(), cx + half),
			Math.min(statsImage.getHeight(), cy + half)
		];
	}

	const rasters = await statsImage.readRasters({
		samples: [0],
		window: statsWindow,
		signal
	});
	if (signal.aborted) return null;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const statsBand = (rasters as any)[0] as ArrayLike<number>;
	let min = Infinity;
	let max = -Infinity;
	for (let i = 0; i < statsBand.length; i++) {
		const v = statsBand[i];
		if (noData !== null && v === noData) continue;
		if (!Number.isFinite(v)) continue;
		if (v < min) min = v;
		if (v > max) max = v;
	}
	if (!Number.isFinite(min)) {
		min = 0;
		max = 1;
	}
	const range = max - min || 1;
	console.log(`[COG:custom] band stats: min=${min}, max=${max}, range=${range}, noData=${noData}`);

	// Concurrency limiter — ZSTD/LZW decode is synchronous WASM on the
	// main thread. Without a cap, deck.gl fires dozens of tile requests
	// at once, each blocking for 100-300ms, completely freezing the UI.
	const MAX_CONCURRENT_TILES = 1;
	let activeTiles = 0;
	const tileQueue: (() => void)[] = [];
	function acquireTileSlot(): Promise<void> {
		if (activeTiles < MAX_CONCURRENT_TILES) {
			activeTiles++;
			return Promise.resolve();
		}
		return new Promise((resolve) => tileQueue.push(resolve));
	}
	function releaseTileSlot() {
		const next = tileQueue.shift();
		if (next) {
			next(); // keep activeTiles the same — slot transfers
		} else {
			activeTiles--;
		}
	}

	// Lazy cache: v3 images are loaded on-demand per zoom level.
	// geotiff v3 supports modern codecs (Zstandard 50000, WebP 50001) that
	// the library's bundled v2 does not. No Pool — avoids worker module
	// resolution failures in Vite dev that cause the browser to hang.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const v3ImageCache = new Map<string, any>();

	// Pass URL so the library opens its own v2 GeoTIFF for metadata/tile-matrix.
	// Custom getTileData uses v3 images (which support more compression methods).
	return new COGLayer({
		id: 'cog-layer',
		geotiff: url,
		geoKeysParser,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		getTileData: async (image: any, options: any) => {
			const { window: win, signal: tileSig } = options;
			const tileT0 = performance.now();
			const winLabel = win ? `[${win[0]},${win[1]}→${win[2]},${win[3]}]` : 'full';
			const key = `${image.getWidth()}x${image.getHeight()}`;

			// Wait for a decode slot — limits main-thread blocking
			await acquireTileSlot();
			try {
				// Yield two animation frames before each tile decompression.
				// ZSTD/LZW decode via geotiff is synchronous WASM on the main
				// thread. Two rAF cycles guarantee the browser paints at least
				// one frame and processes input between tile decodes.
				await new Promise<void>((r) =>
					requestAnimationFrame(() => requestAnimationFrame(() => r()))
				);
				if (tileSig?.aborted) return null;

				// Lazily find/cache the matching v3 image by dimensions
				let v3Img = v3ImageCache.get(key);
				if (!v3Img) {
					const count = await tiff.getImageCount();
					for (let i = 0; i < count; i++) {
						const img = await tiff.getImage(i); // cached by geotiff.js
						const k = `${img.getWidth()}x${img.getHeight()}`;
						v3ImageCache.set(k, img);
						if (k === key) {
							v3Img = img;
							break;
						}
					}
				}

				// Read band 0 — no Pool (main-thread async decode avoids worker hangs)
				const readT0 = performance.now();
				const r = await (v3Img || image).readRasters({
					samples: [0],
					window: win,
					signal: tileSig,
					interleave: false,
					// Use v2 pool only when falling back to v2 image
					...(v3Img ? {} : { pool: options.pool })
				});
				const readMs = performance.now() - readT0;

				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const band = (r as any)[0] as ArrayLike<number>;
				const w = win ? win[2] - win[0] : image.getWidth();
				const h = win ? win[3] - win[1] : image.getHeight();
				const rgba = new Uint8ClampedArray(w * h * 4);

				const rgbaT0 = performance.now();
				for (let i = 0; i < band.length; i++) {
					const v = band[i];
					const isND = (noData !== null && v === noData) || !Number.isFinite(v);
					const g = isND ? 0 : Math.round(((v - min) / range) * 255);
					const idx = i * 4;
					rgba[idx] = g;
					rgba[idx + 1] = g;
					rgba[idx + 2] = g;
					rgba[idx + 3] = isND ? 0 : 255;
				}
				const rgbaMs = performance.now() - rgbaT0;

				const totalMs = performance.now() - tileT0;
				console.log(
					`[COG:tile] ${key} ${winLabel} ${w}×${h} — ` +
						`read=${readMs.toFixed(0)}ms rgba=${rgbaMs.toFixed(0)}ms total=${totalMs.toFixed(0)}ms ` +
						`queue=${tileQueue.length} active=${activeTiles}` +
						(v3Img ? ' (v3)' : ' (v2-fallback)')
				);

				return { texture: new ImageData(rgba, w, h), width: w, height: h };
			} finally {
				releaseTileSlot();
			}
		},
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		renderTile: (data: any) => data.texture,
		onError,
		onGeoTIFFLoad
	});
}

// ─── Cleanup ────────────────────────────────────────────────────

function cleanup() {
	abortController.abort();
	cleanupNativeBitmap();
	if (mapRef && overlayRef) {
		try {
			mapRef.removeControl(overlayRef);
		} catch {
			// map may already be destroyed
		}
	}
	mapRef = null;
	overlayRef = null;
}

$effect(() => {
	const id = tab.id;
	const unregister = tabResources.register(id, cleanup);
	return unregister;
});
onDestroy(cleanup);
</script>

<div class="relative flex h-full overflow-hidden">
	<div class="flex-1">
		<MapContainer {onMapReady} {bounds} />
	</div>

	<div class="pointer-events-none absolute left-2 top-2 z-10 flex flex-col gap-1">
		{#if loading}
			<div
				class="rounded bg-card/80 px-2 py-1 text-xs text-card-foreground backdrop-blur-sm"
			>
				{t('map.loadingCog')}
			</div>
		{/if}

		{#if cogInfo}
			<div
				class="rounded bg-card/80 px-2 py-1 text-xs text-card-foreground backdrop-blur-sm"
			>
				COG {cogInfo.width}&times;{cogInfo.height}, {cogInfo.bandCount}
				band{cogInfo.bandCount !== 1 ? 's' : ''}, {cogInfo.dataType}
				{#if cogInfo.downsampled}
					<span class="text-amber-400">— downsampled preview</span>
				{/if}
			</div>
		{/if}

		{#if error}
			<div
				class="pointer-events-auto max-w-sm rounded bg-red-900/80 px-2 py-1 text-xs text-red-200"
			>
				{error}
			</div>
		{/if}
	</div>

	{#if cogInfo}

		<div class="absolute right-2 top-2 z-10 flex gap-1">
			<button
				class="rounded bg-card/80 px-2 py-1 text-xs text-card-foreground backdrop-blur-sm hover:bg-card"
				class:ring-1={showInfo}
				class:ring-primary={showInfo}
				onclick={() => (showInfo = !showInfo)}
			>
				{t('map.info')}
			</button>
		</div>

		{#if showInfo}
			<div
				class="absolute right-2 top-10 z-10 max-h-[70vh] w-64 overflow-auto rounded bg-card/90 p-3 text-xs text-card-foreground backdrop-blur-sm"
			>
				<h3 class="mb-2 font-medium">{t('map.cogInfo')}</h3>
				<dl class="space-y-1.5">
					<dt class="text-muted-foreground">{t('mapInfo.size')}</dt>
					<dd>{cogInfo.width} &times; {cogInfo.height}</dd>
					<dt class="text-muted-foreground">{t('mapInfo.bands')}</dt>
					<dd>{cogInfo.bandCount} ({cogInfo.dataType})</dd>
					<dt class="text-muted-foreground">{t('mapInfo.bounds')}</dt>
					<dd>
						W {cogInfo.bounds.west.toFixed(4)}, S {cogInfo.bounds.south.toFixed(4)}<br />
						E {cogInfo.bounds.east.toFixed(4)}, N {cogInfo.bounds.north.toFixed(4)}
					</dd>
				</dl>
			</div>
		{/if}
	{/if}
</div>
