<script lang="ts">
import type maplibregl from 'maplibre-gl';
import maplibreModule from 'maplibre-gl';
import { onDestroy, untrack } from 'svelte';
import { t } from '$lib/i18n/index.svelte.js';
import { tabResources } from '$lib/stores/tab-resources.svelte.js';
import type { Tab } from '$lib/types';
import { buildHttpsUrl } from '$lib/utils/url.js';
import { extractZarrStoreUrl, inferDims } from '$lib/utils/zarr.js';
import MapContainer from './map/MapContainer.svelte';

interface ZarrVarMeta {
	name: string;
	shape: number[];
	dtype: string;
	dims: string[];
	attributes: Record<string, any>;
}

/** Enriched selector dimension with coordinate metadata. */
interface SelectorDim {
	name: string;
	size: number;
	dtype: string | null;
	units: string | null;
	longName: string | null;
	min: string | null;
	max: string | null;
	isDatetime: boolean;
	minDate: Date | null;
	maxDate: Date | null;
	/** True when estimated step size < 1 day (e.g. 6-hourly forecasts). */
	subDaily: boolean;
}

let {
	tab,
	variables,
	coords = [],
	spatialRefAttrs,
	zarrVersion = null
}: {
	tab: Tab;
	variables: ZarrVarMeta[];
	coords?: ZarrVarMeta[];
	spatialRefAttrs: Record<string, any> | null;
	zarrVersion?: number | null;
} = $props();

let loading = $state(true);
let error = $state<string | null>(null);
let selectedVar = $state('');
let zarrLayer: any = null;
let mapRef: maplibregl.Map | null = null;
let inspectPopup: maplibregl.Popup | null = null;

// Extract proj4 from spatial_ref if available
const proj4String = $derived(extractProj4(spatialRefAttrs));

// Initialize selectedVar from variables prop
$effect(() => {
	if (!selectedVar && variables.length > 0) {
		selectedVar = variables[0].name;
	}
});

// Build coord lookup: dimension name → coordinate variable metadata
const coordByName = $derived(new Map(coords.map((c) => [c.name, c])));

// Identify non-spatial selector dimensions for the selected variable
const selectedMeta = $derived(variables.find((v) => v.name === selectedVar));
const selectorDims = $derived(getSelectorDims(selectedMeta, coordByName));

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

const DATETIME_DIM_NAMES = new Set(['time', 'init_time', 'valid_time', 'date', 'datetime']);

/** Detect timedelta/duration dimension (forecast lead time, etc.). */
function isTimedeltaDim(attrs: Record<string, any>): boolean {
	if (attrs.standard_name === 'forecast_period') return true;
	if (typeof attrs.dtype === 'string' && attrs.dtype.includes('timedelta')) return true;
	return false;
}

/** Detect temporal dimension via CF-convention signals. */
function isDatetimeDim(name: string, attrs: Record<string, any>): boolean {
	if (isTimedeltaDim(attrs)) return false;
	if (attrs.axis === 'T') return true;
	if (attrs.standard_name === 'time' || attrs.standard_name === 'forecast_reference_time')
		return true;
	if (typeof attrs.units === 'string' && /\bsince\b/i.test(attrs.units)) return true;
	if (DATETIME_DIM_NAMES.has(name.toLowerCase())) return true;
	return false;
}

/** Parse a date string, treating "present"/"now" as today's date. */
function parseDateOrSentinel(value: string): Date | null {
	const lower = value.trim().toLowerCase();
	if (lower === 'present' || lower === 'now') return new Date();
	const d = new Date(value);
	return Number.isNaN(d.getTime()) ? null : d;
}

/** Linear interpolation: index → estimated date/datetime string.
 *  Sub-daily dims return "YYYY-MM-DDTHH:mm", daily+ return "YYYY-MM-DD". */
