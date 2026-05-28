<script lang="ts">
import { MapboxOverlay } from '@deck.gl/mapbox';
import { DecoderPool, GeoTIFF } from '@developmentseed/geotiff';
import {
	applyPreset,
	attachPixelInspector,
	availablePresets,
	type ChannelComposite,
	type CogAsset,
	compositeFromUrl,
	compositeToUrl,
	extractCogAssets,
	handleLoadError,
	isAbortError,
	isSingleAssetComposite,
	isStacItem,
	LruCache,
	PRESETS,
	pickNaturalColorComposite,
	presetMatchesComposite,
	type StacItem,
	type StacRoutableKind,
	smokeTestHref
} from '@walkthru-earth/objex-utils';
import type maplibregl from 'maplibre-gl';
import { onDestroy, untrack } from 'svelte';
import { t } from '../../i18n/index.svelte.js';
import { getAdapter } from '../../storage/index.js';
import { buildProviderBaseUrl, type ProviderId } from '../../storage/providers.js';
import { connectionStore } from '../../stores/connections.svelte.js';
import { tabResources } from '../../stores/tab-resources.svelte.js';
import type { Tab } from '../../types.js';
import {
	buildHistogramFromGeotiff,
	clampBounds,
	cleanupNativeBitmap,
	createEpsgResolver,
	DEFAULT_NODATA_CONFIG,
	defaultRescaleForGeotiff,
	fitCogBounds,
	loadGeoTIFF,
	mapResolutionMetersPerPixel,
	type NodataConfig,
	normalizeCogGeotiff,
	type PixelValue,
	percentileFromHistogram,
	type RescaleConfig,
	readGdalNodata,
	readPixelAtLngLat,
	resolveNodata,
	resolveProj4Def,
	selectOverviewForResolution
} from '../../utils/cog.js';
import { buildHttpsUrlAsync } from '../../utils/signed-url.js';
import { getUrlViewParams, updateUrlViewParams } from '../../utils/url-state.js';
import CogControls from './CogControls.svelte';
import { buildRgbLayer } from './cog/buildRgbLayer.js';
import PixelInspectorPanel, { type PixelInspectorRow } from './cog/PixelInspectorPanel.svelte';
import MapContainer from './map/MapContainer.svelte';

let { tab, classified }: { tab: Tab; classified?: StacRoutableKind } = $props();

let loading = $state(true);
let error = $state<string | null>(null);
let showControls = $state(false);
let bounds = $state<[number, number, number, number] | undefined>();
let activePresetId = $state<string>('natural-color');
// Default rescale is bit-depth aware: uint8 visual COGs (Sentinel-2 `visual`,
// NAIP `image`) want max=0.3, uint16 reflectance bands (S2 raw `nir`/`swir`/`red`)
// want ~0.05 because r16unorm divides raw values by 65535, leaving typical
// reflectance ~0.012-0.046 in shader space. The actual default is reseeded
// from the first preflighted GeoTIFF in `buildAndAddLayer`. Until the user
// drags the slider, preset/composite swaps continue to refresh the default
// so switching from a uint8 visual to a uint16 multi-asset preset doesn't
// render near-black tiles.
let rescale = $state<RescaleConfig>({ min: 0, max: 0.3 });
let userTouchedRescale = false;
// Single-band histogram baked once from the R-channel preflight's smallest
// overview, in the same shader-space [0,1] domain the rescale slider uses.
// Backs the histogram overlay in CogControls. Recomputed when the R-channel
// asset changes (tracked by histogramAssetKey) so swapping bands gives the
// user an accurate distribution to scrub against.
let histogram = $state.raw<Uint32Array | null>(null);
let histogramAssetKey: string | null = null;
// User-facing nodata override (Auto/Value/Off). `autoNodata` is the GDAL_NODATA
// value read from the R-channel preflight; Auto mode resolves to it via
// `resolveNodata()` at layer-build time.
let nodataConfig = $state<NodataConfig>({ ...DEFAULT_NODATA_CONFIG });
let autoNodata = $state<number | null>(null);

