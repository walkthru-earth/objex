# localStorage helpers

SSR-safe JSON persistence on top of `window.localStorage`.

Source: `src/lib/utils/local-storage.ts`.

## Functions

### `loadFromStorage<T>(key, defaultValue)`

```ts
function loadFromStorage<T>(key: string, defaultValue: T): T
```

Load a JSON value from localStorage. Returns `defaultValue` when:

- Running in SSR (`typeof window === 'undefined'`).
- The key is not present.
- `JSON.parse` throws (stored value corrupted).

Never throws.

### `persistToStorage(key, value)`

```ts
function persistToStorage(key: string, value: unknown): void
```

Write a JSON-serializable value to localStorage. No-ops silently when:

- Running in SSR.
- `localStorage.setItem` throws (quota exceeded, private-browsing restrictions, Safari storage partitioning).

Pair with the [`STORAGE_KEYS`](./types-constants.md#storage_keys) constants to keep key strings consistent across the app.

## Example

```ts
import { loadFromStorage, persistToStorage, STORAGE_KEYS } from '@walkthru-earth/objex-utils';

interface Settings {
  theme: 'light' | 'dark' | 'system';
  locale: 'en' | 'ar';
}

const defaults: Settings = { theme: 'system', locale: 'en' };
let settings = loadFromStorage<Settings>(STORAGE_KEYS.SETTINGS, defaults);

// later…
persistToStorage(STORAGE_KEYS.SETTINGS, settings);
```
