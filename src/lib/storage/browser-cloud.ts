import { AwsClient } from 'aws4fetch';
import { connectionStore } from '$lib/stores/connections.svelte.js';
import { credentialStore } from '$lib/stores/credentials.svelte.js';
import type { Connection, FileEntry, WriteResult } from '$lib/types.js';
import type { ListPage, StorageAdapter } from './adapter.js';

// --- Helpers ---

/** Extract the last path segment from an object key. */
function nameFromKey(key: string): string {
	const trimmed = key.replace(/\/$/, '');
	const segments = trimmed.split('/');
	return segments[segments.length - 1] || trimmed;
}

/** Extract a file extension from a name, or return an empty string. */
function extensionFromName(name: string): string {
	const dot = name.lastIndexOf('.');
	if (dot < 1) return '';
	return name.slice(dot + 1).toLowerCase();
}

/**
 * Build the base URL for S3-compatible API requests.
 * Uses path-style addressing (safer for buckets with dots in names).
 */
function buildBaseUrl(conn: Connection): string {
	if (conn.endpoint) {
		const base = conn.endpoint.replace(/\/$/, '');
		return `${base}/${conn.bucket}`;
	}
	// Default AWS S3 — path-style
	return `https://s3.${conn.region}.amazonaws.com/${conn.bucket}`;
}

/** Decode a possibly percent-encoded S3 key (some providers URL-encode non-ASCII in XML). */
function decodeKey(key: string): string {
	try {
		return decodeURIComponent(key);
	} catch {
		return key;
	}
}

/** Encode an object key for use in a URL path, preserving `/` separators. */
function encodeKey(key: string): string {
	return key
		.split('/')
		.map((s) => encodeURIComponent(s))
		.join('/');
}

/**
 * Create a fetch function that signs requests with SigV4 when credentials
 * are available, or falls back to plain fetch for anonymous access.
 */
function createFetcher(conn: Connection): (url: string, init?: RequestInit) => Promise<Response> {
	if (conn.anonymous) {
		return (url, init) => fetch(url, init);
	}

	const creds = credentialStore.get(conn.id);
	if (!creds || creds.type !== 'sigv4') {
		throw new Error(
			`No credentials found for connection "${conn.name}". ` +
				'Provide access key and secret key, or enable anonymous access.'
		);
	}

	const client = new AwsClient({
		accessKeyId: creds.accessKey,
		secretAccessKey: creds.secretKey,
		service: 's3',
		region: conn.region
	});

	return (url, init) => client.fetch(url, init);
}

// --- Adapter ---

/**
 * Browser-based cloud storage adapter (S3-compatible).
 *
 * Supports S3, R2, GCS, Storj, MinIO, DigitalOcean Spaces, Wasabi, and other
 * S3-compatible providers.
 *
 * - Anonymous connections use plain `fetch()`.
 * - Authenticated connections use `aws4fetch` for SigV4 request signing.
 * - Requires CORS to be enabled on the target bucket.
 */
export class BrowserCloudAdapter implements StorageAdapter {
	private connectionId: string;

	constructor(connectionId: string) {
		this.connectionId = connectionId;
	}

	get supportsWrite(): boolean {
		const conn = connectionStore.getById(this.connectionId);
		return !!conn && !conn.anonymous;
	}

	private getConnection(): Connection {
		const conn = connectionStore.getById(this.connectionId);
		if (!conn) throw new Error(`Connection not found: ${this.connectionId}`);
		return conn;
	}

	async listPage(path: string, continuationToken?: string, pageSize?: number): Promise<ListPage> {
		const conn = this.getConnection();
		const baseUrl = buildBaseUrl(conn);
		const cloudFetch = createFetcher(conn);

		const params = new URLSearchParams({
			'list-type': '2',
			delimiter: '/'
		});
		if (path) params.set('prefix', path);
		if (continuationToken) params.set('continuation-token', continuationToken);
		if (pageSize) params.set('max-keys', String(pageSize));

		const res = await cloudFetch(`${baseUrl}?${params}`);
		if (!res.ok) {
			const body = await res.text().catch(() => '');
			throw new Error(`List failed (${res.status}): ${body || res.statusText}`);
		}

		const xml = await res.text();
		const doc = new DOMParser().parseFromString(xml, 'application/xml');

		const entries: FileEntry[] = [];

		// Parse <CommonPrefixes> (directories)
		for (const cp of doc.querySelectorAll('CommonPrefixes')) {
			const prefix = cp.querySelector('Prefix')?.textContent ?? '';
			if (!prefix) continue;
			const dirName = nameFromKey(prefix);
			entries.push({
				name: decodeKey(dirName),
				path: prefix,
				is_dir: true,
				size: 0,
				modified: 0,
				extension: dirName.endsWith('.zarr') || dirName.endsWith('.zr3') ? 'zarr' : ''
			});
		}

		// Parse <Contents> (files)
		for (const item of doc.querySelectorAll('Contents')) {
			const key = item.querySelector('Key')?.textContent ?? '';
			if (!key || key === path || key.endsWith('/')) continue;
			const name = decodeKey(nameFromKey(key));
			const size = parseInt(item.querySelector('Size')?.textContent ?? '0', 10);
			const lastMod = item.querySelector('LastModified')?.textContent ?? '';
			entries.push({
				name,
				path: key,
				is_dir: false,
				size,
				modified: lastMod ? Date.parse(lastMod) || 0 : 0,
				extension: extensionFromName(name)
			});
		}

		const isTruncated = doc.querySelector('IsTruncated')?.textContent === 'true';
		const nextToken = isTruncated
			? (doc.querySelector('NextContinuationToken')?.textContent ?? undefined)
			: undefined;

		return { entries, continuationToken: nextToken, hasMore: !!nextToken };
	}

