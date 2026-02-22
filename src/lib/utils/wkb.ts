/**
 * Lightweight WKB (Well-Known Binary) parser for extracting coordinates.
 * Supports Point, LineString, Polygon, and Multi* variants.
 * Handles standard WKB, ISO WKB (with Z/M), and EWKB (PostGIS SRID).
 */

export type GeoType =
	| 'Point'
	| 'LineString'
	| 'Polygon'
	| 'MultiPoint'
	| 'MultiLineString'
	| 'MultiPolygon'
	| 'Unknown';

export interface ParsedGeometry {
	type: GeoType;
	coordinates: number[] | number[][] | number[][][] | number[][][][];
}

// WKB type codes
const WKB_POINT = 1;
const WKB_LINESTRING = 2;
const WKB_POLYGON = 3;
const WKB_MULTIPOINT = 4;
const WKB_MULTILINESTRING = 5;
const WKB_MULTIPOLYGON = 6;

// EWKB flags
const EWKB_Z_FLAG = 0x80000000;
const EWKB_M_FLAG = 0x40000000;
const EWKB_SRID_FLAG = 0x20000000;

/**
 * Normalize binary data from various formats to Uint8Array.
 * Handles Uint8Array, ArrayBuffer, number arrays, hex strings,
 * and DuckDB toJSON() blob objects ({0: byte, 1: byte, ...}).
 */
export function toBinary(value: unknown): Uint8Array | null {
	if (value === null || value === undefined) return null;
	if (value instanceof Uint8Array) return value;
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'number') {
		return new Uint8Array(value);
	}
	if (typeof value === 'string' && /^[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0) {
		const bytes = new Uint8Array(value.length / 2);
		for (let i = 0; i < value.length; i += 2) {
			bytes[i / 2] = parseInt(value.substring(i, i + 2), 16);
		}
		return bytes;
	}
	// DuckDB toJSON() serializes BLOB/GEOMETRY as {"0": byte, "1": byte, ...}
	if (typeof value === 'object' && !Array.isArray(value)) {
		const obj = value as Record<string, number>;
		const keys = Object.keys(obj);
		if (keys.length > 4 && typeof obj['0'] === 'number') {
			const arr = new Uint8Array(keys.length);
			for (let i = 0; i < keys.length; i++) arr[i] = obj[i];
			return arr;
		}
	}
	return null;
}

/**
 * Parse a WKB binary blob into coordinates and geometry type.
 */
export function parseWKB(data: Uint8Array): ParsedGeometry | null {
	if (data.length < 5) return null;
	try {
		return readGeometry(new DataView(data.buffer, data.byteOffset, data.byteLength), 0).geometry;
	} catch {
		return null;
	}
}

