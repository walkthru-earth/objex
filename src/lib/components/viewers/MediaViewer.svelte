<script lang="ts">
import { onDestroy } from 'svelte';
import { getAdapter } from '$lib/storage/index.js';
import type { Tab } from '$lib/types';
import { buildHttpsUrl, canStreamDirectly } from '$lib/utils/url.js';

let { tab }: { tab: Tab } = $props();

const videoExtensions = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv']);
const mediaType = $derived(videoExtensions.has(tab.extension.toLowerCase()) ? 'video' : 'audio');

const mimeMap: Record<string, string> = {
	mp4: 'video/mp4',
	webm: 'video/webm',
	mov: 'video/quicktime',
	avi: 'video/x-msvideo',
	mkv: 'video/x-matroska',
	mp3: 'audio/mpeg',
	wav: 'audio/wav',
	ogg: 'audio/ogg',
	flac: 'audio/flac',
	aac: 'audio/aac'
};

let mediaSrc = $state<string | null>(null);
let blobUrl = $state<string | null>(null);
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
		if (canStreamDirectly(tab)) {
			// Direct URL — browser handles HTTP range-request streaming natively.
			// No CORS needed for <video>/<audio> src. Enables seeking without
			// downloading the full file (S3/Azure/GCS all support range requests).
			mediaSrc = buildHttpsUrl(tab);
		} else {
			// Authenticated S3 — download via storage adapter (blob fallback)
			const adapter = getAdapter(tab.source, tab.connectionId);
			const data = await adapter.read(tab.path);
			const mime = mimeMap[tab.extension.toLowerCase()] || 'application/octet-stream';
			const blob = new Blob([data], { type: mime });
			blobUrl = URL.createObjectURL(blob);
			mediaSrc = blobUrl;
		}
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	} finally {
		loading = false;
	}
}

function cleanup() {
	if (blobUrl) {
		URL.revokeObjectURL(blobUrl);
		blobUrl = null;
	}
	mediaSrc = null;
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
		{:else if mediaSrc}
			{#if mediaType === 'video'}
				<video
					src={mediaSrc}
					controls
					preload="metadata"
					class="max-h-full max-w-full rounded"
				>
					<track kind="captions" />
				</video>
			{:else}
				<div class="w-full max-w-md">
					<audio src={mediaSrc} controls preload="metadata" class="w-full">
						<track kind="captions" />
					</audio>
				</div>
			{/if}
		{/if}
	</div>
</div>
