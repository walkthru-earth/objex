/**
 * Framework-agnostic helper that wires a "click on map, run a probe, surface the
 * result" flow used by every COG-style viewer (`CogViewer`, `StacMosaicViewer`,
 * `MultiCogViewer`).
 *
 * The viewers differ in what the probe returns (a single pixel sample, a per-
 * channel fan-out, or a topmost-source bbox hit), but they share the same
 * boilerplate: subscribe to `click`, mark inspecting, await the probe, surface
 * the payload, abort the previous probe if a new click arrives mid-flight, and
 * tear the listener down on cleanup.
 *
 * No dependency on Svelte, MapLibre, or deck.gl. The `MapLike` shape captures
 * only what the helper needs from the underlying map so this can be unit-tested
 * with a tiny stub if needed.
 */
export interface PixelInspectClickEvent {
	lngLat: { lng: number; lat: number };
}

export type PixelInspectClickHandler = (event: PixelInspectClickEvent) => void;

/**
 * Minimal subset of MapLibre's map API used by the inspector. Anything that
 * dispatches a `click` event with `{lngLat}` and supports symmetric on/off
 * registration plugs in.
 */
export interface MapLike {
	on(type: 'click', handler: PixelInspectClickHandler): unknown;
	off(type: 'click', handler: PixelInspectClickHandler): unknown;
}

export interface PixelInspectProbeRequest {
	lng: number;
	lat: number;
	signal: AbortSignal;
}

export type PixelInspectProbe<T> = (req: PixelInspectProbeRequest) => Promise<T | null>;

export interface PixelInspectCallbacks<T> {
	/** Called synchronously when a click is accepted, before the probe is awaited. */
	onStart(): void;
	/**
	 * Called once per click after the probe settles. Receives `null` when the
	 * probe returned `null` or threw a non-helper-driven error (including an
	 * `AbortError` that did not originate from this helper's own controller).
	 */
	onResult(result: T | null): void;
}

export interface AttachPixelInspectorOptions<T> {
	probe: PixelInspectProbe<T>;
	onStart: PixelInspectCallbacks<T>['onStart'];
	onResult: PixelInspectCallbacks<T>['onResult'];
}

/**
 * Wire a click-to-inspect probe onto `map`. Returns a `detach()` function that
 * removes the listener AND aborts any in-flight probe. Subsequent clicks abort
 * the previous probe so a fast double-click never leaves a stale result behind.
 */
export function attachPixelInspector<T>(
	map: MapLike,
	{ probe, onStart, onResult }: AttachPixelInspectorOptions<T>
): () => void {
	let active: AbortController | null = null;
	let detached = false;

	const handler: PixelInspectClickHandler = (event) => {
		if (detached) return;
		// A fast second click cancels the first probe via its own controller. The
		// helper-owned signal is what `isHelperAbort()` checks below so we can
		// distinguish "the user clicked again" (swallow) from "an upstream signal
		// aborted us mid-flight" (still surface as `null`, matches old behavior).
		if (active) active.abort();
		const ctrl = new AbortController();
		active = ctrl;
		onStart();
		void (async () => {
			let payload: T | null = null;
			try {
				payload = await probe({
					lng: event.lngLat.lng,
					lat: event.lngLat.lat,
					signal: ctrl.signal
				});
			} catch (err) {
				// Swallow only this helper's own abort (a newer click superseded us).
				// Any other AbortError (viewer teardown, upstream cancel) still flows
				// through to `onResult(null)` to match the pre-refactor behavior of
				// each viewer's catch block.
				if (isHelperAbort(err, ctrl.signal)) return;
				payload = null;
			}
			if (ctrl.signal.aborted && active === ctrl) {
				// Helper-owned abort that arrived while we were awaiting: another
				// click is already running. Don't double-emit.
				return;
			}
			if (active === ctrl) active = null;
			onResult(payload);
		})();
	};

	map.on('click', handler);

	return function detach(): void {
		if (detached) return;
		detached = true;
		map.off('click', handler);
		if (active) {
			active.abort();
			active = null;
		}
	};
}

function isHelperAbort(err: unknown, signal: AbortSignal): boolean {
	if (!signal.aborted) return false;
	if (err instanceof DOMException && err.name === 'AbortError') return true;
	if (err && typeof err === 'object' && (err as { name?: string }).name === 'AbortError') {
		return true;
	}
	return false;
}
