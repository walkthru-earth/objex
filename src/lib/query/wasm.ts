import type { DuckDBBundles } from '@duckdb/duckdb-wasm';
import { buildDuckDbSource } from '$lib/file-icons/index.js';
import { credentialStore } from '$lib/stores/credentials.svelte.js';
import {
	type MapQueryHandle,
	type MapQueryResult,
	QueryCancelledError,
	type QueryEngine,
	type QueryHandle,
	type QueryResult,
	type SchemaField
} from './engine';

// CDN URLs for DuckDB WASM bundles — version injected at build time from package.json
declare const __DUCKDB_WASM_VERSION__: string;
const DUCKDB_VERSION = __DUCKDB_WASM_VERSION__;
const CDN_BASE = `https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@${DUCKDB_VERSION}/dist`;

const duckdb_wasm = `${CDN_BASE}/duckdb-mvp.wasm`;
const mvp_worker = `${CDN_BASE}/duckdb-browser-mvp.worker.js`;
const duckdb_wasm_eh = `${CDN_BASE}/duckdb-eh.wasm`;
const eh_worker = `${CDN_BASE}/duckdb-browser-eh.worker.js`;

const INIT_TIMEOUT_MS = 30_000;

// ─── Performance & diagnostic logging ────────────────────────────────

const LOG_PREFIX = '[DuckDB]';

function log(...args: any[]) {
	console.log(LOG_PREFIX, ...args);
}

function logWarn(...args: any[]) {
	console.warn(LOG_PREFIX, ...args);
}

function elapsed(start: number): string {
	return `${(performance.now() - start).toFixed(1)}ms`;
}

let dbPromise: Promise<any> | null = null;
let geoConversionDisabled = false;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
		promise.then(
			(v) => {
				clearTimeout(timer);
				resolve(v);
			},
			(e) => {
				clearTimeout(timer);
				reject(e);
			}
		);
	});
}

async function getDB() {
	if (dbPromise) {
		log('getDB → cached');
		return dbPromise;
	}

	dbPromise = (async () => {
		const t0 = performance.now();
		log('getDB → initializing...');
		const duckdb = await import('@duckdb/duckdb-wasm');

		const MANUAL_BUNDLES: DuckDBBundles = {
			mvp: {
				mainModule: duckdb_wasm,
				mainWorker: mvp_worker
			},
			eh: {
				mainModule: duckdb_wasm_eh,
				mainWorker: eh_worker
			}
		};

		const bundle = await duckdb.selectBundle(MANUAL_BUNDLES);

		// Fetch the worker script as a blob to bypass cross-origin worker restrictions
		const workerScript = await fetch(bundle.mainWorker!).then((r) => r.blob());
		const workerUrl = URL.createObjectURL(workerScript);
		const worker = new Worker(workerUrl);
		URL.revokeObjectURL(workerUrl);
		const logger = new duckdb.ConsoleLogger();
		const db = new duckdb.AsyncDuckDB(logger, worker);

		await withTimeout(
			db.instantiate(bundle.mainModule, bundle.pthreadWorker),
			INIT_TIMEOUT_MS,
			'DuckDB WASM instantiation'
		);
		log(`getDB → instantiated in ${elapsed(t0)}`);

		// Load httpfs for remote file access and spatial for ST_ReadSHP
		const conn = await db.connect();
		try {
			const tExt = performance.now();
			await withTimeout(
				conn.query('INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial;'),
				INIT_TIMEOUT_MS,
				'extension install (httpfs + spatial)'
			);
			// Disable auto-conversion of GeoParquet metadata → GEOMETRY type.
			// Some files use legacy GeoParquet metadata (schema_version 0.x without
			// "version" field) which causes DuckDB's spatial extension to throw
			// "Geoparquet metadata does not have a version". We handle geometry
			// detection, CRS, and WKB conversion ourselves via hyparquet metadata
			// and explicit ST_GeomFromWKB() calls, so auto-conversion is not needed.
			await conn.query('SET enable_geoparquet_conversion = false');
			log(`getDB → extensions loaded in ${elapsed(tExt)}`);
		} finally {
			await conn.close();
		}

		log(`getDB → ready (total ${elapsed(t0)})`);
		return db;
	})();

	// If init fails, clear the promise so it can be retried
	dbPromise.catch(() => {
		dbPromise = null;
	});

	return dbPromise;
}

