/**
 * Read a stac-geoparquet file through the existing DuckDB-WASM engine and
 * materialize a standard STAC FeatureCollection in memory.
 *
 * Reuses:
 *   - `getQueryEngine()` + `queryCancellable`/`query` for the single worker
 *   - `resolveTableSourceAsync(tab)` for presigned `signed-s3` URL handling
 *   - `stacRowToItem` from `utils/stac-geoparquet.js` for the pure transform
 *   - `parseWKB` from `utils/wkb.js` for geometry decoding
 *
 * The returned `FeatureCollection` is the same shape `classifyStac()` returns
 * as `{ kind: 'item-collection', fc }`, so downstream viewers
 * (`StacMosaicViewer`, `MultiCogViewer`) consume it unchanged.
 */

import type { Tab } from '../types.js';
import type { StacFeatureCollection, StacItem } from '../utils/stac.js';
import { stacRowToItem } from '../utils/stac-geoparquet.js';
import { parseWKB } from '../utils/wkb.js';
import { QueryCancelledError } from './engine.js';
import { getQueryEngine } from './index.js';
import { resolveTableSourceAsync } from './source.js';

export interface QueryStacGeoparquetOptions {
	signal?: AbortSignal;
	/** Hard cap on rows. Matches `hydrateStacItems` default. */
	limit?: number;
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
 * Query a stac-geoparquet tab and return a STAC FeatureCollection whose
 * features are proper STAC Items (assets absolutized, WKB decoded, bbox
 * flattened).
 *
 * @param tab - the tab pointing at the `.parquet` file
 * @param connId - connection id used for DuckDB's httpfs S3 config; pass
 *   an empty string for URL-source tabs (DuckDB will use anonymous httpfs)
 */
export async function queryStacGeoparquetFeatureCollection(
	tab: Tab,
	connId: string,
	opts: QueryStacGeoparquetOptions = {}
): Promise<StacFeatureCollection> {
	const { signal, limit = DEFAULT_LIMIT } = opts;
	if (signal?.aborted) throw new QueryCancelledError();

	const engine = await getQueryEngine();
	const resolved = await resolveTableSourceAsync(tab);
	if (signal?.aborted) throw new QueryCancelledError();

	// Discover which optional columns are present so the SELECT list doesn't
	// reference missing columns.
	const schema = await engine.getSchema(connId, resolved);
	if (signal?.aborted) throw new QueryCancelledError();
	const available = new Set(schema.map((f) => f.name));

	const selectList = buildSelectList(available);
	if (!available.has('geometry') || !available.has('assets')) {
		throw new Error('Not a stac-geoparquet file (missing geometry or assets column)');
	}

	const sql = `SELECT ${selectList} FROM ${resolved.ref} LIMIT ${limit}`;

	// Prefer cancellable path when the engine exposes it.
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

	const features: StacItem[] = rows.map((row) => {
		const id = typeof row.id === 'string' ? row.id : String(row.id ?? '');
		const itemBase = id ? `${parquetDir}${id}/` : parquetUrl;
		return stacRowToItem(row, itemBase, { wkbParser: parseWKB });
	});

	return {
		type: 'FeatureCollection',
		features
	};
}
