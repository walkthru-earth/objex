# Storage

URL parsing, provider registry, and the `StorageAdapter` contract.

Sources:

- `src/lib/utils/storage-url.ts` — generic URL / bucket parser
- `src/lib/utils/cloud-url.ts` — cloud-scheme → HTTPS resolver
- `src/lib/storage/providers.ts` — provider registry + access-mode logic
- `src/lib/storage/adapter.ts` — the `StorageAdapter` interface
- `src/lib/storage/url-adapter.ts` — adapter for arbitrary HTTPS URLs

## URL parsing

### `parseStorageUrl(input, defaults?)`

```ts
function parseStorageUrl(
  input: string,
  defaults?: Defaults
): ParsedStorageUrl
```

Universal parser for any bucket / cloud URL a user might paste. Accepted formats:

- URI schemes: `s3://`, `s3a://`, `s3n://`, `r2://`, `gs://`, `gcs://`, `azure://`, `az://`, `abfs://`, `abfss://`, `wasbs://`, `swift://`, `file://`
- AWS S3 virtual-hosted, path-style, global URLs (region auto-detected from host)
- Cloudflare R2, Google Cloud Storage, Azure, DigitalOcean Spaces, Wasabi, Backblaze B2, Alibaba OSS, Tencent COS, Yandex, Storj, Contabo, Hetzner, Linode, OVHcloud, MinIO
- Generic custom endpoints
- Plain bucket names (defaults to `s3`)

**Types**

```ts
interface ParsedStorageUrl {
  bucket: string;
  region: string;
  endpoint: string;
  provider: StorageProvider;   // same ID space as ProviderId (see below)
  prefix: string;              // path after bucket (may be '')
}

interface Defaults {
  region?: string;
  endpoint?: string;
  provider?: StorageProvider;
}
```

**Example**

```ts
parseStorageUrl('s3://us-west-2.my-bucket/data/*.parquet');
// {
//   provider: 's3',
//   bucket: 'my-bucket',
//   region: 'us-west-2',
//   endpoint: 'https://s3.us-west-2.amazonaws.com',
//   prefix: 'data/*.parquet'
// }
```

### `looksLikeUrl(input)`

```ts
function looksLikeUrl(input: string): boolean
```

Return `true` if `input` resembles a URL/URI rather than a plain bucket name. Useful to decide whether to pass it to `parseStorageUrl`.

### `describeParseResult(parsed)`

```ts
function describeParseResult(parsed: ParsedStorageUrl): string
```

Build a human-readable summary of a parse result (bucket, endpoint, region, provider, prefix). Used in the objex UI but safe to render anywhere.

### `resolveCloudUrl(url)`

```ts
function resolveCloudUrl(url: string): string
```

Convert a cloud-protocol URL to an HTTPS URL that any fetch client can handle.

| Input | Output |
|-------|--------|
| `s3://bucket/key` | `https://bucket.s3.<region>.amazonaws.com/key` — region auto-detected from host prefix (e.g. `us-west-2.opendata.source.coop`), or `us-east-1` as fallback |
| `gs://bucket/key` | `https://storage.googleapis.com/bucket/key` |
| `http(s)://...` | returned unchanged |
| Anything else | returned unchanged |

### `getNativeScheme(provider)`

```ts
function getNativeScheme(provider: string): string
```

Map a provider ID to its canonical URI scheme prefix (first entry in the provider registry). Falls back to `'s3'` for unknown S3-compatible providers.

### `safeDecodeURIComponent(s)`

```ts
function safeDecodeURIComponent(s: string): string
```

Percent-decode a URL component without throwing on malformed input. Returns the original string if decoding fails.

## Provider registry

### `ProviderId`

```ts
type ProviderId =
  | 's3' | 'gcs' | 'r2' | 'minio' | 'azure' | 'storj' | 'b2'
  | 'digitalocean' | 'wasabi' | 'contabo' | 'hetzner' | 'linode' | 'ovhcloud';
```

### `ProviderDef`

```ts
interface ProviderDef {
  label: string;                          // "Amazon S3"
  description: string;                    // short helper text for UI
  authMethod: 'sigv4' | 'sas-token';
  needsRegion: boolean;
  needsEndpoint: boolean;
  defaultRegion: string;
  endpointTemplate: string | null;        // may contain {region}
  regions: ProviderRegion[];
  bucketLabel?: string;                   // e.g. Azure uses "Container"
  endpointPlaceholder: string;
  schemes: string[];                      // e.g. ['s3', 's3a', 's3n']
}

interface ProviderRegion {
  code: string;
  label: string;
}
```

