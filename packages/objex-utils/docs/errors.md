# Error handling

One function. Normalizes thrown values into a displayable string, with special-casing for `AbortError`.

Source: `packages/objex-utils/src/error.ts`.

## `handleLoadError(err)`

```ts
function handleLoadError(err: unknown): string | null
```

Extract a display message from an unknown caught value.

| Input | Output | Meaning |
|-------|--------|---------|
| `DOMException` with `name === 'AbortError'` | `null` | Caller should silently return — the user cancelled. |
| `Error` with `name === 'AbortError'` (fetch cancel) | `null` | Same as above. |
| Other `Error` | `err.message` | Standard error. |
| Everything else | `String(err)` | Best-effort coercion. |

## Usage pattern

```ts
import { handleLoadError } from '@walkthru-earth/objex-utils';

try {
  data = await adapter.read(path, 0, undefined, signal);
} catch (err) {
  const msg = handleLoadError(err);
  if (msg === null) return;    // aborted — do nothing
  errorState = msg;
}
```
