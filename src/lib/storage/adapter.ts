import type { FileEntry, WriteResult } from '$lib/types.js';

/** A single page of listing results with optional continuation. */
export interface ListPage {
	entries: FileEntry[];
	continuationToken?: string;
	hasMore: boolean;
}

export interface StorageAdapter {
	// Read operations
	list(path: string): Promise<FileEntry[]>;
	read(path: string, offset?: number, length?: number): Promise<Uint8Array>;
	head(path: string): Promise<FileEntry>;

	/** Fetch a single page of listing results. Supports progressive rendering. */
	listPage?(path: string, continuationToken?: string, pageSize?: number): Promise<ListPage>;

	// Write operations
	put(key: string, data: Uint8Array, contentType?: string): Promise<WriteResult>;
	delete(key: string): Promise<void>;
	deletePrefix(prefix: string): Promise<{ deleted: number }>;
	copy(srcKey: string, destKey: string): Promise<WriteResult>;

	readonly supportsWrite: boolean;
}
