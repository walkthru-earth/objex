<script lang="ts">
import type { GeoArrowGeomType } from '@walkthru-earth/objex-utils';
import {
	buildTransformExpr,
	extractBounds,
	extractEpsgFromGeoMeta,
	extractGeometryTypes,
	findGeoColumn,
	findGeoColumnFromRows,
	parseWKB,
	readParquetMetadata,
	toBinary,
	wrapWkbWithCrs
} from '@walkthru-earth/objex-utils';
import { format as formatSql } from 'sql-formatter';
import { untrack } from 'svelte';
import CodeMirrorEditor from '$lib/components/editor/CodeMirrorEditor.svelte';
import { DEFAULT_TARGET_CRS } from '$lib/constants.js';
import { isCloudNativeFormat } from '$lib/file-icons/index.js';
import { t } from '$lib/i18n/index.svelte.js';
import type { MapQueryResult, SchemaField } from '$lib/query/engine';
import {
	getQueryEngine,
	QueryCancelledError,
	type QueryHandle,
	type ResolvedTableSource,
	resolveTableSource,
	resolveTableSourceAsync
} from '$lib/query/index.js';
import { queryHistory } from '$lib/stores/query-history.svelte.js';
import { settings } from '$lib/stores/settings.svelte.js';
import { tabResources } from '$lib/stores/tab-resources.svelte.js';
import type { Tab } from '$lib/types';
import {
	buildDuckDbUrl,
	buildHttpsUrl,
	buildStorageUrl,
	canStreamDirectly
} from '$lib/utils/signed-url.js';
import { pickViewMode, updateUrlView } from '$lib/utils/url-state.js';
import FileInfo from './FileInfo.svelte';
import LoadProgress, { type ProgressEntry } from './LoadProgress.svelte';
import QueryHistoryPanel from './QueryHistoryPanel.svelte';
import TableGrid from './TableGrid.svelte';
import TableStatusBar from './TableStatusBar.svelte';
import TableToolbar from './TableToolbar.svelte';

// `nested = true` when mounted inside `StacTabViewer` for a stac-geoparquet
// tab. The outer wrapper already exposes `stac-map` / `STAC Browser` buttons,
// so the inner `TableToolbar` hides its own STAC Map toggle to avoid
// duplicating the same `StacMapViewer` mount.
let { tab, nested = false }: { tab: Tab; nested?: boolean } = $props();

let pageSize = $state(settings.featureLimit);

let schema = $state<SchemaField[]>([]);
let columns = $state<string[]>([]);
let rows = $state.raw<Record<string, any>[]>([]);
let totalRows = $state<number | null>(null);
let currentPage = $state(1);
let loading = $state(true);
let error = $state<string | null>(null);
let historyVisible = $state(false);
let hasGeo = $state(false);
let isStac = $state(false);
// Restore view mode from URL hash if present
type TableViewMode = 'table' | 'map' | 'stac' | 'info';
let viewMode = $state<TableViewMode>(
	pickViewMode<TableViewMode>(['table', 'map', 'stac', 'info'], 'table')
);
let sqlQuery = $state('');
let customSql = $state('');
// Presigned URL for the source-cooperative parquet-table iframe (external fetcher).
let parquetIframeUrl = $state('');
let queryRunning = $state(false);
let executionTimeMs = $state(0);

// Progress stage for user feedback
let loadStage = $state('');
let loadProgress = $state<ProgressEntry[]>([]);

// Load cancellation: incrementing ID so stale loads are ignored
let loadGeneration = 0;
let activeHandle: QueryHandle | null = null;
let forceCancelVisible = $state(false);
let forceCancelTimer: ReturnType<typeof setTimeout> | null = null;

// Sort state
let sortColumn = $state<string | null>(null);
let sortDirection = $state<'asc' | 'desc' | null>(null);

// Tracks whether the current mapData came from a user-edited query (no system limit)
let isCustomQuery = $state(false);

