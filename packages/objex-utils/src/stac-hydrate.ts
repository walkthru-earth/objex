/**
 * STAC link-following hydrator. Walks `links[rel=item]` (Collection),
 * `links[rel=child]` → `links[rel=item]` (Catalog), and `links[rel=next]`
 * (paginated FeatureCollection / STAC API) into a flat list of StacItems.
 */

import type { StorageAdapter } from '../storage/adapter.js';
import {
	isStacCatalog,
	isStacCollection,
	isStacFeatureCollection,
	isStacItem,
	type StacCatalog,
	type StacCollection,
	type StacFeatureCollection,
	type StacItem,
	type StacLink,
	type StacRoutableKind
} from './stac.js';

export interface HydrateOptions {
	signal: AbortSignal;
	/** Max parallel fetches. Default 12. */
	concurrency?: number;
	/** Hard cap on items; catalogs larger than this are truncated. Default 2000. */
	limit?: number;
	/** Follow `links[rel=next]` pagination in FeatureCollections. Default true. */
	followPagination?: boolean;
	/** Emit fetched items in batches for progressive rendering. */
	onBatch?: (items: StacItem[]) => void;
	/** Emit progress totals for UI. */
	onProgress?: (fetched: number, totalHinted: number | undefined) => void;
	/**
	 * Map an absolute HTTPS URL to a bucket-relative key when it belongs to the
	 * caller's connection. When provided and it returns a non-null string,
	 * `fetchJson` routes through the storage adapter (which handles SigV4) instead
	 * of a raw cross-origin `fetch`, so private-bucket catalogs can be walked.
	 */
	urlToKey?: (absoluteUrl: string) => string | null;
	/**
	 * Optional native STAC API filters appended to the `rel="items"` endpoint
	 * (and applied to `links[rel=next]` pages). Lets callers narrow a
	 * collection by spatial / temporal extent before hydration.
	 */
	itemsQuery?: StacItemsQuery;
}

/** Native filters supported by OGC API Features / STAC API on `/items`. */
export interface StacItemsQuery {
	/** WGS84 bbox `[west, south, east, north]`. */
	bbox?: [number, number, number, number];
	/** RFC 3339 instant or interval `start/end` (use `..` for open ends). */
	datetime?: string;
	/** Per-page item count hint, the server may cap this. */
	limit?: number;
	/**
	 * CQL2-JSON filter expression (STAC API Filter extension). When set, gets
	 * appended as `?filter=<json>&filter-lang=cql2-json` and re-stamped onto
	 * every `rel="next"` page so cursor URLs cannot strip it.
	 */
	filter?: unknown;
}

export interface HydrateResult {
	items: StacItem[];
	truncated: boolean;
	rootBaseHref: string;
}