let assets = $state.raw<CogAsset[]>([]);
let composite = $state.raw<ChannelComposite | null>(null);
let abortController = new AbortController();
let mapRef: maplibregl.Map | null = null;
let overlayRef: MapboxOverlay | null = null;
let hasFittedOnce = false;
const presignCache = new LruCache<string, Promise<string>>({ max: 64 });

// Pixel inspection: same UX as CogViewer / StacMosaicViewer. Click → read one
// pixel from each active composite channel's GeoTIFF and show channel/asset/value.
type MultiPixelEntry = {
	channel: 'R' | 'G' | 'B' | 'A';
	assetKey: string;
	bandIndex: number;
	value: number | null;
};
type MultiPixelValue = { lng: number; lat: number; entries: MultiPixelEntry[] };
let pixelValue = $state<MultiPixelValue | null>(null);
let inspecting = $state(false);
let proj4DefRef: string | null = null;
// Storage smoke-test result for the primary R-channel asset.
let smokeWarning = $state<string | null>(null);
let smokeProbed = false;
let detachInspector: (() => void) | null = null;
// Per-asset-key GeoTIFF cache. Opening the GeoTIFF up-front lets buildRgbLayer
// run selectCogPipeline (which inspects sampleFormat / band count) and emit a
// custom getTileData/renderTile pair that honors per-channel bandIndex picks.
// Without this, the single-asset multi-band path (e.g. Sentinel-2 `visual`,
// NAIP `image`) silently falls back to bands 0/1/2 regardless of the picker.
const geotiffCache = new LruCache<string, Promise<GeoTIFF>>({ max: 64 });
let loadGen = 0;
let layerVersion = 0;
let rebuildTimer: number | null = null;
let lastRebuildAt = 0;

// Throttle rebuilds so the rescale slider (oninput, fires per pixel of drag)
// doesn't spawn N overlapping buildAndAddLayer calls that each addControl a
// new MapboxOverlay, leaking every overlay but the last.
const REBUILD_INTERVAL_MS = 750;

let pool: DecoderPool | null = new DecoderPool();
const epsgResolver = createEpsgResolver();

const presetsForItem = $derived(availablePresets(assets));

$effect(() => {
	if (!tab) return;
	tab.id;
	untrack(() => {
		resetViewer();
		if (mapRef) void loadItem(mapRef);
	});
});

function resetViewer(): void {
	abortController.abort();
	abortController = new AbortController();
	if (rebuildTimer != null) {
		clearTimeout(rebuildTimer);
		rebuildTimer = null;
	}
	lastRebuildAt = 0;
	layerVersion = 0;
	if (mapRef) cleanupNativeBitmap(mapRef);
	if (mapRef && overlayRef) {
		try {
			mapRef.removeControl(overlayRef as unknown as maplibregl.IControl);
		} catch {
			/* already destroyed */
		}
	}
	removeClickHandler();
	overlayRef = null;
	assets = [];
	composite = null;
	presignCache.clear();
	geotiffCache.clear();
	loading = true;
	error = null;
	bounds = undefined;
	activePresetId = 'natural-color';
	rescale = { min: 0, max: 0.3 };
	userTouchedRescale = false;
	histogram = null;
	histogramAssetKey = null;
	nodataConfig = { ...DEFAULT_NODATA_CONFIG };
	autoNodata = null;
	hasFittedOnce = false;
	showControls = false;
	pixelValue = null;
	inspecting = false;
	proj4DefRef = null;
	smokeWarning = null;
	smokeProbed = false;
}

function removeClickHandler(): void {
	if (detachInspector) {
		detachInspector();
		detachInspector = null;
	}
}

