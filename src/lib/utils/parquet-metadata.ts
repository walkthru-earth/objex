/**
 * Lightweight Parquet metadata reader using hyparquet.
 *
 * Reads schema, row count, CRS, and geometry types from the Parquet footer
 * via a single HTTP range request (~512KB). No DuckDB boot needed.
 *
 * This provides instant metadata display before DuckDB-WASM finishes loading.
 */

import type { GeoArrowGeomType } from './geoarrow.js';

const WGS84_CODES = new Set([4326, 4979]);

export interface GeoColumnMeta {
	encoding: string;
	geometryTypes: string[];
	crs: any | null;
	bbox?: number[];
}

export interface GeoParquetMeta {
	primaryColumn: string;
	columns: Record<string, GeoColumnMeta>;
}

export interface ParquetFileMetadata {
	/** Total number of rows across all row groups. */
	rowCount: number;
	/** Column schema (name + type). */
	schema: { name: string; type: string }[];
	/** GeoParquet "geo" metadata if present. */
	geo: GeoParquetMeta | null;
	/** Tool that created the file (e.g. "pyarrow 15.0.0"). */
	createdBy: string | null;
	/** Number of row groups. */
	numRowGroups: number;
	/** Primary compression codec (e.g. "SNAPPY", "ZSTD"). */
	compression: string | null;
}

/** Map hyparquet schema element types to DuckDB-like type strings. */
function mapParquetType(col: any): string {
	const lt = col.logical_type;
	if (lt) {
		// String types
		if (lt.type === 'STRING' || lt.type === 'UTF8') return 'VARCHAR';
		if (lt.type === 'JSON') return 'JSON';
		if (lt.type === 'UUID') return 'UUID';
		if (lt.type === 'ENUM') return 'VARCHAR';
		// Integer types
		if (lt.type === 'INT' || lt.type === 'INTEGER') {
			const bits = lt.bitWidth ?? 32;
			const signed = lt.isSigned !== false;
			if (bits <= 8) return signed ? 'TINYINT' : 'UTINYINT';
			if (bits <= 16) return signed ? 'SMALLINT' : 'USMALLINT';
			if (bits <= 32) return signed ? 'INTEGER' : 'UINTEGER';
			return signed ? 'BIGINT' : 'UBIGINT';
		}
		// Decimal
		if (lt.type === 'DECIMAL') return `DECIMAL(${lt.precision ?? 18},${lt.scale ?? 0})`;
		// Date/Time
		if (lt.type === 'DATE') return 'DATE';
		if (lt.type === 'TIME') return 'TIME';
		if (lt.type === 'TIMESTAMP') return 'TIMESTAMP';
		// Binary
		if (lt.type === 'BSON') return 'BLOB';
	}

	// Fallback to physical type
	const ct = col.converted_type;
	if (ct === 'UTF8') return 'VARCHAR';
	if (ct === 'JSON') return 'JSON';
	if (ct === 'DATE') return 'DATE';
	if (ct === 'TIMESTAMP_MILLIS' || ct === 'TIMESTAMP_MICROS') return 'TIMESTAMP';
	if (ct === 'DECIMAL') return `DECIMAL(${col.precision ?? 18},${col.scale ?? 0})`;
	if (ct === 'INT_8') return 'TINYINT';
	if (ct === 'INT_16') return 'SMALLINT';
	if (ct === 'INT_32') return 'INTEGER';
	if (ct === 'INT_64') return 'BIGINT';
	if (ct === 'UINT_8') return 'UTINYINT';
	if (ct === 'UINT_16') return 'USMALLINT';
	if (ct === 'UINT_32') return 'UINTEGER';
	if (ct === 'UINT_64') return 'UBIGINT';

	const pt = col.type;
	if (pt === 'BOOLEAN') return 'BOOLEAN';
	if (pt === 'INT32') return 'INTEGER';
	if (pt === 'INT64') return 'BIGINT';
	if (pt === 'INT96') return 'TIMESTAMP';
	if (pt === 'FLOAT') return 'FLOAT';
	if (pt === 'DOUBLE') return 'DOUBLE';
	if (pt === 'BYTE_ARRAY') return 'BLOB';
	if (pt === 'FIXED_LEN_BYTE_ARRAY') return 'BLOB';

	return 'VARCHAR';
}

