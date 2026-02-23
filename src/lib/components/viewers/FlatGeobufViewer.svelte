<script lang="ts">
import { geojson as fgbGeojson } from 'flatgeobuf';
import { magicbytes } from 'flatgeobuf/lib/mjs/constants.js';
import { buildHeader as fgbBuildHeader } from 'flatgeobuf/lib/mjs/generic/featurecollection.js';
import type { HeaderMeta } from 'flatgeobuf/lib/mjs/header-meta.js';
import { HttpReader } from 'flatgeobuf/lib/mjs/http-reader.js';
import type maplibregl from 'maplibre-gl';
import { onDestroy, untrack } from 'svelte';
import { t } from '$lib/i18n/index.svelte.js';
import type { Tab } from '$lib/types';
import { geojsonFillColor, geojsonLineColor, loadDeckModules } from '$lib/utils/deck.js';
import { buildHttpsUrl } from '$lib/utils/url.js';
import AttributeTable from './map/AttributeTable.svelte';
import MapContainer from './map/MapContainer.svelte';

let { tab }: { tab: Tab } = $props();

const FEATURE_LIMIT = 100_000;
const BATCH_SIZE = 1000;
const PREVIEW_SIZE = 1000;

let loading = $state(true);
let streaming = $state(false);
let error = $state<string | null>(null);
let featureCount = $state(0);
let totalFeatures = $state<number | null>(null);
let selectedFeature = $state<Record<string, any> | null>(null);
let showAttributes = $state(false);
let showInfo = $state(false);
let bounds = $state<[number, number, number, number] | undefined>();
let hasMore = $state(false);

let deckModules: { MapboxOverlay: any; GeoJsonLayer: any } | null = null;
let overlay: any = null;
let mapRef: maplibregl.Map | null = null;
let features: GeoJSON.Feature[] = [];
let abortController: AbortController | null = null;
let activeStreamCancel: (() => void) | null = null;
let resolveMapReady: (() => void) | null = null;
let mapReadyPromise: Promise<void> | null = null;

// Stored from preview for load-all (skip index)
let storedHeader: HeaderMeta | null = null;
let storedFeatureOffset = 0;

// Header metadata from FlatGeobuf
let headerInfo = $state<{
	geometryType: string;
	featuresCount: number;
	columns: { name: string; type: number }[];
	crs: { org: string | null; code: number; name: string | null } | null;
	title: string | null;
	description: string | null;
	hasIndex: boolean;
} | null>(null);

const GEOM_TYPE_NAMES: Record<number, string> = {
	0: 'Unknown',
	1: 'Point',
	2: 'LineString',
	3: 'Polygon',
	4: 'MultiPoint',
	5: 'MultiLineString',
	6: 'MultiPolygon',
	7: 'GeometryCollection'
};

function populateHeaderInfo(header: HeaderMeta) {
	totalFeatures = header.featuresCount;
	headerInfo = {
		geometryType: GEOM_TYPE_NAMES[header.geometryType] ?? `Type ${header.geometryType}`,
		featuresCount: header.featuresCount,
		columns: (header.columns ?? []).map((c) => ({ name: c.name, type: c.type })),
		crs: header.crs ? { org: header.crs.org, code: header.crs.code, name: header.crs.name } : null,
		title: header.title,
		description: header.description,
		hasIndex: header.indexNodeSize > 0
	};

	if (header.envelope && header.envelope.length >= 4) {
		bounds = [header.envelope[0], header.envelope[1], header.envelope[2], header.envelope[3]];
		mapRef?.fitBounds(bounds, { padding: 40 });
	}
}

function cleanup() {
	resolveMapReady?.();
	resolveMapReady = null;
	hasMore = false;
	// Force-close any active stream + HTTP connection
	activeStreamCancel?.();
	activeStreamCancel = null;
	if (abortController) {
		abortController.abort();
		abortController = null;
	}
	if (overlay && mapRef) {
		try {
			mapRef.removeControl(overlay);
		} catch {
			/* already removed */
		}
	}
	overlay = null;
	mapRef = null;
	features = [];
	storedHeader = null;
	storedFeatureOffset = 0;
}

$effect(() => {
	if (!tab) return;
	const _tabId = tab.id;
	untrack(() => {
		loadFlatGeobuf();
	});
});

onDestroy(cleanup);

