<script lang="ts">
import ClockIcon from '@lucide/svelte/icons/clock';
import { onDestroy } from 'svelte';
import SqlEditor from '$lib/components/editor/SqlEditor.svelte';
import { Badge } from '$lib/components/ui/badge/index.js';
import { Button } from '$lib/components/ui/button/index.js';
import { t } from '$lib/i18n/index.svelte.js';
import { getQueryEngine } from '$lib/query/index.js';
import { getAdapter } from '$lib/storage/index.js';
import { tabResources } from '$lib/stores/tab-resources.svelte.js';
import type { Tab } from '$lib/types';
import TableGrid from './TableGrid.svelte';

let { tab }: { tab: Tab } = $props();

let loading = $state(true);
let error = $state<string | null>(null);
let tables = $state<string[]>([]);
let schemas = $state<string[]>([]);
let selectedSchema = $state<string>('main');
let selectedTable = $state<string | null>(null);
let columns = $state<string[]>([]);
let rows = $state<Record<string, any>[]>([]);
let tableLoading = $state(false);
let showSql = $state(false);

// DuckLake state: true for .ducklake files, auto-detected for .duckdb files
let isDuckLake = $state(false);
let snapshotVersion = $state<number | null>(null);
let snapshotTimestamp = $state<string | null>(null);
let snapshotCount = $state<number>(0);

const ATTACH_ALIAS = '__objex_db__';

// Virtual filesystem path for the downloaded catalog file
const VFS_PATH = `/${ATTACH_ALIAS}.duckdb`;

// DuckLake catalog tables used for auto-detection
const DUCKLAKE_MARKER_TABLES = ['ducklake_table', 'ducklake_schema', 'ducklake_snapshot'];

$effect(() => {
	if (!tab) return;
	loadDatabase();
});

function cleanup() {
	tables = [];
	schemas = [];
	rows = [];
	columns = [];
	selectedTable = null;
	isDuckLake = false;
	snapshotVersion = null;
	snapshotTimestamp = null;
	snapshotCount = 0;
}

$effect(() => {
	if (!tab) return;
	const unregister = tabResources.register(tab.id, cleanup);
	return unregister;
});

onDestroy(cleanup);

/**
 * Download the database file using the authenticated storage adapter
 * and register it in DuckDB-WASM's virtual filesystem.
 * DuckDB's ATTACH doesn't use httpfs S3 config, so we must download first.
 */
async function downloadAndRegister(engine: any): Promise<void> {
	const adapter = getAdapter(tab.source, tab.connectionId);
	const buffer = await adapter.read(tab.path);
	if (engine.registerFileBuffer) {
		// Drop any previously registered file with the same VFS path
		if (engine.dropFile) {
			await engine.dropFile(VFS_PATH);
		}
		await engine.registerFileBuffer(VFS_PATH, buffer);
	}
}

async function loadDatabase() {
	loading = true;
	error = null;

	try {
		const engine = await getQueryEngine();
		const connId = tab.connectionId ?? '';
		const ext = tab.extension.toLowerCase();

		if (ext === 'ducklake' || ext === 'duckdb') {
			// Download and register in DuckDB-WASM's VFS for ATTACH
			await downloadAndRegister(engine);

			if (ext === 'ducklake') {
				isDuckLake = true;
				await loadDuckLake(engine, connId);
			} else {
				// .duckdb: auto-detect if it's a DuckLake catalog
				const detected = await tryDetectDuckLake(engine, connId);
				if (detected) {
					isDuckLake = true;
					await loadDuckLake(engine, connId);
				} else {
					isDuckLake = false;
					const result = await engine.query(
						connId,
						`ATTACH '${VFS_PATH}' AS ${ATTACH_ALIAS} (READ_ONLY); SHOW TABLES;`
					);
					tables = (result.rows ?? [])
						.map((row) => row.name)
						.filter((name): name is string => !!name);
				}
			}
		} else {
			// SQLite via DuckDB's sqlite scanner
			const result = await engine.query(
				connId,
				`INSTALL sqlite; LOAD sqlite; SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;`
			);
			tables = (result.rows ?? []).map((row) => row.name).filter((name): name is string => !!name);
		}
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	} finally {
		loading = false;
	}
}

/**
 * Probe a .duckdb file to check if it's a DuckLake catalog.
 * Attaches as regular DuckDB, checks for DuckLake system tables,
 * then detaches so loadDuckLake can re-attach with TYPE ducklake.
 */
async function tryDetectDuckLake(engine: any, connId: string): Promise<boolean> {
	try {
		await engine.query(connId, `ATTACH '${VFS_PATH}' AS ${ATTACH_ALIAS} (READ_ONLY);`);
		const result = await engine.query(
			connId,
			`SELECT table_name FROM information_schema.tables WHERE table_catalog = '${ATTACH_ALIAS}' AND table_name IN ('${DUCKLAKE_MARKER_TABLES.join("','")}');`
		);
		// Detach before re-attaching as DuckLake
		try {
			await engine.query(connId, `DETACH ${ATTACH_ALIAS};`);
		} catch {
			// ignore
		}
		const found = (result.rows ?? []).map((r: any) => r.table_name);
		// If at least 2 DuckLake system tables are present, it's a DuckLake catalog
		return found.length >= 2;
	} catch {
		// If attach fails or query fails, not a DuckLake catalog
		try {
			await engine.query(connId, `DETACH ${ATTACH_ALIAS};`);
		} catch {
			// ignore
		}
		return false;
	}
}

