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
 * Custom GeoKeys parser using geotiff-geokeys-to-proj4.
 * Bypasses the default proj4 EPSG lookup (which fails for non-standard CRS codes
 * like EPSG:32767) by parsing GeoKeys directly into a proj4 definition string.
 */
async function geoKeysParser(
	geoKeys: Record<string, unknown>
): Promise<proj.ProjectionInfo | null> {
	try {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const projDef = toProj4(geoKeys as any);
		return {
			def: projDef.proj4,
			parsed: proj.parseCrs(projDef.proj4),
			coordinatesUnits: projDef.coordinatesUnits as proj.SupportedCrsUnit
		};
	} catch {
		return null;
	}
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
	map.once('moveend', () => {
		const z = map.getZoom();
		const minZoom = isMobile ? 10 : 8;
		if (z < minZoom) {
			map.zoomTo(z + 2, { duration: 500 });
		}
	});
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
// The library's inferRenderPipeline throws for PI=0/1 (Gray) and non-uint
// SampleFormat, preventing setState from ever running. When custom
// getTileData/renderTile are provided, catch the error and reconstruct
// the layer state from the v2 GeoTIFF captured in onGeoTIFFLoad.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let capturedV2Geotiff: any = null;
// v3 geotiff fallback — used when _origParse throws before onGeoTIFFLoad
// runs (e.g. parseCOGTileMatrixSet fails), leaving capturedV2Geotiff null.
// parseCOGTileMatrixSet works with v3 geotiff objects (it only calls
// getImage, getImageCount, getBoundingBox, getGeoKeys, getTileWidth, etc.)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentV3Tiff: any = null;

// Guard against HMR re-patching: always reference the true original
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _origParse = (COGLayer as any).__origParseGeoTIFF ?? COGLayer.prototype._parseGeoTIFF;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(COGLayer as any).__origParseGeoTIFF = _origParse;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
COGLayer.prototype._parseGeoTIFF = async function (this: any) {
	try {
		await _origParse.call(this);
	} catch (err) {
		// Use v2 geotiff from onGeoTIFFLoad, or fall back to v3 geotiff.
		// _origParse can throw BEFORE onGeoTIFFLoad runs (e.g. if
		// parseCOGTileMatrixSet fails for the CRS), leaving capturedV2Geotiff null.
		const geotiff = capturedV2Geotiff || currentV3Tiff;
		if (this.props.getTileData && this.props.renderTile && geotiff) {
			try {
				const gkParser = this.props.geoKeysParser;
				const metadata = await parseCOGTileMatrixSet(geotiff, gkParser);
				patchMetadataBounds(metadata);
				const image = await geotiff.getImage();
				const imageCount = await geotiff.getImageCount();
				let images: unknown[] = [];
				for (let i = 0; i < imageCount; i++) {
					images.push(await geotiff.getImage(i));
				}

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
					metadata.tileMatrices = metadata.tileMatrices.slice(firstValidZ);
					images = images.slice(0, images.length - firstValidZ);
				}

				// Cap zoom levels — decompression runs synchronously on the main
				// thread (WASM). Too many fine levels overwhelms the browser.
				const MAX_TILE_LEVELS = 12;
				if (metadata.tileMatrices.length > MAX_TILE_LEVELS) {
					metadata.tileMatrices = metadata.tileMatrices.slice(0, MAX_TILE_LEVELS);
					images = images.slice(images.length - MAX_TILE_LEVELS);
				}

				const sourceProjection = await gkParser(image.getGeoKeys());
				if (!sourceProjection) throw new Error('Could not determine source projection');

				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const converter = proj4Lib(sourceProjection.def, 'EPSG:4326') as any;
				const forwardReproject = (x: number, y: number) => {
					const r = converter.forward([x, y], false);
					const lon = Number.isFinite(r[0])
						? Math.max(-180, Math.min(180, r[0]))
						: x >= 0
							? 180
							: -180;
					const lat = Number.isFinite(r[1])
						? Math.max(-85.051129, Math.min(85.051129, r[1]))
						: y >= 0
							? 85.051129
							: -85.051129;
					return [lon, lat];
				};
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const inverseReproject = (x: number, y: number) => converter.inverse([x, y], false);

				this.setState({
					metadata,
					forwardReproject,
					inverseReproject,
					images,
					defaultGetTileData: null,
					defaultRenderTile: null
				});
			} catch (reconstructErr) {
				// Reconstruction failed — show the reconstruction error
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

	try {
		const url = buildHttpsUrl(tab);

		// Pre-flight: read first IFD with geotiff@3 (single small range request)
		const tiff = await fromUrl(url, {}, signal);
		currentV3Tiff = tiff; // expose to monkey-patch as fallback
		const firstImage = await tiff.getImage();
		if (signal.aborted) return;

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

		// Routing: default pipeline = uint (SF=1) + PI >= 2 (RGB/Palette/CMYK/YCbCr/CIELab)
		const isUint = sfVal === 1;
		const isDefaultPipeline = isUint && pi !== undefined && pi >= 2;

		// Data type label for info panel
		const dataType = `${SF_LABELS[sfVal] ?? `sf${sfVal}`}${bpsVal ?? ''}`;

		// Compute geographic bounds with edge sampling — the library's
		// getGeographicBounds uses only 4 corners, which is inaccurate for
		// projections where edges curve (UTM at high latitudes, Mollweide,
		// sinusoidal). Sampling edge midpoints captures the true extent.
		let preFlightBounds: { west: number; south: number; east: number; north: number } | null = null;
		try {
			const geoKeys = firstImage.getGeoKeys() as Record<string, unknown> | null;
			const projInfo = geoKeys ? await geoKeysParser(geoKeys) : null;
			if (projInfo) {
				const [x0, y0, x1, y1] = firstImage.getBoundingBox();
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
					preFlightBounds = clampBounds({ west: w, south: s, east: e, north: n });
				}
			}
		} catch {
			/* fall back to library bounds */
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
			layer = new COGLayer({
				id: 'cog-layer',
				geotiff: url,
				geoKeysParser,
				onError: handleError,
				onGeoTIFFLoad: handleGeoTIFFLoad
			});
		} else if (isTiled) {
			// ── Tiled COG, custom single-band pipeline (Gray / float / int) ──
			layer = await buildCustomCogLayer(
				tiff,
				firstImage,
				url,
				signal,
				handleError,
				handleGeoTIFFLoad
			);
			if (!layer) return; // aborted
		} else {
			// ── Non-tiled TIFF — render as bitmap ──
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
			const PREVIEW_MAX_DIM = 4096; // max output dimension

			if (totalPixels > MAX_NONTILED_PIXELS) {
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

			// Cap output dimensions — keeps RGBA array + canvas within safe limits
			const needsDownsample = imgW > PREVIEW_MAX_DIM || imgH > PREVIEW_MAX_DIM;
			let readW = imgW;
			let readH = imgH;
			if (needsDownsample) {
				const scale = Math.min(PREVIEW_MAX_DIM / imgW, PREVIEW_MAX_DIM / imgH);
				readW = Math.max(1, Math.round(imgW * scale));
				readH = Math.max(1, Math.round(imgH * scale));
			}

			const noData = firstImage.getGDALNoData();
			const rasters = await firstImage.readRasters({
				samples: [0],
				signal,
				...(needsDownsample ? { width: readW, height: readH } : {})
			});
			if (signal.aborted) return;

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
		}
	} catch (err) {
		if (signal.aborted) return;
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
	let statsImage = firstImage;
	for (let i = imageCount - 1; i >= 1; i--) {
		const img = await tiff.getImage(i);
		const w = img.getWidth();
		if (w >= 64 && w <= 1024) {
			statsImage = img;
			break;
		}
	}
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

			// Yield to event loop before each tile decompression.
			// ZSTD/LZW decode via geotiff is synchronous WASM on the main
			// thread. Without yielding, back-to-back tile decodes block the
			// UI (no paint, no input handling). A zero-delay setTimeout lets
			// the browser process events between tiles.
			await new Promise((r) => setTimeout(r, 0));
			if (tileSig?.aborted) return null;

			// Lazily find/cache the matching v3 image by dimensions
			const key = `${image.getWidth()}x${image.getHeight()}`;
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
			const r = await (v3Img || image).readRasters({
				samples: [0],
				window: win,
				signal: tileSig,
				interleave: false,
				// Use v2 pool only when falling back to v2 image
				...(v3Img ? {} : { pool: options.pool })
			});

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const band = (r as any)[0] as ArrayLike<number>;
			const w = win ? win[2] - win[0] : image.getWidth();
			const h = win ? win[3] - win[1] : image.getHeight();
			const rgba = new Uint8ClampedArray(w * h * 4);

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

			return { texture: new ImageData(rgba, w, h), width: w, height: h };
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
