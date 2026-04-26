/**
 * Dispatch a `Tab` + classified STAC payload to the appropriate StacSource
 * implementation. The only module allowed to import both `utils/stac-source-*`
 * (API / static) and `query/stac-source-parquet` (DuckDB-bound) together.
 *
 * Keeping this in `query/` rather than `utils/` is deliberate: it imports the
 * parquet source, which transitively pulls in DuckDB-WASM. `utils/` modules
 * must stay DuckDB-free so the objex-utils sub-package doesn't accidentally
 * pull DuckDB into its bundle (slice 6 promotion).
 */

import type { StorageAdapter } from '../storage/adapter.js';
import type { Tab } from '../types.js';
import type { StacRoutableKind } from '../utils/stac.js';
import { hasStacItemsEndpoint } from '../utils/stac-hydrate.js';
import type { StacSource } from '../utils/stac-source.js';
import { createApiSource } from '../utils/stac-source-api.js';
import { createStaticSource } from '../utils/stac-source-static.js';
import { STAC_API_PATH_RE } from '../utils/storage-url.js';
import { createParquetSource } from './stac-source-parquet.js';

export interface CreateStacSourceDeps {
	adapter: StorageAdapter;
	urlToKey?: (absoluteUrl: string) => string | null;
	baseHref: string;
	/**
	 * Connection id resolved at the dispatch site. Threaded into every source
	 * so the parquet impl does not have to read `tab.connectionId` itself
	 * (asymmetric vs. api/static, would silently break for callers passing a
	 * tab whose connectionId is missing).
	 */
	connectionId: string;
}

/**
 * True when a tab.path looks like a STAC API endpoint (search / items /
 * collections URL pattern). Used to pick the API source for FeatureCollection
 * responses served from API URLs, where the response itself has no
 * `rel="items"` link.
 */
export function tabLooksLikeStacApi(path: string): boolean {
	try {
		return STAC_API_PATH_RE.test(new URL(path).pathname);
	} catch {
		return false;
	}
}

/**
 * Pick a `StacSource` for the tab. Synchronous: the orchestrator branches on
 * `source.capabilities` immediately, before any I/O. The factory does NOT
 * read the tab payload; it relies on the caller's `classified` argument
 * (from `classifyStac`) plus extension and URL heuristics.
 */
export function createStacSourceForTab(
	tab: Tab,
	classified: StacRoutableKind,
	deps: CreateStacSourceDeps
): StacSource {
	const ext = (tab.extension ?? '').toLowerCase();
	if (ext === 'parquet' || ext === 'geoparquet') {
		return createParquetSource(tab, deps.connectionId);
	}

	if (classified.kind === 'collection' || classified.kind === 'catalog') {
		if (hasStacItemsEndpoint(classified.payload)) {
			return createApiSource(classified, deps);
		}
		return createStaticSource(classified, deps);
	}
	if (classified.kind === 'item-collection') {
		if (tabLooksLikeStacApi(tab.path)) return createApiSource(classified, deps);
		return createStaticSource(classified, deps);
	}
	if (classified.kind === 'item') {
		return createStaticSource(classified, deps);
	}
	throw new Error(`Unsupported STAC kind: ${classified.kind}`);
}