/**
 * Ensure GeoParquet auto-conversion is disabled on this connection.
 * It's a GLOBAL setting — once set, it persists for the DB instance.
 * The flag avoids redundant SET calls on subsequent connections.
 */
async function ensureGeoConversionDisabled(conn: any): Promise<void> {
	if (geoConversionDisabled) return;
	await conn.query('SET enable_geoparquet_conversion = false');
	geoConversionDisabled = true;
	log('ensureGeoConversionDisabled → SET applied');
}

// ─── CRS detection helpers ───────────────────────────────────────────

const WGS84_CODES = new Set([4326, 4979]);

/** Extract EPSG code from a PROJJSON object. Returns null for WGS84/CRS84. */
function extractEpsgFromProjjson(crs: any): string | null {
	if (!crs) return null;
	// OGC CRS84 is lon/lat WGS84
	if (crs.type === 'name' && crs.properties?.name?.includes('CRS84')) return null;
	// PROJJSON: { "id": { "authority": "EPSG", "code": 27700 } }
	if (crs.id?.authority === 'EPSG') {
		const code = crs.id.code;
		if (WGS84_CODES.has(code)) return null;
		return `EPSG:${code}`;
	}
	return null;
}

/**
 * Extract CRS from Parquet Format 2.11+ logical_type string.
 * Handles these patterns:
 *   GeometryType(crs={...PROJJSON...})          — inline PROJJSON
 *   GeometryType(crs=projjson:key_name)         — reference to KV metadata key
 *   GeometryType(crs=srid:5070)                 — direct SRID
 *   GeometryType(crs=<null>)                    — no CRS (WGS84)
 */
async function extractCrsFromLogicalType(
	logicalType: string,
	conn: any,
	path: string
): Promise<string | null> {
	if (!logicalType.startsWith('GeometryType(') && !logicalType.startsWith('GeographyType('))
		return null;

	// Extract the crs= value from inside the parentheses
	const crsMatch = logicalType.match(/crs=(.+?)(?:,\s*\w+=|\))/s);
	if (!crsMatch) return null;
	const crsValue = crsMatch[1].trim();

	// Null CRS — assume WGS84
	if (crsValue === '<null>' || crsValue === 'null') return null;

	// Pattern: srid:NNNN — direct SRID
	const sridMatch = crsValue.match(/^srid:(\d+)$/);
	if (sridMatch) {
		const code = Number(sridMatch[1]);
		if (WGS84_CODES.has(code)) return null;
		return `EPSG:${code}`;
	}

	// Pattern: projjson:key_name — reference to a KV metadata key
	const refMatch = crsValue.match(/^projjson:(.+)$/);
	if (refMatch) {
		try {
			const kvResult = await conn.query(
				`SELECT value FROM parquet_kv_metadata('${path}') WHERE decode(key) = '${refMatch[1]}'`
			);
			const kvRows = kvResult.toArray();
			if (kvRows.length > 0) {
				const raw = kvRows[0].value;
				const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
				return extractEpsgFromProjjson(JSON.parse(text));
			}
		} catch {
			/* metadata lookup failed */
		}
		return null;
	}

	// Pattern: {... PROJJSON ...} — inline JSON (find balanced braces)
	if (crsValue.startsWith('{')) {
		const jsonStart = logicalType.indexOf('{');
		if (jsonStart === -1) return null;
		let depth = 0;
		let jsonEnd = -1;
		for (let i = jsonStart; i < logicalType.length; i++) {
			if (logicalType[i] === '{') depth++;
			else if (logicalType[i] === '}') {
				depth--;
				if (depth === 0) {
					jsonEnd = i;
					break;
				}
			}
		}
		if (jsonEnd === -1) return null;
		try {
			const crs = JSON.parse(logicalType.substring(jsonStart, jsonEnd + 1));
			return extractEpsgFromProjjson(crs);
		} catch {
			return null;
		}
	}

	return null;
}

// ─── Type-aware column extraction ────────────────────────────────────
// DuckDB Arrow type strings that represent binary/blob data — not useful
// for map tooltips and expensive to extract row-by-row.
const BINARY_TYPES = new Set(['BLOB', 'BYTEA', 'BINARY', 'LARGEBINARY', 'WKB_BLOB']);

