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
	type BandConfig,
	buildDataTypeLabel,
	type CogInfo,
	clampBounds,
	cleanupNativeBitmap,
	createConfigurableGetTileData,
	createCustomGetTileData,
	customRenderTile,
	defaultBandConfig,
	fitCogBounds,
	needsCustomPipeline,
	needsCustomPipelineForConfig,
	type PixelValue,
	readPixelAtLngLat,
	renderNonTiledBitmap,
	resolveProj4Def
} from '../../utils/cog.js';
import { buildHttpsUrl } from '../../utils/url.js';
import CogControls from './CogControls.svelte';
import MapContainer from './map/MapContainer.svelte';

// ─── State ───────────────────────────────────────────────────────

let { tab }: { tab: Tab } = $props();
let loading = $state(true);
let error = $state<string | null>(null);
let showInfo = $state(false);
let showControls = $state(false);
let bounds = $state<[number, number, number, number] | undefined>();
let cogInfo = $state<CogInfo | null>(null);
let bandConfig = $state<BandConfig | null>(null);
let pixelValue = $state<PixelValue | null>(null);
let inspecting = $state(false);

let abortController = new AbortController();
let mapRef: maplibregl.Map | null = null;
let overlayRef: MapboxOverlay | null = null;
let geotiffRef: GeoTIFF | null = null;
let proj4DefRef: string | null = null;
let sampleFormatRef = 1;
let isTiledRef = true;
let clickHandlerRef: ((e: maplibregl.MapMouseEvent) => void) | null = null;
// Tracks whether the camera has already been framed for the current tab.
// Prevents fitCogBounds from resetting the user's view when the band/style
// config changes and the COGLayer is rebuilt.
let hasFittedOnce = false;

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
		removeClickHandler();
		if (mapRef) cleanupNativeBitmap(mapRef);
		if (mapRef && overlayRef) {
			try {
				mapRef.removeControl(overlayRef as unknown as maplibregl.IControl);
			} catch {
				/* map may already be destroyed */
			}
		}
		overlayRef = null;
		geotiffRef = null;
		proj4DefRef = null;
		loading = true;
		error = null;
		cogInfo = null;
		bandConfig = null;
		pixelValue = null;
		bounds = undefined;
		hasFittedOnce = false;
		showControls = false;
		showInfo = false;
		if (mapRef) loadCog(mapRef);
	});
});

// ─── Map ready ───────────────────────────────────────────────────

function onMapReady(map: maplibregl.Map) {
	mapRef = map;
	loadCog(map);
}

// ─── Click handler for pixel inspection ──────────────────────────

function removeClickHandler() {
	if (mapRef && clickHandlerRef) {
		mapRef.off('click', clickHandlerRef);
		clickHandlerRef = null;
	}
}

function setupClickHandler(map: maplibregl.Map) {
	removeClickHandler();
	clickHandlerRef = async (e: maplibregl.MapMouseEvent) => {
		if (!geotiffRef) return;
		inspecting = true;
		try {
			const result = await readPixelAtLngLat(
				geotiffRef,
				e.lngLat.lng,
				e.lngLat.lat,
				proj4DefRef,
				pool,
				abortController.signal
			);
			pixelValue = result;
		} catch {
			pixelValue = null;
		} finally {
			inspecting = false;
		}
	};
	map.on('click', clickHandlerRef);
}

// ─── Core load function ──────────────────────────────────────────

async function loadCog(map: maplibregl.Map) {
	const signal = abortController.signal;

	try {
		const url = buildHttpsUrl(tab);

		// Pre-flight: read first IFD to check if tiled (single range request).
		let isTiled = true;
		let preflightGeotiff: GeoTIFF | undefined;
		try {
			preflightGeotiff = await GeoTIFF.fromUrl(url);
			if (signal.aborted) return;
			isTiled = preflightGeotiff.isTiled;

			// Validate CRS early
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
		}

		// Store refs for pixel inspection and rebuild
		if (preflightGeotiff) {
			geotiffRef = preflightGeotiff;
			isTiledRef = isTiled;
			const tags = preflightGeotiff.cachedTags;
			sampleFormatRef = tags.sampleFormat?.[0] ?? 1;

			// Resolve proj4 definition for CRS conversion (pixel inspector)
			try {
				proj4DefRef = await resolveProj4Def(preflightGeotiff.crs, signal);
			} catch {
				proj4DefRef = null;
			}
			if (signal.aborted) return;

			// Set default band config
			bandConfig = defaultBandConfig(preflightGeotiff.count, sampleFormatRef);
		}

		if (!isTiled && preflightGeotiff) {
			// ── Non-tiled TIFF — render as bitmap ──
			const info = await renderNonTiledBitmap({
				url,
				map,
				signal,
				geotiff: preflightGeotiff
			});
			if (signal.aborted) return;
			cogInfo = info;
			if (!hasFittedOnce) {
				bounds = [info.bounds.west, info.bounds.south, info.bounds.east, info.bounds.north];
				fitCogBounds(map, info.bounds);
				hasFittedOnce = true;
			}
			setupClickHandler(map);
			loading = false;
			return;
		}

		// ── Tiled COG ──
		buildAndAddLayer(map, preflightGeotiff, signal);
	} catch (err) {
		if (signal.aborted) return;
		if (err instanceof DOMException && err.name === 'AbortError') return;
		error = err instanceof Error ? err.message : String(err);
		loading = false;
	}
}

// ─── Build & add COGLayer ────────────────────────────────────────

