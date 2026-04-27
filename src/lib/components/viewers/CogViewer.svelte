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
	type CustomTileData,
	clampBounds,
	cleanupNativeBitmap,
	createEpsgResolver,
	DEFAULT_RESCALE,
	defaultBandConfig,
	fitCogBounds,
	HISTOGRAM_BIN_COUNT,
	inspectCogTags,
	needsCustomPipelineForConfig,
	normalizeCogGeotiff,
	type PixelValue,
	type RescaleConfig,
	readPixelAtLngLat,
	renderNonTiledBitmap,
	resolveProj4Def,
	selectCogPipeline
} from '../../utils/cog.js';
import { type ChannelComposite, type CogAsset, syntheticSelfAsset } from '../../utils/cog-asset.js';
import { buildHttpsUrlAsync } from '../../utils/url.js';
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
let resolvedHrefForControls = $state<string | null>(null);
let probedBandCount = $state<number | null>(null);

const cogControlsAssets = $derived.by<CogAsset[]>(() => {
	const href = resolvedHrefForControls;
	if (!href) return [];
	return [syntheticSelfAsset(href, probedBandCount ?? undefined)];
});

const cogControlsComposite = $derived.by<ChannelComposite>(() => {
	const bc = bandConfig;
	if (!bc) {
		return {
			r: { assetKey: 'self', bandIndex: 0 },
			g: { assetKey: 'self', bandIndex: 0 },
			b: { assetKey: 'self', bandIndex: 0 }
		};
	}
	if (bc.mode === 'rgb') {
		return {
			r: { assetKey: 'self', bandIndex: bc.rBand ?? 0 },
			g: { assetKey: 'self', bandIndex: bc.gBand ?? 0 },
			b: { assetKey: 'self', bandIndex: bc.bBand ?? 0 }
		};
	}
	const i = bc.band ?? 0;
	return {
		r: { assetKey: 'self', bandIndex: i },
		g: { assetKey: 'self', bandIndex: i },
		b: { assetKey: 'self', bandIndex: i }
	};
});
let histogram = $state.raw<Uint32Array | null>(null);
let histogramTick = $state(0);
let rescale = $state<RescaleConfig>({ ...DEFAULT_RESCALE });
// Palette-indexed COGs render through the library's Colormap module; a GPU
// rescale at that stage is cosmetic and would confuse the legend. Keep the
// slider hidden when a ColorMap tag is present.
let isPaletteIndexed = $state(false);
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
let resolvedHttpsUrl: string | null = null;
// LinearRescale operates on a 0..1 scalar. Two cases expose a meaningful
// slider: (1) the library-default uint RGB pipeline (scales `color.rgb`
// before presentation), and (2) our custom single-band CPU + GPU Colormap
// path (scales `color.r` before the ramp sample). Palette COGs hide the
// slider, the embedded ColorMap tag already bakes the display colors.
// `needsCustomPipelineForConfig` only touches read-only tags, safe to call
// outside reactive tracking.
const rescaleApplicable = $derived.by(() => {
	if (!cogInfo || !bandConfig || isPaletteIndexed) return false;
	const g = geotiffRef;
	if (!g) return false;
	if (!needsCustomPipelineForConfig(g, bandConfig)) return true;
	return bandConfig.mode === 'single';
});
// Tracks whether the camera has already been framed for the current tab.
// Prevents fitCogBounds from resetting the user's view when the band/style
// config changes and the COGLayer is rebuilt.
let hasFittedOnce = false;

// Main-thread decoder pool — worker-based DecoderPool fails in Vite dev mode
// (ESM workers can't load through the dev server). Main-thread decoding is
// reliable across all environments. COGLayer's defaultDecoderPool() would
// create workers that crash with NS_ERROR_CORRUPTED_CONTENT in Firefox.
const pool = new DecoderPool();

