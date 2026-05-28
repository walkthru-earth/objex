<script lang="ts">
import { handleLoadError } from '@walkthru-earth/objex-utils';
import { onDestroy } from 'svelte';
import { getMimeType } from '$lib/file-icons/index.js';
import { getAdapter } from '$lib/storage/index.js';
import { tabResources } from '$lib/stores/tab-resources.svelte.js';
import type { Tab } from '$lib/types';
import { buildHttpsUrl, canStreamDirectly } from '$lib/utils/signed-url.js';
import ViewerHeader from './ViewerHeader.svelte';
import ViewerStatus from './ViewerStatus.svelte';

let { tab }: { tab: Tab } = $props();

const videoExtensions = new Set(['mp4', 'webm', 'mov', 'avi', 'mkv']);
const mediaType = $derived(videoExtensions.has(tab.extension.toLowerCase()) ? 'video' : 'audio');

let abortController: AbortController | null = null;
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
	abortController = new AbortController();
	const { signal } = abortController;

	try {
		if (canStreamDirectly(tab)) {
			// Direct URL — browser handles HTTP range-request streaming natively.
			// No CORS needed for <video>/<audio> src. Enables seeking without
			// downloading the full file (S3/Azure/GCS all support range requests).
			mediaSrc = buildHttpsUrl(tab);
		} else {
			// Authenticated S3 — download via storage adapter (blob fallback)
			const adapter = getAdapter(tab.source, tab.connectionId);
			const data = await adapter.read(tab.path, undefined, undefined, signal);
			const blob = new Blob([data as unknown as BlobPart], { type: getMimeType(tab.extension) });
			blobUrl = URL.createObjectURL(blob);
			mediaSrc = blobUrl;
		}
	} catch (err) {
		const msg = handleLoadError(err);
		if (msg === null) return;
		error = msg;
	} finally {
		loading = false;
	}
}

function cleanup() {
	abortController?.abort();
	abortController = null;
	if (blobUrl) {
		URL.revokeObjectURL(blobUrl);
		blobUrl = null;
	}
	mediaSrc = null;
}

$effect(() => {
	const id = tab.id;
	const unregister = tabResources.register(id, cleanup);
	return unregister;
});
onDestroy(cleanup);
</script>

<div class="flex h-full flex-col">
	<ViewerHeader {tab}>
		{#snippet badge()}
			<span class="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
				{mediaType}
			</span>
		{/snippet}
	</ViewerHeader>

	<div class="flex flex-1 items-center justify-center bg-zinc-950 p-4">
		{#if loading}
			<ViewerStatus kind="loading" />
		{:else if error}
			<ViewerStatus kind="error" message={error} />
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
