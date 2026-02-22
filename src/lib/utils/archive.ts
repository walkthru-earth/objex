import { BlobReader, type Entry, HttpReader, ZipReader } from '@zip.js/zip.js';

export interface ArchiveEntry {
	filename: string;
	directory: boolean;
	compressedSize: number;
	uncompressedSize: number;
	lastModified: Date;
}

export interface FileTreeNode {
	name: string;
	path: string;
	isDir: boolean;
	size: number;
	children: FileTreeNode[];
}

/**
 * Read ZIP entries from a URL using HTTP range requests.
 * Only fetches the central directory — does NOT download the full file.
 */
export async function readZipEntriesFromUrl(
	url: string
): Promise<{ entries: Entry[]; entryList: ArchiveEntry[] }> {
	const httpReader = new HttpReader(url, { forceRangeRequests: true });
	const reader = new ZipReader(httpReader);
	const entries = await reader.getEntries();

	const entryList: ArchiveEntry[] = entries.map((e) => ({
		filename: e.filename,
		directory: e.directory,
		compressedSize: e.compressedSize,
		uncompressedSize: e.uncompressedSize,
		lastModified: e.lastModDate
	}));

	return { entries, entryList };
}

/**
 * Read ZIP entries from an in-memory buffer.
 * Used as fallback when HTTP range requests aren't supported.
 */
export async function readZipEntriesFromBuffer(
	data: Uint8Array
): Promise<{ entries: Entry[]; entryList: ArchiveEntry[] }> {
	const blob = new Blob([data as unknown as BlobPart]);
	const reader = new ZipReader(new BlobReader(blob));
	const entries = await reader.getEntries();

	const entryList: ArchiveEntry[] = entries.map((e) => ({
		filename: e.filename,
		directory: e.directory,
		compressedSize: e.compressedSize,
		uncompressedSize: e.uncompressedSize,
		lastModified: e.lastModDate
	}));

	return { entries, entryList };
}

export async function extractEntry(entry: Entry): Promise<Uint8Array> {
	if (!('getData' in entry) || !entry.getData) throw new Error('Cannot extract directory');
	const blob = await (entry as any).getData(new (await import('@zip.js/zip.js')).BlobWriter());
	const buffer = await blob.arrayBuffer();
	return new Uint8Array(buffer);
}

export function buildFileTree(entryList: ArchiveEntry[]): FileTreeNode[] {
	const root: FileTreeNode = { name: '', path: '', isDir: true, size: 0, children: [] };

	for (const entry of entryList) {
		const parts = entry.filename.split('/').filter(Boolean);
		let current = root;

		for (let i = 0; i < parts.length; i++) {
			const part = parts[i];
			const isLast = i === parts.length - 1;
			const path = parts.slice(0, i + 1).join('/');

			let child = current.children.find((c) => c.name === part);
			if (!child) {
				child = {
					name: part,
					path,
					isDir: isLast ? entry.directory : true,
					size: isLast ? entry.uncompressedSize : 0,
					children: []
				};
				current.children.push(child);
			}
			current = child;
		}
	}

	// Sort: directories first, then alphabetical
	function sortTree(node: FileTreeNode) {
		node.children.sort((a, b) => {
			if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
			return a.name.localeCompare(b.name);
		});
		for (const child of node.children) sortTree(child);
	}

	sortTree(root);
	return root.children;
}
