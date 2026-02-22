import { connectionStore } from '$lib/stores/connections.svelte.js';
import type { StorageAdapter } from './adapter.js';
import { BrowserAzureAdapter } from './browser-azure.js';
import { BrowserCloudAdapter } from './browser-cloud.js';

export type { StorageAdapter } from './adapter.js';

/**
 * Returns the appropriate storage adapter for the given connection.
 * Azure connections get BrowserAzureAdapter; everything else (S3, R2, GCS, Storj, MinIO)
 * gets BrowserCloudAdapter which uses SigV4 signing or anonymous fetch.
 *
 * @param source - must be 'remote' (local filesystem is not available in web mode)
 * @param connectionId - identifies the connection config
 */
export function getAdapter(_source: 'remote', connectionId?: string): StorageAdapter {
	if (!connectionId) {
		throw new Error('A connectionId is required for remote storage adapters.');
	}

	const conn = connectionStore.getById(connectionId);
	if (conn?.provider === 'azure') {
		return new BrowserAzureAdapter(connectionId);
	}

	return new BrowserCloudAdapter(connectionId);
}