/** True if the Arrow type string represents a numeric primitive (zero-copy .toArray()). */
function isNumericArrowType(typeStr: string): boolean {
	const t = typeStr.toUpperCase();
	return (
		t.includes('INT') ||
		t.includes('FLOAT') ||
		t.includes('DOUBLE') ||
		t.includes('DECIMAL') ||
		t === 'TINYINT' ||
		t === 'SMALLINT' ||
		t === 'BIGINT' ||
		t === 'HUGEINT' ||
		t === 'UBIGINT' ||
		t === 'UINTEGER' ||
		t === 'USMALLINT' ||
		t === 'UTINYINT'
	);
}

/**
 * Extract column values using the fastest available method:
 * - Numeric primitives → .toArray() returns a typed array view (zero-copy),
 *   then Array.from() to convert to a plain JS array for downstream compat.
 * - Other types → per-element .get(i) for correctness (strings, structs, etc.)
 */
function extractColumnBulk(col: any, numRows: number, typeStr: string): any[] {
	if (isNumericArrowType(typeStr)) {
		// .toArray() returns a TypedArray (Float64Array, Int32Array, etc.)
		// which is a zero-copy view over the Arrow buffer.
		return Array.from(col.toArray());
	}
	const values: any[] = new Array(numRows);
	for (let i = 0; i < numRows; i++) {
		values[i] = col.get(i);
	}
	return values;
}

/**
 * Append column values from a streaming batch to an existing values array.
 * Same optimisation as extractColumnBulk but appends instead of creating new.
 */
function appendColumnBulk(target: any[], col: any, numRows: number, typeStr: string): void {
	if (isNumericArrowType(typeStr)) {
		const arr = col.toArray();
		for (let i = 0; i < arr.length; i++) {
			target.push(arr[i]);
		}
		return;
	}
	for (let i = 0; i < numRows; i++) {
		target.push(col.get(i));
	}
}

/** Should this column type be skipped for map attribute extraction? */
function isBinaryType(typeStr: string): boolean {
	return BINARY_TYPES.has(typeStr.toUpperCase());
}

export class WasmQueryEngine implements QueryEngine {
	async query(connId: string, sql: string): Promise<QueryResult> {
		const t0 = performance.now();
		const sqlPreview = sql.length > 120 ? `${sql.slice(0, 120)}…` : sql;
		log(`query → ${sqlPreview}`);

		const db = await getDB();
		const conn = await db.connect();
		await ensureGeoConversionDisabled(conn);
		const tConn = performance.now();
		log(`query → connected in ${elapsed(t0)}`);

		try {
			if (connId) {
				await this.configureStorage(conn, connId);
				log(`query → storage configured in ${elapsed(tConn)}`);
			}

			const tQuery = performance.now();
			const result = await conn.query(sql);
			log(`query → executed in ${elapsed(tQuery)}, rows: ${result.numRows}`);

			// DuckDB WASM returns an Arrow Table (bundled apache-arrow@17).
			// Our project uses apache-arrow@21 — cross-version tableToIPC/tableFromIPC
			// loses data rows. Extract rows directly from DuckDB's own Arrow Table.
			const numRows = result.numRows;
			const cols = result.schema.fields.map((f: any) => f.name);
			const types = result.schema.fields.map((f: any) => String(f.type));

			if (numRows === 0) {
				log(`query → done (empty) in ${elapsed(t0)}`);
				return {
					columns: cols,
					types,
					rowCount: 0,
					rows: []
				};
			}

			// Extract rows directly — avoids Arrow version mismatch
			const rows = result.toArray().map((row: any) => {
				if (typeof row.toJSON === 'function') return row.toJSON();
				// Fallback: manually build row object
				const obj: Record<string, any> = {};
				for (const col of cols) obj[col] = row[col];
				return obj;
			});

			log(`query → done in ${elapsed(t0)}, ${numRows} rows, ${cols.length} cols`);
			return { columns: cols, types, rowCount: numRows, rows };
		} catch (err) {
			logWarn(`query → failed after ${elapsed(t0)}:`, (err as Error)?.message ?? err);
			throw err;
		} finally {
			await conn.close();
		}
	}

