---
"@walkthru-earth/objex": minor
"@walkthru-earth/objex-utils": minor
---

Extract framework-agnostic utilities for cross-framework reuse

New exports in both packages:
- **cloud-url**: `resolveCloudUrl()`, `getNativeScheme()`, `safeDecodeURIComponent()` — cloud protocol URL conversion
- **file-sort**: `sortFileEntries()`, `toggleSortField()` — file entry sorting with directory-first precedence
- **local-storage**: `loadFromStorage()`, `persistToStorage()` — generic localStorage helpers with SSR safety
- **export**: `serializeToCsv()`, `serializeToJson()`, `escapeCsvField()` — pure data serialization (Node.js-compatible)
- **markdown-sql**: `parseMarkdownDocument()`, `interpolateTemplates()`, `markSqlBlocks()` — markdown with SQL block parsing
- **providers**: `PROVIDERS`, `PROVIDER_IDS`, `getProvider()`, `buildProviderBaseUrl()`, `buildEndpointFromTemplate()`, `isGcsProvider()` — cloud storage provider registry

Bug fixes:
- Fix `$lib` import in `connections.svelte.ts` testWithConfig cleanup
- Fix missing BigInt handling in CSV/JSON export serialization
