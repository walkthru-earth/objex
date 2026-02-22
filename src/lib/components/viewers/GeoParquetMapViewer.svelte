<script lang="ts">
import type maplibregl from 'maplibre-gl';
import { buildDuckDbSource } from '$lib/file-icons/index.js';
import type { SchemaField } from '$lib/query/engine';
import { getQueryEngine } from '$lib/query/index.js';
import type { Tab } from '$lib/types';
import { createGeoArrowOverlay, loadGeoArrowModules } from '$lib/utils/deck.js';
import { buildGeoArrowTable, type GeoArrowResult } from '$lib/utils/geoarrow.js';
import { buildDuckDbUrl } from '$lib/utils/url.js';
import { findGeoColumn } from '$lib/utils/wkb.js';
import AttributeTable from './map/AttributeTable.svelte';
import MapContainer from './map/MapContainer.svelte';

let { tab, schema }: { tab: Tab; schema: SchemaField[] } = $props();

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

const MAP_FEATURE_LIMIT = 100_000;

$effect(() => {
	if (!tab || schema.length === 0) return;
	loadGeoData();
});

async function loadGeoData() {
	loading = true;
	error = null;

	try {
		const geoCol = findGeoColumn(schema);
		if (!geoCol) {
			error = 'No geometry column detected in schema';
			loading = false;
			return;
		}

		// Find geometry column type from schema
		const geoField = schema.find((f) => f.name === geoCol);
		const geomColType = geoField?.type ?? 'GEOMETRY';

		const fileUrl = buildDuckDbUrl(tab);
		const source = buildDuckDbSource(tab.path, fileUrl);
		const baseSql = `SELECT * FROM ${source} LIMIT ${MAP_FEATURE_LIMIT}`;
		const connId = tab.connectionId ?? '';

		// Query DuckDB for raw WKB + attributes (parallel with module loading)
		const engine = await getQueryEngine();
		const [mapResult, modules] = await Promise.all([
			engine.queryForMap(connId, baseSql, geoCol, geomColType),
			loadGeoArrowModules()
		]);

		if (mapResult.rowCount === 0) {
			error = 'No data available for map view';
			loading = false;
			return;
		}

		// Convert WKB → GeoArrow Arrow Table
		const geoArrow = buildGeoArrowTable(
			mapResult.wkbArrays,
			mapResult.geometryType,
			mapResult.attributes
		);

		geoArrowState = { modules, geoArrow };
		featureCount = mapResult.rowCount;
		bounds = geoArrow.bounds;
		loading = false;
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
		loading = false;
	}
}

function onMapReady(map: maplibregl.Map) {
	if (!geoArrowState) return;

	const overlay = createGeoArrowOverlay(geoArrowState.modules, {
		layerId: 'geoarrow-data',
		geoArrow: geoArrowState.geoArrow,
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
			<p class="text-sm text-zinc-400">Loading geometry data...</p>
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
				class="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-2 py-1 text-xs text-white"
			>
				{featureCount.toLocaleString()} features{#if featureCount >= MAP_FEATURE_LIMIT}
					<span class="text-amber-300">(limit)</span>{/if}
			</div>
		{/if}

		<!-- Floating attributes toggle -->
		{#if selectedFeature}
			<button
				class="absolute right-2 top-2 rounded bg-black/60 px-2 py-1 text-xs text-white hover:bg-black/80"
				class:ring-1={showAttributes}
				class:ring-blue-400={showAttributes}
				onclick={() => (showAttributes = !showAttributes)}
			>
				Attributes
			</button>
		{/if}

		<AttributeTable feature={selectedFeature} visible={showAttributes} />
	{/if}
</div>
