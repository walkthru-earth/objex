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

import { PROVIDERS } from '../../../src/lib/storage/providers.js';

export type StorageProvider = string;

export interface ParsedStorageUrl {
	bucket: string;
	region: string;
	endpoint: string;
	provider: StorageProvider;
	/** Original prefix/path after bucket, if any */
	prefix: string;
}

/**
 * Build SCHEME_MAP from the provider registry's `schemes` arrays.
 * Each scheme like "s3" generates an entry `"s3://": { provider: "s3", strip: 5 }`.
 */
function buildSchemeMap(): Record<string, { provider: StorageProvider; strip: number }> {
	const map: Record<string, { provider: StorageProvider; strip: number }> = {};
	for (const [id, def] of Object.entries(PROVIDERS)) {
		for (const scheme of def.schemes) {
			const key = `${scheme}://`;
			map[key] = { provider: id, strip: key.length };
		}
	}
	// Non-registry schemes (no corresponding provider)
	map['swift://'] = { provider: 'unknown', strip: 8 };
	return map;
}

/** All recognized URI scheme prefixes (lowercase), derived from provider registry */
const SCHEME_MAP = buildSchemeMap();

/**
 * Shared host matchers. Used by both `parseStorageUrl` and `isKnownBucketHost`
 * so provider recognition has a single source of truth.
 */
const AWS_VHOST_RE = /^(.+)\.s3[.-]([a-z0-9-]+)\.amazonaws\.com$/;
const AWS_PATH_RE = /^s3[.-]([a-z0-9-]+)\.amazonaws\.com$/;
const AWS_GLOBAL_HOST = 's3.amazonaws.com';
const R2_RE = /^([a-z0-9]+)\.r2\.cloudflarestorage\.com$/;
const GCS_GLOBAL_HOST = 'storage.googleapis.com';
const GCS_VHOST_RE = /^(.+)\.storage\.googleapis\.com$/;
const DO_VHOST_RE = /^(.+)\.([a-z0-9-]+)\.digitaloceanspaces\.com$/;
const DO_PATH_RE = /^([a-z0-9-]+)\.digitaloceanspaces\.com$/;
const WASABI_RE = /^s3\.([a-z0-9-]+)\.wasabisys\.com$/;
const B2_S3_RE = /^(.+)\.s3\.([a-z0-9-]+)\.backblazeb2\.com$/;
const B2_NATIVE_RE = /^f[a-z0-9]+\.backblazeb2\.com$/;
const OSS_RE = /^(.+)\.(oss-[a-z0-9-]+)\.aliyuncs\.com$/;
const COS_RE = /^(.+)\.cos\.([a-z0-9-]+)\.myqcloud\.com$/;
const YANDEX_HOST = 'storage.yandexcloud.net';
const CONTABO_RE = /^([a-z0-9]+)\.contabostorage\.com$/;
const HETZNER_RE = /^([a-z0-9]+)\.your-objectstorage\.com$/;
const LINODE_VHOST_RE = /^(.+)\.([a-z0-9-]+)\.linodeobjects\.com$/;
const LINODE_PATH_RE = /^([a-z0-9-]+)\.linodeobjects\.com$/;
const OVH_RE = /^s3\.([a-z0-9-]+)\.io\.cloud\.ovh\.(?:net|us)$/;
const AZURE_BLOB_RE = /^([a-z0-9]+)\.blob\.core\.windows\.net$/;
const STORJ_GATEWAY_RE = /^gateway\.(?:([a-z0-9]+)\.)?storjshare\.io$/;
const STORJ_LINK_RE = /^link\.(?:([a-z0-9]+)\.)?storjshare\.io$/;

function isMinioLikeHost(host: string): boolean {
	return (
		host.includes('minio') ||
		host === 'localhost' ||
		host === '127.0.0.1' ||
		host.startsWith('192.168.') ||
		host.startsWith('10.')
	);
}

/** STAC API path test, one source of truth. Tests pathname only. */
export const STAC_API_PATH_RE = /\/(collections|items|catalogs|search)(\/|\?|$)/i;

/**
 * Returns true when the host matches any of the provider host patterns
 * that `parseStorageUrl` recognizes on the HTTPS branch.
 */
