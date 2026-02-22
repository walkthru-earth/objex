<script lang="ts">
import { getAdapter } from '$lib/storage/index.js';
import type { Tab } from '$lib/types';
import { formatFileSize } from '$lib/utils/format';
import { generateHexDump, type HexRow } from '$lib/utils/hex';

let { tab }: { tab: Tab } = $props();

const MAX_BYTES = 8192;

let rows = $state<HexRow[]>([]);
let fileSize = $state(0);
let loading = $state(true);
let error = $state<string | null>(null);
let truncated = $state(false);

$effect(() => {
	if (!tab) return;
	loadHexDump();
});

async function loadHexDump() {
	loading = true;
	error = null;

	try {
		const adapter = getAdapter(tab.source, tab.connectionId);
		const meta = await adapter.head(tab.path);
		fileSize = meta.size;

		const data = await adapter.read(tab.path, 0, MAX_BYTES);
		truncated = fileSize > MAX_BYTES;
		rows = generateHexDump(data);
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	} finally {
		loading = false;
	}
}
</script>

<div class="flex h-full flex-col">
	<div
		class="flex items-center gap-2 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800"
	>
		<span class="text-sm font-medium text-zinc-700 dark:text-zinc-300">{tab.name}</span>
		{#if tab.extension}
			<span
				class="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
			>
				{tab.extension}
			</span>
		{/if}
		{#if !loading && fileSize > 0}
			<span class="text-xs text-zinc-400 dark:text-zinc-500">
				{formatFileSize(fileSize)}
			</span>
			{#if truncated}
				<span class="text-xs text-amber-500">
					(showing first {formatFileSize(MAX_BYTES)})
				</span>
			{/if}
		{/if}
	</div>

	<div class="flex-1 overflow-auto bg-zinc-950 p-4 font-mono text-xs">
		{#if loading}
			<p class="text-zinc-400">Loading hex dump...</p>
		{:else if error}
			<p class="text-red-400">{error}</p>
		{:else}
			<table class="w-full border-collapse">
				<thead>
					<tr class="text-zinc-500">
						<th class="px-2 pb-2 text-left">Offset</th>
						<th class="px-2 pb-2 text-left" colspan="2">Hex</th>
						<th class="px-2 pb-2 text-left">ASCII</th>
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
