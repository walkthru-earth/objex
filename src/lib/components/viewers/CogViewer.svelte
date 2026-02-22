<script lang="ts">
import { MapboxOverlay } from '@deck.gl/mapbox';
import { COGLayer, proj } from '@developmentseed/deck.gl-geotiff';
import type { GeoTIFF, GeoTIFFImage } from 'geotiff';
import { fromUrl } from 'geotiff';
import { toProj4 } from 'geotiff-geokeys-to-proj4';
import type maplibregl from 'maplibre-gl';
import proj4 from 'proj4';
import { onDestroy, untrack } from 'svelte';
import { t } from '$lib/i18n/index.svelte.js';
import type { Tab } from '$lib/types';
import { buildHttpsUrl } from '$lib/utils/url.js';
import MapContainer from './map/MapContainer.svelte';

/**
 * Custom GeoKeys parser using geotiff-geokeys-to-proj4.
 * Bypasses the default proj4 EPSG lookup (which fails for non-standard CRS codes
 * like EPSG:32767) by parsing GeoKeys directly into a proj4 definition string.
 */
async function geoKeysParser(
	geoKeys: Record<string, unknown>
): Promise<proj.ProjectionInfo | null> {
	try {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const projDef = toProj4(geoKeys as any);
		return {
			def: projDef.proj4,
			parsed: proj.parseCrs(projDef.proj4),
			coordinatesUnits: projDef.coordinatesUnits as proj.SupportedCrsUnit
		};
	} catch {
		return null;
	}
}

let { tab }: { tab: Tab } = $props();

// ─── State ──────────────────────────────────────────────────────
let loading = $state(true);
let error = $state<string | null>(null);
let showInfo = $state(false);
let bounds = $state<[number, number, number, number] | undefined>();
let cogInfo = $state<{
	width: number;
	height: number;
	bandCount: number;
	dataType: string;
	bounds: { west: number; south: number; east: number; north: number };
} | null>(null);

/** 'coglayer' = deck.gl COGLayer (RGB/Palette), 'overview' = custom band rendering */
let mode = $state<'coglayer' | 'overview'>('coglayer');
let bandCount = $state(0);
let rBand = $state(1);
let gBand = $state(1);
let bBand = $state(1);

let mapRef: maplibregl.Map | null = null;
let overlayRef: any = null;

/** Retained for re-rendering when bands change */
let overviewCtx: {
	overviewImage: GeoTIFFImage;
	wgs84Bounds: { west: number; south: number; east: number; north: number };
} | null = null;

// ─── Tab change reset ───────────────────────────────────────────
$effect(() => {
	if (!tab) return;
	const _tabId = tab.id;
	untrack(() => {
		loading = true;
		error = null;
		cogInfo = null;
		bounds = undefined;
		mode = 'coglayer';
		overviewCtx = null;
	});
});

// ─── Map ready ──────────────────────────────────────────────────
async function onMapReady(map: maplibregl.Map) {
	mapRef = map;

	try {
		const url = buildHttpsUrl(tab);
		const tiff = await fromUrl(url);
		const firstImage = await tiff.getImage();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const ifd = firstImage.fileDirectory as any;

		const pi = ifd.PhotometricInterpretation as number | undefined;
		const sf = ifd.SampleFormat as number[] | undefined;
		bandCount = firstImage.getSamplesPerPixel();

		// COGLayer supports: uint (SampleFormat 1) + RGB(2)/Palette(3)/CMYK(5)/YCbCr(6)/CIELab(8)
		const isUint = !sf || sf[0] === 1;
		const hasSupportedPI = pi !== undefined && pi >= 2;

		if (isUint && hasSupportedPI) {
			await setupCogLayer(map, url);
		} else {
			// Auto-select bands: first 3 for multi-band, single band tripled for grayscale
			if (bandCount >= 3) {
				rBand = 1;
				gBand = 2;
				bBand = 3;
			} else {
				rBand = 1;
				gBand = 1;
				bBand = 1;
			}
			mode = 'overview';
			await setupOverview(map, tiff, firstImage, sf);
		}
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
		loading = false;
	}
}

// ─── Path 1: deck.gl COGLayer (RGB / Palette) ──────────────────
async function setupCogLayer(map: maplibregl.Map, url: string) {
	mode = 'coglayer';

	const layer = new COGLayer({
		id: 'cog-layer',
		geotiff: url,
		geoKeysParser,
		onError: (err: Error) => {
			const msg = err?.message || String(err);
			if (
				msg.includes('Request failed') ||
				msg.includes('NetworkError') ||
				msg.includes('Failed to fetch')
			) {
				error = t('map.cogCorsError');
			} else {
				error = msg;
			}
			loading = false;
			return true;
		},
		onGeoTIFFLoad: async (tiff, { geographicBounds }) => {
			const image = await tiff.getImage();
			const { west, south, east, north } = geographicBounds;
			cogInfo = {
				width: image.getWidth(),
				height: image.getHeight(),
				bandCount: image.getSamplesPerPixel(),
				dataType: 'uint8',
				bounds: geographicBounds
			};
			bounds = [west, south, east, north];
			map.fitBounds(
				[
					[west, south],
					[east, north]
				],
				{ padding: 40, maxZoom: 18, animate: false }
			);
			loading = false;
		}
	});

	const overlay = new MapboxOverlay({
		interleaved: false,
		layers: [layer],
		onError: (err: Error) => {
			if (!error) {
				error = err?.message || String(err);
				loading = false;
			}
		}
	});
	overlayRef = overlay;

	if (map.loaded()) {
		map.addControl(overlay as any);
	} else {
		map.once('load', () => map.addControl(overlay as any));
	}
}

