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
import TableViewer from './TableViewer.svelte';

let { tab }: { tab: Tab } = $props();

let loading = $state(true);
let error = $state<string | null>(null);
let tables = $state<string[]>([]);
let schemas = $state<string[]>([]);
let selectedSchema = $state<string>('main');
let selectedTable = $state<string | null>(null);
let showSql = $state(false);

/**
 * Synthetic tab for the embedded TableViewer. Rebuilt whenever the user
 * picks a different table, so TableViewer sees a new `tab.id` and runs its
 * normal load lifecycle (including tabResources cleanup of the previous).
 */
let childTab = $state<Tab | null>(null);

// DuckLake state: true for .ducklake files, auto-detected for .duckdb files
let isDuckLake = $state(false);
let snapshots = $state.raw<Array<{ id: number; timeMs: number | null }>>([]);
let snapshotVersion = $state<number | null>(null);
let snapshotTimeMs = $state<number | null>(null);
let switchingSnapshot = $state(false);

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
	selectedTable = null;
	childTab = null;
	isDuckLake = false;
	snapshots = [];
	snapshotVersion = null;
	snapshotTimeMs = null;
	switchingSnapshot = false;
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

async function loadDuckLake(engine: any, connId: string, snapshotId: number | null = null) {
	// Detach any previous catalog (ignore errors)
	try {
		await engine.query(connId, `DETACH ${ATTACH_ALIAS};`);
	} catch {
		// ignore
	}

	// When snapshotId is given, attach at that snapshot for time travel; otherwise
	// DuckLake attaches at the latest snapshot.
	const snapshotClause = snapshotId !== null ? `, SNAPSHOT_VERSION ${snapshotId}` : '';
	await engine.query(
		connId,
		`ATTACH '${VFS_PATH}' AS ${ATTACH_ALIAS} (TYPE ducklake, READ_ONLY${snapshotClause});`
	);

	// Snapshot history is immutable for a read-only attached catalog, so only
	// query it on first load; switching snapshots reuses the cached list.
	if (snapshots.length === 0) {
		try {
			const snapResult = await engine.query(
				connId,
				`SELECT snapshot_id, snapshot_time FROM ducklake_snapshots('${ATTACH_ALIAS}') ORDER BY snapshot_id DESC;`
			);
			const rows = snapResult.rows ?? [];
			snapshots = rows.map((r: any) => ({
				id: Number(r.snapshot_id),
				timeMs: coerceTimestampMs(r.snapshot_time)
			}));
		} catch {
			// Snapshot queries may fail on very old DuckLake specs; fall back silently.
			snapshots = [];
		}
	}
	const current = snapshotId !== null ? snapshots.find((s) => s.id === snapshotId) : snapshots[0];
	if (current) {
		snapshotVersion = current.id;
		snapshotTimeMs = current.timeMs;
	}

	// Discover schemas
	try {
		const schemaResult = await engine.query(
			connId,
			`SELECT DISTINCT "schema" AS schema_name FROM (DESCRIBE) WHERE database = '${ATTACH_ALIAS}' ORDER BY "schema";`
		);
		schemas = (schemaResult.rows ?? [])
			.map((r: any) => r.schema_name)
			.filter((s: any): s is string => !!s);
		if (schemas.length === 0) schemas = ['main'];
	} catch {
		schemas = ['main'];
	}

	// Align selectedSchema with the discovered list. DuckLake catalogs often
	// use 'default' or a user-named schema, not 'main', so the initial value
	// would otherwise produce an empty table list until the user manually
	// switches via the dropdown.
	if (!schemas.includes(selectedSchema)) {
		selectedSchema = schemas[0];
	}

	// Load tables for selected schema
	await loadDuckLakeTables(engine, connId);
}

async function loadDuckLakeTables(engine: any, connId: string) {
	const result = await engine.query(
		connId,
		`SELECT "name" AS table_name FROM (DESCRIBE) WHERE database = '${ATTACH_ALIAS}' AND "schema" = '${selectedSchema}' ORDER BY "name";`
	);
	tables = (result.rows ?? [])
		.map((r: any) => r.table_name)
		.filter((name: any): name is string => !!name);
}

async function switchSnapshot(id: number) {
	if (id === snapshotVersion) return;
	switchingSnapshot = true;
	error = null;
	// Clear the currently-open table so TableViewer tears down and re-renders
	// against the new catalog state.
	selectedTable = null;
	childTab = null;
	try {
		const engine = await getQueryEngine();
		const connId = tab.connectionId ?? '';
		await loadDuckLake(engine, connId, id);
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	} finally {
		switchingSnapshot = false;
	}
}

/**
 * DuckDB-WASM returns TIMESTAMP in different shapes depending on the driver
 * path: BigInt microseconds (Arrow int64), Number milliseconds, Date object,
 * or ISO string. Normalize all of them to epoch milliseconds so downstream
 * formatting has a single code path.
 */