async function ensureGeotiff(assetKey: string): Promise<GeoTIFF | null> {
	const asset = assets.find((a) => a.key === assetKey);
	if (!asset) return null;
	let promise = geotiffCache.get(assetKey);
	if (!promise) {
		promise = (async () => {
			const url = await presignHref(asset.href);
			const g = await loadGeoTIFF(url);
			normalizeCogGeotiff(g);
			return g;
		})();
		geotiffCache.set(assetKey, promise);
	}
	try {
		return await promise;
	} catch (err) {
		console.warn('[MultiCogViewer] ensureGeotiff failed', { assetKey, err });
		geotiffCache.delete(assetKey);
		return null;
	}
}

function setupClickHandler(map: maplibregl.Map): void {
	removeClickHandler();
	detachInspector = attachPixelInspector<MultiPixelValue>(map, {
		probe: async ({ lng, lat, signal }) => {
			const c = composite;
			if (!c) return null;
			// Match the overview that's currently on screen so the pixel readout
			// reflects the visible decimation level. Computed once per click and
			// re-picked per-channel because per-asset COGs may have different
			// pyramids (Sentinel-2 SWIR is 20 m native, true color is 10 m).
			const targetRes = mapResolutionMetersPerPixel(map.getZoom(), lat);
			const channels: { channel: 'R' | 'G' | 'B' | 'A'; ref: typeof c.r | undefined }[] = [
				{ channel: 'R', ref: c.r },
				{ channel: 'G', ref: c.g },
				{ channel: 'B', ref: c.b },
				{ channel: 'A', ref: c.a }
			];
			const active = channels.filter(
				(x): x is { channel: 'R' | 'G' | 'B' | 'A'; ref: NonNullable<typeof c.r> } => Boolean(x.ref)
			);
			const entries = await Promise.all(
				active.map(async ({ channel, ref }): Promise<MultiPixelEntry> => {
					const geotiff = await ensureGeotiff(ref.assetKey);
					if (!geotiff || signal.aborted) {
						return { channel, assetKey: ref.assetKey, bandIndex: ref.bandIndex, value: null };
					}
					try {
						const overview = selectOverviewForResolution(geotiff, targetRes);
						const result: PixelValue | null = await readPixelAtLngLat(
							geotiff,
							lng,
							lat,
							proj4DefRef,
							pool,
							signal,
							{ overview }
						);
						const v = result?.values?.[ref.bandIndex] ?? null;
						return { channel, assetKey: ref.assetKey, bandIndex: ref.bandIndex, value: v };
					} catch {
						return { channel, assetKey: ref.assetKey, bandIndex: ref.bandIndex, value: null };
					}
				})
			);
			if (signal.aborted) return null;
			return { lng, lat, entries };
		},
		onStart: () => {
			inspecting = true;
		},
		onResult: (result) => {
			pixelValue = result;
			inspecting = false;
		}
	});
}

function scheduleLayerRebuild(map: maplibregl.Map, signal: AbortSignal): void {
	if (rebuildTimer != null || signal.aborted) return;
	const elapsed = performance.now() - lastRebuildAt;
	const delay = lastRebuildAt === 0 ? 0 : Math.max(0, REBUILD_INTERVAL_MS - elapsed);
	rebuildTimer = window.setTimeout(() => {
		rebuildTimer = null;
		if (signal.aborted) return;
		lastRebuildAt = performance.now();
		void buildAndAddLayer(map, ++layerVersion, signal);
	}, delay);
}

function onMapReady(map: maplibregl.Map): void {
	mapRef = map;
	void loadItem(map);
}

function extractConnectionKey(href: string): string | null {
	const conn = tab.connectionId ? connectionStore.getById(tab.connectionId) : undefined;
	if (!conn) return null;
	const base = buildProviderBaseUrl(
		conn.provider as ProviderId,
		conn.endpoint,
		conn.bucket,
		conn.region
	).replace(/\/$/, '');
	if (!base) return null;
	const prefix = `${base}/`;
	if (!href.startsWith(prefix)) return null;
	return href.slice(prefix.length);
}

