<script lang="ts">
import { tableFromIPC } from 'apache-arrow';
import SqlEditor from '$lib/components/editor/SqlEditor.svelte';
import { getQueryEngine } from '$lib/query/index.js';
import { getAdapter } from '$lib/storage/index.js';
import type { Tab } from '$lib/types';
import TableGrid from './TableGrid.svelte';

let { tab }: { tab: Tab } = $props();

let loading = $state(true);
let error = $state<string | null>(null);
let tables = $state<string[]>([]);
let selectedTable = $state<string | null>(null);
let columns = $state<string[]>([]);
let rows = $state<Record<string, any>[]>([]);
let tableLoading = $state(false);
let showSql = $state(false);

$effect(() => {
	if (!tab) return;
	loadDatabase();
});

async function loadDatabase() {
	loading = true;
	error = null;

	try {
		// For DuckDB/SQLite files, we load them into DuckDB-WASM
		const engine = await getQueryEngine();
		const connId = tab.connectionId ?? '';

		// Register the database file with DuckDB
		// For .duckdb files, attach directly
		// For .sqlite files, use sqlite scanner
		const ext = tab.extension.toLowerCase();

		if (ext === 'duckdb') {
			// DuckDB native file
			const adapter = getAdapter(tab.source, tab.connectionId);
			const data = await adapter.read(tab.path);
			// We'd need to register this file with DuckDB — for now query via path
			const result = await engine.query(
				connId,
				`ATTACH '${tab.path}' AS db (READ_ONLY); SHOW TABLES;`
			);
			if (result.arrowBytes.length > 0) {
				const table = tableFromIPC(result.arrowBytes);
				tables = [];
				for (let i = 0; i < table.numRows; i++) {
					const name = table.getChild('name')?.get(i);
					if (name) tables.push(name);
				}
			}
		} else {
			// SQLite via DuckDB's sqlite scanner
			const result = await engine.query(
				connId,
				`INSTALL sqlite; LOAD sqlite; SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;`
			);
			if (result.arrowBytes.length > 0) {
				const table = tableFromIPC(result.arrowBytes);
				tables = [];
				for (let i = 0; i < table.numRows; i++) {
					const name = table.getChild('name')?.get(i);
					if (name) tables.push(name);
				}
			}
		}
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	} finally {
		loading = false;
	}
}

async function selectTable(tableName: string) {
	selectedTable = tableName;
	tableLoading = true;

	try {
		const engine = await getQueryEngine();
		const connId = tab.connectionId ?? '';
		const result = await engine.query(connId, `SELECT * FROM "${tableName}" LIMIT 100`);

		if (result.arrowBytes.length > 0) {
			const table = tableFromIPC(result.arrowBytes);
			columns = table.schema.fields.map((f) => f.name);
			const newRows: Record<string, any>[] = [];
			for (let i = 0; i < table.numRows; i++) {
				const row: Record<string, any> = {};
				for (const col of columns) {
					row[col] = table.getChild(col)?.get(i);
				}
				newRows.push(row);
			}
			rows = newRows;
		}
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	} finally {
		tableLoading = false;
	}
}
</script>

<div class="flex h-full flex-col">
	<div
		class="flex items-center gap-2 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800"
	>
		<span class="text-sm font-medium text-zinc-700 dark:text-zinc-300">{tab.name}</span>
		<span
			class="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
		>
			Database
		</span>
		{#if tables.length > 0}
			<span class="text-xs text-zinc-400">{tables.length} tables</span>
		{/if}

		<div class="ml-auto">
			<button
				class="rounded px-2 py-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
				class:text-blue-500={showSql}
				class:text-zinc-400={!showSql}
				onclick={() => (showSql = !showSql)}
			>
				SQL
			</button>
		</div>
	</div>

	<div class="flex flex-1 overflow-hidden">
		{#if loading}
			<div class="flex flex-1 items-center justify-center">
				<p class="text-sm text-zinc-400">Loading database...</p>
			</div>
		{:else if error}
			<div class="flex flex-1 items-center justify-center">
				<p class="text-sm text-red-400">{error}</p>
			</div>
		{:else}
			<!-- Table list -->
			<div
				class="w-56 shrink-0 overflow-auto border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900"
			>
				<div class="border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
					<h3 class="text-xs font-medium text-zinc-500 dark:text-zinc-400">Tables</h3>
				</div>
				{#each tables as tableName}
					<button
						class="flex w-full items-center px-3 py-1.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
						class:bg-blue-50={selectedTable === tableName}
						class:dark:bg-blue-950={selectedTable === tableName}
						onclick={() => selectTable(tableName)}
					>
						<span class="text-zinc-700 dark:text-zinc-300">{tableName}</span>
					</button>
				{/each}
			</div>

			<!-- Content -->
			<div class="flex flex-1 flex-col overflow-hidden">
				{#if showSql}
					<div class="flex-1">
						<SqlEditor connId={tab.connectionId ?? ''} />
					</div>
				{:else if tableLoading}
					<div class="flex flex-1 items-center justify-center">
						<p class="text-sm text-zinc-400">Loading table...</p>
					</div>
				{:else if selectedTable && columns.length > 0}
					<TableGrid {columns} {rows} />
				{:else}
					<div class="flex flex-1 items-center justify-center">
						<p class="text-sm text-zinc-400">Select a table to browse</p>
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>
