/**
 * STAC API implementation of the StacSource contract. Wraps `hydrateStacItems`
 * link-walking with `itemsQuery: {bbox, datetime, limit, filter}` push-down and
 * yields each `onBatch` as a `StacSourceBatch`.
 *
 * Slice 2 sniffs the catalog/collection's `conformsTo` array once per source
 * instance, builds a CQL2-JSON filter (cloud cover / gsd / platform /
 * constellation / instruments / collection) via `toCql2Filter`, and reports
 * the actually-pushed subset of `FacetState` plus the residual the caller still
 * has to apply via `applyFacets`. When the sniff fails or `conformsTo` lacks
 * the Filter extension, behavior degrades gracefully to slice-1 (bbox+datetime
 * only).
 *
 * Pure TypeScript. No DuckDB / Svelte / maplibre / deck.gl import. The
 * `StorageAdapter` import is structural (an interface), and the actual
 * adapter is injected via `deps`.
 */

import type { StorageAdapter } from '../storage/adapter.js';
import type { StacItem, StacRoutableKind } from './stac.js';
import type { FacetState } from './stac-facets.js';
import { hydrateStacItems, type StacItemsQuery } from './stac-hydrate.js';
import {
	residualState,
	type StacApiCapabilities,
	sniffApiCapabilities,
	toCql2Filter,
	toNativeQuery
} from './stac-pushdown.js';
import {
	emptyPushdown,
	type StacSource,
	type StacSourceBatch,
	type StacSourceCapabilities,
	type StacSourceRequest
} from './stac-source.js';

export interface StacApiSourceDeps {
	adapter: StorageAdapter;
	baseHref: string;
	urlToKey?: (absoluteUrl: string) => string | null;
	concurrency?: number;
}

/**
 * `pushedDown = full - residual`. Drops any field that survived `residualState`
 * (i.e. couldn't be pushed) and keeps everything else. `residualState` only
 * ever sets fields that already existed in `full`, so this structural diff is
 * exact — no false positives.
 */
function subtractState(full: FacetState | undefined, residual: FacetState): FacetState {
	if (!full) return {};
	const out: FacetState = {};
	if (full.datetime && !residual.datetime) out.datetime = full.datetime;
	if (full.numeric) {
		const kept: NonNullable<FacetState['numeric']> = {};
		const residualNumeric = residual.numeric ?? {};
		for (const [k, v] of Object.entries(full.numeric)) {
			if (!v) continue;
			if (residualNumeric[k as keyof typeof residualNumeric]) continue;
			kept[k as keyof typeof kept] = v;
		}
		if (Object.keys(kept).length > 0) out.numeric = kept;
	}
	if (full.enums) {
		const kept: NonNullable<FacetState['enums']> = {};
		const residualEnums = residual.enums ?? {};
		for (const [k, v] of Object.entries(full.enums)) {
			if (!Array.isArray(v) || v.length === 0) continue;
			if (Array.isArray(residualEnums[k as keyof typeof residualEnums])) continue;
			kept[k as keyof typeof kept] = v;
		}
		if (Object.keys(kept).length > 0) out.enums = kept;
	}
	return out;
}

/**
 * Translate a `FacetState.datetime` into the RFC 3339 interval string the
 * STAC API spec expects. Returns `undefined` when the facet has no bounds set.
 * Bare instants (min === max) are emitted as a single RFC 3339 timestamp.
 * Open ends use `..` per the STAC API spec.
 */
function datetimeFacetToRfc3339(dt: FacetState['datetime'] | undefined): string | undefined {
	if (!dt) return undefined;
	const lo = dt.min;
	const hi = dt.max;
	if (!lo && !hi) return undefined;
	if (lo && hi) return lo === hi ? lo : `${lo}/${hi}`;
	if (lo) return `${lo}/..`;
	return `../${hi}`;
}

/**
 * Construct a STAC API source. `kind` is the classified payload from
 * `classifyStac` (Collection / Catalog with `rel="items"`, or a STAC API
 * `item-collection` page). The factory checks before dispatching here, this
 * function does not re-validate.
 *
 * The advertised `capabilities.pushdown` flags reflect the *ceiling* of what a
 * STAC API can push (everything CQL2 covers). The actual push-down per request
 * depends on the `conformsTo` sniff and is reported per-batch in
 * `pushedDown` / `residual` so the caller can re-filter only what's left.
 */