	async queryForMap(
		connId: string,
		sql: string,
		geomCol: string,
		geomColType: string,
		sourceCrs?: string | null
	): Promise<MapQueryResult> {
		const t0 = performance.now();
		log(`queryForMap → geomCol: ${geomCol}, type: ${geomColType}, crs: ${sourceCrs ?? 'WGS84'}`);
		const db = await getDB();
		const conn = await db.connect();
		await ensureGeoConversionDisabled(conn);

		try {
			if (connId) {
				await this.configureStorage(conn, connId);
			}

			// Build geometry expression based on column type:
			// - Native spatial types (GEOMETRY, WKB_BLOB, POINT, etc.) → use directly
			// - BLOB/BINARY → DuckDB implicitly casts BLOB→GEOMETRY, use directly
			// - Everything else (VARCHAR, JSON, STRUCT, ...) → GeoJSON text
			const quoted = `"${geomCol}"`;
			const upper = geomColType.toUpperCase();
			// Spatial types that ST_AsWKB accepts directly (GEOMETRY, WKB_BLOB, etc.).
			// Includes Arrow "Binary"/"LargeBinary" — DuckDB GEOMETRY columns from
			// ST_ReadSHP/ST_Read appear as Arrow Binary but are NOT WKB blobs.
			const isSpatialType =
				upper === 'GEOMETRY' ||
				upper === 'GEOGRAPHY' ||
				upper === 'WKB_BLOB' ||
				upper.includes('POINT') ||
				upper.includes('LINESTRING') ||
				upper.includes('POLYGON') ||
				upper.includes('BINARY'); // Arrow serialization of DuckDB GEOMETRY
			// Actual WKB BLOB columns (e.g. GeoParquet) need explicit ST_GeomFromWKB
			// because DuckDB has no implicit BLOB→GEOMETRY cast.
			const isWkbBlob = upper === 'BLOB' || upper === 'BYTEA';

			let wkbExpr: string;
			let geomExpr: string;

			if (isWkbBlob && !sourceCrs) {
				// Already WKB — use directly, no conversion needed
				wkbExpr = quoted;
				geomExpr = `ST_GeomFromWKB(${quoted})`;
			} else {
				geomExpr = isSpatialType
					? quoted
					: isWkbBlob
						? `ST_GeomFromWKB(${quoted})`
						: `ST_GeomFromGeoJSON(${quoted})`;

				// Re-project to WGS84 if the source CRS is not EPSG:4326/CRS84.
				// always_xy := true forces lon/lat (x/y) axis order for both source and
				// target, matching the GeoParquet convention regardless of CRS authority.
				if (sourceCrs) {
					geomExpr = `ST_Transform(${geomExpr}, '${sourceCrs}', 'EPSG:4326', always_xy := true)`;
				}

				// ST_AsWKB needed — DuckDB GEOMETRY columns (from ST_ReadSHP, ST_Read)
				// use an internal binary format, not WKB, even though Arrow reports Binary type.
				wkbExpr = `ST_AsWKB(${geomExpr})`;
			}

			// Wrap query: WKB for binary geometry, ST_GeometryType for type detection
			const mapSql = `SELECT *, ${wkbExpr} AS __wkb,
				ST_GeometryType(${geomExpr}) AS __geom_type
				FROM (${sql}) __src`;
			const result = await conn.query(mapSql);

			// Extract raw WKB binary column — .get(i) returns Uint8Array from Arrow v17
			const wkbCol = result.getChild('__wkb');
			const wkbArrays: Uint8Array[] = [];
			for (let i = 0; i < wkbCol.length; i++) {
				const v = wkbCol.get(i);
				if (v) wkbArrays.push(v instanceof Uint8Array ? v : new Uint8Array(v));
			}

			// Detect geometry type from first non-null row
			const typeCol = result.getChild('__geom_type');
			let geometryType = 'POINT';
			for (let i = 0; i < typeCol.length; i++) {
				const t = typeCol.get(i);
				if (t) {
					geometryType = String(t);
					break;
				}
			}

			// Extract attribute columns (skip geometry, helper, and binary columns)
			const skipCols = new Set([geomCol, '__wkb', '__geom_type']);
			const attributes = new Map<string, { values: any[]; type: string }>();
			for (const field of result.schema.fields) {
				if (skipCols.has(field.name)) continue;
				const typeStr = String(field.type);
				// Skip binary/blob columns — not useful for map tooltips, expensive to extract
				if (isBinaryType(typeStr)) continue;
				const col = result.getChild(field.name);
				const values = extractColumnBulk(col, col.length, typeStr);
				attributes.set(field.name, { values, type: typeStr });
			}

			log(
				`queryForMap → done in ${elapsed(t0)}, ${wkbArrays.length} geometries (${geometryType}), ${attributes.size} attrs`
			);
			return { wkbArrays, geometryType, attributes, rowCount: wkbArrays.length };
		} catch (err) {
			logWarn(`queryForMap → failed after ${elapsed(t0)}:`, (err as Error)?.message ?? err);
			throw err;
		} finally {
			await conn.close();
		}
	}

