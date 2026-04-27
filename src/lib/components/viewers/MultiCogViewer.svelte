<script lang="ts">
import { MapboxOverlay } from '@deck.gl/mapbox';
import { MultiCOGLayer } from '@developmentseed/deck.gl-geotiff';
import { DecoderPool } from '@developmentseed/geotiff';
import type maplibregl from 'maplibre-gl';
import { onDestroy, untrack } from 'svelte';
import { t } from '../../i18n/index.svelte.js';
import { getAdapter } from '../../storage/index.js';
import { buildProviderBaseUrl, type ProviderId } from '../../storage/providers.js';
import { connectionStore } from '../../stores/connections.svelte.js';
import { tabResources } from '../../stores/tab-resources.svelte.js';
import type { Tab } from '../../types.js';
import {
	buildBandRenderPipeline,
	clampBounds,
	cleanupNativeBitmap,
	createEpsgResolver,
	fitCogBounds,
	type RescaleConfig
} from '../../utils/cog.js';
import {
	type BandSlot,
	extractRasterBandAssets,
	hasCompositableBands,
	isStacItem,
	type RasterBandAsset,
	resolvePresetComposite,
	type StacItem,
	type StacRoutableKind
} from '../../utils/stac.js';
import { buildHttpsUrlAsync } from '../../utils/url.js';
import { getUrlViewParams, updateUrlViewParams } from '../../utils/url-state.js';
import CogControls from './CogControls.svelte';
import MapContainer from './map/MapContainer.svelte';

interface Preset {
	id: string;
	labelKey: string;
	composite: { r: BandSlot; g: BandSlot; b: BandSlot };
}

const PRESETS: Preset[] = [
	{
		id: 'true-color',
		labelKey: 'map.multiCogPreset.trueColor',
		composite: { r: 'red', g: 'green', b: 'blue' }
	},
	{
		id: 'false-color-ir',
		labelKey: 'map.multiCogPreset.falseColorIR',
		composite: { r: 'nir', g: 'red', b: 'green' }
	},
	{
		id: 'swir',
		labelKey: 'map.multiCogPreset.swir',
		composite: { r: 'swir2', g: 'swir1', b: 'red' }
	},
	{
		id: 'vegetation',
		labelKey: 'map.multiCogPreset.vegetation',
		composite: { r: 'nir', g: 'swir1', b: 'red' }
	},
	{
		id: 'agriculture',
		labelKey: 'map.multiCogPreset.agriculture',
		composite: { r: 'swir1', g: 'nir', b: 'blue' }
	}
];

let { tab, classified }: { tab: Tab; classified?: StacRoutableKind } = $props();

/** R/G/B (+ optional A) composite expressed as STAC asset keys for this Item.
 *  Replaces the closed `BandSlot` enum so non-S2 catalogs can be composed. */
type AssetComposite = { r: string; g: string; b: string; a?: string };

let loading = $state(true);
let error = $state<string | null>(null);
let showControls = $state(false);
let bounds = $state<[number, number, number, number] | undefined>();
let activePresetId = $state<string>('true-color');
// Sentinel-2 L2A reflectance is scaled uint16 (raw / 10000 = reflectance).
// After the default uint normalization the slider operates on 0..1, so 0.3
// keeps typical land surfaces in the visible range without clipping.
let rescale = $state<RescaleConfig>({ min: 0, max: 0.3 });

let rasterAssets = $state.raw<RasterBandAsset[]>([]);
let composite = $state.raw<AssetComposite | null>(null);
let abortController = new AbortController();
let mapRef: maplibregl.Map | null = null;
let overlayRef: MapboxOverlay | null = null;
let hasFittedOnce = false;
let presignCache = new Map<string, Promise<string>>();
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

