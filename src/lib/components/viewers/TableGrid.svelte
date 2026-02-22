<script lang="ts">
import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
import CheckIcon from '@lucide/svelte/icons/check';
import XIcon from '@lucide/svelte/icons/x';
import {
	classifyType,
	type TypeCategory,
	typeBadgeClass,
	typeLabel
} from '$lib/utils/column-types.js';

const ROW_HEIGHT = 32;
const OVERSCAN = 5;

let {
	columns,
	rows,
	totalRows = 0,
	columnTypes = {} as Record<string, string>,
	sortColumn = null as string | null,
	sortDirection = null as 'asc' | 'desc' | null,
	onSort
}: {
	columns: string[];
	rows: Record<string, any>[];
	totalRows?: number;
	columnTypes?: Record<string, string>;
	sortColumn?: string | null;
	sortDirection?: 'asc' | 'desc' | null;
	onSort?: (column: string, direction: 'asc' | 'desc' | null) => void;
} = $props();

let containerEl: HTMLDivElement | undefined = $state();
let scrollTop = $state(0);
let containerHeight = $state(400);

const visibleStart = $derived(Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN));
const visibleEnd = $derived(
	Math.min(rows.length, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + OVERSCAN)
);
const visibleRows = $derived(rows.slice(visibleStart, visibleEnd));
const totalHeight = $derived(rows.length * ROW_HEIGHT);

// Precompute type categories for each column
const columnCategories = $derived(
	Object.fromEntries(
		columns.map((col) => [col, classifyType(columnTypes[col] || 'VARCHAR')])
	) as Record<string, TypeCategory>
);

function onScroll(e: Event) {
	const target = e.target as HTMLDivElement;
	scrollTop = target.scrollTop;
}

function formatCell(value: any, category: TypeCategory): string {
	if (value === null || value === undefined) return 'NULL';
	if (typeof value === 'boolean') return ''; // rendered as icon
	if (category === 'date' && (value instanceof Date || typeof value === 'number')) {
		try {
			const d = value instanceof Date ? value : new Date(value);
			return d.toLocaleString();
		} catch {
			return String(value);
		}
	}
	if (typeof value === 'bigint') return value.toString();
	if (typeof value === 'object') {
		return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
	}
	return String(value);
}

function isNull(value: any): boolean {
	return value === null || value === undefined;
}

function handleHeaderClick(col: string) {
	if (!onSort) return;
	if (sortColumn === col) {
		if (sortDirection === 'asc') {
			onSort(col, 'desc');
		} else if (sortDirection === 'desc') {
			onSort(col, null);
		} else {
			onSort(col, 'asc');
		}
	} else {
		onSort(col, 'asc');
	}
}

$effect(() => {
	if (containerEl) {
		containerHeight = containerEl.clientHeight;
		const observer = new ResizeObserver((entries) => {
			containerHeight = entries[0].contentRect.height;
		});
		observer.observe(containerEl);
		return () => observer.disconnect();
	}
});
</script>

<div
	bind:this={containerEl}
	class="flex-1 overflow-auto"
	onscroll={onScroll}
>
	<div style="min-height: {totalHeight + ROW_HEIGHT}px;">
		<table class="w-full border-collapse text-sm">
			<thead class="sticky top-0 z-10">
				<tr class="bg-zinc-100 dark:bg-zinc-800">
					<th
						class="border-b border-r border-zinc-200 px-3 py-1.5 text-left text-xs font-medium text-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
						style="width: 3rem;"
					>
						#
					</th>
					{#each columns as col}
						{@const category = columnCategories[col]}
						<th
							class="border-b border-r border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
							class:text-left={category !== 'number'}
							class:text-right={category === 'number'}
							class:cursor-pointer={!!onSort}
							onclick={() => handleHeaderClick(col)}
						>
							<div class="flex items-center gap-1.5" class:justify-end={category === 'number'}>
								<span
									class="inline-flex h-4 items-center rounded border px-1 text-[9px] font-semibold leading-none {typeBadgeClass(category)}"
									title={columnTypes[col] || 'unknown'}
								>
									{typeLabel(category)}
								</span>
								<span class="truncate">{col}</span>
								{#if sortColumn === col}
									{#if sortDirection === 'asc'}
										<ArrowUpIcon class="size-3 shrink-0" />
									{:else if sortDirection === 'desc'}
										<ArrowDownIcon class="size-3 shrink-0" />
									{/if}
								{/if}
							</div>
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#if visibleStart > 0}
					<tr>
						<td
							colspan={columns.length + 1}
							style="height: {visibleStart * ROW_HEIGHT}px; padding: 0; border: none;"
						></td>
					</tr>
				{/if}
				{#each visibleRows as row, i}
					<tr class="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
						<td
							class="border-b border-r border-zinc-200 px-3 py-1 text-xs text-zinc-400 dark:border-zinc-700/50 dark:text-zinc-500"
							style="height: {ROW_HEIGHT}px;"
						>
							{visibleStart + i + 1}
						</td>
						{#each columns as col}
							{@const category = columnCategories[col]}
							{@const cellValue = row[col]}
							{@const cellIsNull = isNull(cellValue)}
							<td
								class="border-b border-r border-zinc-200 px-3 py-1 text-xs dark:border-zinc-700/50"
								class:text-right={category === 'number' && !cellIsNull}
								class:font-mono={category === 'number' && !cellIsNull}
								style="height: {ROW_HEIGHT}px; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
								title={cellIsNull ? 'NULL' : formatCell(cellValue, category)}
							>
								{#if cellIsNull}
									<span class="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium italic text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500">NULL</span>
								{:else if typeof cellValue === 'boolean'}
									{#if cellValue}
										<CheckIcon class="inline size-3.5 text-green-500" />
									{:else}
										<XIcon class="inline size-3.5 text-red-400" />
									{/if}
								{:else}
									<span class:text-zinc-700={true} class:dark:text-zinc-300={true}>
										{formatCell(cellValue, category)}
									</span>
								{/if}
							</td>
						{/each}
					</tr>
				{/each}
				{#if visibleEnd < rows.length}
					<tr>
						<td
							colspan={columns.length + 1}
							style="height: {(rows.length - visibleEnd) * ROW_HEIGHT}px; padding: 0; border: none;"
						></td>
					</tr>
				{/if}
			</tbody>
		</table>
	</div>
</div>
