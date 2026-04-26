/**
 * stac-geoparquet helpers.
 *
 * Pure TypeScript, zero Svelte / DuckDB / deck.gl dependencies. Re-exported
 * through `@walkthru-earth/objex-utils` so other projects can consume the
 * detection + row-to-Item transforms without pulling the Svelte lib.
 *
 * The module is decoupled from WKB decoding: callers pass a `wkbParser`
 * callback (the objex Svelte lib threads its `parseWKB`; other consumers
 * can plug in `geoarrow-wasm`, `wkx`, or any other library).
 */

import type { StacAsset, StacItem, StacLink } from './stac.js';

/** Minimal schema column shape. Works with hyparquet, DuckDB, Arrow. */
export interface StacGeoparquetSchemaColumn {
	name: string;
	type?: string;
}

/** Bbox in struct shape as produced by DuckDB's `bbox struct(xmin,ymin,xmax,ymax)`. */
export interface StacBboxStruct {
	xmin: number;
	ymin: number;
	xmax: number;
	ymax: number;
}

/** Generic Record shape representing a single stac-geoparquet row after DuckDB decoding. */
export type StacGeoparquetRow = Record<string, unknown>;

export interface StacRowToItemOptions {
	/**
	 * Decoder for the geometry column. Accepts a Uint8Array of WKB bytes and
	 * returns a GeoJSON geometry object (or null on failure).
	 *
	 * Consumers in the objex Svelte lib should pass `parseWKB` from
	 * `@walkthru-earth/objex-utils`. Other projects can use any WKB library.
	 */
	wkbParser?: (bytes: Uint8Array) => unknown;
	/**
	 * Column name holding the WKB bytes. Defaults to `'geom_wkb'` because the
	 * recommended SQL projection is `ST_AsWKB(geometry) AS geom_wkb`.
	 */
	wkbColumn?: string;
	/** Override the column holding the pre-decoded GeoJSON geometry, when available. */
	geometryColumn?: string;
}

/** Columns every stac-geoparquet file MUST carry per the stac-geoparquet spec. */
export const STAC_GEOPARQUET_REQUIRED_COLUMNS = [
	'stac_version',
	'type',
	'geometry',
	'assets'
] as const;

/**
 * Detect stac-geoparquet by presence of the required STAC columns.
 *
 * Deliberately type-agnostic: some pipelines know the type (DuckDB DESCRIBE,
 * Arrow Field), others only have the name list (hyparquet schema walk). The
 * set of names is sufficient for routing.
 */
export function isStacGeoparquetSchema(schema: StacGeoparquetSchemaColumn[]): boolean {
	if (!Array.isArray(schema) || schema.length === 0) return false;
	const names = new Set(schema.map((c) => c.name));
	return STAC_GEOPARQUET_REQUIRED_COLUMNS.every((c) => names.has(c));
}

/**
 * Flatten a DuckDB `struct(xmin,ymin,xmax,ymax)` bbox to the `[minX, minY, maxX, maxY]`
 * array shape that STAC Items and deck.gl-geotiff MosaicLayer expect.
 *
 * Pass-through for arrays so callers that already have `[minX,minY,maxX,maxY]`
 * shape (e.g. from a Feature's `bbox` field) don't need a separate path.
 */
export function flattenStacBbox(
	bbox: StacBboxStruct | number[] | null | undefined
): [number, number, number, number] | null {
	if (!bbox) return null;
	if (Array.isArray(bbox)) {
		if (bbox.length < 4) return null;
		const [minX, minY, maxX, maxY] = bbox;
		if (![minX, minY, maxX, maxY].every((v) => Number.isFinite(v))) return null;
		return [minX, minY, maxX, maxY];
	}
	if (typeof bbox === 'object') {
		const { xmin, ymin, xmax, ymax } = bbox as StacBboxStruct;
		if (![xmin, ymin, xmax, ymax].every((v) => Number.isFinite(v))) return null;
		return [xmin, ymin, xmax, ymax];
	}
	return null;
}