	async getSchema(connId: string, path: string): Promise<SchemaField[]> {
		const t0 = performance.now();
		log('getSchema →', path);
		const db = await getDB();
		const conn = await db.connect();
		await ensureGeoConversionDisabled(conn);

		try {
			if (connId) {
				await this.configureStorage(conn, connId);
			}

			const source = buildDuckDbSource(path, path);
			const result = await conn.query(`DESCRIBE SELECT * FROM ${source}`);
			const rows = result.toArray();

			const schema = rows.map((row: any) => ({
				name: row.column_name,
				type: row.column_type,
				nullable: row.null === 'YES'
			}));
			log(`getSchema → done in ${elapsed(t0)}, ${schema.length} fields`);
			return schema;
		} catch (err) {
			logWarn('getSchema → failed:', (err as Error)?.message ?? err);
			throw err;
		} finally {
			await conn.close();
		}
	}

	async getRowCount(connId: string, path: string): Promise<number> {
		const t0 = performance.now();
		log('getRowCount →', path);
		const db = await getDB();
		const conn = await db.connect();
		await ensureGeoConversionDisabled(conn);

		try {
			if (connId) {
				await this.configureStorage(conn, connId);
			}

			// For Parquet files, try reading row count from file footer metadata first.
			// This avoids parsing column types (which can fail on exotic geometry types)
			// and is faster than SELECT COUNT(*) since it reads only footer bytes.
			const isParquet = /\.parquet$/i.test(path);
			if (isParquet) {
				try {
					const metaResult = await conn.query(
						`SELECT SUM(num_rows)::BIGINT as cnt FROM parquet_file_metadata('${path}')`
					);
					const metaRows = metaResult.toArray();
					const count = Number(metaRows[0].cnt);
					log(`getRowCount → ${count} via parquet_file_metadata in ${elapsed(t0)}`);
					return count;
				} catch (metaErr) {
					logWarn(
						'getRowCount → parquet_file_metadata failed, falling back to COUNT(*):',
						(metaErr as Error)?.message ?? metaErr
					);
				}
			}

			const source = buildDuckDbSource(path, path);
			const result = await conn.query(`SELECT COUNT(*) as cnt FROM ${source}`);
			const rows = result.toArray();
			const count = Number(rows[0].cnt);
			log(`getRowCount → ${count} via COUNT(*) in ${elapsed(t0)}`);
			return count;
		} catch (err) {
			logWarn('getRowCount → failed:', (err as Error)?.message ?? err);
			throw err;
		} finally {
			await conn.close();
		}
	}

	async getSchemaAndCrs(
		connId: string,
		path: string,
		findGeoCol: (schema: SchemaField[]) => string | null
	): Promise<{ schema: SchemaField[]; geomCol: string | null; crs: string | null }> {
		const t0 = performance.now();
		log('getSchemaAndCrs →', path);
		const db = await getDB();
		const conn = await db.connect();
		await ensureGeoConversionDisabled(conn);

		try {
			if (connId) {
				await this.configureStorage(conn, connId);
			}

			// Schema detection
			const tSchema = performance.now();
			const source = buildDuckDbSource(path, path);
			const result = await conn.query(`DESCRIBE SELECT * FROM ${source}`);
			const schemaRows = result.toArray();
			const schema: SchemaField[] = schemaRows.map((row: any) => ({
				name: row.column_name,
				type: row.column_type,
				nullable: row.null === 'YES'
			}));
			log(`getSchemaAndCrs → schema: ${schema.length} fields in ${elapsed(tSchema)}`);

			// Geo column detection via callback (avoids importing wkb utils here)
			const geomCol = findGeoCol(schema);
			if (!geomCol) {
				log(`getSchemaAndCrs → no geo column, done in ${elapsed(t0)}`);
				return { schema, geomCol: null, crs: null };
			}

			// CRS detection reusing the same connection
			log(`getSchemaAndCrs → geo column: ${geomCol}, detecting CRS...`);
			const tCrs = performance.now();
			const crs = await this.detectCrsWithConn(conn, path, geomCol);
			log(
				`getSchemaAndCrs → CRS: ${crs ?? 'WGS84/null'} in ${elapsed(tCrs)}, total ${elapsed(t0)}`
			);
			return { schema, geomCol, crs };
		} catch (err) {
			logWarn('getSchemaAndCrs → failed:', (err as Error)?.message ?? err);
			throw err;
		} finally {
			await conn.close();
		}
	}

