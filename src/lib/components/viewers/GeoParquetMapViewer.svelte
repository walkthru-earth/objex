<script lang="ts">
import type maplibregl from 'maplibre-gl';
import { onDestroy } from 'svelte';
import { buildDuckDbSource } from '$lib/file-icons/index.js';
import { t } from '$lib/i18n/index.svelte.js';
import type { MapQueryResult, SchemaField } from '$lib/query/engine';
import { getQueryEngine } from '$lib/query/index.js';
import type { Tab } from '$lib/types';
import { createGeoArrowOverlay, loadGeoArrowModules } from '$lib/utils/deck.js';
import { buildGeoArrowTable, type GeoArrowResult } from '$lib/utils/geoarrow.js';
import { buildDuckDbUrl } from '$lib/utils/url.js';
import { findGeoColumn } from '$lib/utils/wkb.js';
import AttributeTable from './map/AttributeTable.svelte';
import MapContainer from './map/MapContainer.svelte';

let {
	tab,
	schema,
	mapData = null,
	sourceCrs = null
}: {
	tab: Tab;
	schema: SchemaField[];
	mapData?: MapQueryResult | null;
	sourceCrs?: string | null;
} = $props();

let loading = $state(true);
let error = $state<string | null>(null);
let featureCount = $state(0);
let selectedFeature = $state<Record<string, any> | null>(null);
let showAttributes = $state(false);
let bounds = $state<[number, number, number, number] | undefined>();

let geoArrowState: {
	modules: Record<string, any>;
	geoArrow: GeoArrowResult;
} | null = null;
let overlayRef: any = null;
let mapRef: maplibregl.Map | null = null;

const MAP_FEATURE_LIMIT = 100_000;

$effect(() => {
	if (!tab || schema.length === 0) return;
	loadGeoData();
});

onDestroy(() => {
	if (overlayRef && mapRef) {
		try {
			mapRef.removeControl(overlayRef);
		} catch {
			/* already removed */
		}
	}
	overlayRef = null;
	mapRef = null;
	geoArrowState = null;
});

async function loadGeoData() {
	loading = true;
	error = null;

	try {
		// Use pre-loaded map data from TableViewer (unified query) or fetch independently
		const result = mapData && mapData.rowCount > 0 ? mapData : await fetchMapData();

		if (!result || result.rowCount === 0) {
			error = t('map.noData');
			loading = false;
			return;
		}

		const modules = await loadGeoArrowModules();

		// Convert WKB → GeoArrow Arrow Table
		const geoArrow = buildGeoArrowTable(result.wkbArrays, result.geometryType, result.attributes);

		geoArrowState = { modules, geoArrow };
		featureCount = result.rowCount;
		bounds = geoArrow.bounds;
		loading = false;
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
		loading = false;
	}
}

async function fetchMapData(): Promise<MapQueryResult> {
	const geoCol = findGeoColumn(schema);
	if (!geoCol) throw new Error(t('map.noGeoColumn'));

	const geoField = schema.find((f) => f.name === geoCol);
	const geomColType = geoField?.type ?? 'GEOMETRY';

	const fileUrl = buildDuckDbUrl(tab);
	const source = buildDuckDbSource(tab.path, fileUrl);
	const baseSql = `SELECT * FROM ${source} LIMIT ${MAP_FEATURE_LIMIT}`;
	const connId = tab.connectionId ?? '';

	const engine = await getQueryEngine();

	// Detect CRS if not already provided by parent (standalone map loading)
	let crs = sourceCrs;
	if (crs === null) {
		crs = await engine.detectCrs(connId, fileUrl, geoCol);
	}

	return engine.queryForMap(connId, baseSql, geoCol, geomColType, crs);
}

function onMapReady(map: maplibregl.Map) {
	if (!geoArrowState) return;
	mapRef = map;

	const overlay = createGeoArrowOverlay(geoArrowState.modules, {
		layerId: 'geoarrow-data',
		geoArrow: geoArrowState.geoArrow,
		onClick: (props) => {
			selectedFeature = props;
			showAttributes = true;
		}
	});
	overlayRef = overlay;

	map.addControl(overlay as any);
}
</script>

<div class="relative flex h-full overflow-hidden">
	{#if loading}
		<div class="flex flex-1 items-center justify-center">
			<p class="text-sm text-zinc-400">{t('map.loadingGeometry')}</p>
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
				{featureCount.toLocaleString()} features{#if featureCount >= MAP_FEATURE_LIMIT}
					<span class="text-amber-300">(limit)</span>{/if}
			</div>
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

		<AttributeTable
			feature={selectedFeature}
			visible={showAttributes}
			onClose={() => (showAttributes = false)}
		/>
	{/if}
</div>
