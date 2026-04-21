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

import { replaceState } from '$app/navigation';
import { buildProviderBaseUrl, type ProviderId } from '$lib/storage/providers.js';
import type { Connection } from '$lib/types.js';
import { parseStorageUrl } from './storage-url.js';

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
 */
export function getUrlView(): string {
	try {
		return window.location.hash.replace('#', '');
	} catch {
		return '';
	}
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
