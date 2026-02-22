<script lang="ts">
import ChevronFirstIcon from '@lucide/svelte/icons/chevron-first';
import ChevronLastIcon from '@lucide/svelte/icons/chevron-last';
import ClockIcon from '@lucide/svelte/icons/clock';

let {
	fileName,
	columnCount = 0,
	rowCount = 0,
	currentPage = 1,
	totalPages = 1,
	pageSize = 1000,
	schemaVisible = false,
	historyVisible = false,
	hasGeo = false,
	viewMode = 'table' as 'table' | 'map',
	httpsUrl = '',
	storageUrl = '',
	onPrevPage,
	onNextPage,
	onGoToPage,
	onToggleSchema,
	onToggleHistory,
	onToggleView,
	onCopyLink,
	onPageSizeChange
}: {
	fileName: string;
	columnCount?: number;
	rowCount?: number;
	currentPage?: number;
	totalPages?: number;
	pageSize?: number;
	schemaVisible?: boolean;
	historyVisible?: boolean;
	hasGeo?: boolean;
	viewMode?: 'table' | 'map';
	httpsUrl?: string;
	storageUrl?: string;
	onPrevPage: () => void;
	onNextPage: () => void;
	onGoToPage?: (page: number) => void;
	onToggleSchema: () => void;
	onToggleHistory?: () => void;
	onToggleView?: () => void;
	onCopyLink?: (type: 'https' | 's3') => void;
	onPageSizeChange?: (size: number) => void;
} = $props();

let copiedType = $state<string | null>(null);
let jumpPageEditing = $state(false);
let jumpPageValue = $state('');

const PAGE_SIZES = [100, 500, 1000, 5000];

async function handleCopy(type: 'https' | 's3') {
	const url = type === 'https' ? httpsUrl : storageUrl;
	if (!url) return;
	try {
		await navigator.clipboard.writeText(url);
		copiedType = type;
		setTimeout(() => (copiedType = null), 2000);
	} catch {
		onCopyLink?.(type);
	}
}

function handleJumpSubmit() {
	const page = parseInt(jumpPageValue, 10);
	if (page >= 1 && page <= totalPages && onGoToPage) {
		onGoToPage(page);
	}
	jumpPageEditing = false;
	jumpPageValue = '';
}

function handleJumpKeydown(e: KeyboardEvent) {
	if (e.key === 'Enter') {
		e.preventDefault();
		handleJumpSubmit();
	}
	if (e.key === 'Escape') {
		jumpPageEditing = false;
		jumpPageValue = '';
	}
}
</script>

<div
	class="flex items-center gap-2 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800"
>
	<span class="text-sm font-medium text-zinc-700 dark:text-zinc-300">{fileName}</span>

	<span class="text-xs text-zinc-400 dark:text-zinc-500">
		{#if rowCount > 0}
			{rowCount.toLocaleString()} rows &times; {columnCount} cols
		{:else if columnCount > 0}
			{columnCount} cols
		{/if}
	</span>

	<div class="ml-auto flex items-center gap-2">
		<!-- Share / Copy Link buttons -->
		{#if httpsUrl}
			<button
				class="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
				onclick={() => handleCopy('https')}
				title={httpsUrl}
			>
				{copiedType === 'https' ? 'Copied!' : 'HTTPS'}
			</button>
		{/if}
		{#if storageUrl}
			<button
				class="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
				onclick={() => handleCopy('s3')}
				title={storageUrl}
			>
				{copiedType === 's3' ? 'Copied!' : 'S3'}
			</button>
		{/if}

		{#if httpsUrl || storageUrl}
			<span class="text-zinc-300 dark:text-zinc-700">|</span>
		{/if}

		{#if hasGeo && onToggleView}
			<button
				class="rounded px-2 py-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
				class:text-blue-500={viewMode === 'map'}
				class:text-zinc-400={viewMode !== 'map'}
				onclick={onToggleView}
			>
				{viewMode === 'table' ? 'Map' : 'Table'}
			</button>
			<span class="text-zinc-300 dark:text-zinc-700">|</span>
		{/if}

		<!-- History toggle -->
		{#if onToggleHistory}
			<button
				class="flex items-center gap-1 rounded px-2 py-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
				class:text-blue-500={historyVisible}
				class:text-zinc-400={!historyVisible}
				onclick={onToggleHistory}
			>
				<ClockIcon class="size-3" />
				History
			</button>
		{/if}

		<button
			class="rounded px-2 py-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
			class:text-blue-500={schemaVisible}
			class:text-zinc-400={!schemaVisible}
			onclick={onToggleSchema}
		>
			Schema
		</button>

		<!-- Page size selector -->
		{#if onPageSizeChange}
			<span class="text-zinc-300 dark:text-zinc-700">|</span>
			<select
				class="rounded border border-zinc-200 bg-transparent px-1.5 py-0.5 text-xs text-zinc-500 outline-none dark:border-zinc-700 dark:text-zinc-400"
				value={pageSize}
				onchange={(e) => onPageSizeChange?.(parseInt(e.currentTarget.value, 10))}
			>
				{#each PAGE_SIZES as size}
					<option value={size}>{size.toLocaleString()} rows</option>
				{/each}
			</select>
		{/if}

		{#if totalPages > 1}
			<span class="text-zinc-300 dark:text-zinc-700">|</span>

			<!-- First page -->
			<button
				class="rounded px-1.5 py-1 text-xs text-zinc-400 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"
				onclick={() => onGoToPage?.(1)}
				disabled={currentPage <= 1}
				title="First page"
			>
				<ChevronFirstIcon class="size-3.5" />
			</button>

			<button
				class="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"
				onclick={onPrevPage}
				disabled={currentPage <= 1}
			>
				Prev
			</button>

			<!-- Clickable page indicator / jump to page -->
			{#if jumpPageEditing}
				<!-- svelte-ignore a11y_autofocus -->
				<input
					type="number"
					class="w-16 rounded border border-zinc-300 bg-transparent px-1.5 py-0.5 text-center text-xs outline-none dark:border-zinc-600"
					bind:value={jumpPageValue}
					onkeydown={handleJumpKeydown}
					onblur={handleJumpSubmit}
					min="1"
					max={totalPages}
					autofocus
				/>
			{:else}
				<button
					class="rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
					onclick={() => { jumpPageEditing = true; jumpPageValue = String(currentPage); }}
					title="Click to jump to page"
				>
					{currentPage} / {totalPages}
				</button>
			{/if}

			<button
				class="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"
				onclick={onNextPage}
				disabled={currentPage >= totalPages}
			>
				Next
			</button>

			<!-- Last page -->
			<button
				class="rounded px-1.5 py-1 text-xs text-zinc-400 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-zinc-800"
				onclick={() => onGoToPage?.(totalPages)}
				disabled={currentPage >= totalPages}
				title="Last page"
			>
				<ChevronLastIcon class="size-3.5" />
			</button>
		{/if}
	</div>
</div>
