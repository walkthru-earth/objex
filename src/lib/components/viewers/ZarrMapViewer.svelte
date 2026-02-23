<script lang="ts">
import type maplibregl from 'maplibre-gl';
import { onDestroy, untrack } from 'svelte';
import { t } from '$lib/i18n/index.svelte.js';
import type { Tab } from '$lib/types';
import { buildHttpsUrl } from '$lib/utils/url.js';
import MapContainer from './map/MapContainer.svelte';

interface ZarrVarMeta {
	name: string;
	shape: number[];
	dtype: string;
	dims: string[];
	attributes: Record<string, any>;
}

let {
	tab,
	variables,
	spatialRefAttrs,
	zarrVersion = null
}: {
	tab: Tab;
	variables: ZarrVarMeta[];
	spatialRefAttrs: Record<string, any> | null;
	zarrVersion?: number | null;
} = $props();

let loading = $state(true);
let error = $state<string | null>(null);
let selectedVar = $state('');
let zarrLayer: any = null;
let mapRef: maplibregl.Map | null = null;

// Extract proj4 from spatial_ref if available
const proj4String = $derived(extractProj4(spatialRefAttrs));

// Initialize selectedVar from variables prop
$effect(() => {
	if (!selectedVar && variables.length > 0) {
		selectedVar = variables[0].name;
	}
});

// Identify non-spatial selector dimensions for the selected variable
const selectedMeta = $derived(variables.find((v) => v.name === selectedVar));
const selectorDims = $derived(getSelectorDims(selectedMeta));

// Dimension slider state
let selectorValues = $state<Record<string, number>>({});

// Default colormap (viridis-ish)
const colormap = [
	[68, 1, 84],
	[72, 35, 116],
	[64, 67, 135],
	[52, 94, 141],
	[33, 145, 140],
	[94, 201, 98],
	[253, 231, 37]
];

function extractProj4(attrs: Record<string, any> | null): string | null {
	if (!attrs) return null;
	// Try common attribute names for proj4 strings
	return (
		attrs.proj4_params ||
		attrs.proj4text ||
		attrs.proj4 ||
		buildProj4FromCrsWkt(attrs.crs_wkt) ||
		null
	);
}

