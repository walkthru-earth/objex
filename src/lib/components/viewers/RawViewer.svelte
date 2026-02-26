<script lang="ts">
import { onDestroy } from 'svelte';
import { Badge } from '$lib/components/ui/badge/index.js';
import { t } from '$lib/i18n/index.svelte.js';
import { getAdapter } from '$lib/storage/index.js';
import { tabResources } from '$lib/stores/tab-resources.svelte.js';
import type { Tab } from '$lib/types';
import { formatFileSize } from '$lib/utils/format';
import { generateHexDump, type HexRow } from '$lib/utils/hex';

let { tab }: { tab: Tab } = $props();

const MAX_BYTES = 8192;

let abortController: AbortController | null = null;
let rows = $state<HexRow[]>([]);
let fileSize = $state(0);
let loading = $state(true);
let error = $state<string | null>(null);
let truncated = $state(false);

function cleanup() {
	abortController?.abort();
	abortController = null;
	rows = [];
	fileSize = 0;
}

$effect(() => {
	if (!tab) return;
	const unregister = tabResources.register(tab.id, cleanup);
	return unregister;
});
onDestroy(cleanup);

$effect(() => {
	if (!tab) return;
	loadHexDump();
});

async function loadHexDump() {
	abortController?.abort();
	abortController = new AbortController();
	const { signal } = abortController;

	loading = true;
	error = null;

	try {
		const adapter = getAdapter(tab.source, tab.connectionId);
		const meta = await adapter.head(tab.path, signal);
		fileSize = meta.size;

		const data = await adapter.read(tab.path, 0, MAX_BYTES, signal);
		truncated = fileSize > MAX_BYTES;
		rows = generateHexDump(data);
	} catch (err) {
		if (err instanceof DOMException && err.name === 'AbortError') return;
		error = err instanceof Error ? err.message : String(err);
	} finally {
		loading = false;
	}
}
</script>

<div class="flex h-full flex-col">
	<div
		class="flex items-center gap-1 border-b border-zinc-200 px-2 py-1.5 sm:gap-2 sm:px-4 dark:border-zinc-800"
	>
		<span class="truncate max-w-[120px] text-sm font-medium text-zinc-700 sm:max-w-none dark:text-zinc-300">{tab.name}</span>
		{#if tab.extension}
			<Badge variant="secondary">{tab.extension}</Badge>
		{/if}
		{#if !loading && fileSize > 0}
			<span class="hidden text-xs text-zinc-400 sm:inline dark:text-zinc-500">
				{formatFileSize(fileSize)}
			</span>
			{#if truncated}
				<span class="hidden text-xs text-amber-500 sm:inline">
					({t('raw.showingFirst').replace('{size}', formatFileSize(MAX_BYTES))})
				</span>
			{/if}
		{/if}
	</div>

	<div class="flex-1 overflow-auto bg-zinc-950 p-4 font-mono text-xs">
		{#if loading}
			<p class="text-zinc-400">{t('raw.loading')}</p>
		{:else if error}
			<p class="text-red-400">{error}</p>
		{:else}
			<table class="w-full border-collapse">
				<thead>
					<tr class="text-zinc-500">
						<th class="px-2 pb-2 text-start">Offset</th>
						<th class="px-2 pb-2 text-start" colspan="2">Hex</th>
						<th class="px-2 pb-2 text-start">ASCII</th>
					</tr>
				</thead>
				<tbody>
					{#each rows as row}
						<tr class="hover:bg-zinc-800/50">
							<td class="px-2 py-px text-zinc-500">{row.offset}</td>
							<td class="px-2 py-px text-zinc-300">
								{row.hex.slice(0, 8).join(' ')}
							</td>
							<td class="px-2 py-px text-zinc-300">
								{row.hex.slice(8).join(' ')}
							</td>
							<td class="px-2 py-px text-emerald-400">{row.ascii}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>
</div>
