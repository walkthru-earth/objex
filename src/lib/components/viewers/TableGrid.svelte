<script lang="ts">
import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
import CheckIcon from '@lucide/svelte/icons/check';
import ClipboardIcon from '@lucide/svelte/icons/clipboard';
import ColumnsIcon from '@lucide/svelte/icons/columns-3';
import CopyIcon from '@lucide/svelte/icons/copy';
import RowsIcon from '@lucide/svelte/icons/rows-3';
import XIcon from '@lucide/svelte/icons/x';
import { t } from '$lib/i18n/index.svelte.js';
import {
	classifyType,
	type TypeCategory,
	typeBadgeClass,
	typeLabel
} from '$lib/utils/column-types.js';

const INITIAL_ROWS = 100;
const BATCH_SIZE = 100;
const DEFAULT_WIDTH = 150;
const MIN_WIDTH = 60;
const ROW_NUM_WIDTH = 52;

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

// ── Progressive rendering (append-on-scroll) ──

let renderedCount = $state(0);

$effect(() => {
	// Reset when rows data changes
	void rows;
	renderedCount = Math.min(INITIAL_ROWS, rows.length);
});

const displayRows = $derived(rows.slice(0, renderedCount));

function onScroll(e: Event) {
	const el = e.target as HTMLDivElement;
	if (renderedCount < rows.length && el.scrollHeight - el.scrollTop < el.clientHeight * 2) {
		renderedCount = Math.min(renderedCount + BATCH_SIZE, rows.length);
	}
}

// ── Precompute type categories ──

const columnCategories = $derived(
	Object.fromEntries(
		columns.map((col) => [col, classifyType(columnTypes[col] || 'VARCHAR')])
	) as Record<string, TypeCategory>
);

// ── Resizable columns ──

let columnWidths = $state<Record<string, number>>({});

const tableWidth = $derived(
	ROW_NUM_WIDTH + columns.reduce((sum, col) => sum + (columnWidths[col] || DEFAULT_WIDTH), 0)
);

function startResize(col: string, e: MouseEvent) {
	e.preventDefault();
	e.stopPropagation();
	const startX = e.clientX;
	const startW = columnWidths[col] || DEFAULT_WIDTH;

	function onMove(ev: MouseEvent) {
		columnWidths[col] = Math.max(MIN_WIDTH, startW + (ev.clientX - startX));
	}
	function onUp() {
		document.removeEventListener('mousemove', onMove);
		document.removeEventListener('mouseup', onUp);
	}
	document.addEventListener('mousemove', onMove);
	document.addEventListener('mouseup', onUp);
}

function resetWidth(col: string) {
	delete columnWidths[col];
	columnWidths = { ...columnWidths };
}

// ── Sort ──

function handleHeaderClick(col: string) {
	if (!onSort) return;
	if (sortColumn === col) {
		if (sortDirection === 'asc') onSort(col, 'desc');
		else if (sortDirection === 'desc') onSort(col, null);
		else onSort(col, 'asc');
	} else {
		onSort(col, 'asc');
	}
}

// ── Context menu ──

let ctxMenu = $state<{
	x: number;
	y: number;
	value: string;
	rowData: Record<string, any>;
	colName: string;
} | null>(null);

let copied = $state(false);

function handleContextMenu(e: MouseEvent, value: any, row: Record<string, any>, col: string) {
	e.preventDefault();
	const category = columnCategories[col];
	ctxMenu = {
		x: e.clientX,
		y: e.clientY,
		value: isNull(value) ? 'NULL' : formatCell(value, category),
		rowData: row,
		colName: col
	};
	copied = false;
}

async function copyToClipboard(text: string) {
	try {
		await navigator.clipboard.writeText(text);
		copied = true;
		setTimeout(() => {
			ctxMenu = null;
			copied = false;
		}, 400);
	} catch {
		ctxMenu = null;
	}
}

function copyCell() {
	if (ctxMenu) copyToClipboard(ctxMenu.value);
}

