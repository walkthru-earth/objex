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
		geomColType: string
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
			const geomExpr = isSpatialType ? quoted : `ST_GeomFromGeoJSON(${quoted})`;

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