// ─── Path 2: Overview fallback (grayscale / float / multi-band) ─
const SAMPLE_FORMAT_LABELS: Record<number, string> = {
	1: 'uint',
	2: 'int',
	3: 'float',
	4: 'void',
	5: 'complex int',
	6: 'complex float'
};

async function setupOverview(
	map: maplibregl.Map,
	tiff: GeoTIFF,
	firstImage: GeoTIFFImage,
	sampleFormat: number[] | undefined
) {
	// Find a reasonable overview (256–1024 px wide)
	const imageCount = await tiff.getImageCount();
	let overviewImage = firstImage;
	for (let i = imageCount - 1; i >= 1; i--) {
		const img = await tiff.getImage(i);
		const w = img.getWidth();
		if (w >= 256 && w <= 1024) {
			overviewImage = img;
			break;
		}
	}

	// Compute WGS84 bounds from GeoKeys + proj4
	let west: number, south: number, east: number, north: number;
	try {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const projDef = toProj4(firstImage.getGeoKeys() as any);
		const converter = proj4(projDef.proj4, 'EPSG:4326');
		const bbox = firstImage.getBoundingBox();
		const sw = converter.forward([bbox[0], bbox[1]]);
		const ne = converter.forward([bbox[2], bbox[3]]);
		west = sw[0];
		south = sw[1];
		east = ne[0];
		north = ne[1];
	} catch {
		// Fallback: assume native CRS is already WGS84
		const bbox = firstImage.getBoundingBox();
		west = bbox[0];
		south = bbox[1];
		east = bbox[2];
		north = bbox[3];
	}

	overviewCtx = { overviewImage, wgs84Bounds: { west, south, east, north } };

	const sfVal = sampleFormat?.[0] ?? 1;
	cogInfo = {
		width: firstImage.getWidth(),
		height: firstImage.getHeight(),
		bandCount,
		dataType: SAMPLE_FORMAT_LABELS[sfVal] ?? `sf${sfVal}`,
		bounds: { west, south, east, north }
	};
	bounds = [west, south, east, north];
	map.fitBounds(
		[
			[west, south],
			[east, north]
		],
		{ padding: 40, maxZoom: 18, animate: false }
	);

	await renderBands(map);
	loading = false;
}

/**
 * Read selected bands from the overview, normalize to 0–255, and display
 * as a MapLibre image source.
 */
async function renderBands(map: maplibregl.Map) {
	if (!overviewCtx) return;
	const { overviewImage, wgs84Bounds } = overviewCtx;
	const { west, south, east, north } = wgs84Bounds;

	const ow = overviewImage.getWidth();
	const oh = overviewImage.getHeight();

	// Read 3 selected bands (0-indexed)
	const samples = [rBand - 1, gBand - 1, bBand - 1];
	const rasters = await overviewImage.readRasters({
		samples,
		interleave: false
	});

	// Normalize each band independently to 0–255
	const rgba = new Uint8ClampedArray(ow * oh * 4);
	for (let c = 0; c < 3; c++) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const band = (rasters as any)[c] as ArrayLike<number>;
		let min = Infinity;
		let max = -Infinity;
		for (let i = 0; i < band.length; i++) {
			const v = band[i];
			if (Number.isFinite(v)) {
				if (v < min) min = v;
				if (v > max) max = v;
			}
		}
		const range = max - min || 1;
		for (let i = 0; i < band.length; i++) {
			rgba[i * 4 + c] = Number.isFinite(band[i]) ? Math.round(((band[i] - min) / range) * 255) : 0;
		}
	}
	for (let i = 0; i < ow * oh; i++) rgba[i * 4 + 3] = 255;

	// Create canvas → data URL
	const canvas = document.createElement('canvas');
	canvas.width = ow;
	canvas.height = oh;
	const ctx = canvas.getContext('2d')!;
	ctx.putImageData(new ImageData(rgba, ow, oh), 0, 0);
	const dataUrl = canvas.toDataURL('image/png');

	const sourceId = 'cog-overview';
	const existing = map.getSource(sourceId) as maplibregl.ImageSource | undefined;

	if (existing) {
		existing.updateImage({
			url: dataUrl,
			coordinates: [
				[west, north],
				[east, north],
				[east, south],
				[west, south]
			]
		});
	} else {
		map.addSource(sourceId, {
			type: 'image',
			url: dataUrl,
			coordinates: [
				[west, north],
				[east, north],
				[east, south],
				[west, south]
			]
		});
		map.addLayer({
			id: 'cog-overview-layer',
			type: 'raster',
			source: sourceId,
			paint: { 'raster-opacity': 1 }
		});
	}
}

