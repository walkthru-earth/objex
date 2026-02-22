import type { Connection, ConnectionConfig } from '$lib/types.js';
import type { DetectedHost } from '$lib/utils/host-detection.js';
import { credentialStore, storeToNative } from './credentials.svelte.js';

const CONNECTIONS_KEY = 'obstore-explore-connections';

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

function loadFromLocalStorage(): Connection[] {
	if (typeof window === 'undefined') return [];
	try {
		const raw = localStorage.getItem(CONNECTIONS_KEY);
		if (raw) {
			return JSON.parse(raw) as Connection[];
		}
	} catch {
		// ignore parse errors
	}
	return [];
}

function persistToLocalStorage(connections: Connection[]): void {
	if (typeof window === 'undefined') return;
	try {
		localStorage.setItem(CONNECTIONS_KEY, JSON.stringify(connections));
	} catch {
		// ignore storage errors
	}
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

function createConnectionsStore() {
	let connections = $state<Connection[]>([]);
	let loaded = $state(false);

	return {
		get items() {
			return connections;
		},

		get loaded() {
			return loaded;
		},

		/**
		 * Load connections from localStorage.
		 * Safe to call multiple times — subsequent calls are no-ops.
		 */
		async load() {
			if (loaded) return;
			connections = loadFromLocalStorage();
			loaded = true;
		},

		/**
		 * Force-reload connections.
		 */
		async reload() {
			loaded = false;
			await this.load();
		},

		/**
		 * Save a new connection to localStorage.
		 */
		async save(config: ConnectionConfig): Promise<string | null> {
			const id = crypto.randomUUID();
			const conn: Connection = {
				id,
				name: config.name,
				provider: config.provider as Connection['provider'],
				endpoint: config.endpoint,
				bucket: config.bucket,
				region: config.region,
				anonymous: config.anonymous,
				authMethod: config.authMethod,
				rootPrefix: config.rootPrefix
			};
			connections = [...connections, conn];
			persistToLocalStorage(connections);

			// Store credentials in memory (never persisted to localStorage).
			if (!config.anonymous) {
				if (config.sas_token) {
					const creds = { type: 'sas-token' as const, sasToken: config.sas_token };
					credentialStore.set(id, creds);
					storeToNative(id, creds).catch(() => {});
				} else if (config.access_key && config.secret_key) {
					const creds = {
						type: 'sigv4' as const,
						accessKey: config.access_key,
						secretKey: config.secret_key
					};
					credentialStore.set(id, creds);
					storeToNative(id, creds).catch(() => {});
				}
			}

			return id;
		},

		/**
		 * Update an existing connection.
		 */
		async update(id: string, config: ConnectionConfig): Promise<boolean> {
			const idx = connections.findIndex((c) => c.id === id);
			if (idx === -1) return false;
			connections[idx] = {
				...connections[idx],
				name: config.name,
				provider: config.provider as Connection['provider'],
				endpoint: config.endpoint,
				bucket: config.bucket,
				region: config.region,
				anonymous: config.anonymous,
				authMethod: config.authMethod,
				rootPrefix: config.rootPrefix
			};
			connections = [...connections];
			persistToLocalStorage(connections);

			// Update in-memory credentials.
			if (!config.anonymous) {
				if (config.sas_token) {
					const creds = { type: 'sas-token' as const, sasToken: config.sas_token };
					credentialStore.set(id, creds);
					storeToNative(id, creds).catch(() => {});
				} else if (config.access_key && config.secret_key) {
					const creds = {
						type: 'sigv4' as const,
						accessKey: config.access_key,
						secretKey: config.secret_key
					};
					credentialStore.set(id, creds);
					storeToNative(id, creds).catch(() => {});
				} else {
					credentialStore.remove(id);
				}
			} else {
				credentialStore.remove(id);
			}

			return true;
		},

		/**
		 * Remove a connection by ID.
		 */
		async remove(id: string): Promise<boolean> {
			const before = connections.length;
			connections = connections.filter((c) => c.id !== id);
			persistToLocalStorage(connections);
			credentialStore.remove(id);
			return connections.length < before;
		},

		/**
		 * Test whether a connection is reachable via a lightweight list.
		 */
		async test(id: string): Promise<boolean> {
			const { getAdapter } = await import(/* @vite-ignore */ '$lib/storage/index.js');
			const adapter = getAdapter('remote', id);
			await adapter.list('');
			return true;
		},

		/**
		 * Test a connection using provided config values (works for both new
		 * and existing connections without saving first).
		 */
		async testWithConfig(config: ConnectionConfig, existingId?: string): Promise<boolean> {
			const tempId = existingId ?? `temp-test-${Date.now()}`;
			const tempConn: Connection = {
				id: tempId,
				name: config.name,
				provider: config.provider as Connection['provider'],
				endpoint: config.endpoint,
				bucket: config.bucket,
				region: config.region,
				anonymous: config.anonymous,
				authMethod: config.authMethod,
				rootPrefix: config.rootPrefix
			};

			// Temporarily register connection + credentials so the adapter can find them
			const hadConn = connections.some((c) => c.id === tempId);
			const prevCreds = credentialStore.get(tempId);
			if (!hadConn) {
				connections = [...connections, tempConn];
				persistToLocalStorage(connections);
			}

			if (!config.anonymous) {
				if (config.sas_token) {
					credentialStore.set(tempId, { type: 'sas-token', sasToken: config.sas_token });
				} else if (config.access_key && config.secret_key) {
					credentialStore.set(tempId, {
						type: 'sigv4',
						accessKey: config.access_key,
						secretKey: config.secret_key
					});
				}
			}

			try {
				const { getAdapter } = await import(/* @vite-ignore */ '$lib/storage/index.js');
				const adapter = getAdapter('remote', tempId);
				await adapter.list(config.rootPrefix || '');
				return true;
			} finally {
				// Cleanup: remove temp connection if we added it
				if (!hadConn) {
					connections = connections.filter((c) => c.id !== tempId);
					persistToLocalStorage(connections);
				}
				// Restore previous credentials or remove temp ones
				if (prevCreds) {
					credentialStore.set(tempId, prevCreds);
				} else if (!hadConn) {
					credentialStore.remove(tempId);
				}
			}
		},

		/**
		 * Synchronous lookup by ID (from the already-loaded list).
		 */
		getById(id: string): Connection | undefined {
			return connections.find((c) => c.id === id);
		},

		/**
		 * Find an existing connection that matches bucket + endpoint.
		 */
		findByBucketEndpoint(bucket: string, endpoint: string): Connection | undefined {
			return connections.find((c) => c.bucket === bucket && c.endpoint === endpoint);
		},

		/**
		 * Create a connection from a DetectedHost, deduplicating by bucket+endpoint.
		 * Returns the connection ID (existing or newly created).
		 */
		async saveHostConnection(detected: DetectedHost): Promise<string> {
			const existing = this.findByBucketEndpoint(detected.bucket, detected.endpoint);
			if (existing) return existing.id;

			const name = detected.bucket === '$web' ? `Azure Static Web` : detected.bucket;

			const id = await this.save({
				name,
				provider: detected.provider === 'unknown' ? 's3' : detected.provider,
				endpoint: detected.endpoint,
				bucket: detected.bucket,
				region: detected.region,
				anonymous: true,
				rootPrefix: detected.rootPrefix || undefined
			});

			return id!;
		}
	};
}

export const connectionStore = createConnectionsStore();
export { connectionStore as connections };