// EPSG resolver backed by the bundled `@developmentseed/epsg` WKT database.
// Avoids the library default that calls epsg.io at runtime. The CSV is
// streamed and parsed lazily on first use and cached for the session.
const epsgResolver = createEpsgResolver();

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
		resolvedHttpsUrl = null;
		resolvedHrefForControls = null;
		probedBandCount = null;
		loading = true;
		error = null;
		cogInfo = null;
		bandConfig = null;
		histogram = null;
		histogramTick = 0;
		rescale = { ...DEFAULT_RESCALE };
		isPaletteIndexed = false;
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
		const url = await buildHttpsUrlAsync(tab);
		if (signal.aborted) return;
		resolvedHttpsUrl = url;
		resolvedHrefForControls = url;

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
			// `@developmentseed/geotiff` throws "Only tiff supported version:<n>"
			// when the first 4 bytes don't match II*\0 / MM\0* / II+\0 / MM\0+.
			// This happens on files that advertise image/tiff but are corrupt,
			// encrypted, or a different format entirely (GDAL reports "not
			// recognized as being in a supported file format" on the same file).
			// Surface a clear message and bail — COGLayer would re-invoke the
			// same loader and throw the identical error uncaught during update.
			const msg = preflightErr instanceof Error ? preflightErr.message : String(preflightErr);
			if (/Only tiff supported version|not a tiff|Invalid.*magic/i.test(msg)) {
				error = t('map.cogInvalidTiff');
				loading = false;
				return;
			}
		}

		// Store refs for pixel inspection and rebuild
		if (preflightGeotiff) {
			geotiffRef = preflightGeotiff;
			isTiledRef = isTiled;
			const tagInfo = inspectCogTags(preflightGeotiff);
			sampleFormatRef = tagInfo.sampleFormat;
			isPaletteIndexed = tagInfo.isPaletteIndexed;

			// Resolve proj4 definition for CRS conversion (pixel inspector)
			try {
				proj4DefRef = await resolveProj4Def(preflightGeotiff.crs, signal);
			} catch {
				proj4DefRef = null;
			}
			if (signal.aborted) return;

			// Set default band config
			bandConfig = defaultBandConfig(preflightGeotiff.count, sampleFormatRef);
			probedBandCount = preflightGeotiff.count;
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
	// Pick the library-default or one of three custom pipelines. Empty when the
	// library-default uint path runs unchanged.
	const customProps = preflightGeotiff
		? selectCogPipeline(preflightGeotiff, { bandConfig, rescale })
		: {};

	// Apply upstream-bug workarounds in place (overview filter, 4326 bbox clamp).
	if (preflightGeotiff) normalizeCogGeotiff(preflightGeotiff);

	const cogInput = preflightGeotiff ?? resolvedHttpsUrl ?? '';

	// Cast: `onViewportLoad` is forwarded by our pnpm patch to the inner
	// TileLayer, but COGLayer's generated .d.ts does not expose it.
	// biome-ignore lint/suspicious/noExplicitAny: upstream prop not yet in types
	const cogProps: any = {
		// Stable id per tab so rebuilds on band/style change don't force deck.gl
		// to treat this as a brand-new layer and drop cached tile state.
		id: `cog-layer-${tab.id}`,
		geotiff: cogInput,
		pool,
		epsgResolver,
		signal,
		...customProps,
		// COG-native histogram: sum `content.histogram` over tiles currently
		// visible in the viewport. Fires after every pan/zoom settles and
		// reuses deck.gl's tile cache for free, cached tiles still carry
		// their per-tile histogram so no rebake is needed on revisit.
		onViewportLoad: (visibleTiles: unknown) => {
			aggregateVisibleHistogram(
				visibleTiles as ReadonlyArray<{ content?: unknown } | null | undefined>
			);
		},
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
	};
	const layer = new COGLayer(cogProps);

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

// ─── Viewport-scoped histogram aggregation ───────────────────────

/**
 * Sum per-tile histograms from tiles currently visible in the viewport. COG
 * pyramid semantics map cleanly: zoomed out → a handful of low-res overview
 * tiles cover the whole scene; zoomed in → only the tiles intersecting the
 * AOI are decoded. deck.gl reuses its tile cache on revisits so each cached
 * tile still carries `content.histogram`, no rebake needed.
 */
function aggregateVisibleHistogram(
	visibleTiles: ReadonlyArray<{ content?: unknown } | null | undefined>
): void {
	if (!visibleTiles || visibleTiles.length === 0) {
		histogram = null;
		histogramTick++;
		return;
	}
	const summed = new Uint32Array(HISTOGRAM_BIN_COUNT);
	let found = false;
	for (const tile of visibleTiles) {
		// COGLayer wraps our baker's return as `{data, forwardTransform,
		// inverseTransform}` in `_getTileData`, so the histogram lives at
		// `content.data.histogram`. MosaicLayer's sub-COGs follow the same
		// shape. Fall back to `content.histogram` for future-proofing if
		// upstream ever stops wrapping.
		const content = tile?.content as
			| { data?: CustomTileData; histogram?: Uint32Array }
			| null
			| undefined;
		const bins = content?.data?.histogram ?? content?.histogram;
		if (!bins || bins.length !== HISTOGRAM_BIN_COUNT) continue;
		for (let i = 0; i < HISTOGRAM_BIN_COUNT; i++) summed[i] += bins[i];
		found = true;
	}
	histogram = found ? summed : null;
	histogramTick++;
}

// ─── Rebuild layer on band config change ─────────────────────────

function handleConfigChange(newConfig: BandConfig) {
	bandConfig = newConfig;
	// Only the single-band CPU baker emits `onHistogram`. Clear the buffer on
	// every mode/band change so (a) switching back to RGB hides stale bars
	// that the rescale slider would otherwise draw on top of, and (b) picking
	// a different single band starts a fresh distribution.
	histogram = null;
	histogramTick = 0;
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

function handleRescaleChange(next: RescaleConfig) {
	rescale = next;
	if (!mapRef || !geotiffRef || !isTiledRef) return;

	// Remove old overlay and rebuild. deck.gl diffs on layer id, so reusing the
	// stable per-tab id keeps tile cache state where possible.
	if (overlayRef) {
		try {
			mapRef.removeControl(overlayRef as unknown as maplibregl.IControl);
		} catch {
			/* already removed */
		}
		overlayRef = null;
	}
	buildAndAddLayer(mapRef, geotiffRef, abortController.signal);
}

// ─── Unified picker change handlers ──────────────────────────────

function handleCompositeChange(next: ChannelComposite): void {
	if (!bandConfig) return;
	if (bandConfig.mode === 'rgb') {
		handleConfigChange({
			...bandConfig,
			rBand: next.r.bandIndex,
			gBand: next.g.bandIndex,
			bBand: next.b.bandIndex
		});
	} else {
		handleConfigChange({ ...bandConfig, band: next.r.bandIndex });
	}
}

function handleModeChange(m: 'rgb' | 'single'): void {
	if (!bandConfig) return;
	handleConfigChange({ ...bandConfig, mode: m });
}

function handleBandConfigChange(next: BandConfig): void {
	handleConfigChange(next);
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
	resolvedHttpsUrl = null;
	resolvedHrefForControls = null;
	probedBandCount = null;
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
				assets={cogControlsAssets}
				composite={cogControlsComposite}
				onCompositeChange={handleCompositeChange}
				presets={[]}
				activePresetId=""
				onPresetChange={() => {}}
				mode={bandConfig?.mode ?? 'rgb'}
				onModeChange={handleModeChange}
				{bandConfig}
				bandCount={probedBandCount ?? cogInfo.bandCount}
				onBandConfigChange={handleBandConfigChange}
				{rescale}
				rescaleApplicable={rescaleApplicable}
				onRescaleChange={handleRescaleChange}
				{histogram}
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
