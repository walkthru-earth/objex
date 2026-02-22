<script lang="ts">
import type maplibregl from 'maplibre-gl';
import { onDestroy, untrack } from 'svelte';
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
		const [{ MapboxOverlay }, { COGLayer }] = await Promise.all([
			import('@deck.gl/mapbox'),
			import('@developmentseed/deck.gl-geotiff')
		]);

		const url = buildHttpsUrl(tab);

		const layer = new COGLayer({
			id: 'cog-layer',
			geotiff: url,
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

		const overlay = new MapboxOverlay({ interleaved: true, layers: [layer] });
		overlayRef = overlay;
		map.addControl(overlay as any);
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
			class="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-2 py-1 text-xs text-white"
		>
			Loading COG...
		</div>
	{/if}

	{#if error}
		<div
			class="absolute left-2 top-2 rounded bg-red-900/80 px-2 py-1 text-xs text-red-200"
		>
			{error}
		</div>
	{/if}

	{#if cogInfo}
		<div
			class="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-2 py-1 text-xs text-white"
		>
			COG {cogInfo.width} x {cogInfo.height}, {cogInfo.bandCount} band{cogInfo.bandCount !== 1 ? 's' : ''}
		</div>

		<button
			class="absolute right-2 top-2 rounded bg-black/60 px-2 py-1 text-xs text-white hover:bg-black/80"
			class:ring-1={showInfo}
			class:ring-blue-400={showInfo}
			onclick={() => (showInfo = !showInfo)}
		>
			Info
		</button>

		{#if showInfo}
			<div
				class="absolute right-2 top-10 max-h-[80vh] w-64 overflow-auto rounded bg-black/80 p-3 text-xs text-white backdrop-blur"
			>
				<h3 class="mb-2 font-medium text-zinc-300">COG Info</h3>
				<dl class="space-y-1.5">
					<dt class="text-zinc-400">Size</dt>
					<dd>{cogInfo.width} x {cogInfo.height}</dd>
					<dt class="text-zinc-400">Bands</dt>
					<dd>{cogInfo.bandCount}</dd>
					<dt class="text-zinc-400">Bounds</dt>
					<dd>
						W {cogInfo.bounds.west.toFixed(4)}, S {cogInfo.bounds.south.toFixed(4)}<br />
						E {cogInfo.bounds.east.toFixed(4)}, N {cogInfo.bounds.north.toFixed(4)}
					</dd>
				</dl>
			</div>
		{/if}
	{/if}
</div>
