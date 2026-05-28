<script lang="ts">
import { MapboxOverlay } from '@deck.gl/mapbox';
import { handleLoadError } from '@walkthru-earth/objex-utils';
import type maplibregl from 'maplibre-gl';
import maplibreModule from 'maplibre-gl';
import { onDestroy, untrack } from 'svelte';
import { t } from '../../i18n/index.svelte.js';
import { tabResources } from '../../stores/tab-resources.svelte.js';
import type { Tab } from '../../types.js';
import { createEpsgResolver } from '../../utils/cog.js';
import { buildHttpsUrlAsync } from '../../utils/signed-url.js';
import {
	detectGeoZarr,
	ensureCodecsRegistered,
	extractZarrStoreUrl,
	type GeoZarrInfo,
	inferDims,
	type ZarrHierarchy,
	type ZarrNode
} from '../../utils/zarr.js';
import { Slider } from '../ui/slider/index.js';
import MapContainer from './map/MapContainer.svelte';

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

/** Get the relative path for a ZarrNode (strip leading slash). */
function varPath(node: ZarrNode): string {
	return node.path.replace(/^\//, '');
}

let {
	tab,
	variables,
	coords = [],
	spatialRefAttrs,
	zarrVersion = null,
	hierarchy = null
}: {
	tab: Tab;
	variables: ZarrNode[];
	coords?: ZarrNode[];
	spatialRefAttrs: Record<string, any> | null;
	zarrVersion?: number | null;
	/**
	 * Full pre-loaded hierarchy. When present, `detectGeoZarr` can short-circuit
	 * to the `@developmentseed/deck.gl-zarr` path for GeoZarr-valid stores.
	 * Non-GeoZarr stores fall through to `@carbonplan/zarr-layer`.
	 */
	hierarchy?: ZarrHierarchy | null;
} = $props();

// GeoZarr detection runs once per hierarchy so the branch decision is stable
// across selector-slider tweaks. Returns null for non-GeoZarr stores, which
// sends everything through the existing carbonplan path.
const geoZarrInfo = $derived<GeoZarrInfo | null>(hierarchy ? detectGeoZarr(hierarchy) : null);

// MapboxOverlay holder for the deck.gl-zarr path. Separate from zarrLayer so
// the two paths can be cleaned up independently.
let dsZarrOverlay: MapboxOverlay | null = null;
const dsZarrEpsg = createEpsgResolver();

let loading = $state(true);
let error = $state<string | null>(null);
let selectedVar = $state('');
let zarrLayer: any = null;
let mapRef: maplibregl.Map | null = null;
let inspectPopup: maplibregl.Popup | null = null;
let loadGen = 0;
let addAbort = new AbortController();

// Extract proj4 from spatial_ref if available
const proj4String = $derived(extractProj4(spatialRefAttrs));

// Initialize selectedVar from variables prop (store as relative path)
$effect(() => {
	if (!selectedVar && variables.length > 0) {
		selectedVar = varPath(variables[0]);
	}
});

// Build coord lookup: dimension name → coordinate variable metadata
const coordByName = $derived(new Map(coords.map((c) => [c.name, c])));

// Identify non-spatial selector dimensions for the selected variable
const selectedMeta = $derived(variables.find((v) => varPath(v) === selectedVar));
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
function detectSpatialDims(meta: ZarrNode | undefined): { lat: string; lon: string } | null {
	if (!meta?.shape) return null;
	const dimNames = meta.dims?.length ? meta.dims : inferDims(meta.name, meta.shape);
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
	meta: ZarrNode | undefined,
	coordMap: Map<string, ZarrNode>
): SelectorDim[] {
	if (!meta?.shape) return [];
	const shape = meta.shape;
	// Use real dim names when available, fall back to inferDims
	const dimNames = meta.dims?.length ? meta.dims : inferDims(meta.name, shape);
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
		if (minDate && maxDate && shape[i] >= 2) {
			const stepMs = (maxDate.getTime() - minDate.getTime()) / (shape[i] - 1);
			subDaily = stepMs < 86_400_000;
		}

		dims.push({
			name: d,
			size: shape[i],
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

		const raw = result?.[selectedVar];
		// queryData may return Array, TypedArray (Float32Array), or scalar
		const value = raw != null && typeof raw === 'object' && 'length' in raw ? raw[0] : raw;
		popup.setHTML(formatPopupHtml(value, e.lngLat));
	} catch {
		popup.setHTML(`<span class="text-xs">${t('map.noValue')}</span>`);
	}
}

/** Build the current selector object from selectorDims state. */
function buildSelector(): Record<string, any> {
	const selector: Record<string, any> = {};
	for (const d of selectorDims) {
		const fallback = d.isDatetime ? d.size - 1 : 0;
		selector[d.name] = { selected: selectorValues[d.name] ?? fallback, type: 'index' };
	}
	return selector;
}

async function onMapReady(map: maplibregl.Map) {
	mapRef = map;
	await addZarrLayer(map);
	map.on('click', handleMapClick);
}

async function addZarrLayer(map: maplibregl.Map) {
	addAbort.abort();
	addAbort = new AbortController();
	const signal = addAbort.signal;
	const gen = ++loadGen;
	loading = true;
	error = null;

	try {
		if (zarrLayer && map.getLayer(zarrLayer.id)) {
			map.removeLayer(zarrLayer.id);
		}
		if (dsZarrOverlay) {
			try {
				map.removeControl(dsZarrOverlay as unknown as maplibregl.IControl);
			} catch {
				/* already removed */
			}
			dsZarrOverlay = null;
		}

		if (geoZarrInfo) {
			const used = await tryAddGeoZarrLayer(map, gen, signal);
			if (gen !== loadGen || signal.aborted) return;
			if (used) return;
		}

		await ensureCodecsRegistered();
		if (gen !== loadGen || signal.aborted) return;
		const { ZarrLayer } = await import('@carbonplan/zarr-layer');
		if (gen !== loadGen || signal.aborted) return;

		const storeUrl = await buildStoreUrl();
		if (gen !== loadGen || signal.aborted) return;
		const selector = buildSelector();

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
					loading = false;
					// Immediately remove failed layer to prevent WebGL context corruption
					try {
						if (map.getLayer('zarr-data')) map.removeLayer('zarr-data');
					} catch {
						/* map may already be destroyed */
					}
					zarrLayer = null;
					return;
				}
				loading = state.loading;
			}
		};

		// Map spatial dimension names for @carbonplan/zarr-layer
		const spatial = detectSpatialDims(selectedMeta);
		if (!spatial && !proj4String) {
			error = 'Cannot map this variable: no spatial dimensions (lat/lon, y/x) detected';
			loading = false;
			return;
		}
		if (proj4String) {
			opts.proj4 = proj4String;
			opts.spatialDimensions = spatial ? spatial : { lat: 'y', lon: 'x' };
		} else if (spatial) {
			opts.spatialDimensions = spatial;
		}

		// Safety: warn if the array is extremely large without multiscale support.
		// A global-extent array at full resolution can trigger thousands of chunk
		// requests simultaneously, hanging the browser.
		const meta = selectedMeta;
		if (meta?.shape) {
			const dims = meta.dims?.length ? meta.dims : inferDims(meta.name, meta.shape);
			const yIdx = dims.findIndex((d) => ['y', 'lat', 'latitude'].includes(d.toLowerCase()));
			const xIdx = dims.findIndex((d) => ['x', 'lon', 'longitude'].includes(d.toLowerCase()));
			if (yIdx >= 0 && xIdx >= 0) {
				const ySize = meta.shape[yIdx];
				const xSize = meta.shape[xIdx];
				const yChunk = meta.chunks?.[yIdx] ?? ySize;
				const xChunk = meta.chunks?.[xIdx] ?? xSize;
				const yTiles = Math.ceil(ySize / yChunk);
				const xTiles = Math.ceil(xSize / xChunk);
				const totalTiles = yTiles * xTiles;
				// If more than 10 000 tiles at base resolution and no multiscale,
				// the layer will flood the browser with requests at global zoom.
				if (totalTiles > 10_000) {
					error = t('map.zarrTooLarge', {
						tiles: totalTiles.toLocaleString(),
						shape: `${ySize.toLocaleString()} × ${xSize.toLocaleString()}`
					});
					loading = false;
					return;
				}
			}
		}

		zarrLayer = new ZarrLayer(opts);
		map.addLayer(zarrLayer);
	} catch (err) {
		error = handleLoadError(err);
		loading = false;
	}
}

