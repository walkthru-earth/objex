import type { FileEntry, WriteResult } from '$lib/types.js';

export interface StorageAdapter {
	// Read operations
	list(path: string): Promise<FileEntry[]>;
	read(path: string, offset?: number, length?: number): Promise<Uint8Array>;
	head(path: string): Promise<FileEntry>;

	// Write operations
	put(key: string, data: Uint8Array, contentType?: string): Promise<WriteResult>;
	delete(key: string): Promise<void>;
	deletePrefix(prefix: string): Promise<{ deleted: number }>;
	copy(srcKey: string, destKey: string): Promise<WriteResult>;

	readonly supportsWrite: boolean;
}
