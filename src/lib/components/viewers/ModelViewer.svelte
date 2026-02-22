<script lang="ts">
import { onDestroy } from 'svelte';
import { getAdapter } from '$lib/storage/index.js';
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

onDestroy(() => {
	if (modelScene) {
		disposeModelScene(modelScene);
		modelScene = null;
	}
});
</script>

<div class="flex h-full flex-col">
	<div
		class="flex items-center gap-2 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800"
	>
		<span class="text-sm font-medium text-zinc-700 dark:text-zinc-300">{tab.name}</span>
		<span
			class="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
		>
			3D
		</span>

		{#if meshCount > 0}
			<span class="text-xs text-zinc-400">
				{meshCount} meshes · {vertexCount.toLocaleString()} vertices
			</span>
		{/if}

		<div class="ml-auto flex items-center gap-1">
			<button
				class="rounded px-2 py-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
				class:text-blue-500={wireframe}
				class:text-zinc-400={!wireframe}
				onclick={toggleWireframe}
			>
				Wireframe
			</button>
			<button
				class="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
				onclick={resetCamera}
			>
				Reset
			</button>
			<button
				class="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
				onclick={fullscreen}
			>
				Fullscreen
			</button>
		</div>
	</div>

	<div class="relative flex-1 overflow-hidden">
		{#if loading}
			<div class="absolute inset-0 z-10 flex items-center justify-center bg-zinc-900/80">
				<p class="text-sm text-zinc-400">Loading 3D model...</p>
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
