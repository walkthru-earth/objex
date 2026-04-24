<script lang="ts">
import { MapboxOverlay } from '@deck.gl/mapbox';
import { COGLayer, MosaicLayer } from '@developmentseed/deck.gl-geotiff';
import { DecoderPool, GeoTIFF } from '@developmentseed/geotiff';
import type maplibregl from 'maplibre-gl';
import { onDestroy, untrack } from 'svelte';
import { t } from '../../i18n/index.svelte.js';
import { queryStacGeoparquetFeatureCollection } from '../../query/stac-geoparquet.js';
import { getAdapter } from '../../storage/index.js';
import { buildProviderBaseUrl, type ProviderId } from '../../storage/providers.js';
import { connectionStore } from '../../stores/connections.svelte.js';
import { tabResources } from '../../stores/tab-resources.svelte.js';
import type { Tab } from '../../types.js';
import {
	type BandConfig,
	clampBounds,
	cleanupNativeBitmap,
	createEpsgResolver,
	DEFAULT_RESCALE,
	defaultBandConfig,
	fitCogBounds,
	normalizeCogGeotiff,
	type RescaleConfig,
	selectCogPipeline
} from '../../utils/cog.js';
import {
	buildMosaicSourceMeta,
	classifyStac,
	type MosaicSourceMeta,
	type StacRoutableKind
} from '../../utils/stac.js';
import { hydrateStacItems } from '../../utils/stac-hydrate.js';
import { buildHttpsUrlAsync } from '../../utils/url.js';
import CogControls from './CogControls.svelte';
import MapContainer from './map/MapContainer.svelte';

let { tab, classified }: { tab: Tab; classified?: StacRoutableKind } = $props();

let loading = $state(true);
let error = $state<string | null>(null);
let showControls = $state(false);
let sourceCount = $state(0);
let bounds = $state<[number, number, number, number] | undefined>();
let bandConfig = $state<BandConfig | null>(null);
let histogram = $state.raw<Uint32Array | null>(null);
let rescale = $state<RescaleConfig>({ ...DEFAULT_RESCALE });
let detectedBandCount = $state<number>(3);
let probedBandCount = false;

let abortController = new AbortController();
let mapRef: maplibregl.Map | null = null;
let overlayRef: MapboxOverlay | null = null;
let itemsRef = $state.raw<MosaicSourceMeta[]>([]);
let hasFittedOnce = false;
let rebuildTimer: number | null = null;
let lastRebuildAt = 0;
let layerVersion = 0;
let presignCache = new Map<string, Promise<string>>();
let loadGen = 0;

// MosaicLayer builds a Flatbush spatial index at construction; deck.gl reuses
// the existing internal tileset when only props change, so the index never
// picks up new sources. Minimum interval between rebuilds + version-bumped id
// forces deck.gl to mount a fresh MosaicLayer with a rebuilt index, at the
// cost of discarding the tile cache. 750ms balances progressive feedback
// against cache churn.
const REBUILD_INTERVAL_MS = 750;

let pool: DecoderPool | null = new DecoderPool();
const epsgResolver = createEpsgResolver();

