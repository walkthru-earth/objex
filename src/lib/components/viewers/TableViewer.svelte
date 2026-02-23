<script lang="ts">
import Loader2Icon from '@lucide/svelte/icons/loader-2';
import XCircleIcon from '@lucide/svelte/icons/x-circle';
import { tableFromIPC } from 'apache-arrow';
import { format as formatSql } from 'sql-formatter';
import { untrack } from 'svelte';
import CodeMirrorEditor from '$lib/components/editor/CodeMirrorEditor.svelte';
import { buildDuckDbSource, isCloudNativeFormat } from '$lib/file-icons/index.js';
import { t } from '$lib/i18n/index.svelte.js';
import type { MapQueryResult, SchemaField } from '$lib/query/engine';
import { getQueryEngine } from '$lib/query/index.js';
import { queryHistory } from '$lib/stores/query-history.svelte.js';
import type { Tab } from '$lib/types';
import { buildDuckDbUrl, buildStorageUrl } from '$lib/utils/url.js';
import { getUrlView, updateUrlView } from '$lib/utils/url-state.js';
import { findGeoColumn, findGeoColumnFromRows, parseWKB, toBinary } from '$lib/utils/wkb.js';
import QueryHistoryPanel from './QueryHistoryPanel.svelte';
import SchemaPanel from './SchemaPanel.svelte';
import TableGrid from './TableGrid.svelte';
import TableStatusBar from './TableStatusBar.svelte';
import TableToolbar from './TableToolbar.svelte';

let { tab }: { tab: Tab } = $props();

let pageSize = $state(1000);

let schema = $state<SchemaField[]>([]);
let columns = $state<string[]>([]);
let rows = $state<Record<string, any>[]>([]);
let totalRows = $state<number | null>(null);
let currentPage = $state(1);
let loading = $state(true);
let error = $state<string | null>(null);
let schemaVisible = $state(false);
let historyVisible = $state(false);
let hasGeo = $state(false);
let isStac = $state(false);
// Restore view mode from URL hash if present
const urlView = getUrlView();
let viewMode = $state<'table' | 'map' | 'stac'>(
	urlView === 'map' ? 'map' : urlView === 'stac' ? 'stac' : 'table'
);
let sqlQuery = $state('');
let customSql = $state('');
let queryRunning = $state(false);
let executionTimeMs = $state(0);

// Progress stage for user feedback
let loadStage = $state('');

// Load cancellation: incrementing ID so stale loads are ignored
let loadGeneration = 0;

// Sort state
let sortColumn = $state<string | null>(null);
let sortDirection = $state<'asc' | 'desc' | null>(null);

// Geo column state for unified table+map query
let geoCol = $state<string | null>(null);
let geoColType = $state<string>('');
let mapData = $state<MapQueryResult | null>(null);

const totalPages = $derived(totalRows != null ? Math.max(1, Math.ceil(totalRows / pageSize)) : 1);
const connId = $derived(tab?.connectionId ?? '');

// Build column type map from schema
const columnTypes = $derived(Object.fromEntries(schema.map((f) => [f.name, f.type])));

// Columns for display — exclude internal __wkb helper
const displayColumns = $derived(columns.filter((c) => c !== '__wkb'));

function buildDefaultSql(offset = 0): string {
	const fileUrl = buildDuckDbUrl(tab);
	const source = buildDuckDbSource(tab.path, fileUrl);

	let sql: string;
	if (geoCol) {
		const quoted = `"${geoCol}"`;
		const upper = geoColType.toUpperCase();
		const isSpatialType =
			upper === 'GEOMETRY' ||
			upper === 'WKB_BLOB' ||
			upper.includes('POINT') ||
			upper.includes('LINESTRING') ||
			upper.includes('POLYGON');
		const geomExpr = isSpatialType ? quoted : `ST_GeomFromGeoJSON(${quoted})`;
		sql = `SELECT * EXCLUDE(${quoted}), ST_AsWKB(${geomExpr}) AS __wkb FROM ${source}`;
	} else {
		sql = `SELECT * FROM ${source}`;
	}

	if (sortColumn && sortDirection) {
		sql += ` ORDER BY "${sortColumn}" ${sortDirection.toUpperCase()}`;
	}

	sql += ` LIMIT ${pageSize} OFFSET ${offset}`;
	return sql;
}