async function loadFlatGeobuf() {
	console.log('[FGB]', 'loadFlatGeobuf() start');
	cleanup();

	loading = true;
	streaming = false;
	error = null;
	features = [];
	featureCount = 0;
	totalFeatures = null;
	headerInfo = null;
	bounds = undefined;
	hasMore = false;

	try {
		mapReadyPromise = new Promise<void>((r) => {
			resolveMapReady = r;
		});

		deckModules = await loadDeckModules();
		loading = false;
		streaming = true;

		await mapReadyPromise;
		if (!overlay) return;

		// Read header via range requests (fast: 1-2 small requests)
		// Gets metadata + feature offset to skip the spatial index
		await readHeaderWithRangeRequests();

		// Stream features (skips index if header was read, else sequential)
		await streamFeatures(PREVIEW_SIZE);
	} catch (err) {
		console.error('[FGB]', 'loadFlatGeobuf error:', err);
		if (err instanceof DOMException && err.name === 'AbortError') return;
		error = err instanceof Error ? err.message : String(err);
		loading = false;
	} finally {
		console.log('[FGB]', 'done, features:', features.length);
		streaming = false;
	}
}

/**
 * Read header via range requests (fast: 1-2 small requests).
 * Stores header + feature offset for the composite stream approach.
 */
async function readHeaderWithRangeRequests(): Promise<boolean> {
	const url = buildHttpsUrl(tab);

	let reader: HttpReader;
	try {
		reader = await HttpReader.open(url, false);
	} catch (e) {
		console.warn('[FGB]', 'HttpReader.open failed:', e);
		return false;
	}

	const header = reader.header;
	console.log('[FGB]', 'header:', {
		geometryType: header.geometryType,
		featuresCount: header.featuresCount,
		indexNodeSize: header.indexNodeSize,
		envelope: header.envelope ? Array.from(header.envelope) : null,
		columns: header.columns?.length
	});
	populateHeaderInfo(header);

	storedHeader = header;
	storedFeatureOffset = reader.lengthBeforeFeatures();
	console.log(
		'[FGB]',
		'featureOffset:',
		storedFeatureOffset,
		'(index ~',
		((storedFeatureOffset - 12) / 1024 / 1024).toFixed(1),
		'MB skipped)'
	);
	return true;
}

/** Load all features — skips the spatial index using a Range request. */
async function loadAllFeatures() {
	if (!overlay) return;
	hasMore = false;
	streaming = true;

	try {
		features = [];
		featureCount = 0;
		await streamFeatures();
	} catch (err) {
		console.error('[FGB]', 'loadAllFeatures error:', err);
		if (err instanceof DOMException && err.name === 'AbortError') return;
		error = err instanceof Error ? err.message : String(err);
	} finally {
		console.log('[FGB]', 'loadAllFeatures done, features:', features.length);
		streaming = false;
	}
}

/**
 * Stream features sequentially.
 * If storedHeader is available, skips the index with a Range request + composite stream.
 */
async function streamFeatures(limit?: number) {
	const ac = new AbortController();
	abortController = ac;
	const url = buildHttpsUrl(tab);
	const t0 = performance.now();

	let iter: AsyncGenerator;
	activeStreamCancel = null;

	if (storedHeader && storedFeatureOffset > 0) {
		const fakeHeaderBytes = fgbBuildHeader({
			...storedHeader,
			indexNodeSize: 0,
			envelope: null
		});

		const featureResp = await fetch(url, {
			headers: { Range: `bytes=${storedFeatureOffset}-` },
			signal: ac.signal
		});
		console.log(
			'[FGB]',
			'Range fetch:',
			featureResp.status,
			featureResp.headers.get('content-range')
		);
		if (!featureResp.ok && featureResp.status !== 206)
			throw new Error(`HTTP ${featureResp.status}: ${featureResp.statusText}`);
		if (!featureResp.body) throw new Error('No response body');

		const composite = createCompositeStream(fakeHeaderBytes, featureResp.body);
		activeStreamCancel = composite.cancel;
		iter = fgbGeojson.deserialize(composite.stream, undefined, (h: any) =>
			populateHeaderInfo(h)
		) as AsyncGenerator;
	} else {
		const response = await fetch(url, { signal: ac.signal });
		if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		if (!response.body) throw new Error('No response body');
		iter = fgbGeojson.deserialize(response.body, undefined, (h: any) =>
			populateHeaderInfo(h)
		) as AsyncGenerator;
	}

	let batchCount = 0;
	let lastUpdateTime = Date.now();
	let flewToFeatures = false;
	let hitLimit = false;

	try {
		for await (const feature of iter) {
			if (ac.signal.aborted) return;

			features.push(feature as GeoJSON.Feature);
			batchCount++;

			const now = Date.now();
			if (batchCount >= BATCH_SIZE || now - lastUpdateTime > 200) {
				featureCount = features.length;
				updateLayer();
				if (!flewToFeatures) {
					flyToFeaturesBounds();
					flewToFeatures = true;
				}
				batchCount = 0;
				lastUpdateTime = now;
				await new Promise((r) => setTimeout(r, 0));
				if (ac.signal.aborted) return;
			}

			if (limit && features.length >= limit) {
				hitLimit = true;
				break;
			}
			if (features.length >= FEATURE_LIMIT) {
				hitLimit = true;
				break;
			}
		}
	} finally {
		// Force-close the HTTP connection. break from for-await doesn't release
		// the flatgeobuf library's internal stream reader, so the browser keeps
		// downloading gigabytes in the background unless we explicitly cancel.
		if (hitLimit) {
			activeStreamCancel?.();
			activeStreamCancel = null;
			ac.abort();
			console.log('[FGB]', 'force-closed connection after', features.length, 'features');
		}
	}

	if (features.length === 0) {
		error = 'No features found in FlatGeobuf file';
		return;
	}

	featureCount = features.length;
	updateLayer();
	if (!flewToFeatures) flyToFeaturesBounds();
	console.log(
		'[FGB]',
		'stream done:',
		features.length,
		'features in',
		(performance.now() - t0).toFixed(0),
		'ms'
	);

	if (hitLimit) {
		hasMore = totalFeatures != null && totalFeatures > features.length;
	} else {
		hasMore = false;
	}
}

