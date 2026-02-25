import { BlobReader, configure, type Entry, HttpReader, ZipReader } from '@zip.js/zip.js';

// Enable web workers for non-blocking ZIP parsing
configure({ useWebWorkers: true });

// ── Types ──────────────────────────────────────────────────────────────

export interface ArchiveEntry {
	filename: string;
	directory: boolean;
	compressedSize: number;
	uncompressedSize: number;
	lastModified: Date;
	/** TAR only: byte offset of the file data within the archive */
	dataOffset?: number;
}

export type ArchiveFormat = 'zip' | 'tar' | 'tar.gz' | 'unsupported';

// ── Format Detection ───────────────────────────────────────────────────

export function detectArchiveFormat(filename: string): ArchiveFormat {
	const lower = filename.toLowerCase();
	if (lower.endsWith('.zip')) return 'zip';
	if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'tar.gz';
	if (lower.endsWith('.tar')) return 'tar';
	if (lower.endsWith('.gz')) return 'tar.gz';
	return 'unsupported';
}

// ── ZIP (streaming) ────────────────────────────────────────────────────

const ZIP_BATCH_SIZE = 500;

/**
 * Stream ZIP entries from a URL using HTTP range requests.
 * Uses getEntriesGenerator() so the UI can render progressively.
 */
export async function* streamZipEntriesFromUrl(
	url: string,
	signal?: AbortSignal
): AsyncGenerator<{ zipEntries: Entry[]; archiveEntries: ArchiveEntry[] }> {
	const httpReader = new HttpReader(url, { forceRangeRequests: true });
	const reader = new ZipReader(httpReader);

	let zBatch: Entry[] = [];
	let aBatch: ArchiveEntry[] = [];

	try {
		for await (const entry of reader.getEntriesGenerator()) {
			if (signal?.aborted) return;

			zBatch.push(entry);
			aBatch.push({
				filename: entry.filename,
				directory: entry.directory,
				compressedSize: entry.compressedSize,
				uncompressedSize: entry.uncompressedSize,
				lastModified: entry.lastModDate
			});

			if (zBatch.length >= ZIP_BATCH_SIZE) {
				yield { zipEntries: zBatch, archiveEntries: aBatch };
				zBatch = [];
				aBatch = [];
			}
		}
		if (zBatch.length > 0) {
			yield { zipEntries: zBatch, archiveEntries: aBatch };
		}
	} finally {
		await reader.close();
	}
}

/**
 * Read ZIP entries from an in-memory buffer (non-streaming, fast).
 */
export async function readZipEntriesFromBuffer(
	data: Uint8Array
): Promise<{ entries: Entry[]; entryList: ArchiveEntry[] }> {
	const blob = new Blob([data as unknown as BlobPart]);
	const reader = new ZipReader(new BlobReader(blob));
	const entries = await reader.getEntries();
	return {
		entries,
		entryList: entries.map((e) => ({
			filename: e.filename,
			directory: e.directory,
			compressedSize: e.compressedSize,
			uncompressedSize: e.uncompressedSize,
			lastModified: e.lastModDate
		}))
	};
}

// ── TAR (streaming) ────────────────────────────────────────────────────

const TAR_HEADER_SIZE = 512;
const TAR_CHUNK_SIZE = 256 * 1024; // 256 KB per range request

/**
 * Parse a single 512-byte TAR header.
 * Returns null for end-of-archive (all-zero block).
 */
function parseTarHeader(header: Uint8Array): ArchiveEntry | null {
	if (header.every((b) => b === 0)) return null;

	const dec = new TextDecoder('ascii');
	const name = dec.decode(header.slice(0, 100)).replace(/\0+$/, '');
	const prefix = dec.decode(header.slice(345, 500)).replace(/\0+$/, '');
	let fullName = prefix ? `${prefix}/${name}` : name;

	// Normalize: strip leading ./ (common in tarballs created with `tar -czf`)
	if (fullName.startsWith('./')) fullName = fullName.slice(2);

	const sizeStr = dec.decode(header.slice(124, 136)).replace(/\0+$/, '').trim();
	const size = parseInt(sizeStr, 8) || 0;

	const mtimeStr = dec.decode(header.slice(136, 148)).replace(/\0+$/, '').trim();
	const mtime = new Date((parseInt(mtimeStr, 8) || 0) * 1000);

	const typeFlag = String.fromCharCode(header[156]);
	const isDir = typeFlag === '5' || fullName.endsWith('/');

	return {
		filename: fullName,
		directory: isDir,
		compressedSize: size,
		uncompressedSize: size,
		lastModified: mtime,
		dataOffset: 0
	};
}

