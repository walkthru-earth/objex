<script lang="ts">
import EllipsisVerticalIcon from '@lucide/svelte/icons/ellipsis-vertical';
import MaximizeIcon from '@lucide/svelte/icons/maximize';
import MinusIcon from '@lucide/svelte/icons/minus';
import PlusIcon from '@lucide/svelte/icons/plus';
import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
import ScanIcon from '@lucide/svelte/icons/scan';
import OpenSeadragon from 'openseadragon';
import { onDestroy } from 'svelte';
import { Badge } from '$lib/components/ui/badge/index.js';
import { Button } from '$lib/components/ui/button/index.js';
import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
import { t } from '$lib/i18n/index.svelte.js';
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
		class="flex items-center gap-1 border-b border-zinc-200 px-2 py-1.5 sm:gap-2 sm:px-4 dark:border-zinc-800"
	>
		<span class="truncate max-w-[120px] text-sm font-medium text-zinc-700 sm:max-w-none dark:text-zinc-300">{tab.name}</span>
		<Badge variant="secondary">{tab.extension.toUpperCase()}</Badge>

		<div class="ms-auto flex items-center gap-1">
			<!-- Desktop controls -->
			<div class="hidden items-center gap-1 sm:flex">
				<Button variant="ghost" size="sm" class="h-7 px-1.5" onclick={zoomIn} title={t('image.zoomIn')}>
					<PlusIcon class="size-3.5" />
				</Button>
				<Button variant="ghost" size="sm" class="h-7 px-1.5" onclick={zoomOut} title={t('image.zoomOut')}>
					<MinusIcon class="size-3.5" />
				</Button>
				<Button variant="ghost" size="sm" class="h-7 px-1.5" onclick={fitView} title={t('image.fit')}>
					<ScanIcon class="size-3.5" />
				</Button>
				<Button variant="ghost" size="sm" class="h-7 px-1.5" onclick={rotate} title={t('image.rotate')}>
					<RotateCwIcon class="size-3.5" />
				</Button>
				{#if !isSvg}
					<Button variant="ghost" size="sm" class="h-7 px-1.5" onclick={fullscreen} title={t('image.fullscreen')}>
						<MaximizeIcon class="size-3.5" />
					</Button>
				{/if}
			</div>

			<!-- Mobile overflow menu -->
			<div class="flex sm:hidden">
				<DropdownMenu.Root>
					<DropdownMenu.Trigger class="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
						<EllipsisVerticalIcon class="size-4" />
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="end" class="w-40">
						<DropdownMenu.Item onclick={zoomIn}>{t('image.zoomIn')}</DropdownMenu.Item>
						<DropdownMenu.Item onclick={zoomOut}>{t('image.zoomOut')}</DropdownMenu.Item>
						<DropdownMenu.Item onclick={fitView}>{t('image.fit')}</DropdownMenu.Item>
						<DropdownMenu.Item onclick={rotate}>{t('image.rotate')}</DropdownMenu.Item>
						{#if !isSvg}
							<DropdownMenu.Item onclick={fullscreen}>{t('image.fullscreen')}</DropdownMenu.Item>
						{/if}
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			</div>
		</div>
	</div>

	<div class="relative flex-1 overflow-hidden bg-zinc-100 dark:bg-zinc-900">
		{#if loading}
			<div class="flex h-full items-center justify-center">
				<p class="text-sm text-zinc-400">{t('image.loading')}</p>
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
