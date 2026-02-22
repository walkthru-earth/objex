<script lang="ts">
import { geojson as fgbGeojson } from 'flatgeobuf';
import type maplibregl from 'maplibre-gl';
import { untrack } from 'svelte';
import { t } from '$lib/i18n/index.svelte.js';
import type { Tab } from '$lib/types';
import { createDeckOverlay, loadDeckModules } from '$lib/utils/deck.js';
import { buildHttpsUrl } from '$lib/utils/url.js';
import AttributeTable from './map/AttributeTable.svelte';
import MapContainer from './map/MapContainer.svelte';

let { tab }: { tab: Tab } = $props();

const FEATURE_LIMIT = 100_000;

let loading = $state(true);
let error = $state<string | null>(null);
let featureCount = $state(0);
let totalFeatures = $state<number | null>(null);
let selectedFeature = $state<Record<string, any> | null>(null);
let showAttributes = $state(false);
let showInfo = $state(false);
let bounds = $state<[number, number, number, number] | undefined>();

let deckState: {
	modules: { MapboxOverlay: any; GeoJsonLayer: any };
	data: GeoJSON.FeatureCollection;
} | null = null;

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

$effect(() => {
	if (!tab) return;
	const _tabId = tab.id;
	untrack(() => {
		loadFlatGeobuf();
	});
});

async function loadFlatGeobuf() {
	loading = true;
	error = null;

	try {
		const [fgbResult, deckModules] = await Promise.all([fetchFeatures(), loadDeckModules()]);

		if (!fgbResult) return;

		deckState = {
			modules: deckModules,
			data: fgbResult.geojson
		};

		featureCount = fgbResult.geojson.features.length;
		bounds = fgbResult.bounds ?? undefined;
		loading = false;
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
		loading = false;
	}
}

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

async function fetchFeatures() {
	const { deserialize } = fgbGeojson;
	const url = buildHttpsUrl(tab);

	const features: GeoJSON.Feature[] = [];
	let minLng = Infinity,
		minLat = Infinity,
		maxLng = -Infinity,
		maxLat = -Infinity;

	const iter = deserialize(url, undefined, (header) => {
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

		// Use envelope from header if available
		if (header.envelope && header.envelope.length >= 4) {
			minLng = header.envelope[0];
			minLat = header.envelope[1];
			maxLng = header.envelope[2];
			maxLat = header.envelope[3];
		}
	});

	for await (const feature of iter) {
		features.push(feature as GeoJSON.Feature);
		if (features.length >= FEATURE_LIMIT) break;
	}

	if (features.length === 0) {
		error = 'No features found in FlatGeobuf file';
		loading = false;
		return null;
	}

	// If bounds weren't set from header envelope, compute from features
	if (minLng === Infinity) {
		for (const f of features) {
			processCoords((f.geometry as any)?.coordinates);
		}
	}

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

	const geojson: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features };
	const hasBounds = minLng !== Infinity;

	return {
		geojson,
		bounds: hasBounds
			? ([minLng, minLat, maxLng, maxLat] as [number, number, number, number])
			: null
	};
}

function onMapReady(map: maplibregl.Map) {
	if (!deckState) return;

	const overlay = createDeckOverlay(deckState.modules, {
		layerId: 'flatgeobuf-data',
		data: deckState.data,
		fillColor: [16, 185, 129, 77],
		lineColor: [16, 185, 129, 200],
		onClick: (props) => {
			selectedFeature = props;
			showAttributes = true;
		}
	});

	map.addControl(overlay as any);
}
</script>

<div class="relative flex h-full overflow-hidden">
	{#if loading}
		<div class="flex flex-1 items-center justify-center">
			<p class="text-sm text-zinc-400">{t('map.loadingFgb')}</p>
		</div>
	{:else if error}
		<div class="flex flex-1 items-center justify-center">
			<p class="text-sm text-red-400">{error}</p>
		</div>
	{:else}
		<div class="flex-1">
			<MapContainer {onMapReady} {bounds} />
		</div>

		<!-- Floating feature count badge -->
		{#if featureCount > 0}
			<div
				class="pointer-events-none absolute left-2 top-2 rounded bg-card/80 px-2 py-1 text-xs text-card-foreground backdrop-blur-sm"
			>
				{featureCount.toLocaleString()} features{#if totalFeatures && featureCount >= FEATURE_LIMIT}
					<span class="text-amber-300">
						of {totalFeatures.toLocaleString()} (limit)
					</span>
				{/if}
			</div>
		{/if}

		<!-- Floating info toggle -->
		{#if headerInfo}
			<button
				class="absolute right-12 top-2 rounded bg-card/80 px-2 py-1 text-xs text-card-foreground backdrop-blur-sm hover:bg-card"
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
				class="absolute right-2 top-2 rounded bg-card/80 px-2 py-1 text-xs text-card-foreground backdrop-blur-sm hover:bg-card"
				class:ring-1={showAttributes}
				class:ring-primary={showAttributes}
				onclick={() => (showAttributes = !showAttributes)}
			>
				{t('map.attributes')}
			</button>
		{/if}

		{#if showInfo && headerInfo}
			<div
				class="absolute right-2 top-10 max-h-[80vh] w-64 overflow-auto rounded bg-card/90 p-3 text-xs text-card-foreground backdrop-blur-sm"
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

		<AttributeTable feature={selectedFeature} visible={showAttributes} />
	{/if}
</div>