/** Returns true for bare root entries (e.g. ".", "") that should be skipped. */
function isRootEntry(entry: ArchiveEntry): boolean {
	const f = entry.filename.replace(/\/+$/, '');
	return f === '' || f === '.';
}

/**
 * Stream TAR entries from a URL using batched HTTP range requests.
 * Yields a batch of entries after each chunk is processed,
 * so the UI can render progressively while scanning continues.
 */
export async function* streamTarEntriesFromUrl(
	url: string,
	signal?: AbortSignal
): AsyncGenerator<ArchiveEntry[]> {
	const head = await fetch(url, { method: 'HEAD', signal });
	const totalSize = Number(head.headers.get('content-length'));
	if (!totalSize || totalSize <= 0) throw new Error('Cannot determine TAR file size');

	let offset = 0;

	while (offset < totalSize) {
		if (signal?.aborted) return;

		const end = Math.min(offset + TAR_CHUNK_SIZE - 1, totalSize - 1);
		const res = await fetch(url, {
			headers: { Range: `bytes=${offset}-${end}` },
			signal
		});
		const chunk = new Uint8Array(await res.arrayBuffer());
		const batch: ArchiveEntry[] = [];
		let localOffset = 0;

		while (localOffset + TAR_HEADER_SIZE <= chunk.length) {
			const header = chunk.slice(localOffset, localOffset + TAR_HEADER_SIZE);
			const entry = parseTarHeader(header);
			if (!entry) {
				if (batch.length > 0) yield batch;
				return;
			}

			const dataBlocks = Math.ceil(entry.uncompressedSize / TAR_HEADER_SIZE);
			const entryTotalSize = TAR_HEADER_SIZE + dataBlocks * TAR_HEADER_SIZE;

			if (!isRootEntry(entry)) {
				entry.dataOffset = offset + localOffset + TAR_HEADER_SIZE;
				batch.push(entry);
			}

			if (localOffset + entryTotalSize > chunk.length) {
				offset += localOffset + entryTotalSize;
				localOffset = chunk.length;
			} else {
				localOffset += entryTotalSize;
			}
		}

		if (batch.length > 0) yield batch;

		if (localOffset <= chunk.length) {
			offset += localOffset || TAR_CHUNK_SIZE;
		}
	}
}

/**
 * Read TAR entries from an in-memory buffer (non-streaming, fast).
 */
export function readTarEntriesFromBuffer(data: Uint8Array): { entryList: ArchiveEntry[] } {
	const entries: ArchiveEntry[] = [];
	let offset = 0;

	while (offset + TAR_HEADER_SIZE <= data.length) {
		const header = data.slice(offset, offset + TAR_HEADER_SIZE);
		const entry = parseTarHeader(header);
		if (!entry) break;

		const dataBlocks = Math.ceil(entry.uncompressedSize / TAR_HEADER_SIZE);

		if (!isRootEntry(entry)) {
			entry.dataOffset = offset + TAR_HEADER_SIZE;
			entries.push(entry);
		}

		offset += TAR_HEADER_SIZE + dataBlocks * TAR_HEADER_SIZE;
	}

	return { entryList: entries };
}

// ── TAR.GZ ─────────────────────────────────────────────────────────────

/**
 * Decompress gzip data using the browser's DecompressionStream.
 * Requires full download — gzip does not support random access.
 */
export async function decompressGzip(data: Uint8Array): Promise<Uint8Array> {
	const ds = new DecompressionStream('gzip');
	const decompressedStream = new Blob([data as unknown as BlobPart]).stream().pipeThrough(ds);
	const buf = await new Response(decompressedStream).arrayBuffer();
	return new Uint8Array(buf);
}

const TAR_GZ_BATCH_SIZE = 200;

/**
 * Stream tar.gz entries by fetching the URL, piping through DecompressionStream,
 * and parsing tar headers progressively as decompressed chunks arrive.
 *
 * Gzip doesn't support random access, so we must download sequentially,
 * but entries appear immediately — no waiting for the full download.
 *
 * Yields { entries, chunk } so the caller can optionally accumulate raw
 * decompressed data for later file extraction.
 */