	async list(path: string): Promise<FileEntry[]> {
		const all: FileEntry[] = [];
		let token: string | undefined;
		do {
			const page = await this.listPage(path, token);
			all.push(...page.entries);
			token = page.continuationToken;
		} while (token);
		return all;
	}

	async read(path: string, offset?: number, length?: number): Promise<Uint8Array> {
		const conn = this.getConnection();
		const url = `${buildBaseUrl(conn)}/${encodeKey(path)}`;
		const cloudFetch = createFetcher(conn);

		const headers: Record<string, string> = {};
		if (offset !== undefined || length !== undefined) {
			const start = offset ?? 0;
			const end = length !== undefined ? start + length - 1 : '';
			headers.Range = `bytes=${start}-${end}`;
		}

		const res = await cloudFetch(url, { headers });
		if (!res.ok && res.status !== 206) {
			throw new Error(`Fetch failed (${res.status}): ${res.statusText}`);
		}

		return new Uint8Array(await res.arrayBuffer());
	}

	async head(path: string): Promise<FileEntry> {
		const conn = this.getConnection();
		const url = `${buildBaseUrl(conn)}/${encodeKey(path)}`;
		const cloudFetch = createFetcher(conn);

		const res = await cloudFetch(url, { method: 'HEAD' });
		if (!res.ok) {
			throw new Error(`Head failed (${res.status}): ${res.statusText}`);
		}

		const name = nameFromKey(path);
		const size = parseInt(res.headers.get('content-length') ?? '0', 10);
		const lastMod = res.headers.get('last-modified');

		return {
			name,
			path,
			is_dir: false,
			size,
			modified: lastMod ? Date.parse(lastMod) || 0 : 0,
			extension: extensionFromName(name)
		};
	}

	async put(key: string, data: Uint8Array, contentType?: string): Promise<WriteResult> {
		const conn = this.getConnection();
		const url = `${buildBaseUrl(conn)}/${encodeKey(key)}`;
		const cloudFetch = createFetcher(conn);

		const headers: Record<string, string> = {};
		if (contentType) headers['Content-Type'] = contentType;

		const res = await cloudFetch(url, { method: 'PUT', body: data.buffer as ArrayBuffer, headers });
		if (!res.ok) {
			const body = await res.text().catch(() => '');
			throw new Error(`Upload failed (${res.status}): ${body || res.statusText}`);
		}

		return {
			key,
			size: data.byteLength,
			e_tag: res.headers.get('etag') ?? undefined
		};
	}

	async delete(key: string): Promise<void> {
		const conn = this.getConnection();
		const url = `${buildBaseUrl(conn)}/${encodeKey(key)}`;
		const cloudFetch = createFetcher(conn);

		const res = await cloudFetch(url, { method: 'DELETE' });
		if (!res.ok && res.status !== 204) {
			throw new Error(`Delete failed (${res.status}): ${res.statusText}`);
		}
	}

	async deletePrefix(prefix: string): Promise<{ deleted: number }> {
		if (!prefix) {
			throw new Error('Cannot delete with empty prefix — this would delete the entire bucket.');
		}

		// List all objects under prefix (no delimiter → recursive)
		const conn = this.getConnection();
		const baseUrl = buildBaseUrl(conn);
		const cloudFetch = createFetcher(conn);

		const keys: string[] = [];
		let continuationToken: string | undefined;

		do {
			const params = new URLSearchParams({ 'list-type': '2' });
			if (prefix) params.set('prefix', prefix);
			if (continuationToken) params.set('continuation-token', continuationToken);

			const res = await cloudFetch(`${baseUrl}?${params}`);
			if (!res.ok) throw new Error(`List failed (${res.status}): ${res.statusText}`);

			const xml = await res.text();
			const doc = new DOMParser().parseFromString(xml, 'application/xml');

			for (const item of doc.querySelectorAll('Contents')) {
				const key = item.querySelector('Key')?.textContent;
				if (key) keys.push(key);
			}

			const isTruncated = doc.querySelector('IsTruncated')?.textContent === 'true';
			continuationToken = isTruncated
				? (doc.querySelector('NextContinuationToken')?.textContent ?? undefined)
				: undefined;
		} while (continuationToken);

		for (const key of keys) {
			await this.delete(key);
		}

		return { deleted: keys.length };
	}

	async copy(srcKey: string, destKey: string): Promise<WriteResult> {
		const conn = this.getConnection();
		const url = `${buildBaseUrl(conn)}/${encodeKey(destKey)}`;
		const cloudFetch = createFetcher(conn);

		const res = await cloudFetch(url, {
			method: 'PUT',
			headers: {
				'x-amz-copy-source': `/${conn.bucket}/${encodeKey(srcKey)}`
			}
		});

		if (!res.ok) {
			const body = await res.text().catch(() => '');
			throw new Error(`Copy failed (${res.status}): ${body || res.statusText}`);
		}

		return {
			key: destKey,
			size: 0,
			e_tag: res.headers.get('etag') ?? undefined
		};
	}
}