function extractMapData(queryRows: Record<string, any>[]): MapQueryResult | null {
	if (!geoCol || queryRows.length === 0 || !columns.includes('__wkb')) return null;

	const wkbArrays: Uint8Array[] = [];
	let geometryType = 'POINT';

	for (const row of queryRows) {
		const bin = toBinary(row.__wkb);
		if (bin) wkbArrays.push(bin);
	}

	// Detect geometry type from first WKB value
	if (wkbArrays.length > 0) {
		const parsed = parseWKB(wkbArrays[0]);
		if (parsed) geometryType = parsed.type.toUpperCase();
	}

	// Build attributes map (exclude __wkb)
	const attributes = new Map<string, { values: any[]; type: string }>();
	for (const col of columns) {
		if (col === '__wkb') continue;
		const fieldType = columnTypes[col] ?? 'VARCHAR';
		const values = queryRows.map((r) => r[col]);
		attributes.set(col, { values, type: fieldType });
	}

	return { wkbArrays, geometryType, attributes, rowCount: wkbArrays.length };
}

// Track last loaded tab to prevent duplicate loads
let lastLoadedTabId = '';

$effect(() => {
	if (!tab) return;
	const tabId = tab.id;
	untrack(() => {
		if (tabId !== lastLoadedTabId) {
			lastLoadedTabId = tabId;
			// Reset view mode on tab switch to avoid stale iframe/map views
			viewMode = 'table';
			updateUrlView('');
			loadTable();
		}
	});
});

function cancelLoad() {
	loadGeneration++;
	loading = false;
	queryRunning = false;
	loadStage = '';
	error = t('table.queryCancelled');
}

async function loadTable() {
	const thisGen = ++loadGeneration;
	loading = true;
	error = null;
	geoCol = null;
	geoColType = '';
	mapData = null;
	loadStage = t('table.preparingQuery');

	// Set SQL eagerly so editor shows the query while loading
	const initialSql = buildDefaultSql(0);
	sqlQuery = initialSql;
	customSql = initialSql;

	try {
		loadStage = t('table.initEngine');
		const engine = await getQueryEngine();
		if (thisGen !== loadGeneration) return; // cancelled

		const fileUrl = buildDuckDbUrl(tab);
		const cloudNative = isCloudNativeFormat(tab.path);

		if (cloudNative) {
			// Cloud-native formats (Parquet): metadata reads are cheap range
			// requests — separate schema + count queries don't re-download.
			loadStage = t('table.loadingSchema');
			schema = await engine.getSchema(connId, fileUrl);
			if (thisGen !== loadGeneration) return;
			columns = schema.map((f) => f.name);

			const detectedGeoCol = findGeoColumn(schema);
			geoCol = detectedGeoCol;
			if (detectedGeoCol) {
				const geoField = schema.find((f) => f.name === detectedGeoCol);
				geoColType = geoField?.type ?? 'GEOMETRY';
			}
			hasGeo = detectedGeoCol !== null;
			isStac = schema.some((f) => f.name === 'stac_version');
		}

		// Rebuild SQL now that we know the actual path resolution
		sqlQuery = buildDefaultSql(0);
		customSql = sqlQuery;

		loadStage = t('table.runningQuery');
		const start = performance.now();
		const result = await executeQuery(sqlQuery);
		if (thisGen !== loadGeneration) return;
		executionTimeMs = Math.round(performance.now() - start);

		if (!cloudNative && result) {
			// Non-cloud-native (CSV, GeoJSON, etc.): derive schema from the
			// query result so we avoid a second full-file download.
			schema = (result.columns ?? []).map((col, i) => ({
				name: col,
				type: result.types?.[i] ?? 'VARCHAR',
				nullable: true
			}));
			columns = schema.map((f) => f.name);

			const detectedGeoCol = findGeoColumn(schema);
			geoCol = detectedGeoCol;
			if (detectedGeoCol) {
				const geoField = schema.find((f) => f.name === detectedGeoCol);
				geoColType = geoField?.type ?? 'GEOMETRY';
			}
			hasGeo = detectedGeoCol !== null;
			isStac = schema.some((f) => f.name === 'stac_version');

			// Re-query with geo-aware SQL if geo column was detected
			if (hasGeo) {
				const geoSql = buildDefaultSql(0);
				sqlQuery = geoSql;
				customSql = geoSql;
				const geoStart = performance.now();
				await executeQuery(geoSql);
				if (thisGen !== loadGeneration) return;
				executionTimeMs = Math.round(performance.now() - geoStart);
			}
		}

		// If schema-only detection missed geo, try content sniffing on actual rows
		if (!hasGeo && rows.length > 0) {
			hasGeo = findGeoColumnFromRows(rows, schema) !== null;
		}

		mapData = extractMapData(rows);

		// Auto-switch to table if URL hash requested map/stac but no geo/stac was detected
		if (!hasGeo && viewMode === 'map') {
			viewMode = 'table';
		}
		if (!isStac && viewMode === 'stac') {
			viewMode = 'table';
		}

		loading = false;
		loadStage = '';
		updateUrlView(viewMode);

		// Row count: for non-cloud-native formats, if all rows fit on one
		// page we already know the total — skip the extra download.
		if (!cloudNative && rows.length < pageSize) {
			totalRows = rows.length;
		} else {
			loadStage = t('table.countingRows');
			engine
				.getRowCount(connId, fileUrl)
				.then((count) => {
					if (thisGen === loadGeneration) {
						totalRows = count;
					}
					loadStage = '';
				})
				.catch(() => {
					loadStage = '';
				});
		}
	} catch (err) {
		if (thisGen !== loadGeneration) return;
		console.error('[TableViewer] Error:', err);
		error = err instanceof Error ? err.message : String(err);
		loading = false;
		loadStage = '';
	}
}