function copyRow() {
	if (!ctxMenu) return;
	// Exclude internal columns like __wkb
	const clean: Record<string, any> = {};
	for (const [k, v] of Object.entries(ctxMenu.rowData)) {
		if (!k.startsWith('__')) clean[k] = v;
	}
	copyToClipboard(JSON.stringify(clean, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
}

function copyColumn() {
	if (!ctxMenu) return;
	const col = ctxMenu.colName;
	const values = rows.map((r) => {
		const v = r[col];
		return v == null ? 'NULL' : typeof v === 'bigint' ? v.toString() : String(v);
	});
	copyToClipboard(values.join('\n'));
}

// ── Cell rendering ──

function formatCell(value: any, category: TypeCategory): string {
	if (value === null || value === undefined) return 'NULL';
	if (typeof value === 'boolean') return '';
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
</script>

<svelte:window onclick={() => (ctxMenu = null)} onkeydown={(e) => { if (e.key === 'Escape') ctxMenu = null; }} />

<div class="flex-1 overflow-auto" onscroll={onScroll}>
	<table
		class="border-collapse"
		style="table-layout: fixed; width: {tableWidth}px;"
	>
		<colgroup>
			<col style="width: {ROW_NUM_WIDTH}px" />
			{#each columns as col}
				<col style="width: {columnWidths[col] || DEFAULT_WIDTH}px" />
			{/each}
		</colgroup>

		<thead class="sticky top-0 z-10">
			<tr class="bg-zinc-100 dark:bg-zinc-900">
				<th
					class="border-b border-e border-zinc-200 px-2 py-2 text-start text-xs font-medium text-zinc-400 dark:border-zinc-700 dark:text-zinc-500"
				>
					#
				</th>
				{#each columns as col}
					{@const category = columnCategories[col]}
					<th
						class="group relative select-none border-b border-e border-zinc-200 px-3 py-1.5 dark:border-zinc-700"
						class:text-start={category !== 'number'}
						class:text-end={category === 'number'}
						class:cursor-pointer={!!onSort}
						onclick={() => handleHeaderClick(col)}
					>
						<div class="flex items-center gap-1.5" class:justify-end={category === 'number'}>
							<span
								class="inline-flex h-4 shrink-0 items-center rounded border px-1 text-[9px] font-semibold leading-none {typeBadgeClass(category)}"
								title={columnTypes[col] || 'unknown'}
							>
								{typeLabel(category)}
							</span>
							<span class="truncate text-xs font-semibold text-zinc-700 dark:text-zinc-300">{col}</span>
							{#if sortColumn === col}
								{#if sortDirection === 'asc'}
									<ArrowUpIcon class="size-3 shrink-0 text-blue-500" />
								{:else if sortDirection === 'desc'}
									<ArrowDownIcon class="size-3 shrink-0 text-blue-500" />
								{/if}
							{/if}
						</div>
						{#if columnTypes[col]}
							<div class="mt-0.5 truncate text-[10px] font-normal text-zinc-400 dark:text-zinc-500">
								{columnTypes[col]}
							</div>
						{/if}
						<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
						<div
							class="absolute end-0 top-0 h-full w-1.5 cursor-col-resize bg-transparent transition-colors hover:bg-blue-400/60"
							onmousedown={(e) => startResize(col, e)}
							ondblclick={(e) => { e.stopPropagation(); resetWidth(col); }}
							role="separator"
							aria-orientation="vertical"
						></div>
					</th>
				{/each}
			</tr>
		</thead>

		<tbody>
			{#each displayRows as row, i (i)}
				<tr class="hover:bg-blue-50/50 dark:hover:bg-zinc-800/40">
					<td
						class="border-b border-e border-zinc-100 px-2 py-1 text-xs tabular-nums text-zinc-400 dark:border-zinc-800 dark:text-zinc-600"
					>
						{i + 1}
					</td>
					{#each columns as col}
						{@const category = columnCategories[col]}
						{@const cellValue = row[col]}
						{@const cellIsNull = isNull(cellValue)}
						<td
							class="overflow-hidden text-ellipsis whitespace-nowrap border-b border-e border-zinc-100 px-3 py-1 text-[13px] dark:border-zinc-800"
							class:text-end={category === 'number' && !cellIsNull}
							class:font-mono={category === 'number' && !cellIsNull}
							title={cellIsNull ? 'NULL' : formatCell(cellValue, category)}
							oncontextmenu={(e) => handleContextMenu(e, cellValue, row, col)}
						>
							{#if cellIsNull}
								<span class="text-[11px] italic text-zinc-400 dark:text-zinc-600">null</span>
							{:else if typeof cellValue === 'boolean'}
								{#if cellValue}
									<CheckIcon class="inline size-3.5 text-green-500" />
								{:else}
									<XIcon class="inline size-3.5 text-red-400" />
								{/if}
							{:else}
								<span class="text-zinc-800 dark:text-zinc-200">
									{formatCell(cellValue, category)}
								</span>
							{/if}
						</td>
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>

	{#if renderedCount < rows.length}
		<div class="py-2 text-center text-xs text-zinc-400 dark:text-zinc-600">
			{t('statusBar.rowsLabel')}: {renderedCount.toLocaleString()} / {rows.length.toLocaleString()} — scroll for more
		</div>
	{/if}
</div>

<!-- Context menu -->
{#if ctxMenu}
	<div
		class="fixed z-50 min-w-40 rounded-lg border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-800"
		style="left: {ctxMenu.x}px; top: {ctxMenu.y}px;"
		role="menu"
	>
		<button
			class="flex w-full items-center gap-2 px-3 py-1.5 text-start text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700"
			onclick={copyCell}
			role="menuitem"
		>
			<ClipboardIcon class="size-3.5 text-zinc-400" />
			{t('table.copyCell')}
		</button>
		<button
			class="flex w-full items-center gap-2 px-3 py-1.5 text-start text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700"
			onclick={copyRow}
			role="menuitem"
		>
			<RowsIcon class="size-3.5 text-zinc-400" />
			{t('table.copyRow')}
		</button>
		<button
			class="flex w-full items-center gap-2 px-3 py-1.5 text-start text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700"
			onclick={copyColumn}
			role="menuitem"
		>
			<ColumnsIcon class="size-3.5 text-zinc-400" />
			{t('table.copyColumn')}
		</button>
		{#if copied}
			<div class="border-t border-zinc-200 px-3 py-1 text-center text-[10px] text-green-500 dark:border-zinc-700">
				Copied!
			</div>
		{/if}
	</div>
{/if}