// Geo column state for unified table+map query
let geoCol = $state<string | null>(null);
let geoColType = $state<string>('');
let sourceCrs = $state<string | null>(null);
let mapData = $state.raw<MapQueryResult | null>(null);
let knownGeomType = $state<GeoArrowGeomType | undefined>(undefined);
let metadataBounds = $state<[number, number, number, number] | null>(null);

const totalPages = $derived(totalRows != null ? Math.max(1, Math.ceil(totalRows / pageSize)) : 1);
const connId = $derived(tab?.connectionId ?? '');

// Build column type map from schema
const columnTypes = $derived(Object.fromEntries(schema.map((f) => [f.name, f.type])));

// Columns for display — exclude internal __wkb helper
const displayColumns = $derived(columns.filter((c) => c !== '__wkb'));

let resolvedSource: ResolvedTableSource | null = null;

function buildDefaultSql(
	offset = 0,
	resolved: ResolvedTableSource = resolvedSource ?? resolveTableSource(tab)
): string {
	const source = resolved.ref;

	let sql: string;
	if (geoCol) {
		const quoted = `"${geoCol}"`;
		const upper = geoColType.toUpperCase();
		// Spatial types that ST_AsWKB accepts directly: GEOMETRY, GEOMETRY('EPSG:...'),
		// GEOGRAPHY, WKB_BLOB, POINT, LINESTRING, POLYGON, Binary (Arrow serialization).
		const spatialType =
			upper.startsWith('GEOMETRY') ||
			upper.startsWith('GEOGRAPHY') ||
			upper === 'WKB_BLOB' ||
			upper.includes('POINT') ||
			upper.includes('LINESTRING') ||
			upper.includes('POLYGON') ||
			upper.includes('BINARY');
		const isWkbBlob = upper === 'BLOB' || upper === 'BYTEA';

		let wkbExpr: string;
		if (isWkbBlob && !sourceCrs) {
			// Already WKB — use directly, no conversion needed
			wkbExpr = `${quoted} AS __wkb`;
		} else {
			// For BLOB inputs with a known source CRS, attach it via ST_SetCRS so the
			// 2-arg ST_Transform form can be used (DuckDB v1.5+).
			let geomExpr = spatialType
				? quoted
				: isWkbBlob
					? wrapWkbWithCrs(quoted, sourceCrs)
					: `ST_GeomFromGeoJSON(${quoted})`;
			if (sourceCrs) {
				// geometry_always_xy is set globally at DB init, so no per-call always_xy.
				const effectiveType = isWkbBlob ? `GEOMETRY('${sourceCrs}')` : geoColType;
				geomExpr = buildTransformExpr(geomExpr, effectiveType, sourceCrs, DEFAULT_TARGET_CRS);
			}
			wkbExpr = `ST_AsWKB(${geomExpr}) AS __wkb`;
		}
		sql = `SELECT * EXCLUDE(${quoted}), ${wkbExpr} FROM ${source}`;
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

// Register cleanup so tab store can free heavy data on close
$effect(() => {
	const id = tab.id;
	const unregister = tabResources.register(id, () => {
		loadGeneration++;
		// Cancel in-flight query if any
		if (activeHandle) {
			activeHandle.cancel();
			activeHandle = null;
		}
		if (forceCancelTimer) {
			clearTimeout(forceCancelTimer);
			forceCancelTimer = null;
		}
		forceCancelVisible = false;
		rows = [];
		schema = [];
		columns = [];
		mapData = null;
		geoCol = null;
		knownGeomType = undefined;
		metadataBounds = null;
		resolvedSource = null;
		parquetIframeUrl = '';
		error = null;
	});
	return unregister;
});

$effect(() => {
	if (!tab) return;
	const tabId = tab.id;
	untrack(() => {
		if (tabId !== lastLoadedTabId) {
			const isInitialLoad = lastLoadedTabId === '';
			lastLoadedTabId = tabId;
			if (!isInitialLoad) {
				// Reset view mode on tab switch to avoid stale iframe/map views
				viewMode = 'table';
				updateUrlView('');
			}
			loadTable();
		} else {
			console.warn('[TableViewer] $effect re-fired but tab unchanged, skipping loadTable', tabId);
		}
	});
});

function cancelLoad() {
	loadGeneration++;
	loadStage = t('table.cancellingQuery');

	// Attempt graceful cancel via conn.cancelSent()
	if (activeHandle) {
		activeHandle.cancel();
		// If the query hasn't settled after 5s, show force-cancel button
		forceCancelTimer = setTimeout(() => {
			forceCancelVisible = true;
		}, 5000);
	} else {
		loading = false;
		queryRunning = false;
		loadStage = '';
		error = t('table.queryCancelled');
	}
}

async function forceCancel() {
	if (forceCancelTimer) {
		clearTimeout(forceCancelTimer);
		forceCancelTimer = null;
	}
	forceCancelVisible = false;
	loadStage = '';

	const engine = await getQueryEngine();
	if (engine.forceCancel) {
		await engine.forceCancel();
	}

	activeHandle = null;
	loading = false;
	queryRunning = false;
	error = t('table.queryCancelled');
}

async function loadTable() {
	const thisGen = ++loadGeneration;
	// Snapshot reactive values once. Reading `$derived` across awaits after the
	// component's effect is torn down returns Svelte's destroyed-signal sentinel,
	// which throws "can't convert symbol to string" in downstream template literals.
	const cid = connId;

	// Cancel in-flight query from a previous load to prevent duplicate concurrent queries
	if (activeHandle) {
		activeHandle.cancel();
		activeHandle = null;
	}

	loading = true;
	error = null;
	geoCol = null;
	geoColType = '';
	sourceCrs = null;
	mapData = null;
	isCustomQuery = false;
	knownGeomType = undefined;
	metadataBounds = null;
	loadStage = t('table.preparingQuery');
	loadProgress = [];

	resolvedSource = null;
	const eagerSql = buildDefaultSql(0);
	sqlQuery = eagerSql;
	customSql = eagerSql;

	try {
		const resolved: ResolvedTableSource = await resolveTableSourceAsync(tab);
		if (thisGen !== loadGeneration) return;
		resolvedSource = resolved;
		const resolvedSql = buildDefaultSql(0, resolved);
		sqlQuery = resolvedSql;
		// Only overwrite the editor if the user hasn't edited it during the presign await.
		if (customSql === eagerSql) customSql = resolvedSql;
		const isFileSource = resolved.isFileSource;
		const fileUrl = resolved.fileUrl ?? '';
		const httpsUrl = isFileSource ? buildHttpsUrl(tab) : '';
		const cloudNative = isFileSource && isCloudNativeFormat(tab.path);
		const isParquet = isFileSource && /\.parquet$/i.test(tab.path);
		const streamable = isFileSource && canStreamDirectly(tab);

		// Parquet-table iframe fetches from its own origin. `resolved.fileUrl`
		// is already the presigned HTTPS URL for signed-s3 (or the public URL
		// for anonymous / SAS), so reuse it instead of signing a second time.
		if (isParquet) parquetIframeUrl = fileUrl;

		// Start DuckDB boot immediately (runs in parallel with hyparquet)
		loadStage = t('table.initEngine');
		const enginePromise = getQueryEngine();

		// ── Fast metadata via hyparquet (runs concurrently with DuckDB boot) ──
		// Only applies to file-backed sources. SQL-backed sources (attached
		// DuckLake tables, etc.) go straight to DuckDB for schema + CRS.
		let metaFromHyparquet = false;
		let needsDuckDbCrs = false;
		let isLegacyGeoParquet = false;
		if (cloudNative && isParquet && streamable) {
			try {
				loadStage = t('table.readingMetadata');
				const meta = await readParquetMetadata(httpsUrl);
				if (thisGen !== loadGeneration) return;

				// Format detection
				const formatName = meta.geo ? 'GeoParquet' : 'Parquet';
				loadProgress = [
					{ label: t('progress.format'), value: formatName },
					{ label: t('progress.source'), value: t('progress.rangeRequest') }
				];

				// Instant schema display — use hyparquet-detected types as-is.
				// mapParquetType() returns 'GEOMETRY' for native Parquet GEOMETRY
				// logical type (Format 2.11+) and 'BLOB' for plain BYTE_ARRAY.
				// This matches what DuckDB reports with enable_geoparquet_conversion=false.
				schema = meta.schema.map((s) => ({
					name: s.name,
					type: s.type,
					nullable: true
				}));
				columns = schema.map((f) => f.name);
				totalRows = meta.rowCount;

				// Column names preview (truncated)
				const colPreview =
					columns.length <= 8
						? columns.join(', ')
						: `${columns.slice(0, 7).join(', ')}, +${columns.length - 7} more`;
				loadProgress = [
					...loadProgress,
					{ label: t('progress.columns'), value: String(columns.length), detail: colPreview },
					{ label: t('progress.rows'), value: meta.rowCount.toLocaleString() }
				];

				// Row groups & compression
				if (meta.numRowGroups > 0) {
					loadProgress = [
						...loadProgress,
						{ label: t('progress.rowGroups'), value: String(meta.numRowGroups) }
					];
				}
				if (meta.compression) {
					loadProgress = [
						...loadProgress,
						{ label: t('progress.compression'), value: meta.compression }
					];
				}

				// Created by (tool)
				if (meta.createdBy) {
					loadProgress = [
						...loadProgress,
						{ label: t('progress.createdBy'), value: meta.createdBy }
					];
				}

				if (meta.geo) {
					geoCol = meta.geo.primaryColumn;
					// DuckDB v1.5 reads GeoParquet columns as GEOMETRY('EPSG:...').
					// Set GEOMETRY here as placeholder — DuckDB schema will refine.
					geoColType = 'GEOMETRY';
					sourceCrs = extractEpsgFromGeoMeta(meta.geo);
					const geomTypes = extractGeometryTypes(meta.geo);
					if (geomTypes.length === 1) knownGeomType = geomTypes[0];
					metadataBounds = extractBounds(meta.geo);

					const geomLabel = geomTypes.join(', ') || geoColType;
					const primaryCol = meta.geo.columns[meta.geo.primaryColumn];
					const encodingInfo = primaryCol?.encoding ?? 'WKB';
					loadProgress = [
						...loadProgress,
						{ label: t('progress.geometry'), value: `${geoCol} (${geomLabel})` },
						{ label: t('progress.encoding'), value: encodingInfo }
					];
					if (sourceCrs) {
						loadProgress = [...loadProgress, { label: t('progress.crs'), value: sourceCrs }];
					} else {
						loadProgress = [
							...loadProgress,
							{ label: t('progress.crs'), value: 'EPSG:4326 (WGS84)' }
						];
					}
					if (metadataBounds) {
						const [minX, minY, maxX, maxY] = metadataBounds;
						loadProgress = [
							...loadProgress,
							{
								label: t('progress.bounds'),
								value: `${minX.toFixed(2)}, ${minY.toFixed(2)}, ${maxX.toFixed(2)}, ${maxY.toFixed(2)}`
							}
						];
					}
				}

				// No GeoParquet "geo" metadata — detect native Parquet GEOMETRY
				// columns (Format 2.11+) via schema column names/types
				if (!geoCol) {
					const detectedGeoCol = findGeoColumn(schema);
					if (detectedGeoCol) {
						geoCol = detectedGeoCol;
						// DuckDB v1.5 reads native Parquet GEOMETRY natively.
						geoColType = 'GEOMETRY';
						needsDuckDbCrs = true;
						loadProgress = [
							...loadProgress,
							{ label: t('progress.geometry'), value: `${geoCol} (native Parquet)` }
						];
					}
				}

				hasGeo = geoCol !== null;
				isStac = schema.some((f) => f.name === 'stac_version');
				if (isStac) {
					loadProgress = [
						...loadProgress,
						{ label: t('progress.format'), value: t('progress.stacDetected') }
					];
				}
				isLegacyGeoParquet = meta.legacyGeoParquet;
				metaFromHyparquet = true;
			} catch {
				// hyparquet failed (CORS, auth, format) — fall back to DuckDB
			}
		}

		// Wait for DuckDB engine
		loadStage = metaFromHyparquet ? t('table.bootingEngine') : t('table.initEngine');
		const engine = await enginePromise;
		if (thisGen !== loadGeneration) return;

		// Legacy GeoParquet (geopandas <0.12) — files with schema_version but no
		// "version" field. DuckDB v1.5 may reject these with auto-conversion enabled.
		// Disable conversion for this connection and fall back to BLOB handling.
		if (metaFromHyparquet && isLegacyGeoParquet && geoCol) {
			try {
				await engine.query(cid, 'SET enable_geoparquet_conversion = false');
				geoColType = 'BLOB';
			} catch {
				// Setting failed — DuckDB may still handle it gracefully
			}
		}

		// DuckDB v1.5: refresh geoColType from DuckDB's actual schema.
		// hyparquet reports BLOB for the physical Parquet type, but DuckDB v1.5
		// reads GeoParquet as GEOMETRY('EPSG:...') with CRS embedded in the type.
		if (metaFromHyparquet && geoCol && !isLegacyGeoParquet) {
			try {
				const duckSchema = await engine.getSchema(cid, resolved);
				if (thisGen !== loadGeneration) return;
				const duckGeoField = duckSchema.find((f: { name: string }) => f.name === geoCol);
				if (duckGeoField) {
					geoColType = duckGeoField.type;
					// Extract CRS from type string — may override hyparquet CRS detection
					const typeStr = duckGeoField.type.toUpperCase();
					const crsMatch = duckGeoField.type.match(/^GEOMETRY\('([^']+)'\)/i);
					if (crsMatch) {
						const crsVal = crsMatch[1];
						const isWgs84 =
							crsVal === 'EPSG:4326' ||
							crsVal === 'OGC:CRS84' ||
							(crsVal.startsWith('EPSG:') && [4326, 4979].includes(Number(crsVal.split(':')[1])));
						sourceCrs = isWgs84 ? null : crsVal;
						needsDuckDbCrs = false;
					} else if (typeStr.startsWith('GEOMETRY')) {
						// GEOMETRY without CRS param — still need CRS from metadata
						needsDuckDbCrs = !sourceCrs;
					}
				}
			} catch {
				// Schema refresh failed — continue with hyparquet-detected type
			}
		}

		// If hyparquet detected a geo column but couldn't determine CRS
		// (native Parquet GEOMETRY without "geo" KV metadata), use DuckDB
		if (metaFromHyparquet && needsDuckDbCrs && geoCol) {
			try {
				sourceCrs = await engine.detectCrs(cid, resolved, geoCol);
				if (thisGen !== loadGeneration) return;
				if (sourceCrs) {
					loadProgress = [...loadProgress, { label: t('progress.crs'), value: sourceCrs }];
				} else {
					loadProgress = [
						...loadProgress,
						{ label: t('progress.crs'), value: 'EPSG:4326 (WGS84)' }
					];
				}
			} catch {
				// CRS detection failed — continue with WGS84 assumption
			}
		}

		// DuckDB-backed schema + CRS pre-load. Runs when:
		//   - the source is SQL-backed (attached table, no hyparquet path), OR
		//   - it's a cloud-native file and hyparquet metadata failed (CORS, etc.)
		if (!isFileSource || (cloudNative && !metaFromHyparquet)) {
			// Fallback / SQL source: DuckDB metadata queries
			loadStage = t('table.loadingSchema');
			loadProgress = [
				...loadProgress,
				{
					label: t('progress.source'),
					value: isFileSource ? t('progress.duckdbFallback') : resolved.label
				}
			];

			if (engine.getSchemaAndCrs) {
				const result = await engine.getSchemaAndCrs(cid, resolved, findGeoColumn);
				if (thisGen !== loadGeneration) return;
				schema = result.schema;
				columns = schema.map((f) => f.name);
				const colPreview =
					columns.length <= 8
						? columns.join(', ')
						: `${columns.slice(0, 7).join(', ')}, +${columns.length - 7} more`;
				loadProgress = [
					...loadProgress,
					{ label: t('progress.columns'), value: String(columns.length), detail: colPreview }
				];

				geoCol = result.geomCol;
				if (result.geomCol) {
					const geoField = schema.find((f) => f.name === result.geomCol);
					geoColType = geoField?.type ?? 'GEOMETRY';
					loadProgress = [
						...loadProgress,
						{ label: t('progress.geometry'), value: `${result.geomCol} (${geoColType})` }
					];
					sourceCrs = result.crs;
					if (sourceCrs) {
						loadProgress = [...loadProgress, { label: t('progress.crs'), value: sourceCrs }];
					}
				}
			} else {
				schema = await engine.getSchema(cid, resolved);
				if (thisGen !== loadGeneration) return;
				columns = schema.map((f) => f.name);
				const colPreview =
					columns.length <= 8
						? columns.join(', ')
						: `${columns.slice(0, 7).join(', ')}, +${columns.length - 7} more`;
				loadProgress = [
					...loadProgress,
					{ label: t('progress.columns'), value: String(columns.length), detail: colPreview }
				];

				const detectedGeoCol = findGeoColumn(schema);
				geoCol = detectedGeoCol;
				if (detectedGeoCol) {
					const geoField = schema.find((f) => f.name === detectedGeoCol);
					geoColType = geoField?.type ?? 'GEOMETRY';
					loadProgress = [
						...loadProgress,
						{ label: t('progress.geometry'), value: `${detectedGeoCol} (${geoColType})` }
					];
					sourceCrs = await engine.detectCrs(cid, resolved, detectedGeoCol);
					if (thisGen !== loadGeneration) return;
					if (sourceCrs) {
						loadProgress = [...loadProgress, { label: t('progress.crs'), value: sourceCrs }];
					}
				}
			}
			hasGeo = geoCol !== null;
			isStac = schema.some((f) => f.name === 'stac_version');
			if (isStac) {
				loadProgress = [
					...loadProgress,
					{ label: t('progress.format'), value: t('progress.stacDetected') }
				];
			}
		}

		// Rebuild SQL now that we know the actual path resolution
		sqlQuery = buildDefaultSql(0);
		customSql = sqlQuery;

		loadStage = t('table.runningQuery');
		const start = performance.now();
		let result = await executeQuery(sqlQuery);
		if (thisGen !== loadGeneration) return;

		// If query failed and this is a GeoParquet file, the error may be from
		// auto-conversion of CRS metadata (e.g. "stoi: no conversion").
		// Retry with enable_geoparquet_conversion=false and BLOB handling.
		if (!result && error && isParquet && geoCol && !isLegacyGeoParquet) {
			try {
				await engine.query(cid, 'SET enable_geoparquet_conversion = false');
				geoColType = 'BLOB';
				sqlQuery = buildDefaultSql(0);
				customSql = sqlQuery;
				error = null;
				result = await executeQuery(sqlQuery);
				if (thisGen !== loadGeneration) return;
			} catch {
				// Retry also failed — original error stands
			}
		}

		executionTimeMs = Math.round(performance.now() - start);

		if (isFileSource && !cloudNative && result) {
			// Non-cloud-native file (CSV, GeoJSON, etc.): derive schema from the
			// query result so we avoid a second full-file download. Skipped for
			// SQL-backed sources (attached DuckLake tables), which already have
			// a proper schema from getSchemaAndCrs — re-deriving here would pick
			// up the projected `__wkb` alias and clobber the real geo column.
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

		// Row count: skip if hyparquet already provided it
		if (totalRows === null) {
			if (!cloudNative && rows.length < pageSize) {
				totalRows = rows.length;
			} else {
				loadStage = t('table.countingRows');
				engine
					.getRowCount(cid, resolved)
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
	// Snapshot `connId` — reading the $derived after the effect is destroyed
	// returns a Symbol sentinel and crashes downstream template literals.
	const cid = connId;
	try {
		const engine = await getQueryEngine();

		if (engine.queryCancellable) {
			const handle = engine.queryCancellable(cid, sql);
			activeHandle = handle;
			try {
				const result = await handle.result;
				columns = result.columns;
				rows = result.rows;
				return result;
			} finally {
				activeHandle = null;
				if (forceCancelTimer) {
					clearTimeout(forceCancelTimer);
					forceCancelTimer = null;
				}
				forceCancelVisible = false;
			}
		}

		const result = await engine.query(cid, sql);
		columns = result.columns;
		rows = result.rows;
		return result;
	} catch (err) {
		if (err instanceof QueryCancelledError) {
			loading = false;
			queryRunning = false;
			loadStage = '';
			error = t('table.queryCancelled');
			return null;
		}
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
	// Snapshot before any await — see note in executeQuery.
	const cid = connId;
	queryRunning = true;
	error = null;
	isCustomQuery = true;
	loadStage = t('table.runningCustomQuery');
	const start = performance.now();
	try {
		sqlQuery = customSql;
		await executeQuery(customSql);
		executionTimeMs = Math.round(performance.now() - start);
		currentPage = 1;
		totalRows = null;
		updateUrlView('query');

		// Pass custom query results to the map (respects user's LIMIT or lack thereof)
		mapData = extractMapData(rows);

		// Record in history
		queryHistory.add({
			sql: customSql,
			timestamp: Date.now(),
			durationMs: executionTimeMs,
			rowCount: rows.length,
			connectionId: cid || undefined
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
			connectionId: cid || undefined
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
	settings.setFeatureLimit(size);
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

function toggleInfo() {
	viewMode = viewMode === 'info' ? 'table' : 'info';
	updateUrlView(viewMode);
}

function toggleHistory() {
	historyVisible = !historyVisible;
}

function toggleView() {
	viewMode = viewMode === 'map' ? 'table' : 'map';
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
		{tab}
		fileName={tab.name}
		columnCount={displayColumns.length}
		rowCount={totalRows ?? 0}
		{currentPage}
		{totalPages}
		{pageSize}
		{historyVisible}
		{hasGeo}
		isStac={isStac && !nested}
		{viewMode}
		onPrevPage={prevPage}
		onNextPage={nextPage}
		onGoToPage={goToPage}
		onToggleInfo={toggleInfo}
		onToggleHistory={toggleHistory}
		onToggleView={toggleView}
		onToggleStac={nested ? undefined : setStacView}
		onPageSizeChange={handlePageSizeChange}
	/>

	{#if viewMode === 'table'}
		<!-- SQL Query Bar — hidden during schema/CRS detection, shown once query starts running -->
		<div class="border-b border-zinc-200 px-2 py-1.5 sm:px-4 dark:border-zinc-800" class:hidden={loading && loadStage !== t('table.runningQuery')}>
			<div class="flex items-start gap-1.5 sm:gap-2">
				<div class="min-w-0 flex-1">
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
						class="rounded bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50 sm:px-3"
						onclick={runCustomSql}
						disabled={queryRunning || loading}
					>
						{queryRunning ? t('table.running') : t('table.run')}
					</button>
					<button
						class="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-100 sm:px-3 dark:hover:bg-zinc-800"
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
				<LoadProgress
					stage={loadStage}
					entries={loadProgress}
					onCancel={cancelLoad}
					{forceCancelVisible}
					onForceCancel={forceCancel}
				/>
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
	{:else if viewMode === 'info'}
		<!-- Info mode — file metadata & schema -->
		<div class="min-h-0 flex-1 overflow-auto">
			<FileInfo
				entries={loadProgress}
				{schema}
				parquetUrl={/\.parquet$/i.test(tab.path) ? parquetIframeUrl : ''}
			/>
		</div>
	{:else if viewMode === 'stac'}
		<!-- STAC Map mode — full size -->
		<div class="flex-1 overflow-hidden">
			{#await import('./StacMapViewer.svelte') then StacMapViewer}
				<StacMapViewer.default {tab} />
			{/await}
		</div>
	{:else if viewMode === 'map'}
		<!-- Map mode — full size -->
		<div class="flex-1 overflow-hidden">
			{#await import('./GeoParquetMapViewer.svelte') then GeoParquetMapViewer}
				<GeoParquetMapViewer.default {tab} {schema} {mapData} {sourceCrs} {knownGeomType} {metadataBounds} {isCustomQuery} progressEntries={loadProgress} />
			{/await}
		</div>
	{/if}
</div>