export function createApiSource(kind: StacRoutableKind, deps: StacApiSourceDeps): StacSource {
	const capabilities: StacSourceCapabilities = {
		kind: 'api',
		label: 'STAC API',
		countAvailable: false,
		streaming: true,
		pushdown: {
			...emptyPushdown(),
			bbox: true,
			datetime: true,
			collection: true,
			cloudCover: true,
			gsd: true,
			platform: true,
			constellation: true,
			instruments: true
		}
	};

	// Lazy, cached, never-throws capability sniff. First query() awaits it; later
	// queries reuse the resolved promise so we never re-fetch the catalog root.
	let capsPromise: Promise<StacApiCapabilities> | null = null;
	const getCaps = (signal: AbortSignal): Promise<StacApiCapabilities> => {
		if (!capsPromise) {
			capsPromise = sniffSourceCapabilities(kind, deps, signal).catch(() => SLICE_1_CAPS);
		}
		return capsPromise;
	};

	return {
		capabilities,
		query(req: StacSourceRequest): AsyncIterable<StacSourceBatch> {
			return apiQueryIterable(kind, deps, req, getCaps);
		}
	};
}

/**
 * Slice-1 fallback capabilities: bbox + datetime only. Used when the sniff
 * fails (network error, malformed root, no `conformsTo` array) so the source
 * never throws on construction or first query.
 */
const SLICE_1_CAPS: StacApiCapabilities = {
	bbox: true,
	datetime: true,
	collections: false,
	cql2: false,
	queryables: false
};

/**
 * Read `conformsTo` from the source's root. For Collection / Catalog payloads
 * we already have the parsed root in memory and check it first. STAC API roots
 * sometimes carry `conformsTo` on the parent Catalog instead of the Collection,
 * so we also fall back to fetching `baseHref` when the in-memory payload lacks
 * it. For `item-collection` (a /search page) the array is on the API root,
 * which we approximate by fetching `baseHref` directly.
 *
 * Throws on fetch failure; the caller catches and falls back to SLICE_1_CAPS.
 */
async function sniffSourceCapabilities(
	kind: StacRoutableKind,
	deps: StacApiSourceDeps,
	signal: AbortSignal
): Promise<StacApiCapabilities> {
	const inline = readConformsTo(kind);
	if (inline && inline.length > 0) return sniffApiCapabilities(inline);

	// Fall back to fetching the baseHref. Mirror hydrate.ts's adapter-vs-fetch
	// routing so private buckets work.
	const json = await fetchRootJson(deps, signal);
	if (json && typeof json === 'object') {
		const conformsTo = (json as { conformsTo?: unknown }).conformsTo;
		if (Array.isArray(conformsTo)) return sniffApiCapabilities(conformsTo);
	}
	return SLICE_1_CAPS;
}

function readConformsTo(kind: StacRoutableKind): unknown[] | null {
	if (kind.kind === 'catalog' || kind.kind === 'collection') {
		const ct = (kind.payload as { conformsTo?: unknown }).conformsTo;
		return Array.isArray(ct) ? ct : null;
	}
	if (kind.kind === 'item-collection') {
		const ct = (kind.fc as { conformsTo?: unknown }).conformsTo;
		return Array.isArray(ct) ? ct : null;
	}
	return null;
}

async function fetchRootJson(deps: StacApiSourceDeps, signal: AbortSignal): Promise<unknown> {
	const href = deps.baseHref;
	if (/^https?:/i.test(href)) {
		const ownKey = deps.urlToKey ? deps.urlToKey(href) : null;
		if (ownKey !== null) {
			const buf = await deps.adapter.read(ownKey, undefined, undefined, signal);
			return JSON.parse(new TextDecoder().decode(buf));
		}
		const res = await fetch(href, { signal });
		if (!res.ok) throw new Error(`HTTP ${res.status} for ${href}`);
		return await res.json();
	}
	const buf = await deps.adapter.read(href, undefined, undefined, signal);
	return JSON.parse(new TextDecoder().decode(buf));
}

/**
 * Bridge `hydrateStacItems`' callback-based onBatch into an async iterable.
 * A simple promise-based queue: each onBatch resolves a pending `next()`
 * (or pushes onto a buffer when no consumer is waiting); completion / abort
 * resolve the iterator.
 */