async function buildStoreUrl(): Promise<string> {
	const rawUrl = (await buildHttpsUrlAsync(tab)).replace(/\/+$/, '');
	return extractZarrStoreUrl(rawUrl) ?? rawUrl;
}

/**
 * Attempt to render via `@developmentseed/deck.gl-zarr`. Returns true on
 * success (carbonplan fallback is skipped), false on any setup error so the
 * caller can fall through to the legacy path. Errors thrown inside the layer
 * after setup propagate through the overlay's `onError`.
 */
async function tryAddGeoZarrLayer(
	map: maplibregl.Map,
	gen: number,
	signal: AbortSignal
): Promise<boolean> {
	if (!geoZarrInfo) return false;
	try {
		const zarrita = await import('zarrita');
		if (gen !== loadGen || signal.aborted) return false;
		const { ZarrLayer } = await import('@developmentseed/deck.gl-zarr');
		if (gen !== loadGen || signal.aborted) return false;
		const storeUrl = await buildStoreUrl();
		if (gen !== loadGen || signal.aborted) return false;
		const store = new zarrita.FetchStore(storeUrl);
		const group = await zarrita.open(store, { kind: 'group' });
		if (gen !== loadGen || signal.aborted) return false;

		const zarrInfoSnapshot = $state.snapshot(geoZarrInfo) as GeoZarrInfo;
		const layer = new ZarrLayer({
			id: `geozarr-${tab.id}`,
			node: group,
			variable: zarrInfoSnapshot.variantPath || undefined,
			selection: {},
			epsgResolver: dsZarrEpsg,
			getTileData: async (arr, options) => {
				const chunk = await zarrita.get(arr, options.sliceSpec);
				if (gen !== loadGen || signal.aborted) {
					throw new DOMException('Aborted', 'AbortError');
				}
				const data = chunk.data as unknown as ArrayLike<number> & { length: number };
				return {
					width: options.width,
					height: options.height,
					data,
					byteLength: data.length
				};
			},
			renderTile: (data) => {
				const raw = (data as unknown as { data: ArrayLike<number> & { length: number } }).data;
				if (!raw) return { image: undefined } as never;
				let clamped: Uint8ClampedArray;
				const asTyped = raw as unknown as {
					buffer?: ArrayBufferLike;
					byteOffset?: number;
					byteLength?: number;
				};
				if (
					asTyped.buffer &&
					typeof asTyped.byteOffset === 'number' &&
					typeof asTyped.byteLength === 'number'
				) {
					clamped = new Uint8ClampedArray(asTyped.buffer, asTyped.byteOffset, asTyped.byteLength);
				} else {
					clamped = new Uint8ClampedArray(raw as unknown as Uint8Array);
				}
				const img = new ImageData(
					clamped as unknown as Uint8ClampedArray<ArrayBuffer>,
					data.width,
					data.height
				);
				return { image: img };
			}
		});

		const overlay = new MapboxOverlay({
			interleaved: false,
			layers: [layer],
			onError: (err) => {
				error = err?.message || String(err);
				loading = false;
			}
		});
		dsZarrOverlay = overlay;
		map.addControl(overlay as unknown as maplibregl.IControl);
		loading = false;
		return true;
	} catch {
		// Fall back to carbonplan path on any setup failure (e.g. the store
		// looked like GeoZarr by shape but zarrita open failed, or the group
		// attrs don't actually parse). Silent by design, the caller will mount
		// carbonplan's ZarrLayer which surfaces its own errors.
		return false;
	}
}

