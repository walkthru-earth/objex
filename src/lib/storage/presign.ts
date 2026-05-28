import { safeDecodeURIComponent } from '@walkthru-earth/objex-utils';
import { DEFAULT_AWS_REGION } from '../constants.js';
import { credentialStore } from '../stores/credentials.svelte.js';
import type { Connection } from '../types.js';
import { buildProviderBaseUrl, getAccessMode, type ProviderId } from './providers.js';

// 7 days is the SigV4 protocol maximum and is the hard cap on every
// S3-compatible provider we support (AWS, GCS, R2, B2, DO, Wasabi, Storj,
// Hetzner, Contabo, Linode, OVHcloud, MinIO). SDK defaults are lower
// (GCS ships 3600s) but that's a default, not a limit.
const MAX_EXPIRES_IN_SECONDS = 7 * 24 * 3600;
const DEFAULT_EXPIRES_IN_SECONDS = MAX_EXPIRES_IN_SECONDS;

/**
 * Presign an HTTPS URL using SigV4 query-string authentication (`X-Amz-*` params).
 *
 * Consumers like DuckDB's httpfs can fetch the returned URL directly with just a
 * `Range` header, which avoids the `Authorization` header preflight that breaks
 * on GCS's S3-compatible endpoint (cached preflight mismatches, `responseHeader`
 * list not matching the browser's requested headers, etc.).
 *
 * Returns null when the connection is anonymous, Azure, or has no SigV4 creds.
 * Callers should fall back to the `s3://` + SigV4 header path in that case.
 */
export async function presignHttpsUrl(
	conn: Connection,
	key: string,
	expiresIn: number = DEFAULT_EXPIRES_IN_SECONDS
): Promise<string | null> {
	if (getAccessMode(conn) !== 'signed-s3') return null;

	const creds = credentialStore.get(conn.id);
	if (!creds || creds.type !== 'sigv4') return null;

	const cleanKey = safeDecodeURIComponent(key.replace(/^\//, ''));
	const baseUrl = buildProviderBaseUrl(
		conn.provider as ProviderId,
		conn.endpoint,
		conn.bucket,
		conn.region
	);
	const url = new URL(`${baseUrl}/${encodeKey(cleanKey)}`);
	// Clamp to the protocol max so callers asking for longer don't silently
	// produce URLs every provider rejects.
	const effectiveExpiry = Math.min(Math.max(1, expiresIn), MAX_EXPIRES_IN_SECONDS);
	url.searchParams.set('X-Amz-Expires', String(effectiveExpiry));

	// Lazy-load aws4fetch so public-only sessions don't pull it into the
	// shared viewer chunk (utils/url.ts is imported widely).
	const { AwsClient } = await import('aws4fetch');
	const client = new AwsClient({
		accessKeyId: creds.accessKey,
		secretAccessKey: creds.secretKey,
		service: 's3',
		region: conn.region || DEFAULT_AWS_REGION
	});

	const signed = await client.sign(url.toString(), {
		method: 'GET',
		aws: { signQuery: true, allHeaders: false }
	});
	return signed.url;
}

/** Encode an object key for URL path, preserving `/` separators. */
function encodeKey(key: string): string {
	return key
		.split('/')
		.map((s) => encodeURIComponent(s))
		.join('/');
}
