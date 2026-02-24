<script lang="ts">
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { onDestroy } from 'svelte';
import { settings } from '$lib/stores/settings.svelte.js';

const MAP_STYLES = {
	light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
	dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
};

const RTL_PLUGIN_URL =
	'https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.3.0/dist/mapbox-gl-rtl-text.js';

// Register RTL text plugin once (idempotent)
if (
	typeof window !== 'undefined' &&
	(!maplibregl.getRTLTextPluginStatus || maplibregl.getRTLTextPluginStatus() === 'unavailable')
) {
	maplibregl.setRTLTextPlugin(RTL_PLUGIN_URL, true).catch((err) => {
		console.warn('RTL text plugin failed to load:', err);
	});
}

let {
	onMapReady,
	style,
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

const resolvedStyle = $derived(style ?? MAP_STYLES[settings.resolved]);

let containerEl: HTMLDivElement | undefined = $state();
let map: maplibregl.Map | null = null;
let currentStyleUrl: string | maplibregl.StyleSpecification | null = null;
let currentZoom = $state(2);

$effect(() => {
	if (containerEl && !map) {
		map = new maplibregl.Map({
			container: containerEl,
			style: resolvedStyle,
			center,
			zoom
		});

		currentStyleUrl = resolvedStyle;

		map.addControl(
			new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }),
			'bottom-right'
		);

		currentZoom = map.getZoom();
		map.on('zoom', () => {
			if (map) currentZoom = map.getZoom();
		});

		map.on('load', () => {
			if (map) onMapReady(map);
		});
	}
});

// React to bounds changes — data may load after the map is ready.
// Also handles initial bounds that arrive before or during map load.
let prevBoundsKey = '';
$effect(() => {
	if (!bounds || !map) return;
	const key = bounds.join(',');
	if (key === prevBoundsKey) return;
	prevBoundsKey = key;
	const [minX, minY, maxX, maxY] = bounds;
	if (minX >= -180 && maxX <= 180 && minY >= -90 && maxY <= 90) {
		map.fitBounds(bounds, { padding: 40 });
	} else {
		console.warn('[MapContainer] Bounds outside WGS84 range, skipping fitBounds:', bounds);
	}
});

// React to theme changes — swap basemap style
$effect(() => {
	const newStyle = resolvedStyle;
	if (map && currentStyleUrl !== newStyle && !style) {
		currentStyleUrl = newStyle;
		map.setStyle(newStyle);
	}
});

onDestroy(() => {
	map?.remove();
	map = null;
});
</script>

<div class="relative h-full w-full">
	<div bind:this={containerEl} class="h-full w-full"></div>
	<!-- Zoom level indicator — positioned above nav controls -->
	<div
		class="pointer-events-none absolute bottom-[10rem] right-[10px] z-10 flex size-[29px] items-center justify-center rounded-full border border-zinc-300 bg-white shadow-sm dark:border-zinc-600 dark:bg-zinc-800"
	>
		<span class="text-[10px] font-semibold tabular-nums text-zinc-600 dark:text-zinc-300">
			{currentZoom.toFixed(1)}
		</span>
	</div>
</div>
