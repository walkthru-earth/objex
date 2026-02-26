<script lang="ts">
import { format as formatSql } from 'sql-formatter';
import { onDestroy } from 'svelte';
import { Button } from '$lib/components/ui/button/index.js';
import TableGrid from '$lib/components/viewers/TableGrid.svelte';
import TableStatusBar from '$lib/components/viewers/TableStatusBar.svelte';
import { getQueryEngine, QueryCancelledError, type QueryHandle } from '$lib/query/index.js';
import { queryHistory } from '$lib/stores/query-history.svelte.js';
import CodeMirrorEditor from './CodeMirrorEditor.svelte';

let {
	connId = '',
	initialSql = ''
}: {
	connId?: string;
	initialSql?: string;
} = $props();

// svelte-ignore state_referenced_locally
let queryText = $state(initialSql || 'SELECT 1 as hello');
let columns = $state<string[]>([]);
let rows = $state<Record<string, any>[]>([]);
let error = $state<string | null>(null);
let running = $state(false);
let rowCount = $state(0);
let executionTime = $state(0);
let activeHandle: QueryHandle | null = null;

onDestroy(() => {
	activeHandle?.cancel();
	activeHandle = null;
});

async function cancelQuery() {
	if (activeHandle) {
		await activeHandle.cancel();
	}
}

async function runQuery() {
	error = null;
	columns = [];
	rows = [];
	running = true;

	const start = performance.now();

	try {
		const engine = await getQueryEngine();

		if (engine.queryCancellable) {
			const handle = engine.queryCancellable(connId, queryText);
			activeHandle = handle;
			try {
				const result = await handle.result;
				executionTime = Math.round(performance.now() - start);
				columns = result.columns;
				rowCount = result.rowCount;
				rows = result.rows ?? [];
			} finally {
				activeHandle = null;
			}
		} else {
			const result = await engine.query(connId, queryText);
			executionTime = Math.round(performance.now() - start);
			columns = result.columns;
			rowCount = result.rowCount;
			rows = result.rows ?? [];
		}

		queryHistory.add({
			sql: queryText,
			timestamp: Date.now(),
			durationMs: executionTime,
			rowCount,
			connectionId: connId || undefined
		});
	} catch (err) {
		executionTime = Math.round(performance.now() - start);

		if (err instanceof QueryCancelledError) {
			error = null;
		} else {
			error = err instanceof Error ? err.message : String(err);
			queryHistory.add({
				sql: queryText,
				timestamp: Date.now(),
				durationMs: executionTime,
				rowCount: 0,
				error: error ?? undefined,
				connectionId: connId || undefined
			});
		}
	} finally {
		activeHandle = null;
		running = false;
	}
}

function handleSqlChange(val: string) {
	queryText = val;
}

function handleFormatSql() {
	try {
		queryText = formatSql(queryText, { language: 'sql' });
	} catch {
		// ignore format errors
	}
}
</script>

<div class="flex h-full flex-col">
	<div class="flex items-center justify-between border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
		<h2 class="text-sm font-medium text-foreground">SQL Console</h2>
		<div class="flex items-center gap-2">
			{#if rowCount > 0 && !running}
				<span class="text-xs text-zinc-400">
					{rowCount.toLocaleString()} rows in {executionTime}ms
				</span>
			{/if}
			<Button size="sm" variant="outline" onclick={handleFormatSql} disabled={running}>
				Format
			</Button>
			{#if running}
				<Button size="sm" variant="destructive" onclick={cancelQuery}>
					Cancel
				</Button>
			{:else}
				<Button size="sm" onclick={runQuery}>
					Run
				</Button>
			{/if}
		</div>
	</div>

	<div class="shrink-0 border-b border-zinc-200 p-2 dark:border-zinc-800">
		<CodeMirrorEditor
			value={queryText}
			onChange={handleSqlChange}
			onExecute={runQuery}
			placeholder="Enter SQL query... (Ctrl+Enter to run)"
			minHeight="80px"
		/>
	</div>

	<div class="flex flex-1 flex-col overflow-hidden">
		{#if running}
			<div class="flex flex-1 items-center justify-center">
				<p class="text-sm text-zinc-400">Running query...</p>
			</div>
		{:else if error}
			<div class="flex-1 overflow-auto p-4">
				<pre class="whitespace-pre-wrap rounded-md bg-red-50 p-3 font-mono text-sm text-red-600 dark:bg-red-950 dark:text-red-400">{error}</pre>
			</div>
		{:else if columns.length > 0}
			<TableGrid {columns} {rows} totalRows={rowCount} />
		{:else}
			<div class="flex flex-1 items-center justify-center">
				<p class="text-sm text-zinc-400">Press Ctrl+Enter or click Run to execute a query.</p>
			</div>
		{/if}
	</div>

	<TableStatusBar
		rowCount={rowCount}
		executionTimeMs={executionTime}
		loading={running}
		{columns}
		{rows}
		fileName="sql-query"
	/>
</div>
