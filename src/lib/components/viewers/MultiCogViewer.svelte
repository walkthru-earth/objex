<script lang="ts">
import { MapboxOverlay } from '@deck.gl/mapbox';
import { DecoderPool, GeoTIFF } from '@developmentseed/geotiff';
import type maplibregl from 'maplibre-gl';
import { onDestroy, untrack } from 'svelte';
import { t } from '../../i18n/index.svelte.js';
import { getAdapter } from '../../storage/index.js';
import { buildProviderBaseUrl, type ProviderId } from '../../storage/providers.js';
import { connectionStore } from '../../stores/connections.svelte.js';
import { tabResources } from '../../stores/tab-resources.svelte.js';
import type { Tab } from '../../types.js';
import {
	applyPreset,
	availablePresets,
	compositeFromUrl,
	compositeToUrl,
	PRESETS,
	presetMatchesComposite
} from '../../utils/channel-composite.js';
import {
	clampBounds,
	cleanupNativeBitmap,
	createEpsgResolver,
	fitCogBounds,
	normalizeCogGeotiff,
	type RescaleConfig
} from '../../utils/cog.js';
import {
	type ChannelComposite,
	type CogAsset,
	extractCogAssets,
	isSingleAssetComposite,
	pickNaturalColorComposite
} from '../../utils/cog-asset.js';
import { isStacItem, type StacItem, type StacRoutableKind } from '../../utils/stac.js';
import { buildHttpsUrlAsync } from '../../utils/url.js';
import { getUrlViewParams, updateUrlViewParams } from '../../utils/url-state.js';
import CogControls from './CogControls.svelte';
import { buildRgbLayer } from './cog/buildRgbLayer.js';
import MapContainer from './map/MapContainer.svelte';

let { tab, classified }: { tab: Tab; classified?: StacRoutableKind } = $props();

let loading = $state(true);
let error = $state<string | null>(null);
let showControls = $state(false);
let bounds = $state<[number, number, number, number] | undefined>();
let activePresetId = $state<string>('natural-color');
// Sentinel-2 L2A reflectance is scaled uint16 (raw / 10000 = reflectance).
// After the default uint normalization the slider operates on 0..1, so 0.3
// keeps typical land surfaces in the visible range without clipping.
let rescale = $state<RescaleConfig>({ min: 0, max: 0.3 });

let assets = $state.raw<CogAsset[]>([]);
let composite = $state.raw<ChannelComposite | null>(null);
let abortController = new AbortController();
let mapRef: maplibregl.Map | null = null;
let overlayRef: MapboxOverlay | null = null;
let hasFittedOnce = false;
let presignCache = new Map<string, Promise<string>>();
// Per-asset-key GeoTIFF cache. Opening the GeoTIFF up-front lets buildRgbLayer
// run selectCogPipeline (which inspects sampleFormat / band count) and emit a
// custom getTileData/renderTile pair that honors per-channel bandIndex picks.
// Without this, the single-asset multi-band path (e.g. Sentinel-2 `visual`,
// NAIP `image`) silently falls back to bands 0/1/2 regardless of the picker.
let geotiffCache = new Map<string, Promise<GeoTIFF>>();
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
	overlayRef = null;
	assets = [];
	composite = null;
	presignCache = new Map();
	geotiffCache = new Map();
	loading = true;
	error = null;
	bounds = undefined;
	activePresetId = 'natural-color';
	rescale = { min: 0, max: 0.3 };
	hasFittedOnce = false;
	showControls = false;
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
		if (err instanceof DOMException && err.name === 'AbortError') return;
		error = err instanceof Error ? err.message : String(err);
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

	// For single-asset composites, pre-open the GeoTIFF so buildRgbLayer can
	// run selectCogPipeline and honor per-channel bandIndex. Multi-asset
	// composites use MultiCOGLayer which only reads band 0 anyway, so no
	// preflight is needed there.
	let preflightGeotiff: GeoTIFF | null = null;
	if (isSingleAssetComposite(c)) {
		const assetKey = c.r.assetKey;
		const asset = assets.find((a) => a.key === assetKey);
		if (asset) {
			let promise = geotiffCache.get(assetKey);
			if (!promise) {
				promise = (async () => {
					const url = await presignHref(asset.href);
					const g = await GeoTIFF.fromUrl(url);
					normalizeCogGeotiff(g);
					return g;
				})();
				geotiffCache.set(assetKey, promise);
			}
			try {
				preflightGeotiff = await promise;
			} catch (err) {
				console.warn('[MultiCogViewer] preflight GeoTIFF open failed', { assetKey, err });
				geotiffCache.delete(assetKey);
				preflightGeotiff = null;
			}
			if (signal.aborted) return;
		}
	}

	const { layer, kind } = await buildRgbLayer({
		id: `multicog-${tab.id}-v${version}`,
		assets,
		composite: c,
		rescale: { ...rescale },
		resolveHref: presignHref,
		pool,
		epsgResolver,
		signal,
		preflightGeotiff,
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
		layerId: (layer as { id?: string }).id
	});
	if (overlayRef) {
		overlayRef.setProps({ layers: [layer] });
		return;
	}

	const overlay = new MapboxOverlay({
		interleaved: false,
		layers: [layer],
		onError: (err: Error) => {
			if (signal.aborted) return;
			console.error('[MultiCogViewer] MapboxOverlay error', err);
			if (!error) {
				error = err?.message || String(err);
				loading = false;
			}
		}
	});
	overlayRef = overlay;
	map.addControl(overlay as unknown as maplibregl.IControl);
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
	console.debug('[MultiCogViewer] setPreset', { id, composite });
	syncCompositeToUrl(composite, id);
	if (mapRef) scheduleLayerRebuild(mapRef, abortController.signal);
}

function setComposite(next: ChannelComposite): void {
	composite = next;
	const matching = PRESETS.find((p) => presetMatchesComposite(p, next, assets));
	activePresetId = matching?.id ?? '';
	console.debug('[MultiCogViewer] setComposite', { next, activePresetId });
	syncCompositeToUrl(next, activePresetId || null);
	if (mapRef) scheduleLayerRebuild(mapRef, abortController.signal);
}

function handleRescaleChange(next: RescaleConfig): void {
	rescale = next;
	if (mapRef) scheduleLayerRebuild(mapRef, abortController.signal);
}

function cleanup(): void {
	abortController.abort();
	if (rebuildTimer != null) {
		clearTimeout(rebuildTimer);
		rebuildTimer = null;
	}
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

	<div class="pointer-events-none absolute left-2 top-2 z-10 flex flex-col gap-1">
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
	</div>

	{#if !error && assets.length > 0 && composite}
		<div class="absolute right-2 top-2 z-10 flex items-center gap-1">
			<button
				class="rounded bg-card/80 px-2 py-1 text-xs text-card-foreground backdrop-blur-sm hover:bg-card"
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
			/>
		{/if}
	{/if}
</div>
