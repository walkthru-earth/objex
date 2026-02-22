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
	provider: 's3' | 'gcs' | 'r2' | 'minio' | 'azure' | 'storj';
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
}

export interface WriteResult {
	key: string;
	size: number;
	e_tag?: string;
}

export type Theme = 'light' | 'dark' | 'system';
