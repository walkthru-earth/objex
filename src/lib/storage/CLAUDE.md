# storage/

Cloud storage adapters. All implement `StorageAdapter` interface.

```mermaid
graph LR
    P[providers.ts<br/>Registry: 13 providers] --> B & US & HD
    A[StorageAdapter] --> B[BrowserCloudAdapter<br/>S3/GCS + all S3-compatible]
    A --> C[BrowserAzureAdapter<br/>Azure Blob + SAS]
    A --> D[UrlAdapter<br/>direct HTTPS, read-only]
    E[index.ts<br/>getAdapter / clearAdapterCache] --> B & C & D
    B & C --> F[stores/connections]
    B & C --> G[stores/credentials]
    US[url-state.ts] --> P
    HD[host-detection.ts] --> P
```

| File | Exports | Used by |
|------|---------|---------|
| `providers.ts` | `PROVIDERS`, `PROVIDER_IDS`, `ProviderId`, `ProviderDef`, `getProvider()`, `buildEndpointFromTemplate()`, `buildProviderBaseUrl()`, `isGcsProvider()` | ConnectionDialog, browser-cloud, url-state, host-detection, url.ts |
| `adapter.ts` | `StorageAdapter` (interface), `ListPage` | lib/index.ts (npm export) |
| `browser-cloud.ts` | `BrowserCloudAdapter` | index.ts (factory) |
| `browser-azure.ts` | `BrowserAzureAdapter` | index.ts (factory) |
| `url-adapter.ts` | `UrlAdapter` | lib/index.ts (npm export) |
| `index.ts` | `getAdapter()`, `clearAdapterCache()` | stores/browser, FileTreeSidebar, ArchiveViewer, ModelViewer, DatabaseViewer, MediaViewer, PdfViewer, RawViewer, MarkdownViewer, NotebookViewer, MapViewer, CodeViewer, ImageViewer |

`adapter.ts` and `url-adapter.ts` use relative imports (not `$lib`) — they're published to npm.

## Provider Registry (`providers.ts`)

Single source of truth for all 13 providers: S3, GCS, R2, Azure, B2, DigitalOcean, Wasabi, Storj, Hetzner, Contabo, Linode, OVHcloud, MinIO.

Each `ProviderDef` has: label, description, authMethod, needsRegion, needsEndpoint, defaultRegion, endpointTemplate (`{region}` placeholder), regions array, endpointPlaceholder, schemes.

To add a new provider: add entry to `PROVIDERS`, add ID to `ProviderId` union and `PROVIDER_IDS` array. If it has a distinctive URL pattern, also update `storage-url.ts` and `host-detection.ts`.
