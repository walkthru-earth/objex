<script lang="ts">
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { resolveBasemap } from '@walkthru-earth/objex-utils';
import { onDestroy } from 'svelte';
import { t } from '$lib/i18n/index.svelte.js';
import { appConfig } from '$lib/stores/config.svelte.js';
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

function toMapStyle(variant: 'light' | 'dark'): string | maplibregl.StyleSpecification {
	const bm = resolveBasemap(appConfig.value, variant, settings.basemapId);
	if (!bm) return MAP_STYLES[variant];
	if (bm.type === 'raster') {
		return {
			version: 8,
			sources: {
				'objex-basemap': { type: 'raster', tiles: [bm.url], tileSize: 256 }
			},
			layers: [{ id: 'objex-basemap', type: 'raster', source: 'objex-basemap' }]
		};
	}
	return bm.url;
}

const resolvedBasemap = $derived(
	style ? undefined : resolveBasemap(appConfig.value, settings.resolved, settings.basemapId)
);
const resolvedStyle = $derived(style ?? toMapStyle(settings.resolved));
// Stable identity for style-swap comparison: a raster StyleSpecification is a
// fresh object on every derive, so compare by basemap id + variant instead.
const styleKey = $derived(
	style ? 'custom' : `${resolvedBasemap?.id ?? 'fallback'}:${settings.resolved}`
);

let containerEl: HTMLDivElement | undefined = $state();
let map: maplibregl.Map | null = null;
let currentStyleKey: string | null = null;
let currentZoom = $state(2);
let webglLost = $state(false);

function initMap() {
	if (!containerEl || map) return;
	webglLost = false;

	map = new maplibregl.Map({
		container: containerEl,
		style: resolvedStyle,
		center,
		zoom
	});

	currentStyleKey = styleKey;

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

	// Handle WebGL context loss gracefully
	const canvas = map.getCanvas();
	canvas.addEventListener('webglcontextlost', (e) => {
		e.preventDefault();
		console.warn('[MapContainer] WebGL context lost');
		webglLost = true;
	});
	canvas.addEventListener('webglcontextrestored', () => {
		console.log('[MapContainer] WebGL context restored');
		webglLost = false;
	});
}

function retryMap() {
	if (map) {
		map.remove();
		map = null;
	}
	webglLost = false;
	// Re-init on next microtask so the DOM settles
	queueMicrotask(initMap);
}

$effect(() => {
	if (containerEl && !map) {
		initMap();
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

// React to theme / basemap changes — swap basemap style
$effect(() => {
	const nextKey = styleKey;
	const nextStyle = resolvedStyle;
	if (map && currentStyleKey !== nextKey && !style) {
		currentStyleKey = nextKey;
		map.setStyle(nextStyle);
	}
});

onDestroy(() => {
	map?.remove();
	map = null;
});
</script>

<div class="relative h-full w-full" style="touch-action: pan-x pan-y;">
	<div bind:this={containerEl} class="h-full w-full" style="touch-action: none;"></div>
	<!-- Zoom level indicator — positioned above nav controls -->
	<div
		class="pointer-events-none absolute bottom-[7rem] right-[10px] z-10 flex size-[29px] items-center justify-center rounded-full border border-border bg-background shadow-sm sm:bottom-[10rem]"
	>
		<span class="text-[10px] font-semibold tabular-nums text-foreground">
			{currentZoom.toFixed(1)}
		</span>
	</div>
	{#if webglLost}
		<div class="absolute inset-0 z-20 flex items-center justify-center bg-card/80 backdrop-blur-sm">
			<div class="text-center">
				<p class="text-sm text-card-foreground">{t('map.webglLost')}</p>
				<button
					class="mt-2 rounded bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90"
					onclick={retryMap}
				>
					{t('map.retry')}
				</button>
			</div>
		</div>
	{/if}
</div>
