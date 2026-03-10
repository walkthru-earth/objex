/**
 * Shared error handling for async viewer load operations.
 */

/**
 * Extract an error message from an unknown caught value.
 * Returns null for AbortError (caller should silently return).
 */
export function handleLoadError(err: unknown): string | null {
	if (err instanceof DOMException && err.name === 'AbortError') return null;
	return err instanceof Error ? err.message : String(err);
}