async function* apiQueryIterable(
	kind: StacRoutableKind,
	deps: StacApiSourceDeps,
	req: StacSourceRequest,
	getCaps: (signal: AbortSignal) => Promise<StacApiCapabilities>
): AsyncIterable<StacSourceBatch> {
	if (req.signal.aborted) throw new DOMException('Aborted', 'AbortError');

	const caps = await getCaps(req.signal);
	if (req.signal.aborted) throw new DOMException('Aborted', 'AbortError');

	// Translate FacetState into the native query the API actually supports.
	// `toNativeQuery` handles bbox/datetime/collections + CQL2 filter together.
	const native = toNativeQuery(req.filter, caps, {
		bbox: req.bbox,
		limit: req.pageSize ?? req.limit
	});

	// Map the native query onto `StacItemsQuery`, which is what `hydrateStacItems`
	// re-stamps on every `rel="next"` URL. `collections` cannot be passed here
	// because hydrate walks `/items` (per-collection); the residual state will
	// re-apply it client-side when the engine could not narrow.
	const datetime = native.datetime ?? datetimeFacetToRfc3339(req.filter.datetime);
	const itemsQuery: StacItemsQuery = {
		bbox: native.bbox ?? req.bbox,
		datetime,
		limit: native.limit ?? req.pageSize ?? req.limit,
		filter: native.filter
	};

	// Compute the actually-pushed FacetState by inverting `residualState`. The
	// caller applies only the residual via `applyFacets`, avoiding double work.
	const residual = residualState(req.filter, caps);
	const pushedDown = subtractState(req.filter, residual);

	// When the API doesn't support CQL2 but state needs it, the filter is empty
	// and the residual covers it. When CQL2 is on but the builder produced null
	// (no fields requiring CQL2), itemsQuery.filter stays undefined and we don't
	// emit `?filter=`. `toCql2Filter` is reachable here only via toNativeQuery
	// for clarity; the explicit call lets us short-circuit the URL stamping.
	if (!caps.cql2) {
		// Nothing extra; native already has no filter. Keep itemsQuery clean.
		itemsQuery.filter = undefined;
	} else if (itemsQuery.filter === undefined) {
		const cql = toCql2Filter(req.filter, caps);
		if (cql) itemsQuery.filter = cql;
	}

	type QueueState =
		| { kind: 'value'; batch: StacItem[] }
		| { kind: 'done' }
		| { kind: 'error'; error: unknown };

	const buffer: QueueState[] = [];
	let pendingResolve: ((s: QueueState) => void) | null = null;

	const push = (s: QueueState) => {
		if (pendingResolve) {
			const r = pendingResolve;
			pendingResolve = null;
			r(s);
		} else {
			buffer.push(s);
		}
	};

	const next = (): Promise<QueueState> => {
		if (buffer.length > 0) return Promise.resolve(buffer.shift()!);
		return new Promise((resolve) => {
			pendingResolve = resolve;
		});
	};

	const onAbort = () => push({ kind: 'error', error: new DOMException('Aborted', 'AbortError') });
	req.signal.addEventListener('abort', onAbort, { once: true });

	// Run hydration in the background; it pushes onto the queue. Errors and
	// completion both push terminal states so the consumer loop ends cleanly.
	void (async () => {
		try {
			await hydrateStacItems(kind, deps.baseHref, deps.adapter, {
				signal: req.signal,
				concurrency: deps.concurrency ?? 12,
				limit: req.limit,
				urlToKey: deps.urlToKey,
				itemsQuery,
				onBatch: (batch) => {
					if (batch.length > 0) push({ kind: 'value', batch });
				}
			});
			push({ kind: 'done' });
		} catch (err) {
			push({ kind: 'error', error: err });
		}
	})();

	try {
		while (true) {
			const state = await next();
			if (state.kind === 'value') {
				yield {
					items: state.batch,
					pushedDown,
					residual,
					done: false
				};
				continue;
			}
			if (state.kind === 'done') {
				yield {
					items: [],
					pushedDown,
					residual,
					done: true
				};
				return;
			}
			throw state.error;
		}
	} finally {
		req.signal.removeEventListener('abort', onAbort);
	}
}
