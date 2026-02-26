<script lang="ts">
import CheckIcon from '@lucide/svelte/icons/check';
import ChevronFirstIcon from '@lucide/svelte/icons/chevron-first';
import ChevronLastIcon from '@lucide/svelte/icons/chevron-last';
import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
import ClockIcon from '@lucide/svelte/icons/clock';
import EllipsisVerticalIcon from '@lucide/svelte/icons/ellipsis-vertical';
import InfoIcon from '@lucide/svelte/icons/info';
import LinkIcon from '@lucide/svelte/icons/link';
import MapIcon from '@lucide/svelte/icons/map';
import TableIcon from '@lucide/svelte/icons/table';
import { Button } from '$lib/components/ui/button/index.js';
import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
import { Separator } from '$lib/components/ui/separator/index.js';
import { t } from '$lib/i18n/index.svelte.js';
import { connections } from '$lib/stores/connections.svelte.js';
import type { Tab } from '$lib/types';
import { buildHttpsUrl, buildStorageUrl } from '$lib/utils/url.js';

const PROVIDER_LABELS: Record<string, string> = {
	s3: 'S3',
	gcs: 'GCS',
	r2: 'R2',
	minio: 'MinIO',
	azure: 'Azure',
	storj: 'Storj'
};

let {
	tab,
	fileName,
	columnCount = 0,
	rowCount = 0,
	currentPage = 1,
	totalPages = 1,
	pageSize = 1000,
	historyVisible = false,
	hasGeo = false,
	isStac = false,
	viewMode = 'table' as 'table' | 'map' | 'stac' | 'info',
	onPrevPage,
	onNextPage,
	onGoToPage,
	onToggleInfo,
	onToggleHistory,
	onToggleView,
	onToggleStac,
	onPageSizeChange
}: {
	tab: Tab;
	fileName: string;
	columnCount?: number;
	rowCount?: number;
	currentPage?: number;
	totalPages?: number;
	pageSize?: number;
	historyVisible?: boolean;
	hasGeo?: boolean;
	isStac?: boolean;
	viewMode?: 'table' | 'map' | 'stac' | 'info';
	onPrevPage: () => void;
	onNextPage: () => void;
	onGoToPage?: (page: number) => void;
	onToggleInfo?: () => void;
	onToggleHistory?: () => void;
	onToggleView?: () => void;
	onToggleStac?: () => void;
	onPageSizeChange?: (size: number) => void;
} = $props();

let jumpPageEditing = $state(false);
let jumpPageValue = $state('');
let copiedType = $state<string | null>(null);

const PAGE_SIZES = [1000, 5000, 10_000, 100_000];

const providerLabel = $derived.by(() => {
	if (!tab.connectionId) return null;
	const conn = connections.getById(tab.connectionId);
	return conn ? (PROVIDER_LABELS[conn.provider] ?? conn.provider) : null;
});

const hasProviderLink = $derived(tab.source === 'remote' && !!providerLabel);

