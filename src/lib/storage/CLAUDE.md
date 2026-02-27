# storage/

Cloud storage adapters. All implement `StorageAdapter` interface.

```mermaid
graph LR
    A[StorageAdapter] --> B[BrowserCloudAdapter<br/>S3/GCS/R2/MinIO/Storj]
    A --> C[BrowserAzureAdapter<br/>Azure Blob + SAS]
    A --> D[UrlAdapter<br/>direct HTTPS, read-only]
    E[index.ts<br/>getAdapter / clearAdapterCache] --> B & C & D
    B & C --> F[stores/connections]
    B & C --> G[stores/credentials]
```

| File | Exports |
|------|---------|
| `adapter.ts` | `StorageAdapter` (interface), `ListPage` |
| `browser-cloud.ts` | `BrowserCloudAdapter` — S3-compatible (aws4fetch SigV4) |
| `browser-azure.ts` | `BrowserAzureAdapter` — Azure Blob (SAS token auth) |
| `url-adapter.ts` | `UrlAdapter` — direct HTTPS fetch, no auth |
| `index.ts` | `getAdapter()`, `clearAdapterCache()` — factory + LRU cache |

`adapter.ts` and `url-adapter.ts` use relative imports (not `$lib`) — they're published to npm.
