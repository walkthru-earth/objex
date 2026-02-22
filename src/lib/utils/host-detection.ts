/**
 * Auto-detect hosting bucket from URL search params and window.location.
 *
 * Detection priority:
 * 1. `?url=<storage-url>` query parameter (highest priority)
 * 2. `window.location.hostname` pattern matching (fallback)
 *
 * Also extracts `rootPrefix` when the app is hosted inside a subfolder.
 */

import type { StorageProvider } from './storage-url.js';
import { parseStorageUrl } from './storage-url.js';

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
function buildBucketUrl(provider: StorageProvider, endpoint: string, bucket: string): string {
	if (endpoint) {
		return `${endpoint.replace(/\/$/, '')}/${bucket}`;
	}
	switch (provider) {
		case 'gcs':
			return `https://storage.googleapis.com/${bucket}`;
		case 'azure':
			return `${endpoint}/${bucket}`;
		case 'storj':
			return `https://gateway.storjshare.io/${bucket}`;
		default:
			return `https://s3.us-east-1.amazonaws.com/${bucket}`;
	}
}

/**
 * Detect hosting bucket from current URL.
 * Returns null when no hosting bucket can be determined.
 */
export function detectHostBucket(): DetectedHost | null {
	if (typeof window === 'undefined') return null;

	const url = new URL(window.location.href);
	const host = url.hostname;

	// --- Priority 1: ?url= query parameter ---
	const urlParam = url.searchParams.get('url');
	if (urlParam) {
		const parsed = parseStorageUrl(urlParam);
		if (parsed.bucket) {
			return {
				provider: parsed.provider === 'unknown' ? 's3' : parsed.provider,
				bucket: parsed.bucket,
				region: parsed.region,
				endpoint: parsed.endpoint,
				rootPrefix: '',
				bucketUrl: buildBucketUrl(parsed.provider, parsed.endpoint, parsed.bucket)
			};
		}
	}

	// --- Priority 2: Hostname pattern matching ---
	const pathname = url.pathname;

	// AWS S3 virtual-hosted: <bucket>.s3.<region>.amazonaws.com
	const awsVhost = host.match(/^(.+)\.s3[.-]([a-z0-9-]+)\.amazonaws\.com$/);
	if (awsVhost) {
		return {
			provider: 's3',
			bucket: awsVhost[1],
			region: awsVhost[2],
			endpoint: '',
			rootPrefix: extractRootPrefix(pathname),
			bucketUrl: `https://s3.${awsVhost[2]}.amazonaws.com/${awsVhost[1]}`
		};
	}

	// AWS S3 website hosting: <bucket>.s3-website-<region>.amazonaws.com or <bucket>.s3-website.<region>.amazonaws.com
	const awsWebsite = host.match(/^(.+)\.s3-website[.-]([a-z0-9-]+)\.amazonaws\.com$/);
	if (awsWebsite) {
		return {
			provider: 's3',
			bucket: awsWebsite[1],
			region: awsWebsite[2],
			endpoint: '',
			rootPrefix: extractRootPrefix(pathname),
			bucketUrl: `https://s3.${awsWebsite[2]}.amazonaws.com/${awsWebsite[1]}`
		};
	}

	// AWS S3 path-style: s3.<region>.amazonaws.com/<bucket>
	const awsPath = host.match(/^s3[.-]([a-z0-9-]+)\.amazonaws\.com$/);
	if (awsPath) {
		const parts = pathname.replace(/^\//, '').split('/').filter(Boolean);
		if (parts.length > 0) {
			return {
				provider: 's3',
				bucket: parts[0],
				region: awsPath[1],
				endpoint: '',
				rootPrefix: parts.length > 1 ? extractRootPrefix(`/${parts.slice(1).join('/')}`) : '',
				bucketUrl: `https://s3.${awsPath[1]}.amazonaws.com/${parts[0]}`
			};
		}
	}

	// GCS: storage.googleapis.com/<bucket>
	if (host === 'storage.googleapis.com') {
		const parts = pathname.replace(/^\//, '').split('/').filter(Boolean);
		if (parts.length > 0) {
			return {
				provider: 'gcs',
				bucket: parts[0],
				region: 'us',
				endpoint: '',
				rootPrefix: parts.length > 1 ? extractRootPrefix(`/${parts.slice(1).join('/')}`) : '',
				bucketUrl: `https://storage.googleapis.com/${parts[0]}`
			};
		}
	}

	// GCS virtual-hosted: <bucket>.storage.googleapis.com
	const gcsVhost = host.match(/^(.+)\.storage\.googleapis\.com$/);
	if (gcsVhost) {
		return {
			provider: 'gcs',
			bucket: gcsVhost[1],
			region: 'us',
			endpoint: '',
			rootPrefix: extractRootPrefix(pathname),
			bucketUrl: `https://storage.googleapis.com/${gcsVhost[1]}`
		};
	}

	// Azure Static Website: <account>.z<N>.web.core.windows.net
	const azureWeb = host.match(/^([a-z0-9]+)\.z\d+\.web\.core\.windows\.net$/);
	if (azureWeb) {
		return {
			provider: 'azure',
			bucket: '$web',
			region: '',
			endpoint: `https://${azureWeb[1]}.blob.core.windows.net`,
			rootPrefix: extractRootPrefix(pathname),
			bucketUrl: `https://${azureWeb[1]}.blob.core.windows.net/$web`
		};
	}

	// Azure Blob: <account>.blob.core.windows.net/<container>
	const azureBlob = host.match(/^([a-z0-9]+)\.blob\.core\.windows\.net$/);
	if (azureBlob) {
		const parts = pathname.replace(/^\//, '').split('/').filter(Boolean);
		if (parts.length > 0) {
			return {
				provider: 'azure',
				bucket: parts[0],
				region: '',
				endpoint: `https://${host}`,
				rootPrefix: parts.length > 1 ? extractRootPrefix(`/${parts.slice(1).join('/')}`) : '',
				bucketUrl: `https://${host}/${parts[0]}`
			};
		}
	}

	// R2 public: pub-<id>.r2.dev
	const r2Public = host.match(/^(pub-[a-z0-9]+)\.r2\.dev$/);
	if (r2Public) {
		const parts = pathname.replace(/^\//, '').split('/').filter(Boolean);
		return {
			provider: 'r2',
			bucket: parts[0] || r2Public[1],
			region: 'auto',
			endpoint: `https://${host}`,
			rootPrefix: parts.length > 1 ? extractRootPrefix(`/${parts.slice(1).join('/')}`) : '',
			bucketUrl: `https://${host}`
		};
	}

	// DigitalOcean Spaces: <bucket>.<region>.digitaloceanspaces.com
	const doSpaces = host.match(/^(.+)\.([a-z0-9-]+)\.digitaloceanspaces\.com$/);
	if (doSpaces) {
		return {
			provider: 's3',
			bucket: doSpaces[1],
			region: doSpaces[2],
			endpoint: `https://${doSpaces[2]}.digitaloceanspaces.com`,
			rootPrefix: extractRootPrefix(pathname),
			bucketUrl: `https://${doSpaces[2]}.digitaloceanspaces.com/${doSpaces[1]}`
		};
	}

	// DigitalOcean Spaces CDN: <bucket>.<region>.cdn.digitaloceanspaces.com
	const doCdn = host.match(/^(.+)\.([a-z0-9-]+)\.cdn\.digitaloceanspaces\.com$/);
	if (doCdn) {
		return {
			provider: 's3',
			bucket: doCdn[1],
			region: doCdn[2],
			endpoint: `https://${doCdn[2]}.digitaloceanspaces.com`,
			rootPrefix: extractRootPrefix(pathname),
			bucketUrl: `https://${doCdn[2]}.digitaloceanspaces.com/${doCdn[1]}`
		};
	}

	// Wasabi: s3.<region>.wasabisys.com/<bucket>
	const wasabi = host.match(/^s3\.([a-z0-9-]+)\.wasabisys\.com$/);
	if (wasabi) {
		const parts = pathname.replace(/^\//, '').split('/').filter(Boolean);
		if (parts.length > 0) {
			return {
				provider: 's3',
				bucket: parts[0],
				region: wasabi[1],
				endpoint: `https://${host}`,
				rootPrefix: parts.length > 1 ? extractRootPrefix(`/${parts.slice(1).join('/')}`) : '',
				bucketUrl: `https://${host}/${parts[0]}`
			};
		}
	}

	// B2 S3: <bucket>.s3.<region>.backblazeb2.com
	const b2s3 = host.match(/^(.+)\.s3\.([a-z0-9-]+)\.backblazeb2\.com$/);
	if (b2s3) {
		return {
			provider: 's3',
			bucket: b2s3[1],
			region: b2s3[2],
			endpoint: `https://s3.${b2s3[2]}.backblazeb2.com`,
			rootPrefix: extractRootPrefix(pathname),
			bucketUrl: `https://s3.${b2s3[2]}.backblazeb2.com/${b2s3[1]}`
		};
	}

	// IBM COS: <bucket>.s3-web.<region>.cloud-object-storage.appdomain.cloud
	const ibmCos = host.match(/^(.+)\.s3-web\.([a-z0-9-]+)\.cloud-object-storage\.appdomain\.cloud$/);
	if (ibmCos) {
		return {
			provider: 's3',
			bucket: ibmCos[1],
			region: ibmCos[2],
			endpoint: `https://s3.${ibmCos[2]}.cloud-object-storage.appdomain.cloud`,
			rootPrefix: extractRootPrefix(pathname),
			bucketUrl: `https://s3.${ibmCos[2]}.cloud-object-storage.appdomain.cloud/${ibmCos[1]}`
		};
	}

	// Storj S3 gateway: gateway.storjshare.io/<bucket> (or gateway.<region>.storjshare.io)
	const storjGateway = host.match(/^gateway\.(?:([a-z0-9]+)\.)?storjshare\.io$/);
	if (storjGateway) {
		const parts = pathname.replace(/^\//, '').split('/').filter(Boolean);
		if (parts.length > 0) {
			return {
				provider: 'storj',
				bucket: parts[0],
				region: storjGateway[1] || 'us1',
				endpoint: `${url.protocol}//${url.host}`,
				rootPrefix: parts.length > 1 ? extractRootPrefix(`/${parts.slice(1).join('/')}`) : '',
				bucketUrl: `${url.protocol}//${url.host}/${parts[0]}`
			};
		}
	}

	// Storj linksharing: link.storjshare.io/raw/<access>/<bucket>/...
	const storjLink = host.match(/^link\.(?:([a-z0-9]+)\.)?storjshare\.io$/);
	if (storjLink) {
		const parts = pathname.replace(/^\//, '').split('/').filter(Boolean);
		if (parts.length >= 3 && (parts[0] === 'raw' || parts[0] === 's')) {
			return {
				provider: 'storj',
				bucket: parts[2],
				region: storjLink[1] || 'us1',
				endpoint: `${url.protocol}//${url.host}/${parts[0]}/${parts[1]}`,
				rootPrefix: parts.length > 3 ? extractRootPrefix(`/${parts.slice(3).join('/')}`) : '',
				bucketUrl: `${url.protocol}//${url.host}/${parts[0]}/${parts[1]}/${parts[2]}`
			};
		}
	}

	// MinIO / localhost / private IPs
	const isLocal =
		host === 'localhost' ||
		host === '127.0.0.1' ||
		host.startsWith('192.168.') ||
		host.startsWith('10.');
	if (isLocal) {
		const parts = pathname.replace(/^\//, '').split('/').filter(Boolean);
		if (parts.length > 0) {
			return {
				provider: 'minio',
				bucket: parts[0],
				region: 'us-east-1',
				endpoint: `${url.protocol}//${url.host}`,
				rootPrefix: parts.length > 1 ? extractRootPrefix(`/${parts.slice(1).join('/')}`) : '',
				bucketUrl: `${url.protocol}//${url.host}/${parts[0]}`
			};
		}
	}

	return null;
}
