/**
 * Canonical connection identity.
 *
 * Single source of truth for deciding when two connection configs point at
 * the same bucket. Used by the connections store to deduplicate auto-detect,
 * manual add, and edit flows, so one physical bucket never ends up with
 * multiple competing local records.
 *
 * Identity rules, per provider:
 *
 *   azure  → (provider, endpoint, bucket)     endpoint carries the account
 *   gcs    → (provider, bucket)               GCS bucket names are global
 *   s3     → (provider, bucket, region)       AWS native: same bucket name
 *                                             can exist in exactly one region,
 *                                             but the region is load-bearing
 *                                             for signing, so a paste with a
 *                                             different region is a distinct
 *                                             connection until the user merges
 *   other  → (provider, endpoint, bucket)     r2, b2, minio, wasabi, storj,
 *                                             digitalocean, contabo, hetzner,
 *                                             linode, ovhcloud, custom
 *
 * Endpoint normalization is aggressive: scheme + host + non-default port +
 * pathname, with trailing slashes and default ports stripped, host lowercased.
 * That collapses the common trip hazards — http vs https, :443 vs empty,
 * trailing slash drift, mixed case host.
 */

import type { ProviderId } from '../../../src/lib/storage/providers.js';

export interface ConnectionIdentityInput {
	provider: string;
	endpoint: string;
	bucket: string;
	region: string;
}

const DEFAULT_PORTS: Record<string, string> = {
	'https:': '443',
	'http:': '80'
};

const SLASH = 47; // '/'.charCodeAt(0)

/** Strip trailing '/' linearly (avoids the polynomial backtracking of `/\/+$/`). */
function stripTrailingSlashes(s: string): string {
	let end = s.length;
	while (end > 0 && s.charCodeAt(end - 1) === SLASH) end--;
	return s.slice(0, end);
}

/** Strip leading and trailing '/' linearly (avoids `/^\/+|\/+$/g` backtracking). */
function stripEdgeSlashes(s: string): string {
	let start = 0;
	let end = s.length;
	while (start < end && s.charCodeAt(start) === SLASH) start++;
	while (end > start && s.charCodeAt(end - 1) === SLASH) end--;
	return s.slice(start, end);
}

/**
 * Normalize an endpoint URL to a canonical form suitable for equality checks.
 * Empty / whitespace-only input returns `''` (the "no endpoint" sentinel).
 * Non-URL strings are lowercased and stripped of trailing slashes as a best
 * effort so the comparison is still deterministic.
 */
export function normalizeEndpoint(raw: string | undefined | null): string {
	if (!raw) return '';
	const trimmed = raw.trim();
	if (!trimmed) return '';
	try {
		const url = new URL(trimmed);
		const scheme = url.protocol.toLowerCase();
		const host = url.hostname.toLowerCase();
		const defaultPort = DEFAULT_PORTS[scheme] ?? '';
		const port = url.port && url.port !== defaultPort ? `:${url.port}` : '';
		const path = stripTrailingSlashes(url.pathname);
		return `${scheme}//${host}${port}${path}`;
	} catch {
		return stripTrailingSlashes(trimmed.toLowerCase());
	}
}

/** Collapse unknown / empty providers to `'s3'`; otherwise lowercase. */
export function normalizeProvider(provider: string | undefined | null): ProviderId {
	if (!provider) return 's3';
	const p = provider.trim().toLowerCase();
	if (!p || p === 'unknown') return 's3';
	return p as ProviderId;
}

/** Bucket names are case-sensitive on some backends, so preserve case. */
function normalizeBucket(bucket: string | undefined | null): string {
	return stripEdgeSlashes((bucket ?? '').trim());
}

function normalizeRegion(region: string | undefined | null): string {
	return (region ?? '').trim().toLowerCase();
}

/**
 * Produce a canonical key for a connection's identity. Two connection
 * configs with the same identity key point at the same physical bucket.
 * Returns `''` when the config is too incomplete to identify a bucket.
 */
export function connectionIdentityKey(input: ConnectionIdentityInput): string {
	const provider = normalizeProvider(input.provider);
	const bucket = normalizeBucket(input.bucket);
	if (!bucket) return '';

	const endpoint = normalizeEndpoint(input.endpoint);
	const region = normalizeRegion(input.region);

	if (provider === 'azure') return `azure|${endpoint}|${bucket}`;
	if (provider === 'gcs') return `gcs|${bucket}`;
	if (provider === 's3' && !endpoint) return `s3|${bucket}|${region}`;
	return `${provider}|${endpoint}|${bucket}`;
}

/** Convenience: true when both inputs share the same non-empty identity. */
export function isSameConnectionIdentity(
	a: ConnectionIdentityInput,
	b: ConnectionIdentityInput
): boolean {
	const key = connectionIdentityKey(a);
	return key !== '' && key === connectionIdentityKey(b);
}
