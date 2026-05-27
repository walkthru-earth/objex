/**
 * Generic localStorage helpers with SSR safety.
 *
 * Used by connection, settings, and query-history stores to avoid
 * repeating the same load/persist/try-catch/SSR-guard pattern.
 */

/**
 * Load a JSON value from localStorage.
 * Returns `defaultValue` on SSR, missing key, or parse error.
 */
export function loadFromStorage<T>(key: string, defaultValue: T): T {
	if (typeof window === 'undefined') return defaultValue;
	try {
		const raw = localStorage.getItem(key);
		if (raw) return JSON.parse(raw) as T;
	} catch {
		// ignore parse errors
	}
	return defaultValue;
}

/**
 * Persist a JSON-serializable value to localStorage.
 * Silently no-ops on SSR or storage errors (quota, private browsing).
 */
export function persistToStorage(key: string, value: unknown): void {
	if (typeof window === 'undefined') return;
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// ignore storage errors
	}
}