function buildAndAddLayer(
	map: maplibregl.Map,
	preflightGeotiff: GeoTIFF | undefined,
	signal: AbortSignal
) {
	const useCustom = preflightGeotiff
		? bandConfig
			? needsCustomPipelineForConfig(preflightGeotiff, bandConfig)
			: needsCustomPipeline(preflightGeotiff)
		: false;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const customProps: Record<string, any> = {};
	if (useCustom && preflightGeotiff && bandConfig) {
		customProps.getTileData = createConfigurableGetTileData(preflightGeotiff, bandConfig);
		customProps.renderTile = customRenderTile;
	} else if (useCustom && preflightGeotiff) {
		customProps.getTileData = createCustomGetTileData(preflightGeotiff);
		customProps.renderTile = customRenderTile;
	}

	const cogInput = preflightGeotiff ?? buildHttpsUrl(tab);

	if (preflightGeotiff) {
		// Strip oversized overviews
		const validOverviews = preflightGeotiff.overviews.filter(
			(ov) => ov.width >= ov.tileWidth && ov.height >= ov.tileHeight
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(preflightGeotiff as any).overviews = validOverviews;

		// Clamp EPSG:4326 bbox
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
				Object.defineProperty(preflightGeotiff, 'bbox', {
					value: clamped,
					writable: false,
					configurable: true
				});
			}
		}
	}

	const layer = new COGLayer({
		// Stable id per tab so rebuilds on band/style change don't force deck.gl
		// to treat this as a brand-new layer and drop cached tile state.
		id: `cog-layer-${tab.id}`,
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
			// Only frame the camera on the first load of this tab. Band/style
			// rebuilds re-fire onGeoTIFFLoad; refitting would clobber the user's
			// current view.
			if (!hasFittedOnce) {
				bounds = [clamped.west, clamped.south, clamped.east, clamped.north];
				fitCogBounds(map, clamped);
				hasFittedOnce = true;
			}
			setupClickHandler(map);
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
}

// ─── Rebuild layer on band config change ─────────────────────────

function handleConfigChange(newConfig: BandConfig) {
	bandConfig = newConfig;
	if (!mapRef || !geotiffRef || !isTiledRef) return;

	// Remove old overlay
	if (overlayRef) {
		try {
			mapRef.removeControl(overlayRef as unknown as maplibregl.IControl);
		} catch {
			/* already removed */
		}
		overlayRef = null;
	}

	// Rebuild with new config
	buildAndAddLayer(mapRef, geotiffRef, abortController.signal);
}

// ─── Cleanup ─────────────────────────────────────────────────────

function cleanup() {
	abortController.abort();
	removeClickHandler();
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
	geotiffRef = null;
	proj4DefRef = null;
	pixelValue = null;
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

	<!-- Top-left: Loading + metadata badges -->
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

	<!-- Top-right: Info + Style buttons -->
	{#if cogInfo}
		<div class="absolute right-2 top-2 z-10 flex gap-1">
			{#if bandConfig}
				<button
					class="rounded bg-card/80 px-2 py-1 text-xs text-card-foreground backdrop-blur-sm hover:bg-card"
					class:ring-1={showControls}
					class:ring-primary={showControls}
					onclick={() => {
						showControls = !showControls;
						if (showControls) showInfo = false;
					}}
				>
					{t('cog.style')}
				</button>
			{/if}
			<button
				class="rounded bg-card/80 px-2 py-1 text-xs text-card-foreground backdrop-blur-sm hover:bg-card"
				class:ring-1={showInfo}
				class:ring-primary={showInfo}
				onclick={() => {
					showInfo = !showInfo;
					if (showInfo) showControls = false;
				}}
			>
				{t('map.info')}
			</button>
		</div>

		<!-- Band/Color controls panel -->
		{#if showControls && bandConfig}
			<CogControls
				bandCount={cogInfo.bandCount}
				{bandConfig}
				onConfigChange={handleConfigChange}
			/>
		{/if}

		<!-- Info panel -->
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
						W {cogInfo.bounds.west.toFixed(4)}, S {cogInfo.bounds.south.toFixed(4)}<br
						/>
						E {cogInfo.bounds.east.toFixed(4)}, N {cogInfo.bounds.north.toFixed(4)}
					</dd>
				</dl>
			</div>
		{/if}
	{/if}

	<!-- Bottom-left: Pixel value on click -->
	{#if pixelValue}
		<div
			class="absolute bottom-2 left-2 z-10 rounded bg-card/90 p-2.5 text-xs text-card-foreground backdrop-blur-sm"
		>
			<div class="mb-1 flex items-center justify-between gap-3">
				<span class="font-medium">{t('cog.pixelValue')}</span>
				<button
					class="text-muted-foreground hover:text-card-foreground"
					onclick={() => (pixelValue = null)}
				>
					&times;
				</button>
			</div>
			<div class="space-y-0.5 text-muted-foreground">
				<div>
					{pixelValue.lat.toFixed(6)}&deg;, {pixelValue.lng.toFixed(6)}&deg;
				</div>
				<div class="text-[10px]">
					px ({pixelValue.col}, {pixelValue.row})
				</div>
			</div>
			<div class="mt-1.5 space-y-0.5">
				{#each pixelValue.values as val, i}
					<div class="flex justify-between gap-2">
						<span class="text-muted-foreground">{t('cog.band')} {i + 1}</span>
						<span class="font-mono tabular-nums">
							{Number.isInteger(val) ? val : val.toFixed(4)}
						</span>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	{#if inspecting}
		<div
			class="pointer-events-none absolute bottom-2 left-2 z-10 rounded bg-card/80 px-2 py-1 text-xs text-card-foreground backdrop-blur-sm"
		>
			{t('cog.reading')}
		</div>
	{/if}
</div>