// Re-render when selector changes
async function updateSelector() {
	if (!zarrLayer) return;
	inspectPopup?.remove();
	try {
		await zarrLayer.setSelector(buildSelector());
	} catch (err) {
		error = handleLoadError(err);
	}
}

// Re-render when variable changes
async function changeVariable() {
	if (!mapRef) return;
	inspectPopup?.remove();
	await addZarrLayer(mapRef);
}

function cleanup() {
	addAbort.abort();
	inspectPopup?.remove();
	inspectPopup = null;
	try {
		mapRef?.off('click', handleMapClick);
		if (zarrLayer && mapRef?.getLayer('zarr-data')) {
			mapRef.removeLayer('zarr-data');
		}
		if (mapRef && dsZarrOverlay) {
			mapRef.removeControl(dsZarrOverlay as unknown as maplibregl.IControl);
		}
	} catch {
		// map may already be destroyed
	}
	zarrLayer = null;
	dsZarrOverlay = null;
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
		class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-1.5"
	>
		<label class="flex items-center gap-1 text-xs text-muted-foreground">
			{t('map.variable')}
			<select
				class="rounded border border-border bg-background px-1.5 py-0.5 text-xs text-foreground"
				bind:value={selectedVar}
				onchange={changeVariable}
			>
				{#each variables as v}
					<option value={varPath(v)}>{v.name}</option>
				{/each}
			</select>
		</label>

		{#each selectorDims as dim}
			<label
				class="flex shrink-0 items-center gap-1.5 rounded border border-border px-2 py-0.5 text-xs text-muted-foreground"
				title={dimLabel(dim)}
			>
				<span class="shrink-0 font-medium text-muted-foreground">{dim.name}</span>
				<Slider
					type="single"
					min={0}
					max={dim.size - 1}
					step={1}
					value={selectorValues[dim.name] ?? 0}
					onValueChange={(v) => {
						selectorValues[dim.name] = v as number;
					}}
					onValueCommit={() => updateSelector()}
					class="w-20"
				/>
				{#if dim.isDatetime && dim.minDate && dim.maxDate}
					{@const dateVal = indexToDateStr(selectorValues[dim.name] ?? 0, dim)}
					<span class="shrink-0 tabular-nums text-muted-foreground">
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
						class="h-5 rounded border border-border bg-background px-1 text-[10px] text-muted-foreground"
					/>
				{:else}
					<span class="shrink-0 tabular-nums text-muted-foreground">{selectorValues[dim.name] ?? 0}<span class="text-muted-foreground/60">/{dim.size - 1}</span></span>
					{#if dim.dtype}
						<span class="shrink-0 text-[10px] text-zinc-400/70">{dim.dtype}</span>
					{/if}
				{/if}
			</label>
		{/each}

		{#if selectedMeta?.shape}
			<span class="ms-auto text-xs text-muted-foreground">
				{selectedMeta.dtype} [{selectedMeta.shape.join(', ')}]
			</span>
		{/if}
	</div>

	<!-- Map -->
	<div class="relative min-h-0 flex-1">
		{#if error && !loading}
			<div class="flex h-full items-center justify-center">
				<p class="max-w-md text-center text-sm text-destructive">{error}</p>
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
