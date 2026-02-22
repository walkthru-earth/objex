/**
 * Universal cloud storage URL / bucket parser.
 *
 * Accepts the many URI/URL formats that users commonly paste and extracts
 * the correct bucket, region, endpoint, and provider.
 *
 * Supported URI schemes:
 *   s3://   s3a://   s3n://   aws://   — Amazon S3 / S3-compatible
 *   r2://                              — Cloudflare R2
 *   gs://   gcs://                     — Google Cloud Storage
 *   azure://  az://                    — Azure Blob Storage
 *   abfs://   abfss://                — Azure Data Lake (ADLS Gen2)
 *   wasbs://                           — Azure Blob (Hadoop WASB driver)
 *   swift://                           — OpenStack Swift
 *   file://  filesystem://             — Local filesystem
 *
 * Supported HTTPS URL patterns:
 *   https://<bucket>.s3.<region>.amazonaws.com[/prefix]     — AWS virtual-hosted
 *   https://s3.<region>.amazonaws.com/<bucket>[/prefix]     — AWS path-style
 *   https://s3.amazonaws.com/<bucket>                       — AWS global
 *   https://<account>.r2.cloudflarestorage.com/<bucket>     — Cloudflare R2
 *   https://storage.googleapis.com/<bucket>                 — Google Cloud Storage
 *   https://<bucket>.storage.googleapis.com[/prefix]        — GCS virtual-hosted
 *   https://<bucket>.<region>.digitaloceanspaces.com        — DigitalOcean Spaces
 *   https://<region>.digitaloceanspaces.com/<bucket>        — DO Spaces path-style
 *   https://s3.<region>.wasabisys.com/<bucket>              — Wasabi
 *   https://f<id>.backblazeb2.com/file/<bucket>             — Backblaze B2
 *   https://<bucket>.s3.<region>.backblazeb2.com            — B2 S3-compatible
 *   https://<bucket>.oss-<region>.aliyuncs.com              — Alibaba Cloud OSS
 *   https://<bucket>.cos.<region>.myqcloud.com              — Tencent COS
 *   https://storage.yandexcloud.net/<bucket>                — Yandex Cloud
 *   https://gateway.storjshare.io/<bucket>                   — Storj S3 gateway
 *   https://link.storjshare.io/raw/<access>/<bucket>        — Storj linksharing
 *   https://<custom-endpoint>/<bucket>                      — Generic S3-compatible
 *
 * Also handles plain bucket names (no protocol).
 */

export type StorageProvider = 's3' | 'gcs' | 'r2' | 'minio' | 'azure' | 'storj' | 'unknown';

export interface ParsedStorageUrl {
	bucket: string;
	region: string;
	endpoint: string;
	provider: StorageProvider;
	/** Original prefix/path after bucket, if any */
	prefix: string;
}

/** All recognized URI scheme prefixes (lowercase) */
const SCHEME_MAP: Record<string, { provider: StorageProvider; strip: number }> = {
	's3://': { provider: 's3', strip: 5 },
	's3a://': { provider: 's3', strip: 6 },
	's3n://': { provider: 's3', strip: 6 },
	'aws://': { provider: 's3', strip: 6 },
	'r2://': { provider: 'r2', strip: 5 },
	'gs://': { provider: 'gcs', strip: 5 },
	'gcs://': { provider: 'gcs', strip: 6 },
	'azure://': { provider: 'azure', strip: 8 },
	'az://': { provider: 'azure', strip: 5 },
	'abfs://': { provider: 'azure', strip: 7 },
	'abfss://': { provider: 'azure', strip: 8 },
	'wasbs://': { provider: 'azure', strip: 8 },
	'adl://': { provider: 'azure', strip: 6 },
	'storj://': { provider: 'storj', strip: 8 },
	'sj://': { provider: 'storj', strip: 5 },
	'swift://': { provider: 'unknown', strip: 8 }
};

interface Defaults {
	region?: string;
	endpoint?: string;
	provider?: StorageProvider;
}