async function executeQuery(sql: string) {
	try {
		const engine = await getQueryEngine();
		const result = await engine.query(connId, sql);

		// Prefer pre-parsed rows (WASM engine) — avoids Arrow version mismatch
		if (result.rows) {
			columns = result.columns ?? [];
			rows = result.rows;
			return result;
		}

		if (result.arrowBytes.length === 0) {
			rows = [];
			columns = result.columns ?? [];
			return result;
		}

		// Fallback: deserialize from Arrow IPC (native engine path)
		const table = tableFromIPC(result.arrowBytes);
		columns = table.schema.fields.map((f) => f.name);
		rows = table.toArray().map((row: any) => row.toJSON());
		return result;
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
		return null;
	}
}

async function loadPage(page: number) {
	const offset = (page - 1) * pageSize;
	const sql = buildDefaultSql(offset);
	sqlQuery = sql;
	customSql = sql;
	const start = performance.now();
	await executeQuery(sql);
	executionTimeMs = Math.round(performance.now() - start);
	mapData = extractMapData(rows);
	currentPage = page;
}

async function runCustomSql() {
	queryRunning = true;
	error = null;
	mapData = null;
	loadStage = t('table.runningCustomQuery');
	const start = performance.now();
	try {
		sqlQuery = customSql;
		await executeQuery(customSql);
		executionTimeMs = Math.round(performance.now() - start);
		currentPage = 1;
		totalRows = null;
		updateUrlView('query');

		// Record in history
		queryHistory.add({
			sql: customSql,
			timestamp: Date.now(),
			durationMs: executionTimeMs,
			rowCount: rows.length,
			connectionId: connId || undefined
		});
	} catch (err) {
		executionTimeMs = Math.round(performance.now() - start);
		error = err instanceof Error ? err.message : String(err);

		queryHistory.add({
			sql: customSql,
			timestamp: Date.now(),
			durationMs: executionTimeMs,
			rowCount: 0,
			error: error ?? undefined,
			connectionId: connId || undefined
		});
	} finally {
		queryRunning = false;
		loadStage = '';
	}
}

function handleSqlChange(val: string) {
	customSql = val;
}

function handleFormatSql() {
	try {
		customSql = formatSql(customSql, { language: 'sql' });
	} catch {
		// ignore format errors
	}
}

function handleSort(column: string, direction: 'asc' | 'desc' | null) {
	sortColumn = direction ? column : null;
	sortDirection = direction;
	// Rebuild the default sql and reload
	const sql = buildDefaultSql(0);
	sqlQuery = sql;
	customSql = sql;
	currentPage = 1;
	const start = performance.now();
	executeQuery(sql).then(() => {
		executionTimeMs = Math.round(performance.now() - start);
		mapData = extractMapData(rows);
	});
}

function handleHistorySelect(sql: string) {
	customSql = sql;
	runCustomSql();
}

function handlePageSizeChange(size: number) {
	pageSize = size;
	currentPage = 1;
	const sql = buildDefaultSql(0);
	sqlQuery = sql;
	customSql = sql;
	const start = performance.now();
	executeQuery(sql).then(() => {
		executionTimeMs = Math.round(performance.now() - start);
		mapData = extractMapData(rows);
	});
}

function prevPage() {
	if (currentPage > 1) loadPage(currentPage - 1);
}

function nextPage() {
	if (totalRows != null && currentPage < totalPages) loadPage(currentPage + 1);
	else if (totalRows == null && rows.length === pageSize) loadPage(currentPage + 1);
}

function goToPage(page: number) {
	if (page >= 1 && page <= totalPages) loadPage(page);
}

function toggleSchema() {
	schemaVisible = !schemaVisible;
}

function toggleHistory() {
	historyVisible = !historyVisible;
}