export async function hydrateStacItems(
	root: StacRoutableKind,
	baseHref: string,
	adapter: StorageAdapter,
	opts: HydrateOptions
): Promise<HydrateResult> {
	const limit = opts.limit ?? 2000;
	const concurrency = opts.concurrency ?? 12;
	const followPagination = opts.followPagination ?? true;
	const signal = opts.signal;
	const urlToKey = opts.urlToKey;

	const items: StacItem[] = [];
	let truncated = false;

	const emit = (batch: StacItem[]) => {
		if (batch.length === 0) return;
		items.push(...batch);
		opts.onBatch?.(batch);
		opts.onProgress?.(items.length, undefined);
	};

	if (root.kind === 'item') {
		emit([absolutizeItemAssets(root.item, baseHref)]);
		return { items, truncated: false, rootBaseHref: baseHref };
	}

	if (root.kind === 'item-collection') {
		await consumeFeatureCollection(root.fc, baseHref, adapter, {
			signal,
			concurrency,
			limit,
			followPagination,
			urlToKey,
			itemsQuery: opts.itemsQuery,
			onAccept: (batch) => emit(batch),
			stopCheck: () => items.length >= limit,
			onTruncate: () => {
				truncated = true;
			}
		});
		return { items: items.slice(0, limit), truncated, rootBaseHref: baseHref };
	}

	if (root.kind === 'collection' || root.kind === 'catalog') {
		const itemLinks = collectItemLinks(root.payload, baseHref);
		const childLinks =
			root.kind === 'catalog' || itemLinks.length === 0
				? collectChildLinks(root.payload, baseHref)
				: [];
		// OGC API Features convention used by STAC API endpoints (earth-search,
		// planetary-computer, pgstac, ...): a Collection advertises a single
		// `rel="items"` link pointing at a paginated FeatureCollection. Static
		// "self-contained" catalogs use `rel="item"` per item file instead, so
		// only walk the items endpoint when no static item links are present.
		const itemsEndpoint =
			itemLinks.length === 0 ? collectItemsEndpoint(root.payload, baseHref, opts.itemsQuery) : null;

		if (itemLinks.length > 0) {
			await fetchItems(itemLinks, adapter, baseHref, {
				signal,
				concurrency,
				urlToKey,
				onBatch: (batch) => emit(batch),
				stopCheck: () => items.length >= limit,
				onTruncate: () => {
					truncated = true;
				}
			});
		} else if (itemsEndpoint) {
			try {
				const json = await fetchJson(adapter, itemsEndpoint, baseHref, signal, urlToKey);
				if (isStacFeatureCollection(json)) {
					await consumeFeatureCollection(json, itemsEndpoint, adapter, {
						signal,
						concurrency,
						limit,
						followPagination,
						urlToKey,
						itemsQuery: opts.itemsQuery,
						onAccept: (batch) => emit(batch),
						stopCheck: () => items.length >= limit,
						onTruncate: () => {
							truncated = true;
						}
					});
				}
			} catch {
				// Endpoint unreachable, fall through to childLinks below.
			}
		}

		if (!truncated && items.length < limit && childLinks.length > 0) {
			const queue = [...childLinks];
			const stopCheck = () => items.length >= limit || signal.aborted;
			const workerCount = Math.min(concurrency, queue.length);
			const workers: Promise<void>[] = [];
			for (let i = 0; i < workerCount; i++) {
				workers.push(
					(async () => {
						while (queue.length > 0) {
							if (stopCheck()) {
								if (items.length >= limit) truncated = true;
								queue.length = 0;
								return;
							}
							const childHref = queue.shift();
							if (!childHref) return;
							try {
								const childJson = await fetchJson(adapter, childHref, baseHref, signal, urlToKey);
								if (stopCheck()) {
									if (items.length >= limit) truncated = true;
									queue.length = 0;
									return;
								}
								const childKind = classifyFetchedJson(childJson);
								if (childKind.kind === 'none') continue;
								const sub = await hydrateStacItems(childKind, childHref, adapter, {
									...opts,
									limit: limit - items.length,
									onBatch: (batch) => emit(batch),
									onProgress: undefined
								});
								if (sub.truncated) truncated = true;
							} catch {
								// Skip unreachable child, keep aggregating.
							}
						}
					})()
				);
			}
			await Promise.all(workers);
		}

		return { items: items.slice(0, limit), truncated, rootBaseHref: baseHref };
	}

	return { items, truncated: false, rootBaseHref: baseHref };
}

// ─── Internals ──────────────────────────────────────────────────────

function collectItemLinks(payload: StacCollection | StacCatalog, baseHref: string): string[] {
	return (payload.links ?? [])
		.filter((l): l is StacLink => !!l && typeof l.href === 'string' && l.rel === 'item')
		.map((l) => absolutizeHref(l.href, baseHref));
}

function collectChildLinks(payload: StacCollection | StacCatalog, baseHref: string): string[] {
	return (payload.links ?? [])
		.filter((l): l is StacLink => !!l && typeof l.href === 'string' && l.rel === 'child')
		.map((l) => absolutizeHref(l.href, baseHref));
}