/** Try to build a proj4 string from crs_wkt for Lambert Conformal Conic */
function buildProj4FromCrsWkt(crsWkt: string | undefined): string | null {
	if (!crsWkt) return null;
	try {
		const lcc = crsWkt.includes('Lambert_Conformal_Conic');
		if (!lcc) return null;

		const getParam = (name: string) => {
			const m = crsWkt.match(new RegExp(`PARAMETER\\["${name}",([^\\]]+)\\]`));
			return m ? parseFloat(m[1]) : null;
		};

		const lat0 = getParam('latitude_of_origin');
		const lon0 = getParam('central_meridian');
		const lat1 = getParam('standard_parallel_1');
		const lat2 = getParam('standard_parallel_2');
		const x0 = getParam('false_easting') ?? 0;
		const y0 = getParam('false_northing') ?? 0;

		// Extract sphere radius
		const sphereMatch = crsWkt.match(/SPHEROID\["[^"]*",([^,]+)/);
		const R = sphereMatch ? parseFloat(sphereMatch[1]) : 6371229;

		if (lat0 == null || lon0 == null || lat1 == null || lat2 == null) return null;

		return `+proj=lcc +lat_1=${lat1} +lat_2=${lat2} +lat_0=${lat0} +lon_0=${lon0} +x_0=${x0} +y_0=${y0} +R=${R} +units=m +no_defs`;
	} catch {
		return null;
	}
}

function getSelectorDims(meta: ZarrVarMeta | undefined): { name: string; size: number }[] {
	if (!meta) return [];
	const spatialNames = ['x', 'y', 'lat', 'lon', 'latitude', 'longitude'];
	const dims: { name: string; size: number }[] = [];
	for (let i = 0; i < meta.dims.length; i++) {
		const d = meta.dims[i];
		if (!spatialNames.includes(d.toLowerCase())) {
			dims.push({ name: d, size: meta.shape[i] });
		}
	}
	return dims;
}

// Initialize selector values when variable changes
$effect(() => {
	const dims = selectorDims;
	const prev = untrack(() => selectorValues);
	const newVals: Record<string, number> = {};
	for (const d of dims) {
		newVals[d.name] = prev[d.name] ?? 0;
	}
	selectorValues = newVals;
});

async function onMapReady(map: maplibregl.Map) {
	mapRef = map;
	await addZarrLayer(map);
}

async function addZarrLayer(map: maplibregl.Map) {
	loading = true;
	error = null;

	try {
		// Remove existing layer
		if (zarrLayer && map.getLayer(zarrLayer.id)) {
			map.removeLayer(zarrLayer.id);
		}

		const { ZarrLayer } = await import('@carbonplan/zarr-layer');

		const storeUrl = buildStoreUrl();
		const selector: Record<string, any> = {};
		for (const [dim, val] of Object.entries(selectorValues)) {
			selector[dim] = { selected: val, type: 'index' };
		}

		const opts: any = {
			id: 'zarr-data',
			source: storeUrl,
			variable: selectedVar,
			colormap,
			clim: [0, 1], // placeholder — adjusted after loading
			opacity: 0.85,
			selector,
			version: zarrVersion,
			onLoadingStateChange: (state: any) => {
				if (state.error) {
					error = state.error.message;
				}
				loading = state.loading;
			}
		};

		// Add projection info if available
		if (proj4String) {
			opts.proj4 = proj4String;
			opts.spatialDimensions = { lat: 'y', lon: 'x' };
		}

		zarrLayer = new ZarrLayer(opts);
		map.addLayer(zarrLayer);
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
		loading = false;
	}
}

function buildStoreUrl(): string {
	const url = buildHttpsUrl(tab);
	// Strip zarr.json suffix and trailing slashes
	return url.replace(/\/zarr\.json$/, '').replace(/\/+$/, '');
}

// Re-render when selector changes
async function updateSelector() {
	if (!zarrLayer) return;
	const selector: Record<string, any> = {};
	for (const [dim, val] of Object.entries(selectorValues)) {
		selector[dim] = { selected: val, type: 'index' };
	}
	try {
		await zarrLayer.setSelector(selector);
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	}
}

// Re-render when variable changes
async function changeVariable() {
	if (!mapRef) return;
	await addZarrLayer(mapRef);
}

onDestroy(() => {
	try {
		if (zarrLayer && mapRef?.getLayer('zarr-data')) {
			mapRef.removeLayer('zarr-data');
		}
	} catch {
		// map may already be destroyed
	}
	zarrLayer = null;
	mapRef = null;
});
</script>

<div class="flex h-full w-full flex-col overflow-hidden">
	<!-- Controls bar -->
	<div
		class="flex items-center gap-2 border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800"
	>
		<label class="flex items-center gap-1 text-xs text-zinc-400">
			{t('map.variable')}
			<select
				class="rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
				bind:value={selectedVar}
				onchange={changeVariable}
			>
				{#each variables as v}
					<option value={v.name}>{v.name}</option>
				{/each}
			</select>
		</label>

		{#each selectorDims as dim}
			<label class="flex items-center gap-1 text-xs text-zinc-400">
				{dim.name}:
				<input
					type="range"
					min="0"
					max={dim.size - 1}
					bind:value={selectorValues[dim.name]}
					onchange={updateSelector}
					class="h-1 w-16"
				/>
				<span class="w-6 text-end text-zinc-500">{selectorValues[dim.name] ?? 0}</span>
			</label>
		{/each}

		{#if selectedMeta}
			<span class="ms-auto text-xs text-zinc-400">
				{selectedMeta.dtype} [{selectedMeta.shape.join(', ')}]
			</span>
		{/if}
	</div>

	<!-- Map -->
	<div class="relative min-h-0 flex-1">
		{#if error && !loading}
			<div class="flex h-full items-center justify-center">
				<p class="max-w-md text-center text-sm text-red-400">{error}</p>
			</div>
		{:else}
			<MapContainer {onMapReady} bounds={[-130, 20, -60, 55]} />
			{#if loading}
				<div
					class="pointer-events-none absolute left-2 top-2 z-10 rounded bg-card/80 px-2 py-1 text-xs text-card-foreground backdrop-blur-sm"
				>
					{t('map.loadingZarr')}
				</div>
			{/if}
		{/if}
	</div>
</div>
