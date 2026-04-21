# Core types & constants

Shared data shapes (connections, tabs, files) and package-wide constants.

Sources: `src/lib/types.ts`, `src/lib/constants.ts`.

## Types

### `FileEntry`

```ts
interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: number;   // unix timestamp in milliseconds
  extension: string;
}
```

A single file or directory entry returned by any `StorageAdapter.list` / `list_page` / `head`. `extension` is lowercase without the leading dot (empty string for directories and extensionless files).

### `Connection`

```ts
interface Connection {
  id: string;
  name: string;
  provider: string;       // same ID space as ProviderId
  endpoint: string;
  bucket: string;
  region: string;
  anonymous: boolean;
  authMethod?: 'sigv4' | 'sas-token';
  rootPrefix?: string;
}
```

Persisted connection record. **No credentials** — secrets live only in the session `ConnectionConfig`.

### `ConnectionConfig`

```ts
interface ConnectionConfig {
  name: string;
  provider: string;
  endpoint: string;
  bucket: string;
  region: string;
  access_key?: string;
  secret_key?: string;
  sas_token?: string;
  anonymous: boolean;
  authMethod?: 'sigv4' | 'sas-token';
  rootPrefix?: string;
}
```

Transient form with credentials. Never persist this directly.

### `Tab`

```ts
interface Tab {
  id: string;
  name: string;
  path: string;
  source: 'remote' | 'url';
  connectionId?: string;
  extension: string;       // lowercase, no leading dot
  size?: number;
  sourceRef?: string;      // FROM-clause ref when reading from a catalog table
}
```

Represents one open viewer tab. When `sourceRef` is set the tab reads from a DuckDB/DuckLake FROM expression rather than a file URL — file-only metadata paths (hyparquet prefetch, `parquet_kv_metadata`) are skipped.

### `WriteResult`

```ts
interface WriteResult {
  key: string;
  size: number;
  e_tag?: string;
}
```

Returned from every `StorageAdapter` write method (`put`, `copy`).

### `Theme`

```ts
type Theme = 'light' | 'dark' | 'system';
```

## Constants

### `STORAGE_KEYS`

```ts
const STORAGE_KEYS = {
  SETTINGS: 'obstore-explore-settings',
  CONNECTIONS: 'obstore-explore-connections',
  QUERY_HISTORY: 'obstore-explore-query-history',
} as const;
```

Namespace for localStorage keys. Always use these when persisting app state with [`persistToStorage`](./local-storage.md#persisttostorage-key-value) / [`loadFromStorage`](./local-storage.md#loadfromstoragetkey-defaultvalue).

### `WGS84_CODES`

```ts
const WGS84_CODES: Set<number>;   // { 4326, 4979 }
```

EPSG codes considered equivalent to WGS84. Use to short-circuit reprojection.

### `DEFAULT_TARGET_CRS`

```ts
const DEFAULT_TARGET_CRS = 'OGC:CRS84';
```

Canonical target for DuckDB `ST_Transform`. OGC:CRS84 (longitude, latitude) matches GeoParquet 1.1+ and is functionally equivalent to EPSG:4326 under `geometry_always_xy = true`.

### `DUCKDB_INIT_TIMEOUT_MS`

```ts
const DUCKDB_INIT_TIMEOUT_MS = 30_000;
```

Max milliseconds the DuckDB-WASM worker has to boot before the UI surfaces an error.

### `MAX_QUERY_HISTORY_ENTRIES`

```ts
const MAX_QUERY_HISTORY_ENTRIES = 200;
```

LRU cap for persisted query history.

### `SQL_PREVIEW_LENGTH`

```ts
const SQL_PREVIEW_LENGTH = 120;
```

Characters used for SQL previews in the query history list.

### `VIEWER_DIR_EXTENSIONS`

```ts
const VIEWER_DIR_EXTENSIONS: Set<string>;   // { 'zarr', 'zr3' }
```

Extensions that open as a viewer even though the path is a directory (Zarr stores).

### `LAYER_HUE_MULTIPLIER`

```ts
const LAYER_HUE_MULTIPLIER = 137;
```

Golden-angle-based hue step (137° ≈ 360° × (1 − 1/φ)). Multiply by layer index to get visually distinct hues.

### `COPY_FEEDBACK_MS`

```ts
const COPY_FEEDBACK_MS = 2000;
```

Duration of the "Copied!" confirmation state on copy-to-clipboard buttons.
