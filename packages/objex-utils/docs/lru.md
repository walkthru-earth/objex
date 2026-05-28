# LruCache

Tiny insertion-order LRU built on top of `Map`, with move-to-end on read and an optional eviction callback.

Source: `packages/objex-utils/src/lru.ts`.

## Types

### `LruCacheOptions<K, V>`

```ts
interface LruCacheOptions<K, V> {
  max: number;
  onEvict?: (key: K, value: V) => void;
}
```

- `max` -- maximum number of entries. Must be `> 0`. The constructor throws `Error('LruCache: max must be > 0')` for any non-positive value.
- `onEvict` -- optional callback invoked whenever an entry leaves the cache, whether through LRU overflow, an explicit `delete()`, or `clear()`. Use it to release the cached resource (revoke a blob URL, null a GeoTIFF header, etc.).

## Class

### `LruCache<K, V>`

```ts
class LruCache<K, V> {
  constructor(opts: LruCacheOptions<K, V>);
  readonly max: number;
  get size(): number;
  has(key: K): boolean;
  get(key: K): V | undefined;
  set(key: K, value: V): void;
  delete(key: K): boolean;
  clear(): void;
}
```

A small bounded cache keyed on any value `Map` accepts. Recency is tracked by insertion order in the backing `Map`, so the oldest key is always the first one returned by `keys()`.

| Member | Semantics |
|--------|-----------|
| `max` | The configured cap, exposed read-only so callers can match a deck.gl `maxCacheSize` to it. |
| `size` | Current number of entries. |
| `has(key)` | `true` when the key is present. Does NOT change recency. |
| `get(key)` | Returns the value or `undefined`. On a hit the entry is deleted and re-inserted so it becomes the most-recent slot (move-to-end). |
| `set(key, value)` | Inserts or updates. An existing key is deleted first so the new write lands as most-recent. After insertion the cache evicts the oldest entries one at a time, calling `onEvict(key, value)` for each, until `size <= max`. |
| `delete(key)` | Removes a single entry. Returns `false` if the key was absent (and `onEvict` is not called), `true` after removal (and `onEvict` runs). |
| `clear()` | Removes every entry. When `onEvict` is set it fires once per entry before the backing `Map` is emptied. |

**Edge cases**

- A `get` on a missing key returns `undefined` and leaves recency untouched.
- A value of `undefined` is indistinguishable from a miss in `get`, since both return `undefined`. Use `has()` first if you need to store `undefined` values.
- `set` only evicts after the write, so writing into a full cache momentarily holds `max + 1` entries before trimming back to `max`.
- `onEvict` runs synchronously inside `set` / `delete` / `clear`, so keep it cheap and non-throwing.

## Example

```ts
import { LruCache } from '@walkthru-earth/objex-utils';

// Bound a per-source presigned-URL cache so panning does not leak.
const presignCache = new LruCache<string, string>({
  max: 64,
  onEvict: (href) => console.debug('evicted presign for', href)
});

presignCache.set('s3://bucket/a.tif', 'https://signed-a');
presignCache.set('s3://bucket/b.tif', 'https://signed-b');

// A read promotes the entry to most-recent.
const signed = presignCache.get('s3://bucket/a.tif');

// Explicit eviction when deck.gl unloads the matching tile.
presignCache.delete('s3://bucket/b.tif');
```
