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
import { loadDeckModules } from '$lib/utils/deck.js';
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
	console.log('[FGB] loadFlatGeobuf() start');
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

		console.log('[FGB] loading deck modules...');
		deckModules = await loadDeckModules();
		console.log('[FGB] deck modules loaded, waiting for map ready...');
		loading = false;
		streaming = true;

		await mapReadyPromise;
		console.log('[FGB] map ready, overlay=', !!overlay);
		if (!overlay) return;

		// Try reading header via range requests (fast: 1-2 small requests)
		// This gets us metadata + feature offset to skip the spatial index
		console.log('[FGB] reading header...');
		await readHeaderWithRangeRequests();

		// Stream features (skips index if header was read, else sequential)
		console.log('[FGB] streaming preview...');
		await streamFeatures(PREVIEW_SIZE);
	} catch (err) {
		console.error('[FGB] loadFlatGeobuf error:', err);
		if (err instanceof DOMException && err.name === 'AbortError') return;
		error = err instanceof Error ? err.message : String(err);
		loading = false;
	} finally {
		console.log('[FGB] loadFlatGeobuf() done, features:', features.length, 'error:', error);
		streaming = false;
	}
}

/**
 * Read header via range requests (fast: 1-2 small requests).
 * Stores header + feature offset for the composite stream approach.
 * Returns true if header was read successfully.
 */
async function readHeaderWithRangeRequests(): Promise<boolean> {
	const url = buildHttpsUrl(tab);
	console.log('[FGB:header] opening HttpReader for', url);

	let reader: HttpReader;
	try {
		reader = await HttpReader.open(url, false);
	} catch (e) {
		console.warn('[FGB:header] HttpReader.open failed:', e);
		return false;
	}

	const header = reader.header;
	console.log('[FGB:header] header:', {
		geometryType: header.geometryType,
		featuresCount: header.featuresCount,
		indexNodeSize: header.indexNodeSize,
		envelope: header.envelope ? Array.from(header.envelope) : null,
		columns: header.columns?.length,
		crs: header.crs
	});
	populateHeaderInfo(header);

	storedHeader = header;
	storedFeatureOffset = reader.lengthBeforeFeatures();
	console.log(
		'[FGB:header] featureOffset:',
		storedFeatureOffset,
		'(index ~',
		((storedFeatureOffset - 12) / 1024 / 1024).toFixed(1),
		'MB skipped)'
	);
	return true;
}

/**
 * Load all features — skips the spatial index using a Range request.
 */
async function loadAllFeatures() {
	console.log('[FGB] loadAllFeatures() start, overlay=', !!overlay);
	if (!overlay) return;
	hasMore = false;
	streaming = true;

	try {
		features = [];
		featureCount = 0;
		await streamFeatures();
	} catch (err) {
		console.error('[FGB] loadAllFeatures error:', err);
		if (err instanceof DOMException && err.name === 'AbortError') return;
		error = err instanceof Error ? err.message : String(err);
	} finally {
		console.log('[FGB] loadAllFeatures() done, features:', features.length);
		streaming = false;
	}
}

/**
 * Stream features sequentially.
 * If storedHeader is available, skips the index with a Range request + composite stream.
 */
