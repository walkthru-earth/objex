<script lang="ts">
import {
	formatFileSize,
	generateHexDump,
	type HexRow,
	handleLoadError
} from '@walkthru-earth/objex-utils';
import { onDestroy } from 'svelte';
import { Badge } from '$lib/components/ui/badge/index.js';
import { t } from '$lib/i18n/index.svelte.js';
import { getAdapter } from '$lib/storage/index.js';
import { tabResources } from '$lib/stores/tab-resources.svelte.js';
import type { Tab } from '$lib/types';
import ViewerHeader from './ViewerHeader.svelte';
import ViewerStatus from './ViewerStatus.svelte';

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
		const msg = handleLoadError(err);
		if (msg === null) return;
		error = msg;
	} finally {
		loading = false;
	}
}
</script>

<div class="flex h-full flex-col">
	<ViewerHeader {tab}>
		{#snippet badge()}
			{#if tab.extension}
				<Badge variant="secondary">{tab.extension}</Badge>
			{/if}
		{/snippet}
		{#snippet actions()}
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
		{/snippet}
	</ViewerHeader>

	<div class="flex-1 overflow-auto bg-zinc-950 p-4 font-mono text-xs">
		{#if loading}
			<ViewerStatus kind="loading" message={t('raw.loading')} />
		{:else if error}
			<ViewerStatus kind="error" message={error} />
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