export function isKnownBucketHost(host: string): boolean {
	if (!host) return false;
	if (AWS_VHOST_RE.test(host)) return true;
	if (AWS_PATH_RE.test(host)) return true;
	if (host === AWS_GLOBAL_HOST) return true;
	if (R2_RE.test(host)) return true;
	if (host === GCS_GLOBAL_HOST) return true;
	if (GCS_VHOST_RE.test(host)) return true;
	if (DO_VHOST_RE.test(host)) return true;
	if (DO_PATH_RE.test(host)) return true;
	if (WASABI_RE.test(host)) return true;
	if (B2_S3_RE.test(host)) return true;
	if (B2_NATIVE_RE.test(host)) return true;
	if (OSS_RE.test(host)) return true;
	if (COS_RE.test(host)) return true;
	if (host === YANDEX_HOST) return true;
	if (CONTABO_RE.test(host)) return true;
	if (HETZNER_RE.test(host)) return true;
	if (LINODE_VHOST_RE.test(host)) return true;
	if (LINODE_PATH_RE.test(host)) return true;
	if (OVH_RE.test(host)) return true;
	if (AZURE_BLOB_RE.test(host)) return true;
	if (STORJ_GATEWAY_RE.test(host)) return true;
	if (STORJ_LINK_RE.test(host)) return true;
	if (isMinioLikeHost(host)) return true;
	return false;
}