/** Compute bounding box of current features and fly the map to it. */
function flyToFeaturesBounds() {
	if (!mapRef || features.length === 0) return;
	let minLng = Infinity,
		minLat = Infinity,
		maxLng = -Infinity,
		maxLat = -Infinity;

	function processCoords(coords: any) {
		if (!coords) return;
		if (typeof coords[0] === 'number' && coords.length >= 2) {
			minLng = Math.min(minLng, coords[0]);
			minLat = Math.min(minLat, coords[1]);
			maxLng = Math.max(maxLng, coords[0]);
			maxLat = Math.max(maxLat, coords[1]);
		} else if (Array.isArray(coords[0])) {
			for (const c of coords) processCoords(c);
		}
	}

	for (const f of features) {
		processCoords((f.geometry as any)?.coordinates);
	}

	if (minLng !== Infinity) {
		bounds = [minLng, minLat, maxLng, maxLat];
		mapRef.fitBounds(bounds, { padding: 40 });
	}
}

/** Create a ReadableStream: magic bytes + header bytes + feature data stream.
 *  Returns both the stream and a cancel() handle to force-close the connection. */
function createCompositeStream(
	headerBytes: Uint8Array,
	featureStream: ReadableStream<Uint8Array>
): { stream: ReadableStream<Uint8Array>; cancel: () => void } {
	const featureReader = featureStream.getReader();
	let headerSent = false;

	const stream = new ReadableStream({
		pull(controller) {
			if (!headerSent) {
				controller.enqueue(new Uint8Array(magicbytes));
				controller.enqueue(headerBytes);
				headerSent = true;
				return;
			}
			return featureReader.read().then(({ value, done }) => {
				if (done) {
					controller.close();
				} else {
					controller.enqueue(value);
				}
			});
		},
		cancel() {
			featureReader.cancel();
		}
	});

	return {
		stream,
		cancel: () => {
			try {
				featureReader.cancel();
			} catch {
				/* already released */
			}
		}
	};
}

function updateLayer() {
	if (!overlay || !deckModules) return;

	const { GeoJsonLayer } = deckModules;
	overlay.setProps({
		layers: [
			new GeoJsonLayer({
				id: 'flatgeobuf-data',
				data: { type: 'FeatureCollection', features: [...features] },
				pickable: true,
				stroked: true,
				filled: true,
				pointType: 'circle',
				getFillColor: geojsonFillColor as any,
				getLineColor: geojsonLineColor as any,
				getPointRadius: 6,
				getLineWidth: 2.5,
				lineWidthMinPixels: 1.5,
				pointRadiusMinPixels: 4,
				pointRadiusMaxPixels: 12,
				autoHighlight: true,
				highlightColor: [255, 255, 255, 100],
				onClick: (info: any) => {
					if (info.object?.properties) {
						selectedFeature = { ...info.object.properties };
						showAttributes = true;
					}
				}
			})
		]
	});
	mapRef?.triggerRepaint();
}

function onMapReady(map: maplibregl.Map) {
	if (!deckModules) return;
	mapRef = map;

	const { MapboxOverlay } = deckModules;
	overlay = new MapboxOverlay({
		interleaved: false,
		layers: []
	});
	map.addControl(overlay as any);
	resolveMapReady?.();

	if (bounds) map.fitBounds(bounds, { padding: 40 });
}
</script>