function presignHref(href: string): Promise<string> {
	let cached = presignCache.get(href);
	if (!cached) {
		if (/^https?:\/\//i.test(href)) {
			// Absolute URLs that belong to the tab's own bucket still need SigV4
			// presigning on private buckets — `new URL(rel, base)` strips the
			// base's query string when absolutizing band hrefs, so the signature
			// is lost and the bare URL 403s.
			const key = extractConnectionKey(href);
			if (key !== null) {
				cached = buildHttpsUrlAsync({ ...tab, path: key } as Tab).catch(() => href);
			} else {
				cached = Promise.resolve(href);
			}
		} else {
			cached = buildHttpsUrlAsync({ ...tab, path: href } as Tab).catch(() => href);
		}
		presignCache.set(href, cached);
	}
	return cached;
}

async function loadItem(map: maplibregl.Map): Promise<void> {
	const gen = ++loadGen;
	const signal = abortController.signal;
	try {
		let item: StacItem | null = null;
		if (classified && classified.kind === 'item') {
			item = classified.item;
		} else {
			const adapter = getAdapter(tab.source, tab.connectionId);
			const data = await adapter.read(tab.path, undefined, undefined, signal);
			if (gen !== loadGen || signal.aborted) return;
			const parsed = JSON.parse(new TextDecoder().decode(data));
			if (!isStacItem(parsed)) {
				error = t('map.multiCogMissingBands');
				loading = false;
				return;
			}
			item = parsed;
		}
		if (!item) {
			error = t('map.multiCogMissingBands');
			loading = false;
			return;
		}

		const next = extractCogAssets(item);
		if (next.length < 1) {
			error = t('map.multiCogMissingBands');
			loading = false;
			return;
		}
		assets = next;

		// Hydrate composite: URL params first, then natural-color default.
		const params = getUrlViewParams();
		const fromUrl = compositeFromUrl(params, next);
		console.debug('[MultiCogViewer] loadItem', {
			assetKeys: next.map((a) => `${a.key}(bands=${a.bandCount},common=${a.eoCommon[0] ?? ''})`),
			urlParams: Object.fromEntries(params.entries()),
			fromUrl
		});
		if (fromUrl) {
			composite = fromUrl;
			const presetId = params.get('preset');
			if (presetId && PRESETS.find((p) => p.id === presetId)) activePresetId = presetId;
			else activePresetId = '';
		} else {
			const picked = pickNaturalColorComposite(next);
			composite = picked?.composite ?? null;
			activePresetId = picked?.source === 'rgb-bands' ? 'natural-color' : '';
		}
		console.debug('[MultiCogViewer] composite seeded', { composite, activePresetId });

		if (!composite) {
			error = t('map.multiCogMissingBands');
			loading = false;
			return;
		}

		// One-shot storage smoke-test against the R-channel asset. lazycogs-style
		// probe surfaces auth / CORS / bucket failures at open time as an amber
		// pill, fires in parallel with the rest of the load. Aborts via the
		// viewer's existing controller.
		if (!smokeProbed) {
			smokeProbed = true;
			const rAsset = next.find((a) => a.key === composite!.r.assetKey);
			if (rAsset) {
				void (async () => {
					try {
						const url = await presignHref(rAsset.href);
						const result = await smokeTestHref(url, signal);
						if (gen !== loadGen || signal.aborted) return;
						if (!result.ok) smokeWarning = result.reason;
					} catch (err) {
						if (isAbortError(err)) return;
						if (gen !== loadGen) return;
						smokeWarning = handleLoadError(err);
					}
				})();
			}
		}

		if (Array.isArray(item.bbox) && item.bbox.length >= 4) {
			const clamped = clampBounds({
				west: Number(item.bbox[0]),
				south: Number(item.bbox[1]),
				east: Number(item.bbox[2]),
				north: Number(item.bbox[3])
			});
			bounds = [clamped.west, clamped.south, clamped.east, clamped.north];
			if (!hasFittedOnce) {
				fitCogBounds(map, clamped);
				hasFittedOnce = true;
			}
		}

		await buildAndAddLayer(map, ++layerVersion, signal);
	} catch (err) {
		if (gen !== loadGen) return;
		if (signal.aborted) return;
		if (isAbortError(err)) return;
		error = handleLoadError(err);
		loading = false;
	}
}