/**
 * Read Parquet footer metadata from a remote URL using hyparquet.
 * Uses HTTP range requests — typically a single ~512KB fetch.
 */
export async function readParquetMetadata(url: string): Promise<ParquetFileMetadata> {
	const { parquetMetadataAsync } = await import('hyparquet');
	const { asyncBufferFromUrl } = await import('hyparquet');

	const file = await asyncBufferFromUrl({ url });
	const metadata = await parquetMetadataAsync(file);

	// Row count from row group metadata (no data scan needed)
	const rowCount = metadata.row_groups.reduce(
		(sum: number, rg: any) => sum + Number(rg.num_rows),
		0
	);

	// Schema from metadata (skip root element at index 0)
	const schema = metadata.schema
		.slice(1)
		.filter((col: any) => col.num_children === undefined) // skip group elements
		.map((col: any) => ({
			name: col.name,
			type: mapParquetType(col)
		}));

	// GeoParquet "geo" key-value metadata
	let geo: GeoParquetMeta | null = null;
	const geoKv = metadata.key_value_metadata?.find((kv: any) => kv.key === 'geo');
	if (geoKv) {
		try {
			const geoJson = JSON.parse(geoKv.value ?? '');
			geo = {
				primaryColumn: geoJson.primary_column ?? 'geometry',
				columns: {}
			};
			if (geoJson.columns) {
				for (const [colName, colMeta] of Object.entries(geoJson.columns) as [string, any][]) {
					geo.columns[colName] = {
						encoding: colMeta.encoding ?? 'WKB',
						geometryTypes: colMeta.geometry_types ?? [],
						crs: colMeta.crs ?? null,
						bbox: colMeta.bbox
					};
				}
			}
		} catch {
			// malformed geo metadata — ignore
		}
	}

	// Created-by tool
	const createdBy = metadata.created_by ?? null;

	// Row group count
	const numRowGroups = metadata.row_groups.length;

	// Compression: collect unique codecs from first row group's columns
	let compression: string | null = null;
	if (numRowGroups > 0 && metadata.row_groups[0].columns) {
		const codecs = new Set<string>();
		for (const col of metadata.row_groups[0].columns) {
			const codec = col.meta_data?.codec;
			if (codec) codecs.add(codec);
		}
		if (codecs.size === 1) {
			compression = [...codecs][0];
		} else if (codecs.size > 1) {
			compression = [...codecs].join(', ');
		}
	}

	return { rowCount, schema, geo, createdBy, numRowGroups, compression };
}

/**
 * Extract EPSG code from GeoParquet CRS metadata.
 * Returns null for WGS84/CRS84 (no reprojection needed).
 */
export function extractEpsgFromGeoMeta(geo: GeoParquetMeta): string | null {
	const primaryCol = geo.columns[geo.primaryColumn];
	if (!primaryCol?.crs) return null;

	const crs = primaryCol.crs;

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
 * Extract normalized geometry types from GeoParquet metadata.
 * Returns the set of geometry types for the primary column.
 */
export function extractGeometryTypes(geo: GeoParquetMeta): GeoArrowGeomType[] {
	const primaryCol = geo.columns[geo.primaryColumn];
	if (!primaryCol?.geometryTypes?.length) return [];

	const typeMap: Record<string, GeoArrowGeomType> = {
		Point: 'point',
		LineString: 'linestring',
		Polygon: 'polygon',
		MultiPoint: 'multipoint',
		MultiLineString: 'multilinestring',
		MultiPolygon: 'multipolygon'
	};

	const types: GeoArrowGeomType[] = [];
	for (const raw of primaryCol.geometryTypes) {
		// GeoParquet geometry_types may include Z/M suffixes like "Polygon Z"
		const base = raw.split(' ')[0];
		const mapped = typeMap[base];
		if (mapped && !types.includes(mapped)) types.push(mapped);
	}
	return types;
}

/**
 * Extract bounds from GeoParquet metadata (bbox field).
 * Returns [minX, minY, maxX, maxY] or null.
 */
export function extractBounds(geo: GeoParquetMeta): [number, number, number, number] | null {
	const primaryCol = geo.columns[geo.primaryColumn];
	if (!primaryCol?.bbox || primaryCol.bbox.length < 4) return null;
	return [primaryCol.bbox[0], primaryCol.bbox[1], primaryCol.bbox[2], primaryCol.bbox[3]];
}
