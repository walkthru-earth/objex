<script lang="ts">
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { onDestroy } from 'svelte';

let {
	onMapReady,
	style = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
	center = [0, 20] as [number, number],
	zoom = 2,
	bounds
}: {
	onMapReady: (map: maplibregl.Map) => void;
	style?: string | maplibregl.StyleSpecification;
	center?: [number, number];
	zoom?: number;
	bounds?: [number, number, number, number];
} = $props();

let containerEl: HTMLDivElement | undefined = $state();
let map: maplibregl.Map | null = null;

$effect(() => {
	if (containerEl && !map) {
		map = new maplibregl.Map({
			container: containerEl,
			style,
			center,
			zoom
		});

		map.addControl(new maplibregl.NavigationControl(), 'top-right');

		map.on('load', () => {
			if (bounds && map) {
				map.fitBounds(bounds, { padding: 40 });
			}
			if (map) onMapReady(map);
		});
	}
});

onDestroy(() => {
	map?.remove();
	map = null;
});
</script>

<div bind:this={containerEl} class="h-full w-full"></div>
