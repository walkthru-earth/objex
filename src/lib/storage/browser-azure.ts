import { connectionStore } from '$lib/stores/connections.svelte.js';
import { type AzureCredentials, credentialStore } from '$lib/stores/credentials.svelte.js';
import type { Connection, FileEntry, WriteResult } from '$lib/types.js';
import type { StorageAdapter } from './adapter.js';

// --- Helpers ---

function nameFromKey(key: string): string {
	const trimmed = key.replace(/\/$/, '');
	const segments = trimmed.split('/');
	return segments[segments.length - 1] || trimmed;
}

function extensionFromName(name: string): string {
	const dot = name.lastIndexOf('.');
	if (dot < 1) return '';
	return name.slice(dot + 1).toLowerCase();
}

/**
 * Build the base URL for Azure Blob REST API.
 * Format: https://<account>.blob.core.windows.net/<container>
 */
function buildBaseUrl(conn: Connection): string {
	const base = conn.endpoint.replace(/\/$/, '');
	return `${base}/${conn.bucket}`;
}

function encodeKey(key: string): string {
	return key
		.split('/')
		.map((s) => encodeURIComponent(s))
		.join('/');
}

/**
 * Get the SAS token query string (with leading '?') if credentials exist.
 */
function getSasQuery(conn: Connection): string {
	if (conn.anonymous) return '';
	const creds = credentialStore.get(conn.id);
	if (!creds || creds.type !== 'sas-token') return '';
	const token = (creds as AzureCredentials).sasToken;
	// SAS tokens may or may not start with '?'
	return token.startsWith('?') ? token : `?${token}`;
}

/**
 * Append SAS token to a URL, handling existing query params.
 */
function appendSas(url: string, sasQuery: string): string {
	if (!sasQuery) return url;
	const sep = url.includes('?') ? '&' : '?';
	// Strip leading '?' from sasQuery when appending with '&'
	const token = sasQuery.startsWith('?') ? sasQuery.slice(1) : sasQuery;
	return `${url}${sep}${token}`;
}

// --- Adapter ---

/**
 * Browser-based Azure Blob Storage adapter.
 *
 * - Anonymous access uses plain `fetch()`.
 * - Authenticated access appends SAS token as URL query params.
 * - Requires CORS to be enabled on the storage account.
 */
export class BrowserAzureAdapter implements StorageAdapter {
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

	async list(path: string): Promise<FileEntry[]> {
		const conn = this.getConnection();
		const baseUrl = buildBaseUrl(conn);
		const sas = getSasQuery(conn);

		const entries: FileEntry[] = [];
		let marker: string | undefined;

		do {
			const params = new URLSearchParams({
				restype: 'container',
				comp: 'list',
				delimiter: '/'
			});
			if (path) params.set('prefix', path);
			if (marker) params.set('marker', marker);

			const url = appendSas(`${baseUrl}?${params}`, sas);
			const res = await fetch(url);
			if (!res.ok) {
				const body = await res.text().catch(() => '');
				throw new Error(`Azure list failed (${res.status}): ${body || res.statusText}`);
			}

			const xml = await res.text();
			const doc = new DOMParser().parseFromString(xml, 'application/xml');

			// Parse <BlobPrefix> (directories)
			for (const bp of doc.querySelectorAll('BlobPrefix')) {
				const prefix = bp.querySelector('Name')?.textContent ?? '';
				if (!prefix) continue;
				const dirName = nameFromKey(prefix);
				entries.push({
					name: dirName,
					path: prefix,
					is_dir: true,
					size: 0,
					modified: 0,
					extension: dirName.endsWith('.zarr') ? 'zarr' : ''
				});
			}

			// Parse <Blob> (files)
			for (const blob of doc.querySelectorAll('Blobs > Blob')) {
				const key = blob.querySelector('Name')?.textContent ?? '';
				if (!key || key === path || key.endsWith('/')) continue;
				const name = nameFromKey(key);
				const size = parseInt(
					blob.querySelector('Properties > Content-Length')?.textContent ?? '0',
					10
				);
				const lastMod = blob.querySelector('Properties > Last-Modified')?.textContent ?? '';
				entries.push({
					name,
					path: key,
					is_dir: false,
					size,
					modified: lastMod ? Date.parse(lastMod) || 0 : 0,
					extension: extensionFromName(name)
				});
			}

			// Pagination
			const nextMarker = doc.querySelector('NextMarker')?.textContent;
			marker = nextMarker || undefined;
		} while (marker);

		return entries;
	}

