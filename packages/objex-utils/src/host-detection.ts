/**
 * Auto-detect hosting bucket from URL search params and window.location.
 *
 * Detection priority:
 * 1. `?url=<storage-url>` query parameter (highest priority)
 * 2. `window.location.hostname` pattern matching (fallback)
 *
 * Also extracts `rootPrefix` when the app is hosted inside a subfolder.
 */

import { buildProviderBaseUrl, type ProviderId } from '../../../src/lib/storage/providers.js';
import type { StacItem } from './stac.js';
import { applyStorageHintsToConnection, extractStorageHints } from './stac-storage-extension.js';
import { isKnownBucketHost, parseStorageUrl, type StorageProvider } from './storage-url.js';

export interface DetectedHost {
	provider: StorageProvider;
	bucket: string;
	region: string;
	endpoint: string;
	rootPrefix: string;
	bucketUrl: string;
}

/**
 * Extract root prefix from pathname.
 * When hosted at `/subfolder/index.html` or `/subfolder/`, returns `subfolder/`.
 */
function extractRootPrefix(pathname: string): string {
	// Strip trailing filename (index.html, etc.)
	let clean = pathname.replace(/\/[^/]*\.[^/]*$/, '/');
	// Remove leading slash
	clean = clean.replace(/^\//, '');
	// Empty or just '/' means no prefix
	if (!clean || clean === '/') return '';
	// Ensure trailing slash
	if (!clean.endsWith('/')) clean += '/';
	return clean;
}

/**
 * Build a normalized API endpoint URL for a detected provider.
 */
function buildBucketUrl(
	provider: StorageProvider,
	endpoint: string,
	bucket: string,
	region?: string
): string {
	return buildProviderBaseUrl(
		(provider === 'unknown' ? 's3' : provider) as ProviderId,
		endpoint,
		bucket,
		region || ''
	);
}

/**
 * Translate a `ParsedStorageUrl` into a `DetectedHost`. Returns null when the
 * parser did not recognize a bucket or when the host is not a known provider
 * pattern (prevents arbitrary custom endpoints from being auto-connected).
 */
function parsedToHost(
	parsed: ReturnType<typeof parseStorageUrl>,
	host: string,
	rootPrefix: string
): DetectedHost | null {
	if (!parsed.bucket || !isKnownBucketHost(host)) return null;
	const provider = parsed.provider === 'unknown' ? 's3' : parsed.provider;
	return {
		provider,
		bucket: parsed.bucket,
		region: parsed.region,
		endpoint: parsed.endpoint,
		rootPrefix,
		bucketUrl: buildBucketUrl(parsed.provider, parsed.endpoint, parsed.bucket, parsed.region)
	};
}

/**
 * Detect hosting bucket from current URL.
 * Returns null when no hosting bucket can be determined.
 */
export function detectHostBucket(): DetectedHost | null {
	if (typeof window === 'undefined') return null;

	const url = new URL(window.location.href);

	// Priority 1: ?url= query parameter
	const urlParam = url.searchParams.get('url');
	if (urlParam) {
		try {
			const paramUrl = new URL(urlParam);
			const parsed = parseStorageUrl(urlParam);
			const host = parsedToHost(parsed, paramUrl.hostname, '');
			if (host) return host;
		} catch {
			// Not a parseable URL, fall through to location-based detection.
		}
	}

	// Priority 2: window.location pattern matching via the unified parser.
	// `parseStorageUrl` extracts bucket + any remaining prefix from the
	// current URL. The prefix is used as the in-bucket sub-folder the app
	// should root into when auto-connecting.
	const parsed = parseStorageUrl(window.location.href);
	if (!parsed.bucket || !isKnownBucketHost(url.hostname)) return null;

	// `rootPrefix` is the in-bucket sub-folder, possibly trailing with an
	// `index.html` style filename, which `extractRootPrefix` strips.
	const prefixPath = parsed.prefix ? `/${parsed.prefix}` : '';
	const rootPrefix = extractRootPrefix(prefixPath || '/');

	const provider = parsed.provider === 'unknown' ? 's3' : parsed.provider;
	return {
		provider,
		bucket: parsed.bucket,
		region: parsed.region,
		endpoint: parsed.endpoint,
		rootPrefix,
		bucketUrl: buildBucketUrl(parsed.provider, parsed.endpoint, parsed.bucket, parsed.region)
	};
}

/**
 * Enrich an in-progress connection-config draft with hints from a STAC Item
 * that declares the Storage Extension (`storage:region`,
 * `storage:requester_pays`, `storage:platform`, v2 `storage:schemes`).
 *
 * Modular by design, callers opt in. The existing `detectHostBucket` flow
 * does NOT know about STAC, so call sites that already hold a representative
 * `StacItem` (e.g. classification just after fetching a Catalog / Collection /
 * ItemCollection) should funnel through this helper before handing the draft
 * to `connectionStore.saveHostConnection` / `connectionStore.save`. Existing
 * non-empty fields on the draft are preserved (this never clobbers a
 * user-set value).
 *
 * Returns a shallow copy of `input` with hint fields filled in. Safe to call
 * with an unrelated item, returns `input` untouched when the extension is
 * absent or unparseable.
 */
export function applyStacItemStorageHints<T extends { region?: string; endpoint?: string }>(
	input: T,
	item: StacItem
): T {
	const hints = extractStorageHints(item);
	const merged = applyStorageHintsToConnection(input, hints);
	// Light tracing for development. Stripped from production builds via the
	// Vite `import.meta.env.DEV` define. Intentionally one-line so it's cheap
	// to leave in.
	if (import.meta.env?.DEV && (hints.region || hints.endpoint || hints.requesterPays)) {
		console.debug('[host-detection] applied STAC storage hints', hints);
	}
	return merged;
}
