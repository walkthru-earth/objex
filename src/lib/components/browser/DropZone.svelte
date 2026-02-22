<script lang="ts">
import UploadCloudIcon from '@lucide/svelte/icons/upload-cloud';
import type { Snippet } from 'svelte';
import { t } from '$lib/i18n/index.svelte.js';
import { browser } from '$lib/stores/browser.svelte.js';
import { safeLock } from '$lib/stores/safelock.svelte.js';

let { children }: { children: Snippet } = $props();

let dragOver = $state(false);
let dragCounter = 0;

let active = $derived(browser.canWrite && !safeLock.locked);

function handleDragEnter(e: DragEvent) {
	if (!active) return;
	e.preventDefault();
	dragCounter++;
	dragOver = true;
}

function handleDragLeave(e: DragEvent) {
	if (!active) return;
	e.preventDefault();
	dragCounter--;
	if (dragCounter <= 0) {
		dragOver = false;
		dragCounter = 0;
	}
}

function handleDragOver(e: DragEvent) {
	if (!active) return;
	e.preventDefault();
}

async function handleDrop(e: DragEvent) {
	if (!active) return;
	e.preventDefault();
	dragOver = false;
	dragCounter = 0;

	const droppedFiles = e.dataTransfer?.files;
	if (!droppedFiles || droppedFiles.length === 0) return;

	const files: Array<{ name: string; data: Uint8Array; type?: string }> = [];

	for (const file of droppedFiles) {
		const buffer = await file.arrayBuffer();
		files.push({
			name: file.name,
			data: new Uint8Array(buffer),
			type: file.type || undefined
		});
	}

	try {
		await browser.uploadFiles(files);
	} catch (err) {
		console.error('Drop upload failed:', err);
	}
}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="relative h-full"
	ondragenter={handleDragEnter}
	ondragleave={handleDragLeave}
	ondragover={handleDragOver}
	ondrop={handleDrop}
>
	{@render children()}

	{#if dragOver && active}
		<div
			class="absolute inset-0 z-50 flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-primary/50 bg-primary/5 backdrop-blur-sm"
		>
			<UploadCloudIcon class="size-10 text-primary/70" />
			<p class="text-sm font-medium text-primary/70">{t('dropZone.message')}</p>
		</div>
	{/if}
</div>
