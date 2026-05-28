# STAC Storage Extension

Parser for the STAC Storage Extension (v1.0.0 and v2.0.0) that extracts connection-relevant hints (region, requester-pays, custom-S3 endpoint) from a STAC Item. Pure TypeScript, no fetch, no Svelte dependency.

Source: `packages/objex-utils/src/stac-storage-extension.ts`.

Inspired by lazycogs's `_storage_ext.py`. Recognized schema URLs:

- `https://stac-extensions.github.io/storage/v1.0.0/schema.json`
- `https://stac-extensions.github.io/storage/v2.0.0/schema.json`

The two versions carry storage metadata in different places:

- **v1** stores fields directly on item `properties` and/or per-asset (`storage:platform`, `storage:region`, `storage:requester_pays`, `storage:tier`). Asset-level fields take precedence over item-level fields. `storage:tier` is ignored (no obstore equivalent).
- **v2** stores a scheme map at `properties.storage:schemes` keyed by ref name, and each asset references one or more schemes via `storage:refs`. The first matching ref wins.

## Types

### `StorageExtensionVersion`

```ts
type StorageExtensionVersion = '1.0.0' | '2.0.0';
```

The two Storage Extension schema versions this parser recognizes.

### `StorageHints`

```ts
interface StorageHints {
  platform: string | null;
  region: string | null;
  requesterPays: boolean;
  endpoint: string | null;
}
```

Connection-relevant hints extracted from the Storage Extension. All fields are nullable (except `requesterPays`, which is a plain boolean) so callers can merge selectively into existing config without clobbering user-set values.

| Field | Meaning |
|-------|---------|
| `platform` | Cloud platform, e.g. `'AWS'`, `'GCP'`, `'AZURE'`, `'MINIO'`. Uppercased. Null when absent. |
| `region` | Region code, e.g. `'us-west-2'`. Null when absent. |
| `requesterPays` | `true` when requester-pays must be set. `false` when absent or false. |
| `endpoint` | Concrete S3-compatible endpoint URL. Null unless a v2 `custom-s3` scheme carries a non-templated value. |

## Functions

### `emptyStorageHints()`

```ts
function emptyStorageHints(): StorageHints
```

Return an empty hints record (`platform: null`, `region: null`, `requesterPays: false`, `endpoint: null`). This is what `extractStorageHints` returns when the extension is absent or unparseable, so callers can treat the absent case and the present-but-empty case identically.

### `detectStorageExtensionVersion(item)`

```ts
function detectStorageExtensionVersion(item: StacItem): StorageExtensionVersion | null
```

Scan `item.stac_extensions[]` for the Storage Extension schema URL and return its parsed version.

**Parameters**

| Name | Type | Meaning |
|------|------|---------|
| `item` | `StacItem` | The STAC Item to inspect. `stac_extensions` is read defensively, so a non-array or missing value returns `null`. |

**Returns** `StorageExtensionVersion | null`. Null when the extension is absent or the version is not one we recognize.

**Notes**

- Both the trailing `/schema.json` suffix and a leading `v` on the version segment are stripped before matching.
- An exact `'1.0.0'` or `'2.0.0'` is returned directly. For an unknown patch or minor (a hypothetical `v1.0.1`), the parser falls back to major-version detection: major `1` maps to `'1.0.0'` and major `2` maps to `'2.0.0'`, so the appropriate parse path still runs.

### `extractStorageHints(item, assetKey?)`

```ts
function extractStorageHints(item: StacItem, assetKey?: string): StorageHints
```

Extract connection hints from a STAC Item. Dispatches on the detected Storage Extension version and returns `emptyStorageHints()` when the extension is absent or fails to parse.

**Parameters**

| Name | Type | Meaning |
|------|------|---------|
| `item` | `StacItem` | The STAC Item to parse. |
| `assetKey` | `string` (optional) | Scope the lookup to a specific asset. |

**`assetKey` behavior**

- **v1**: when given, that asset's `storage:*` overrides take precedence over item-level fields. When omitted, only item-level fields are read.
- **v2**: when given, that asset's `storage:refs[0]` (first ref present on the asset) resolves the item scheme. When omitted, the first scheme reachable from any asset's refs wins.

**Returns** `StorageHints`.

**v2 endpoint resolution**

The `endpoint` field is only populated for a scheme whose `type` is `'custom-s3'`. The parser prefers the scheme's explicit `endpoint` string, then falls back to its `platform` string, but only treats either as a concrete endpoint when it contains no URI-template variable (no `{`, e.g. `{region}`). Templated values are left as `null` so the caller does not wire a non-resolvable URL.

### `applyStorageHintsToConnection(conn, hints)`

```ts
function applyStorageHintsToConnection<T extends { region?: string; endpoint?: string }>(
  conn: T,
  hints: StorageHints
): T
```

Merge `region` and `endpoint` hints into a connection-shaped object, filling each field only when the existing value is empty. Returns a shallow copy. The generic accepts any object with optional `region` / `endpoint` keys, so it stays decoupled from the concrete `Connection` type.

**Notes**

- Only `region` and `endpoint` are merged. `platform` and `requesterPays` are not written by this helper.
- An existing non-empty `region` or `endpoint` on `conn` is never overwritten.
- The input object is not mutated; the returned value is a new object.

## Example

```ts
import {
  detectStorageExtensionVersion,
  extractStorageHints,
  applyStorageHintsToConnection,
} from '@walkthru-earth/objex-utils';

const version = detectStorageExtensionVersion(item); // '1.0.0' | '2.0.0' | null

const hints = extractStorageHints(item, 'visual');
// {
//   platform: 'AWS',
//   region: 'us-west-2',
//   requesterPays: false,
//   endpoint: null
// }

// Pre-fill a new connection without clobbering anything the user already set.
const conn = applyStorageHintsToConnection(
  { region: '', endpoint: '' },
  hints
);
// { region: 'us-west-2', endpoint: '' }
```
