<script lang="ts">
import type { Tab } from '$lib/types';
import { buildHttpsUrlAsync } from '$lib/utils/url.js';

let { tab }: { tab: Tab } = $props();

let fileUrl = $state('');

$effect(() => {
	const id = tab.id;
	let cancelled = false;
	(async () => {
		const url = await buildHttpsUrlAsync(tab);
		if (cancelled || id !== tab.id) return;
		fileUrl = url;
	})();
	return () => {
		cancelled = true;
	};
});

const iframeSrc = $derived(
	fileUrl ? `https://developmentseed.org/stac-map?href=${encodeURIComponent(fileUrl)}` : ''
);
</script>

<div class="relative flex h-full overflow-hidden">
	{#if iframeSrc}
		<iframe
			src={iframeSrc}
			class="h-full w-full border-0"
			title="STAC Map"
			allow="fullscreen"
		></iframe>
	{/if}
</div>
