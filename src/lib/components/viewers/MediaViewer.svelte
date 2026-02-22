<script lang="ts">
import { onDestroy } from 'svelte';
import { getAdapter } from '$lib/storage/index.js';
import type { Tab } from '$lib/types';

let { tab }: { tab: Tab } = $props();

const videoExtensions = new Set(['mp4', 'webm', 'mov', 'avi']);
const mediaType = $derived(videoExtensions.has(tab.extension.toLowerCase()) ? 'video' : 'audio');

const mimeMap: Record<string, string> = {
	mp4: 'video/mp4',
	webm: 'video/webm',
	mov: 'video/quicktime',
	avi: 'video/x-msvideo',
	mp3: 'audio/mpeg',
	wav: 'audio/wav',
	ogg: 'audio/ogg',
	flac: 'audio/flac',
	aac: 'audio/aac'
};

let objectUrl = $state<string | null>(null);
let loading = $state(true);
let error = $state<string | null>(null);

$effect(() => {
	if (!tab) return;
	loadMedia();
});

async function loadMedia() {
	loading = true;
	error = null;
	cleanup();

	try {
		const adapter = getAdapter(tab.source, tab.connectionId);
		const data = await adapter.read(tab.path);
		const mime = mimeMap[tab.extension.toLowerCase()] || 'application/octet-stream';
		const blob = new Blob([data as unknown as BlobPart], { type: mime });
		objectUrl = URL.createObjectURL(blob);
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	} finally {
		loading = false;
	}
}

function cleanup() {
	if (objectUrl) {
		URL.revokeObjectURL(objectUrl);
		objectUrl = null;
	}
}

onDestroy(cleanup);
</script>

<div class="flex h-full flex-col">
	<div class="flex items-center gap-2 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
		<span class="text-sm font-medium text-zinc-700 dark:text-zinc-300">{tab.name}</span>
		<span
			class="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
		>
			{mediaType}
		</span>
	</div>

	<div class="flex flex-1 items-center justify-center bg-zinc-950 p-4">
		{#if loading}
			<p class="text-sm text-zinc-400">Loading {mediaType}...</p>
		{:else if error}
			<div class="rounded-lg border border-red-300 bg-red-50 px-6 py-4 text-center dark:border-red-800 dark:bg-red-950">
				<p class="text-sm text-red-600 dark:text-red-400">{error}</p>
			</div>
		{:else if objectUrl}
			{#if mediaType === 'video'}
				<video
					src={objectUrl}
					controls
					class="max-h-full max-w-full rounded"
				>
					<track kind="captions" />
				</video>
			{:else}
				<div class="w-full max-w-md">
					<audio src={objectUrl} controls class="w-full">
						<track kind="captions" />
					</audio>
				</div>
			{/if}
		{/if}
	</div>
</div>