function indexToDateStr(index: number, dim: SelectorDim): string | null {
	if (!dim.minDate || !dim.maxDate || dim.size < 2) return null;
	const t = index / (dim.size - 1);
	const ms = dim.minDate.getTime() + t * (dim.maxDate.getTime() - dim.minDate.getTime());
	const iso = new Date(ms).toISOString();
	return dim.subDaily ? iso.slice(0, 16) : iso.slice(0, 10);
}

/** Inverse: date string → nearest integer index, clamped to [0, size-1]. */
function dateToIndex(dateStr: string, dim: SelectorDim): number {
	if (!dim.minDate || !dim.maxDate || dim.size < 2) return 0;
	const range = dim.maxDate.getTime() - dim.minDate.getTime();
	if (range === 0) return 0;
	const target = new Date(dateStr).getTime();
	const t = (target - dim.minDate.getTime()) / range;
	return Math.round(Math.max(0, Math.min(dim.size - 1, t * (dim.size - 1))));
}

/** Spatial dimension name aliases → canonical ZarrLayer keys. */
const SPATIAL_ALIASES: Record<string, 'lat' | 'lon'> = {
	x: 'lon',
	y: 'lat',
	lat: 'lat',
	lon: 'lon',
	latitude: 'lat',
	longitude: 'lon'
};

/** Detect spatial dimension mapping for @carbonplan/zarr-layer. */
function detectSpatialDims(meta: ZarrVarMeta | undefined): { lat: string; lon: string } | null {
	if (!meta) return null;
	const dimNames = meta.dims.length > 0 ? meta.dims : inferDims(meta.name, meta.shape);
	let lat: string | null = null;
	let lon: string | null = null;
	for (const d of dimNames) {
		const role = SPATIAL_ALIASES[d.toLowerCase()];
		if (role === 'lat' && !lat) lat = d;
		else if (role === 'lon' && !lon) lon = d;
	}
	return lat && lon ? { lat, lon } : null;
}

function getSelectorDims(
	meta: ZarrVarMeta | undefined,
	coordMap: Map<string, ZarrVarMeta>
): SelectorDim[] {
	if (!meta) return [];
	// Use real dim names when available, fall back to inferDims
	const dimNames = meta.dims.length > 0 ? meta.dims : inferDims(meta.name, meta.shape);
	const dims: SelectorDim[] = [];
	for (let i = 0; i < dimNames.length; i++) {
		const d = dimNames[i];
		if (SPATIAL_ALIASES[d.toLowerCase()]) continue;

		const coord = coordMap.get(d);
		const attrs = coord?.attributes ?? {};

		// Extract min/max from statistics_approximate if available
		let min: string | null = null;
		let max: string | null = null;
		const stats = attrs.statistics_approximate ?? attrs.statistics;
		if (stats && typeof stats === 'object') {
			if (stats.min != null) min = String(stats.min);
			if (stats.max != null) max = String(stats.max);
		}

		// Detect datetime dimension and parse date range
		const datetime = isDatetimeDim(d, attrs);
		let minDate: Date | null = null;
		let maxDate: Date | null = null;
		if (datetime && min != null && max != null) {
			const dMin = parseDateOrSentinel(min);
			const dMax = parseDateOrSentinel(max);
			if (dMin && dMax) {
				minDate = dMin;
				maxDate = dMax;
			}
		}

		// Sub-daily: estimated step < 1 day (e.g. 6-hourly forecasts)
		let subDaily = false;
		if (minDate && maxDate && meta.shape[i] >= 2) {
			const stepMs = (maxDate.getTime() - minDate.getTime()) / (meta.shape[i] - 1);
			subDaily = stepMs < 86_400_000;
		}

		dims.push({
			name: d,
			size: meta.shape[i],
			dtype: coord?.dtype ?? null,
			units: attrs.units ?? null,
			longName: attrs.long_name ?? null,
			min,
			max,
			isDatetime: datetime,
			minDate,
			maxDate,
			subDaily
		});
	}
	return dims;
}

