<script lang="ts">
import LocateIcon from '@lucide/svelte/icons/locate';
import type maplibregl from 'maplibre-gl';
import { onDestroy } from 'svelte';
import { buildDuckDbSource } from '$lib/file-icons/index.js';
import { t } from '$lib/i18n/index.svelte.js';
import type { MapQueryResult, SchemaField } from '$lib/query/engine';
import { getQueryEngine, type MapQueryHandle, QueryCancelledError } from '$lib/query/index.js';
import { settings } from '$lib/stores/settings.svelte.js';
import { tabResources } from '$lib/stores/tab-resources.svelte.js';
import type { Tab } from '$lib/types';
import {
	buildSelectionLayer,
	createGeoArrowOverlay,
	hoverCursor,
	loadGeoArrowModules
} from '$lib/utils/deck.js';
import {
	buildGeoArrowTables,
	type GeoArrowGeomType,
	type GeoArrowResult
} from '$lib/utils/geoarrow.js';
import { buildDuckDbUrl } from '$lib/utils/url.js';
import { findGeoColumn, parseWKB } from '$lib/utils/wkb.js';
import LoadProgress, { type ProgressEntry } from './LoadProgress.svelte';
import AttributeTable from './map/AttributeTable.svelte';
import MapContainer from './map/MapContainer.svelte';

let {
	tab,
	schema,
	mapData = null,
	sourceCrs = null,
	knownGeomType = undefined,
	metadataBounds = null,
	isCustomQuery = false,
	progressEntries = []
}: {
	tab: Tab;
	schema: SchemaField[];
	mapData?: MapQueryResult | null;
	sourceCrs?: string | null;
	knownGeomType?: GeoArrowGeomType;
	metadataBounds?: [number, number, number, number] | null;
	isCustomQuery?: boolean;
	progressEntries?: ProgressEntry[];
} = $props();

let loading = $state(true);
let error = $state<string | null>(null);
let featureCount = $state(0);
let selectedFeature = $state<Record<string, any> | null>(null);
let showAttributes = $state(false);
let bounds = $state<[number, number, number, number] | undefined>();

let firstFeatureCoord = $state<[number, number] | null>(null);

let mapQueryHandle: MapQueryHandle | null = null;

let geoArrowState: {
	modules: Record<string, any>;
	geoArrowResults: GeoArrowResult[];
} | null = null;
let overlayRef: any = null;
let dataLayersRef: any[] = [];
let mapRef: maplibregl.Map | null = null;
let wkbArraysRef: Uint8Array[] = [];

/** Drill into nested coordinate arrays to find the first [lng, lat] pair. */
function extractFirstCoord(coords: any): [number, number] | null {
	if (!Array.isArray(coords) || coords.length === 0) return null;
	if (typeof coords[0] === 'number') return [coords[0] as number, coords[1] as number];
	return extractFirstCoord(coords[0]);
}

function flyToFirstFeature() {
	if (!mapRef || !firstFeatureCoord) return;
	mapRef.flyTo({ center: firstFeatureCoord, zoom: 14 });
}

$effect(() => {
	if (!tab || schema.length === 0) return;
	loadGeoData();
});

function cleanup() {
	if (mapQueryHandle) {
		mapQueryHandle.cancel();
		mapQueryHandle = null;
	}
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
	wkbArraysRef = [];
}

