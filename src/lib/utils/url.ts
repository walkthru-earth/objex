import {
	buildProviderBaseUrl,
	isPubliclyStreamable,
	type ProviderId
} from '$lib/storage/providers.js';
import { connections } from '$lib/stores/connections.svelte.js';
import { credentialStore } from '$lib/stores/credentials.svelte.js';
import type { Tab } from '$lib/types.js';
import { getNativeScheme, safeDecodeURIComponent } from './cloud-url.js';

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

	return `${buildProviderBaseUrl(conn.provider as ProviderId, conn.endpoint, conn.bucket, conn.region)}/${cleanPath}`;
}

/**
 * Build a provider-native protocol URL (s3://bucket/path, sj://bucket/path, etc.).
 */
export function buildStorageUrl(tab: Tab): string {
	const conn = tab.connectionId ? connections.getById(tab.connectionId) : null;
	if (!conn) return tab.path;

	const scheme = getNativeScheme(conn.provider);
	return `${scheme}://${conn.bucket}/${tab.path.replace(/^\//, '')}`;
}

/**
 * Build the URL DuckDB should query. Derived from the connection's access mode:
 *
 * | Access mode     | DuckDB URL                        | Why                                       |
 * |-----------------|-----------------------------------|-------------------------------------------|
 * | `sas-https`     | HTTPS with SAS token              | No DuckDB Azure support; SAS in URL works |
 * | `public-https`  | HTTPS (no auth)                   | httpfs fetches directly, no signing needed|
 * | `signed-s3`     | `s3://bucket/key`                 | DuckDB signs with configured S3 settings  |
 *
 * Path is percent-decoded so DuckDB's httpfs doesn't double-encode
 * (e.g. Arabic filenames `%D9%85` → `%25D9%2585`).
 */
export function buildDuckDbUrl(tab: Tab): string {
	const conn = tab.connectionId ? connections.getById(tab.connectionId) : null;
	if (!conn) return tab.path;
	if (isPubliclyStreamable(conn)) return buildHttpsUrl(tab);

	// Decode percent-encoded paths (e.g. Arabic filenames) so DuckDB's httpfs
	// doesn't double-encode them (%D9%85 → %25D9%2585).
	const rawPath = safeDecodeURIComponent(tab.path.replace(/^\//, ''));
	return `s3://${conn.bucket}/${rawPath}`;
}

/**
 * True when any HTTP client (fetch/img/video/deck.gl/COG/Zarr/PMTiles) can
 * load the tab's file directly via its HTTPS URL. False when SigV4 signing
 * is required and the viewer must go through the storage adapter instead.
 */
export function canStreamDirectly(tab: Tab): boolean {
	if (tab.source === 'url') return true;
	const conn = tab.connectionId ? connections.getById(tab.connectionId) : null;
	if (!conn) return true;
	return isPubliclyStreamable(conn);
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