async function onBandChange() {
	if (mode !== 'overview' || !mapRef) return;
	loading = true;
	try {
		await renderBands(mapRef);
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	}
	loading = false;
}

// ─── Cleanup ────────────────────────────────────────────────────
onDestroy(() => {
	if (mapRef) {
		if (overlayRef) {
			try {
				mapRef.removeControl(overlayRef);
			} catch {
				// map may already be destroyed
			}
		}
		if (mode === 'overview') {
			try {
				if (mapRef.getLayer('cog-overview-layer')) mapRef.removeLayer('cog-overview-layer');
				if (mapRef.getSource('cog-overview')) mapRef.removeSource('cog-overview');
			} catch {
				// ignore
			}
		}
	}
	mapRef = null;
	overlayRef = null;
	overviewCtx = null;
});
</script>

<div class="relative flex h-full overflow-hidden">
	<div class="flex-1">
		<MapContainer {onMapReady} {bounds} />
	</div>

	{#if loading}
		<div
			class="pointer-events-none absolute left-2 top-2 rounded bg-card/80 px-2 py-1 text-xs text-card-foreground backdrop-blur-sm"
		>
			{t('map.loadingCog')}
		</div>
	{/if}

	{#if error}
		<div
			class="absolute left-2 top-2 max-w-sm rounded bg-red-900/80 px-2 py-1 text-xs text-red-200"
		>
			{error}
		</div>
	{/if}

	{#if cogInfo}
		<div
			class="pointer-events-none absolute left-2 top-2 rounded bg-card/80 px-2 py-1 text-xs text-card-foreground backdrop-blur-sm"
		>
			COG {cogInfo.width}&times;{cogInfo.height}, {cogInfo.bandCount}
			band{cogInfo.bandCount !== 1 ? 's' : ''}, {cogInfo.dataType}
		</div>

		<button
			class="absolute right-2 top-2 rounded bg-card/80 px-2 py-1 text-xs text-card-foreground backdrop-blur-sm hover:bg-card"
			class:ring-1={showInfo}
			class:ring-primary={showInfo}
			onclick={() => (showInfo = !showInfo)}
		>
			{t('map.info')}
		</button>

		{#if showInfo}
			<div
				class="absolute right-2 top-10 max-h-[80vh] w-64 overflow-auto rounded bg-card/90 p-3 text-xs text-card-foreground backdrop-blur-sm"
			>
				<h3 class="mb-2 font-medium">{t('map.cogInfo')}</h3>
				<dl class="space-y-1.5">
					<dt class="text-muted-foreground">{t('mapInfo.size')}</dt>
					<dd>{cogInfo.width} &times; {cogInfo.height}</dd>
					<dt class="text-muted-foreground">{t('mapInfo.bands')}</dt>
					<dd>{cogInfo.bandCount} ({cogInfo.dataType})</dd>
					<dt class="text-muted-foreground">{t('mapInfo.bounds')}</dt>
					<dd>
						W {cogInfo.bounds.west.toFixed(4)}, S {cogInfo.bounds.south.toFixed(4)}<br />
						E {cogInfo.bounds.east.toFixed(4)}, N {cogInfo.bounds.north.toFixed(4)}
					</dd>
				</dl>
			</div>
		{/if}
	{/if}

	<!-- Band selector (overview mode, multi-band) -->
	{#if mode === 'overview' && cogInfo && bandCount > 1}
		<div
			class="absolute bottom-2 left-2 flex items-center gap-2 rounded bg-card/90 px-2 py-1.5 text-xs text-card-foreground backdrop-blur-sm"
		>
			<label class="flex items-center gap-1">
				<span class="font-semibold text-red-400">R</span>
				<select
					bind:value={rBand}
					onchange={onBandChange}
					class="rounded border border-border bg-background px-1.5 py-0.5 text-xs"
				>
					{#each Array.from({ length: bandCount }, (_, i) => i + 1) as band}
						<option value={band}>{band}</option>
					{/each}
				</select>
			</label>
			<label class="flex items-center gap-1">
				<span class="font-semibold text-green-400">G</span>
				<select
					bind:value={gBand}
					onchange={onBandChange}
					class="rounded border border-border bg-background px-1.5 py-0.5 text-xs"
				>
					{#each Array.from({ length: bandCount }, (_, i) => i + 1) as band}
						<option value={band}>{band}</option>
					{/each}
				</select>
			</label>
			<label class="flex items-center gap-1">
				<span class="font-semibold text-blue-400">B</span>
				<select
					bind:value={bBand}
					onchange={onBandChange}
					class="rounded border border-border bg-background px-1.5 py-0.5 text-xs"
				>
					{#each Array.from({ length: bandCount }, (_, i) => i + 1) as band}
						<option value={band}>{band}</option>
					{/each}
				</select>
			</label>
		</div>
	{/if}
</div>