$effect(() => {
	if (!tab) return;
	tab.id;
	untrack(() => {
		resetViewer();
		if (mapRef) void loadMosaic(mapRef);
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
			/* map already destroyed */
		}
	}
	overlayRef = null;
	itemsRef = [];
	presignCache = new Map();
	loading = true;
	error = null;
	sourceCount = 0;
	bounds = undefined;
	bandConfig = null;
	histogram = null;
	rescale = { ...DEFAULT_RESCALE };
	hasFittedOnce = false;
	showControls = false;
	detectedBandCount = 3;
	probedBandCount = false;
}

function onMapReady(map: maplibregl.Map): void {
	mapRef = map;
	void loadMosaic(map);
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
			// presigning on private buckets (GCS/S3) — `new URL(rel, base)` strips
			// the base's query string when absolutizing asset hrefs, so the
			// signature is lost and the bare URL 403s.
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

function extendBounds(
	current: [number, number, number, number] | null,
	items: MosaicSourceMeta[]
): [number, number, number, number] | null {
	if (items.length === 0) return current;
	let [w, s, e, n] = current ?? items[0].bbox;
	for (const item of items) {
		w = Math.min(w, item.bbox[0]);
		s = Math.min(s, item.bbox[1]);
		e = Math.max(e, item.bbox[2]);
		n = Math.max(n, item.bbox[3]);
	}
	const clamped = clampBounds({ west: w, south: s, east: e, north: n });
	return [clamped.west, clamped.south, clamped.east, clamped.north];
}

function scheduleLayerRebuild(map: maplibregl.Map, signal: AbortSignal): void {
	if (rebuildTimer != null || signal.aborted) return;
	const elapsed = performance.now() - lastRebuildAt;
	const delay = lastRebuildAt === 0 ? 0 : Math.max(0, REBUILD_INTERVAL_MS - elapsed);
	rebuildTimer = window.setTimeout(() => {
		rebuildTimer = null;
		if (signal.aborted) return;
		lastRebuildAt = performance.now();
		buildOrUpdateLayer(map, signal);
	}, delay);
}

function flushPendingRebuild(map: maplibregl.Map, signal: AbortSignal): void {
	if (rebuildTimer != null) {
		clearTimeout(rebuildTimer);
		rebuildTimer = null;
	}
	if (signal.aborted) return;
	lastRebuildAt = performance.now();
	buildOrUpdateLayer(map, signal);
}

async function loadMosaic(map: maplibregl.Map): Promise<void> {
	const gen = ++loadGen;
	const signal = abortController.signal;
	try {
		const adapter = getAdapter(tab.source, tab.connectionId);
		const ext = (tab.extension ?? '').toLowerCase();

		// stac-geoparquet path: DuckDB materializes the full FeatureCollection
		// in one query, so hydration is a single batch (no link walking).
		if (ext === 'parquet' || ext === 'geoparquet') {
			const fc = await queryStacGeoparquetFeatureCollection(tab, tab.connectionId ?? '', {
				signal,
				limit: 2000
			});
			if (gen !== loadGen || signal.aborted) return;
			if (fc.features.length === 0) {
				error = t('map.mosaicEmpty');
				loading = false;
				return;
			}
			await ingestParquetFeatures(map, fc.features, signal, gen);
			return;
		}

		let kind: StacRoutableKind;
		if (classified && classified.kind !== 'none') {
			kind = classified;
		} else {
			const data = await adapter.read(tab.path, undefined, undefined, signal);
			if (gen !== loadGen || signal.aborted) return;
			const parsed = JSON.parse(new TextDecoder().decode(data));
			kind = classifyStac(parsed);
		}
		if (kind.kind === 'none') {
			error = t('map.mosaicEmpty');
			loading = false;
			return;
		}

		let runningBounds: [number, number, number, number] | null = null;
		// Resolve tab.path to an absolute URL so relative hrefs in the manifest
		// (e.g. `./item.json`) resolve against the real parent directory. For
		// bucket-connection tabs, tab.path is a bucket-relative key and would not
		// be a valid URL base.
		const baseHref = await buildHttpsUrlAsync(tab);
		if (gen !== loadGen || signal.aborted) return;

		await hydrateStacItems(kind, baseHref, adapter, {
			signal,
			concurrency: 12,
			limit: 2000,
			urlToKey: extractConnectionKey,
			onBatch: (batch) => {
				if (gen !== loadGen || signal.aborted) return;
				const accepted: MosaicSourceMeta[] = [];
				for (const item of batch) {
					const normalized = buildMosaicSourceMeta(item);
					if (normalized) accepted.push(normalized);
				}
				if (accepted.length === 0) return;

				for (const src of accepted) presignHref(src.href);

				itemsRef = [...itemsRef, ...accepted];
				sourceCount = itemsRef.length;

				runningBounds = extendBounds(runningBounds, accepted);
				// Only fit the camera once, on the first batch with a valid bbox.
				// Re-assigning `bounds` on later batches would cause MapContainer
				// to re-fly every 12-item batch, making the map unusable until
				// hydration completes.
				if (!hasFittedOnce && runningBounds) {
					bounds = runningBounds;
					fitCogBounds(map, {
						west: runningBounds[0],
						south: runningBounds[1],
						east: runningBounds[2],
						north: runningBounds[3]
					});
					hasFittedOnce = true;
				}

				if (!bandConfig) bandConfig = defaultBandConfig(detectedBandCount, 1);
				scheduleLayerRebuild(map, signal);
				loading = false;
			}
		});

		if (gen !== loadGen) return;
		if (itemsRef.length === 0 && !signal.aborted) {
			error = t('map.mosaicNoAssets');
			loading = false;
			return;
		}
		// Final rebuild once hydration completes so every source is in the
		// index, even if the last batch landed inside the throttle window.
		if (!signal.aborted) flushPendingRebuild(map, signal);
	} catch (err) {
		if (gen !== loadGen) return;
		if (signal.aborted) return;
		if (err instanceof DOMException && err.name === 'AbortError') return;
		error = err instanceof Error ? err.message : String(err);
		loading = false;
	}
}

/** Single-batch ingestion path for stac-geoparquet (already materialized). */
async function ingestParquetFeatures(
	map: maplibregl.Map,
	features: import('../../utils/stac.js').StacItem[],
	signal: AbortSignal,
	gen: number
): Promise<void> {
	const accepted: MosaicSourceMeta[] = [];
	for (const item of features) {
		const normalized = buildMosaicSourceMeta(item);
		if (normalized) accepted.push(normalized);
	}
	if (gen !== loadGen || signal.aborted) return;
	if (accepted.length === 0) {
		error = t('map.mosaicNoAssets');
		loading = false;
		return;
	}
	for (const src of accepted) presignHref(src.href);

	itemsRef = accepted;
	sourceCount = itemsRef.length;

	let runningBounds: [number, number, number, number] | null = null;
	runningBounds = extendBounds(runningBounds, accepted);
	if (runningBounds) {
		bounds = runningBounds;
		fitCogBounds(map, {
			west: runningBounds[0],
			south: runningBounds[1],
			east: runningBounds[2],
			north: runningBounds[3]
		});
		hasFittedOnce = true;
	}

	if (!bandConfig) bandConfig = defaultBandConfig(3, 1);
	loading = false;
	flushPendingRebuild(map, signal);
}

function buildOrUpdateLayer(map: maplibregl.Map, signal: AbortSignal): void {
	const snapshotSources = $state.snapshot(itemsRef) as MosaicSourceMeta[];
	const bc = bandConfig ? { ...bandConfig } : null;
	const rs = { ...rescale };

	const version = ++layerVersion;
	const layer = new MosaicLayer<MosaicSourceMeta, GeoTIFF>({
		id: `mosaic-${tab.id}-v${version}`,
		sources: snapshotSources,
		maxCacheSize: 8,
		getSource: async (source, opts) => {
			const url = await presignHref(source.href);
			const geotiff = await GeoTIFF.fromUrl(url);
			normalizeCogGeotiff(geotiff);
			if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
			// Seed band config from the first COG that resolves so the UI and
			// the pipeline match the actual raster (e.g. 4-band NAIP RGB+NIR),
			// rather than the hardcoded 3-band default. Subsequent sources are
			// assumed to share structure within a mosaic.
			if (!probedBandCount) {
				probedBandCount = true;
				const count = geotiff.count ?? 3;
				const sf = geotiff.cachedTags.sampleFormat?.[0] ?? 1;
				detectedBandCount = count;
				const nextConfig = defaultBandConfig(count, sf);
				bandConfig = nextConfig;
				if (mapRef) scheduleLayerRebuild(mapRef, signal);
			}
			return geotiff;
		},
		renderSource: (source, { data }) => {
			if (!data) return null;
			const customProps = selectCogPipeline(data, {
				bandConfig: bc,
				rescale: rs,
				onHistogram: (bins) => {
					histogram = new Uint32Array(bins);
				}
			});
			return new COGLayer({
				id: `mosaic-${tab.id}-v${version}-${source.id}`,
				geotiff: data,
				pool: pool ?? undefined,
				epsgResolver,
				signal,
				...customProps
			});
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
	loading = false;
}

function handleConfigChange(next: BandConfig): void {
	bandConfig = next;
	if (!mapRef) return;
	scheduleLayerRebuild(mapRef, abortController.signal);
}

function handleRescaleChange(next: RescaleConfig): void {
	rescale = next;
	if (!mapRef) return;
	scheduleLayerRebuild(mapRef, abortController.signal);
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
	itemsRef = [];
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
		{#if sourceCount > 0}
			<div class="rounded bg-card/80 px-2 py-1 text-xs text-card-foreground backdrop-blur-sm">
				{sourceCount === 1
					? t('stac.mosaicSourcesOne', { count: sourceCount })
					: t('stac.mosaicSourcesOther', { count: sourceCount })}
			</div>
		{/if}
		{#if error}
			<div class="pointer-events-auto max-w-sm rounded bg-red-900/80 px-2 py-1 text-xs text-red-200">
				{error}
			</div>
		{/if}
	</div>

	{#if sourceCount > 0 && bandConfig}
		<div class="absolute right-2 top-2 z-10 flex gap-1">
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
				bandCount={detectedBandCount}
				{bandConfig}
				onConfigChange={handleConfigChange}
				{rescale}
				rescaleApplicable={true}
				onRescaleChange={handleRescaleChange}
				{histogram}
			/>
		{/if}
	{/if}
</div>