<div class="relative flex h-full overflow-hidden">
	{#if loading}
		<div class="flex flex-1 items-center justify-center">
			<p class="text-sm text-zinc-400">{t('map.loadingFgb')}</p>
		</div>
	{:else if error && featureCount === 0}
		<div class="flex flex-1 items-center justify-center">
			<p class="text-sm text-red-400">{error}</p>
		</div>
	{:else}
		<div class="flex-1">
			<MapContainer {onMapReady} {bounds} />
		</div>

		<!-- Floating feature count badge + load-all button -->
		<div class="absolute left-2 top-2 z-10 flex flex-col gap-1">
			<div
				class="pointer-events-none rounded bg-card/80 px-2 py-1 text-xs text-card-foreground backdrop-blur-sm"
			>
				{#if streaming}
					<span class="animate-pulse">
						{featureCount.toLocaleString()} features...
					</span>
				{:else if featureCount > 0}
					{featureCount.toLocaleString()} features{#if totalFeatures && featureCount >= FEATURE_LIMIT}
						<span class="text-amber-300">
							of {totalFeatures.toLocaleString()} (limit)
						</span>
					{/if}
				{/if}
			</div>
			{#if hasMore && !streaming}
				<button
					class="rounded bg-primary/90 px-2 py-1 text-xs text-primary-foreground backdrop-blur-sm hover:bg-primary"
					onclick={loadAllFeatures}
				>
					Stream up to {Math.min(totalFeatures ?? FEATURE_LIMIT, FEATURE_LIMIT).toLocaleString()}
				</button>
			{/if}
		</div>

		<!-- Floating toggle buttons -->
		<div class="absolute right-2 top-2 z-10 flex gap-1">
			{#if headerInfo}
				<button
					class="rounded bg-card/80 px-2 py-1 text-xs text-card-foreground backdrop-blur-sm hover:bg-card"
					class:ring-1={showInfo}
					class:ring-primary={showInfo}
					onclick={() => (showInfo = !showInfo)}
				>
					{t('map.info')}
				</button>
			{/if}
			{#if selectedFeature}
				<button
					class="rounded bg-card/80 px-2 py-1 text-xs text-card-foreground backdrop-blur-sm hover:bg-card"
					class:ring-1={showAttributes}
					class:ring-primary={showAttributes}
					onclick={() => (showAttributes = !showAttributes)}
				>
					{t('map.attributes')}
				</button>
			{/if}
		</div>

		{#if showInfo && headerInfo}
			<div
				class="absolute right-2 top-10 z-10 max-h-[70vh] w-64 overflow-auto rounded bg-card/90 p-3 text-xs text-card-foreground backdrop-blur-sm"
			>
				<h3 class="mb-2 font-medium">{t('map.flatgeobufInfo')}</h3>
				<dl class="space-y-1.5">
					{#if headerInfo.title}
						<dt class="text-muted-foreground">{t('mapInfo.title')}</dt>
						<dd>{headerInfo.title}</dd>
					{/if}
					{#if headerInfo.description}
						<dt class="text-muted-foreground">{t('mapInfo.description')}</dt>
						<dd class="opacity-80">{headerInfo.description}</dd>
					{/if}
					<dt class="text-muted-foreground">{t('mapInfo.geometryType')}</dt>
					<dd>{headerInfo.geometryType}</dd>
					<dt class="text-muted-foreground">{t('mapInfo.totalFeatures')}</dt>
					<dd>{headerInfo.featuresCount.toLocaleString()}</dd>
					<dt class="text-muted-foreground">{t('mapInfo.spatialIndex')}</dt>
					<dd>{headerInfo.hasIndex ? t('mapInfo.yesRTree') : t('mapInfo.no')}</dd>
					{#if headerInfo.crs}
						<dt class="text-muted-foreground">{t('mapInfo.crs')}</dt>
						<dd>
							{#if headerInfo.crs.org && headerInfo.crs.code}
								{headerInfo.crs.org}:{headerInfo.crs.code}
							{/if}
							{#if headerInfo.crs.name}
								({headerInfo.crs.name})
							{/if}
						</dd>
					{/if}
					{#if headerInfo.columns.length > 0}
						<dt class="text-muted-foreground">{t('mapInfo.columns')} ({headerInfo.columns.length})</dt>
						{#each headerInfo.columns as col}
							<dd class="ms-2 opacity-80">- {col.name}</dd>
						{/each}
					{/if}
				</dl>
			</div>
		{/if}

		<AttributeTable
			feature={selectedFeature}
			visible={showAttributes}
			onClose={() => (showAttributes = false)}
		/>
	{/if}
</div>
