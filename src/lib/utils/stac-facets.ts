/**
 * STAC item facets, filtering, and sorting. Pure TS, framework-agnostic.
 *
 * Inputs are STAC Items (or any subset compatible with `StacItem`). Outputs
 * are slim views, auto-detected facet descriptors, and filtered/sorted view
 * arrays. No DOM, no Svelte, no fetch, no maplibre, safe to publish via
 * `@walkthru-earth/objex-utils`.
 *
 * The flow is intentionally one-directional:
 *   StacItem[]  --extractItemView-->  StacItemView[]
 *   StacItemView[]  --buildFacets-->  FacetSet
 *   StacItemView[] + FacetState  --applyFacets-->  StacItemView[]
 *   StacItemView[] + FacetSort  --sortViews-->  StacItemView[]
 *
 * Callers (any framework) can hold the views array, derive a FacetSet on
 * change, and reactively filter / sort it without re-touching the original
 * StacItems.
 */

import type { StacItem } from './stac.js';

// ─── Slim projection ────────────────────────────────────────────────

/**
 * Compact, render-ready projection of a STAC Item. Keeps only the fields
 * needed for facet UI, sorting, footprint rendering, and the inspector
 * panel. The full original item is retained on `raw` for callers that need
 * to inspect arbitrary properties without a re-extract pass.
 */
export interface StacItemView {
	id: string;
	collection: string | null;
	bbox: [number, number, number, number] | null;
	/** ISO 8601 datetime, or `start_datetime` when only an interval is given. */
	datetime: string | null;
	/** End of `start_datetime` / `end_datetime` interval, when present. */
	endDatetime: string | null;
	/** `eo:cloud_cover` percent (0-100), null when absent. */
	cloudCover: number | null;
	/** Ground sample distance in meters, null when absent. */
	gsd: number | null;
	platform: string | null;
	constellation: string | null;
	instruments: string[];
	/** EPSG code from `proj:epsg`, null when absent or non-numeric. */
	epsg: number | null;
	/** Best-effort thumbnail / overview href, null when no preview asset. */
	thumbnailHref: string | null;
	/** Asset role set across all assets on the item. */
	assetRoles: string[];
	/** Original item, retained so the inspector can show the raw JSON. */
	raw: StacItem;
}

/** Asset roles inspected when picking a thumbnail href, in priority order. */
const THUMBNAIL_ROLES = ['thumbnail', 'overview', 'visual'];
/** Asset keys inspected when no role-tagged asset is present. */
const THUMBNAIL_KEYS = ['thumbnail', 'preview', 'overview', 'rendered_preview', 'visual'];

function extractThumbnailHref(item: StacItem): string | null {
	const assets = item.assets ?? {};
	for (const role of THUMBNAIL_ROLES) {
		for (const asset of Object.values(assets)) {
			if (Array.isArray(asset?.roles) && asset.roles.includes(role) && asset.href) {
				return asset.href;
			}
		}
	}
	for (const key of THUMBNAIL_KEYS) {
		if (assets[key]?.href) return assets[key].href;
	}
	return null;
}

function collectAssetRoles(item: StacItem): string[] {
	const out = new Set<string>();
	for (const asset of Object.values(item.assets ?? {})) {
		if (Array.isArray(asset?.roles)) {
			for (const role of asset.roles) {
				if (typeof role === 'string') out.add(role);
			}
		}
	}
	return [...out].sort();
}

function readNumber(props: Record<string, unknown>, key: string): number | null {
	const v = props[key];
	if (typeof v === 'number' && Number.isFinite(v)) return v;
	if (typeof v === 'string') {
		const n = Number(v);
		return Number.isFinite(n) ? n : null;
	}
	return null;
}

function readString(props: Record<string, unknown>, key: string): string | null {
	const v = props[key];
	return typeof v === 'string' && v.length > 0 ? v : null;
}

function readStringArray(props: Record<string, unknown>, key: string): string[] {
	const v = props[key];
	if (!Array.isArray(v)) return [];
	return v.filter((x): x is string => typeof x === 'string');
}