$effect(() => {
	const id = tab.id;
	const unregister = tabResources.register(id, cleanup);
	return unregister;
});
onDestroy(cleanup);

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

		// Keep WKB ref for selection highlight (no copy — same typed arrays)
		wkbArraysRef = result.wkbArrays;

		// Convert WKB → GeoArrow Arrow Tables (zero-copy direct binary read)
		// Pass knownGeomType from metadata to skip classification pass
		const geoArrowResults = buildGeoArrowTables(result.wkbArrays, result.attributes, knownGeomType);

		if (geoArrowResults.length === 0) {
			error = t('map.noData');
			loading = false;
			return;
		}

		geoArrowState = { modules, geoArrowResults };
		featureCount = geoArrowResults.reduce((sum, r) => sum + r.table.numRows, 0);
		// Use metadata bounds if available (no client-side computation needed)
		bounds = metadataBounds ?? geoArrowResults[0].bounds;

		// Extract first feature coordinate for fly-to
		if (result.wkbArrays.length > 0) {
			const parsed = parseWKB(result.wkbArrays[0]);
			if (parsed) firstFeatureCoord = extractFirstCoord(parsed.coordinates);
		}

		loading = false;
	} catch (err) {
		if (err instanceof QueryCancelledError) {
			// Silent cancellation — user switched tabs or cancelled
			loading = false;
			return;
		}
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
	const baseSql = `SELECT * FROM ${source} LIMIT ${settings.featureLimit}`;
	const connId = tab.connectionId ?? '';

	const engine = await getQueryEngine();

	// Detect CRS if not already provided by parent (standalone map loading)
	let crs = sourceCrs;
	if (crs === null) {
		crs = await engine.detectCrs(connId, fileUrl, geoCol);
	}

	if (engine.queryForMapCancellable) {
		const handle = engine.queryForMapCancellable(connId, baseSql, geoCol, geomColType, crs);
		mapQueryHandle = handle;
		try {
			return await handle.result;
		} finally {
			mapQueryHandle = null;
		}
	}

	return engine.queryForMap(connId, baseSql, geoCol, geomColType, crs);
}

function onMapReady(map: maplibregl.Map) {
	if (!geoArrowState) return;
	mapRef = map;

	const { modules, geoArrowResults } = geoArrowState;
	const GeoJsonLayer = modules.GeoJsonLayer;

	const { overlay, layers: dataLayers } = createGeoArrowOverlay(modules, {
		layerId: 'geoarrow-data',
		geoArrowResults,
		onHover: hoverCursor(map),
		onClick: (props, sourceIndex) => {
			selectedFeature = props;
			showAttributes = true;
			// Reconstruct GeoJSON Feature from WKB for selection highlight
			const wkb = wkbArraysRef[sourceIndex];
			if (wkb) {
				const geom = parseWKB(wkb);
				if (geom) {
					const selLayer = buildSelectionLayer(GeoJsonLayer, {
						type: 'Feature',
						geometry: geom as GeoJSON.Geometry,
						properties: {}
					});
					if (selLayer) {
						overlay.setProps({ layers: [...dataLayers, selLayer] });
					}
				}
			}
		}
	});

	dataLayersRef = dataLayers;
	overlayRef = overlay;

	map.addControl(overlay as any);
}
</script>

<div class="relative flex h-full overflow-hidden">
	{#if loading}
		<LoadProgress stage={t('map.loadingGeometry')} entries={progressEntries} />
	{:else if error}
		<div class="flex flex-1 items-center justify-center">
			<p class="text-sm text-red-400">{error}</p>
		</div>
	{:else}
		<div class="flex-1">
			<MapContainer {onMapReady} {bounds} />
		</div>

		<!-- Floating feature count badge + fly-to -->
		{#if featureCount > 0}
			<div
				class="absolute left-2 top-2 z-10 flex items-center gap-1"
			>
				<div
					class="pointer-events-none rounded bg-card/80 px-2 py-1 text-xs text-card-foreground backdrop-blur-sm"
				>
					{featureCount.toLocaleString()} features{#if !isCustomQuery && featureCount >= settings.featureLimit}
						<span class="text-amber-300">(limit)</span>{/if}
				</div>
				{#if firstFeatureCoord}
					<button
						class="rounded bg-card/80 p-1.5 text-card-foreground backdrop-blur-sm hover:bg-card"
						onclick={flyToFirstFeature}
						title={t('map.flyToFirst')}
					>
						<LocateIcon class="size-3.5" />
					</button>
				{/if}
			</div>
		{/if}

		<!-- Floating button group -->
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