const activePreset = $derived(PRESETS.find((p) => p.id === activePresetId) ?? PRESETS[0]);
const availablePresets = $derived(
	PRESETS.filter((p) => resolvePresetComposite(rasterAssets, p.composite) !== null)
);
const assetByKey = $derived.by(() => {
	const map = new Map<string, RasterBandAsset>();
	for (const a of rasterAssets) map.set(a.key, a);
	return map;
});

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
	rasterAssets = [];
	composite = null;
	presignCache = new Map();
	loading = true;
	error = null;
	bounds = undefined;
	activePresetId = 'true-color';
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
			item = parsed as StacItem;
		}
		if (!item) {
			error = t('map.multiCogMissingBands');
			loading = false;
			return;
		}

		const assets = extractRasterBandAssets(item);
		if (!hasCompositableBands(assets)) {
			error = t('map.multiCogMissingBands');
			loading = false;
			return;
		}
		rasterAssets = assets;

		// Hydrate composite from URL hash params first (shareable links), then
		// fall back to the active preset (resolved via common-name + vendor key
		// fallbacks), then to the first three assets if no preset matches.
		const params = getUrlViewParams();
		const r = params.get('r');
		const g = params.get('g');
		const b = params.get('b');
		const a = params.get('a') ?? undefined;
		const presetId = params.get('preset');
		if (
			r &&
			g &&
			b &&
			assets.some((x) => x.key === r) &&
			assets.some((x) => x.key === g) &&
			assets.some((x) => x.key === b)
		) {
			composite = { r, g, b, a: a && assets.some((x) => x.key === a) ? a : undefined };
			if (presetId) activePresetId = presetId;
		} else {
			const resolved = resolvePresetComposite(assets, activePreset.composite);
			if (resolved) {
				composite = resolved;
			} else {
				const [c0, c1, c2] = assets;
				composite = { r: c0.key, g: c1.key, b: c2.key };
				activePresetId = '';
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
	const cur = composite;
	if (!cur) return;
	const channels: { key: string; href: string }[] = [];
	for (const k of [cur.r, cur.g, cur.b, cur.a].filter((v): v is string => Boolean(v))) {
		const asset = assetByKey.get(k);
		if (!asset) continue;
		const url = await presignHref(asset.href);
		if (version !== layerVersion || signal.aborted) return;
		channels.push({ key: k, href: url });
	}
	const sources: Record<string, { url: string }> = {};
	for (const ch of channels) sources[ch.key] = { url: ch.href };

	const compositeSpec: { r: string; g: string; b: string; a?: string } = {
		r: cur.r,
		g: cur.g,
		b: cur.b
	};
	if (cur.a && sources[cur.a]) compositeSpec.a = cur.a;

	const layer = new MultiCOGLayer({
		id: `multicog-${tab.id}-v${version}`,
		sources,
		composite: compositeSpec,
		renderPipeline: buildBandRenderPipeline({ noDataVal: 0, rescale: { ...rescale } }),
		pool: pool ?? undefined,
		epsgResolver,
		signal,
		onGeoTIFFLoad: (_tiffs, { geographicBounds }) => {
			if (version !== layerVersion || signal.aborted) return;
			const clamped = clampBounds(geographicBounds);
			if (!hasFittedOnce) {
				bounds = [clamped.west, clamped.south, clamped.east, clamped.north];
				fitCogBounds(map, clamped);
				hasFittedOnce = true;
			}
			loading = false;
		}
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
			if (!error) {
				error = err?.message || String(err);
				loading = false;
			}
		}
	});
	overlayRef = overlay;
	map.addControl(overlay as unknown as maplibregl.IControl);
}

function syncCompositeToUrl(c: AssetComposite | null, presetId: string | null): void {
	if (!c) {
		updateUrlViewParams('map', null);
		return;
	}
	const params = new URLSearchParams();
	params.set('r', c.r);
	params.set('g', c.g);
	params.set('b', c.b);
	if (c.a) params.set('a', c.a);
	if (presetId) params.set('preset', presetId);
	updateUrlViewParams('map', params);
}

function setPreset(id: string): void {
	const preset = PRESETS.find((p) => p.id === id);
	if (!preset) return;
	const resolved = resolvePresetComposite(rasterAssets, preset.composite);
	if (!resolved) return;
	activePresetId = id;
	composite = { ...resolved, a: composite?.a };
	syncCompositeToUrl(composite, id);
	if (mapRef) scheduleLayerRebuild(mapRef, abortController.signal);
}

function setChannel(channel: 'r' | 'g' | 'b' | 'a', assetKey: string): void {
	if (!composite) return;
	const next: AssetComposite =
		channel === 'a' && !assetKey
			? { r: composite.r, g: composite.g, b: composite.b }
			: { ...composite, [channel]: assetKey };
	composite = next;
	// User overrode a channel — drop the preset id so the URL reflects manual.
	const p = PRESETS.find((pr) => pr.id === activePresetId);
	const stillMatches = p && resolvePresetComposite(rasterAssets, p.composite);
	if (
		!stillMatches ||
		stillMatches.r !== next.r ||
		stillMatches.g !== next.g ||
		stillMatches.b !== next.b
	) {
		activePresetId = '';
	}
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
	rasterAssets = [];
	composite = null;
	presignCache.clear();
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

	{#if !error && rasterAssets.length > 0 && composite}
		<div class="absolute right-2 top-2 z-10 flex items-center gap-1">
			{#if availablePresets.length > 0}
				<label class="flex items-center gap-1 rounded bg-card/80 px-2 py-1 text-xs text-card-foreground backdrop-blur-sm">
					<span class="text-muted-foreground">{t('map.multiCogPreset.label')}</span>
					<select
						class="rounded border border-border bg-background px-1 py-0.5 text-xs"
						value={activePresetId}
						onchange={(e) => setPreset((e.target as HTMLSelectElement).value)}
					>
						{#if !activePresetId}
							<option value="">{t('map.multiCogPreset.custom')}</option>
						{/if}
						{#each availablePresets as p}
							<option value={p.id}>{t(p.labelKey)}</option>
						{/each}
					</select>
				</label>
			{/if}
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
				mode="multi"
				assets={rasterAssets}
				composite={composite}
				onCompositeChange={setChannel}
				{rescale}
				rescaleApplicable={true}
				onRescaleChange={handleRescaleChange}
			/>
		{/if}
	{/if}
</div>
