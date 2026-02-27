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

| File | Exports |
|------|---------|
| `index.ts` | `getFileTypeInfo()`, `getDuckDbReadFn()`, `buildDuckDbSource()`, `isCloudNativeFormat()`, `getViewerKind()`, `isQueryable()`, `getMimeType()` |
| `FileTypeIcon.svelte` | Icon component (Lucide icons by category) |

Types: `FileCategory`, `ViewerKind`, `DuckDbReadFn`, `FileTypeInfo` (interface).
Published to npm. No Svelte dependency in `index.ts`.