	private async configureStorage(conn: any, connId: string) {
		try {
			// Read connection metadata from localStorage
			const stored = localStorage.getItem('obstore-explore-connections');
			if (!stored) {
				log('configureStorage → no connections in localStorage');
				return;
			}
			const connections = JSON.parse(stored);
			const connection = connections.find((c: any) => c.id === connId);
			if (!connection) {
				logWarn(`configureStorage → connection "${connId}" not found`);
				return;
			}

			// Azure uses direct HTTPS URLs with SAS token — no S3 config needed
			if (connection.provider === 'azure') {
				log('configureStorage → Azure provider, skipping S3 config');
				return;
			}

			// Batch all SET commands into a single query to minimize web worker round-trips
			const sets: string[] = [];

			// Set S3 credentials from in-memory credential store
			const creds = credentialStore.get(connId);
			if (creds && creds.type === 'sigv4') {
				sets.push(`SET s3_access_key_id = '${creds.accessKey}'`);
				sets.push(`SET s3_secret_access_key = '${creds.secretKey}'`);
			}

			if (connection.region) {
				sets.push(`SET s3_region = '${connection.region}'`);
			}
			if (connection.endpoint) {
				const endpoint = connection.endpoint.replace(/^https?:\/\//, '');
				sets.push(`SET s3_endpoint = '${endpoint}'`);
				if (connection.endpoint.startsWith('http://')) {
					sets.push(`SET s3_use_ssl = false`);
				}
			}
			// Always use path-style — virtual-hosted breaks for buckets with dots
			sets.push(`SET s3_url_style = 'path'`);

			if (sets.length > 0) {
				const t0 = performance.now();
				await conn.query(`${sets.join('; ')};`);
				log(
					`configureStorage → ${sets.length} SETs batched in ${elapsed(t0)} (provider: ${connection.provider ?? 's3'})`
				);
			}
		} catch (err) {
			console.error(LOG_PREFIX, 'configureStorage error:', err);
		}
	}

	async detectCrs(connId: string, path: string, geomCol: string): Promise<string | null> {
		const t0 = performance.now();
		log(`detectCrs → standalone call for "${geomCol}"`, path);
		const db = await getDB();
		const conn = await db.connect();
		await ensureGeoConversionDisabled(conn);
		try {
			if (connId) {
				await this.configureStorage(conn, connId);
			}

			const crs = await this.detectCrsWithConn(conn, path, geomCol);
			log(`detectCrs → ${crs ?? 'WGS84/null'} in ${elapsed(t0)}`);
			return crs;
		} catch (err) {
			logWarn('detectCrs → failed:', err);
			return null;
		} finally {
			await conn.close();
		}
	}

	private async detectCrsWithConn(
		conn: any,
		path: string,
		geomCol: string
	): Promise<string | null> {
		// Strategy 1: GeoParquet file-level metadata (geo key in KV metadata)
		try {
			const t1 = performance.now();
			const kvResult = await conn.query(
				`SELECT value FROM parquet_kv_metadata('${path}') WHERE CAST(key AS VARCHAR) = 'geo'`
			);
			const kvRows = kvResult.toArray();
			log(`detectCrs strategy 1 (kv_metadata) → ${kvRows.length} rows in ${elapsed(t1)}`);
			if (kvRows.length > 0) {
				const raw = kvRows[0].value;
				const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
				const geo = JSON.parse(text);
				const colMeta =
					geo.columns?.[geomCol] ?? (geo.columns ? (Object.values(geo.columns) as any[])[0] : null);
				if (colMeta) {
					// GeoParquet "geo" metadata is authoritative:
					// has crs → extract EPSG; no crs or crs: null → WGS84 per spec
					const result = colMeta.crs ? extractEpsgFromProjjson(colMeta.crs) : null;
					log(
						`detectCrs strategy 1 → authoritative: ${result ?? 'WGS84/null'} (skipping strategy 2)`
					);
					return result;
				}
				log('detectCrs strategy 1 → "geo" key found but no column metadata for', geomCol);
			}
		} catch (err) {
			log(
				'detectCrs strategy 1 → skipped (not GeoParquet or no KV metadata):',
				(err as Error)?.message ?? err
			);
		}

		// Strategy 2: Native Parquet GEOMETRY type (Parquet Format 2.11+)
		// CRS is in the schema logical_type: GeometryType(crs=...)
		try {
			const t2 = performance.now();
			const schemaResult = await conn.query(
				`SELECT logical_type FROM parquet_schema('${path}') WHERE name = '${geomCol}'`
			);
			const schemaRows = schemaResult.toArray();
			log(`detectCrs strategy 2 (parquet_schema) → ${schemaRows.length} rows in ${elapsed(t2)}`);
			if (schemaRows.length > 0) {
				const logicalType = String(schemaRows[0].logical_type ?? '');
				log(`detectCrs strategy 2 → logical_type: "${logicalType}"`);
				const epsg = await extractCrsFromLogicalType(logicalType, conn, path);
				if (epsg) {
					log(`detectCrs strategy 2 → found: ${epsg}`);
					return epsg;
				}
			}
		} catch (err) {
			log('detectCrs strategy 2 → skipped:', (err as Error)?.message ?? err);
		}

		log('detectCrs → no CRS found, assuming WGS84');
		return null;
	}

	queryCancellable(connId: string, sql: string): QueryHandle {
		let cancelled = false;
		let conn: any = null;

		const result = (async (): Promise<QueryResult> => {
			const t0 = performance.now();
			const sqlPreview = sql.length > 120 ? `${sql.slice(0, 120)}…` : sql;
			log(`queryCancellable → ${sqlPreview}`);

			const db = await getDB();
			conn = await db.connect();
			await ensureGeoConversionDisabled(conn);
			log(`queryCancellable → connected in ${elapsed(t0)}`);

			try {
				if (connId) {
					await this.configureStorage(conn, connId);
				}

				const tQuery = performance.now();
				const reader = await conn.send(sql);
				log(`queryCancellable → send() in ${elapsed(tQuery)}`);

				const rows: Record<string, any>[] = [];
				let cols: string[] = [];
				let types: string[] = [];

				const batches = reader[Symbol.asyncIterator]();
				let first = true;
				while (true) {
					if (cancelled) throw new QueryCancelledError();
					const { value: batch, done } = await batches.next();
					if (done) break;

					if (first && batch.schema) {
						cols = batch.schema.fields.map((f: any) => f.name);
						types = batch.schema.fields.map((f: any) => String(f.type));
						first = false;
					}

					for (const row of batch.toArray()) {
						rows.push(typeof row.toJSON === 'function' ? row.toJSON() : row);
					}
				}

				log(`queryCancellable → done in ${elapsed(t0)}, ${rows.length} rows`);
				return { columns: cols, types, rowCount: rows.length, rows };
			} catch (err) {
				if (cancelled || err instanceof QueryCancelledError) {
					log(`queryCancellable → cancelled after ${elapsed(t0)}`);
					throw new QueryCancelledError();
				}
				logWarn(`queryCancellable → failed after ${elapsed(t0)}:`, (err as Error)?.message ?? err);
				throw err;
			} finally {
				await conn?.close();
				conn = null;
			}
		})();

		const cancel = async (): Promise<boolean> => {
			cancelled = true;
			try {
				if (conn) await conn.cancelSent();
				return true;
			} catch {
				return false;
			}
		};

		return { result, cancel };
	}

	queryForMapCancellable(
		connId: string,
		sql: string,
		geomCol: string,
		geomColType: string,
		sourceCrs?: string | null
	): MapQueryHandle {
		let cancelled = false;
		let conn: any = null;

		const result = (async (): Promise<MapQueryResult> => {
			const t0 = performance.now();
			log(
				`queryForMapCancellable → geomCol: ${geomCol}, type: ${geomColType}, crs: ${sourceCrs ?? 'WGS84'}`
			);

			const db = await getDB();
			conn = await db.connect();
			await ensureGeoConversionDisabled(conn);

			try {
				if (connId) {
					await this.configureStorage(conn, connId);
				}

				// Build geometry expression (same logic as queryForMap)
				const quoted = `"${geomCol}"`;
				const upper = geomColType.toUpperCase();
				const isSpatialType =
					upper === 'GEOMETRY' ||
					upper === 'GEOGRAPHY' ||
					upper === 'WKB_BLOB' ||
					upper.includes('POINT') ||
					upper.includes('LINESTRING') ||
					upper.includes('POLYGON') ||
					upper.includes('BINARY');
				const isWkbBlob = upper === 'BLOB' || upper === 'BYTEA';

				let wkbExpr: string;
				let geomExpr: string;

				if (isWkbBlob && !sourceCrs) {
					wkbExpr = quoted;
					geomExpr = `ST_GeomFromWKB(${quoted})`;
				} else {
					geomExpr = isSpatialType
						? quoted
						: isWkbBlob
							? `ST_GeomFromWKB(${quoted})`
							: `ST_GeomFromGeoJSON(${quoted})`;
					if (sourceCrs) {
						geomExpr = `ST_Transform(${geomExpr}, '${sourceCrs}', 'EPSG:4326', always_xy := true)`;
					}
					wkbExpr = `ST_AsWKB(${geomExpr})`;
				}

				const mapSql = `SELECT *, ${wkbExpr} AS __wkb,
					ST_GeometryType(${geomExpr}) AS __geom_type
					FROM (${sql}) __src`;

				const reader = await conn.send(mapSql);

				const wkbArrays: Uint8Array[] = [];
				let geometryType = 'POINT';
				let geometryTypeDetected = false;
				const skipCols = new Set([geomCol, '__wkb', '__geom_type']);
				const attributes = new Map<string, { values: any[]; type: string }>();
				let fieldsInitialized = false;
				const fieldNames: string[] = [];
				const fieldTypes: Map<string, string> = new Map();

				const batches = reader[Symbol.asyncIterator]();
				while (true) {
					if (cancelled) throw new QueryCancelledError();
					const { value: batch, done } = await batches.next();
					if (done) break;

					if (!fieldsInitialized && batch.schema) {
						for (const field of batch.schema.fields) {
							const typeStr = String(field.type);
							if (skipCols.has(field.name)) continue;
							// Skip binary/blob columns — not useful for map tooltips
							if (isBinaryType(typeStr)) continue;
							fieldNames.push(field.name);
							fieldTypes.set(field.name, typeStr);
							attributes.set(field.name, { values: [], type: typeStr });
						}
						fieldsInitialized = true;
					}

					// Extract WKB and geometry type from batch
					const wkbCol = batch.getChild('__wkb');
					const typeCol = batch.getChild('__geom_type');
					for (let i = 0; i < batch.numRows; i++) {
						const v = wkbCol?.get(i);
						if (v) wkbArrays.push(v instanceof Uint8Array ? v : new Uint8Array(v));

						if (!geometryTypeDetected && typeCol) {
							const t = typeCol.get(i);
							if (t) {
								geometryType = String(t);
								geometryTypeDetected = true;
							}
						}
					}

					// Extract attribute columns — type-aware bulk extraction
					for (const name of fieldNames) {
						const col = batch.getChild(name);
						if (!col) continue;
						const attr = attributes.get(name)!;
						appendColumnBulk(attr.values, col, batch.numRows, fieldTypes.get(name)!);
					}
				}

				log(
					`queryForMapCancellable → done in ${elapsed(t0)}, ${wkbArrays.length} geometries (${geometryType})`
				);
				return { wkbArrays, geometryType, attributes, rowCount: wkbArrays.length };
			} catch (err) {
				if (cancelled || err instanceof QueryCancelledError) {
					log(`queryForMapCancellable → cancelled after ${elapsed(t0)}`);
					throw new QueryCancelledError();
				}
				logWarn(
					`queryForMapCancellable → failed after ${elapsed(t0)}:`,
					(err as Error)?.message ?? err
				);
				throw err;
			} finally {
				await conn?.close();
				conn = null;
			}
		})();

		const cancel = async (): Promise<boolean> => {
			cancelled = true;
			try {
				if (conn) await conn.cancelSent();
				return true;
			} catch {
				return false;
			}
		};

		return { result, cancel };
	}

	async forceCancel(): Promise<void> {
		log('forceCancel → terminating worker');
		try {
			if (dbPromise) {
				const db = await dbPromise;
				await db.terminate();
			}
		} catch (err) {
			logWarn('forceCancel → terminate error:', err);
		} finally {
			dbPromise = null;
			geoConversionDisabled = false;
			log('forceCancel → done, next getDB() will reinitialize');
		}
	}

	async releaseMemory(): Promise<void> {
		const db = await getDB();
		const conn = await db.connect();
		try {
			await conn.query('CALL pragma_database_size()');
			await conn.query('CHECKPOINT');
		} catch {
			// Ignore — checkpoint may fail on read-only/in-memory DBs
		} finally {
			await conn.close();
		}
	}

	async dispose(): Promise<void> {
		await this.releaseMemory();
	}
}
