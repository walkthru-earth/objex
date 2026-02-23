import type { DuckDBBundles } from '@duckdb/duckdb-wasm';
import { tableToIPC } from 'apache-arrow';
import { buildDuckDbSource } from '$lib/file-icons/index.js';
import { credentialStore } from '$lib/stores/credentials.svelte.js';
import type { MapQueryResult, QueryEngine, QueryResult, SchemaField } from './engine';

// CDN URLs for DuckDB WASM bundles
const DUCKDB_VERSION = '1.33.1-dev19.0';
const CDN_BASE = `https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@${DUCKDB_VERSION}/dist`;

const duckdb_wasm = `${CDN_BASE}/duckdb-mvp.wasm`;
const mvp_worker = `${CDN_BASE}/duckdb-browser-mvp.worker.js`;
const duckdb_wasm_eh = `${CDN_BASE}/duckdb-eh.wasm`;
const eh_worker = `${CDN_BASE}/duckdb-browser-eh.worker.js`;

const INIT_TIMEOUT_MS = 30_000;

let dbPromise: Promise<any> | null = null;

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
	if (dbPromise) return dbPromise;

	dbPromise = (async () => {
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
		const logger = new duckdb.ConsoleLogger();
		const db = new duckdb.AsyncDuckDB(logger, worker);

		await withTimeout(
			db.instantiate(bundle.mainModule, bundle.pthreadWorker),
			INIT_TIMEOUT_MS,
			'DuckDB WASM instantiation'
		);

		// Load httpfs for remote file access and spatial for ST_ReadSHP
		const conn = await db.connect();
		try {
			await withTimeout(
				conn.query('INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial;'),
				INIT_TIMEOUT_MS,
				'extension install (httpfs + spatial)'
			);
		} finally {
			await conn.close();
		}

		return db;
	})();

	// If init fails, clear the promise so it can be retried
	dbPromise.catch(() => {
		dbPromise = null;
	});

	return dbPromise;
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