/**
 * True when the payload exposes a `rel="items"` link (OGC API Features /
 * STAC API convention). Lets callers switch to viewport-scoped fetching
 * instead of walking every page.
 */
export function hasStacItemsEndpoint(payload: StacCollection | StacCatalog): boolean {
	return (payload.links ?? []).some((l) => !!l && typeof l.href === 'string' && l.rel === 'items');
}

function collectItemsEndpoint(
	payload: StacCollection | StacCatalog,
	baseHref: string,
	query: StacItemsQuery | undefined
): string | null {
	const link = (payload.links ?? []).find(
		(l): l is StacLink => !!l && typeof l.href === 'string' && l.rel === 'items'
	);
	if (!link) return null;
	return applyItemsQuery(absolutizeHref(link.href, baseHref), query);
}

/**
 * Stamp `bbox` / `datetime` / `limit` onto a STAC items URL. Called both for
 * the first-page endpoint and for every server-emitted `rel=next` href, since
 * some custom STAC API implementations issue cursor URLs that drop the
 * caller's filters and would otherwise return unbounded results on page 2+.
 */
function applyItemsQuery(absolute: string, query: StacItemsQuery | undefined): string {
	if (!query) return absolute;
	try {
		const url = new URL(absolute);
		if (query.bbox && query.bbox.length === 4 && !url.searchParams.has('bbox')) {
			url.searchParams.set('bbox', query.bbox.join(','));
		}
		if (query.datetime && !url.searchParams.has('datetime')) {
			url.searchParams.set('datetime', query.datetime);
		}
		if (typeof query.limit === 'number' && query.limit > 0 && !url.searchParams.has('limit')) {
			url.searchParams.set('limit', String(Math.floor(query.limit)));
		}
		// CQL2-JSON filter, encoded as a query-string param per OGC API Filter.
		// Skip when the server already stamped `filter=` onto its `rel=next` URL
		// (some servers echo the original filter in cursor links, double-stamping
		// would corrupt the JSON).
		if (query.filter !== undefined && query.filter !== null && !url.searchParams.has('filter')) {
			try {
				url.searchParams.set('filter', JSON.stringify(query.filter));
				if (!url.searchParams.has('filter-lang')) {
					url.searchParams.set('filter-lang', 'cql2-json');
				}
			} catch {
				// JSON.stringify can only throw on cyclic input; fall through with
				// the URL unchanged so hydration continues without the filter.
			}
		}
		return url.toString();
	} catch {
		return absolute;
	}
}

async function consumeFeatureCollection(
	fc: StacFeatureCollection,
	baseHref: string,
	adapter: StorageAdapter,
	ctx: {
		signal: AbortSignal;
		concurrency: number;
		limit: number;
		followPagination: boolean;
		urlToKey?: (absoluteUrl: string) => string | null;
		itemsQuery?: StacItemsQuery;
		onAccept: (items: StacItem[]) => void;
		stopCheck: () => boolean;
		onTruncate: () => void;
	}
): Promise<void> {
	const accepted = fc.features
		.filter(isStacItem)
		.map((item) => absolutizeItemAssets(item, baseHref));
	ctx.onAccept(accepted);
	if (ctx.stopCheck()) {
		ctx.onTruncate();
		return;
	}

	if (!ctx.followPagination) return;
	const next = (fc.links ?? []).find((l) => l && l.rel === 'next' && typeof l.href === 'string');
	if (!next) return;

	const nextHref = applyItemsQuery(absolutizeHref(next.href, baseHref), ctx.itemsQuery);
	if (ctx.signal.aborted) return;
	try {
		const json = await fetchJson(adapter, nextHref, baseHref, ctx.signal, ctx.urlToKey);
		if (!isStacFeatureCollection(json)) return;
		await consumeFeatureCollection(json, nextHref, adapter, ctx);
	} catch {
		// Pagination dead-end, keep what we have.
	}
}

