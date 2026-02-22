import { connectionStore } from '$lib/stores/connections.svelte.js';
import type { StorageAdapter } from './adapter.js';
import { BrowserAzureAdapter } from './browser-azure.js';
import { BrowserCloudAdapter } from './browser-cloud.js';
import { UrlAdapter } from './url-adapter.js';

export type { StorageAdapter } from './adapter.js';

/**
 * Returns the appropriate storage adapter for the given source.
 * - 'url': direct HTTPS fetch (no connection needed)
 * - 'remote': connection-based adapter (Azure or S3-compatible)
 */
export function getAdapter(source: 'remote' | 'url', connectionId?: string): StorageAdapter {
	if (source === 'url') {
		return new UrlAdapter();
	}

	if (!connectionId) {
		throw new Error('A connectionId is required for remote storage adapters.');
	}

	const conn = connectionStore.getById(connectionId);
	if (conn?.provider === 'azure') {
		return new BrowserAzureAdapter(connectionId);
	}

	return new BrowserCloudAdapter(connectionId);
}