export class WasmQueryEngine implements QueryEngine {
	async query(connId: string, sql: string): Promise<QueryResult> {
		const db = await getDB();
		const conn = await db.connect();

		try {
			if (connId) {
				await this.configureStorage(conn, connId);
			}

			const result = await conn.query(sql);

			// DuckDB WASM returns an Arrow Table (bundled apache-arrow@17).
			// Our project uses apache-arrow@21 — cross-version tableToIPC/tableFromIPC
			// loses data rows. Extract rows directly from DuckDB's own Arrow Table.
			const numRows = result.numRows;
			const cols = result.schema.fields.map((f: any) => f.name);
			const types = result.schema.fields.map((f: any) => String(f.type));

			if (numRows === 0) {
				return {
					columns: cols,
					types,
					rowCount: 0,
					arrowBytes: new Uint8Array(0),
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

			// Best-effort IPC serialization for consumers that need raw Arrow bytes
			let arrowBytes: Uint8Array;
			try {
				arrowBytes = new Uint8Array(tableToIPC(result));
			} catch {
				arrowBytes = new Uint8Array(0);
			}

			return { columns: cols, types, rowCount: numRows, arrowBytes, rows };
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
		const db = await getDB();
		const conn = await db.connect();

		try {
			if (connId) {
				await this.configureStorage(conn, connId);
			}

			// Build geometry expression: only native spatial types (GEOMETRY, WKB_BLOB,
			// POINT, LINESTRING, etc.) can be passed directly to ST_AsWKB.
			// Everything else (VARCHAR, JSON, STRUCT, ...) needs ST_GeomFromGeoJSON.
			const quoted = `"${geomCol}"`;
			const upper = geomColType.toUpperCase();
			const isSpatialType =
				upper === 'GEOMETRY' ||
				upper === 'WKB_BLOB' ||
				upper.includes('POINT') ||
				upper.includes('LINESTRING') ||
				upper.includes('POLYGON');
			let geomExpr = isSpatialType ? quoted : `ST_GeomFromGeoJSON(${quoted})`;

			// Re-project to WGS84 if the source CRS is not EPSG:4326/CRS84
			if (sourceCrs) {
				geomExpr = `ST_Transform(${geomExpr}, '${sourceCrs}', 'EPSG:4326')`;
			}

			// Wrap query: ST_AsWKB for binary geometry, ST_GeometryType for type detection
			const mapSql = `SELECT *, ST_AsWKB(${geomExpr}) AS __wkb,
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

			// Extract attribute columns (skip geometry + helper columns)
			const skipCols = new Set([geomCol, '__wkb', '__geom_type']);
			const attributes = new Map<string, { values: any[]; type: string }>();
			for (const field of result.schema.fields) {
				if (skipCols.has(field.name)) continue;
				const col = result.getChild(field.name);
				const values: any[] = [];
				for (let i = 0; i < col.length; i++) {
					values.push(col.get(i));
				}
				attributes.set(field.name, {
					values,
					type: String(field.type)
				});
			}

			return { wkbArrays, geometryType, attributes, rowCount: wkbArrays.length };
		} finally {
			await conn.close();
		}
	}

	async getSchema(connId: string, path: string): Promise<SchemaField[]> {
		const db = await getDB();
		const conn = await db.connect();

		try {
			if (connId) {
				await this.configureStorage(conn, connId);
			}

			const source = buildDuckDbSource(path, path);
			const result = await conn.query(`DESCRIBE SELECT * FROM ${source}`);
			const rows = result.toArray();

			return rows.map((row: any) => ({
				name: row.column_name,
				type: row.column_type,
				nullable: row.null === 'YES'
			}));
		} finally {
			await conn.close();
		}
	}

	async getRowCount(connId: string, path: string): Promise<number> {
		const db = await getDB();
		const conn = await db.connect();

		try {
			if (connId) {
				await this.configureStorage(conn, connId);
			}

			const source = buildDuckDbSource(path, path);
			const result = await conn.query(`SELECT COUNT(*) as cnt FROM ${source}`);
			const rows = result.toArray();
			return Number(rows[0].cnt);
		} finally {
			await conn.close();
		}
	}

	private async configureStorage(conn: any, connId: string) {
		try {
			// Read connection metadata from localStorage
			const stored = localStorage.getItem('obstore-explore-connections');
			if (!stored) return;
			const connections = JSON.parse(stored);
			const connection = connections.find((c: any) => c.id === connId);
			if (!connection) return;

			// Azure uses direct HTTPS URLs with SAS token — no S3 config needed
			if (connection.provider === 'azure') return;

			// Set S3 credentials from in-memory credential store
			const creds = credentialStore.get(connId);
			if (creds && creds.type === 'sigv4') {
				await conn.query(`SET s3_access_key_id = '${creds.accessKey}';`);
				await conn.query(`SET s3_secret_access_key = '${creds.secretKey}';`);
			}

			if (connection.region) {
				await conn.query(`SET s3_region = '${connection.region}';`);
			}
			if (connection.endpoint) {
				const endpoint = connection.endpoint.replace(/^https?:\/\//, '');
				await conn.query(`SET s3_endpoint = '${endpoint}';`);
				if (connection.endpoint.startsWith('http://')) {
					await conn.query(`SET s3_use_ssl = false;`);
				}
			}
			// Always use path-style — virtual-hosted breaks for buckets with dots
			await conn.query(`SET s3_url_style = 'path';`);
		} catch (err) {
			console.error('[WasmQueryEngine] storage config error:', err);
		}
	}

	async detectCrs(connId: string, path: string, geomCol: string): Promise<string | null> {
		const db = await getDB();
		const conn = await db.connect();
		try {
			if (connId) {
				await this.configureStorage(conn, connId);
			}

			// Strategy 1: GeoParquet file-level metadata (geo key in KV metadata)
			try {
				const kvResult = await conn.query(
					`SELECT value FROM parquet_kv_metadata('${path}') WHERE CAST(key AS VARCHAR) = 'geo'`
				);
				const kvRows = kvResult.toArray();
				if (kvRows.length > 0) {
					const raw = kvRows[0].value;
					const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
					const geo = JSON.parse(text);
					const colMeta =
						geo.columns?.[geomCol] ??
						(geo.columns ? (Object.values(geo.columns) as any[])[0] : null);
					if (colMeta?.crs) {
						const epsg = extractEpsgFromProjjson(colMeta.crs);
						if (epsg) return epsg;
					}
				}
			} catch {
				/* not GeoParquet or no KV metadata */
			}

			// Strategy 2: Native Parquet GEOMETRY type (Parquet Format 2.11+)
			// CRS is in the schema logical_type: GeometryType(crs=...)
			try {
				const schemaResult = await conn.query(
					`SELECT logical_type FROM parquet_schema('${path}') WHERE name = '${geomCol}'`
				);
				const schemaRows = schemaResult.toArray();
				if (schemaRows.length > 0) {
					const logicalType = String(schemaRows[0].logical_type ?? '');
					const epsg = await extractCrsFromLogicalType(logicalType, conn, path);
					if (epsg) return epsg;
				}
			} catch {
				/* not a Parquet file or schema read failed */
			}

			return null;
		} catch {
			return null;
		} finally {
			await conn.close();
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
