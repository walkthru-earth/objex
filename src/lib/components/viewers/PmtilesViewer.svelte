<script lang="ts">
import type maplibregl from 'maplibre-gl';
import maplibreModule from 'maplibre-gl';
import { untrack } from 'svelte';
import type { Tab } from '$lib/types';
import {
	buildPmtilesLayers,
	getPmtilesMetadata,
	getPmtilesProtocol,
	type PmtilesMetadata
} from '$lib/utils/pmtiles';
import { buildHttpsUrl } from '$lib/utils/url.js';
import MapContainer from './map/MapContainer.svelte';

let { tab }: { tab: Tab } = $props();

let loading = $state(true);
let error = $state<string | null>(null);
let metadata = $state<PmtilesMetadata | null>(null);
let showInfo = $state(false);
let bounds = $state<[number, number, number, number] | undefined>();
let pmtilesUrl = $state('');

// Register PMTiles protocol globally (idempotent)
const protocol = getPmtilesProtocol();
maplibreModule.addProtocol('pmtiles', protocol.tile);

$effect(() => {
	if (!tab) return;
	const _tabId = tab.id;
	untrack(() => {
		loadMetadata();
	});
});

async function loadMetadata() {
	loading = true;
	error = null;

	try {
		pmtilesUrl = buildHttpsUrl(tab);
		metadata = await getPmtilesMetadata(pmtilesUrl);
		bounds = metadata.bounds ?? undefined;
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	} finally {
		loading = false;
	}
}

function onMapReady(map: maplibregl.Map) {
	if (!metadata || !pmtilesUrl) return;

	const sourceId = 'pmtiles-source';

	if (metadata.format === 'mvt') {
		map.addSource(sourceId, {
			type: 'vector',
			url: `pmtiles://${pmtilesUrl}`,
			minzoom: metadata.minZoom,
			maxzoom: metadata.maxZoom
		});

		const layers = buildPmtilesLayers(sourceId, metadata);
		for (const layer of layers) {
			map.addLayer(layer);
		}
	} else {
		// Raster tiles (png, jpeg, webp, avif)
		map.addSource(sourceId, {
			type: 'raster',
			url: `pmtiles://${pmtilesUrl}`,
			tileSize: 256
		});

		map.addLayer({
			id: 'pmtiles-raster-layer',
			type: 'raster',
			source: sourceId,
			paint: { 'raster-opacity': 0.85 }
		});
	}
}
</script>

<div class="relative flex h-full overflow-hidden">
	{#if loading}
		<div class="flex flex-1 items-center justify-center">
			<p class="text-sm text-zinc-400">Loading PMTiles...</p>
		</div>
	{:else if error}
		<div class="flex flex-1 items-center justify-center">
			<p class="text-sm text-red-400">{error}</p>
		</div>
	{:else}
		<div class="flex-1">
			<MapContainer {onMapReady} {bounds} />
		</div>

		<!-- Floating metadata badge -->
		{#if metadata}
			<div
				class="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-2 py-1 text-xs text-white"
			>
				{metadata.formatLabel} · z{metadata.minZoom}-{metadata.maxZoom}
				{#if metadata.layers.length > 0}
					· {metadata.layers.length} layer{metadata.layers.length > 1 ? 's' : ''}
				{/if}
				· {metadata.numAddressedTiles.toLocaleString()} tiles
			</div>
		{/if}

		<!-- Floating info toggle -->
		<button
			class="absolute right-2 top-2 rounded bg-black/60 px-2 py-1 text-xs text-white hover:bg-black/80"
			class:ring-1={showInfo}
			class:ring-blue-400={showInfo}
			onclick={() => (showInfo = !showInfo)}
		>
			Info
		</button>

		{#if showInfo && metadata}
			<div
				class="absolute right-2 top-10 max-h-[80vh] w-64 overflow-auto rounded bg-black/80 p-3 text-xs text-white backdrop-blur"
			>
				<h3 class="mb-2 font-medium text-zinc-300">Archive Info</h3>
				<dl class="space-y-1.5">
					{#if metadata.name}
						<dt class="text-zinc-400">Name</dt>
						<dd>{metadata.name}</dd>
					{/if}
					{#if metadata.description}
						<dt class="text-zinc-400">Description</dt>
						<dd class="text-zinc-300">{metadata.description}</dd>
					{/if}
					<dt class="text-zinc-400">Spec Version</dt>
					<dd>v{metadata.specVersion}</dd>
					<dt class="text-zinc-400">Tile Format</dt>
					<dd>{metadata.formatLabel}</dd>
					<dt class="text-zinc-400">Zoom Range</dt>
					<dd>{metadata.minZoom} - {metadata.maxZoom}</dd>
					<dt class="text-zinc-400">Tile Compression</dt>
					<dd>{metadata.tileCompression}</dd>
					<dt class="text-zinc-400">Internal Compression</dt>
					<dd>{metadata.internalCompression}</dd>
					<dt class="text-zinc-400">Clustered</dt>
					<dd>{metadata.clustered ? 'Yes' : 'No'}</dd>
					<dt class="text-zinc-400">Addressed Tiles</dt>
					<dd>{metadata.numAddressedTiles.toLocaleString()}</dd>
					<dt class="text-zinc-400">Tile Entries</dt>
					<dd>{metadata.numTileEntries.toLocaleString()}</dd>
					<dt class="text-zinc-400">Unique Contents</dt>
					<dd>{metadata.numTileContents.toLocaleString()}</dd>
					{#if metadata.bounds}
						<dt class="text-zinc-400">Bounds</dt>
						<dd class="font-mono text-[10px]">
							{metadata.bounds.map((v) => v.toFixed(4)).join(', ')}
						</dd>
					{/if}
					{#if metadata.center}
						<dt class="text-zinc-400">Center</dt>
						<dd class="font-mono text-[10px]">
							{metadata.center.map((v) => v.toFixed(4)).join(', ')} (z{metadata.centerZoom})
						</dd>
					{/if}
					{#if metadata.layers.length > 0}
						<dt class="text-zinc-400">Layers ({metadata.layers.length})</dt>
						{#each metadata.layers as layer}
							<dd class="ml-2 text-zinc-300">- {layer}</dd>
						{/each}
					{/if}
					{#if metadata.attribution}
						<dt class="text-zinc-400">Attribution</dt>
						<dd class="text-zinc-300">{metadata.attribution}</dd>
					{/if}
					{#if metadata.version}
						<dt class="text-zinc-400">Data Version</dt>
						<dd>{metadata.version}</dd>
					{/if}
				</dl>
			</div>
		{/if}
	{/if}
</div>