function defaultResult(defaults: Defaults): ParsedStorageUrl {
	return {
		bucket: '',
		region: defaults.region || 'us-east-1',
		endpoint: defaults.endpoint || '',
		provider: defaults.provider || 's3',
		prefix: ''
	};
}

function splitBucketPrefix(rest: string): { bucket: string; prefix: string } {
	const slashIdx = rest.indexOf('/');
	if (slashIdx >= 0) {
		return {
			bucket: rest.slice(0, slashIdx),
			prefix: rest.slice(slashIdx + 1).replace(/\/+$/, '')
		};
	}
	return { bucket: rest, prefix: '' };
}

/**
 * Parse a user-provided bucket/URL string into structured storage connection parts.
 */
export function parseStorageUrl(input: string, defaults: Defaults = {}): ParsedStorageUrl {
	const trimmed = input.trim();

	// ── Custom URI schemes (s3://, gs://, r2://, az://, etc.) ──────────
	const lower = trimmed.toLowerCase();
	for (const [scheme, { provider, strip }] of Object.entries(SCHEME_MAP)) {
		if (lower.startsWith(scheme)) {
			const rest = trimmed.slice(strip);
			const { bucket, prefix } = splitBucketPrefix(rest);
			return {
				bucket,
				region: defaults.region || 'us-east-1',
				endpoint: defaults.endpoint || '',
				provider,
				prefix
			};
		}
	}

	// ── HTTP(S) URL ─────────────────────────────────────────────────
	if (lower.startsWith('http://') || lower.startsWith('https://')) {
		try {
			const url = new URL(trimmed);
			const host = url.hostname;
			const pathParts = url.pathname.replace(/^\//, '').split('/').filter(Boolean);

			// --- AWS S3 ---

			// Virtual-hosted: <bucket>.s3.<region>.amazonaws.com
			const awsVhost = host.match(/^(.+)\.s3[.-]([a-z0-9-]+)\.amazonaws\.com$/);
			if (awsVhost) {
				return {
					bucket: awsVhost[1],
					region: awsVhost[2],
					endpoint: '',
					provider: 's3',
					prefix: pathParts.join('/')
				};
			}

			// Path-style: s3.<region>.amazonaws.com/<bucket>
			const awsPath = host.match(/^s3[.-]([a-z0-9-]+)\.amazonaws\.com$/);
			if (awsPath && pathParts.length > 0) {
				return {
					bucket: pathParts[0],
					region: awsPath[1],
					endpoint: '',
					provider: 's3',
					prefix: pathParts.slice(1).join('/')
				};
			}

			// Global: s3.amazonaws.com/<bucket>
			if (host === 's3.amazonaws.com' && pathParts.length > 0) {
				return {
					bucket: pathParts[0],
					region: defaults.region || 'us-east-1',
					endpoint: '',
					provider: 's3',
					prefix: pathParts.slice(1).join('/')
				};
			}

			// --- Cloudflare R2 ---
			// <account>.r2.cloudflarestorage.com/<bucket>
			const r2Match = host.match(/^([a-z0-9]+)\.r2\.cloudflarestorage\.com$/);
			if (r2Match && pathParts.length > 0) {
				return {
					bucket: pathParts[0],
					region: 'auto',
					endpoint: `${url.protocol}//${url.host}`,
					provider: 'r2',
					prefix: pathParts.slice(1).join('/')
				};
			}

			// --- Google Cloud Storage ---
			// storage.googleapis.com/<bucket>
			if (host === 'storage.googleapis.com' && pathParts.length > 0) {
				return {
					bucket: pathParts[0],
					region: defaults.region || 'us',
					endpoint: '',
					provider: 'gcs',
					prefix: pathParts.slice(1).join('/')
				};
			}

			// <bucket>.storage.googleapis.com
			const gcsVhost = host.match(/^(.+)\.storage\.googleapis\.com$/);
			if (gcsVhost) {
				return {
					bucket: gcsVhost[1],
					region: defaults.region || 'us',
					endpoint: '',
					provider: 'gcs',
					prefix: pathParts.join('/')
				};
			}

			// --- DigitalOcean Spaces ---
			// <bucket>.<region>.digitaloceanspaces.com
			const doVhost = host.match(/^(.+)\.([a-z0-9-]+)\.digitaloceanspaces\.com$/);
			if (doVhost) {
				return {
					bucket: doVhost[1],
					region: doVhost[2],
					endpoint: `${url.protocol}//${doVhost[2]}.digitaloceanspaces.com`,
					provider: 's3',
					prefix: pathParts.join('/')
				};
			}

			// <region>.digitaloceanspaces.com/<bucket>
			const doPath = host.match(/^([a-z0-9-]+)\.digitaloceanspaces\.com$/);
			if (doPath && pathParts.length > 0) {
				return {
					bucket: pathParts[0],
					region: doPath[1],
					endpoint: `${url.protocol}//${url.host}`,
					provider: 's3',
					prefix: pathParts.slice(1).join('/')
				};
			}

			// --- Wasabi ---
			// s3.<region>.wasabisys.com/<bucket>
			const wasabiMatch = host.match(/^s3\.([a-z0-9-]+)\.wasabisys\.com$/);
			if (wasabiMatch && pathParts.length > 0) {
				return {
					bucket: pathParts[0],
					region: wasabiMatch[1],
					endpoint: `${url.protocol}//${url.host}`,
					provider: 's3',
					prefix: pathParts.slice(1).join('/')
				};
			}

			// --- Backblaze B2 ---
			// <bucket>.s3.<region>.backblazeb2.com (S3-compatible)
			const b2S3 = host.match(/^(.+)\.s3\.([a-z0-9-]+)\.backblazeb2\.com$/);
			if (b2S3) {
				return {
					bucket: b2S3[1],
					region: b2S3[2],
					endpoint: `${url.protocol}//s3.${b2S3[2]}.backblazeb2.com`,
					provider: 's3',
					prefix: pathParts.join('/')
				};
			}

			// f<id>.backblazeb2.com/file/<bucket>
			const b2Native = host.match(/^f[a-z0-9]+\.backblazeb2\.com$/);
			if (b2Native && pathParts[0] === 'file' && pathParts.length > 1) {
				return {
					bucket: pathParts[1],
					region: defaults.region || 'us-west-000',
					endpoint: `${url.protocol}//${url.host}`,
					provider: 's3',
					prefix: pathParts.slice(2).join('/')
				};
			}

			// --- Alibaba Cloud OSS ---
			// <bucket>.oss-<region>.aliyuncs.com
			const ossMatch = host.match(/^(.+)\.(oss-[a-z0-9-]+)\.aliyuncs\.com$/);
			if (ossMatch) {
				return {
					bucket: ossMatch[1],
					region: ossMatch[2],
					endpoint: `${url.protocol}//${ossMatch[2]}.aliyuncs.com`,
					provider: 's3',
					prefix: pathParts.join('/')
				};
			}

			// --- Tencent Cloud COS ---
			// <bucket>.cos.<region>.myqcloud.com
			const cosMatch = host.match(/^(.+)\.cos\.([a-z0-9-]+)\.myqcloud\.com$/);
			if (cosMatch) {
				return {
					bucket: cosMatch[1],
					region: cosMatch[2],
					endpoint: `${url.protocol}//cos.${cosMatch[2]}.myqcloud.com`,
					provider: 's3',
					prefix: pathParts.join('/')
				};
			}

			// --- Yandex Cloud ---
			// storage.yandexcloud.net/<bucket>
			if (host === 'storage.yandexcloud.net' && pathParts.length > 0) {
				return {
					bucket: pathParts[0],
					region: defaults.region || 'ru-central1',
					endpoint: `${url.protocol}//${url.host}`,
					provider: 's3',
					prefix: pathParts.slice(1).join('/')
				};
			}

			// --- MinIO ---
			// Common patterns: minio.<domain>, localhost with port
			const isMinioLike =
				host.includes('minio') ||
				host === 'localhost' ||
				host === '127.0.0.1' ||
				host.startsWith('192.168.') ||
				host.startsWith('10.');
			if (isMinioLike && pathParts.length > 0) {
				return {
					bucket: pathParts[0],
					region: defaults.region || 'us-east-1',
					endpoint: `${url.protocol}//${url.host}`,
					provider: 'minio',
					prefix: pathParts.slice(1).join('/')
				};
			}

			// --- Azure Blob Storage ---
			// <account>.blob.core.windows.net/<container>
			const azureBlob = host.match(/^([a-z0-9]+)\.blob\.core\.windows\.net$/);
			if (azureBlob && pathParts.length > 0) {
				return {
					bucket: pathParts[0],
					region: defaults.region || '',
					endpoint: `${url.protocol}//${url.host}`,
					provider: 'azure',
					prefix: pathParts.slice(1).join('/')
				};
			}

			// --- Storj ---
			// S3 gateway: gateway.storjshare.io/<bucket> (or gateway.<region>.storjshare.io)
			const storjGateway = host.match(/^gateway\.(?:([a-z0-9]+)\.)?storjshare\.io$/);
			if (storjGateway && pathParts.length > 0) {
				return {
					bucket: pathParts[0],
					region: storjGateway[1] || defaults.region || 'us1',
					endpoint: `${url.protocol}//${url.host}`,
					provider: 'storj',
					prefix: pathParts.slice(1).join('/')
				};
			}

			// Linksharing: link.storjshare.io/raw/<access>/<bucket>/... or /s/<access>/<bucket>/...
			const storjLink = host.match(/^link\.(?:([a-z0-9]+)\.)?storjshare\.io$/);
			if (storjLink && pathParts.length >= 3 && (pathParts[0] === 'raw' || pathParts[0] === 's')) {
				return {
					bucket: pathParts[2],
					region: storjLink[1] || defaults.region || 'us1',
					endpoint: `${url.protocol}//${url.host}/${pathParts[0]}/${pathParts[1]}`,
					provider: 'storj',
					prefix: pathParts.slice(3).join('/')
				};
			}

			// --- Generic custom endpoint with bucket in path ---
			if (pathParts.length > 0) {
				const endpoint = `${url.protocol}//${url.host}`;
				return {
					bucket: pathParts[0],
					region: defaults.region || 'us-east-1',
					endpoint,
					provider: defaults.provider || 's3',
					prefix: pathParts.slice(1).join('/')
				};
			}

			// Just a host, no path — treat as endpoint with no bucket
			return {
				...defaultResult(defaults),
				endpoint: `${url.protocol}//${url.host}`
			};
		} catch {
			// Not a valid URL, fall through to plain bucket name
		}
	}

	// ── Plain bucket name (no protocol) ─────────────────────────────
	const cleaned = trimmed.replace(/^\/+|\/+$/g, '');
	return {
		bucket: cleaned,
		region: defaults.region || 'us-east-1',
		endpoint: defaults.endpoint || '',
		provider: defaults.provider || 's3',
		prefix: ''
	};
}

/**
 * Returns true if the input looks like a URL/URI rather than a plain bucket name.
 * Covers all recognized cloud storage URI schemes.
 */
export function looksLikeUrl(input: string): boolean {
	const lower = input.trim().toLowerCase();
	if (lower.startsWith('http://') || lower.startsWith('https://')) return true;
	for (const scheme of Object.keys(SCHEME_MAP)) {
		if (lower.startsWith(scheme)) return true;
	}
	return false;
}

/**
 * Given a parsed URL result, build a human-readable summary of what was detected.
 */
export function describeParseResult(parsed: ParsedStorageUrl): string {
	const parts: string[] = [];
	if (parsed.bucket) parts.push(`bucket="${parsed.bucket}"`);
	if (parsed.endpoint) parts.push(`endpoint="${parsed.endpoint}"`);
	if (parsed.region && parsed.region !== 'us-east-1') parts.push(`region="${parsed.region}"`);
	if (parsed.provider !== 's3') parts.push(`provider=${parsed.provider}`);
	if (parsed.prefix) parts.push(`prefix="${parsed.prefix}"`);
	return parts.length > 0 ? `Detected: ${parts.join(', ')}` : '';
}
