/**
 * Self-contained static catalog implementation of the StacSource contract.
 * Wraps `hydrateStacItems` link-walking with no `itemsQuery`, so the entire
 * advertised tree is fetched and the caller filters client-side.
 *
 * Slice 1 reports zero push-down. Slice 4 adds extent-pruning (skip child
 * links whose `extent.spatial` / `extent.temporal` does not intersect the
 * request bbox / datetime), which lifts `bbox` and `datetime` to true.
 *
 * Pure TypeScript. No DuckDB / Svelte / maplibre / deck.gl import.
 */

import type { StorageAdapter } from '../storage/adapter.js';
import type { StacItem, StacRoutableKind } from './stac.js';
import type { FacetState } from './stac-facets.js';
import { hydrateStacItems } from './stac-hydrate.js';
import {
	emptyPushdown,
	type StacSource,
	type StacSourceBatch,
	type StacSourceCapabilities,
	type StacSourceRequest
} from './stac-source.js';

export interface StacStaticSourceDeps {
	adapter: StorageAdapter;
	baseHref: string;
	urlToKey?: (absoluteUrl: string) => string | null;
	concurrency?: number;
}

export function createStaticSource(kind: StacRoutableKind, deps: StacStaticSourceDeps): StacSource {
	const capabilities: StacSourceCapabilities = {
		kind: 'static',
		label: 'Static catalog',
		countAvailable: false,
		streaming: true,
		pushdown: { ...emptyPushdown() }
	};

	return {
		capabilities,
		query(req: StacSourceRequest): AsyncIterable<StacSourceBatch> {
			return staticQueryIterable(kind, deps, req);
		}
	};
}

async function* staticQueryIterable(
	kind: StacRoutableKind,
	deps: StacStaticSourceDeps,
	req: StacSourceRequest
): AsyncIterable<StacSourceBatch> {
	if (req.signal.aborted) throw new DOMException('Aborted', 'AbortError');

	// Slice 1: nothing pushed, everything residual. Slice 4 widens this.
	const pushedDown: FacetState = {};
	const residual: FacetState = req.filter;

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

	void (async () => {
		try {
			await hydrateStacItems(kind, deps.baseHref, deps.adapter, {
				signal: req.signal,
				concurrency: deps.concurrency ?? 12,
				limit: req.limit,
				urlToKey: deps.urlToKey,
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
				yield { items: [], pushedDown, residual, done: true };
				return;
			}
			throw state.error;
		}
	} finally {
		req.signal.removeEventListener('abort', onAbort);
	}
}