function toggleView() {
	viewMode = viewMode === 'table' ? 'map' : 'table';
	updateUrlView(viewMode);
}

function setStacView() {
	viewMode = viewMode === 'stac' ? 'table' : 'stac';
	updateUrlView(viewMode);
}
</script>

<div class="flex h-full flex-col">
	<!-- Toolbar — always visible -->
	<TableToolbar
		fileName={tab.name}
		columnCount={displayColumns.length}
		rowCount={totalRows ?? 0}
		{currentPage}
		{totalPages}
		{pageSize}
		{schemaVisible}
		{historyVisible}
		{hasGeo}
		{isStac}
		{viewMode}
		onPrevPage={prevPage}
		onNextPage={nextPage}
		onGoToPage={goToPage}
		onToggleSchema={toggleSchema}
		onToggleHistory={toggleHistory}
		onToggleView={toggleView}
		onToggleStac={setStacView}
		onPageSizeChange={handlePageSizeChange}
	/>

	{#if viewMode === 'table'}
		<!-- SQL Query Bar — table mode only -->
		<div class="border-b border-zinc-200 px-4 py-1.5 dark:border-zinc-800">
			<div class="flex items-center gap-2">
				<div class="flex-1">
					<CodeMirrorEditor
						value={customSql}
						onChange={handleSqlChange}
						onExecute={runCustomSql}
						placeholder={t('table.enterSql')}
						schemaColumns={displayColumns}
					/>
				</div>
				<div class="flex shrink-0 flex-col gap-1">
					<button
						class="rounded bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
						onclick={runCustomSql}
						disabled={queryRunning || loading}
					>
						{queryRunning ? t('table.running') : t('table.run')}
					</button>
					<button
						class="rounded px-3 py-1 text-xs text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
						onclick={handleFormatSql}
					>
						{t('table.format')}
					</button>
				</div>
			</div>
		</div>

		{#if error}
			<div
				class="border-b border-red-200 bg-red-50 px-4 py-2 dark:border-red-800 dark:bg-red-950"
			>
				<p class="text-xs text-red-600 dark:text-red-400">{error}</p>
				{#if tab.source === 'remote'}
					<p class="mt-1 text-[10px] text-zinc-400 break-all">{buildStorageUrl(tab)}</p>
				{/if}
			</div>
		{/if}

		<!-- Content area: loading / table + side panels -->
		<div class="relative flex flex-1 overflow-hidden">
			{#if loading || queryRunning}
				<div class="flex flex-1 flex-col items-center justify-center gap-3">
					<Loader2Icon class="size-6 animate-spin text-primary" />
					<p class="text-sm text-zinc-400">{loadStage || t('table.loading')}</p>
					<button
						class="mt-1 flex items-center gap-1 rounded border border-zinc-300 px-3 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
						onclick={cancelLoad}
					>
						<XCircleIcon class="size-3" />
						{t('table.cancel')}
					</button>
				</div>
			{:else if error && rows.length === 0}
				<div class="flex flex-1 items-center justify-center">
					<div
						class="max-w-lg rounded-lg border border-red-300 bg-red-50 px-6 py-4 text-center dark:border-red-800 dark:bg-red-950"
					>
						<p class="text-sm text-red-600 dark:text-red-400">{error}</p>
					</div>
				</div>
			{:else}
				<TableGrid
					columns={displayColumns}
					{rows}
					totalRows={totalRows ?? rows.length}
					{columnTypes}
					{sortColumn}
					{sortDirection}
					onSort={handleSort}
				/>
			{/if}
			<QueryHistoryPanel
				visible={historyVisible}
				onSelect={handleHistorySelect}
				onClose={toggleHistory}
			/>
			<SchemaPanel fields={schema} visible={schemaVisible} onClose={toggleSchema} />
		</div>

		<!-- Status bar — table mode only -->
		<TableStatusBar
			rowCount={rows.length}
			{executionTimeMs}
			loading={loading || queryRunning}
			columns={displayColumns}
			{rows}
			fileName={tab.name}
		/>
	{:else if viewMode === 'stac'}
		<!-- STAC Map mode — full size -->
		<div class="flex-1 overflow-hidden">
			{#await import('./StacMapViewer.svelte') then StacMapViewer}
				<StacMapViewer.default {tab} />
			{/await}
		</div>
	{:else}
		<!-- Map mode — full size -->
		<div class="flex-1 overflow-hidden">
			{#await import('./GeoParquetMapViewer.svelte') then GeoParquetMapViewer}
				<GeoParquetMapViewer.default {tab} {schema} {mapData} />
			{/await}
		</div>
	{/if}
</div>
