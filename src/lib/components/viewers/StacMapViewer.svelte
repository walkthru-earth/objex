<script lang="ts">
import type { Tab } from '$lib/types';
import { resolveSignedTabUrl } from '$lib/utils/signed-url-effect.js';

let { tab, variant = 'stac-map' }: { tab: Tab; variant?: 'stac-map' | 'stac-browser' } = $props();

let fileUrl = $state('');

$effect(() =>
	resolveSignedTabUrl(tab, (u) => {
		fileUrl = u;
	})
);

const iframeSrc = $derived.by(() => {
	if (!fileUrl) return '';
	if (variant === 'stac-browser') {
		// Radiant Earth STAC Browser is a Vue Router SPA. Its
		// `#/external/<url>` route takes the catalog URL verbatim, splitting on
		// `/`. Feeding it an `encodeURIComponent`-encoded URL makes the router
		// hand `https%3A%2F%2F…` to `new URL()`, which reads the collapsed
		// authority as a malformed port and throws
		// `Port "%2F%2Fstorage.googleapis.com%2F…" is not a valid port`.
		// Only escape the `#` character (which would otherwise terminate the
		// hash route) so the rest of the URL flows through intact.
		return `https://radiantearth.github.io/stac-browser/#/external/${fileUrl.replace(/#/g, '%23')}`;
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