/** Format a dimension label: show long_name or name, with dtype. */
function dimLabel(dim: SelectorDim): string {
	const label = dim.longName ?? dim.name;
	return dim.dtype ? `${label} (${dim.dtype})` : label;
}

// Initialize selector values when variable changes
$effect(() => {
	const dims = selectorDims;
	const prev = untrack(() => selectorValues);
	const newVals: Record<string, number> = {};
	for (const d of dims) {
		newVals[d.name] = prev[d.name] ?? (d.isDatetime ? d.size - 1 : 0);
	}
	selectorValues = newVals;
});

function getOrCreatePopup(): maplibregl.Popup {
	if (!inspectPopup) {
		inspectPopup = new maplibreModule.Popup({
			closeButton: true,
			closeOnClick: false,
			maxWidth: '240px',
			className: 'zarr-inspect-popup'
		});
	}
	return inspectPopup;
}

function formatPopupHtml(value: number | null | undefined, lngLat: maplibregl.LngLat): string {
	const varName = selectedVar;
	const units = selectedMeta?.attributes?.units;
	const noData = value == null || Number.isNaN(value);

	let valueStr: string;
	if (noData) {
		valueStr = t('map.noValue');
	} else {
		valueStr = Number.isInteger(value) ? String(value) : value.toPrecision(4);
	}

	// Hide units when no data, or when units is "1" (CF dimensionless)
	const showUnits = !noData && units && units !== '1';

	const lat = lngLat.lat.toFixed(4);
	const lon = lngLat.lng.toFixed(4);

	return `<div class="text-xs space-y-0.5">
		<div class="font-medium text-zinc-300">${varName}</div>
		<div>${valueStr}${showUnits ? ` <span class="text-zinc-500">${units}</span>` : ''}</div>
		<div class="text-zinc-500">${lat}, ${lon}</div>
	</div>`;
}

async function handleMapClick(e: maplibregl.MapMouseEvent) {
	if (!zarrLayer) return;

	const popup = getOrCreatePopup();
	popup
		.setLngLat(e.lngLat)
		.setHTML(`<span class="text-xs">${t('map.loadingZarr')}</span>`)
		.addTo(mapRef!);

	try {
		const result = await zarrLayer.queryData({
			type: 'Point',
			coordinates: [e.lngLat.lng, e.lngLat.lat]
		});

		// DEBUG: inspect queryData result shape
		console.log('[zarr-inspect] result:', result);
		console.log('[zarr-inspect] keys:', result ? Object.keys(result) : 'null');
		console.log('[zarr-inspect] selectedVar:', selectedVar);
		const raw = result?.[selectedVar];
		console.log('[zarr-inspect] raw:', raw, 'type:', typeof raw, 'isArray:', Array.isArray(raw));
		// queryData may return Array, TypedArray (Float32Array), or scalar
		const value = raw != null && typeof raw === 'object' && 'length' in raw ? raw[0] : raw;
		console.log('[zarr-inspect] value:', value);
		popup.setHTML(formatPopupHtml(value, e.lngLat));
	} catch {
		popup.setHTML(`<span class="text-xs">${t('map.noValue')}</span>`);
	}
}

async function onMapReady(map: maplibregl.Map) {
	mapRef = map;
	await addZarrLayer(map);
	map.on('click', handleMapClick);
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
		// Build selector from selectorDims (datetime dims default to latest)
		const selector: Record<string, any> = {};
		for (const d of selectorDims) {
			const fallback = d.isDatetime ? d.size - 1 : 0;
			selector[d.name] = { selected: selectorValues[d.name] ?? fallback, type: 'index' };
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

		// Map spatial dimension names for @carbonplan/zarr-layer
		const spatial = detectSpatialDims(selectedMeta);
		if (proj4String) {
			opts.proj4 = proj4String;
			opts.spatialDimensions = spatial ? spatial : { lat: 'y', lon: 'x' };
		} else if (spatial) {
			opts.spatialDimensions = spatial;
		}

		zarrLayer = new ZarrLayer(opts);
		map.addLayer(zarrLayer);
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
		loading = false;
	}
}

