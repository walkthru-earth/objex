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

export interface QueryEngine {
	query(connId: string, sql: string): Promise<QueryResult>;
	queryForMap(
		connId: string,
		sql: string,
		geomCol: string,
		geomColType: string,
		sourceCrs?: string | null
	): Promise<MapQueryResult>;
	getSchema(connId: string, path: string): Promise<SchemaField[]>;
	getRowCount(connId: string, path: string): Promise<number>;
	/** Detect CRS from GeoParquet metadata. Returns e.g. 'EPSG:27700' or null if WGS84/unknown. */
	detectCrs(connId: string, path: string, geomCol: string): Promise<string | null>;
	/** Combined schema + CRS detection in a single connection (fewer web worker round-trips). */
	getSchemaAndCrs?(
		connId: string,
		path: string,
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
	releaseMemory(): Promise<void>;
	dispose(): Promise<void>;
}
