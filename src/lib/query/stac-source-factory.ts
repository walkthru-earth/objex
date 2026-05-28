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

import type { StacRoutableKind, StacSource } from '@walkthru-earth/objex-utils';
import {
	createApiSource,
	createStaticSource,
	hasStacItemsEndpoint,
	STAC_API_PATH_RE
} from '@walkthru-earth/objex-utils';
import type { StorageAdapter } from '../storage/adapter.js';
import type { Tab } from '../types.js';
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
	/**
	 * SDK opt-in: force the parquet source to treat `tab.path` as a
	 * hive-partitioned parquet directory and query it with
	 * `read_parquet('.../**\/*.parquet', hive_partitioning=true,
	 * union_by_name=true)`. Mirrors lazycogs'
	 * `DuckdbClient(use_hive_partitioning=True)`. When undefined, the factory
	 * also auto-detects directory layouts (see below).
	 */
	useHivePartitioning?: boolean;
	/**
	 * Debug flag. When true the parquet source runs `EXPLAIN <query>` once per
	 * `runQuery()` and logs the plan to the console so we can verify partition
	 * stats are pruning files. OFF by default — never enable in shipped UI.
	 */
	debugExplain?: boolean;
}

/**
 * True when the tab looks like a hive-partitioned parquet directory rather
 * than a single parquet file. Conservative: requires either an explicit SDK
 * opt-in (`deps.useHivePartitioning`) OR a `tab.path` ending in `/` AND a
 * `.parquet`/`.geoparquet` extension. We do NOT auto-promote arbitrary
 * extensionless paths to parquet — that would silently mis-dispatch JSON
 * catalogs whose URL happens to have no extension. The factory defers the
 * actual `adapter.list()` probe to the parquet source so the dispatch stays
 * synchronous.
 */
export function looksLikeHivePartitionedParquet(tab: Tab, deps: CreateStacSourceDeps): boolean {
	if (deps.useHivePartitioning === true) return true;
	const path = tab.path ?? '';
	const ext = (tab.extension ?? '').toLowerCase();
	if (path.endsWith('/') && (ext === 'parquet' || ext === 'geoparquet')) return true;
	return false;
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
	const hive = looksLikeHivePartitionedParquet(tab, deps);
	if (ext === 'parquet' || ext === 'geoparquet' || hive) {
		return createParquetSource(tab, deps.connectionId, {
			adapter: deps.adapter,
			useHivePartitioning: hive,
			debugExplain: deps.debugExplain
		});
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