/**
 * Resolve a possibly-relative STAC asset href against the parquet file URL.
 *
 * `./foo.tif` or `foo.tif` → absolute against `baseUrl`. Absolute URLs
 * (`http(s)://`, `s3://`, `gs://`, etc.) are returned unchanged.
 */
export function resolveStacAssetHref(href: string, baseUrl: string): string {
	if (!href) return href;
	if (/^[a-z][a-z0-9+\-.]*:\/\//i.test(href)) return href;
	try {
		return new URL(href, baseUrl).toString();
	} catch {
		return href;
	}
}

/**
 * Pick the "primary" asset from a STAC Item's `assets` map.
 *
 * Priority: caller-specified `preferredKeys` → `data` key → first asset with
 * `roles` containing `'data'` → first asset. Returns `null` if the map is
 * empty or not an object.
 */
export function pickStacPrimaryAsset(
	assets: Record<string, StacAsset> | null | undefined,
	preferredKeys?: readonly string[]
): { key: string; asset: StacAsset } | null {
	if (!assets || typeof assets !== 'object') return null;
	const entries = Object.entries(assets).filter(
		([, a]) => a && typeof a === 'object' && typeof (a as StacAsset).href === 'string'
	) as [string, StacAsset][];
	if (entries.length === 0) return null;

	if (preferredKeys) {
		for (const key of preferredKeys) {
			const match = entries.find(([k]) => k === key);
			if (match) return { key: match[0], asset: match[1] };
		}
	}
	const data = entries.find(([k]) => k === 'data');
	if (data) return { key: data[0], asset: data[1] };

	const byRole = entries.find(([, a]) => Array.isArray(a.roles) && a.roles.includes('data'));
	if (byRole) return { key: byRole[0], asset: byRole[1] };

	return { key: entries[0][0], asset: entries[0][1] };
}

/**
 * Normalize the `assets` value read from a stac-geoparquet row.
 *
 * DuckDB returns `assets` as a `struct` with a fixed set of named fields (one
 * per asset key present at write-time), which decodes to a plain object.
 * Some rows may have `null` asset values for keys that don't apply to them;
 * those are filtered out.
 */
function normalizeAssetsField(
	value: unknown,
	baseUrl: string
): Record<string, StacAsset> | undefined {
	if (!value || typeof value !== 'object') return undefined;
	const out: Record<string, StacAsset> = {};
	for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
		if (!raw || typeof raw !== 'object') continue;
		const asset = raw as StacAsset & Record<string, unknown>;
		if (typeof asset.href !== 'string' || !asset.href) continue;
		out[key] = {
			...asset,
			href: resolveStacAssetHref(asset.href, baseUrl)
		};
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Coerce a stac-geoparquet `datetime` cell into an ISO 8601 string.
 *
 * The stac-geoparquet spec mandates a native Parquet TIMESTAMP (microseconds,
 * UTC-adjusted) rather than a string column, so DuckDB-WASM hands these back
 * as a `BigInt` of microseconds since epoch in the common path. JS `Date` and
 * primitive `number` (ms) are also accepted for tolerance. Anything else is
 * pushed through `String()` and only kept if `Date.parse` accepts it, so
 * malformed values do not propagate as unparseable ISO strings that quietly
 * collapse the datetime facet.
 */
function coerceDatetimeToIso(value: unknown): string | undefined {
	if (value == null) return undefined;
	if (value instanceof Date) {
		const ms = value.getTime();
		return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
	}
	if (typeof value === 'bigint') {
		// Parquet TIMESTAMP(MICROS) → microseconds since epoch.
		const ms = Number(value / 1000n);
		return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
	}
	if (typeof value === 'number' && Number.isFinite(value)) {
		// Heuristic: > 1e14 is microseconds, anything smaller is milliseconds.
		const ms = Math.abs(value) > 1e14 ? Math.floor(value / 1000) : value;
		return new Date(ms).toISOString();
	}
	if (typeof value === 'string') {
		const t = Date.parse(value);
		return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
	}
	return undefined;
}

/** Normalize the `links` field, resolving relative hrefs against `baseUrl`. */
function normalizeLinksField(value: unknown, baseUrl: string): StacLink[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const links: StacLink[] = [];
	for (const raw of value) {
		if (!raw || typeof raw !== 'object') continue;
		const link = raw as StacLink;
		if (typeof link.href !== 'string' || typeof link.rel !== 'string') continue;
		links.push({ ...link, href: resolveStacAssetHref(link.href, baseUrl) });
	}
	return links.length > 0 ? links : undefined;
}

/**
 * Convert one stac-geoparquet row into a standard STAC Item JSON object.
 *
 * Handles:
 *   - `assets` named-struct flattening + relative href resolution
 *   - `bbox` struct → `[minX, minY, maxX, maxY]` array
 *   - Optional WKB geometry → GeoJSON via `opts.wkbParser`
 *   - `datetime` → ISO string (passes through already-string values)
 *   - Promotes `properties.*` columns (`proj:*`, `datetime`) onto `item.properties`
 */
export function stacRowToItem(
	row: StacGeoparquetRow,
	baseUrl: string,
	opts: StacRowToItemOptions = {}
): StacItem {
	const { wkbParser, wkbColumn = 'geom_wkb', geometryColumn = 'geometry' } = opts;

	let geometry: unknown = row[geometryColumn];
	if (!geometry) {
		const wkb = row[wkbColumn];
		if (wkb && wkbParser) {
			const bytes = wkb instanceof Uint8Array ? wkb : toUint8Array(wkb);
			if (bytes) {
				try {
					geometry = wkbParser(bytes) ?? undefined;
				} catch {
					geometry = undefined;
				}
			}
		}
	}

	const bbox = flattenStacBbox(row.bbox as StacBboxStruct | number[] | undefined) ?? undefined;
	const assets = normalizeAssetsField(row.assets, baseUrl);
	const links = normalizeLinksField(row.links, baseUrl);

	const properties: Record<string, unknown> = {};
	// Hoist common STAC-property columns that live at row level in stac-geoparquet.
	const SCALAR_PROP_KEYS = new Set([
		'gsd',
		'platform',
		'constellation',
		'instruments',
		'mission',
		'license'
	]);
	const TIMESTAMP_PROP_KEYS = new Set([
		'datetime',
		'start_datetime',
		'end_datetime',
		'created',
		'updated'
	]);
	for (const [key, value] of Object.entries(row)) {
		if (value === null || value === undefined) continue;
		if (key.startsWith('proj:') || key.startsWith('raster:') || key.startsWith('eo:')) {
			properties[key] = value;
			continue;
		}
		if (TIMESTAMP_PROP_KEYS.has(key)) {
			const iso = coerceDatetimeToIso(value);
			if (iso) properties[key] = iso;
			continue;
		}
		if (SCALAR_PROP_KEYS.has(key)) {
			properties[key] = value;
			continue;
		}
		if (key === 'bands') {
			properties.bands = value;
		}
	}

	const item: StacItem = {
		type: 'Feature',
		stac_version: typeof row.stac_version === 'string' ? row.stac_version : '1.0.0',
		id: typeof row.id === 'string' ? row.id : String(row.id ?? ''),
		properties
	};
	if (typeof row.collection === 'string') item.collection = row.collection;
	if (Array.isArray(row.stac_extensions)) {
		(item as unknown as { stac_extensions: unknown[] }).stac_extensions = row.stac_extensions;
	}
	if (bbox) item.bbox = bbox;
	if (geometry) item.geometry = geometry;
	if (assets) item.assets = assets;
	if (links) item.links = links;

	return item;
}

/** Best-effort coercion of a value that may already be bytes into a Uint8Array. */
function toUint8Array(value: unknown): Uint8Array | null {
	if (value instanceof Uint8Array) return value;
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	if (ArrayBuffer.isView(value)) {
		const view = value as ArrayBufferView;
		return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
	}
	if (Array.isArray(value)) return new Uint8Array(value as number[]);
	return null;
}
