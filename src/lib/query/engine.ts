export class QueryCancelledError extends Error {
	constructor() {
		super('Query cancelled');
		this.name = 'QueryCancelledError';
	}
}

export interface QueryHandle {
	result: Promise<QueryResult>;
	cancel: () => Promise<boolean>;
}

export interface MapQueryHandle {
	result: Promise<MapQueryResult>;
	cancel: () => Promise<boolean>;
}

export interface QueryResult {
	columns: string[];
	types: string[];
	rowCount: number;
	/** Pre-parsed rows — avoids Arrow version mismatch in WASM engine */
	rows: Record<string, any>[];
}

/** Raw column data for map rendering (bypasses toJSON serialization). */
export interface MapQueryResult {
	/** Geometry column as raw WKB binary arrays */
	wkbArrays: Uint8Array[];
	/** Geometry type from ST_GeometryType (e.g., 'POLYGON') */
	geometryType: string;
	/** Non-geometry attribute columns: name → JS values */
	attributes: Map<string, { values: any[]; type: string }>;
	/** Number of rows */
	rowCount: number;
}

export interface SchemaField {
	name: string;
	type: string;
	nullable: boolean;
}

/**
 * Abstraction over a DuckDB query source. Decouples schema / CRS / count
 * helpers from assuming a file-backed path. `ref` is the FROM-clause target
 * inserted into generated SQL (e.g. `read_parquet('url')` for files, or
 * `attached_db."schema"."table"` for attached databases). `filePath` is
 * optional and only used as a shortcut for Parquet file-level metadata
 * queries (`parquet_kv_metadata`, `parquet_file_metadata`), not for SQL.
 */
export interface QuerySource {
	ref: string;
	filePath?: string;
}

export interface QueryEngine {
	query(connId: string, sql: string): Promise<QueryResult>;
	queryForMap(
		connId: string,
		sql: string,
		geomCol: string,
		geomColType: string,
		sourceCrs?: string | null
	): Promise<MapQueryResult>;
	getSchema(connId: string, source: QuerySource): Promise<SchemaField[]>;
	getRowCount(connId: string, source: QuerySource): Promise<number>;
	/** Detect CRS from GeoParquet metadata. Returns e.g. 'EPSG:27700' or null if WGS84/unknown. */
	detectCrs(connId: string, source: QuerySource, geomCol: string): Promise<string | null>;
	/** Combined schema + CRS detection in a single connection (fewer web worker round-trips). */
	getSchemaAndCrs?(
		connId: string,
		source: QuerySource,
		findGeoCol: (schema: SchemaField[]) => string | null
	): Promise<{ schema: SchemaField[]; geomCol: string | null; crs: string | null }>;
	queryCancellable?(connId: string, sql: string): QueryHandle;
	queryForMapCancellable?(
		connId: string,
		sql: string,
		geomCol: string,
		geomColType: string,
		sourceCrs?: string | null
	): MapQueryHandle;
	forceCancel?(): Promise<void>;
	/** Register a file buffer in DuckDB-WASM's virtual filesystem for ATTACH. */
	registerFileBuffer?(name: string, buffer: Uint8Array): Promise<void>;
	/** Drop a previously registered file from DuckDB-WASM's virtual filesystem. */
	dropFile?(name: string): Promise<void>;
	releaseMemory(): Promise<void>;
	dispose(): Promise<void>;
}
