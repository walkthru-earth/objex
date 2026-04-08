/**
 * Helpers for parsing DuckDB v1.5 parameterized GEOMETRY type strings.
 *
 * DuckDB v1.5 made GEOMETRY a core type with an optional CRS parameter:
 *   GEOMETRY                  — no CRS attached
 *   GEOMETRY('EPSG:4326')     — EPSG form
 *   GEOMETRY('OGC:CRS84')     — OGC form (canonical for GeoParquet 1.1+)
 *   GEOMETRY('EPSG:27700')    — projected CRS
 *
 * Type strings may come from `DESCRIBE`, from the Arrow schema, or from a
 * legacy code path that still reports `BLOB`. Use these helpers everywhere
 * instead of ad-hoc regex so behaviour stays consistent.
 */

import { WGS84_CODES } from '../constants.js';

export interface GeometryTypeInfo {
	/** True if the type is some form of GEOMETRY (with or without CRS). */
	isGeometry: boolean;
	/** True if the type carries a CRS parameter, e.g. GEOMETRY('EPSG:4326'). */
	hasCrs: boolean;
	/** The CRS string if present, otherwise null. Raw value, including WGS84. */
	rawCrs: string | null;
	/**
	 * The CRS string if present and NOT a WGS84 variant (EPSG:4326, EPSG:4979,
	 * OGC:CRS84). Returns null for WGS84 so callers can skip ST_Transform.
	 */
	nonWgs84Crs: string | null;
}

const GEOMETRY_PREFIX = /^GEOMETRY(\s*\(\s*'?([^')]+)'?\s*\))?/i;

/**
 * Parse a DuckDB type string and report whether it is a GEOMETRY type, and
 * whether a CRS parameter is attached.
 */
export function parseGeometryTypeCrs(typeStr: string | null | undefined): GeometryTypeInfo {
	if (!typeStr) return { isGeometry: false, hasCrs: false, rawCrs: null, nonWgs84Crs: null };
	const match = typeStr.match(GEOMETRY_PREFIX);
	if (!match) return { isGeometry: false, hasCrs: false, rawCrs: null, nonWgs84Crs: null };
	const rawCrs = match[2]?.trim() ?? null;
	if (!rawCrs) return { isGeometry: true, hasCrs: false, rawCrs: null, nonWgs84Crs: null };
	return {
		isGeometry: true,
		hasCrs: true,
		rawCrs,
		nonWgs84Crs: isWgs84Crs(rawCrs) ? null : rawCrs
	};
}

/** True for EPSG:4326, EPSG:4979, OGC:CRS84 and equivalent strings. */
export function isWgs84Crs(crs: string | null | undefined): boolean {
	if (!crs) return true;
	const trimmed = crs.trim();
	if (trimmed === 'OGC:CRS84' || trimmed === 'OGC:CRS83') return true;
	const epsgMatch = trimmed.match(/^EPSG:(\d+)$/i);
	if (epsgMatch && WGS84_CODES.has(Number(epsgMatch[1]))) return true;
	return false;
}

/**
 * Build a `ST_Transform(...)` SQL expression choosing the 2-arg form when the
 * input already carries its CRS in the GEOMETRY type (DuckDB v1.5), and the
 * 3-arg form otherwise.
 *
 * `geometry_always_xy` is set globally at DB init, so no per-call `always_xy`
 * argument is needed.
 */
export function buildTransformExpr(
	innerExpr: string,
	sourceType: string,
	sourceCrs: string,
	targetCrs: string
): string {
	const info = parseGeometryTypeCrs(sourceType);
	if (info.hasCrs) {
		return `ST_Transform(${innerExpr}, '${targetCrs}')`;
	}
	return `ST_Transform(${innerExpr}, '${sourceCrs}', '${targetCrs}')`;
}

/**
 * Wrap a bare WKB expression with `ST_SetCRS(ST_GeomFromWKB(...))` so that the
 * resulting GEOMETRY value carries a CRS through the rest of the pipeline.
 * Used in the legacy GeoParquet fallback where we read the geometry column as
 * BLOB but still know the source CRS from hyparquet metadata or the GeoParquet
 * footer.
 *
 * If `sourceCrs` is null/empty, returns a plain `ST_GeomFromWKB(...)`.
 */
export function wrapWkbWithCrs(wkbExpr: string, sourceCrs: string | null | undefined): string {
	if (!sourceCrs) return `ST_GeomFromWKB(${wkbExpr})`;
	return `ST_SetCRS(ST_GeomFromWKB(${wkbExpr}), '${sourceCrs}')`;
}
