<script lang="ts">
import { MapboxOverlay } from '@deck.gl/mapbox';
import { COGLayer } from '@developmentseed/deck.gl-geotiff';
import { DecoderPool, GeoTIFF } from '@developmentseed/geotiff';
import type maplibregl from 'maplibre-gl';
import { onDestroy, untrack } from 'svelte';
import { t } from '../../i18n/index.svelte.js';
import { tabResources } from '../../stores/tab-resources.svelte.js';
import type { Tab } from '../../types.js';
import {
	buildDataTypeLabel,
	type CogInfo,
	clampBounds,
	cleanupNativeBitmap,
	createCustomGetTileData,
	customRenderTile,
	fitCogBounds,
	needsCustomPipeline,
	renderNonTiledBitmap
} from '../../utils/cog.js';
import { buildHttpsUrl } from '../../utils/url.js';
import MapContainer from './map/MapContainer.svelte';

// ─── State ───────────────────────────────────────────────────────

let { tab }: { tab: Tab } = $props();
let loading = $state(true);
let error = $state<string | null>(null);
let showInfo = $state(false);
let bounds = $state<[number, number, number, number] | undefined>();
let cogInfo = $state<CogInfo | null>(null);

let abortController = new AbortController();
let mapRef: maplibregl.Map | null = null;
let overlayRef: MapboxOverlay | null = null;

// Main-thread decoder pool — worker-based DecoderPool fails in Vite dev mode
// (ESM workers can't load through the dev server). Main-thread decoding is
// reliable across all environments. COGLayer's defaultDecoderPool() would
// create workers that crash with NS_ERROR_CORRUPTED_CONTENT in Firefox.
const pool = new DecoderPool();

// ─── Tab change reset ────────────────────────────────────────────

$effect(() => {
	if (!tab) return;
	const _tabId = tab.id;
	untrack(() => {
		abortController.abort();
		abortController = new AbortController();
		if (mapRef) cleanupNativeBitmap(mapRef);
		if (mapRef && overlayRef) {
			try {
				mapRef.removeControl(overlayRef as unknown as maplibregl.IControl);
			} catch {
				/* map may already be destroyed */
			}
		}
		overlayRef = null;
		loading = true;
		error = null;
		cogInfo = null;
		bounds = undefined;
		if (mapRef) loadCog(mapRef);
	});
});

// ─── Map ready ───────────────────────────────────────────────────

function onMapReady(map: maplibregl.Map) {
	mapRef = map;
	loadCog(map);
}

// ─── Core load function ──────────────────────────────────────────