export interface Defaults {
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
			const awsVhost = host.match(AWS_VHOST_RE);
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
			const awsPath = host.match(AWS_PATH_RE);
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
			if (host === AWS_GLOBAL_HOST && pathParts.length > 0) {
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
			const r2Match = host.match(R2_RE);
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
			if (host === GCS_GLOBAL_HOST && pathParts.length > 0) {
				return {
					bucket: pathParts[0],
					region: defaults.region || 'us',
					endpoint: '',
					provider: 'gcs',
					prefix: pathParts.slice(1).join('/')
				};
			}

			// <bucket>.storage.googleapis.com
			const gcsVhost = host.match(GCS_VHOST_RE);
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
			const doVhost = host.match(DO_VHOST_RE);
			if (doVhost) {
				return {
					bucket: doVhost[1],
					region: doVhost[2],
					endpoint: `${url.protocol}//${doVhost[2]}.digitaloceanspaces.com`,
					provider: 'digitalocean',
					prefix: pathParts.join('/')
				};
			}

			// <region>.digitaloceanspaces.com/<bucket>
			const doPath = host.match(DO_PATH_RE);
			if (doPath && pathParts.length > 0) {
				return {
					bucket: pathParts[0],
					region: doPath[1],
					endpoint: `${url.protocol}//${url.host}`,
					provider: 'digitalocean',
					prefix: pathParts.slice(1).join('/')
				};
			}

			// --- Wasabi ---
			// s3.<region>.wasabisys.com/<bucket>
			const wasabiMatch = host.match(WASABI_RE);
			if (wasabiMatch && pathParts.length > 0) {
				return {
					bucket: pathParts[0],
					region: wasabiMatch[1],
					endpoint: `${url.protocol}//${url.host}`,
					provider: 'wasabi',
					prefix: pathParts.slice(1).join('/')
				};
			}

			// --- Backblaze B2 ---
			// <bucket>.s3.<region>.backblazeb2.com (S3-compatible)
			const b2S3 = host.match(B2_S3_RE);
			if (b2S3) {
				return {
					bucket: b2S3[1],
					region: b2S3[2],
					endpoint: `${url.protocol}//s3.${b2S3[2]}.backblazeb2.com`,
					provider: 'b2',
					prefix: pathParts.join('/')
				};
			}

			// f<id>.backblazeb2.com/file/<bucket>
			const b2Native = host.match(B2_NATIVE_RE);
			if (b2Native && pathParts[0] === 'file' && pathParts.length > 1) {
				return {
					bucket: pathParts[1],
					region: defaults.region || 'us-west-000',
					endpoint: `${url.protocol}//${url.host}`,
					provider: 'b2',
					prefix: pathParts.slice(2).join('/')
				};
			}

			// --- Alibaba Cloud OSS ---
			// <bucket>.oss-<region>.aliyuncs.com
			const ossMatch = host.match(OSS_RE);
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
			const cosMatch = host.match(COS_RE);
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
			if (host === YANDEX_HOST && pathParts.length > 0) {
				return {
					bucket: pathParts[0],
					region: defaults.region || 'ru-central1',
					endpoint: `${url.protocol}//${url.host}`,
					provider: 's3',
					prefix: pathParts.slice(1).join('/')
				};
			}

			// --- Contabo ---
			// <region>.contabostorage.com/<bucket>
			const contaboMatch = host.match(CONTABO_RE);
			if (contaboMatch && pathParts.length > 0) {
				return {
					bucket: pathParts[0],
					region: contaboMatch[1],
					endpoint: `${url.protocol}//${url.host}`,
					provider: 'contabo',
					prefix: pathParts.slice(1).join('/')
				};
			}

			// --- Hetzner ---
			// <region>.your-objectstorage.com/<bucket>
			const hetznerMatch = host.match(HETZNER_RE);
			if (hetznerMatch && pathParts.length > 0) {
				return {
					bucket: pathParts[0],
					region: hetznerMatch[1],
					endpoint: `${url.protocol}//${url.host}`,
					provider: 'hetzner',
					prefix: pathParts.slice(1).join('/')
				};
			}

			// --- Linode / Akamai ---
			// <bucket>.<region>.linodeobjects.com or <region>.linodeobjects.com/<bucket>
			const linodeVhost = host.match(LINODE_VHOST_RE);
			if (linodeVhost) {
				return {
					bucket: linodeVhost[1],
					region: linodeVhost[2],
					endpoint: `${url.protocol}//${linodeVhost[2]}.linodeobjects.com`,
					provider: 'linode',
					prefix: pathParts.join('/')
				};
			}
			const linodePath = host.match(LINODE_PATH_RE);
			if (linodePath && pathParts.length > 0) {
				return {
					bucket: pathParts[0],
					region: linodePath[1],
					endpoint: `${url.protocol}//${url.host}`,
					provider: 'linode',
					prefix: pathParts.slice(1).join('/')
				};
			}

			// --- OVHcloud ---
			// s3.<region>.io.cloud.ovh.net/<bucket>
			const ovhMatch = host.match(OVH_RE);
			if (ovhMatch && pathParts.length > 0) {
				return {
					bucket: pathParts[0],
					region: ovhMatch[1],
					endpoint: `${url.protocol}//${url.host}`,
					provider: 'ovhcloud',
					prefix: pathParts.slice(1).join('/')
				};
			}

			// --- MinIO ---
			// Common patterns: minio.<domain>, localhost with port
			if (isMinioLikeHost(host) && pathParts.length > 0) {
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
			const azureBlob = host.match(AZURE_BLOB_RE);
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
			const storjGateway = host.match(STORJ_GATEWAY_RE);
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
			const storjLink = host.match(STORJ_LINK_RE);
			if (storjLink && pathParts.length >= 3 && (pathParts[0] === 'raw' || pathParts[0] === 's')) {
				return {
					bucket: pathParts[2],
					region: storjLink[1] || defaults.region || 'us1',
					endpoint: `${url.protocol}//${url.host}/${pathParts[0]}/${pathParts[1]}`,
					provider: 'storj',
					prefix: pathParts.slice(3).join('/')
				};
			}

			// --- STAC API endpoints (Element 84, MPC, etc.) ---
			// Paths like /v1/collections/.../items/... are not S3 buckets, the
			// first path segment is an API version, not a bucket name. Return
			// no bucket so detectHostBucket() falls through and the URL opens
			// as a direct remote fetch.
			if (STAC_API_PATH_RE.test(url.pathname)) {
				return {
					...defaultResult(defaults),
					endpoint: `${url.protocol}//${url.host}`
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

export type UrlClassification =
	| { kind: 'scheme'; parsed: ParsedStorageUrl }
	| { kind: 'object-storage'; parsed: ParsedStorageUrl }
	| { kind: 'stac-api'; url: URL }
	| { kind: 'remote-file'; url: URL };

/**
 * Classify a user-supplied URL/URI into one of four buckets. Unparseable or
 * plain inputs fall through to `remote-file` with a best-effort URL parse,
 * returning a synthetic `https://` URL when `new URL()` would throw.
 */
export function classifyUrl(input: string): UrlClassification {
	const trimmed = input.trim();
	const lower = trimmed.toLowerCase();

	for (const scheme of Object.keys(SCHEME_MAP)) {
		if (lower.startsWith(scheme)) {
			return { kind: 'scheme', parsed: parseStorageUrl(trimmed) };
		}
	}

	if (lower.startsWith('http://') || lower.startsWith('https://')) {
		let url: URL;
		try {
			url = new URL(trimmed);
		} catch {
			return {
				kind: 'remote-file',
				url: new URL(`https://${trimmed.replace(/^https?:\/\//i, '')}`)
			};
		}
		const parsed = parseStorageUrl(trimmed);
		if (parsed.bucket && isKnownBucketHost(url.hostname)) {
			return { kind: 'object-storage', parsed };
		}
		if (STAC_API_PATH_RE.test(url.pathname)) {
			return { kind: 'stac-api', url };
		}
		return { kind: 'remote-file', url };
	}

	try {
		return { kind: 'remote-file', url: new URL(trimmed) };
	} catch {
		return { kind: 'remote-file', url: new URL(`https://${trimmed}`) };
	}
}
