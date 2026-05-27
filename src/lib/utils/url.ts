import { getNativeScheme, safeDecodeURIComponent } from '@walkthru-earth/objex-utils';
import { presignHttpsUrl } from '../storage/presign.js';
import {
	buildProviderBaseUrl,
	isPubliclyStreamable,
	type ProviderId
} from '../storage/providers.js';
import { connections } from '../stores/connections.svelte.js';
import { credentialStore } from '../stores/credentials.svelte.js';
import type { Tab } from '../types.js';

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
 * Async counterpart of `buildHttpsUrl`. For `signed-s3` connections, returns a
 * presigned HTTPS URL (SigV4 query-string auth). For public or SAS connections
 * it returns the same URL as the sync version.
 */
export async function buildHttpsUrlAsync(tab: Tab, expiresIn?: number): Promise<string> {
	const presigned = await tryPresignTab(tab, expiresIn);
	return presigned ?? buildHttpsUrl(tab);
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
 * Async counterpart of `buildDuckDbUrl`. Returns a presigned HTTPS URL for
 * `signed-s3` connections so DuckDB httpfs can fetch with `Range` only, no
 * `Authorization` preflight (which breaks on GCS's S3-compat endpoint when
 * the bucket CORS `responseHeader` list desyncs from the browser's request).
 */
export async function buildDuckDbUrlAsync(tab: Tab, expiresIn?: number): Promise<string> {
	const presigned = await tryPresignTab(tab, expiresIn);
	return presigned ?? buildDuckDbUrl(tab);
}

/** Presign the tab's HTTPS URL for `signed-s3` connections; null otherwise. */
async function tryPresignTab(tab: Tab, expiresIn?: number): Promise<string | null> {
	const conn = tab.connectionId ? connections.getById(tab.connectionId) : null;
	if (!conn || isPubliclyStreamable(conn)) return null;
	try {
		return await presignHttpsUrl(conn, tab.path, expiresIn);
	} catch (err) {
		// Silent fallback would route the caller back to `s3://...` + SigV4
		// header signing — exactly the CORS preflight path presigning was added
		// to avoid. Surface the failure so it is debuggable.
		console.warn('[presign] falling back to signed-s3 path:', err);
		return null;
	}
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