/** Project a STAC Item into a `StacItemView`. Always succeeds. */
export function extractItemView(item: StacItem): StacItemView {
	const props = (item.properties ?? {}) as Record<string, unknown>;
	const bbox =
		Array.isArray(item.bbox) && item.bbox.length >= 4
			? ([
					Number(item.bbox[0]),
					Number(item.bbox[1]),
					Number(item.bbox[2]),
					Number(item.bbox[3])
				] as [number, number, number, number])
			: null;
	return {
		id: String(item.id ?? ''),
		collection: typeof item.collection === 'string' ? item.collection : null,
		bbox,
		datetime: readString(props, 'datetime') ?? readString(props, 'start_datetime'),
		endDatetime: readString(props, 'end_datetime'),
		cloudCover: readNumber(props, 'eo:cloud_cover'),
		gsd: readNumber(props, 'gsd'),
		platform: readString(props, 'platform'),
		constellation: readString(props, 'constellation'),
		instruments: readStringArray(props, 'instruments'),
		epsg: readNumber(props, 'proj:epsg'),
		thumbnailHref: extractThumbnailHref(item),
		assetRoles: collectAssetRoles(item),
		raw: item
	};
}

// ─── Facet detection ────────────────────────────────────────────────

/**
 * Numeric facet, e.g. cloud cover. `min`/`max` are derived from the loaded
 * views so the UI can use them as slider bounds. `count` is how many of the
 * input views had this field at all.
 */
export interface NumericFacet {
	kind: 'numeric';
	field: NumericFacetField;
	min: number;
	max: number;
	count: number;
}

/**
 * Enum facet, e.g. platform. `values` is sorted by descending count so the
 * most common values surface first in chip lists.
 */
export interface EnumFacet {
	kind: 'enum';
	field: EnumFacetField;
	values: { value: string; count: number }[];
}

/**
 * Datetime facet, with min/max for slider bounds and a fixed-width histogram
 * the UI can render under a range slider. `bins.length` is always
 * `DATETIME_HISTOGRAM_BINS` so consumers can layout without checking.
 */
export interface DatetimeFacet {
	kind: 'datetime';
	field: 'datetime';
	/** Earliest datetime, ISO 8601. */
	min: string;
	/** Latest datetime, ISO 8601. */
	max: string;
	count: number;
	bins: number[];
}

export type Facet = NumericFacet | EnumFacet | DatetimeFacet;
export type NumericFacetField = 'cloudCover' | 'gsd';
export type EnumFacetField =
	| 'collection'
	| 'platform'
	| 'constellation'
	| 'instruments'
	| 'assetRoles';

export const DATETIME_HISTOGRAM_BINS = 32;

/** Result of `buildFacets`: every facet that has variance in the input set. */
export interface FacetSet {
	datetime: DatetimeFacet | null;
	numeric: NumericFacet[];
	enums: EnumFacet[];
	/** Total number of views the facet set was built from. */
	total: number;
}

const NUMERIC_FIELDS: NumericFacetField[] = ['cloudCover', 'gsd'];
const ENUM_FIELDS: EnumFacetField[] = [
	'collection',
	'platform',
	'constellation',
	'instruments',
	'assetRoles'
];

function buildNumericFacet(views: StacItemView[], field: NumericFacetField): NumericFacet | null {
	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;
	let count = 0;
	for (const v of views) {
		const value = v[field];
		if (value == null || !Number.isFinite(value)) continue;
		if (value < min) min = value;
		if (value > max) max = value;
		count++;
	}
	if (count === 0 || min === max) return null;
	return { kind: 'numeric', field, min, max, count };
}

function buildEnumFacet(views: StacItemView[], field: EnumFacetField): EnumFacet | null {
	const counts = new Map<string, number>();
	for (const v of views) {
		const raw = v[field];
		if (raw == null) continue;
		if (Array.isArray(raw)) {
			for (const item of raw) counts.set(item, (counts.get(item) ?? 0) + 1);
		} else if (typeof raw === 'string' && raw.length > 0) {
			counts.set(raw, (counts.get(raw) ?? 0) + 1);
		}
	}
	if (counts.size < 2) return null;
	const values = [...counts.entries()]
		.map(([value, count]) => ({ value, count }))
		.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
	return { kind: 'enum', field, values };
}

