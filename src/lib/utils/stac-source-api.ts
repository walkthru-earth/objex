/**
 * STAC API implementation of the StacSource contract. Wraps `hydrateStacItems`
 * link-walking with `itemsQuery: {bbox, datetime, limit}` push-down and yields
 * each `onBatch` as a `StacSourceBatch`.
 *
 * Slice 1 reports `bbox` and `datetime` push-down; the rest of the filter is
 * applied client-side by the caller via `applyFacets(residual)`. Slice 2 wires
 * `sniffApiCapabilities` + `toCql2Filter` for collection / cloud cover / GSD /
 * platform / etc. push-down, no orchestrator changes.
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
 */
export function createApiSource(kind: StacRoutableKind, deps: StacApiSourceDeps): StacSource {
	const capabilities: StacSourceCapabilities = {
		kind: 'api',
		label: 'STAC API',
		countAvailable: false,
		streaming: true,
		pushdown: { ...emptyPushdown(), bbox: true, datetime: true }
	};

	return {
		capabilities,
		query(req: StacSourceRequest): AsyncIterable<StacSourceBatch> {
			return apiQueryIterable(kind, deps, req);
		}
	};
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
	req: StacSourceRequest
): AsyncIterable<StacSourceBatch> {
	if (req.signal.aborted) throw new DOMException('Aborted', 'AbortError');

	const datetime = datetimeFacetToRfc3339(req.filter.datetime);
	const itemsQuery: StacItemsQuery = {
		bbox: req.bbox,
		datetime,
		limit: req.pageSize ?? req.limit
	};

	// Slice 1: bbox + datetime are the only pushed-down fields. Everything else
	// stays in the residual for the caller to apply via applyFacets.
	const pushedDown: FacetState = {};
	if (datetime) pushedDown.datetime = req.filter.datetime;
	const residual: FacetState = { ...req.filter };
	delete residual.datetime;

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
