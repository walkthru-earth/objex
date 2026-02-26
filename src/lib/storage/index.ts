import { connectionStore } from '$lib/stores/connections.svelte.js';
import type { StorageAdapter } from './adapter.js';
import { BrowserAzureAdapter } from './browser-azure.js';
import { BrowserCloudAdapter } from './browser-cloud.js';
import { UrlAdapter } from './url-adapter.js';

export type { StorageAdapter } from './adapter.js';

const adapterCache = new Map<string, StorageAdapter>();
// Singleton UrlAdapter — stateless, no connection needed
const urlAdapter = new UrlAdapter();

/**
 * Returns the appropriate storage adapter for the given source.
 * Caches adapter instances per connectionId.
 */
export function getAdapter(source: 'remote' | 'url', connectionId?: string): StorageAdapter {
	if (source === 'url') {
		return urlAdapter;
	}

	if (!connectionId) {
		throw new Error('A connectionId is required for remote storage adapters.');
	}

	let adapter = adapterCache.get(connectionId);
	if (adapter) return adapter;

	const conn = connectionStore.getById(connectionId);
	if (conn?.provider === 'azure') {
		adapter = new BrowserAzureAdapter(connectionId);
	} else {
		adapter = new BrowserCloudAdapter(connectionId);
	}

	adapterCache.set(connectionId, adapter);
	return adapter;
}

/**
 * Clear cached adapter for a connection (call on connection update/delete).
 */
export function clearAdapterCache(connectionId: string): void {
	adapterCache.delete(connectionId);
}
