import type { FileEntry, WriteResult } from '../types.js';

/** A single page of listing results with optional continuation. */
export interface ListPage {
	entries: FileEntry[];
	continuationToken?: string;
	hasMore: boolean;
}

/**
 * Thrown by adapters when the server returns 401 or 403 on an anonymous
 * request. The browser store catches this to trigger a credential prompt
 * for auto-detected `?url=` connections that turned out to be private.
 */
export class AuthRequiredError extends Error {
	readonly status: number;
	constructor(status: number, message: string) {
		super(message);
		this.name = 'AuthRequiredError';
		this.status = status;
	}
}

export interface StorageAdapter {
	// Read operations
	list(path: string, signal?: AbortSignal): Promise<FileEntry[]>;
	read(path: string, offset?: number, length?: number, signal?: AbortSignal): Promise<Uint8Array>;
	head(path: string, signal?: AbortSignal): Promise<FileEntry>;

	/** Fetch a single page of listing results. Supports progressive rendering. */
	listPage?(
		path: string,
		continuationToken?: string,
		pageSize?: number,
		signal?: AbortSignal
	): Promise<ListPage>;

	// Write operations
	put(key: string, data: Uint8Array, contentType?: string): Promise<WriteResult>;
	delete(key: string): Promise<void>;
	deletePrefix(prefix: string): Promise<{ deleted: number }>;
	copy(srcKey: string, destKey: string): Promise<WriteResult>;

	readonly supportsWrite: boolean;
}