function buildDatetimeFacet(views: StacItemView[]): DatetimeFacet | null {
	const timestamps: number[] = [];
	for (const v of views) {
		if (!v.datetime) continue;
		const t = Date.parse(v.datetime);
		if (Number.isFinite(t)) timestamps.push(t);
	}
	if (timestamps.length < 2) return null;
	let min = timestamps[0];
	let max = timestamps[0];
	for (const t of timestamps) {
		if (t < min) min = t;
		if (t > max) max = t;
	}
	if (min === max) return null;
	const bins = new Array<number>(DATETIME_HISTOGRAM_BINS).fill(0);
	const span = max - min;
	for (const t of timestamps) {
		// Clamp to [0, BINS-1]: t === max should land in the last bin, not bin BINS.
		const idx = Math.min(
			DATETIME_HISTOGRAM_BINS - 1,
			Math.floor(((t - min) / span) * DATETIME_HISTOGRAM_BINS)
		);
		bins[idx]++;
	}
	return {
		kind: 'datetime',
		field: 'datetime',
		min: new Date(min).toISOString(),
		max: new Date(max).toISOString(),
		count: timestamps.length,
		bins
	};
}

/**
 * Scan a list of views and emit only those facets that have meaningful
 * variance. A facet is omitted when:
 *   - numeric: fewer than two distinct finite values
 *   - enum: fewer than two distinct values
 *   - datetime: fewer than two parseable timestamps with distinct values
 *
 * The intent is "render only the controls that will narrow this dataset",
 * so callers can map each returned facet to a UI component without further
 * checks.
 */
export function buildFacets(views: StacItemView[]): FacetSet {
	const numeric: NumericFacet[] = [];
	for (const field of NUMERIC_FIELDS) {
		const f = buildNumericFacet(views, field);
		if (f) numeric.push(f);
	}
	const enums: EnumFacet[] = [];
	for (const field of ENUM_FIELDS) {
		const f = buildEnumFacet(views, field);
		if (f) enums.push(f);
	}
	return {
		datetime: buildDatetimeFacet(views),
		numeric,
		enums,
		total: views.length
	};
}

// ─── Filtering ──────────────────────────────────────────────────────

/**
 * Mutable filter state, intended to be held by the UI layer. Each entry is
 * optional, omitting an entry means "no filter on this field". Numeric
 * ranges are inclusive on both ends. Enum sets are union-match (any value
 * in the set passes).
 */
export interface FacetState {
	datetime?: { min?: string; max?: string };
	numeric?: Partial<Record<NumericFacetField, { min?: number; max?: number }>>;
	enums?: Partial<Record<EnumFacetField, string[]>>;
}

function inNumericRange(value: number | null, range: { min?: number; max?: number }): boolean {
	if (value == null || !Number.isFinite(value)) return false;
	if (range.min != null && value < range.min) return false;
	if (range.max != null && value > range.max) return false;
	return true;
}

function inEnumSet(value: string | string[] | null, allow: string[]): boolean {
	if (allow.length === 0) return true;
	if (value == null) return false;
	if (Array.isArray(value)) return value.some((v) => allow.includes(v));
	return allow.includes(value);
}

function inDatetimeRange(value: string | null, range: { min?: string; max?: string }): boolean {
	if (!value) return false;
	const t = Date.parse(value);
	if (!Number.isFinite(t)) return false;
	if (range.min) {
		const m = Date.parse(range.min);
		if (Number.isFinite(m) && t < m) return false;
	}
	if (range.max) {
		const m = Date.parse(range.max);
		if (Number.isFinite(m) && t > m) return false;
	}
	return true;
}

/**
 * Filter views by `state`. Empty / missing entries are no-ops. Returns a new
 * array, the input is never mutated. Order is preserved, run `sortViews`
 * afterwards if a different order is needed.
 */
