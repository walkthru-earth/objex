<script lang="ts">
import { tableFromIPC } from 'apache-arrow';
import SqlEditor from '$lib/components/editor/SqlEditor.svelte';
import { Badge } from '$lib/components/ui/badge/index.js';
import { Button } from '$lib/components/ui/button/index.js';
import { t } from '$lib/i18n/index.svelte.js';
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
		class="flex items-center gap-1 border-b border-zinc-200 px-2 py-1.5 sm:gap-2 sm:px-4 dark:border-zinc-800"
	>
		<span class="truncate max-w-[120px] text-sm font-medium text-zinc-700 sm:max-w-none dark:text-zinc-300">{tab.name}</span>
		<Badge variant="secondary">{t('database.badge')}</Badge>
		{#if tables.length > 0}
			<span class="hidden text-xs text-zinc-400 sm:inline">{tables.length} {t('database.tables')}</span>
		{/if}

		<div class="ms-auto">
			<Button
				variant="ghost"
				size="sm"
				class="h-7 px-2 text-xs {showSql ? 'text-blue-500' : ''}"
				onclick={() => (showSql = !showSql)}
			>
				{t('database.sql')}
			</Button>
		</div>
	</div>

	<div class="flex flex-1 overflow-hidden">
		{#if loading}
			<div class="flex flex-1 items-center justify-center">
				<p class="text-sm text-zinc-400">{t('database.loading')}</p>
			</div>
		{:else if error}
			<div class="flex flex-1 items-center justify-center">
				<p class="text-sm text-red-400">{error}</p>
			</div>
		{:else}
			<!-- Table list -->
			<div
				class="w-56 shrink-0 overflow-auto border-e border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900"
			>
				<div class="border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
					<h3 class="text-xs font-medium text-zinc-500 dark:text-zinc-400">{t('database.tablesHeader')}</h3>
				</div>
				{#each tables as tableName}
					<button
						class="flex w-full items-center px-3 py-1.5 text-start text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
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
						<p class="text-sm text-zinc-400">{t('database.loadingTable')}</p>
					</div>
				{:else if selectedTable && columns.length > 0}
					<TableGrid {columns} {rows} />
				{:else}
					<div class="flex flex-1 items-center justify-center">
						<p class="text-sm text-zinc-400">{t('database.selectTable')}</p>
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>
