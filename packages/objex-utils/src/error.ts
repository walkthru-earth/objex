/**
 * Shared error handling for async viewer load operations.
 */

/**
 * True for any abort cascade. Recognizes raw `DOMException(AbortError)`,
 * objects whose `.name` is `AbortError`, deck.gl's `_SourceError("Failed
 * to fetch")` wrapper whose `cause` is an AbortError, and free-text errors
 * from `@developmentseed/geotiff` that mention "aborted". Used to silence
 * cancellation noise without swallowing real failures.
 */
export function isAbortError(err: unknown): boolean {
	if (!err) return false;
	if (err instanceof DOMException && err.name === 'AbortError') return true;
	const e = err as { name?: string; message?: string; cause?: unknown };
	if (e.name === 'AbortError') return true;
	if (typeof e.message === 'string' && /\baborted?\b/i.test(e.message)) return true;
	if (e.cause && isAbortError(e.cause)) return true;
	return false;
}

/**
 * Extract an error message from an unknown caught value.
 * Returns null for AbortError (caller should silently return).
 */
export function handleLoadError(err: unknown): string | null {
	if (isAbortError(err)) return null;
	return err instanceof Error ? err.message : String(err);
}
