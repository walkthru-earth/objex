<script lang="ts">
import { Chart, registerables } from 'chart.js';
import TableGrid from '$lib/components/viewers/TableGrid.svelte';

// Register Chart.js components
Chart.register(...registerables);

let {
	columns,
	rows,
	queryName = '',
	error = null
}: {
	columns: string[];
	rows: Record<string, any>[];
	queryName?: string;
	error?: string | null;
} = $props();

let viewMode = $state<'table' | 'chart'>('table');
let chartType = $state<'bar' | 'line' | 'pie'>('bar');
let canvasEl: HTMLCanvasElement | undefined = $state();
let chart: Chart | null = null;

// Auto-detect chart type from columns
const detectedChartType = $derived.by(() => {
	if (columns.length < 2) return null;
	const firstCol = columns[0];
	const sampleValue = rows[0]?.[firstCol];

	if (typeof sampleValue === 'string') {
		return rows.length <= 10 ? 'pie' : 'bar';
	}
	if (
		sampleValue instanceof Date ||
		(typeof sampleValue === 'string' && !Number.isNaN(Date.parse(sampleValue)))
	) {
		return 'line';
	}
	return 'bar';
});

$effect(() => {
	if (detectedChartType) chartType = detectedChartType;
});

$effect(() => {
	if (viewMode === 'chart' && canvasEl && columns.length >= 2) {
		renderChart();
	}
	return () => {
		chart?.destroy();
		chart = null;
	};
});

function renderChart() {
	if (!canvasEl) return;
	chart?.destroy();

	const labels = rows.map((r) => String(r[columns[0]]));
	const data = rows.map((r) => Number(r[columns[1]]) || 0);

	const colors = rows.map((_, i) => {
		const hue = (i * 137) % 360;
		return `hsl(${hue}, 65%, 55%)`;
	});

	chart = new Chart(canvasEl, {
		type: chartType,
		data: {
			labels,
			datasets: [
				{
					label: columns[1],
					data,
					backgroundColor: chartType === 'pie' ? colors : 'rgba(59, 130, 246, 0.6)',
					borderColor: chartType === 'pie' ? colors : 'rgba(59, 130, 246, 1)',
					borderWidth: 1
				}
			]
		},
		options: {
			responsive: true,
			maintainAspectRatio: false,
			plugins: {
				legend: {
					display: chartType === 'pie',
					labels: { color: '#9ca3af' }
				}
			},
			scales:
				chartType !== 'pie'
					? {
							x: { ticks: { color: '#9ca3af' }, grid: { color: '#374151' } },
							y: { ticks: { color: '#9ca3af' }, grid: { color: '#374151' } }
						}
					: undefined
		}
	});
}

function downloadCsv() {
	const header = columns.join(',');
	const csvRows = rows.map((row) =>
		columns
			.map((col) => {
				const val = row[col];
				if (val === null || val === undefined) return '';
				const str = String(val);
				return str.includes(',') || str.includes('"') || str.includes('\n')
					? `"${str.replace(/"/g, '""')}"`
					: str;
			})
			.join(',')
	);
	const csv = [header, ...csvRows].join('\n');
	const blob = new Blob([csv], { type: 'text/csv' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `${queryName || 'query'}.csv`;
	a.click();
	URL.revokeObjectURL(url);
}
</script>

<div class="my-4 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
	{#if error}
		<div class="bg-red-50 p-3 dark:bg-red-950">
			<pre class="whitespace-pre-wrap font-mono text-xs text-red-600 dark:text-red-400">{error}</pre>
		</div>
	{:else}
		<!-- Header -->
		<div class="flex items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-3 py-1.5 dark:border-zinc-700 dark:bg-zinc-800">
			{#if queryName}
				<span class="text-xs font-medium text-zinc-500 dark:text-zinc-400">{queryName}</span>
			{/if}
			<span class="text-xs text-zinc-400">{rows.length} rows</span>

			<div class="ml-auto flex items-center gap-1">
				<button
					class="rounded px-2 py-0.5 text-xs"
					class:bg-blue-100={viewMode === 'table'}
					class:text-blue-700={viewMode === 'table'}
					class:dark:bg-blue-900={viewMode === 'table'}
					class:dark:text-blue-300={viewMode === 'table'}
					class:text-zinc-400={viewMode !== 'table'}
					onclick={() => (viewMode = 'table')}
				>
					Table
				</button>
				{#if columns.length >= 2}
					<button
						class="rounded px-2 py-0.5 text-xs"
						class:bg-blue-100={viewMode === 'chart'}
						class:text-blue-700={viewMode === 'chart'}
						class:dark:bg-blue-900={viewMode === 'chart'}
						class:dark:text-blue-300={viewMode === 'chart'}
						class:text-zinc-400={viewMode !== 'chart'}
						onclick={() => (viewMode = 'chart')}
					>
						Chart
					</button>
				{/if}

				{#if viewMode === 'chart'}
					<select
						class="ml-2 rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-xs dark:border-zinc-600 dark:bg-zinc-700"
						bind:value={chartType}
						onchange={() => renderChart()}
					>
						<option value="bar">Bar</option>
						<option value="line">Line</option>
						<option value="pie">Pie</option>
					</select>
				{/if}

				<button
					class="ml-2 rounded px-2 py-0.5 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
					onclick={downloadCsv}
				>
					CSV
				</button>
			</div>
		</div>

		<!-- Content -->
		<div style="max-height: 400px;" class="overflow-hidden">
			{#if viewMode === 'table'}
				<TableGrid {columns} {rows} />
			{:else}
				<div class="p-4" style="height: 300px;">
					<canvas bind:this={canvasEl}></canvas>
				</div>
			{/if}
		</div>
	{/if}
</div>
