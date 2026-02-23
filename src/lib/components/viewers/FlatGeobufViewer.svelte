<script lang="ts">
import { geojson as fgbGeojson } from 'flatgeobuf';
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

let loading = $state(true);
let streaming = $state(false);
let error = $state<string | null>(null);
let featureCount = $state(0);
let totalFeatures = $state<number | null>(null);
let selectedFeature = $state<Record<string, any> | null>(null);
let showAttributes = $state(false);
let showInfo = $state(false);
let bounds = $state<[number, number, number, number] | undefined>();

let deckModules: { MapboxOverlay: any; GeoJsonLayer: any } | null = null;
let overlay: any = null;
let mapRef: maplibregl.Map | null = null;
let features: GeoJSON.Feature[] = [];
let abortController: AbortController | null = null;

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

/** Abort in-flight fetch + streaming and release resources. */
function cleanup() {
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
}

$effect(() => {
	if (!tab) return;
	const _tabId = tab.id;
	untrack(() => {
		loadFlatGeobuf();
	});
});

onDestroy(cleanup);

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

async function loadFlatGeobuf() {
	// Abort any previous in-flight stream before resetting state
	cleanup();

	loading = true;
	streaming = false;
	error = null;
	features = [];
	featureCount = 0;
	totalFeatures = null;
	headerInfo = null;
	bounds = undefined;

	try {
		deckModules = await loadDeckModules();
		// Show map immediately — features will stream in
		loading = false;
		streaming = true;
		await streamFeatures();
	} catch (err) {
		// Silently ignore cancellation (tab closed / tab changed)
		if (err instanceof DOMException && err.name === 'AbortError') return;
		error = err instanceof Error ? err.message : String(err);
		loading = false;
	} finally {
		streaming = false;
	}
}

async function streamFeatures() {
	const ac = new AbortController();
	abortController = ac;

	const url = buildHttpsUrl(tab);

	let minLng = Infinity,
		minLat = Infinity,
		maxLng = -Infinity,
		maxLat = -Infinity;

	const response = await fetch(url, { signal: ac.signal });
	if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
	if (!response.body) throw new Error('No response body');

	const iter = fgbGeojson.deserialize(response.body, undefined, (header) => {
		totalFeatures = header.featuresCount;
		headerInfo = {
			geometryType: GEOM_TYPE_NAMES[header.geometryType] ?? `Type ${header.geometryType}`,
			featuresCount: header.featuresCount,
			columns: (header.columns ?? []).map((c: any) => ({ name: c.name, type: c.type })),
			crs: header.crs
				? { org: header.crs.org, code: header.crs.code, name: header.crs.name }
				: null,
			title: header.title,
			description: header.description,
			hasIndex: header.indexNodeSize > 0
		};

		// Use envelope from header if available — zoom map immediately
		if (header.envelope && header.envelope.length >= 4) {
			minLng = header.envelope[0];
			minLat = header.envelope[1];
			maxLng = header.envelope[2];
			maxLat = header.envelope[3];
			bounds = [minLng, minLat, maxLng, maxLat];
		}
	});

	let batchCount = 0;

	for await (const feature of iter) {
		if (ac.signal.aborted) return;

		features.push(feature as GeoJSON.Feature);
		batchCount++;

		if (batchCount >= BATCH_SIZE) {
			featureCount = features.length;
			updateLayer();
			batchCount = 0;
			// Yield to the macrotask queue so:
			// 1. The map's `load` event can fire (creates the overlay)
			// 2. deck.gl gets an animation frame to render the current batch
			// 3. The browser can paint the feature-count badge
			await new Promise((r) => setTimeout(r, 0));
			if (ac.signal.aborted) return;
		}

		if (features.length >= FEATURE_LIMIT) break;
	}

	if (ac.signal.aborted) return;

	if (features.length === 0) {
		error = 'No features found in FlatGeobuf file';
		return;
	}

	// Compute bounds from features if header had no envelope
	if (minLng === Infinity) {
		for (const f of features) {
			processCoords((f.geometry as any)?.coordinates);
		}
		if (minLng !== Infinity) {
			bounds = [minLng, minLat, maxLng, maxLat];
		}
	}

	// Final update with all features
	featureCount = features.length;
	updateLayer();

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
	// Explicitly tell MapLibre to composite the deck.gl canvas on the next frame
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

	// If features already streamed before map was ready, render them
	if (features.length > 0) updateLayer();

	// If bounds arrived from the header before the map loaded,
	// MapContainer's load handler may have missed them — apply now
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

		<!-- Floating feature count badge -->
		<div
			class="pointer-events-none absolute left-2 top-2 rounded bg-card/80 px-2 py-1 text-xs text-card-foreground backdrop-blur-sm"
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

		<!-- Floating info toggle -->
		{#if headerInfo}
			<button
				class="absolute right-12 top-20 rounded bg-card/80 px-2 py-1 text-xs text-card-foreground backdrop-blur-sm hover:bg-card"
				class:ring-1={showInfo}
				class:ring-primary={showInfo}
				onclick={() => (showInfo = !showInfo)}
			>
				{t('map.info')}
			</button>
		{/if}

		<!-- Floating attributes toggle -->
		{#if selectedFeature}
			<button
				class="absolute right-2 top-20 rounded bg-card/80 px-2 py-1 text-xs text-card-foreground backdrop-blur-sm hover:bg-card"
				class:ring-1={showAttributes}
				class:ring-primary={showAttributes}
				onclick={() => (showAttributes = !showAttributes)}
			>
				{t('map.attributes')}
			</button>
		{/if}

		{#if showInfo && headerInfo}
			<div
				class="absolute right-2 top-28 max-h-[80vh] w-64 overflow-auto rounded bg-card/90 p-3 text-xs text-card-foreground backdrop-blur-sm"
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