async function buildAndAddLayer(
	map: maplibregl.Map,
	version: number,
	signal: AbortSignal
): Promise<void> {
	const c = composite;
	if (!c) return;

	console.debug('[MultiCogViewer] buildAndAddLayer start', {
		version,
		composite: c,
		rescale: { ...rescale }
	});

	// Pre-open the R-channel GeoTIFF on every path. For single-asset composites
	// this lets buildRgbLayer run selectCogPipeline and honor per-channel
	// bandIndex. For multi-asset composites (MultiCOGLayer) the GeoTIFF object
	// is not consumed by the layer, but inspecting its tags lets us pick a
	// bit-depth-appropriate default rescale so uint16 reflectance bands don't
	// render near-black against a slider tuned for uint8 visuals.
	let preflightGeotiff: GeoTIFF | null = null;
	const rChannelKey = c.r.assetKey;
	const rAsset = assets.find((a) => a.key === rChannelKey);
	if (rAsset) {
		let promise = geotiffCache.get(rChannelKey);
		if (!promise) {
			promise = (async () => {
				const url = await presignHref(rAsset.href);
				const g = await loadGeoTIFF(url);
				normalizeCogGeotiff(g);
				return g;
			})();
			geotiffCache.set(rChannelKey, promise);
		}
		try {
			preflightGeotiff = await promise;
		} catch (err) {
			console.warn('[MultiCogViewer] preflight GeoTIFF open failed', {
				assetKey: rChannelKey,
				err
			});
			geotiffCache.delete(rChannelKey);
			preflightGeotiff = null;
		}
		if (signal.aborted) return;
	}

	if (preflightGeotiff && !userTouchedRescale) {
		const next = defaultRescaleForGeotiff(preflightGeotiff);
		if (next.min !== rescale.min || next.max !== rescale.max) {
			console.debug('[MultiCogViewer] reseeding rescale from preflight', {
				assetKey: rChannelKey,
				prev: { ...rescale },
				next
			});
			rescale = next;
		}
	}

	// Surface GDAL_NODATA from the R-channel preflight so the CogControls nodata
	// hint pill and the `Auto` resolved value have a real number to show before
	// the first tile decodes.
	if (preflightGeotiff) {
		autoNodata = readGdalNodata(preflightGeotiff);
	}

	// Bake the histogram once per R-channel asset. Cheap (one overview tile),
	// and gives CogControls a real distribution to overlay behind the slider.
	// When the user hasn't touched the slider, also reseed rescale to the
	// p2/p98 of that distribution so the thumbs land where the data actually
	// lives instead of at the bit-depth-aware default. This is what gives a
	// preset switch (e.g. true-color → vegetation, red → swir16) auto-contrast
	// without the user having to re-drag the slider every time.
	if (preflightGeotiff && histogramAssetKey !== rChannelKey) {
		histogramAssetKey = rChannelKey;
		void (async () => {
			const bins = await buildHistogramFromGeotiff(preflightGeotiff, signal);
			if (signal.aborted) return;
			if (histogramAssetKey !== rChannelKey) return; // user swapped while baking
			histogram = bins;
			if (!userTouchedRescale && bins) {
				const lo = percentileFromHistogram(bins, 0.02);
				const hi = percentileFromHistogram(bins, 0.98);
				if (lo !== null && hi !== null && hi > lo) {
					console.debug('[MultiCogViewer] reseeding rescale from histogram p2/p98', {
						assetKey: rChannelKey,
						prev: { ...rescale },
						next: { min: lo, max: hi }
					});
					rescale = { min: lo, max: hi };
				}
			}
		})();
	}

	// Resolve proj4 once for pixel inspection. All band assets in a STAC Item
	// share the same source CRS so the R-channel preflight is sufficient.
	if (preflightGeotiff && proj4DefRef === null) {
		try {
			proj4DefRef = await resolveProj4Def(preflightGeotiff.crs, signal);
		} catch {
			proj4DefRef = null;
		}
		if (signal.aborted) return;
	}

	// Multi-asset path doesn't consume the GeoTIFF object; only single-asset
	// flows it through to selectCogPipeline. Drop the reference so buildRgbLayer
	// doesn't try to translate per-channel bandIndex on a path that can't honor it.
	const preflightForLayer = isSingleAssetComposite(c) ? preflightGeotiff : null;

	const resolvedNodata = resolveNodata(nodataConfig, autoNodata);
	const { layer, kind } = await buildRgbLayer({
		id: `multicog-${tab.id}-v${version}`,
		assets,
		composite: c,
		rescale: { ...rescale },
		resolveHref: presignHref,
		pool,
		epsgResolver,
		signal,
		preflightGeotiff: preflightForLayer,
		noDataVal: resolvedNodata,
		onLoad: ({ bounds: nextBounds }) => {
			if (version !== layerVersion || signal.aborted) return;
			if (nextBounds) {
				const clamped = clampBounds(nextBounds);
				if (!hasFittedOnce) {
					bounds = [clamped.west, clamped.south, clamped.east, clamped.north];
					fitCogBounds(map, clamped);
					hasFittedOnce = true;
				}
			}
			loading = false;
		}
	});

	console.debug('[MultiCogViewer] buildAndAddLayer built', {
		version,
		kind,
		layerId: (layer as { id?: string }).id,
		hasOverlay: !!overlayRef
	});
	if (overlayRef) {
		console.debug('[MultiCogViewer] overlayRef.setProps swapping layer', {
			version,
			layerId: (layer as { id?: string }).id
		});
		overlayRef.setProps({ layers: [layer] });
		return;
	}

	const overlay = new MapboxOverlay({
		interleaved: false,
		layers: [layer],
		onError: (err: Error) => {
			if (signal.aborted) return;
			console.error('[MultiCogViewer] MapboxOverlay error', {
				name: err?.name,
				message: err?.message,
				stack: err?.stack,
				err
			});
			if (!error) {
				error = err?.message || String(err);
				loading = false;
			}
		}
	});
	overlayRef = overlay;
	console.debug('[MultiCogViewer] addControl initial overlay', {
		version,
		layerId: (layer as { id?: string }).id
	});
	map.addControl(overlay as unknown as maplibregl.IControl);
	setupClickHandler(map);
}