async function handleCopy(type: 'https' | 'provider') {
	const url = type === 'https' ? buildHttpsUrl(tab) : buildStorageUrl(tab);
	if (!url) return;
	try {
		await navigator.clipboard.writeText(url);
		copiedType = type;
		setTimeout(() => (copiedType = null), 2000);
	} catch {
		// clipboard API may fail in some contexts
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
	class="flex items-center gap-1 border-b border-zinc-200 px-2 py-1.5 sm:gap-2 sm:px-4 dark:border-zinc-800"
>
	<!-- File name — truncated on mobile -->
	<span class="truncate max-w-[120px] text-sm font-medium text-zinc-700 sm:max-w-none dark:text-zinc-300">{fileName}</span>

	<!-- Row/col count — hidden on mobile -->
	<span class="hidden text-xs text-zinc-400 sm:inline dark:text-zinc-500">
		{#if rowCount > 0}
			{rowCount.toLocaleString()} {t('toolbar.rows')} &times; {columnCount} cols
		{:else if columnCount > 0}
			{columnCount} cols
		{/if}
	</span>

	<div class="ms-auto flex items-center gap-1 sm:gap-2">
		<!-- ===== View mode buttons (all screen sizes) ===== -->
		{#if onToggleInfo}
			<Button
				variant={viewMode === 'info' ? 'default' : 'outline'}
				size="sm"
				class="h-7 gap-1 px-2 text-xs {viewMode !== 'info' ? 'border-zinc-300 text-zinc-600 hover:bg-zinc-50 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900' : ''}"
				onclick={onToggleInfo}
			>
				<InfoIcon class="size-3" />
				<span class="hidden sm:inline">{t('toolbar.info')}</span>
			</Button>
		{/if}

		{#if hasGeo && onToggleView}
			<Button
				variant={viewMode === 'map' ? 'default' : 'outline'}
				size="sm"
				class="h-7 gap-1 px-2 text-xs {viewMode !== 'map' ? 'border-blue-300 text-blue-600 hover:bg-blue-50 hover:text-blue-700 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-950' : ''}"
				onclick={onToggleView}
			>
				{#if viewMode !== 'map'}
					<MapIcon class="size-3" />
					{t('toolbar.map')}
				{:else}
					<TableIcon class="size-3" />
					{t('toolbar.table')}
				{/if}
			</Button>
		{/if}

		{#if isStac && onToggleStac}
			<Button
				variant={viewMode === 'stac' ? 'default' : 'outline'}
				size="sm"
				class="h-7 gap-1 px-2 text-xs {viewMode !== 'stac' ? 'border-blue-300 text-blue-600 hover:bg-blue-50 hover:text-blue-700 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-950' : ''}"
				onclick={onToggleStac}
			>
				<MapIcon class="size-3" />
				{t('toolbar.stacMap')}
			</Button>
		{/if}

		<!-- ===== Desktop-only controls (hidden on mobile) ===== -->
		<div class="hidden items-center gap-1 sm:flex">
			<!-- Copy URL dropdown -->
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button variant="ghost" size="sm" class="h-7 gap-1 px-2 text-xs" {...props}>
							<LinkIcon class="size-3" />
							{t('toolbar.copyUrl')}
						</Button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="start" class="w-48">
					<DropdownMenu.Item onclick={() => handleCopy('https')}>
						{#if copiedType === 'https'}
							<CheckIcon class="mr-2 size-3 text-green-500" />
							{t('toolbar.copied')}
						{:else}
							{t('toolbar.copyHttpsLink')}
						{/if}
					</DropdownMenu.Item>
					{#if hasProviderLink}
						<DropdownMenu.Item onclick={() => handleCopy('provider')}>
							{#if copiedType === 'provider'}
								<CheckIcon class="mr-2 size-3 text-green-500" />
								{t('toolbar.copied')}
							{:else}
								{t('toolbar.copyProviderLink').replace('{provider}', providerLabel!)}
							{/if}
						</DropdownMenu.Item>
					{/if}
				</DropdownMenu.Content>
			</DropdownMenu.Root>

			<Separator orientation="vertical" class="!h-4" />

			<!-- History toggle — hidden in map mode -->
			{#if onToggleHistory && viewMode === 'table'}
				<Button
					variant="ghost"
					size="sm"
					class="h-7 px-2 text-xs {historyVisible ? 'text-blue-500' : ''}"
					onclick={onToggleHistory}
				>
					<ClockIcon class="size-3" />
					{t('toolbar.history')}
				</Button>
			{/if}

				<!-- Page size selector — hidden in map mode -->
			{#if onPageSizeChange && viewMode === 'table'}
				<Separator orientation="vertical" class="!h-4" />
				<select
					class="rounded border border-zinc-200 bg-transparent px-1.5 py-0.5 text-xs text-zinc-500 outline-none dark:border-zinc-700 dark:text-zinc-400"
					value={pageSize}
					onchange={(e) => onPageSizeChange?.(parseInt(e.currentTarget.value, 10))}
				>
					{#each PAGE_SIZES as size}
						<option value={size}>{size.toLocaleString()} {t('toolbar.rows')}</option>
					{/each}
				</select>
			{/if}
		</div>

		<!-- ===== Pagination (all screen sizes) ===== -->
		{#if totalPages > 1}
			<Separator orientation="vertical" class="!h-4 hidden sm:block" />

			<div class="inline-flex -space-x-px">
				<!-- First page — desktop only -->
				<Button
					variant="outline"
					size="sm"
					class="hidden h-7 rounded-e-none px-1.5 shadow-none sm:inline-flex"
					onclick={() => onGoToPage?.(1)}
					disabled={currentPage <= 1}
					title={t('toolbar.firstPage')}
				>
					<ChevronFirstIcon class="size-3.5" />
				</Button>

				<!-- Prev -->
				<Button
					variant="outline"
					size="sm"
					class="h-7 rounded-none px-1.5 shadow-none sm:first:rounded-none"
					onclick={onPrevPage}
					disabled={currentPage <= 1}
				>
					<ChevronLeftIcon class="size-3.5" />
				</Button>

				<!-- Page indicator / jump -->
				{#if jumpPageEditing}
					<!-- svelte-ignore a11y_autofocus -->
					<input
						type="number"
						class="h-7 w-14 border border-zinc-200 bg-transparent px-1 text-center text-xs outline-none dark:border-zinc-700 dark:bg-zinc-900"
						bind:value={jumpPageValue}
						onkeydown={handleJumpKeydown}
						onblur={handleJumpSubmit}
						min="1"
						max={totalPages}
						autofocus
					/>
				{:else}
					<Button
						variant="outline"
						size="sm"
						class="h-7 rounded-none px-2.5 font-normal tabular-nums shadow-none"
						onclick={() => { jumpPageEditing = true; jumpPageValue = String(currentPage); }}
						title={t('toolbar.jumpToPage')}
					>
						{currentPage} / {totalPages}
					</Button>
				{/if}

				<!-- Next -->
				<Button
					variant="outline"
					size="sm"
					class="h-7 rounded-none px-1.5 shadow-none"
					onclick={onNextPage}
					disabled={currentPage >= totalPages}
				>
					<ChevronRightIcon class="size-3.5" />
				</Button>

				<!-- Last page — desktop only -->
				<Button
					variant="outline"
					size="sm"
					class="hidden h-7 rounded-s-none px-1.5 shadow-none sm:inline-flex"
					onclick={() => onGoToPage?.(totalPages)}
					disabled={currentPage >= totalPages}
					title={t('toolbar.lastPage')}
				>
					<ChevronLastIcon class="size-3.5" />
				</Button>
			</div>
		{/if}

		<!-- ===== Mobile overflow menu (visible below sm) ===== -->
		<div class="flex sm:hidden">
			<DropdownMenu.Root>
				<DropdownMenu.Trigger
					class="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
				>
					<EllipsisVerticalIcon class="size-4" />
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end" class="w-48">
					<!-- Copy URL options -->
					<DropdownMenu.Item onclick={() => handleCopy('https')}>
						{#if copiedType === 'https'}
							<CheckIcon class="mr-2 size-3 text-green-500" />
							{t('toolbar.copied')}
						{:else}
							<LinkIcon class="mr-2 size-3" />
							{t('toolbar.copyHttpsLink')}
						{/if}
					</DropdownMenu.Item>
					{#if hasProviderLink}
						<DropdownMenu.Item onclick={() => handleCopy('provider')}>
							{#if copiedType === 'provider'}
								<CheckIcon class="mr-2 size-3 text-green-500" />
								{t('toolbar.copied')}
							{:else}
								<LinkIcon class="mr-2 size-3" />
								{t('toolbar.copyProviderLink').replace('{provider}', providerLabel!)}
							{/if}
						</DropdownMenu.Item>
					{/if}

					<DropdownMenu.Separator />

					<!-- History toggle — table mode only -->
					{#if onToggleHistory && viewMode === 'table'}
						<DropdownMenu.Item onclick={onToggleHistory}>
							{historyVisible ? t('toolbar.hideHistory') : t('toolbar.showHistory')}
						</DropdownMenu.Item>
					{/if}

					<!-- Page size sub-menu — table mode only -->
					{#if onPageSizeChange && viewMode === 'table'}
						<DropdownMenu.Separator />
						<DropdownMenu.Sub>
							<DropdownMenu.SubTrigger>
								{t('toolbar.pageSize')}: {pageSize.toLocaleString()}
							</DropdownMenu.SubTrigger>
							<DropdownMenu.SubContent>
								{#each PAGE_SIZES as size}
									<DropdownMenu.Item onclick={() => onPageSizeChange?.(size)}>
										{size.toLocaleString()} {t('toolbar.rows')}
										{#if size === pageSize}
											<span class="ms-auto text-blue-500">&#10003;</span>
										{/if}
									</DropdownMenu.Item>
								{/each}
							</DropdownMenu.SubContent>
						</DropdownMenu.Sub>
					{/if}
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		</div>
	</div>
</div>