function readGeometry(
	view: DataView,
	offset: number
): { geometry: ParsedGeometry; offset: number } {
	const le = view.getUint8(offset) === 1;
	offset += 1;

	let typeInt = view.getUint32(offset, le);
	offset += 4;

	// Detect coordinate dimensions from EWKB flags or ISO type ranges
	const hasZ =
		(typeInt & EWKB_Z_FLAG) !== 0 ||
		(typeInt % 10000 >= 1000 && typeInt % 10000 < 2000) ||
		(typeInt % 10000 >= 3000 && typeInt % 10000 < 4000);
	const hasM =
		(typeInt & EWKB_M_FLAG) !== 0 ||
		(typeInt % 10000 >= 2000 && typeInt % 10000 < 3000) ||
		(typeInt % 10000 >= 3000 && typeInt % 10000 < 4000);

	// Skip SRID if present (EWKB)
	if (typeInt & EWKB_SRID_FLAG) offset += 4;

	// Strip all flags to get base geometry type
	typeInt = (typeInt & 0x0000ffff) % 1000;

	const extraDims = (hasZ ? 1 : 0) + (hasM ? 1 : 0);
	const rd = (o: number) => view.getFloat64(o, le);
	const ru = (o: number) => view.getUint32(o, le);

	function readPoint(off: number): { coords: number[]; offset: number } {
		const x = rd(off);
		const y = rd(off + 8);
		return { coords: [x, y], offset: off + 16 + extraDims * 8 };
	}

	function readLineString(off: number): { coords: number[][]; offset: number } {
		const n = ru(off);
		off += 4;
		const coords: number[][] = [];
		for (let i = 0; i < n; i++) {
			const pt = readPoint(off);
			coords.push(pt.coords);
			off = pt.offset;
		}
		return { coords, offset: off };
	}

	function readPolygon(off: number): { coords: number[][][]; offset: number } {
		const n = ru(off);
		off += 4;
		const coords: number[][][] = [];
		for (let i = 0; i < n; i++) {
			const ring = readLineString(off);
			coords.push(ring.coords);
			off = ring.offset;
		}
		return { coords, offset: off };
	}

	switch (typeInt) {
		case WKB_POINT: {
			const pt = readPoint(offset);
			return { geometry: { type: 'Point', coordinates: pt.coords }, offset: pt.offset };
		}
		case WKB_LINESTRING: {
			const ls = readLineString(offset);
			return { geometry: { type: 'LineString', coordinates: ls.coords }, offset: ls.offset };
		}
		case WKB_POLYGON: {
			const pg = readPolygon(offset);
			return { geometry: { type: 'Polygon', coordinates: pg.coords }, offset: pg.offset };
		}
		case WKB_MULTIPOINT: {
			const n = ru(offset);
			offset += 4;
			const coords: number[][] = [];
			for (let i = 0; i < n; i++) {
				const r = readGeometry(view, offset);
				coords.push(r.geometry.coordinates as number[]);
				offset = r.offset;
			}
			return { geometry: { type: 'MultiPoint', coordinates: coords }, offset };
		}
		case WKB_MULTILINESTRING: {
			const n = ru(offset);
			offset += 4;
			const coords: number[][][] = [];
			for (let i = 0; i < n; i++) {
				const r = readGeometry(view, offset);
				coords.push(r.geometry.coordinates as number[][]);
				offset = r.offset;
			}
			return { geometry: { type: 'MultiLineString', coordinates: coords }, offset };
		}
		case WKB_MULTIPOLYGON: {
			const n = ru(offset);
			offset += 4;
			const coords: number[][][][] = [];
			for (let i = 0; i < n; i++) {
				const r = readGeometry(view, offset);
				coords.push(r.geometry.coordinates as number[][][]);
				offset = r.offset;
			}
			return { geometry: { type: 'MultiPolygon', coordinates: coords }, offset };
		}
		default:
			return { geometry: { type: 'Unknown', coordinates: [] }, offset };
	}
}

// ---------------------------------------------------------------------------
// Geometry column detection
// ---------------------------------------------------------------------------

/** Exact well-known geometry column names (lowercase for comparison). */
const GEO_NAMES = [
	'geometry',
	'geom',
	'wkb_geometry',
	'the_geom',
	'shape',
	'geo',
	'wkt_geometry',
	'the_geog',
	'geog',
	'way',
	'ora_geometry'
];

/** Type keywords that indicate a geometry column. */
const GEO_TYPE_KEYWORDS = [
	'geometry',
	'geography',
	'wkb',
	'point',
	'linestring',
	'polygon',
	'multipoint',
	'multilinestring',
	'multipolygon',
	'geometrycollection',
	'sdo_geometry'
];

/** Substrings in column names that hint at geometry content. */
const GEO_NAME_HINTS = ['geom', 'geometry', 'geo_', '_geo', 'wkb', 'wkt', 'shape', 'spatial'];

/** Valid GeoJSON geometry type names. */
const GEOJSON_TYPES = [
	'Point',
	'LineString',
	'Polygon',
	'MultiPoint',
	'MultiLineString',
	'MultiPolygon'
];

/** Check if a value is a GeoJSON geometry object ({type, coordinates}). */
function isGeoJSONGeometry(value: unknown): value is { type: GeoType; coordinates: unknown } {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const obj = value as Record<string, unknown>;
	return (
		typeof obj.type === 'string' && GEOJSON_TYPES.includes(obj.type) && obj.coordinates != null
	);
}

/**
 * Find the geometry column name from a schema.
 *
 * Detection priority:
 * 1. Column type contains a geometry keyword (GEOMETRY, POINT, WKB, etc.)
 * 2. Exact well-known column name with BLOB/BINARY type
 * 3. Exact well-known column name regardless of type
 * 4. Column name contains a geo-related substring with BLOB/BINARY type
 * 5. Column name contains a geo-related substring regardless of type
 */
