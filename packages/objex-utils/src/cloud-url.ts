/**
 * Cloud storage protocol URL utilities — pure TS, no Svelte dependency.
 *
 * Converts cloud protocol URLs (s3://, gs://) to HTTPS URLs for browser access.
 * Provider-aware native scheme lookup.
 */

import {
	buildProviderBaseUrl,
	PROVIDERS,
	type ProviderId
} from '../../../src/lib/storage/providers.js';

/** AWS region pattern — matches prefixes like "us-west-2", "eu-central-1", etc. */
const AWS_REGION_RE =
	/^(us|eu|ap|sa|ca|me|af|il)-(north|south|east|west|central|northeast|southeast|northwest|southwest)-\d+/;

/**
 * Map provider to its native URI scheme prefix.
 * Derived from the registry's `schemes` array (first entry is the primary scheme).
 * Falls back to 's3' for providers without a scheme (S3-compatible).
 */
export function getNativeScheme(provider: string): string {
	const def = PROVIDERS[provider as ProviderId];
	if (def?.schemes.length) return def.schemes[0];
	return 's3';
}

/**
 * Safely decode a percent-encoded URI component.
 * Returns the original string if decoding fails (malformed sequences).
 */
export function safeDecodeURIComponent(s: string): string {
	try {
		return decodeURIComponent(s);
	} catch {
		return s;
	}
}

/**
 * Convert a cloud storage protocol URL (s3://, gs://) to an HTTPS URL
 * for browser access. Returns the original URL if already HTTP(S) or unknown.
 *
 * Supported:
 * - `s3://bucket/key` → `https://s3.{region}.amazonaws.com/{bucket}/{key}`
 *   (region auto-detected from bucket name when possible)
 * - `gs://bucket/key` → `https://storage.googleapis.com/{bucket}/{key}`
 */
export function resolveCloudUrl(url: string): string {
	// S3 / S3-compatible: s3://, s3a://, s3n://
	const s3Match = url.match(/^s3[an]?:\/\/([^/]+)(?:\/(.*))?$/);
	if (s3Match) {
		const [, bucket, key] = s3Match;
		// Detect region from bucket name (e.g. "us-west-2.opendata.source.coop")
		const regionMatch = bucket.match(AWS_REGION_RE);
		const region = regionMatch ? regionMatch[0] : 'us-east-1';
		const base = buildProviderBaseUrl('s3', '', bucket, region);
		return key ? `${base}/${key}` : base;
	}

	// Google Cloud Storage: gs://, gcs://
	const gcsMatch = url.match(/^gcs?:\/\/([^/]+)(?:\/(.*))?$/);
	if (gcsMatch) {
		const [, bucket, key] = gcsMatch;
		const base = buildProviderBaseUrl('gcs', '', bucket, '');
		return key ? `${base}/${key}` : base;
	}

	return url;
}
