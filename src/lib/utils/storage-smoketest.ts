/**
 * Open-time storage probe. Issues a single ranged GET against a presigned
 * asset URL to surface auth, CORS, and bucket-misconfiguration errors at
 * viewer load time, before any tile read kicks off.
 *
 * Inspired by lazycogs `_smoketest_store` (developmentseed/lazycogs). The
 * Python library calls `store.head()` on a representative asset during
 * `open()` so credential or region misconfiguration fails in <1s instead of
 * mid-mosaic when the first COG range fetch errors out.
 *
 * We use ranged GET instead of HEAD because:
 *   - Many private buckets allow GET but block HEAD via CORS.
 *   - Range `bytes=0-0` is one byte, cheaper than a full body fetch.
 *   - Successful 206 / 200 confirms BOTH auth and CORS headers are correct,
 *     which a HEAD response sometimes lies about under bucket policies that
 *     return mismatched `Access-Control-Expose-Headers`.
 *
 * Pure TS, no Svelte / framework deps. Safe to publish via objex-utils.
 */

export type SmokeTestResult = { ok: true } | { ok: false; status: number | null; reason: string };

/**
 * Probe a presigned URL with a one-byte Range GET. Resolves to `{ ok: true }`
 * on 200 / 206, otherwise returns a structured failure with the HTTP status
 * (or null when the request never reached a server, e.g. CORS preflight
 * failure or DNS error). AbortError is re-thrown so callers can distinguish
 * intentional cancellation from real failures.
 */
export async function smokeTestHref(href: string, signal?: AbortSignal): Promise<SmokeTestResult> {
	let response: Response;
	try {
		response = await fetch(href, {
			method: 'GET',
			headers: { Range: 'bytes=0-0' },
			signal,
			redirect: 'follow'
		});
	} catch (err) {
		if (err instanceof DOMException && err.name === 'AbortError') throw err;
		const reason = err instanceof Error ? err.message : String(err);
		return { ok: false, status: null, reason };
	}
	if (response.ok || response.status === 206) {
		await response.body?.cancel().catch(() => {});
		return { ok: true };
	}
	const reason = `${response.status} ${response.statusText || ''}`.trim();
	return { ok: false, status: response.status, reason };
}
