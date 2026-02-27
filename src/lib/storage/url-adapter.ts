import type { FileEntry, WriteResult } from '../types.js';
import type { StorageAdapter } from './adapter.js';

/**
 * Minimal adapter for direct HTTPS URLs (source: 'url').
 * Only supports read/head — no listing or writing.
 * The `path` parameter is the full HTTPS URL.
 */
export class UrlAdapter implements StorageAdapter {
	readonly supportsWrite = false;

	async read(
		url: string,
		offset?: number,
		length?: number,
		signal?: AbortSignal
	): Promise<Uint8Array> {
		const headers: Record<string, string> = {};
		if (offset !== undefined && length !== undefined) {
			headers.Range = `bytes=${offset}-${offset + length - 1}`;
		} else if (offset !== undefined) {
			headers.Range = `bytes=${offset}-`;
		}

		const res = await fetch(url, { headers, signal });
		if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
		return new Uint8Array(await res.arrayBuffer());
	}

	async head(url: string, signal?: AbortSignal): Promise<FileEntry> {
		const res = await fetch(url, { method: 'HEAD', signal });
		if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
		const name = url.split('/').pop()?.split('?')[0] || 'file';
		const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
		return {
			name,
			path: url,
			is_dir: false,
			size: Number(res.headers.get('content-length') || 0),
			modified: new Date(res.headers.get('last-modified') || 0).getTime(),
			extension: ext
		};
	}

	async list(): Promise<FileEntry[]> {
		return [];
	}

	async put(): Promise<WriteResult> {
		throw new Error('Write not supported for direct URL sources');
	}

	async delete(): Promise<void> {
		throw new Error('Delete not supported for direct URL sources');
	}

	async deletePrefix(): Promise<{ deleted: number }> {
		throw new Error('Delete not supported for direct URL sources');
	}

	async copy(): Promise<WriteResult> {
		throw new Error('Copy not supported for direct URL sources');
	}
}