### Registry exports

```ts
const PROVIDERS: Record<ProviderId, ProviderDef>;
const PROVIDER_IDS: ProviderId[];
```

`PROVIDER_IDS` is the display order used in the objex connection dialog.

### Helpers

```ts
function getProvider(id: string): ProviderDef;
function buildEndpointFromTemplate(id: ProviderId, region: string): string;
function resolveProviderEndpoint(provider: string, region?: string): string;
function buildProviderBaseUrl(
  provider: ProviderId,
  endpoint: string,
  bucket: string,
  region: string
): string;
function isGcsProvider(provider: string, endpoint: string): boolean;
```

| Function | Semantics |
|----------|-----------|
| `getProvider` | Unknown IDs fall back to the S3 entry (never throws). |
| `buildEndpointFromTemplate` | Substitute `{region}` in the provider's template. |
| `resolveProviderEndpoint` | Same as `buildEndpointFromTemplate` but accepts an untyped `provider` string and falls back to the provider's `defaultRegion` when `region` is omitted. Returns `''` for providers without a template (plain S3, MinIO). |
| `buildProviderBaseUrl` | Produce the HTTPS base URL for API requests (endpoint + bucket, correctly interleaved for virtual-host vs path-style). |
| `isGcsProvider` | `true` when the connection uses the GCS JSON API rather than S3 XML — used to pick adapter implementation. |

### Access mode

```ts
type AccessMode = 'public-https' | 'sas-https' | 'signed-s3';

function getAccessMode(conn: AccessModeInput): AccessMode;
function isPubliclyStreamable(conn: AccessModeInput): boolean;
```

`AccessMode` is the single source of truth for how an HTTP client (DuckDB httpfs, MapLibre, fetch) should read the connection's files:

| Mode | Meaning |
|------|---------|
| `'public-https'` | Plain HTTPS, no signing — anonymous S3, GCS, R2, public MinIO, etc. |
| `'sas-https'` | HTTPS with SAS token appended to the URL — Azure. |
| `'signed-s3'` | Requires SigV4 signing — authenticated S3-compatible connections. |

`isPubliclyStreamable` is `true` for `'public-https'` and `'sas-https'` (anything a plain `fetch()` / `<img>` / `<video>` can reach directly).

## StorageAdapter

### Interface

```ts
interface StorageAdapter {
  list(path: string, signal?: AbortSignal): Promise<FileEntry[]>;
  read(
    path: string,
    offset?: number,
    length?: number,
    signal?: AbortSignal
  ): Promise<Uint8Array>;
  head(path: string, signal?: AbortSignal): Promise<FileEntry>;
  listPage?(
    path: string,
    continuationToken?: string,
    pageSize?: number,
    signal?: AbortSignal
  ): Promise<ListPage>;
  put(key: string, data: Uint8Array, contentType?: string): Promise<WriteResult>;
  delete(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<{ deleted: number }>;
  copy(srcKey: string, destKey: string): Promise<WriteResult>;
  readonly supportsWrite: boolean;
}

interface ListPage {
  entries: FileEntry[];
  continuationToken?: string;
  hasMore: boolean;
}
```

See [`types-constants.md`](./types-constants.md#fileentry) for `FileEntry` and `WriteResult`.

**Conventions**

- `signal` is propagated all the way to the underlying `fetch()`. Callers should always pass an `AbortController.signal` so tab switches / cleanups don't leak requests.
- `read(path, offset, length)` uses HTTP Range when supported; omitting offset/length reads the whole object.
- `listPage` is optional — read-heavy viewers (e.g. paginated browser) should feature-detect it.
- Read-only adapters should throw a native `Error` from write methods and set `supportsWrite = false`.

### `UrlAdapter`

```ts
class UrlAdapter implements StorageAdapter {
  readonly supportsWrite = false;

  read(url: string, offset?: number, length?: number, signal?: AbortSignal): Promise<Uint8Array>;
  head(url: string, signal?: AbortSignal): Promise<FileEntry>;
  list(): Promise<FileEntry[]>;    // always []
  put(): Promise<WriteResult>;      // throws
  delete(): Promise<void>;           // throws
  deletePrefix(): Promise<{ deleted: number }>;  // throws
  copy(): Promise<WriteResult>;     // throws
}
```

Minimal adapter for arbitrary HTTPS URLs (`tab.source === 'url'`). `path` is the full URL. Supports `read()` (Range requests) and `head()` only. Listing returns an empty array, writes throw. Use when you have a raw HTTPS link and do not need connection credentials.