export async function* streamTarGzEntriesFromUrl(
	url: string,
	signal?: AbortSignal
): AsyncGenerator<{ entries: ArchiveEntry[]; chunk: Uint8Array }> {
	const response = await fetch(url, { signal });
	if (!response.body) throw new Error('No response body');

	const ds = new DecompressionStream('gzip');
	const decompressed = response.body.pipeThrough(ds);
	const reader = decompressed.getReader();

	let buffer = new Uint8Array(0);
	let tarOffset = 0; // absolute byte offset in decompressed tar stream

	while (true) {
		if (signal?.aborted) return;
		const { done, value } = await reader.read();
		if (done) break;

		// Append new decompressed chunk to working buffer
		const prev = buffer;
		buffer = new Uint8Array(prev.length + value.length);
		buffer.set(prev);
		buffer.set(value, prev.length);

		const batch: ArchiveEntry[] = [];
		let consumed = 0;

		// Parse as many complete tar entries as possible
		while (buffer.length - consumed >= TAR_HEADER_SIZE) {
			const header = buffer.slice(consumed, consumed + TAR_HEADER_SIZE);
			const entry = parseTarHeader(header);

			if (!entry) {
				// End-of-archive marker (two 512-byte zero blocks)
				if (batch.length > 0) {
					yield { entries: batch, chunk: buffer.slice(0, consumed) };
				}
				return;
			}

			const dataBlocks = Math.ceil(entry.uncompressedSize / TAR_HEADER_SIZE);
			const entryTotalSize = TAR_HEADER_SIZE + dataBlocks * TAR_HEADER_SIZE;

			if (buffer.length - consumed < entryTotalSize) {
				// Not enough data yet for header + file data, wait for more
				break;
			}

			if (!isRootEntry(entry)) {
				entry.dataOffset = tarOffset + consumed + TAR_HEADER_SIZE;
				batch.push(entry);
			}
			consumed += entryTotalSize;

			if (batch.length >= TAR_GZ_BATCH_SIZE) {
				yield { entries: batch.splice(0), chunk: buffer.slice(0, consumed) };
			}
		}

		// Yield any remaining entries in this chunk
		if (batch.length > 0) {
			yield { entries: batch, chunk: buffer.slice(0, consumed) };
		}

		tarOffset += consumed;
		buffer = buffer.slice(consumed);
	}
}

// ── Listing (universal) ────────────────────────────────────────────────

const MAX_BROWSE_DEPTH = 10;

/**
 * List directory contents at a given prefix.
 * Returns immediate children: directories (as path strings) and files.
 */
export function listContents(
	entryList: ArchiveEntry[],
	prefix: string
): { directories: string[]; files: ArchiveEntry[] } {
	const canonical = prefix.length > 0 && !prefix.endsWith('/') ? `${prefix}/` : prefix;

	const files: ArchiveEntry[] = [];
	const directories = new Set<string>();

	for (const entry of entryList) {
		if (!entry.filename.startsWith(canonical)) continue;

		const remainder = entry.filename.slice(canonical.length);
		if (remainder.length === 0) continue;

		const slashIndex = remainder.indexOf('/');
		if (slashIndex === -1) {
			if (!entry.directory) files.push(entry);
		} else {
			const dirName = remainder.slice(0, slashIndex);
			const dirPath = `${canonical}${dirName}`;
			if (dirName.length > 0) directories.add(dirPath);
		}
	}

	return {
		directories: [...directories].sort(),
		files: files.sort((a, b) => a.filename.localeCompare(b.filename))
	};
}

export function clampPrefix(prefix: string, maxDepth: number = MAX_BROWSE_DEPTH): string {
	const parts = prefix.split('/').filter(Boolean);
	if (parts.length <= maxDepth) return prefix;
	return parts.slice(0, maxDepth).join('/');
}

// ── Download ───────────────────────────────────────────────────────────

export async function downloadZipEntry(entry: Entry): Promise<void> {
	if (entry.directory || !entry.getData) return;
	const { BlobWriter, getMimeType } = await import('@zip.js/zip.js');
	const mimeType = getMimeType(entry.filename);
	const blob: Blob = await entry.getData(new BlobWriter(mimeType));
	triggerBlobDownload(blob, entry.filename.split('/').pop() || 'file');
}

export async function downloadTarEntryFromUrl(url: string, entry: ArchiveEntry): Promise<void> {
	if (entry.directory || entry.dataOffset == null) return;
	const res = await fetch(url, {
		headers: {
			Range: `bytes=${entry.dataOffset}-${entry.dataOffset + entry.uncompressedSize - 1}`
		}
	});
	const blob = await res.blob();
	triggerBlobDownload(blob, entry.filename.split('/').pop() || 'file');
}

export function downloadTarEntryFromBuffer(data: Uint8Array, entry: ArchiveEntry): void {
	if (entry.directory || entry.dataOffset == null) return;
	const slice = data.slice(entry.dataOffset, entry.dataOffset + entry.uncompressedSize);
	const blob = new Blob([slice]);
	triggerBlobDownload(blob, entry.filename.split('/').pop() || 'file');
}

function triggerBlobDownload(blob: Blob, filename: string) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
