import type { DetectedHost } from '@walkthru-earth/objex-utils';
import {
	type ConnectionIdentityInput,
	connectionIdentityKey,
	loadFromStorage,
	persistToStorage
} from '@walkthru-earth/objex-utils';
import { STORAGE_KEYS } from '../constants.js';
import type { Connection, ConnectionConfig } from '../types.js';
import { credentialStore, storeToNative } from './credentials.svelte.js';

/**
 * Outcome of a write. `existed` is true when dedup reused an already-saved
 * connection, false when a new row was persisted. Callers that present UI
 * (dialogs, toasts) use this to decide whether to say "created" or "merged
 * into existing".
 */
export interface ConnectionWriteResult {
	id: string;
	existed: boolean;
}

function toConnection(id: string, config: ConnectionConfig): Connection {
	return {
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
}

function applyCredentials(id: string, config: ConnectionConfig) {
	if (config.anonymous) {
		credentialStore.remove(id);
		return;
	}
	if (config.sas_token) {
		const creds = { type: 'sas-token' as const, sasToken: config.sas_token };
		credentialStore.set(id, creds);
		storeToNative(id, creds).catch(() => {});
		return;
	}
	if (config.access_key && config.secret_key) {
		const creds = {
			type: 'sigv4' as const,
			accessKey: config.access_key,
			secretKey: config.secret_key
		};
		credentialStore.set(id, creds);
		storeToNative(id, creds).catch(() => {});
		return;
	}
	credentialStore.remove(id);
}

function createConnectionsStore() {
	let connections = $state<Connection[]>([]);
	let loaded = $state(false);
	let dialogRequest = $state(0);

	function persist() {
		persistToStorage(STORAGE_KEYS.CONNECTIONS, connections);
	}

	function findByIdentity(
		input: ConnectionIdentityInput,
		excludeId?: string
	): Connection | undefined {
		const key = connectionIdentityKey(input);
		if (!key) return undefined;
		return connections.find((c) => c.id !== excludeId && connectionIdentityKey(c) === key);
	}

	return {
		get items() {
			return connections;
		},

		get loaded() {
			return loaded;
		},

		/**
		 * Load connections from localStorage.
		 * Safe to call multiple times, subsequent calls are no-ops.
		 */
		async load() {
			if (loaded) return;
			connections = loadFromStorage<Connection[]>(STORAGE_KEYS.CONNECTIONS, []);
			loaded = true;
		},

		async reload() {
			loaded = false;
			await this.load();
		},

		/**
		 * Persist a connection. If an existing connection shares the same
		 * identity (see `connectionIdentityKey`), it's reused and its
		 * credentials are refreshed from the new config instead of spawning
		 * a duplicate record. Returns `{ id, existed }` so UI can distinguish
		 * "created" from "merged".
		 */
		async save(config: ConnectionConfig): Promise<ConnectionWriteResult> {
			const existing = findByIdentity(config);
			if (existing) {
				applyCredentials(existing.id, config);
				return { id: existing.id, existed: true };
			}
			const id = crypto.randomUUID();
			connections = [...connections, toConnection(id, config)];
			persist();
			applyCredentials(id, config);
			return { id, existed: false };
		},

		/**
		 * Update an existing connection. Throws `DuplicateConnectionError`
		 * when the new identity would collide with a different saved row,
		 * rather than silently overwriting and leaving a phantom duplicate.
		 */
		async update(id: string, config: ConnectionConfig): Promise<boolean> {
			const idx = connections.findIndex((c) => c.id === id);
			if (idx === -1) return false;
			const collision = findByIdentity(config, id);
			if (collision) {
				throw new DuplicateConnectionError(collision.id, collision.name);
			}
			connections[idx] = toConnection(id, config);
			connections = [...connections];
			persist();

			// Invalidate cached adapter for this connection
			import('../storage/index.js').then(({ clearAdapterCache }) => clearAdapterCache(id));

			applyCredentials(id, config);
			return true;
		},

		async remove(id: string): Promise<boolean> {
			const before = connections.length;
			connections = connections.filter((c) => c.id !== id);
			persist();
			credentialStore.remove(id);
			import('../storage/index.js').then(({ clearAdapterCache }) => clearAdapterCache(id));
			return connections.length < before;
		},

		async test(id: string): Promise<boolean> {
			const { getAdapter } = await import('../storage/index.js');
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
			const tempConn: Connection = toConnection(tempId, config);

			const hadConn = connections.some((c) => c.id === tempId);
			const prevCreds = credentialStore.get(tempId);
			if (!hadConn) {
				connections = [...connections, tempConn];
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
				const { getAdapter } = await import('../storage/index.js');
				const adapter = getAdapter('remote', tempId);
				await adapter.list(config.rootPrefix || '');
				return true;
			} finally {
				if (!hadConn) {
					connections = connections.filter((c) => c.id !== tempId);
				}
				if (prevCreds) {
					credentialStore.set(tempId, prevCreds);
				} else if (!hadConn) {
					credentialStore.remove(tempId);
				}
				import('../storage/index.js').then(({ clearAdapterCache }) => clearAdapterCache(tempId));
			}
		},

		get dialogRequested() {
			return dialogRequest > 0;
		},

		requestDialog() {
			dialogRequest++;
		},

		clearDialogRequest() {
			dialogRequest = 0;
		},

		getById(id: string): Connection | undefined {
			return connections.find((c) => c.id === id);
		},

		/**
		 * Find an already-saved connection that matches the canonical identity
		 * of `input` (provider + bucket + endpoint/region per provider rules).
		 * Used by auto-detect, manual-add dedup, and edit-collision checks.
		 */
		findByIdentity(input: ConnectionIdentityInput): Connection | undefined {
			return findByIdentity(input);
		},

		/**
		 * Auto-connect path for a URL-detected bucket. Reuses an existing
		 * connection when identity matches, otherwise creates one anonymously.
		 * Always returns the final connection ID.
		 */
		async saveHostConnection(detected: DetectedHost): Promise<string> {
			const identity: ConnectionIdentityInput = {
				provider: detected.provider,
				endpoint: detected.endpoint,
				bucket: detected.bucket,
				region: detected.region
			};
			const existing = findByIdentity(identity);
			if (existing) return existing.id;

			const name = detected.bucket === '$web' ? `Azure Static Web` : detected.bucket;

			const result = await this.save({
				name,
				provider:
					detected.provider === 'unknown' ? 's3' : (detected.provider as Connection['provider']),
				endpoint: detected.endpoint,
				bucket: detected.bucket,
				region: detected.region,
				anonymous: true,
				rootPrefix: detected.rootPrefix || undefined
			});

			return result.id;
		}
	};
}

/**
 * Thrown by `update()` when the proposed identity collides with a different
 * saved connection. Lets the UI tell the user which connection already owns
 * that identity instead of silently producing a phantom duplicate.
 */
export class DuplicateConnectionError extends Error {
	readonly existingId: string;
	readonly existingName: string;
	constructor(existingId: string, existingName: string) {
		super(`A connection already exists for this bucket: "${existingName}"`);
		this.name = 'DuplicateConnectionError';
		this.existingId = existingId;
		this.existingName = existingName;
	}
}

export const connectionStore = createConnectionsStore();
export { connectionStore as connections };
