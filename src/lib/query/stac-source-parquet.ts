/**
 * stac-geoparquet implementation of the StacSource contract.
 *
 * Reuses:
 *   - `getQueryEngine()` + `queryCancellable`/`query` for the single worker
 *   - `resolveTableSourceAsync(tab)` for presigned `signed-s3` URL handling
 *   - `stacRowToItem` from `utils/stac-geoparquet.js` for the pure transform
 *   - `parseWKB` from `utils/wkb.js` for geometry decoding
 *
 * Push-down: `bbox` (`ST_Intersects` + `ST_MakeEnvelope`) and `datetime`
 * (`datetime BETWEEN TIMESTAMPTZ ...`). Without the datetime push-down,
 * `LIMIT + ORDER BY datetime DESC` silently drops older rows before the
 * client-side filter ever runs, so any window outside the freshest N items
 * returned zero matches. Cloud cover / GSD / platform / etc. still ride
 * along on the residual until slice 3 plumbs them through DuckDB SQL.
 *
 * Yields a single batch with `done: true`. Slice 3 turns this into a real
 * stream via `conn.send()` so large catalogs can render progressively.
 */

import type { Tab } from '../types.js';
import type { StacItem } from '../utils/stac.js';
import type { FacetState } from '../utils/stac-facets.js';
import { stacRowToItem } from '../utils/stac-geoparquet.js';
import {
	emptyPushdown,
	type StacSource,
	type StacSourceBatch,
	type StacSourceCapabilities,
	type StacSourceRequest
} from '../utils/stac-source.js';
import { parseWKB } from '../utils/wkb.js';
import { QueryCancelledError } from './engine.js';
import { getQueryEngine } from './index.js';
import { resolveTableSourceAsync } from './source.js';

export interface QueryStacGeoparquetOptions {
	signal?: AbortSignal;
	/** Hard cap on rows. Matches `hydrateStacItems` default. */
	limit?: number;
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

const DEFAULT_LIMIT = 2000;

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

/** Run one full materialization of the catalog into a flat StacItem list. */
async function runQuery(
	tab: Tab,
	connId: string,
	opts: QueryStacGeoparquetOptions
): Promise<StacItem[]> {
	const { signal, limit = DEFAULT_LIMIT, bbox, datetime } = opts;
	if (signal?.aborted) throw new QueryCancelledError();

	const engine = await getQueryEngine();
	const resolved = await resolveTableSourceAsync(tab);
	if (signal?.aborted) throw new QueryCancelledError();

	const schema = await engine.getSchema(connId, resolved);
	if (signal?.aborted) throw new QueryCancelledError();
	const available = new Set(schema.map((f) => f.name));

	const selectList = buildSelectList(available);
	if (!available.has('geometry') || !available.has('assets')) {
		throw new Error('Not a stac-geoparquet file (missing geometry or assets column)');
	}

	// Validate bbox + datetime values before inlining into SQL. The engine path
	// takes raw SQL strings (no parameter binding), so the validation in
	// `buildBboxWhere` / `buildDatetimeWhere` is what makes this injection-safe.
	const datetimeAvailability = {
		datetime: available.has('datetime'),
		startDatetime: available.has('start_datetime'),
		endDatetime: available.has('end_datetime')
	};
	const datetimeWhere = buildDatetimeWhere(datetime, datetimeAvailability);
	const whereClause = joinWhere([buildBboxWhere(bbox), datetimeWhere]);
	const orderClause = available.has('datetime') ? ' ORDER BY datetime DESC' : '';

	const safeLimit = Math.max(1, Math.floor(Number(limit) || DEFAULT_LIMIT));
	const sql = `SELECT ${selectList} FROM ${resolved.ref}${whereClause}${orderClause} LIMIT ${safeLimit}`;

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

	// Asset hrefs in stac-geoparquet are typically written relative to each
	// item's original `self` URL, not the parquet URL. The stactools default
	// layout places each item JSON at `{catalog_dir}/{item.id}/{item.id}.json`,
	// so a per-row base of `{parquet_dir}/{item.id}/` resolves `./foo.tif` to
	// `{parquet_dir}/{item.id}/foo.tif`. Absolute hrefs pass through unchanged
	// via `resolveStacAssetHref`.
	const parquetUrl = resolved.fileUrl ?? tab.path;
	const parquetDir = parquetUrl.replace(/[^/]*(?:\?.*)?$/, '');

	return rows.map((row) => {
		const id = typeof row.id === 'string' ? row.id : String(row.id ?? '');
		const itemBase = id ? `${parquetDir}${id}/` : parquetUrl;
		return stacRowToItem(row, itemBase, { wkbParser: parseWKB });
	});
}

/**
 * stac-geoparquet `StacSource`. Slice 1: bbox is the only push-down,
 * single yield with `done: true`. Slice 3 widens push-down (cloud cover /
 * gsd / platform via DuckDB SQL) and turns this into a streaming
 * `conn.send()` cursor.
 */
export function createParquetSource(tab: Tab, connectionId: string): StacSource {
	const capabilities: StacSourceCapabilities = {
		kind: 'parquet',
		label: 'stac-geoparquet',
		countAvailable: true,
		streaming: false,
		pushdown: { ...emptyPushdown(), bbox: true, datetime: true }
	};

	const connId = connectionId;

	return {
		capabilities,
		async *query(req: StacSourceRequest): AsyncIterable<StacSourceBatch> {
			if (req.signal.aborted) throw new DOMException('Aborted', 'AbortError');
			const items = await runQuery(tab, connId, {
				signal: req.signal,
				limit: req.limit,
				bbox: req.bbox,
				datetime: req.filter?.datetime
			});
			if (req.signal.aborted) throw new DOMException('Aborted', 'AbortError');
			// `datetime` is pushed down via SQL, so report it in `pushedDown`
			// and strip it from the residual. Everything else still rides
			// along until later slices add property push-down.
			const pushedDown: FacetState = req.filter?.datetime ? { datetime: req.filter.datetime } : {};
			const { datetime: _pushed, ...residualRest } = req.filter ?? {};
			const residual: FacetState = residualRest;
			yield {
				items,
				pushedDown,
				residual,
				done: true,
				totalHinted: items.length
			};
		},
		async count(filter, bbox, signal) {
			if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
			const engine = await getQueryEngine();
			const resolved = await resolveTableSourceAsync(tab);
			if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
			const schema = await engine.getSchema(connId, resolved);
			if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
			const available = new Set(schema.map((f) => f.name));
			const datetimeWhere = buildDatetimeWhere(filter?.datetime, {
				datetime: available.has('datetime'),
				startDatetime: available.has('start_datetime'),
				endDatetime: available.has('end_datetime')
			});
			const where = joinWhere([buildBboxWhere(bbox), datetimeWhere]);
			const sql = `SELECT COUNT(*) AS n FROM ${resolved.ref}${where}`;
			const result = (await engine.query(connId, sql)) as { rows: { n?: number | bigint }[] };
			const raw = result.rows?.[0]?.n ?? 0;
			return typeof raw === 'bigint' ? Number(raw) : Number(raw);
		}
	};
}
