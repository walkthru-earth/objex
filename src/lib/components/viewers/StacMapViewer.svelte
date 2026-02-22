<script lang="ts">
import type { Tab } from '$lib/types';
import { buildHttpsUrl } from '$lib/utils/url.js';

let { tab }: { tab: Tab } = $props();

const fileUrl = $derived(buildHttpsUrl(tab));
const iframeSrc = $derived(
	`https://developmentseed.org/stac-map?href=${encodeURIComponent(fileUrl)}`
);
</script>

<div class="relative flex h-full overflow-hidden">
	<iframe
		src={iframeSrc}
		class="h-full w-full border-0"
		title="STAC Map"
		allow="fullscreen"
	></iframe>
</div>
