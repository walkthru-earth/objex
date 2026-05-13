/**
 * Translate a `FacetState` into native STAC API parameters and CQL2 filters,
 * gated by what the endpoint advertises in `conformsTo`. Pure TS, framework
 * and transport agnostic.
 *
 * The split between this module and `stac-facets.ts` is intentional. Facets
 * own discovery and client-side filtering (works for any source). This
 * module owns *server-side push-down*, which only makes sense when the
 * source is a STAC API that supports OGC API Features query params or the
 * STAC API filter extension.
 *
 * Callers that want push-down:
 *   1. Fetch the API root, read `conformsTo`.
 *   2. `caps = sniffApiCapabilities(conformsTo)` once per session.
 *   3. On each pan / filter change:
 *        const native = toNativeQuery(state, caps);
 *        const filter = caps.cql2 ? toCql2Filter(state, caps) : null;
 *      Pass `native` to the items endpoint and apply `filter` via
 *      `?filter=<json-encoded>` when present. Anything that could not be
 *      pushed down stays in `state` and is filtered client-side via
 *      `applyFacets`.
 */

import type { FacetState } from './stac-facets.js';

// ─── Capability sniff ──────────────────────────────────────────────

/**
 * Subset of STAC API capabilities relevant to filter push-down. Read once
 * per session from the API root's `conformsTo` array.
 */
export interface StacApiCapabilities {
	/** Supports `bbox=` query param (OGC API Features core). */
	bbox: boolean;
	/** Supports `datetime=` query param (OGC API Features core). */
	datetime: boolean;
	/** Supports `collections=` filter (STAC API Item Search). */
	collections: boolean;
	/** Supports the STAC API Filter extension via `filter=` + `filter-lang=cql2-json`. */
	cql2: boolean;
	/** Queryables endpoint advertised, lets clients sniff filterable property names. */
	queryables: boolean;
}

const CONFORMANCE_SIGNATURES: { key: keyof StacApiCapabilities; matchers: RegExp[] }[] = [
	{
		key: 'bbox',
		matchers: [/ogc-api[/-]features.*\/conf\/core/i, /stac-api.*\/item-search/i]
	},
	{
		key: 'datetime',
		matchers: [/ogc-api[/-]features.*\/conf\/core/i, /stac-api.*\/item-search/i]
	},
	{
		key: 'collections',
		matchers: [/stac-api.*\/item-search/i]
	},
	{
		key: 'cql2',
		matchers: [/stac-api.*\/item-search.*\/filter/i, /ogc-api[/-]features.*\/cql2/i, /cql2-json/i]
	},
	{
		key: 'queryables',
		matchers: [/stac-api.*\/item-search.*\/queryables/i, /ogc-api[/-]features.*\/queryables/i]
	}
];

/**
 * Parse a STAC API `conformsTo` array into a capability flag set. Tolerant
 * of unknown URIs, missing entries, and casing differences. Defaults to all
 * `false` when given an empty / non-array input, so a caller that hasn't
 * fetched the root yet never accidentally pushes down something the API
 * cannot honor.
 */
export function sniffApiCapabilities(conformsTo: unknown): StacApiCapabilities {
	const caps: StacApiCapabilities = {
		bbox: false,
		datetime: false,
		collections: false,
		cql2: false,
		queryables: false
	};
	if (!Array.isArray(conformsTo)) return caps;
	const normalised = conformsTo.filter((s): s is string => typeof s === 'string');
	for (const sig of CONFORMANCE_SIGNATURES) {
		if (normalised.some((uri) => sig.matchers.some((re) => re.test(uri)))) {
			caps[sig.key] = true;
		}
	}
	return caps;
}

// ─── Native-query translation ──────────────────────────────────────

/**
 * Generic STAC items query, compatible with both OGC API Features
 * (`/collections/{id}/items`) and STAC API Item Search (`/search`). Mirrors
 * the shape `stac-hydrate.ts::StacItemsQuery` expects, plus optional
 * `collections` and `filter` for the search endpoint.
 */
export interface StacNativeQuery {
	bbox?: [number, number, number, number];
	datetime?: string;
	collections?: string[];
	limit?: number;
	/** CQL2-JSON object, encode with `JSON.stringify` when serializing. */
	filter?: unknown;
	'filter-lang'?: 'cql2-json';
}

export interface ToNativeQueryOptions {
	bbox?: [number, number, number, number];
	limit?: number;
}

/**
 * Translate `state` into the subset of native query params the API supports.
 * Anything that can't be pushed down is silently dropped here, the caller is
 * expected to keep applying it client-side via `applyFacets`. This is safe
 * because client filtering is always a superset, never a contradiction.
 *
 * `bbox` / `limit` are accepted as overrides because they typically come
 * from the viewer's viewport + user setting, not from `state`.
 */
export function toNativeQuery(
	state: FacetState | null | undefined,
	caps: StacApiCapabilities,
	opts: ToNativeQueryOptions = {}
): StacNativeQuery {
	const out: StacNativeQuery = {};
	if (opts.bbox && caps.bbox) out.bbox = opts.bbox;
	if (typeof opts.limit === 'number' && opts.limit > 0) out.limit = Math.floor(opts.limit);
	if (!state) return out;

	if (caps.datetime && state.datetime && (state.datetime.min || state.datetime.max)) {
		out.datetime = formatDatetimeInterval(state.datetime.min, state.datetime.max);
	}

	if (caps.collections && state.enums?.collection?.length) {
		out.collections = [...state.enums.collection];
	}

	if (caps.cql2) {
		const filter = toCql2Filter(state, caps);
		if (filter) {
			out.filter = filter;
			out['filter-lang'] = 'cql2-json';
		}
	}

	return out;
}

