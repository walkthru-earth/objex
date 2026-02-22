<script lang="ts">
import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
import DownloadIcon from '@lucide/svelte/icons/download';
import { exportToCsv, exportToJson } from '$lib/utils/export.js';

let {
	rowCount = 0,
	executionTimeMs = 0,
	loading = false,
	columns = [] as string[],
	rows = [] as Record<string, any>[],
	fileName = 'export'
}: {
	rowCount?: number;
	executionTimeMs?: number;
	loading?: boolean;
	columns?: string[];
	rows?: Record<string, any>[];
	fileName?: string;
} = $props();

let exportOpen = $state(false);

function handleExportCsv() {
	exportToCsv(columns, rows, fileName);
	exportOpen = false;
}

function handleExportJson() {
	exportToJson(columns, rows, fileName);
	exportOpen = false;
}

function handleClickOutside(e: MouseEvent) {
	exportOpen = false;
}
</script>

<svelte:window onclick={() => { if (exportOpen) exportOpen = false; }} />

<div class="flex h-7 items-center justify-between border-t border-zinc-200 bg-zinc-50 px-3 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
	<!-- Left side -->
	<div>
		{#if loading}
			<span class="animate-pulse">Running query...</span>
		{:else if rowCount > 0}
			<span>{rowCount.toLocaleString()} rows</span>
			{#if executionTimeMs > 0}
				<span class="text-zinc-400 dark:text-zinc-500"> in {executionTimeMs}ms</span>
			{/if}
		{:else}
			<span>No results</span>
		{/if}
	</div>

	<!-- Right side: export dropdown -->
	<div class="relative">
		<button
			class="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-800"
			onclick={(e) => { e.stopPropagation(); exportOpen = !exportOpen; }}
			disabled={rows.length === 0}
			class:opacity-40={rows.length === 0}
		>
			<DownloadIcon class="size-3" />
			<span>Export</span>
			<ChevronDownIcon class="size-3" />
		</button>

		{#if exportOpen}
			<div
				class="absolute bottom-full right-0 mb-1 w-32 rounded border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-800"
				role="menu"
			>
				<button
					class="w-full px-3 py-1.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-700"
					onclick={(e) => { e.stopPropagation(); handleExportCsv(); }}
					role="menuitem"
				>
					Export as CSV
				</button>
				<button
					class="w-full px-3 py-1.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-700"
					onclick={(e) => { e.stopPropagation(); handleExportJson(); }}
					role="menuitem"
				>
					Export as JSON
				</button>
			</div>
		{/if}
	</div>
</div>
