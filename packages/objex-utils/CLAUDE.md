# objex-utils

Pure TypeScript sub-package. Zero Svelte dependency. Built with tsup (ESM + CJS + DTS).

Developer-facing reference docs live in [`docs/`](./docs/README.md) — one page per module with full signatures, inputs/outputs, and peer-dep notes. Keep them in sync whenever a public export changes.

```mermaid
graph LR
    IDX[src/index.ts] -->|re-exports| SRC["../../src/lib/*"]
    IDX --> TSUP[tsup] --> DIST["dist/index.js<br/>dist/index.cjs<br/>dist/index.d.ts"]
    IDX -. documented in .-> DOCS[docs/*.md]
```

Re-exports from `src/lib/`:
- **types**: `Connection`, `ConnectionConfig`, `FileEntry`, `Tab`, `Theme`, `WriteResult`
- **constants**: `COPY_FEEDBACK_MS`, `DEFAULT_TARGET_CRS`, `DUCKDB_INIT_TIMEOUT_MS`, `LAYER_HUE_MULTIPLIER`, `MAX_QUERY_HISTORY_ENTRIES`, `SQL_PREVIEW_LENGTH`, `STORAGE_KEYS`, `VIEWER_DIR_EXTENSIONS`, `WGS84_CODES`
- **storage/adapter**: `StorageAdapter` (interface), `ListPage` (type)
- **storage/url-adapter**: `UrlAdapter` (class)
- **storage/providers**: `PROVIDERS`, `PROVIDER_IDS`, `ProviderId` (type), `ProviderDef` (type), `ProviderRegion` (type), `AccessMode` (type), `AccessModeInput` (type), `getProvider()`, `buildEndpointFromTemplate()`, `resolveProviderEndpoint()`, `buildProviderBaseUrl()`, `isGcsProvider()`, `getAccessMode()`, `isPubliclyStreamable()`
- **query/engine**: `QueryEngine` (type), `QueryHandle` (type), `QueryResult` (type), `QuerySource` (type), `SchemaField` (type), `MapQueryHandle` (type), `MapQueryResult` (type), `QueryCancelledError` (class)
- **file-icons**: `DuckDbReadFn` (type), `FileCategory` (type), `FileTypeInfo` (type), `ViewerKind` (type), `buildDuckDbSource()`, `getDuckDbReadFn()`, `getFileTypeInfo()`, `getMimeType()`, `getViewerKind()`, `isCloudNativeFormat()`, `isQueryable()`
- **utils/wkb**: `GeoType` (type), `ParsedGeometry` (type), `parseWKB()`, `toBinary()`, `findGeoColumn()`, `findGeoColumnFromRows()`
- **utils/stac-geoparquet**: `StacBboxStruct` (type), `StacGeoparquetRow` (type), `StacGeoparquetSchemaColumn` (type), `StacRowToItemOptions` (type), `STAC_GEOPARQUET_REQUIRED_COLUMNS`, `isStacGeoparquetSchema()`, `flattenStacBbox()`, `resolveStacAssetHref()`, `pickStacPrimaryAsset()`, `stacRowToItem()`. Framework-agnostic — accepts schema descriptors from hyparquet, DuckDB-WASM, Arrow, or any other source. `stacRowToItem` takes a caller-supplied `wkbParser` (re-export `parseWKB` from the same package, or plug in another WKB library).
- **utils/geoarrow**: `GeoArrowGeomType` (type), `GeoArrowResult` (type), `buildGeoArrowTables()`, `normalizeGeomType()`
- **utils/storage-url**: `StorageProvider` (type), `ParsedStorageUrl` (type), `Defaults` (type), `parseStorageUrl()`, `looksLikeUrl()`, `describeParseResult()`
- **utils/parquet-metadata**: `GeoColumnMeta` (type), `GeoParquetMeta` (type), `ParquetFileMetadata` (type), `readParquetMetadata()`, `extractBounds()`, `extractEpsgFromGeoMeta()`, `extractGeometryTypes()`
- **utils/format**: `formatFileSize()`, `formatDate()`, `formatValue()`, `getFileExtension()`, `jsonReplacerBigInt()`
- **utils/hex**: `HexRow` (type), `generateHexDump()`
- **utils/column-types**: `TypeCategory` (type), `classifyType()`, `typeBadgeClass()`, `typeColor()`, `typeLabel()`
- **utils/cloud-url**: `resolveCloudUrl()`, `getNativeScheme()`, `safeDecodeURIComponent()`
- **utils/file-sort**: `SortConfig` (type), `SortDirection` (type), `SortField` (type), `sortFileEntries()`, `toggleSortField()`
- **utils/export**: `serializeToCsv()`, `serializeToJson()`, `escapeCsvField()`, `exportToCsv()`, `exportToJson()`
- **utils/local-storage**: `loadFromStorage()`, `persistToStorage()`
- **utils/markdown-sql**: `ParsedMarkdownDocument` (type), `SqlBlock` (type), `parseMarkdownDocument()`, `interpolateTemplates()`, `markSqlBlocks()`
- **utils/cog-pure**: `CogInfo` (type), `GeoBounds` (type), `SF_LABELS`, `safeClamp()`, `clampBounds()`, `buildDataTypeLabel()`. MUST import from `utils/cog-pure.ts`, NEVER from `utils/cog.ts`. tsup marks `@developmentseed/*` / `proj4` / `maplibre-gl` as external when they appear in the graph and preserves bare side-effect imports for them even after tree-shaking, which breaks consumer Vite pre-bundles on `@developmentseed/epsg/all.csv.gz?url` (see walkthru-earth/objex#11). Keeping the re-export anchored on `cog-pure.ts` guarantees zero heavy imports land in `dist/`. The render-pipeline helpers (`selectCogPipeline`, `createEpsgResolver`, `normalizeCogGeotiff`, `renderNonTiledBitmap`, `fitCogBounds`, etc.) stay in `src/lib/utils/cog.ts` and are **not** re-exported here. Use the full `@walkthru-earth/objex` package if you need them.
- **utils/error**: `handleLoadError()`

**Important**: All re-exported source files must use **relative imports** (not `$lib/`). The `$lib` alias is SvelteKit-only and breaks the tsup build.

- External (not bundled, declared in `tsup.config.ts`): `apache-arrow`, `hyparquet`, `hyparquet-compressors`, `yaml`. These appear as optional peer-deps so consumers can BYO versions.
- `yaml` is loaded lazily via dynamic `import()` inside `parseMarkdownDocument` so the bundle loads without it installed. Keep it this way.
- `@developmentseed/geotiff`, `@developmentseed/epsg`, `@developmentseed/proj`, `maplibre-gl`, `proj4` MUST NOT appear in the import graph. If a new re-export needs them, split the dependency-free surface into a `*-pure.ts` sibling module (same pattern as `cog-pure.ts`) and re-export from there. Never add them to the `external` list, that only hides the problem, tsup emits bare side-effect imports for externalized modules and breaks consumer Vite pre-bundles (see walkthru-earth/objex#11).
- `tsconfig.json` has `rootDir: "../.."` to allow DTS generation across monorepo
- `package.json` `files` must include `dist` and `docs` so the published tarball carries the reference docs.

```bash
pnpm --filter @walkthru-earth/objex-utils run build
```