async function streamFeatures(limit?: number) {
	console.log(
		'[FGB:stream] streamFeatures() start, limit=',
		limit,
		'storedHeader=',
		!!storedHeader,
		'storedFeatureOffset=',
		storedFeatureOffset
	);
	const ac = new AbortController();
	abortController = ac;
	const url = buildHttpsUrl(tab);
	const t0 = performance.now();

	let iter: AsyncGenerator;

	if (storedHeader && storedFeatureOffset > 0) {
		// Build a fake header with indexNodeSize=0 so deserializeStream skips the index
		const fakeHeaderBytes = fgbBuildHeader({
			...storedHeader,
			indexNodeSize: 0,
			envelope: null
		});
		console.log(
			'[FGB:stream] built fake header:',
			fakeHeaderBytes.length,
			'bytes, fetching Range:',
			storedFeatureOffset
		);

		// Fetch only the feature data (skip header + index)
		const featureResp = await fetch(url, {
			headers: { Range: `bytes=${storedFeatureOffset}-` },
			signal: ac.signal
		});
		console.log(
			'[FGB:stream] Range fetch status:',
			featureResp.status,
			featureResp.headers.get('content-range')
		);
		if (!featureResp.ok && featureResp.status !== 206)
			throw new Error(`HTTP ${featureResp.status}: ${featureResp.statusText}`);
		if (!featureResp.body) throw new Error('No response body');

		// Composite stream: magic + fake header (no index) + real feature data
		const compositeStream = createCompositeStream(fakeHeaderBytes, featureResp.body);
		iter = fgbGeojson.deserialize(compositeStream, undefined, (h: any) => {
			console.log('[FGB:stream] headerMetaFn called from composite stream');
			populateHeaderInfo(h);
		}) as AsyncGenerator;
	} else {
		// Regular sequential stream (non-indexed files — no index to skip)
		console.log('[FGB:stream] regular fetch (no stored header)');
		const response = await fetch(url, { signal: ac.signal });
		if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		if (!response.body) throw new Error('No response body');
		iter = fgbGeojson.deserialize(response.body, undefined, (h: any) => {
			console.log('[FGB:stream] headerMetaFn called from regular stream');
			populateHeaderInfo(h);
		}) as AsyncGenerator;
	}

	let batchCount = 0;
	let lastUpdateTime = Date.now();
	let flewToFeatures = false;

	console.log('[FGB:stream] starting iteration...');
	for await (const feature of iter) {
		if (ac.signal.aborted) return;

		const f = feature as GeoJSON.Feature;
		if (features.length === 0) {
			console.log(
				'[FGB:stream] first feature after',
				(performance.now() - t0).toFixed(0),
				'ms, type:',
				f.geometry?.type,
				'coords sample:',
				JSON.stringify(
					(f.geometry as any)?.coordinates?.[0]?.[0] ?? (f.geometry as any)?.coordinates?.[0]
				).slice(0, 80)
			);
		}
		features.push(f);
		batchCount++;

		const now = Date.now();
		if (batchCount >= BATCH_SIZE || now - lastUpdateTime > 200) {
			console.log(
				'[FGB:stream] batch update: features=',
				features.length,
				'elapsed=',
				(performance.now() - t0).toFixed(0),
				'ms'
			);
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
			console.log('[FGB:stream] hit limit', limit, '— aborting fetch to stop download');
			ac.abort();
			break;
		}
		if (features.length >= FEATURE_LIMIT) {
			console.log('[FGB:stream] hit FEATURE_LIMIT', FEATURE_LIMIT, '— aborting fetch');
			ac.abort();
			break;
		}
	}

	if (features.length === 0) {
		console.warn('[FGB:stream] no features found!');
		error = 'No features found in FlatGeobuf file';
		return;
	}

	featureCount = features.length;
	updateLayer();
	if (!flewToFeatures) flyToFeaturesBounds();
	console.log(
		'[FGB:stream] done: features=',
		features.length,
		'elapsed=',
		(performance.now() - t0).toFixed(0),
		'ms'
	);

	if (limit && features.length >= limit) {
		hasMore = totalFeatures != null && totalFeatures > features.length;
	} else {
		hasMore = false;
	}
}

/** Compute bounding box of current features and fly the map to it. */
function flyToFeaturesBounds() {
	if (!mapRef || features.length === 0) {
		console.warn('[FGB:flyTo] skipped — mapRef=', !!mapRef, 'features=', features.length);
		return;
	}
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
		console.log('[FGB:flyTo] flying to bounds:', bounds);
		mapRef.fitBounds(bounds, { padding: 40 });
	} else {
		console.warn('[FGB:flyTo] no valid coordinates found in', features.length, 'features');
	}
}

/** Create a ReadableStream: magic bytes + header bytes + feature data stream. */
function createCompositeStream(
	headerBytes: Uint8Array,
	featureStream: ReadableStream<Uint8Array>
): ReadableStream<Uint8Array> {
	const featureReader = featureStream.getReader();
	let headerSent = false;

	return new ReadableStream({
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
}

function updateLayer() {
	if (!overlay || !deckModules) {
		console.warn('[FGB:updateLayer] skipped — overlay=', !!overlay, 'deckModules=', !!deckModules);
		return;
	}
	console.log('[FGB:updateLayer] rendering', features.length, 'features');

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
				getFillColor: [232, 121, 61, 110],
				getLineColor: [230, 81, 0, 220],
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
	console.log('[FGB] onMapReady, deckModules=', !!deckModules);
	if (!deckModules) return;
	mapRef = map;

	const { MapboxOverlay } = deckModules;
	overlay = new MapboxOverlay({
		interleaved: false,
		layers: []
	});
	map.addControl(overlay as any);
	console.log('[FGB] overlay created, resolving mapReady, bounds=', bounds);
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
		<div class="absolute left-2 top-2 flex flex-col gap-1">
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
		<div class="absolute right-2 top-2 flex gap-1">
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
				class="absolute right-2 top-10 max-h-[70vh] w-64 overflow-auto rounded bg-card/90 p-3 text-xs text-card-foreground backdrop-blur-sm"
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
