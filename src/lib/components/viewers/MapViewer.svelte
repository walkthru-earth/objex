<script lang="ts">
import type maplibregl from 'maplibre-gl';
import { onDestroy } from 'svelte';
import { t } from '$lib/i18n/index.svelte.js';
import { getAdapter } from '$lib/storage/index.js';
import { tabResources } from '$lib/stores/tab-resources.svelte.js';
import type { Tab } from '$lib/types';
import { setupSelectionLayer, updateSelection } from '$lib/utils/map-selection.js';
import AttributeTable from './map/AttributeTable.svelte';
import MapContainer from './map/MapContainer.svelte';

let { tab }: { tab: Tab } = $props();

let loading = $state(true);
let error = $state<string | null>(null);
let geojsonData = $state.raw<any>(null);
let selectedFeature = $state<Record<string, any> | null>(null);
let showAttributes = $state(false);
let bounds = $state<[number, number, number, number] | undefined>();

$effect(() => {
	if (!tab) return;
	loadGeoJson();
});

function cleanup() {
	geojsonData = null;
	selectedFeature = null;
	bounds = undefined;
}

$effect(() => {
	if (!tab) return;
	const unregister = tabResources.register(tab.id, cleanup);
	return unregister;
});

onDestroy(cleanup);

async function loadGeoJson() {
	loading = true;
	error = null;

	try {
		const adapter = getAdapter(tab.source, tab.connectionId);
		const data = await adapter.read(tab.path);
		const text = new TextDecoder().decode(data);
		geojsonData = JSON.parse(text);

		// Compute bounds from features
		if (geojsonData.bbox) {
			bounds = geojsonData.bbox as [number, number, number, number];
		} else {
			bounds = computeBounds(geojsonData);
		}
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	} finally {
		loading = false;
	}
}

function computeBounds(geojson: any): [number, number, number, number] | undefined {
	let minLng = Infinity,
		minLat = Infinity,
		maxLng = -Infinity,
		maxLat = -Infinity;
	let found = false;

	function processCoord(coord: number[]) {
		if (coord.length >= 2) {
			found = true;
			minLng = Math.min(minLng, coord[0]);
			minLat = Math.min(minLat, coord[1]);
			maxLng = Math.max(maxLng, coord[0]);
			maxLat = Math.max(maxLat, coord[1]);
		}
	}

	function processCoords(coords: any) {
		if (!coords) return;
		if (typeof coords[0] === 'number') {
			processCoord(coords);
		} else {
			for (const c of coords) processCoords(c);
		}
	}

	function processGeometry(geom: any) {
		if (!geom) return;
		if (geom.coordinates) processCoords(geom.coordinates);
		if (geom.geometries) geom.geometries.forEach(processGeometry);
	}

	if (geojson.type === 'FeatureCollection') {
		for (const f of geojson.features || []) processGeometry(f.geometry);
	} else if (geojson.type === 'Feature') {
		processGeometry(geojson.geometry);
	} else {
		processGeometry(geojson);
	}

	return found ? [minLng, minLat, maxLng, maxLat] : undefined;
}

function onMapReady(map: maplibregl.Map) {
	if (!geojsonData) return;

	map.addSource('geojson-source', {
		type: 'geojson',
		data: geojsonData
	});

	// Fill layer for polygons (orange)
	map.addLayer({
		id: 'geojson-fill',
		type: 'fill',
		source: 'geojson-source',
		filter: ['==', '$type', 'Polygon'],
		paint: {
			'fill-color': '#e8793d',
			'fill-opacity': 0.35
		}
	});

	// Outline layer for polygons (orange)
	map.addLayer({
		id: 'geojson-polygon-outline',
		type: 'line',
		source: 'geojson-source',
		filter: ['==', '$type', 'Polygon'],
		paint: {
			'line-color': '#e65100',
			'line-width': 2.5
		}
	});

	// Line layer for linestrings (teal)
	map.addLayer({
		id: 'geojson-line',
		type: 'line',
		source: 'geojson-source',
		filter: ['==', '$type', 'LineString'],
		paint: {
			'line-color': '#00838f',
			'line-width': 2.5
		}
	});

	// Circle layer for points (blue)
	map.addLayer({
		id: 'geojson-points',
		type: 'circle',
		source: 'geojson-source',
		filter: ['==', '$type', 'Point'],
		paint: {
			'circle-radius': 7,
			'circle-color': '#4285f4',
			'circle-stroke-width': 1.5,
			'circle-stroke-color': '#fff'
		}
	});

	// Selection highlight
	setupSelectionLayer(map);

	// Click handler
	for (const layerId of [
		'geojson-fill',
		'geojson-polygon-outline',
		'geojson-line',
		'geojson-points'
	]) {
		map.on('click', layerId, (e: any) => {
			if (e.features && e.features.length > 0) {
				selectedFeature = { ...e.features[0].properties };
				showAttributes = true;
				updateSelection(map, e.features[0] as GeoJSON.Feature);
			}
		});

		map.on('mouseenter', layerId, () => {
			map.getCanvas().style.cursor = 'pointer';
		});

		map.on('mouseleave', layerId, () => {
			map.getCanvas().style.cursor = '';
		});
	}
}
</script>

<div class="relative flex h-full overflow-hidden">
	{#if loading}
		<div class="flex flex-1 items-center justify-center">
			<p class="text-sm text-zinc-400">{t('map.loadingData')}</p>
		</div>
	{:else if error}
		<div class="flex flex-1 items-center justify-center">
			<p class="text-sm text-red-400">{error}</p>
		</div>
	{:else}
		<div class="flex-1">
			<MapContainer {onMapReady} {bounds} />
		</div>

		{#if selectedFeature}
			<div class="absolute right-2 top-2 z-10 flex gap-1">
				<button
					class="rounded bg-card/80 px-2 py-1 text-xs text-card-foreground backdrop-blur-sm hover:bg-card"
					class:ring-1={showAttributes}
					class:ring-primary={showAttributes}
					onclick={() => (showAttributes = !showAttributes)}
				>
					{t('map.attributes')}
				</button>
			</div>
		{/if}

		<AttributeTable
			feature={selectedFeature}
			visible={showAttributes}
			onClose={() => (showAttributes = false)}
		/>
	{/if}
</div>
