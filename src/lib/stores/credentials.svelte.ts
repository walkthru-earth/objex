/**
 * In-memory credential store.
 *
 * Credentials are held only in memory — they are never persisted to
 * localStorage or any other durable storage — so a page refresh clears them.
 *
 * The Credential Management API helpers (`storeToNative` / `loadFromNative`)
 * allow the browser's built-in password manager to save and restore
 * credentials across page refreshes (Chrome/Edge; silent no-op elsewhere).
 */

export interface SigV4Credentials {
	type: 'sigv4';
	accessKey: string;
	secretKey: string;
}

export interface AzureCredentials {
	type: 'sas-token';
	sasToken: string;
}

export type Credentials = SigV4Credentials | AzureCredentials;

const store = new Map<string, Credentials>();

export const credentialStore = {
	/** Store credentials for a connection. */
	set(connectionId: string, creds: Credentials): void {
		store.set(connectionId, creds);
	},

	/** Retrieve credentials for a connection (or undefined). */
	get(connectionId: string): Credentials | undefined {
		return store.get(connectionId);
	},

	/** Remove credentials for a connection. */
	remove(connectionId: string): void {
		store.delete(connectionId);
	},

	/** Check whether credentials exist for a connection. */
	has(connectionId: string): boolean {
		return store.has(connectionId);
	},

	/** Remove all stored credentials. */
	clear(): void {
		store.clear();
	}
};

// ---------------------------------------------------------------------------
// Credential Management API helpers (Chrome / Edge — silent fallback elsewhere)
// ---------------------------------------------------------------------------

// PasswordCredential is not in all TS lib targets — declare the subset we use.
declare global {
	interface PasswordCredentialData {
		id: string;
		name?: string;
		password: string;
	}
	interface PasswordCredential extends Credential {
		readonly password: string;
	}
	// eslint-disable-next-line no-var
	var PasswordCredential:
		| {
				prototype: PasswordCredential;
				new (data: PasswordCredentialData): PasswordCredential;
		  }
		| undefined;
}

/**
 * Persist credentials to the browser's native password manager.
 * Uses PasswordCredential (Chrome/Edge). Silently no-ops on unsupported browsers.
 */
export async function storeToNative(connectionId: string, creds: Credentials): Promise<void> {
	try {
		if (typeof PasswordCredential === 'undefined' || !navigator.credentials?.store) return;

		const password = JSON.stringify(creds);
		const pc = new PasswordCredential({
			id: connectionId,
			password,
			name: `obstore:${connectionId}`
		});
		await navigator.credentials.store(pc);
	} catch {
		// Silent fallback — Credential Management API is best-effort
	}
}

/**
 * Attempt to load credentials from the browser's native password manager.
 * Returns the deserialized Credentials, or undefined if unavailable.
 */
export async function loadFromNative(connectionId: string): Promise<Credentials | undefined> {
	try {
		if (typeof PasswordCredential === 'undefined' || !navigator.credentials?.get) return undefined;

		const credential = await navigator.credentials.get({
			password: true,
			mediation: 'silent'
		} as CredentialRequestOptions);

		if (!credential || credential.type !== 'password') return undefined;
		const pc = credential as PasswordCredential;
		if (pc.id !== connectionId || !pc.password) return undefined;

		const parsed = JSON.parse(pc.password) as Credentials;
		if (parsed.type === 'sigv4' || parsed.type === 'sas-token') return parsed;
	} catch {
		// Silent fallback
	}
	return undefined;
}
