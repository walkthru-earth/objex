<script lang="ts">
import EllipsisVerticalIcon from '@lucide/svelte/icons/ellipsis-vertical';
import MaximizeIcon from '@lucide/svelte/icons/maximize';
import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
import { onDestroy } from 'svelte';
import { Badge } from '$lib/components/ui/badge/index.js';
import { Button } from '$lib/components/ui/button/index.js';
import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
import { Separator } from '$lib/components/ui/separator/index.js';
import { t } from '$lib/i18n/index.svelte.js';
import { getAdapter } from '$lib/storage/index.js';
import { tabResources } from '$lib/stores/tab-resources.svelte.js';
import type { Tab } from '$lib/types';
import {
	createModelScene,
	disposeModelScene,
	loadModel,
	type ModelScene
} from '$lib/utils/model3d';

let { tab }: { tab: Tab } = $props();

let canvasEl: HTMLCanvasElement | undefined = $state();
let modelScene: ModelScene | null = null;
let loading = $state(true);
let error = $state<string | null>(null);
let meshCount = $state(0);
let vertexCount = $state(0);
let wireframe = $state(false);

$effect(() => {
	if (canvasEl) loadModelFile();
});

async function loadModelFile() {
	loading = true;
	error = null;

	try {
		if (!canvasEl) return;

		modelScene = createModelScene(canvasEl);

		const adapter = getAdapter(tab.source, tab.connectionId);
		const data = await adapter.read(tab.path);
		const info = await loadModel(modelScene.scene, modelScene.camera, data, tab.extension);
		meshCount = info.meshCount;
		vertexCount = info.vertexCount;
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	} finally {
		loading = false;
	}
}

function toggleWireframe() {
	wireframe = !wireframe;
	if (modelScene) {
		for (const mesh of modelScene.scene.meshes) {
			if (mesh.material) {
				mesh.material.wireframe = wireframe;
			}
		}
	}
}

function resetCamera() {
	if (modelScene) {
		modelScene.camera.alpha = Math.PI / 4;
		modelScene.camera.beta = Math.PI / 3;
	}
}

function fullscreen() {
	canvasEl?.requestFullscreen?.();
}

function cleanup() {
	if (modelScene) {
		disposeModelScene(modelScene);
		modelScene = null;
	}
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
		<Badge variant="secondary">{t('model.badge')}</Badge>

		{#if meshCount > 0}
			<span class="hidden text-xs text-zinc-400 sm:inline">
				{meshCount} {t('model.meshes')} &middot; {vertexCount.toLocaleString()} {t('model.vertices')}
			</span>
		{/if}

		<div class="ms-auto flex items-center gap-1">
			<!-- Desktop controls -->
			<div class="hidden items-center gap-1 sm:flex">
				<Button
					variant="ghost"
					size="sm"
					class="h-7 px-2 text-xs {wireframe ? 'text-blue-500' : ''}"
					onclick={toggleWireframe}
				>
					{t('model.wireframe')}
				</Button>
				<Button variant="ghost" size="sm" class="h-7 px-1.5" onclick={resetCamera} title={t('model.reset')}>
					<RotateCcwIcon class="size-3.5" />
				</Button>
				<Button variant="ghost" size="sm" class="h-7 px-1.5" onclick={fullscreen} title={t('model.fullscreen')}>
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
						<DropdownMenu.Item onclick={toggleWireframe}>
							{t('model.wireframe')} {wireframe ? '✓' : ''}
						</DropdownMenu.Item>
						<DropdownMenu.Item onclick={resetCamera}>{t('model.reset')}</DropdownMenu.Item>
						<DropdownMenu.Item onclick={fullscreen}>{t('model.fullscreen')}</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			</div>
		</div>
	</div>

	<div class="relative flex-1 overflow-hidden">
		{#if loading}
			<div class="absolute inset-0 z-10 flex items-center justify-center bg-zinc-900/80">
				<p class="text-sm text-zinc-400">{t('model.loading')}</p>
			</div>
		{/if}
		{#if error}
			<div class="absolute inset-0 z-10 flex items-center justify-center bg-zinc-900/80">
				<p class="text-sm text-red-400">{error}</p>
			</div>
		{/if}
		<canvas bind:this={canvasEl} class="h-full w-full"></canvas>
	</div>
</div>
