<script lang="ts">
import ChevronFirstIcon from '@lucide/svelte/icons/chevron-first';
import ChevronLastIcon from '@lucide/svelte/icons/chevron-last';
import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
import ClockIcon from '@lucide/svelte/icons/clock';
import EllipsisVerticalIcon from '@lucide/svelte/icons/ellipsis-vertical';
import { Button } from '$lib/components/ui/button/index.js';
import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
import { Separator } from '$lib/components/ui/separator/index.js';
import { t } from '$lib/i18n/index.svelte.js';

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
	onPrevPage,
	onNextPage,
	onGoToPage,
	onToggleSchema,
	onToggleHistory,
	onToggleView,
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
	onPrevPage: () => void;
	onNextPage: () => void;
	onGoToPage?: (page: number) => void;
	onToggleSchema: () => void;
	onToggleHistory?: () => void;
	onToggleView?: () => void;
	onPageSizeChange?: (size: number) => void;
} = $props();

let jumpPageEditing = $state(false);
let jumpPageValue = $state('');

const PAGE_SIZES = [100, 500, 1000, 5000];

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
		<!-- ===== Desktop-only controls (hidden on mobile) ===== -->
		<div class="hidden items-center gap-1 sm:flex">
			{#if hasGeo && onToggleView}
				<Button
					variant="ghost"
					size="sm"
					class="h-7 px-2 text-xs {viewMode === 'map' ? 'text-blue-500' : ''}"
					onclick={onToggleView}
				>
					{viewMode === 'table' ? t('toolbar.map') : t('toolbar.table')}
				</Button>
				<Separator orientation="vertical" class="!h-4" />
			{/if}

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

			{#if viewMode === 'table'}
				<Button
					variant="ghost"
					size="sm"
					class="h-7 px-2 text-xs {schemaVisible ? 'text-blue-500' : ''}"
					onclick={onToggleSchema}
				>
					{t('toolbar.schema')}
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

			<!-- First page — desktop only -->
			<Button
				variant="ghost"
				size="sm"
				class="hidden h-7 px-1.5 sm:inline-flex"
				onclick={() => onGoToPage?.(1)}
				disabled={currentPage <= 1}
				title={t('toolbar.firstPage')}
			>
				<ChevronFirstIcon class="size-3.5" />
			</Button>

			<!-- Prev button: icon on mobile, text on desktop -->
			<Button variant="ghost" size="sm" class="h-7 px-1.5" onclick={onPrevPage} disabled={currentPage <= 1}>
				<ChevronLeftIcon class="size-3.5 sm:hidden" />
				<span class="hidden sm:inline">{t('toolbar.prev')}</span>
			</Button>

			<!-- Clickable page indicator / jump to page -->
			{#if jumpPageEditing}
				<!-- svelte-ignore a11y_autofocus -->
				<input
					type="number"
					class="w-12 rounded border border-zinc-300 bg-transparent px-1 py-0.5 text-center text-xs outline-none sm:w-16 sm:px-1.5 dark:border-zinc-600"
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
					title={t('toolbar.jumpToPage')}
				>
					{currentPage} / {totalPages}
				</button>
			{/if}

			<!-- Next button: icon on mobile, text on desktop -->
			<Button variant="ghost" size="sm" class="h-7 px-1.5" onclick={onNextPage} disabled={currentPage >= totalPages}>
				<ChevronRightIcon class="size-3.5 sm:hidden" />
				<span class="hidden sm:inline">{t('toolbar.next')}</span>
			</Button>

			<!-- Last page — desktop only -->
			<Button
				variant="ghost"
				size="sm"
				class="hidden h-7 px-1.5 sm:inline-flex"
				onclick={() => onGoToPage?.(totalPages)}
				disabled={currentPage >= totalPages}
				title={t('toolbar.lastPage')}
			>
				<ChevronLastIcon class="size-3.5" />
			</Button>
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
					<!-- Map/Table toggle -->
					{#if hasGeo && onToggleView}
						<DropdownMenu.Item onclick={onToggleView}>
							{viewMode === 'table' ? t('toolbar.switchToMap') : t('toolbar.switchToTable')}
						</DropdownMenu.Item>
					{/if}

					<!-- History toggle — table mode only -->
					{#if onToggleHistory && viewMode === 'table'}
						<DropdownMenu.Item onclick={onToggleHistory}>
							{historyVisible ? t('toolbar.hideHistory') : t('toolbar.showHistory')}
						</DropdownMenu.Item>
					{/if}

					<!-- Schema toggle — table mode only -->
					{#if viewMode === 'table'}
						<DropdownMenu.Item onclick={onToggleSchema}>
							{schemaVisible ? t('toolbar.hideSchema') : t('toolbar.showSchema')}
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
