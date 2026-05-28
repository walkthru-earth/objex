<script lang="ts">
import type { Tab } from '$lib/types';
import { resolveSignedTabUrl } from '$lib/utils/signed-url-effect.js';

let { tab }: { tab: Tab } = $props();

let fileUrl = $state('');

$effect(() => {
	if (tab.source === 'url') {
		fileUrl = tab.path;
		return;
	}
	return resolveSignedTabUrl(tab, (u) => {
		fileUrl = u;
	});
});

const viewerUrl = $derived(
	fileUrl ? `https://viewer.copc.io/?copc=${encodeURIComponent(fileUrl)}` : ''
);
</script>

{#if viewerUrl}
	<iframe
		src={viewerUrl}
		title={tab.name}
		class="h-full w-full border-0"
		allow="fullscreen"
		sandbox="allow-scripts allow-same-origin allow-popups"
	></iframe>
{:else}
	<div class="flex h-full items-center justify-center text-sm text-muted-foreground">
		Cannot resolve file URL for point cloud viewer.
	</div>
{/if}
