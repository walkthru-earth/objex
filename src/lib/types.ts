export interface FileEntry {
	name: string;
	path: string;
	is_dir: boolean;
	size: number;
	modified: number; // unix timestamp ms
	extension: string;
}

export interface Connection {
	id: string;
	name: string;
	provider: string;
	endpoint: string;
	bucket: string;
	region: string;
	anonymous: boolean;
	authMethod?: 'sigv4' | 'sas-token';
	rootPrefix?: string;
}

// Used when creating/updating connections (includes optional credentials)
export interface ConnectionConfig {
	name: string;
	provider: string;
	endpoint: string;
	bucket: string;
	region: string;
	access_key?: string;
	secret_key?: string;
	sas_token?: string;
	anonymous: boolean;
	authMethod?: 'sigv4' | 'sas-token';
	rootPrefix?: string;
}

export interface Tab {
	id: string;
	name: string;
	path: string;
	source: 'remote' | 'url';
	connectionId?: string;
	extension: string;
	size?: number;
	/**
	 * When set, the tab reads data from a SQL FROM-clause target (e.g. an
	 * attached DuckLake/DuckDB/SQLite table) rather than a file URL. The ref
	 * is inserted directly into generated SQL, so it must be fully-qualified
	 * and pre-quoted, e.g. `__objex_db__."main"."air_quality"`.
	 *
	 * When `sourceRef` is set, file-specific loading paths (hyparquet
	 * metadata, `parquet_kv_metadata`, etc.) are skipped, and schema / CRS /
	 * row count are derived from the SQL source directly via DuckDB.
	 */
	sourceRef?: string;
}

export interface WriteResult {
	key: string;
	size: number;
	e_tag?: string;
}

export type Theme = 'light' | 'dark' | 'system';
