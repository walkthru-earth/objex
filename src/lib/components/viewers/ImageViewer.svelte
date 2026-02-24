<script lang="ts">
import EllipsisVerticalIcon from '@lucide/svelte/icons/ellipsis-vertical';
import MaximizeIcon from '@lucide/svelte/icons/maximize';
import MinusIcon from '@lucide/svelte/icons/minus';
import PlusIcon from '@lucide/svelte/icons/plus';
import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
import ScanIcon from '@lucide/svelte/icons/scan';
import { onDestroy } from 'svelte';
import { Badge } from '$lib/components/ui/badge/index.js';
import { Button } from '$lib/components/ui/button/index.js';
import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
import { t } from '$lib/i18n/index.svelte.js';
import { getAdapter } from '$lib/storage/index.js';
import { tabResources } from '$lib/stores/tab-resources.svelte.js';
import type { Tab } from '$lib/types';
import { buildHttpsUrl, canStreamDirectly } from '$lib/utils/url.js';

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

let { tab }: { tab: Tab } = $props();

let imgSrc = $state<string | null>(null);
let blobUrl = $state<string | null>(null);
let loading = $state(true);
let error = $state<string | null>(null);
let scale = $state(1);
let rotation = $state(0);
let panX = $state(0);
let panY = $state(0);
let dragging = $state(false);
let lastX = 0;
let lastY = 0;
let wrapperEl: HTMLDivElement | undefined = $state();

$effect(() => {
	if (!tab) return;
	loadImage();
});

async function loadImage() {
	loading = true;
	error = null;
	cleanup();
	resetView();

	try {
		if (canStreamDirectly(tab)) {
			// Direct URL — browser streams natively (no CORS needed for <img>)
			imgSrc = buildHttpsUrl(tab);
		} else {
			// Authenticated S3 — download via storage adapter
			const adapter = getAdapter(tab.source, tab.connectionId);
			const data = await adapter.read(tab.path);
			const ext = tab.extension.toLowerCase();
			const blob = new Blob([data as unknown as BlobPart], {
				type: mimeMap[ext] || 'application/octet-stream'
			});
			blobUrl = URL.createObjectURL(blob);
			imgSrc = blobUrl;
		}
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	} finally {
		loading = false;
	}
}

function resetView() {
	scale = 1;
	rotation = 0;
	panX = 0;
	panY = 0;
}

function zoomIn() {
	scale = Math.min(scale * 1.4, 20);
}

function zoomOut() {
	scale = Math.max(scale / 1.4, 0.1);
}

function fitView() {
	resetView();
}

function rotate() {
	rotation = (rotation + 90) % 360;
}

function fullscreen() {
	wrapperEl?.requestFullscreen?.();
}

function handleWheel(e: WheelEvent) {
	e.preventDefault();
	const factor = e.deltaY > 0 ? 0.9 : 1.1;
	scale = Math.max(0.1, Math.min(20, scale * factor));
}

function handlePointerDown(e: PointerEvent) {
	if (e.button !== 0) return;
	dragging = true;
	lastX = e.clientX;
	lastY = e.clientY;
	(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}

function handlePointerMove(e: PointerEvent) {
	if (!dragging) return;
	panX += e.clientX - lastX;
	panY += e.clientY - lastY;
	lastX = e.clientX;
	lastY = e.clientY;
}

function handlePointerUp() {
	dragging = false;
}

function handleDblClick() {
	if (scale !== 1 || panX !== 0 || panY !== 0) {
		resetView();
	} else {
		scale = 2;
	}
}

function cleanup() {
	if (blobUrl) {
		URL.revokeObjectURL(blobUrl);
		blobUrl = null;
	}
	imgSrc = null;
}

$effect(() => {
	const id = tab.id;
	const unregister = tabResources.register(id, cleanup);
	return unregister;
});
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
				<Button variant="ghost" size="sm" class="h-7 px-1.5" onclick={fullscreen} title={t('image.fullscreen')}>
					<MaximizeIcon class="size-3.5" />
				</Button>
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
						<DropdownMenu.Item onclick={fullscreen}>{t('image.fullscreen')}</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			</div>
		</div>
	</div>

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		bind:this={wrapperEl}
		class="relative flex flex-1 items-center justify-center overflow-hidden bg-zinc-100 dark:bg-zinc-900"
		class:cursor-grab={scale > 1 && !dragging}
		class:cursor-grabbing={dragging}
		onwheel={handleWheel}
		ondblclick={handleDblClick}
	>
		{#if loading}
			<p class="text-sm text-zinc-400">{t('image.loading')}</p>
		{:else if error}
			<p class="text-sm text-red-400">{error}</p>
		{:else if imgSrc}
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<img
				src={imgSrc}
				alt={tab.name}
				class="max-h-full max-w-full select-none"
				style="transform: translate({panX}px, {panY}px) scale({scale}) rotate({rotation}deg); transition: {dragging ? 'none' : 'transform 0.15s ease-out'};"
				draggable="false"
				onpointerdown={handlePointerDown}
				onpointermove={handlePointerMove}
				onpointerup={handlePointerUp}
			/>
		{/if}
	</div>
</div>
