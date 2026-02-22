<script lang="ts">
import { MapboxOverlay } from '@deck.gl/mapbox';
import { COGLayer } from '@developmentseed/deck.gl-geotiff';
import type maplibregl from 'maplibre-gl';
import { onDestroy, untrack } from 'svelte';
import { t } from '$lib/i18n/index.svelte.js';
import type { Tab } from '$lib/types';
import { buildHttpsUrl } from '$lib/utils/url.js';
import MapContainer from './map/MapContainer.svelte';

let { tab }: { tab: Tab } = $props();

let loading = $state(true);
let error = $state<string | null>(null);
let showInfo = $state(false);
let bounds = $state<[number, number, number, number] | undefined>();
let cogInfo = $state<{
	width: number;
	height: number;
	bandCount: number;
	bounds: { west: number; south: number; east: number; north: number };
} | null>(null);

let mapRef: maplibregl.Map | null = null;
let overlayRef: any = null;

$effect(() => {
	if (!tab) return;
	const _tabId = tab.id;
	untrack(() => {
		loading = true;
		error = null;
		cogInfo = null;
		bounds = undefined;
	});
});

async function onMapReady(map: maplibregl.Map) {
	mapRef = map;

	try {
		const url = buildHttpsUrl(tab);

		const layer = new COGLayer({
			id: 'cog-layer',
			geotiff: url,
			onError: (err: Error) => {
				const msg = err?.message || String(err);
				// Detect CORS / network errors and show a helpful message
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
				return true; // mark as handled so deck.gl doesn't throw
			},
			onGeoTIFFLoad: async (tiff, { geographicBounds }) => {
				const image = await tiff.getImage();
				cogInfo = {
					width: image.getWidth(),
					height: image.getHeight(),
					bandCount: image.getSamplesPerPixel(),
					bounds: geographicBounds
				};

				const { west, south, east, north } = geographicBounds;
				bounds = [west, south, east, north];
				map.fitBounds(
					[
						[west, south],
						[east, north]
					],
					{ padding: 40, maxZoom: 18 }
				);

				loading = false;
			}
		});

		const overlay = new MapboxOverlay({
			interleaved: true,
			layers: [layer],
			onError: (err: Error) => {
				if (!error) {
					error = err?.message || String(err);
					loading = false;
				}
			}
		});
		overlayRef = overlay;

		// Wait for map to be fully loaded before adding overlay to avoid viewport null error
		if (map.loaded()) {
			map.addControl(overlay as any);
		} else {
			map.once('load', () => map.addControl(overlay as any));
		}
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
		loading = false;
	}
}

onDestroy(() => {
	if (mapRef && overlayRef) {
		try {
			mapRef.removeControl(overlayRef);
		} catch {
			// map may already be destroyed
		}
	}
	mapRef = null;
	overlayRef = null;
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
			COG {cogInfo.width} x {cogInfo.height}, {cogInfo.bandCount} band{cogInfo.bandCount !== 1 ? 's' : ''}
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
					<dd>{cogInfo.width} x {cogInfo.height}</dd>
					<dt class="text-muted-foreground">{t('mapInfo.bands')}</dt>
					<dd>{cogInfo.bandCount}</dd>
					<dt class="text-muted-foreground">{t('mapInfo.bounds')}</dt>
					<dd>
						W {cogInfo.bounds.west.toFixed(4)}, S {cogInfo.bounds.south.toFixed(4)}<br />
						E {cogInfo.bounds.east.toFixed(4)}, N {cogInfo.bounds.north.toFixed(4)}
					</dd>
				</dl>
			</div>
		{/if}
	{/if}
</div>