function buildStoreUrl(): string {
	const rawUrl = buildHttpsUrl(tab).replace(/\/+$/, '');
	return extractZarrStoreUrl(rawUrl) ?? rawUrl;
}

// Re-render when selector changes
async function updateSelector() {
	if (!zarrLayer) return;
	inspectPopup?.remove();
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
	inspectPopup?.remove();
	await addZarrLayer(mapRef);
}

function cleanup() {
	inspectPopup?.remove();
	inspectPopup = null;
	try {
		mapRef?.off('click', handleMapClick);
		if (zarrLayer && mapRef?.getLayer('zarr-data')) {
			mapRef.removeLayer('zarr-data');
		}
	} catch {
		// map may already be destroyed
	}
	zarrLayer = null;
	mapRef = null;
}

$effect(() => {
	const id = tab.id;
	const unregister = tabResources.register(id, cleanup);
	return unregister;
});
onDestroy(cleanup);
</script>

<div class="flex h-full w-full flex-col overflow-hidden">
	<!-- Controls bar -->
	<div
		class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-800"
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
			<label
				class="flex shrink-0 items-center gap-1.5 rounded border border-zinc-200 px-2 py-0.5 text-xs text-zinc-400 dark:border-zinc-700"
				title={dimLabel(dim)}
			>
				<span class="shrink-0 font-medium text-zinc-500 dark:text-zinc-400">{dim.name}</span>
				<input
					type="range"
					min="0"
					max={dim.size - 1}
					value={selectorValues[dim.name] ?? 0}
					oninput={(e) => {
						selectorValues[dim.name] = +e.currentTarget.value;
					}}
					onchange={updateSelector}
					class="h-1 w-16"
				/>
				{#if dim.isDatetime && dim.minDate && dim.maxDate}
					{@const dateVal = indexToDateStr(selectorValues[dim.name] ?? 0, dim)}
					<span class="shrink-0 tabular-nums text-zinc-500">
						{dateVal ? (dim.subDaily ? dateVal.replace('T', ' ') : dateVal) : (selectorValues[dim.name] ?? 0)}
					</span>
					<input
						type={dim.subDaily ? 'datetime-local' : 'date'}
						min={dim.minDate.toISOString().slice(0, dim.subDaily ? 16 : 10)}
						max={dim.maxDate.toISOString().slice(0, dim.subDaily ? 16 : 10)}
						value={dateVal ?? ''}
						onchange={(e) => {
							const val = /** @type {HTMLInputElement} */ (e.currentTarget).value;
							if (val) {
								selectorValues[dim.name] = dateToIndex(val, dim);
								updateSelector();
							}
						}}
						class="h-5 rounded border border-zinc-300 bg-white px-1 text-[10px] text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
					/>
				{:else}
					<span class="shrink-0 tabular-nums text-zinc-500">{selectorValues[dim.name] ?? 0}<span class="text-zinc-500/60">/{dim.size - 1}</span></span>
					{#if dim.dtype}
						<span class="shrink-0 text-[10px] text-zinc-400/70">{dim.dtype}</span>
					{/if}
				{/if}
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

<style>
	:global(.zarr-inspect-popup .maplibregl-popup-content) {
		background: rgba(24, 24, 27, 0.92);
		color: #e4e4e7;
		border-radius: 6px;
		padding: 6px 8px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
		border: 1px solid rgba(63, 63, 70, 0.5);
	}
	:global(.zarr-inspect-popup .maplibregl-popup-tip) {
		border-top-color: rgba(24, 24, 27, 0.92);
	}
	:global(.zarr-inspect-popup .maplibregl-popup-close-button) {
		color: #a1a1aa;
		font-size: 14px;
		padding: 2px 4px;
	}
	:global(.zarr-inspect-popup .maplibregl-popup-close-button:hover) {
		color: #e4e4e7;
		background: transparent;
	}
</style>
