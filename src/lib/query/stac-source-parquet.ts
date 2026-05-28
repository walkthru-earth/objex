/**
 * stac-geoparquet implementation of the StacSource contract.
 *
 * Reuses:
 *   - `getQueryEngine()` + `queryCancellable`/`query` for the single worker
 *   - `resolveTableSourceAsync(tab)` for presigned `signed-s3` URL handling
 *   - `stacRowToItem` from `@walkthru-earth/objex-utils` for the pure transform
 *   - `parseWKB` from `@walkthru-earth/objex-utils` for geometry decoding
 *
 * Push-down: `bbox` (`ST_Intersects` + `ST_MakeEnvelope`) and `datetime`
 * (`datetime BETWEEN TIMESTAMPTZ ...`). Without the datetime push-down,
 * `LIMIT + ORDER BY datetime DESC` silently drops older rows before the
 * client-side filter ever runs, so any window outside the freshest N items
 * returned zero matches. Cloud cover / GSD / platform / etc. still ride
 * along on the residual until slice 3 plumbs them through DuckDB SQL.
 *
 * Hive partitioning: when the factory (or an SDK caller) sets
 * `useHivePartitioning: true`, the FROM target switches to
 * `read_parquet('.../**\/*.parquet', hive_partitioning=true,
 * union_by_name=true)`. Mirrors lazycogs'
 * `DuckdbClient(use_hive_partitioning=True)`. Partition columns appear as
 * virtual columns on the schema, but `buildSelectList` only projects known
 * STAC columns so they never leak into the rendered Items. `union_by_name`
 * is required because partitioned writes can drift schemas across
 * partitions (extra `proj:*` columns added later, etc.).
 *
 * Yields a single batch with `done: true`. Slice 3 turns this into a real
 * stream via `conn.send()` so large catalogs can render progressively.
 */

import type { FacetState, StacItem } from '@walkthru-earth/objex-utils';
import {
	DEFAULT_APP_CONFIG,
	emptyPushdown,
	parseWKB,
	type StacSource,
	type StacSourceBatch,
	type StacSourceCapabilities,
	type StacSourceRequest,
	stacRowToItem
} from '@walkthru-earth/objex-utils';
import type { StorageAdapter } from '../storage/adapter.js';
import type { Tab } from '../types.js';
import { QueryCancelledError } from './engine.js';
import { getQueryEngine } from './index.js';
import { type ResolvedTableSource, resolveTableSourceAsync } from './source.js';

/**
 * Options for `createParquetSource`. The factory threads adapter +
 * `useHivePartitioning` + `debugExplain` from `CreateStacSourceDeps`, but
 * library consumers can construct a `StacSource` directly.
 */
export interface CreateParquetSourceOptions {
	/**
	 * Storage adapter for the connection backing `tab`. Used solely to probe
	 * `tab.path` for `.parquet` children when `useHivePartitioning` is set —
	 * never consulted on the per-row read path (DuckDB httpfs handles I/O
	 * directly via the presigned / signed URL).
	 */
	adapter?: StorageAdapter;
	/**
	 * When true, treat `tab.path` as a hive-partitioned parquet directory
	 * (e.g. `s3://bucket/year=2023/month=01/...`) and build SQL with
	 * `read_parquet('.../**\/*.parquet', hive_partitioning=true,
	 * union_by_name=true)` so DuckDB prunes partitions per `bbox` /
	 * `datetime` predicate. Mirrors lazycogs'
	 * `DuckdbClient(use_hive_partitioning=True)`.
	 */
	useHivePartitioning?: boolean;
	/**
	 * When true, run `EXPLAIN <query>` once per `runQuery()` and log the plan
	 * to the console. Used to verify partition pruning hits parquet stats.
	 * Off by default — never enable in shipped UI.
	 */
	debugExplain?: boolean;
	/**
	 * Mobile / low-memory mode. When true the source caps the effective
	 * LIMIT (regardless of the caller's request) and skips
	 * `ORDER BY datetime DESC` so DuckDB can stop reading after the first
	 * N parquet rows instead of fully materializing every row's STRUCT
	 * `assets` column to compute a Top-N. The trade-off: items are
	 * returned in file order, not freshness order. Defaults to a
	 * mobile-UA detection at module load when undefined.
	 */
	lowMemoryMode?: boolean;
	/** Hard cap on `req.limit` when `lowMemoryMode` is on. Default 200. */
	lowMemoryLimit?: number;
}