	async read(path: string, offset?: number, length?: number): Promise<Uint8Array> {
		const conn = this.getConnection();
		const url = appendSas(`${buildBaseUrl(conn)}/${encodeKey(path)}`, getSasQuery(conn));

		const headers: Record<string, string> = {};
		if (offset !== undefined || length !== undefined) {
			const start = offset ?? 0;
			const end = length !== undefined ? start + length - 1 : '';
			headers.Range = `bytes=${start}-${end}`;
		}

		const res = await fetch(url, { headers });
		if (!res.ok && res.status !== 206) {
			throw new Error(`Azure get failed (${res.status}): ${res.statusText}`);
		}

		return new Uint8Array(await res.arrayBuffer());
	}

	async head(path: string): Promise<FileEntry> {
		const conn = this.getConnection();
		const url = appendSas(`${buildBaseUrl(conn)}/${encodeKey(path)}`, getSasQuery(conn));

		const res = await fetch(url, { method: 'HEAD' });
		if (!res.ok) {
			throw new Error(`Azure head failed (${res.status}): ${res.statusText}`);
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
		const url = appendSas(`${buildBaseUrl(conn)}/${encodeKey(key)}`, getSasQuery(conn));

		const headers: Record<string, string> = {
			'x-ms-blob-type': 'BlockBlob'
		};
		if (contentType) headers['Content-Type'] = contentType;

		const res = await fetch(url, {
			method: 'PUT',
			body: data.buffer as ArrayBuffer,
			headers
		});
		if (!res.ok) {
			const body = await res.text().catch(() => '');
			throw new Error(`Azure put failed (${res.status}): ${body || res.statusText}`);
		}

		return {
			key,
			size: data.byteLength,
			e_tag: res.headers.get('etag') ?? undefined
		};
	}

	async delete(key: string): Promise<void> {
		const conn = this.getConnection();
		const url = appendSas(`${buildBaseUrl(conn)}/${encodeKey(key)}`, getSasQuery(conn));

		const res = await fetch(url, { method: 'DELETE' });
		if (!res.ok && res.status !== 202 && res.status !== 204) {
			throw new Error(`Azure delete failed (${res.status}): ${res.statusText}`);
		}
	}

	async deletePrefix(prefix: string): Promise<{ deleted: number }> {
		if (!prefix) {
			throw new Error('Cannot delete with empty prefix — this would delete the entire container.');
		}

		// List all blobs under prefix (no delimiter → recursive)
		const conn = this.getConnection();
		const baseUrl = buildBaseUrl(conn);
		const sas = getSasQuery(conn);

		const keys: string[] = [];
		let marker: string | undefined;

		do {
			const params = new URLSearchParams({
				restype: 'container',
				comp: 'list'
			});
			if (prefix) params.set('prefix', prefix);
			if (marker) params.set('marker', marker);

			const url = appendSas(`${baseUrl}?${params}`, sas);
			const res = await fetch(url);
			if (!res.ok) throw new Error(`Azure list failed (${res.status}): ${res.statusText}`);

			const xml = await res.text();
			const doc = new DOMParser().parseFromString(xml, 'application/xml');

			for (const blob of doc.querySelectorAll('Blobs > Blob')) {
				const key = blob.querySelector('Name')?.textContent;
				if (key) keys.push(key);
			}

			const nextMarker = doc.querySelector('NextMarker')?.textContent;
			marker = nextMarker || undefined;
		} while (marker);

		for (const key of keys) {
			await this.delete(key);
		}

		return { deleted: keys.length };
	}

	async copy(srcKey: string, destKey: string): Promise<WriteResult> {
		const conn = this.getConnection();
		const sas = getSasQuery(conn);
		const base = buildBaseUrl(conn);
		const destUrl = appendSas(`${base}/${encodeKey(destKey)}`, sas);
		const srcUrl = appendSas(`${base}/${encodeKey(srcKey)}`, sas);

		const res = await fetch(destUrl, {
			method: 'PUT',
			headers: {
				'x-ms-copy-source': srcUrl,
				'x-ms-blob-type': 'BlockBlob'
			}
		});

		if (!res.ok) {
			const body = await res.text().catch(() => '');
			throw new Error(`Azure copy failed (${res.status}): ${body || res.statusText}`);
		}

		return {
			key: destKey,
			size: 0,
			e_tag: res.headers.get('etag') ?? undefined
		};
	}
}