function syncCompositeToUrl(c: ChannelComposite | null, presetId: string | null): void {
	if (!c) {
		updateUrlViewParams('map', null);
		return;
	}
	updateUrlViewParams('map', compositeToUrl(c, presetId));
}

function setPreset(id: string): void {
	const preset = PRESETS.find((p) => p.id === id);
	if (!preset) return;
	const next = applyPreset(assets, preset);
	if (!next) return;
	const a = composite?.a;
	composite = a ? { ...next, a } : next;
	activePresetId = id;
	// Asset references changed: let the next preflight reseed a bit-depth-
	// appropriate default rescale (uint8 visual → 0.3, uint16 reflectance → 0.05).
	userTouchedRescale = false;
	console.debug('[MultiCogViewer] setPreset', { id, composite });
	syncCompositeToUrl(composite, id);
	if (mapRef) scheduleLayerRebuild(mapRef, abortController.signal);
}

function setComposite(next: ChannelComposite): void {
	const rAssetChanged = composite?.r.assetKey !== next.r.assetKey;
	composite = next;
	const matching = PRESETS.find((p) => presetMatchesComposite(p, next, assets));
	activePresetId = matching?.id ?? '';
	// Only reseed the rescale default when the R-channel asset changed, because
	// that's the asset we preflight; band-index-only swaps shouldn't stomp the
	// user's slider.
	if (rAssetChanged) userTouchedRescale = false;
	console.debug('[MultiCogViewer] setComposite', { next, activePresetId, rAssetChanged });
	syncCompositeToUrl(next, activePresetId || null);
	if (mapRef) scheduleLayerRebuild(mapRef, abortController.signal);
}