/**
 * Default mobile detection used when `lowMemoryMode` is not explicitly set.
 * iOS Safari caps the WASM heap at ~1.8 GiB and rarely engages OPFS spill
 * (`credentialless` COEP only landed in 17.6), so STRUCT-heavy stac-geoparquet
 * scans OOM during the parquet decode before any rows reach the consumer.
 */
function detectLowMemoryDefault(): boolean {
	if (typeof navigator === 'undefined') return false;
	if (/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) return true;
	if (typeof window === 'undefined') return false;
	return Math.min(window.innerWidth, window.innerHeight) <= 820;
}

export interface QueryStacGeoparquetOptions {
	signal?: AbortSignal;
	/** Hard cap on rows. Matches `hydrateStacItems` default. */
	limit?: number;
	/**
	 * When true, omit `ORDER BY datetime DESC` from the SQL. Sorting forces
	 * DuckDB's Top-N operator to read every row's heavy STRUCT `assets`
	 * column before the LIMIT engages, which OOMs the WASM heap on mobile
	 * Safari (~1.8 GiB cap, no OPFS spill). Without the sort the parquet
	 * scan can stop after the first N rows in file order. The trade-off:
	 * the user sees the first N items by file order, not the freshest N.
	 */
	skipOrderBy?: boolean;
	/**
	 * Hive-partitioning context resolved at source construction. When
	 * `enabled === true` the runtime FROM target is a `read_parquet` glob
	 * over `tab.path` and `union_by_name=true` is applied. The probe lives
	 * on the source (`createParquetSource` awaits it once before the first
	 * runQuery), not in `runQuery` itself, so the per-pan path stays cheap.
	 */
	hive?: { enabled: boolean };
	/**
	 * Debug flag, propagated from source options. See
	 * `CreateParquetSourceOptions.debugExplain`.
	 */
	debugExplain?: boolean;
	/**
	 * Optional WGS84 viewport bbox `[west, south, east, north]`. When set the
	 * query is filtered with `ST_Intersects(geometry, ST_MakeEnvelope(...))` so
	 * the parquet path mirrors the API's viewport-scoped behavior. Skipped when
	 * the geometry column is missing (already guarded above).
	 */
	bbox?: [number, number, number, number];
	/**
	 * Optional ISO 8601 datetime range. When set and the parquet has a
	 * `datetime` column, the predicate is pushed into the WHERE clause as
	 * `datetime BETWEEN TIMESTAMPTZ ... AND TIMESTAMPTZ ...`. Without this
	 * push-down the LIMIT + `ORDER BY datetime DESC` would drop older rows
	 * before the client-side filter ever ran, so picking an older window
	 * returned zero items.
	 */
	datetime?: { min?: string; max?: string };
}

/**
 * Build a SQL fragment for the datetime filter or return `null` when nothing
 * is selected. Each bound is round-tripped through `Date.parse` + `toISOString`
 * so a malformed input is dropped instead of being inlined into SQL.
 *
 * The STAC item-properties spec lets a row carry either a single `datetime`
 * timestamp OR a `start_datetime`+`end_datetime` interval (Landsat composites,
 * climate reanalysis, etc.). When the parquet schema exposes the interval
 * columns we widen the predicate so interval-only rows are not silently
 * excluded by the simpler `datetime BETWEEN ...` form.
 */
