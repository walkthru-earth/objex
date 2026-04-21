# @walkthru-earth/objex

## 1.2.0

### Minor Changes

- [`9ea3cff`](https://github.com/walkthru-earth/objex/commit/9ea3cff508443f09848d1903b7adcc948b4a1202) Thanks [@yharby](https://github.com/yharby)! - Release 1.2.0. Headline changes:

  ### `yaml` is now a truly optional peer dependency (bug fix)

  `parseMarkdownDocument()` previously pulled `yaml` in via a top-level
  import, which caused the whole `@walkthru-earth/objex-utils` bundle to fail
  to load when the optional `yaml` peer dep was absent, even for consumers
  only using `buildGeoArrowTables`, `parseWKB`, `findGeoColumn`, etc.

  `parseMarkdownDocument()` is now `async` and dynamically imports `yaml`
  only when frontmatter is encountered. Consumers who do not parse markdown
  no longer need `yaml` installed.

  **Breaking for direct callers of `parseMarkdownDocument`**, the function
  now returns `Promise<ParsedMarkdownDocument>` instead of
  `ParsedMarkdownDocument`.

  ### Professional per-module developer reference docs

  Adds a dedicated `packages/objex-utils/docs/` reference (13 pages, now
  shipped inside the npm tarball):

  - `README.md`, index, optional-peer matrix, common recipes
  - `geometry.md`, WKB parser, `buildGeoArrowTables`, `findGeoColumn` 5-priority heuristic
  - `parquet-metadata.md`, GeoParquet bounds, CRS, geometry types
  - `storage.md`, `parseStorageUrl`, provider registry, `StorageAdapter`, `UrlAdapter`
  - `query-engine.md`, `QueryEngine` interface, `QueryHandle`, `MapQueryResult`
  - `cog.md`, `file-types.md`, `formatting.md`, `file-sort.md`, `markdown-sql.md`, `local-storage.md`, `errors.md`, `types-constants.md`

  `packages/objex-utils/README.md` rewritten as a docs-first landing page,
  and the root `README.md` now links to the reference and lists
  `hyparquet-compressors` and `yaml` as optional peers.

  ### CI hardens the publish pipeline

  Both `pnpm run package` (svelte-package + publint for
  `@walkthru-earth/objex`) and `pnpm --filter @walkthru-earth/objex-utils
run build` (tsup ESM/CJS/DTS for `@walkthru-earth/objex-utils`) now run on
  every PR. Previously they only ran at release time via `ci:publish`, so
  tarball regressions (stray `$lib/` imports, broken `.d.ts`, missing
  exports) could slip through PR CI.

  ### Dead-code detection via knip

  Adds `knip` v6.6.0 with a real Svelte 5 compiler hook
  (`compile(src, { generate: 'client' }).js.code`) to resolve imports
  inside `.svelte` files. Exposed as `pnpm deadcode`. Evaluated and
  rejected alternatives: ts-prune, unimported, tsr, depcheck (all
  archived), skott, madge, dpdm, dependency-cruiser (Svelte-blind),
  Biome, oxlint, eslint-plugin-unused-imports, svelte-check (intra-file
  only).

  ### Unused helpers and orphan components removed

  - `getLocale()` removed from `i18n/index.svelte.ts` (no callers)
  - `createDeckOverlay()` and `DeckOverlayOptions` removed from `utils/deck.ts` (no callers)
  - `tileToImageUrl()` removed from `utils/pmtiles-tile.ts` (no callers)
  - `findNodeByPath()` removed from `utils/zarr.ts` (no callers)
  - `fileStore` and `tabStore` aliases collapsed into `files` and `tabs`
    in `stores/files.svelte.ts` and `stores/tabs.svelte.ts`
  - Orphan components deleted, `viewers/MapViewer.svelte`,
    `viewers/StyleEditorOverlay.svelte`, and the whole
    `components/ui/tabs/` directory (5 files)

  All per-directory `CLAUDE.md` files and the `docs/performance-*.md`
  architecture docs were updated to match.

## 1.1.0

### Minor Changes

- [`72f9e24`](https://github.com/walkthru-earth/objex/commit/72f9e24c1b7086e2f5d766849e8418f0114842ea) Thanks [@yharby](https://github.com/yharby)! - Extract framework-agnostic utilities for cross-framework reuse

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

## 1.0.0

### Major Changes

- [`ff8f1b8`](https://github.com/walkthru-earth/objex/commit/ff8f1b89907769f7837838f2559d3800b3fbc027) Thanks [@yharby](https://github.com/yharby)! - First stable release.

  - Svelte 5 component library for exploring geospatial object storage (S3, GCS, Azure, R2)
  - 18+ file-format viewers (Parquet, GeoParquet, PMTiles, COG, Zarr, FlatGeobuf, 3D, PDF, and more)
  - DuckDB-WASM query engine with cancellable queries
  - Zero-copy WKB → GeoArrow pipeline for map rendering
  - Pure TS utilities package (`objex-utils`) with WKB parser, GeoArrow builder, storage URL parser, Parquet metadata reader
  - All `$lib/` imports replaced with relative paths for correct npm packaging
  - Exports map includes `"import"` condition for non-Svelte consumers
