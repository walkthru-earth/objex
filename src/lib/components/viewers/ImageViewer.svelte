<script lang="ts">
import OpenSeadragon from 'openseadragon';
import { onDestroy } from 'svelte';
import { getAdapter } from '$lib/storage/index.js';
import type { Tab } from '$lib/types';

let { tab }: { tab: Tab } = $props();

const mimeMap: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	avif: 'image/avif',
	svg: 'image/svg+xml',
	bmp: 'image/bmp',
	ico: 'image/x-icon'
};

let containerEl: HTMLDivElement | undefined = $state();
let objectUrl = $state<string | null>(null);
let loading = $state(true);
let error = $state<string | null>(null);
let viewer: OpenSeadragon.Viewer | null = null;
let isSvg = $derived(tab.extension.toLowerCase() === 'svg');
let rotation = $state(0);
let zoom = $state(1);

$effect(() => {
	if (!tab || !containerEl) return;
	loadImage();
});

async function loadImage() {
	loading = true;
	error = null;
	cleanup();

	try {
		const adapter = getAdapter(tab.source, tab.connectionId);
		const data = await adapter.read(tab.path);
		const ext = tab.extension.toLowerCase();
		const mime = mimeMap[ext] || 'application/octet-stream';
		const blob = new Blob([data as unknown as BlobPart], { type: mime });
		objectUrl = URL.createObjectURL(blob);

		if (!isSvg && containerEl) {
			viewer = OpenSeadragon({
				element: containerEl,
				tileSources: {
					type: 'image',
					url: objectUrl
				},
				showNavigationControl: false,
				animationTime: 0.3,
				minZoomLevel: 0.1,
				maxZoomLevel: 20,
				visibilityRatio: 0.5,
				constrainDuringPan: false
			});
		}
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	} finally {
		loading = false;
	}
}

function zoomIn() {
	if (isSvg) {
		zoom = Math.min(zoom * 1.5, 10);
		return;
	}
	if (viewer) viewer.viewport.zoomBy(1.5);
}

function zoomOut() {
	if (isSvg) {
		zoom = Math.max(zoom / 1.5, 0.1);
		return;
	}
	if (viewer) viewer.viewport.zoomBy(0.667);
}

function fitView() {
	if (isSvg) {
		zoom = 1;
		return;
	}
	if (viewer) viewer.viewport.goHome();
}

function rotate() {
	rotation = (rotation + 90) % 360;
	if (viewer) viewer.viewport.setRotation(rotation);
}

function fullscreen() {
	if (viewer) viewer.setFullScreen(true);
}

function cleanup() {
	if (viewer) {
		viewer.destroy();
		viewer = null;
	}
	if (objectUrl) {
		URL.revokeObjectURL(objectUrl);
		objectUrl = null;
	}
}

onDestroy(cleanup);
</script>

<div class="flex h-full flex-col">
	<div
		class="flex items-center gap-2 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800"
	>
		<span class="text-sm font-medium text-zinc-700 dark:text-zinc-300">{tab.name}</span>
		<span
			class="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
		>
			{tab.extension.toUpperCase()}
		</span>

		<div class="ml-auto flex items-center gap-1">
			<button
				class="rounded p-1.5 text-xs text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
				onclick={zoomIn} title="Zoom In">+</button>
			<button
				class="rounded p-1.5 text-xs text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
				onclick={zoomOut} title="Zoom Out">-</button>
			<button
				class="rounded p-1.5 text-xs text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
				onclick={fitView} title="Fit">Fit</button>
			<button
				class="rounded p-1.5 text-xs text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
				onclick={rotate} title="Rotate">Rotate</button>
			{#if !isSvg}
				<button
					class="rounded p-1.5 text-xs text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
					onclick={fullscreen} title="Fullscreen">Fullscreen</button>
			{/if}
		</div>
	</div>

	<div class="relative flex-1 overflow-hidden bg-zinc-100 dark:bg-zinc-900">
		{#if loading}
			<div class="flex h-full items-center justify-center">
				<p class="text-sm text-zinc-400">Loading image...</p>
			</div>
		{:else if error}
			<div class="flex h-full items-center justify-center">
				<p class="text-sm text-red-400">{error}</p>
			</div>
		{:else if isSvg && objectUrl}
			<div class="flex h-full items-center justify-center overflow-auto">
				<img
					src={objectUrl}
					alt={tab.name}
					style="transform: scale({zoom}) rotate({rotation}deg); transition: transform 0.2s;"
					class="max-h-full max-w-full object-contain"
				/>
			</div>
		{:else}
			<div bind:this={containerEl} class="h-full w-full"></div>
		{/if}
	</div>
</div>