function buildDatetimeWhere(
	filter: { min?: string; max?: string } | undefined,
	available: { datetime: boolean; startDatetime: boolean; endDatetime: boolean }
): string | null {
	if (!filter) return null;
	const minIso =
		filter.min && Number.isFinite(Date.parse(filter.min))
			? new Date(Date.parse(filter.min)).toISOString()
			: null;
	const maxIso =
		filter.max && Number.isFinite(Date.parse(filter.max))
			? new Date(Date.parse(filter.max)).toISOString()
			: null;
	if (!minIso && !maxIso) return null;

	// Predicate matching a single `datetime` column.
	const dtParts: string[] = [];
	if (minIso) dtParts.push(`datetime >= TIMESTAMPTZ '${minIso}'`);
	if (maxIso) dtParts.push(`datetime <= TIMESTAMPTZ '${maxIso}'`);
	const dtClause = dtParts.length > 0 ? dtParts.join(' AND ') : null;

	// Predicate matching the interval form: an item's [start, end] overlaps the
	// requested window when start <= max AND end >= min.
	const intervalParts: string[] = [];
	if (maxIso) intervalParts.push(`start_datetime <= TIMESTAMPTZ '${maxIso}'`);
	if (minIso) intervalParts.push(`end_datetime >= TIMESTAMPTZ '${minIso}'`);
	const intervalClause =
		available.startDatetime && available.endDatetime && intervalParts.length > 0
			? intervalParts.join(' AND ')
			: null;

	if (available.datetime && intervalClause && dtClause) {
		// Either a row's `datetime` falls in the window, or the item carries an
		// interval that overlaps it. NULL `datetime` rows are excluded by the
		// first branch (NULL comparisons are NULL/false), but the second branch
		// catches them via the interval columns.
		return `((${dtClause}) OR (${intervalClause}))`;
	}
	if (available.datetime && dtClause) return dtClause;
	if (intervalClause) return intervalClause;
	return null;
}

function buildBboxWhere(bbox: [number, number, number, number] | undefined): string | null {
	if (!bbox || bbox.length !== 4 || !bbox.every((n) => Number.isFinite(n))) return null;
	const [w, s, e, n] = bbox;
	return `ST_Intersects(geometry, ST_MakeEnvelope(${w}, ${s}, ${e}, ${n}))`;
}

function joinWhere(parts: (string | null)[]): string {
	const live = parts.filter((p): p is string => p !== null && p.length > 0);
	return live.length === 0 ? '' : ` WHERE ${live.join(' AND ')}`;
}

const DEFAULT_LIMIT = DEFAULT_APP_CONFIG.defaults.mosaicItemLimit;

/**
 * Build the SELECT list. All columns are optional in the stac-geoparquet
 * spec, so we only project what we know we'll use and the spec requires.
 * The optional `proj:*` / `raster:*` / `bands` columns are sniffed from the
 * schema so missing columns don't trigger a DuckDB binder error.
 */
function buildSelectList(availableColumns: Set<string>): string {
	const required = [
		'id',
		'collection',
		'type',
		'stac_version',
		'stac_extensions',
		'assets',
		'bbox',
		'links'
	];
	const optional = [
		'datetime',
		'start_datetime',
		'end_datetime',
		'created',
		'updated',
		'eo:cloud_cover',
		'gsd',
		'platform',
		'constellation',
		'instruments',
		'proj:code',
		'proj:bbox',
		'proj:transform',
		'proj:shape',
		'raster:spatial_resolution',
		'bands'
	];

	const cols: string[] = [];
	for (const name of required) {
		if (availableColumns.has(name)) cols.push(quoteIdent(name));
	}
	for (const name of optional) {
		if (availableColumns.has(name)) cols.push(quoteIdent(name));
	}
	// Always project geometry as WKB so parseWKB can decode it regardless of
	// whether DuckDB presents it as the v1.5 GEOMETRY type or a plain BLOB.
	if (availableColumns.has('geometry')) {
		cols.push('ST_AsWKB(geometry) AS geom_wkb');
	}
	return cols.join(', ');
}