async function fetchItems(
	hrefs: string[],
	adapter: StorageAdapter,
	baseHref: string,
	ctx: {
		signal: AbortSignal;
		concurrency: number;
		urlToKey?: (absoluteUrl: string) => string | null;
		onBatch: (items: StacItem[]) => void;
		stopCheck: () => boolean;
		onTruncate: () => void;
	}
): Promise<void> {
	const queue = [...hrefs];
	const workers: Promise<void>[] = [];
	const workerCount = Math.min(ctx.concurrency, queue.length);

	for (let i = 0; i < workerCount; i++) {
		workers.push(
			(async () => {
				while (queue.length > 0) {
					if (ctx.signal.aborted) return;
					if (ctx.stopCheck()) {
						ctx.onTruncate();
						queue.length = 0;
						return;
					}
					const href = queue.shift();
					if (!href) return;
					try {
						const json = await fetchJson(adapter, href, baseHref, ctx.signal, ctx.urlToKey);
						if (isStacItem(json)) ctx.onBatch([absolutizeItemAssets(json, href)]);
					} catch {
						// Skip this item, a dead link is not fatal.
					}
				}
			})()
		);
	}

	await Promise.all(workers);
}

async function fetchJson(
	adapter: StorageAdapter,
	href: string,
	_baseHref: string,
	signal: AbortSignal,
	urlToKey?: (absoluteUrl: string) => string | null
): Promise<unknown> {
	// Absolute URLs that belong to the caller's own bucket route through the
	// adapter so SigV4 presigning applies — raw `fetch` would 403 on private
	// buckets. Foreign origins stay on plain `fetch`. Relative hrefs reach here
	// only when absolutizeHref could not resolve them against baseHref.
	if (/^https?:/i.test(href)) {
		const ownKey = urlToKey ? urlToKey(href) : null;
		if (ownKey !== null) {
			const buf = await adapter.read(ownKey, undefined, undefined, signal);
			return JSON.parse(new TextDecoder().decode(buf));
		}
		const res = await fetch(href, { signal });
		if (!res.ok) throw new Error(`HTTP ${res.status} for ${href}`);
		return await res.json();
	}
	const buf = await adapter.read(href, undefined, undefined, signal);
	return JSON.parse(new TextDecoder().decode(buf));
}

function classifyFetchedJson(json: unknown): StacRoutableKind {
	if (isStacItem(json)) return { kind: 'item', item: json };
	if (isStacFeatureCollection(json)) return { kind: 'item-collection', fc: json };
	if (isStacCollection(json)) return { kind: 'collection', payload: json };
	if (isStacCatalog(json)) return { kind: 'catalog', payload: json };
	return { kind: 'none' };
}

/**
 * Resolve a possibly-relative href against a base. STAC catalogs commonly use
 * `./child/foo.json` or `../foo.json`. `new URL(relative, base)` handles both.
 */
export function absolutizeHref(href: string, baseHref: string): string {
	if (/^https?:/i.test(href) || /^s3:/i.test(href) || /^azure:/i.test(href)) return href;
	try {
		return new URL(href, baseHref).toString();
	} catch {
		return href;
	}
}

/**
 * Return a new StacItem with every asset href resolved against the URL the
 * item itself was fetched from. Asset hrefs in STAC Items are relative to the
 * item JSON (`./B04.tif`, `../scene/asset.tif`), so downstream consumers that
 * hand them to `GeoTIFF.fromUrl` or `fetch` need absolute URLs.
 */
function absolutizeItemAssets(item: StacItem, itemHref: string): StacItem {
	const assets = item.assets;
	if (!assets) return item;
	let changed = false;
	const resolved: typeof assets = {};
	for (const [key, asset] of Object.entries(assets)) {
		if (asset?.href && typeof asset.href === 'string') {
			const abs = absolutizeHref(asset.href, itemHref);
			if (abs !== asset.href) changed = true;
			resolved[key] = { ...asset, href: abs };
		} else {
			resolved[key] = asset;
		}
	}
	return changed ? { ...item, assets: resolved } : item;
}
