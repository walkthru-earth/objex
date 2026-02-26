<script lang="ts">
import GridIcon from '@lucide/svelte/icons/grid-3x3';
import LayersIcon from '@lucide/svelte/icons/layers';
import LocateFixedIcon from '@lucide/svelte/icons/locate-fixed';
import SearchIcon from '@lucide/svelte/icons/search';
import XIcon from '@lucide/svelte/icons/x';
import type maplibregl from 'maplibre-gl';
import maplibreModule from 'maplibre-gl';
import { onDestroy } from 'svelte';
import { t } from '$lib/i18n/index.svelte.js';
import type { Tab } from '$lib/types';
import { setupSelectionLayer, updateSelection } from '$lib/utils/map-selection.js';
import { buildPmtilesLayers, getPmtilesProtocol, type PmtilesMetadata } from '$lib/utils/pmtiles';
import { layerHue } from '$lib/utils/pmtiles-tile.js';
import { buildHttpsUrl } from '$lib/utils/url.js';
import AttributeTable from '../map/AttributeTable.svelte';
import MapContainer from '../map/MapContainer.svelte';

let {
	tab,
	metadata,
	pmtilesUrl,
	onOpenInspector
}: {
	tab: Tab;
	metadata: PmtilesMetadata;
	pmtilesUrl: string;
	onOpenInspector?: (z: number, x: number, y: number) => void;
} = $props();

let mapRef: maplibregl.Map | null = null;
let selectedFeature = $state<Record<string, any> | null>(null);
let showAttributes = $state(false);
let showLayers = $state(false);
let showTileBounds = $state(false);
let inspectMode = $state(false);
let layerVisibility = $state<Record<string, boolean>>({});
let inspectPopup: maplibregl.Popup | null = null;

onDestroy(() => {
	inspectPopup?.remove();
	inspectPopup = null;
	mapRef = null;
});

// Initialize layer visibility
$effect(() => {
	const vis: Record<string, boolean> = {};
	for (const layer of metadata.layers) vis[layer] = true;
	layerVisibility = vis;
});

// Register protocol
const protocol = getPmtilesProtocol();
maplibreModule.addProtocol('pmtiles', protocol.tile);

function toggleLayer(layerName: string) {
	layerVisibility[layerName] = !layerVisibility[layerName];
	if (!mapRef) return;
	const vis = layerVisibility[layerName] ? 'visible' : 'none';
	for (const suffix of ['-fill', '-line', '-circle']) {
		const id = `${layerName}${suffix}`;
		if (mapRef.getLayer(id)) {
			mapRef.setLayoutProperty(id, 'visibility', vis);
		}
	}
}

function toggleAllLayers(on: boolean) {
	for (const layer of metadata.layers) {
		layerVisibility[layer] = on;
		if (!mapRef) continue;
		const vis = on ? 'visible' : 'none';
		for (const suffix of ['-fill', '-line', '-circle']) {
			const id = `${layer}${suffix}`;
			if (mapRef.getLayer(id)) mapRef.setLayoutProperty(id, 'visibility', vis);
		}
	}
}

function toggleTileBounds() {
	showTileBounds = !showTileBounds;
	if (mapRef) mapRef.showTileBoundaries = showTileBounds;
}

function fitBounds() {
	if (!mapRef || !metadata.bounds) return;
	mapRef.fitBounds(metadata.bounds, { padding: 40 });
}

