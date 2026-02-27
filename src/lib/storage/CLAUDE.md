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

| File | Exports | Used by |
|------|---------|---------|
| `adapter.ts` | `StorageAdapter` (interface), `ListPage` | lib/index.ts (npm export) |
| `browser-cloud.ts` | `BrowserCloudAdapter` | index.ts (factory) |
| `browser-azure.ts` | `BrowserAzureAdapter` | index.ts (factory) |
| `url-adapter.ts` | `UrlAdapter` | lib/index.ts (npm export) |
| `index.ts` | `getAdapter()`, `clearAdapterCache()` | stores/browser, FileTreeSidebar, ArchiveViewer, ModelViewer, DatabaseViewer, MediaViewer, PdfViewer, RawViewer, MarkdownViewer, NotebookViewer, MapViewer, CodeViewer, ImageViewer |

`adapter.ts` and `url-adapter.ts` use relative imports (not `$lib`) — they're published to npm.
