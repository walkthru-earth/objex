# file-icons/

Extension → file type registry. Maps 200+ extensions to viewer, icon, category, DuckDB read function.

```mermaid
graph LR
    EXT[".parquet"] --> FT[getFileTypeInfo]
    FT --> VK[getViewerKind → 'table']
    FT --> DR[getDuckDbReadFn → 'read_parquet']
    FT --> CN[isCloudNativeFormat → true]
    FT --> QR[isQueryable → true]
    FT --> IC[FileTypeIcon.svelte]
```

| File | Exports | Used by |
|------|---------|---------|
| `index.ts` | `getFileTypeInfo()`, `getDuckDbReadFn()`, `buildDuckDbSource()`, `isCloudNativeFormat()`, `getViewerKind()`, `isQueryable()`, `getMimeType()` | StatusBar, FileRow, ViewerRouter, TableViewer, query/wasm, +page.svelte, lib/index.ts |
| `FileTypeIcon.svelte` | Icon component (Lucide icons by category) | FileRow, TabBar |

Types: `FileCategory`, `ViewerKind`, `DuckDbReadFn`, `FileTypeInfo` (interface).
Published to npm. No Svelte dependency in `index.ts`.
