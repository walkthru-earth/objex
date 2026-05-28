<script lang="ts">
import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
import DownloadIcon from '@lucide/svelte/icons/download';
import { exportToCsv, exportToJson } from '@walkthru-earth/objex-utils';
import { t } from '$lib/i18n/index.svelte.js';

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

<div class="flex h-7 items-center justify-between border-t border-border bg-muted px-3 text-xs text-muted-foreground">
	<!-- Left side -->
	<div>
		{#if loading}
			<span class="animate-pulse">{t('statusBar.runningQuery')}</span>
		{:else if rowCount > 0}
			<span>{rowCount.toLocaleString()} {t('statusBar.rowsLabel')}</span>
			{#if executionTimeMs > 0}
				<span class="text-muted-foreground"> {t('statusBar.inTime', { time: executionTimeMs })}</span>
			{/if}
		{:else}
			<span>{t('statusBar.noResults')}</span>
		{/if}
	</div>

	<!-- Right side: export dropdown -->
	<div class="relative">
		<button
			class="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent"
			onclick={(e) => { e.stopPropagation(); exportOpen = !exportOpen; }}
			disabled={rows.length === 0}
			class:opacity-40={rows.length === 0}
		>
			<DownloadIcon class="size-3" />
			<span>{t('statusBar.export')}</span>
			<ChevronDownIcon class="size-3" />
		</button>

		{#if exportOpen}
			<div
				class="absolute bottom-full end-0 mb-1 w-32 rounded border border-border bg-background py-1 shadow-lg"
				role="menu"
			>
				<button
					class="w-full px-3 py-1.5 text-start text-xs hover:bg-muted"
					onclick={(e) => { e.stopPropagation(); handleExportCsv(); }}
					role="menuitem"
				>
					{t('statusBar.exportCsv')}
				</button>
				<button
					class="w-full px-3 py-1.5 text-start text-xs hover:bg-muted"
					onclick={(e) => { e.stopPropagation(); handleExportJson(); }}
					role="menuitem"
				>
					{t('statusBar.exportJson')}
				</button>
			</div>
		{/if}
	</div>
</div>