export function applyFacets(
	views: StacItemView[],
	state: FacetState | null | undefined
): StacItemView[] {
	if (!state) return views;
	const dt = state.datetime;
	const num = state.numeric;
	const enums = state.enums;
	const hasDatetime = dt && (dt.min || dt.max);
	const hasNumeric = num && Object.values(num).some((r) => r && (r.min != null || r.max != null));
	const hasEnums = enums && Object.values(enums).some((a) => Array.isArray(a) && a.length > 0);
	if (!hasDatetime && !hasNumeric && !hasEnums) return views;

	return views.filter((view) => {
		if (hasDatetime && dt && !inDatetimeRange(view.datetime, dt)) return false;
		if (hasNumeric && num) {
			for (const field of NUMERIC_FIELDS) {
				const range = num[field];
				if (!range || (range.min == null && range.max == null)) continue;
				if (!inNumericRange(view[field], range)) return false;
			}
		}
		if (hasEnums && enums) {
			for (const field of ENUM_FIELDS) {
				const allow = enums[field];
				if (!Array.isArray(allow) || allow.length === 0) continue;
				if (!inEnumSet(view[field] as string | string[] | null, allow)) return false;
			}
		}
		return true;
	});
}

// ─── Sorting ────────────────────────────────────────────────────────

export type FacetSort =
	| 'datetime-desc'
	| 'datetime-asc'
	| 'cloud-asc'
	| 'cloud-desc'
	| 'gsd-asc'
	| 'gsd-desc'
	| 'id-asc';

/**
 * Sort views by one of a fixed set of strategies. Items missing the sort
 * field always sink to the bottom (regardless of asc/desc) so a `cloud-asc`
 * sort never surfaces "items with no cloud cover" above the cleanest scenes.
 */
export function sortViews(views: StacItemView[], sort: FacetSort): StacItemView[] {
	const arr = views.slice();
	const cmp = getComparator(sort);
	arr.sort(cmp);
	return arr;
}

function getComparator(sort: FacetSort): (a: StacItemView, b: StacItemView) => number {
	switch (sort) {
		case 'datetime-desc':
			return (a, b) => compareNullableNumber(parseTime(b.datetime), parseTime(a.datetime));
		case 'datetime-asc':
			return (a, b) => compareNullableNumber(parseTime(a.datetime), parseTime(b.datetime));
		case 'cloud-asc':
			return (a, b) => compareNullableNumber(a.cloudCover, b.cloudCover);
		case 'cloud-desc':
			return (a, b) => compareNullableNumber(b.cloudCover, a.cloudCover);
		case 'gsd-asc':
			return (a, b) => compareNullableNumber(a.gsd, b.gsd);
		case 'gsd-desc':
			return (a, b) => compareNullableNumber(b.gsd, a.gsd);
		case 'id-asc':
			return (a, b) => a.id.localeCompare(b.id);
	}
}

function parseTime(s: string | null): number | null {
	if (!s) return null;
	const t = Date.parse(s);
	return Number.isFinite(t) ? t : null;
}

function compareNullableNumber(a: number | null, b: number | null): number {
	const aMissing = a == null || !Number.isFinite(a);
	const bMissing = b == null || !Number.isFinite(b);
	if (aMissing && bMissing) return 0;
	if (aMissing) return 1;
	if (bMissing) return -1;
	return (a as number) - (b as number);
}

// ─── State helpers ──────────────────────────────────────────────────

/** True when any filter in `state` would actually narrow the input. */
export function hasActiveFilters(state: FacetState | null | undefined): boolean {
	if (!state) return false;
	if (state.datetime && (state.datetime.min || state.datetime.max)) return true;
	if (state.numeric) {
		for (const r of Object.values(state.numeric)) {
			if (r && (r.min != null || r.max != null)) return true;
		}
	}
	if (state.enums) {
		for (const a of Object.values(state.enums)) {
			if (Array.isArray(a) && a.length > 0) return true;
		}
	}
	return false;
}

/** Return `state` with every filter cleared. Useful for reset buttons. */
export function emptyFacetState(): FacetState {
	return {};
}