function onMapReady(map: maplibregl.Map) {
	mapRef = map;
	if (!pmtilesUrl) return;

	const sourceId = 'pmtiles-source';

	if (metadata.format === 'mvt') {
		map.addSource(sourceId, {
			type: 'vector',
			url: `pmtiles://${pmtilesUrl}`,
			minzoom: metadata.minZoom,
			maxzoom: metadata.maxZoom
		});

		const layers = buildPmtilesLayers(sourceId, metadata);
		const layerIds: string[] = [];
		for (const layer of layers) {
			map.addLayer(layer);
			layerIds.push(layer.id!);
		}

		setupSelectionLayer(map);

		for (const layerId of layerIds) {
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

		// Feature inspect mode: show popup on hover
		map.on('mousemove', (e: any) => {
			if (!inspectMode) return;
			const features = map.queryRenderedFeatures(e.point, { layers: layerIds });
			if (features.length === 0) {
				inspectPopup?.remove();
				inspectPopup = null;
				return;
			}
			const f = features[0];
			const props = f.properties ?? {};
			const entries = Object.entries(props).slice(0, 5);
			const html = `<div class="text-xs space-y-0.5 max-w-[200px]">
				<div class="font-medium text-zinc-300">${f.sourceLayer ?? ''}</div>
				${entries.map(([k, v]) => `<div class="flex gap-1"><span class="text-zinc-500">${k}:</span> <span class="truncate">${v}</span></div>`).join('')}
				${Object.keys(props).length > 5 ? `<div class="text-zinc-500">+${Object.keys(props).length - 5} more</div>` : ''}
			</div>`;

			if (!inspectPopup) {
				inspectPopup = new maplibreModule.Popup({
					closeButton: false,
					closeOnClick: false,
					maxWidth: '220px',
					className: 'pmtiles-inspect-popup'
				});
			}
			inspectPopup.setLngLat(e.lngLat).setHTML(html).addTo(map);
		});
	} else {
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

const allVisible = $derived(metadata.layers.every((l) => layerVisibility[l]));
const noneVisible = $derived(metadata.layers.every((l) => !layerVisibility[l]));
</script>

<div class="relative flex h-full overflow-hidden">
	<div class="flex-1">
		<MapContainer {onMapReady} bounds={metadata.bounds ?? undefined} />
	</div>

	<!-- Top-left: Metadata badge -->
	{#if metadata}
		<div
			class="pointer-events-none absolute left-2 top-2 z-10 rounded bg-card/80 px-2 py-1 text-xs text-card-foreground backdrop-blur-sm"
		>
			{metadata.formatLabel} · z{metadata.minZoom}-{metadata.maxZoom}
			{#if metadata.layers.length > 0}
				· {metadata.layers.length} {metadata.layers.length > 1
					? t('map.layersPlural')
					: t('map.layers')}
			{/if}
			· {metadata.numAddressedTiles.toLocaleString()} {t('map.tiles')}
		</div>
	{/if}

	<!-- Top-right: Control buttons -->
	<div class="absolute right-2 top-2 z-10 flex gap-1">
		{#if metadata.bounds}
			<button
				class="rounded bg-card/80 p-1.5 text-card-foreground backdrop-blur-sm hover:bg-card"
				onclick={fitBounds}
				title={t('pmtiles.fitBounds')}
			>
				<LocateFixedIcon class="size-3.5" />
			</button>
		{/if}

		{#if metadata.format === 'mvt'}
			<button
				class="rounded bg-card/80 p-1.5 text-card-foreground backdrop-blur-sm hover:bg-card"
				class:ring-1={inspectMode}
				class:ring-primary={inspectMode}
				onclick={() => {
					inspectMode = !inspectMode;
					if (!inspectMode) {
						inspectPopup?.remove();
						inspectPopup = null;
					}
				}}
				title={t('pmtiles.inspectFeatures')}
			>
				<SearchIcon class="size-3.5" />
			</button>
		{/if}

		<button
			class="rounded bg-card/80 p-1.5 text-card-foreground backdrop-blur-sm hover:bg-card"
			class:ring-1={showTileBounds}
			class:ring-primary={showTileBounds}
			onclick={toggleTileBounds}
			title={t('pmtiles.showTileBounds')}
		>
			<GridIcon class="size-3.5" />
		</button>

		{#if metadata.format === 'mvt' && metadata.layers.length > 0}
			<button
				class="rounded bg-card/80 p-1.5 text-card-foreground backdrop-blur-sm hover:bg-card"
				class:ring-1={showLayers}
				class:ring-primary={showLayers}
				onclick={() => (showLayers = !showLayers)}
				title={t('pmtiles.layers')}
			>
				<LayersIcon class="size-3.5" />
			</button>
		{/if}

		{#if selectedFeature}
			<button
				class="rounded bg-card/80 px-2 py-1 text-xs text-card-foreground backdrop-blur-sm hover:bg-card"
				class:ring-1={showAttributes}
				class:ring-primary={showAttributes}
				onclick={() => (showAttributes = !showAttributes)}
			>
				{t('map.attributes')}
			</button>
		{/if}
	</div>

	<!-- Layer panel -->
	{#if showLayers}
		<div
			class="absolute right-2 top-12 z-10 max-h-[60vh] w-56 overflow-auto rounded bg-card/95 p-2 text-xs text-card-foreground shadow-lg backdrop-blur-sm"
		>
			<div class="mb-1.5 flex items-center justify-between">
				<span class="font-medium">{t('pmtiles.layers')}</span>
				<button
					class="rounded p-0.5 text-zinc-400 hover:text-zinc-200"
					onclick={() => (showLayers = false)}
				>
					<XIcon class="size-3" />
				</button>
			</div>

			<!-- All layers toggle -->
			<label class="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-zinc-800/50">
				<input
					type="checkbox"
					checked={allVisible}
					indeterminate={!allVisible && !noneVisible}
					onchange={() => toggleAllLayers(!allVisible)}
					class="size-3 accent-primary"
				/>
				<span class="text-muted-foreground">{t('pmtiles.allLayers')}</span>
			</label>

			<div class="my-1 border-t border-zinc-700/50"></div>

			{#each metadata.layers as layer, i}
				<label
					class="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-zinc-800/50"
				>
					<input
						type="checkbox"
						checked={layerVisibility[layer]}
						onchange={() => toggleLayer(layer)}
						class="size-3 accent-primary"
					/>
					<span
						class="inline-block size-2.5 shrink-0 rounded-sm"
						style="background: hsl({layerHue(i)}, 70%, 55%)"
					></span>
					<span class="truncate">{layer}</span>
				</label>
			{/each}
		</div>
	{/if}

	<AttributeTable
		feature={selectedFeature}
		visible={showAttributes}
		onClose={() => (showAttributes = false)}
	/>
</div>

<style>
	:global(.pmtiles-inspect-popup .maplibregl-popup-content) {
		background: rgba(24, 24, 27, 0.92);
		color: #e4e4e7;
		border-radius: 6px;
		padding: 6px 8px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
		border: 1px solid rgba(63, 63, 70, 0.5);
	}
	:global(.pmtiles-inspect-popup .maplibregl-popup-tip) {
		border-top-color: rgba(24, 24, 27, 0.92);
	}
</style>
