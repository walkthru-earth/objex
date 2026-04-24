<script lang="ts">
import type { Tab } from '$lib/types';
import { buildHttpsUrlAsync } from '$lib/utils/url.js';

let { tab, variant = 'stac-map' }: { tab: Tab; variant?: 'stac-map' | 'stac-browser' } = $props();

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

const iframeSrc = $derived.by(() => {
	if (!fileUrl) return '';
	if (variant === 'stac-browser') {
		return `https://radiantearth.github.io/stac-browser/#/external/${encodeURIComponent(fileUrl)}`;
	}
	return `https://developmentseed.org/stac-map?href=${encodeURIComponent(fileUrl)}`;
});

const iframeTitle = $derived(variant === 'stac-browser' ? 'STAC Browser' : 'stac-map');
</script>

<div class="relative flex h-full overflow-hidden">
	{#if iframeSrc}
		<iframe
			src={iframeSrc}
			class="h-full w-full border-0"
			title={iframeTitle}
			allow="fullscreen"
		></iframe>
	{/if}
</div>
