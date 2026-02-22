<script lang="ts">
import type maplibregl from 'maplibre-gl';
import maplibreModule from 'maplibre-gl';
import { untrack } from 'svelte';
import { t } from '$lib/i18n/index.svelte.js';
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
			<p class="text-sm text-zinc-400">{t('map.loadingPmtiles')}</p>
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
				class="pointer-events-none absolute left-2 top-2 rounded bg-card/80 px-2 py-1 text-xs text-card-foreground backdrop-blur-sm"
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
			class="absolute right-2 top-2 rounded bg-card/80 px-2 py-1 text-xs text-card-foreground backdrop-blur-sm hover:bg-card"
			class:ring-1={showInfo}
			class:ring-primary={showInfo}
			onclick={() => (showInfo = !showInfo)}
		>
			{t('map.info')}
		</button>

		{#if showInfo && metadata}
			<div
				class="absolute right-2 top-10 max-h-[80vh] w-64 overflow-auto rounded bg-card/90 p-3 text-xs text-card-foreground backdrop-blur-sm"
			>
				<h3 class="mb-2 font-medium">{t('map.archiveInfo')}</h3>
				<dl class="space-y-1.5">
					{#if metadata.name}
						<dt class="text-muted-foreground">{t('mapInfo.name')}</dt>
						<dd>{metadata.name}</dd>
					{/if}
					{#if metadata.description}
						<dt class="text-muted-foreground">{t('mapInfo.description')}</dt>
						<dd class="opacity-80">{metadata.description}</dd>
					{/if}
					<dt class="text-muted-foreground">{t('mapInfo.specVersion')}</dt>
					<dd>v{metadata.specVersion}</dd>
					<dt class="text-muted-foreground">{t('mapInfo.tileFormat')}</dt>
					<dd>{metadata.formatLabel}</dd>
					<dt class="text-muted-foreground">{t('mapInfo.zoomRange')}</dt>
					<dd>{metadata.minZoom} - {metadata.maxZoom}</dd>
					<dt class="text-muted-foreground">{t('mapInfo.tileCompression')}</dt>
					<dd>{metadata.tileCompression}</dd>
					<dt class="text-muted-foreground">{t('mapInfo.internalCompression')}</dt>
					<dd>{metadata.internalCompression}</dd>
					<dt class="text-muted-foreground">{t('mapInfo.clustered')}</dt>
					<dd>{metadata.clustered ? t('mapInfo.yes') : t('mapInfo.no')}</dd>
					<dt class="text-muted-foreground">{t('mapInfo.addressedTiles')}</dt>
					<dd>{metadata.numAddressedTiles.toLocaleString()}</dd>
					<dt class="text-muted-foreground">{t('mapInfo.tileEntries')}</dt>
					<dd>{metadata.numTileEntries.toLocaleString()}</dd>
					<dt class="text-muted-foreground">{t('mapInfo.uniqueContents')}</dt>
					<dd>{metadata.numTileContents.toLocaleString()}</dd>
					{#if metadata.bounds}
						<dt class="text-muted-foreground">{t('mapInfo.bounds')}</dt>
						<dd class="font-mono text-[10px]">
							{metadata.bounds.map((v) => v.toFixed(4)).join(', ')}
						</dd>
					{/if}
					{#if metadata.center}
						<dt class="text-muted-foreground">{t('mapInfo.center')}</dt>
						<dd class="font-mono text-[10px]">
							{metadata.center.map((v) => v.toFixed(4)).join(', ')} (z{metadata.centerZoom})
						</dd>
					{/if}
					{#if metadata.layers.length > 0}
						<dt class="text-muted-foreground">{t('mapInfo.layers')} ({metadata.layers.length})</dt>
						{#each metadata.layers as layer}
							<dd class="ms-2 opacity-80">- {layer}</dd>
						{/each}
					{/if}
					{#if metadata.attribution}
						<dt class="text-muted-foreground">{t('mapInfo.attribution')}</dt>
						<dd class="opacity-80">{metadata.attribution}</dd>
					{/if}
					{#if metadata.version}
						<dt class="text-muted-foreground">{t('mapInfo.dataVersion')}</dt>
						<dd>{metadata.version}</dd>
					{/if}
				</dl>
			</div>
		{/if}
	{/if}
</div>
