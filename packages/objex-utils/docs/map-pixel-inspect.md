# map-pixel-inspect

Framework-agnostic click-to-inspect helper that wires a map `click` event to an async probe, with per-click abort coordination.

Source: `packages/objex-utils/src/map-pixel-inspect.ts`.

This module has no dependency on Svelte, MapLibre, or deck.gl. The `MapLike` shape captures only the on/off surface the helper needs, so the flow can be unit-tested against a tiny stub. It factors out the "subscribe to click, mark inspecting, await the probe, surface the payload, abort the previous probe if a new click arrives mid-flight, tear down on cleanup" boilerplate shared by the COG-style viewers (`CogViewer`, `StacMosaicViewer`, `MultiCogViewer`).

## Types

### `PixelInspectClickEvent` / `PixelInspectClickHandler`

```ts
interface PixelInspectClickEvent {
  lngLat: { lng: number; lat: number };
}

type PixelInspectClickHandler = (event: PixelInspectClickEvent) => void;
```

The minimal click payload the helper reads. Only `lngLat.lng` and `lngLat.lat` are consumed.

### `MapLike`

```ts
interface MapLike {
  on(type: 'click', handler: PixelInspectClickHandler): unknown;
  off(type: 'click', handler: PixelInspectClickHandler): unknown;
}
```

Minimal subset of MapLibre's map API. Anything that dispatches a `click` event carrying `{ lngLat }` and supports symmetric `on` / `off` registration plugs in. Return values of `on` / `off` are ignored (`unknown`).

### `PixelInspectProbeRequest` / `PixelInspectProbe<T>`

```ts
interface PixelInspectProbeRequest {
  lng: number;
  lat: number;
  signal: AbortSignal;
}

type PixelInspectProbe<T> = (req: PixelInspectProbeRequest) => Promise<T | null>;
```

Your probe receives the clicked coordinate plus a per-click `AbortSignal`. Thread the `signal` into every `fetch()` / range read the probe issues so a superseding click cancels the in-flight work. Resolve to the inspect payload, or to `null` when there is nothing to report at that location.

### `PixelInspectCallbacks<T>`

```ts
interface PixelInspectCallbacks<T> {
  onStart(): void;
  onResult(result: T | null): void;
}
```

- `onStart()` - called synchronously when a click is accepted, before the probe is awaited. Use it to set an "inspecting" flag.
- `onResult(result)` - called once per accepted click after the probe settles. Receives `null` when the probe returned `null` or threw a non-helper-driven error, including an `AbortError` that did NOT originate from this helper's own controller (for example a viewer-teardown or upstream cancel). It is NOT called when a newer click superseded this one via the helper's own controller.

### `AttachPixelInspectorOptions<T>`

```ts
interface AttachPixelInspectorOptions<T> {
  probe: PixelInspectProbe<T>;
  onStart: PixelInspectCallbacks<T>['onStart'];
  onResult: PixelInspectCallbacks<T>['onResult'];
}
```

The options bag for `attachPixelInspector`. Flattens the callbacks so the call site reads as a single object.

## Functions

### `attachPixelInspector<T>(map, options)`

```ts
function attachPixelInspector<T>(
  map: MapLike,
  { probe, onStart, onResult }: AttachPixelInspectorOptions<T>
): () => void
```

Wire a click-to-inspect probe onto `map`. Returns a `detach()` function.

On each accepted click the helper:

1. Aborts the previous click's controller, if a probe is still in flight.
2. Creates a fresh `AbortController` for this click and calls `onStart()` synchronously.
3. Awaits `probe({ lng, lat, signal })`.
4. Calls `onResult(payload)` exactly once, unless this click was itself superseded by a newer click.

**Abort semantics**

- A fast second click cancels the first probe via the first probe's own controller. That helper-owned abort is swallowed (no `onResult`), so a stale result never lands after the click that replaced it.
- Any other `AbortError` (viewer teardown, an upstream signal) still flows through to `onResult(null)`, matching the pre-refactor behavior of each viewer's catch block.
- The distinction is made by `isHelperAbort()`, an internal guard that checks whether the helper's own signal aborted and whether the error is a `DOMException` named `AbortError` or any object with `name === 'AbortError'`. `isHelperAbort` is not exported.

**`detach()`**

The returned function removes the `click` listener AND aborts any in-flight probe. It is idempotent (a second call is a no-op) and after detach all further clicks are ignored.

## Example

```ts
import { attachPixelInspector } from '@walkthru-earth/objex-utils';

interface PixelSample {
  band: number;
  value: number;
}

let inspecting = false;
let sample: PixelSample | null = null;

const detach = attachPixelInspector<PixelSample>(map, {
  probe: async ({ lng, lat, signal }) => {
    const px = await readPixelAtLngLat(geotiff, lng, lat, { signal });
    if (!px) return null;
    return { band: 0, value: px.value };
  },
  onStart: () => {
    inspecting = true;
  },
  onResult: (result) => {
    inspecting = false;
    sample = result; // null when nothing was found at that point
  }
});

// On viewer cleanup: removes the listener and aborts the in-flight probe.
detach();
```