function coerceTimestampMs(raw: unknown): number | null {
	if (raw === null || raw === undefined) return null;
	if (raw instanceof Date) {
		const t = raw.getTime();
		return Number.isNaN(t) ? null : t;
	}
	if (typeof raw === 'bigint') {
		// DuckDB TIMESTAMP is microseconds since epoch.
		return Number(raw / 1000n);
	}
	// Heuristic: > 1e14 is microseconds (any year past 5138 in ms is unrealistic)
	const msFromEpochNumber = (n: number) => (n > 1e14 ? Math.floor(n / 1000) : n);
	if (typeof raw === 'number') {
		return Number.isFinite(raw) ? msFromEpochNumber(raw) : null;
	}
	if (typeof raw === 'string') {
		const trimmed = raw.trim();
		if (/^\d+$/.test(trimmed)) {
			const n = Number(trimmed);
			return Number.isFinite(n) ? msFromEpochNumber(n) : null;
		}
		const parsed = Date.parse(trimmed);
		return Number.isNaN(parsed) ? null : parsed;
	}
	return null;
}

function formatSnapshotTime(ms: number | null): string | null {
	if (ms === null) return null;
	const d = new Date(ms);
	if (Number.isNaN(d.getTime())) return null;
	return `${d
		.toISOString()
		.replace('T', ' ')
		.replace(/\.\d+Z$/, '')} UTC`;
}

function formatSnapshotLabel(s: { id: number; timeMs: number | null }): string {
	const time = formatSnapshotTime(s.timeMs);
	return time ? `v${s.id} (${time})` : `v${s.id}`;
}

async function switchSchema(schema: string) {
	selectedSchema = schema;
	selectedTable = null;
	childTab = null;

	try {
		const engine = await getQueryEngine();
		const connId = tab.connectionId ?? '';
		await loadDuckLakeTables(engine, connId);
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	}
}

/**
 * Build the FROM-clause target for a table inside the attached database.
 * For DuckLake/DuckDB we fully-qualify via the attach alias and schema;
 * for SQLite, the scanner exposes tables by bare name in the main catalog.
 */
function buildSourceRef(tableName: string): string {
	// DuckLake / .duckdb tables live inside the attach alias; SQLite's scanner
	// exposes tables by bare name in the main catalog.
	const ext = tab.extension.toLowerCase();
	if (isDuckLake || ext === 'duckdb') {
		return `${ATTACH_ALIAS}."${selectedSchema}"."${tableName}"`;
	}
	return `"${tableName}"`;
}

function selectTable(tableName: string) {
	selectedTable = tableName;
	const ref = buildSourceRef(tableName);
	// Synthetic tab: unique id per (db-tab, schema, table) so TableViewer
	// re-runs its $effect-driven load and tabResources cleanup fires on
	// the previous selection.
	childTab = {
		id: `${tab.id}::${selectedSchema}.${tableName}`,
		name: `${selectedSchema}.${tableName}`,
		path: `${tab.path}#${selectedSchema}.${tableName}`,
		source: tab.source,
		connectionId: tab.connectionId,
		extension: 'parquet',
		sourceRef: ref
	};
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
			<div class="hidden items-center gap-1 text-xs text-zinc-400 sm:inline-flex">
				<ClockIcon class="h-3 w-3" />
				{#if snapshots.length > 1}
					<select
						class="rounded bg-white px-1.5 py-0.5 text-xs text-zinc-700 disabled:opacity-60 dark:bg-zinc-800 dark:text-zinc-300"
						disabled={switchingSnapshot}
						title={t('ducklake.snapshot')}
						value={snapshotVersion}
						onchange={(e) => switchSnapshot(Number(e.currentTarget.value))}
					>
						{#each snapshots as snap (snap.id)}
							<option value={snap.id}>{formatSnapshotLabel(snap)}</option>
						{/each}
					</select>
					<span class="text-zinc-400">({snapshots.length} {t('ducklake.snapshots')})</span>
				{:else}
					{@const formatted = formatSnapshotTime(snapshotTimeMs)}
					<span>v{snapshotVersion}{#if formatted}&nbsp;({formatted}){/if}</span>
				{/if}
			</div>
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

			<!-- Content: embed TableViewer with a synthetic tab pointed at the
			     attached table. TableViewer handles SQL editing, CRS detection
			     from DuckDB v1.5 GEOMETRY types, and zero-copy WKB → map. -->
			<div class="flex flex-1 flex-col overflow-hidden">
				{#if showSql}
					<div class="flex-1">
						<SqlEditor connId={tab.connectionId ?? ''} />
					</div>
				{:else if childTab}
					{#key childTab.id}
						<TableViewer tab={childTab} />
					{/key}
				{:else}
					<div class="flex flex-1 items-center justify-center">
						<p class="text-sm text-zinc-400">{t('database.selectTable')}</p>
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>
