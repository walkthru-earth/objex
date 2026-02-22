import { connections } from '$lib/stores/connections.svelte.js';
import { credentialStore } from '$lib/stores/credentials.svelte.js';
import type { Tab } from '$lib/types.js';

/**
 * Build an HTTPS URL for a tab's file.
 * Works for any viewer that needs an HTTP-accessible URL (COG, PMTiles, Zarr, etc.)
 */
export function buildHttpsUrl(tab: Tab): string {
	const conn = tab.connectionId ? connections.getById(tab.connectionId) : null;
	if (!conn) return tab.path;

	const cleanPath = tab.path.replace(/^\//, '');

	// Azure: <endpoint>/<container>/<blob>, append SAS if available
	if (conn.provider === 'azure') {
		const base = conn.endpoint
			? `${conn.endpoint.replace(/\/$/, '')}/${conn.bucket}/${cleanPath}`
			: `https://${conn.bucket}.blob.core.windows.net/${cleanPath}`;
		return appendAzureSas(base, conn.id);
	}

	if (conn.endpoint) {
		return `${conn.endpoint.replace(/\/$/, '')}/${conn.bucket}/${cleanPath}`;
	}

	return `https://s3.${conn.region || 'us-east-1'}.amazonaws.com/${conn.bucket}/${cleanPath}`;
}

/**
 * Build an S3 protocol URL (s3://bucket/path).
 */
export function buildStorageUrl(tab: Tab): string {
	const conn = tab.connectionId ? connections.getById(tab.connectionId) : null;
	if (!conn) return tab.path;

	return `s3://${conn.bucket}/${tab.path.replace(/^\//, '')}`;
}

/**
 * Build the URL that DuckDB should use for queries.
 * - S3-compatible (anonymous or authenticated): s3:// — DuckDB handles both via httpfs
 *   with configured region/endpoint. Unsigned for anonymous, SigV4 when credentials set.
 * - Azure: always HTTPS URL with SAS token appended (DuckDB uses httpfs)
 */
export function buildDuckDbUrl(tab: Tab): string {
	const conn = tab.connectionId ? connections.getById(tab.connectionId) : null;
	if (!conn) return tab.path;

	// Azure always uses HTTPS (DuckDB doesn't have native Azure Blob support)
	if (conn.provider === 'azure') {
		return buildHttpsUrl(tab);
	}

	// S3-compatible: always use s3:// protocol so DuckDB uses its configured
	// S3 settings (region, endpoint, url_style). This works for both anonymous
	// (unsigned requests) and authenticated (SigV4).
	// Decode percent-encoded paths (e.g. Arabic filenames) so DuckDB's httpfs
	// doesn't double-encode them (%D9%85 → %25D9%2585).
	const rawPath = safeDecodeURIComponent(tab.path.replace(/^\//, ''));
	return `s3://${conn.bucket}/${rawPath}`;
}

function safeDecodeURIComponent(s: string): string {
	try {
		return decodeURIComponent(s);
	} catch {
		return s;
	}
}

/**
 * Check if a tab's file can be loaded directly via HTTPS URL (streaming).
 * True for URL-sourced tabs, anonymous buckets, and Azure (SAS token in URL).
 * False for authenticated S3 (needs signed URLs or blob download via adapter).
 */
export function canStreamDirectly(tab: Tab): boolean {
	if (tab.source === 'url') return true;
	const conn = tab.connectionId ? connections.getById(tab.connectionId) : null;
	if (!conn) return true;
	if (conn.anonymous) return true;
	if (conn.provider === 'azure') return true;
	return false;
}

/**
 * Append Azure SAS token to a URL if available.
 */
function appendAzureSas(url: string, connectionId: string): string {
	const creds = credentialStore.get(connectionId);
	if (!creds || creds.type !== 'sas-token') return url;
	const token = creds.sasToken;
	const cleanToken = token.startsWith('?') ? token.slice(1) : token;
	const sep = url.includes('?') ? '&' : '?';
	return `${url}${sep}${cleanToken}`;
}
