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
 * Set the ?url= param to a raw URL string (for direct URL tabs).
 */
export function setRawUrlParam(rawUrl: string) {
	try {
		const url = new URL(window.location.href);
		url.searchParams.set('url', rawUrl);
		replaceState(url.pathname + url.search + url.hash, {});
	} catch {
		/* ignore */
	}
}

/**
 * Sync the ?url= param in the browser URL.
 */
export function syncUrlParam(conn: Connection, prefix?: string) {
	try {
		const url = new URL(window.location.href);
		url.searchParams.set('url', buildUrlParam(conn, prefix));
		replaceState(url.pathname + url.search + url.hash, {});
	} catch {
		/* ignore */
	}
}

/**
 * Update the #hash in the URL to reflect the current view mode.
 */
export function updateUrlView(view: string) {
	try {
		const url = new URL(window.location.href);
		url.hash = view || '';
		replaceState(url.pathname + url.search + url.hash, {});
	} catch {
		/* ignore */
	}
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
 * Clear all URL state params.
 */
export function clearUrlState() {
	try {
		const url = new URL(window.location.href);
		url.searchParams.delete('url');
		url.hash = '';
		replaceState(url.pathname + url.search, {});
	} catch {
		/* ignore */
	}
}
