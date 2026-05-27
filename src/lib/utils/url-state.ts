/**
 * URL state management for shareable links.
 *
 * URL format: ?url=<storage-url>[#table|map|query|inspect]
 *
 * - ?url=  : full storage URL (endpoint + bucket + object path)
 *   e.g. https://s3.us-east-1.amazonaws.com/my-bucket/path/file.parquet
 * - #hash  : viewer mode (table, map, query, inspect)
 *
 * Uses SvelteKit's replaceState to avoid conflicts with the router.
 */

import { parseStorageUrl } from '@walkthru-earth/objex-utils';
import { replaceState } from '$app/navigation';
import { buildProviderBaseUrl, type ProviderId } from '$lib/storage/providers.js';
import type { Connection } from '$lib/types.js';

/**
 * Build the base HTTPS URL for a connection (endpoint + bucket).
 */
function buildBaseUrl(conn: Connection): string {
	return buildProviderBaseUrl(conn.provider as ProviderId, conn.endpoint, conn.bucket, conn.region);
}

/**
 * Build a full storage URL from a Connection + optional object prefix.
 */
export function buildUrlParam(conn: Connection, prefix?: string): string {
	const base = buildBaseUrl(conn);
	if (!prefix) return base;
	return `${base}/${prefix.replace(/^\//, '')}`;
}

/**
 * Apply a URL mutation, skipping `replaceState` if nothing changed.
 * Every public mutator below funnels through this to avoid `replaceState`
 * thrash when the tab-sync effect re-fires on unrelated reactive changes.
 */
function writeLocation(mutate: (url: URL) => void) {
	try {
		const url = new URL(window.location.href);
		const before = url.pathname + url.search + url.hash;
		mutate(url);
		const after = url.pathname + url.search + url.hash;
		if (before === after) return;
		replaceState(after, {});
	} catch {
		/* ignore */
	}
}

/**
 * Set the ?url= param to a raw URL string (for direct URL tabs).
 */
export function setRawUrlParam(rawUrl: string) {
	writeLocation((url) => url.searchParams.set('url', rawUrl));
}

/**
 * Sync the ?url= param in the browser URL.
 */
export function syncUrlParam(conn: Connection, prefix?: string) {
	writeLocation((url) => url.searchParams.set('url', buildUrlParam(conn, prefix)));
}

/**
 * Update the #hash in the URL to reflect the current view mode.
 */
export function updateUrlView(view: string) {
	writeLocation((url) => {
		url.hash = view || '';
	});
}

/**
 * Read the current #hash view mode from the URL.
 *
 * The hash is parsed as `#<mode>?<viewParams>`, where `<mode>` is the viewer
 * token (`map`, `stac-map`, `code`, `multicog`, ...) and `<viewParams>` is an
 * optional URLSearchParams-shaped string used by viewers that want richer
 * shareable state (e.g. MultiCogViewer encoding its chosen R/G/B asset keys).
 * Returns just the mode string for backwards compatibility; per-viewer
 * params are retrieved via `getUrlViewParams()`.
 */
export function getUrlView(): string {
	try {
		const raw = window.location.hash.replace('#', '');
		const q = raw.indexOf('?');
		return q >= 0 ? raw.slice(0, q) : raw;
	} catch {
		return '';
	}
}

/**
 * Pick a viewer's `viewMode` from the current URL hash, validated against the
 * viewer's known token vocabulary. Centralises the "is this hash one of the
 * modes I support?" decision so each viewer doesn't reimplement string-match
 * ternary chains, and so we have one place to enforce the invariant: an
 * explicit hash is honoured exactly, an unknown or empty hash falls back to
 * `defaultMode` WITHOUT rewriting the URL. Viewers that mount transiently
 * while another viewer farther up the stack is being chosen (e.g. CodeViewer
 * during ViewerRouter's async STAC detection) MUST NOT clobber a hash they
 * don't understand, because that hash is owned by the eventual viewer.
 */
export function pickViewMode<T extends string>(validModes: readonly T[], defaultMode: T): T {
	const view = getUrlView();
	if (view && (validModes as readonly string[]).includes(view)) return view as T;
	return defaultMode;
}

/**
 * Read viewer-specific params from the URL hash query-string portion.
 *
 * Format: `#<mode>?k1=v1&k2=v2`. Returns a `URLSearchParams` so callers can
 * `.get(key)` cleanly and merge their own state into it.
 */
export function getUrlViewParams(): URLSearchParams {
	try {
		const raw = window.location.hash.replace('#', '');
		const q = raw.indexOf('?');
		if (q < 0) return new URLSearchParams();
		return new URLSearchParams(raw.slice(q + 1));
	} catch {
		return new URLSearchParams();
	}
}

/**
 * Update the hash with both a mode and an optional set of viewer params.
 * Empty / null `params` writes just `#<mode>`. Existing hash params are
 * fully replaced — pass the merged set in.
 */
export function updateUrlViewParams(view: string, params?: URLSearchParams | null): void {
	const qs = params?.toString();
	writeLocation((url) => {
		if (!view) {
			url.hash = '';
			return;
		}
		url.hash = qs ? `${view}?${qs}` : view;
	});
}

/**
 * Read the prefix (file/folder path) from the ?url= param.
 */
export function getUrlPrefix(): string {
	try {
		const url = new URL(window.location.href);
		const urlParam = url.searchParams.get('url');
		if (!urlParam) return '';
		return parseStorageUrl(urlParam).prefix;
	} catch {
		return '';
	}
}

/**
 * True when a `?url=` param is present. Single source of truth, used by
 * the tab-sync effect and Sidebar auto-detection to decide whether an
 * auto-migration is in progress (see `+page.svelte` tab-sync effect).
 */
export function hasUrlParam(): boolean {
	try {
		return new URL(window.location.href).searchParams.has('url');
	} catch {
		return false;
	}
}

/**
 * Clear all URL state params.
 */
export function clearUrlState() {
	writeLocation((url) => {
		url.searchParams.delete('url');
		url.hash = '';
	});
}