function handleRescaleChange(next: RescaleConfig): void {
	rescale = next;
	userTouchedRescale = true;
	if (mapRef) scheduleLayerRebuild(mapRef, abortController.signal);
}

function cleanup(): void {
	abortController.abort();
	if (rebuildTimer != null) {
		clearTimeout(rebuildTimer);
		rebuildTimer = null;
	}
	removeClickHandler();
	if (mapRef && overlayRef) {
		try {
			mapRef.removeControl(overlayRef as unknown as maplibregl.IControl);
		} catch {
			/* already removed */
		}
	}
	if (mapRef) cleanupNativeBitmap(mapRef);
	mapRef = null;
	overlayRef = null;
	assets = [];
	composite = null;
	presignCache.clear();
	geotiffCache.clear();
	pixelValue = null;
	inspecting = false;
	proj4DefRef = null;
	histogram = null;
	histogramAssetKey = null;
	const maybeDestroy = pool as unknown as { destroy?: () => void; terminate?: () => void } | null;
	if (maybeDestroy?.destroy) {
		try {
			maybeDestroy.destroy();
		} catch {
			/* ignore */
		}
	} else if (maybeDestroy?.terminate) {
		try {
			maybeDestroy.terminate();
		} catch {
			/* ignore */
		}
	}
	pool = null;
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

	<div class="pointer-events-none absolute left-2 top-2 z-10 flex max-w-[calc(100vw-7rem)] flex-col gap-1 sm:max-w-none">
		{#if loading}
			<div class="rounded bg-card/80 px-2 py-1 text-xs text-card-foreground backdrop-blur-sm">
				{t('map.loadingCog')}
			</div>
		{/if}
		{#if error}
			<div class="pointer-events-auto max-w-sm rounded bg-red-900/80 px-2 py-1 text-xs text-red-200">
				{error}
			</div>
		{/if}
		{#if smokeWarning && !error}
			<div
				class="pointer-events-auto max-w-sm rounded bg-amber-900/80 px-2 py-1 text-xs text-amber-100"
				title={t('stac.smokeWarningHint')}
			>
				{t('stac.smokeWarning', { reason: smokeWarning })}
			</div>
		{/if}
	</div>

	{#if !error && assets.length > 0 && composite}
		<div class="absolute right-2 top-2 z-10 flex items-center gap-1" style="touch-action: manipulation;">
			<button
				class="inline-flex min-h-11 min-w-11 items-center justify-center rounded bg-card/80 px-3 py-1.5 text-xs text-card-foreground backdrop-blur-sm hover:bg-card sm:min-h-0 sm:min-w-0 sm:px-2 sm:py-1"
				class:ring-1={showControls}
				class:ring-primary={showControls}
				onclick={() => {
					showControls = !showControls;
				}}
			>
				{t('cog.style')}
			</button>
		</div>

		{#if showControls}
			<CogControls
				{assets}
				composite={composite}
				onCompositeChange={setComposite}
				presets={presetsForItem}
				{activePresetId}
				onPresetChange={setPreset}
				mode="rgb"
				onModeChange={() => {}}
				{rescale}
				rescaleApplicable={true}
				onRescaleChange={handleRescaleChange}
				showAlpha={assets.length >= 4}
				{histogram}
				nodata={nodataConfig}
				{autoNodata}
				onNodataChange={(next) => {
					nodataConfig = next;
					if (mapRef) scheduleLayerRebuild(mapRef, abortController.signal);
				}}
			/>
		{/if}
	{/if}

	<PixelInspectorPanel
		lng={pixelValue?.lng ?? null}
		lat={pixelValue?.lat ?? null}
		rows={pixelValue
			? (pixelValue.entries.map((e) => ({
					label: e.channel,
					sublabel: e.assetKey,
					value: e.value
				})) satisfies PixelInspectorRow[])
			: null}
		onClose={() => (pixelValue = null)}
		{inspecting}
	/>
</div>
