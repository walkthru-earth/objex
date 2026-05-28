/**
 * CRS helpers - pure TS. Shared "is this WGS84 lon/lat" check for viewers that
 * decide whether a column needs ST_Transform. Reuses WGS84_CODES /
 * DEFAULT_TARGET_CRS from host constants so the numeric set is never re-typed.
 *
 * NOTE: distinct from `isWgs84Crs` in geometry-type.ts, which uses the inverse
 * "absent CRS means assume WGS84" convention (returns true for null). Use this
 * one when an unknown CRS must NOT be assumed WGS84.
 */
import { DEFAULT_TARGET_CRS, WGS84_CODES } from '../../../src/lib/constants.js';

/** WGS84 string forms that require no reprojection (matches DEFAULT_TARGET_CRS + EPSG:4326/4979). */
const WGS84_STRINGS = new Set(['epsg:4326', 'epsg:4979', DEFAULT_TARGET_CRS.toLowerCase()]);

/**
 * True when the given CRS is WGS84 lon/lat (no ST_Transform needed).
 * Accepts a numeric EPSG code or a string like "EPSG:4326" / "OGC:CRS84".
 */
export function isWgs84(crs: number | string | null | undefined): boolean {
	if (crs === null || crs === undefined) return false;
	if (typeof crs === 'number') return Number.isFinite(crs) && WGS84_CODES.has(crs);
	const s = crs.trim().toLowerCase();
	if (s.length === 0) return false;
	if (WGS84_STRINGS.has(s)) return true;
	const m = s.match(/(?:epsg:)?(\d+)/);
	return m ? WGS84_CODES.has(Number(m[1])) : false;
}