function quoteIdent(name: string): string {
	return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Strip a trailing `/` and any URL fragment / query so a directory URL like
 * `s3://bucket/cache/` becomes `s3://bucket/cache`. The `**\/*.parquet` glob
 * is then appended for the hive read_parquet call.
 */
function trimDirectoryUrl(url: string): string {
	const noQuery = url.split('?')[0].split('#')[0];
	return noQuery.endsWith('/') ? noQuery.slice(0, -1) : noQuery;
}

/**
 * Build the FROM-clause target for a hive-partitioned parquet directory.
 * `union_by_name=true` is required because partitioned writes can drift
 * schemas across partitions (extra `proj:*` columns added later, etc.) and
 * positional union would error out on the first mismatch.
 */
function buildHiveReadParquet(directoryUrl: string): string {
	const root = trimDirectoryUrl(directoryUrl);
	const escaped = root.replace(/'/g, "''");
	return `read_parquet('${escaped}/**/*.parquet', hive_partitioning=true, union_by_name=true)`;
}

/**
 * Best-effort confirmation that a directory contains at least one parquet
 * file. Returns true on the first match. Listing failures fall back to
 * `true` so we still attempt the hive query — DuckDB will surface the real
 * error if the path is empty. Adapters that don't list (UrlAdapter) return
 * an empty array, in which case we also fall through to `true`.
 */
async function probeHasParquetChild(
	adapter: StorageAdapter | undefined,
	tabPath: string,
	signal: AbortSignal | undefined
): Promise<boolean> {
	if (!adapter) return true;
	try {
		const entries = await adapter.list(tabPath, signal);
		if (!Array.isArray(entries) || entries.length === 0) return true;
		return entries.some(
			(e) =>
				!e.is_dir &&
				(e.extension?.toLowerCase() === 'parquet' ||
					e.extension?.toLowerCase() === 'geoparquet' ||
					e.name?.toLowerCase().endsWith('.parquet') ||
					e.name?.toLowerCase().endsWith('.geoparquet'))
		);
	} catch {
		return true;
	}
}

/**
 * Build the FROM-clause target. For single-file parquet this is the resolved
 * `read_parquet('url')` from `resolveTableSourceAsync`; for hive directories
 * we override with a recursive glob + `hive_partitioning=true` so DuckDB
 * prunes partition columns from the predicate. `union_by_name=true` is
 * load-bearing — partitioned writes can drift schemas across partitions
 * (extra `proj:*` columns added later, etc.) and positional union would
 * error out on the first mismatch.
 */
function buildFromTarget(resolved: ResolvedTableSource, hive: boolean): string {
	if (!hive) return resolved.ref;
	const url = resolved.fileUrl;
	if (!url) {
		// Hive was requested but we never resolved an httpfs URL (e.g.
		// SQL-backed source). Fall back to the resolved ref — DuckDB will
		// surface the real error if the path can't be globbed.
		return resolved.ref;
	}
	return buildHiveReadParquet(url);
}

/**
 * Stream the catalog as Arrow RecordBatches and yield each batch's items as a
 * separate chunk. Peak DuckDB-WASM heap usage tracks one Arrow batch (~64 KiB
 * rows) instead of the full result set; for a 4000-item LIMIT against a
 * stac-geoparquet root with deep `assets` / `bands` payloads this turns the
 * "Out of Memory ... 3.1 GiB / 3.1 GiB used" failure into a steady-state
 * stream that the viewer can also render progressively. Falls back to a
 * single-batch buffered query when the engine has no `queryStream` (test
 * doubles, future engine impls).
 */
async function* streamQuery(
	tab: Tab,
	connId: string,
	opts: QueryStacGeoparquetOptions
): AsyncIterable<{ items: StacItem[]; final: boolean }> {
	const { signal, limit = DEFAULT_LIMIT, bbox, datetime } = opts;
	const hiveEnabled = opts.hive?.enabled === true;
	if (signal?.aborted) throw new QueryCancelledError();

	const engine = await getQueryEngine();
	const resolved = await resolveTableSourceAsync(tab);
	if (signal?.aborted) throw new QueryCancelledError();

	const fromTarget = buildFromTarget(resolved, hiveEnabled);
	const schemaSource: ResolvedTableSource = hiveEnabled
		? { ...resolved, ref: fromTarget }
		: resolved;

	const schema = await engine.getSchema(connId, schemaSource);
	if (signal?.aborted) throw new QueryCancelledError();
	const available = new Set(schema.map((f) => f.name));

	const selectList = buildSelectList(available);
	if (!available.has('geometry') || !available.has('assets')) {
		throw new Error('Not a stac-geoparquet file (missing geometry or assets column)');
	}

	const datetimeAvailability = {
		datetime: available.has('datetime'),
		startDatetime: available.has('start_datetime'),
		endDatetime: available.has('end_datetime')
	};
	const datetimeWhere = buildDatetimeWhere(datetime, datetimeAvailability);
	const whereClause = joinWhere([buildBboxWhere(bbox), datetimeWhere]);
	// `ORDER BY datetime DESC LIMIT N` is a Top-N: DuckDB still has to read
	// every row's STRUCT `assets` payload before the limit engages. On a
	// mobile WASM heap (~1.8 GiB ceiling, no OPFS spill) that OOMs in the
	// parquet decoder before any rows reach the consumer. `skipOrderBy`
	// trades freshness ordering for early-exit at LIMIT.
	const orderClause =
		opts.skipOrderBy || !available.has('datetime') ? '' : ' ORDER BY datetime DESC';

	const safeLimit = Math.max(1, Math.floor(Number(limit) || DEFAULT_LIMIT));
	const sql = `SELECT ${selectList} FROM ${fromTarget}${whereClause}${orderClause} LIMIT ${safeLimit}`;

	if (opts.debugExplain) {
		try {
			const plan = (await engine.query(connId, `EXPLAIN ${sql}`)) as {
				rows: Record<string, unknown>[];
			};
			// eslint-disable-next-line no-console
			console.debug('[stac-source-parquet] EXPLAIN', { hive: hiveEnabled, sql, plan });
		} catch (e) {
			// eslint-disable-next-line no-console
			console.debug('[stac-source-parquet] EXPLAIN failed', e);
		}
		if (signal?.aborted) throw new QueryCancelledError();
	}

	const parquetUrl = resolved.fileUrl ?? tab.path;
	const parquetDir = parquetUrl.replace(/[^/]*(?:\?.*)?$/, '');
	const rowToItem = (row: Record<string, unknown>): StacItem => {
		const id = typeof row.id === 'string' ? row.id : String(row.id ?? '');
		const itemBase = id ? `${parquetDir}${id}/` : parquetUrl;
		return stacRowToItem(row, itemBase, { wkbParser: parseWKB });
	};

	if (engine.queryStream) {
		const stream = engine.queryStream(connId, sql, signal);
		const it = stream[Symbol.asyncIterator]();
		let pending: { items: StacItem[] } | null = null;
		while (true) {
			const { value, done } = await it.next();
			if (done) break;
			if (signal?.aborted) throw new QueryCancelledError();
			const items = (value.rows as Record<string, unknown>[]).map(rowToItem);
			// One-batch lookahead so we know which yield is the final one without
			// driving the consumer to track it.
			if (pending) yield { items: pending.items, final: false };
			pending = { items };
		}
		yield { items: pending?.items ?? [], final: true };
		return;
	}

	// Fallback: buffered single-batch path (engines without queryStream).
	let resultPromise: Promise<{ rows: Record<string, unknown>[] }>;
	let cancel: (() => Promise<boolean>) | null = null;
	if (engine.queryCancellable) {
		const handle = engine.queryCancellable(connId, sql);
		cancel = handle.cancel;
		resultPromise = handle.result as Promise<{ rows: Record<string, unknown>[] }>;
	} else {
		resultPromise = engine.query(connId, sql) as Promise<{ rows: Record<string, unknown>[] }>;
	}
	const onAbort = () => {
		cancel?.().catch(() => {});
	};
	signal?.addEventListener('abort', onAbort, { once: true });
	let rows: Record<string, unknown>[];
	try {
		const result = await resultPromise;
		rows = result.rows ?? [];
	} finally {
		signal?.removeEventListener('abort', onAbort);
	}
	if (signal?.aborted) throw new QueryCancelledError();
	yield { items: rows.map(rowToItem), final: true };
}

/**
 * stac-geoparquet `StacSource`. Slice 1: bbox is the only push-down,
 * single yield with `done: true`. Slice 3 widens push-down (cloud cover /
 * gsd / platform via DuckDB SQL) and turns this into a streaming
 * `conn.send()` cursor.
 *
 * `options.useHivePartitioning` switches the FROM target to a recursive
 * `read_parquet` glob over `tab.path` so DuckDB prunes partitions per
 * `bbox` / `datetime` predicate. The first `query()` call awaits a
 * best-effort `adapter.list()` probe to confirm at least one `.parquet`
 * child exists; if listing fails (e.g. UrlAdapter, AccessDenied) we still
 * attempt the hive query and let DuckDB surface the real error.
 */
export function createParquetSource(
	tab: Tab,
	connectionId: string,
	options: CreateParquetSourceOptions = {}
): StacSource {
	const requestedHive = options.useHivePartitioning === true;
	const lowMemoryMode = options.lowMemoryMode ?? detectLowMemoryDefault();
	const lowMemoryLimit = Math.max(1, Math.floor(options.lowMemoryLimit ?? 200));
	const capabilities: StacSourceCapabilities = {
		kind: 'parquet',
		label: requestedHive ? 'stac-geoparquet (hive)' : 'stac-geoparquet',
		countAvailable: true,
		// Now true: `streamQuery` yields one StacSourceBatch per Arrow
		// RecordBatch via the engine's `queryStream` cursor, so peak DuckDB
		// heap usage tracks one batch instead of the full result set. This
		// fixes the `Out of Memory ... in-memory mode` OOM on large catalogs
		// and lets the mosaic render progressively as items arrive.
		streaming: true,
		hivePartitioned: requestedHive,
		pushdown: { ...emptyPushdown(), bbox: true, datetime: true }
	};

	const connId = connectionId;
	// The probe is purely advisory: when `useHivePartitioning: true` is
	// passed, we always run the hive query, but the first probe logs (in
	// debug mode) whether the directory actually has parquet children so a
	// misconfigured path gets a faster signal than DuckDB's binder error.
	// The probe result is cached so a second viewport reload doesn't re-list.
	let hiveProbe: Promise<boolean> | null = null;
	const ensureHive = async (signal: AbortSignal | undefined): Promise<boolean> => {
		if (!requestedHive) return false;
		if (!hiveProbe) hiveProbe = probeHasParquetChild(options.adapter, tab.path, signal);
		const probed = await hiveProbe;
		if (options.debugExplain && !probed) {
			// eslint-disable-next-line no-console
			console.debug('[stac-source-parquet] hive probe found no .parquet children', {
				path: tab.path
			});
		}
		return true;
	};

	return {
		capabilities,
		async *query(req: StacSourceRequest): AsyncIterable<StacSourceBatch> {
			if (req.signal.aborted) throw new DOMException('Aborted', 'AbortError');
			const hiveEnabled = await ensureHive(req.signal);
			if (req.signal.aborted) throw new DOMException('Aborted', 'AbortError');
			const pushedDown: FacetState = req.filter?.datetime ? { datetime: req.filter.datetime } : {};
			const { datetime: _pushed, ...residualRest } = req.filter ?? {};
			const residual: FacetState = residualRest;
			let totalSoFar = 0;
			// On mobile, clamp the LIMIT regardless of caller request and
			// drop the ORDER BY so the parquet scan can early-exit. The
			// caller's higher cap (e.g. 2000) would still trigger the
			// 858 MB / 1.8 GiB OOM during STRUCT materialization.
			const effectiveLimit = lowMemoryMode
				? Math.min(req.limit ?? lowMemoryLimit, lowMemoryLimit)
				: req.limit;
			for await (const chunk of streamQuery(tab, connId, {
				signal: req.signal,
				limit: effectiveLimit,
				bbox: req.bbox,
				datetime: req.filter?.datetime,
				hive: { enabled: hiveEnabled },
				debugExplain: options.debugExplain,
				skipOrderBy: lowMemoryMode
			})) {
				if (req.signal.aborted) throw new DOMException('Aborted', 'AbortError');
				totalSoFar += chunk.items.length;
				yield {
					items: chunk.items,
					pushedDown,
					residual,
					done: chunk.final,
					totalHinted: chunk.final ? totalSoFar : undefined
				};
			}
		},
		async count(filter, bbox, signal) {
			if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
			const hiveEnabled = await ensureHive(signal);
			if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
			const engine = await getQueryEngine();
			const resolved = await resolveTableSourceAsync(tab);
			if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
			const fromTarget = buildFromTarget(resolved, hiveEnabled);
			const schemaSource: ResolvedTableSource = hiveEnabled
				? { ...resolved, ref: fromTarget }
				: resolved;
			const schema = await engine.getSchema(connId, schemaSource);
			if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
			const available = new Set(schema.map((f) => f.name));
			const datetimeWhere = buildDatetimeWhere(filter?.datetime, {
				datetime: available.has('datetime'),
				startDatetime: available.has('start_datetime'),
				endDatetime: available.has('end_datetime')
			});
			const where = joinWhere([buildBboxWhere(bbox), datetimeWhere]);
			const sql = `SELECT COUNT(*) AS n FROM ${fromTarget}${where}`;
			const result = (await engine.query(connId, sql)) as { rows: { n?: number | bigint }[] };
			const raw = result.rows?.[0]?.n ?? 0;
			return typeof raw === 'bigint' ? Number(raw) : Number(raw);
		}
	};
}