export function findGeoColumn(schema: { name: string; type: string }[]): string | null {
	// Priority 1: column type contains a geometry keyword
	for (const f of schema) {
		const t = f.type.toLowerCase();
		if (GEO_TYPE_KEYWORDS.some((kw) => t.includes(kw))) return f.name;
	}

	// Priority 2: exact well-known name with binary type
	for (const f of schema) {
		const n = f.name.toLowerCase();
		const t = f.type.toLowerCase();
		const isBinary = t.includes('blob') || t.includes('binary') || t.includes('bytea');
		if (GEO_NAMES.includes(n) && isBinary) return f.name;
	}

	// Priority 3: exact well-known name, any type
	for (const f of schema) {
		if (GEO_NAMES.includes(f.name.toLowerCase())) return f.name;
	}

	// Priority 4: name contains geo hint with binary type
	for (const f of schema) {
		const n = f.name.toLowerCase();
		const t = f.type.toLowerCase();
		const isBinary = t.includes('blob') || t.includes('binary') || t.includes('bytea');
		if (isBinary && GEO_NAME_HINTS.some((hint) => n.includes(hint))) return f.name;
	}

	// Priority 5: name contains geo hint, any type
	for (const f of schema) {
		const n = f.name.toLowerCase();
		if (GEO_NAME_HINTS.some((hint) => n.includes(hint))) return f.name;
	}

	return null;
}

/**
 * Check if a value looks like valid WKB by inspecting its first bytes.
 * WKB starts with a byte-order marker (0x00 big-endian, 0x01 little-endian)
 * followed by a uint32 geometry type code.
 */
function looksLikeWKB(value: unknown): boolean {
	const bytes = toBinary(value);
	if (!bytes || bytes.length < 5) return false;

	const bom = bytes[0];
	if (bom !== 0x00 && bom !== 0x01) return false;

	const le = bom === 0x01;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let typeInt = view.getUint32(1, le);

	// Strip EWKB flags
	typeInt = (typeInt & 0x0000ffff) % 1000;

	// Valid base geometry types are 1–7
	return typeInt >= 1 && typeInt <= 7;
}

/**
 * Fallback: probe actual row data to find a column containing WKB geometry.
 * Use this when schema-only detection via `findGeoColumn()` returns null.
 * Samples the first row and checks each BLOB/binary column for WKB magic bytes.
 */
export function findGeoColumnFromRows(
	rows: Record<string, unknown>[],
	schema: { name: string; type: string }[]
): string | null {
	if (rows.length === 0) return null;

	const sample = rows[0];

	// First pass: check binary-typed columns
	for (const f of schema) {
		const t = f.type.toLowerCase();
		const isBinary = t.includes('blob') || t.includes('binary') || t.includes('bytea');
		if (isBinary && looksLikeWKB(sample[f.name])) return f.name;
	}

	// Second pass: check any column that holds binary-like data or WKT strings
	for (const [key, value] of Object.entries(sample)) {
		if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
			if (looksLikeWKB(value)) return key;
		}
		if (typeof value === 'string') {
			// Hex-encoded WKB
			if (/^[0-9a-fA-F]+$/.test(value) && value.length >= 10 && looksLikeWKB(value)) {
				return key;
			}
			// WKT string (from DuckDB spatial GEOMETRY type)
			if (isWKT(value)) return key;
		}
		// GeoJSON geometry object (from DuckDB read_json_auto struct serialization)
		if (isGeoJSONGeometry(value)) return key;
		// GeoJSON JSON string (from DuckDB to_json()::VARCHAR)
		if (typeof value === 'string' && value.startsWith('{')) {
			try {
				if (isGeoJSONGeometry(JSON.parse(value))) return key;
			} catch {
				// not JSON
			}
		}
	}

	return null;
}

// ---------------------------------------------------------------------------
// WKT detection (used by findGeoColumnFromRows for column sniffing)
// ---------------------------------------------------------------------------

const WKT_TYPES = [
	'POINT',
	'LINESTRING',
	'POLYGON',
	'MULTIPOINT',
	'MULTILINESTRING',
	'MULTIPOLYGON'
];

/** Check if a string looks like WKT. */
function isWKT(value: unknown): value is string {
	if (typeof value !== 'string') return false;
	const s = value.trimStart().toUpperCase();
	return WKT_TYPES.some((t) => s.startsWith(t) || s.startsWith(`MULTI${t}`));
}