async function loadDuckLake(engine: any, connId: string) {
	// Detach any previous catalog (ignore errors)
	try {
		await engine.query(connId, `DETACH ${ATTACH_ALIAS};`);
	} catch {
		// ignore
	}

	// Attach the DuckLake catalog from VFS. The ducklake extension autoloads.
	await engine.query(connId, `ATTACH '${VFS_PATH}' AS ${ATTACH_ALIAS} (TYPE ducklake, READ_ONLY);`);

	// Load snapshot metadata
	try {
		const snapResult = await engine.query(
			connId,
			`SELECT snapshot_id, snapshot_time FROM ducklake_snapshots('${ATTACH_ALIAS}') ORDER BY snapshot_id DESC LIMIT 1;`
		);
		if (snapResult.rows?.length > 0) {
			snapshotVersion = snapResult.rows[0].snapshot_id;
			const ts = snapResult.rows[0].snapshot_time;
			snapshotTimestamp = ts ? String(ts) : null;
		}
		const countResult = await engine.query(
			connId,
			`SELECT COUNT(*)::INT AS cnt FROM ducklake_snapshots('${ATTACH_ALIAS}');`
		);
		if (countResult.rows?.length > 0) {
			snapshotCount = countResult.rows[0].cnt ?? 0;
		}
	} catch {
		// Snapshot queries may fail on very old DuckLake specs
	}

	// Discover schemas
	try {
		const schemaResult = await engine.query(
			connId,
			`SELECT DISTINCT schema_name FROM (DESCRIBE) WHERE database = '${ATTACH_ALIAS}' ORDER BY schema_name;`
		);
		schemas = (schemaResult.rows ?? [])
			.map((r: any) => r.schema_name)
			.filter((s: any): s is string => !!s);
		if (schemas.length === 0) schemas = ['main'];
	} catch {
		schemas = ['main'];
	}

	// Load tables for selected schema
	await loadDuckLakeTables(engine, connId);
}

async function loadDuckLakeTables(engine: any, connId: string) {
	const result = await engine.query(
		connId,
		`SELECT table_name FROM (DESCRIBE) WHERE database = '${ATTACH_ALIAS}' AND schema_name = '${selectedSchema}' ORDER BY table_name;`
	);
	tables = (result.rows ?? [])
		.map((r: any) => r.table_name)
		.filter((name: any): name is string => !!name);
}

async function switchSchema(schema: string) {
	selectedSchema = schema;
	selectedTable = null;
	columns = [];
	rows = [];
	tableLoading = true;

	try {
		const engine = await getQueryEngine();
		const connId = tab.connectionId ?? '';
		await loadDuckLakeTables(engine, connId);
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	} finally {
		tableLoading = false;
	}
}

async function selectTable(tableName: string) {
	selectedTable = tableName;
	tableLoading = true;

	try {
		const engine = await getQueryEngine();
		const connId = tab.connectionId ?? '';

		let fromClause: string;
		if (isDuckLake) {
			fromClause = `${ATTACH_ALIAS}."${selectedSchema}"."${tableName}"`;
		} else {
			fromClause = `"${tableName}"`;
		}

		const result = await engine.query(connId, `SELECT * FROM ${fromClause} LIMIT 1000`);
		columns = result.columns;
		rows = result.rows ?? [];
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
		{#if isDuckLake}
			<Badge variant="secondary" class="bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200">DuckLake</Badge>
		{:else}
			<Badge variant="secondary">{t('database.badge')}</Badge>
		{/if}
		{#if tables.length > 0}
			<span class="hidden text-xs text-zinc-400 sm:inline">{tables.length} {t('database.tables')}</span>
		{/if}
		{#if isDuckLake && snapshotVersion !== null}
			<span class="hidden items-center gap-1 text-xs text-zinc-400 sm:inline-flex">
				<ClockIcon class="h-3 w-3" />
				v{snapshotVersion}
				{#if snapshotCount > 1}
					({snapshotCount} {t('ducklake.snapshots')})
				{/if}
			</span>
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
				<p class="text-sm text-zinc-400">{isDuckLake ? t('ducklake.loading') : t('database.loading')}</p>
			</div>
		{:else if error}
			<div class="flex flex-1 items-center justify-center p-4">
				<div class="max-w-md text-center">
					<p class="text-sm text-red-400">{error}</p>
					{#if isDuckLake && error.includes('ducklake')}
						<p class="mt-2 text-xs text-zinc-500">{t('ducklake.extensionHint')}</p>
					{/if}
				</div>
			</div>
		{:else}
			<!-- Table list sidebar -->
			<div
				class="w-56 shrink-0 overflow-auto border-e border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900"
			>
				{#if isDuckLake && schemas.length > 1}
					<div class="border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
						<select
							class="w-full rounded bg-white px-2 py-1 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
							onchange={(e) => switchSchema(e.currentTarget.value)}
						>
							{#each schemas as schema}
								<option value={schema} selected={schema === selectedSchema}>{schema}</option>
							{/each}
						</select>
					</div>
				{/if}
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
				{#if tables.length === 0}
					<div class="px-3 py-4 text-center text-xs text-zinc-400">
						{isDuckLake ? t('ducklake.noTables') : t('database.selectTable')}
					</div>
				{/if}
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