/**
 * RFC 3339 datetime interval string. `null/undefined` ends become `..` per
 * the STAC API spec. A bare instant is returned when both ends are equal.
 */
function formatDatetimeInterval(min?: string, max?: string): string {
	const lo = min ?? '..';
	const hi = max ?? '..';
	if (lo === '..' && hi === '..') return '..';
	if (lo === hi) return lo;
	return `${lo}/${hi}`;
}

// ─── CQL2 builder ──────────────────────────────────────────────────

/**
 * CQL2-JSON expression node (very loose typing because the spec allows
 * arbitrary nesting and we only emit a small subset). Use `unknown` at the
 * boundary, cast inside this module.
 */
type Cql2Node = unknown;

/**
 * Build a CQL2-JSON `and` expression from a `FacetState`, covering the
 * filters that aren't already handled by native params. Returns `null` when
 * nothing in `state` requires CQL2 (so the caller can omit `filter=`).
 *
 * Currently emits:
 *   - eo:cloud_cover  (between)
 *   - gsd             (between)
 *   - proj:epsg       (=)
 *   - platform        (in)
 *   - constellation   (in)
 *   - instruments     (a_overlaps)
 *
 * `collection` and `datetime` are skipped here when the corresponding native
 * cap is set, since those are cheaper to push as plain query params. They
 * fall through to CQL2 only when the API advertises CQL2 but not the
 * matching native capability (rare but legal).
 */
export function toCql2Filter(
	state: FacetState | null | undefined,
	caps: StacApiCapabilities
): Cql2Node | null {
	if (!state) return null;
	const clauses: Cql2Node[] = [];

	if (state.numeric) {
		const n = state.numeric;
		pushBetween(clauses, 'eo:cloud_cover', n.cloudCover);
		pushBetween(clauses, 'gsd', n.gsd);
	}

	if (state.enums) {
		const e = state.enums;
		pushIn(clauses, 'platform', e.platform);
		pushIn(clauses, 'constellation', e.constellation);
		pushOverlap(clauses, 'instruments', e.instruments);
		if (!caps.collections) pushIn(clauses, 'collection', e.collection);
	}

	if (!caps.datetime && state.datetime && (state.datetime.min || state.datetime.max)) {
		const lo = state.datetime.min;
		const hi = state.datetime.max;
		if (lo && hi) {
			clauses.push({
				op: 't_intersects',
				args: [{ property: 'datetime' }, { interval: [lo, hi] }]
			});
		} else if (lo) {
			clauses.push({ op: '>=', args: [{ property: 'datetime' }, { timestamp: lo }] });
		} else if (hi) {
			clauses.push({ op: '<=', args: [{ property: 'datetime' }, { timestamp: hi }] });
		}
	}

	if (clauses.length === 0) return null;
	if (clauses.length === 1) return clauses[0];
	return { op: 'and', args: clauses };
}

function pushBetween(
	out: Cql2Node[],
	property: string,
	range: { min?: number; max?: number } | undefined
): void {
	if (!range) return;
	const { min, max } = range;
	if (min == null && max == null) return;
	if (min != null && max != null) {
		out.push({ op: 'between', args: [{ property }, [min, max]] });
		return;
	}
	if (min != null) out.push({ op: '>=', args: [{ property }, min] });
	if (max != null) out.push({ op: '<=', args: [{ property }, max] });
}

function pushIn(out: Cql2Node[], property: string, values: string[] | undefined): void {
	if (!values || values.length === 0) return;
	if (values.length === 1) {
		out.push({ op: '=', args: [{ property }, values[0]] });
		return;
	}
	out.push({ op: 'in', args: [{ property }, values] });
}

function pushOverlap(out: Cql2Node[], property: string, values: string[] | undefined): void {
	if (!values || values.length === 0) return;
	out.push({ op: 'a_overlaps', args: [{ property }, values] });
}

// ─── Residue ───────────────────────────────────────────────────────

/**
 * Subtract everything that was pushed down from `state`, returning the
 * remaining state that the caller still has to apply client-side. Lets the
 * UI avoid double-filtering (which would just be a no-op but wastes work).
 *
 * This is a structural diff, not a deep clone, the input is not mutated.
 */
export function residualState(
	state: FacetState | null | undefined,
	caps: StacApiCapabilities
): FacetState {
	if (!state) return {};
	const out: FacetState = {};
	if (state.datetime && !caps.datetime && !caps.cql2) out.datetime = state.datetime;
	else if (state.datetime && (caps.datetime || caps.cql2)) {
		// Fully pushed.
	}
	if (state.numeric) {
		const remaining: FacetState['numeric'] = {};
		for (const [field, range] of Object.entries(state.numeric)) {
			if (!range) continue;
			if (caps.cql2) continue; // pushed
			remaining[field as keyof typeof remaining] = range;
		}
		if (Object.keys(remaining).length > 0) out.numeric = remaining;
	}
	if (state.enums) {
		const remaining: FacetState['enums'] = {};
		for (const [field, values] of Object.entries(state.enums)) {
			if (!Array.isArray(values) || values.length === 0) continue;
			if (field === 'collection' && caps.collections) continue;
			if (
				caps.cql2 &&
				(field === 'platform' || field === 'constellation' || field === 'instruments')
			) {
				continue;
			}
			remaining[field as keyof typeof remaining] = values;
		}
		if (Object.keys(remaining).length > 0) out.enums = remaining;
	}
	return out;
}