async function loadCog(map: maplibregl.Map) {
	const signal = abortController.signal;

	try {
		const url = buildHttpsUrl(tab);

		// Pre-flight: read first IFD to check if tiled (single range request).
		// If this fails (invalid TIFF, unsupported format), try COGLayer directly
		// which may have different error handling, or propagate a clear error.
		let isTiled = true;
		let preflightGeotiff: GeoTIFF | undefined;
		try {
			preflightGeotiff = await GeoTIFF.fromUrl(url);
			if (signal.aborted) return;
			isTiled = preflightGeotiff.isTiled;

			// Validate CRS early — crsFromGeoKeys throws for unsupported
			// model types (e.g. 32767 for Mollweide). Catch here for a
			// clear error instead of letting COGLayer crash in _parseGeoTIFF.
			try {
				const _crs = preflightGeotiff.crs;
				void _crs;
			} catch (crsErr) {
				const msg = crsErr instanceof Error ? crsErr.message : String(crsErr);
				error = `Unsupported CRS: ${msg}`;
				loading = false;
				return;
			}
		} catch (preflightErr) {
			if (signal.aborted) return;
			// If pre-flight fails, assume tiled and let COGLayer handle it.
			// COGLayer will show its own error if the file is truly unreadable.
		}

		if (!isTiled && preflightGeotiff) {
			// ── Non-tiled TIFF — render as bitmap ──
			const info = await renderNonTiledBitmap({ url, map, signal, geotiff: preflightGeotiff });
			if (signal.aborted) return;
			cogInfo = info;
			bounds = [info.bounds.west, info.bounds.south, info.bounds.east, info.bounds.north];
			fitCogBounds(map, info.bounds);
			loading = false;
			return;
		}

		// ── Tiled COG ──
		// v0.3 default pipeline handles: RGB, Palette, CMYK, YCbCr, CIELab, Gray (uint).
		// For signed int (SF=2) and float (SF=3), provide custom getTileData/renderTile.
		const useCustom = preflightGeotiff ? needsCustomPipeline(preflightGeotiff) : false;

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const customProps: Record<string, any> = {};
		if (useCustom && preflightGeotiff) {
			customProps.getTileData = createCustomGetTileData(preflightGeotiff);
			customProps.renderTile = customRenderTile;
		}

		// Pass the pre-opened GeoTIFF instance to avoid a second fetch.
		// Also enables the library to skip its own fromUrl() call.
		const cogInput = preflightGeotiff ?? url;

		if (preflightGeotiff) {
			// Strip oversized overviews where the image is smaller than one
			// tile. These produce tile bounds far beyond the valid CRS domain.
			// Note: do NOT filter more aggressively — the TMS tile matrices must
			// stay in sync with the overviews array (z=0 uses the last overview).
			const validOverviews = preflightGeotiff.overviews.filter(
				(ov) => ov.width >= ov.tileWidth && ov.height >= ov.tileHeight
			);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(preflightGeotiff as any).overviews = validOverviews;

			// Clamp EPSG:4326 bbox to the valid Web Mercator domain:
			// - Longitude ±180°: even 0.001° beyond causes proj4 to wrap the
			//   easting sign (e.g. fwd3857(-180.001) → +20037369 instead of
			//   -20037647), displacing tiles to the opposite side of the world.
			// - Latitude ±85.051129°: Mercator singularity at ±90° produces NaN.
			if (preflightGeotiff.crs === 4326) {
				const [x0, y0, x1, y1] = preflightGeotiff.bbox;
				const WM_LAT_LIMIT = 85.051129;
				const clamped = [
					Math.max(x0, -180),
					Math.max(y0, -WM_LAT_LIMIT),
					Math.min(x1, 180),
					Math.min(y1, WM_LAT_LIMIT)
				] as [number, number, number, number];
				if (clamped[0] !== x0 || clamped[1] !== y0 || clamped[2] !== x1 || clamped[3] !== y1) {
					console.log('[COG] bbox clamped:', [x0, y0, x1, y1], '→', clamped);
					Object.defineProperty(preflightGeotiff, 'bbox', {
						value: clamped,
						writable: false,
						configurable: true
					});
				}
			}
		}

		const layer = new COGLayer({
			id: 'cog-layer',
			geotiff: cogInput,
			pool,
			signal,
			...customProps,
			onGeoTIFFLoad: (
				loadedTiff: GeoTIFF,
				{
					geographicBounds
				}: {
					projection: unknown;
					geographicBounds: { west: number; south: number; east: number; north: number };
				}
			) => {
				const clamped = clampBounds(geographicBounds);

				// Extract metadata from the loaded GeoTIFF
				const tags = loadedTiff.cachedTags;
				const sf = tags.sampleFormat?.[0] ?? 1;
				const bps = tags.bitsPerSample?.[0] ?? 8;

				cogInfo = {
					width: loadedTiff.width,
					height: loadedTiff.height,
					bandCount: loadedTiff.count,
					dataType: buildDataTypeLabel(sf, bps),
					bounds: clamped
				};
				bounds = [clamped.west, clamped.south, clamped.east, clamped.north];
				fitCogBounds(map, clamped);
				loading = false;
			},
			onError: (err: Error) => {
				if (signal.aborted) return;
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
			}
		});

		const overlay = new MapboxOverlay({
			interleaved: false,
			layers: [layer],
			onError: (err: Error) => {
				if (signal.aborted) return;
				if (!error) {
					error = err?.message || String(err);
					loading = false;
				}
			}
		});
		overlayRef = overlay;
		map.addControl(overlay as unknown as maplibregl.IControl);
	} catch (err) {
		if (signal.aborted) return;
		if (err instanceof DOMException && err.name === 'AbortError') return;
		error = err instanceof Error ? err.message : String(err);
		loading = false;
	}
}

// ─── Cleanup ─────────────────────────────────────────────────────

function cleanup() {
	abortController.abort();
	if (mapRef) cleanupNativeBitmap(mapRef);
	if (mapRef && overlayRef) {
		try {
			mapRef.removeControl(overlayRef as unknown as maplibregl.IControl);
		} catch {
			/* map may already be destroyed */
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
