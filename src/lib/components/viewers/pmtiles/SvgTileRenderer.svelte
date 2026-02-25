<script lang="ts">
import type { DecodedLayer, DecodedTile } from '$lib/utils/pmtiles-tile.js';
import { layerHue } from '$lib/utils/pmtiles-tile.js';

let {
	tile,
	visibleLayers = {},
	selectedFeatureKey = null,
	onFeatureClick
}: {
	tile: DecodedTile;
	visibleLayers?: Record<string, boolean>;
	selectedFeatureKey?: string | null;
	onFeatureClick?: (layer: string, featureIndex: number) => void;
} = $props();

const SVG_SIZE = 512;

function featureKey(layerName: string, idx: number): string {
	return `${layerName}:${idx}`;
}

function scale(layer: DecodedLayer): number {
	return SVG_SIZE / layer.extent;
}

function pointsToPath(rings: number[][][], s: number, close: boolean): string {
	return rings
		.map((ring) => {
			const pts = ring.map((p) => `${(p[0] * s).toFixed(1)},${(p[1] * s).toFixed(1)}`);
			return `M${pts.join('L')}${close ? 'Z' : ''}`;
		})
		.join('');
}

function isVisible(layerName: string): boolean {
	return visibleLayers[layerName] !== false;
}

/** Build a flat list of all layer names with their index for color assignment. */
const layerIndex = $derived(new Map(tile.layers.map((l, i) => [l.name, i])));
</script>

<svg
	viewBox="0 0 {SVG_SIZE} {SVG_SIZE}"
	class="h-full w-full rounded bg-zinc-950"
	xmlns="http://www.w3.org/2000/svg"
>
	<!-- Grid lines -->
	<g stroke="rgba(63,63,70,0.3)" stroke-width="0.5" fill="none">
		{#each [0, 128, 256, 384, 512] as v}
			<line x1={v} y1="0" x2={v} y2={SVG_SIZE} />
			<line x1="0" y1={v} x2={SVG_SIZE} y2={v} />
		{/each}
	</g>

	{#each tile.layers as layer}
		{#if isVisible(layer.name)}
			{@const s = scale(layer)}
			{@const hue = layerHue(layerIndex.get(layer.name) ?? 0)}
			<g>
				{#each layer.features as feature, fi}
					{@const key = featureKey(layer.name, fi)}
					{@const selected = key === selectedFeatureKey}
					{#if feature.type === 'Polygon'}
						<path
							d={pointsToPath(feature.geometry, s, true)}
							fill="hsla({hue}, 70%, 55%, {selected ? 0.5 : 0.25})"
							stroke="hsl({hue}, 70%, {selected ? '80%' : '45%'})"
							stroke-width={selected ? 2 : 0.8}
							class="cursor-pointer"
							role="button"
							tabindex="-1"
							onclick={() => onFeatureClick?.(layer.name, fi)}
							onkeydown={() => {}}
						/>
					{:else if feature.type === 'LineString'}
						<path
							d={pointsToPath(feature.geometry, s, false)}
							fill="none"
							stroke="hsl({hue}, 70%, {selected ? '80%' : '50%'})"
							stroke-width={selected ? 2.5 : 1.2}
							class="cursor-pointer"
							role="button"
							tabindex="-1"
							onclick={() => onFeatureClick?.(layer.name, fi)}
							onkeydown={() => {}}
						/>
					{:else if feature.type === 'Point'}
						{#each feature.geometry as ring}
							{#each ring as pt}
								<circle
									cx={(pt[0] * s).toFixed(1)}
									cy={(pt[1] * s).toFixed(1)}
									r={selected ? 5 : 3}
									fill="hsl({hue}, 70%, 55%)"
									stroke={selected ? '#ffc800' : 'white'}
									stroke-width={selected ? 2 : 0.8}
									class="cursor-pointer"
									role="button"
									tabindex="-1"
									onclick={() => onFeatureClick?.(layer.name, fi)}
									onkeydown={() => {}}
								/>
							{/each}
						{/each}
					{/if}
				{/each}
			</g>
		{/if}
	{/each}
</svg>
