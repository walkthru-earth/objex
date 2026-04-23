# @walkthru-earth/objex

## 1.2.1

### Patch Changes

- [`aa62ae4`](https://github.com/walkthru-earth/objex/commit/aa62ae4e78242ad90bff10ed058027ad61e73b85) Thanks [@yharby](https://github.com/yharby)! - v1.2.1 focuses on making authenticated reads from S3-compatible buckets actually work in the browser, and fixing a handful of smaller bugs surfaced along the way. No breaking changes. Both packages bump together via the changesets `fixed` config.

  ### Authenticated S3-compatible reads (the headline fix)

  Before: `signed-s3` connections produced `s3://bucket/key` URLs. DuckDB-WASM's httpfs and the other fetchers signed each request with `Authorization: AWS4-HMAC-SHA256 ...`. The `Authorization` header triggers a CORS preflight, and the preflight is fragile on GCS, where `responseHeader` is dual-purpose (`Access-Control-Expose-Headers` AND `Access-Control-Allow-Headers`): any request header the browser sends that is not listed is silently dropped from the preflight response, the preflight returns 200 without `Access-Control-Allow-Origin`, and the browser blocks the real request.

  After: a new `presignHttpsUrl(conn, key, expiresIn?)` helper in `storage/presign.ts` uses `aws4fetch.signQuery` to return a presigned HTTPS URL with `X-Amz-Signature` in the query string. `buildHttpsUrlAsync` and `buildDuckDbUrlAsync` (new in `utils/url.ts`) surface it to callers, and `resolveTableSourceAsync` (new in `query/source.ts`) wires it into the table-source pipeline. DuckDB httpfs and every other range-request fetcher can now issue `GET` with only a `Range` header, keeping the preflight trivial. The 7-day expiry matches the SigV4 protocol maximum, the hard cap on every provider in the registry.

  Viewers migrated to await the async builders so their external fetchers receive a self-authenticating URL: `TableViewer` (via `resolveTableSourceAsync`, re-populates the editor only if the user has not edited the generated SQL during the await), `CogViewer`, `CopcViewer`, `ArchiveViewer`, `FlatGeobufViewer`, `PmtilesViewer`, `StacMapViewer`, `CodeViewer`, `ZarrViewer`, `ZarrMapViewer`. `PmtilesMapView` drops its unused sync import.

  `configureStorage(conn, connId, sourceRef?)` in `query/wasm.ts` now short-circuits the full `SET s3_access_key_id / secret / region / endpoint / url_style` block whenever the source ref points at a presigned HTTPS URL (`isHttpsSourceRef(ref)`). Every caller threads the ref or raw SQL through: schema / row-count / CRS probes pass `source.ref`, data-query paths (`query`, `queryForMap`, `queryCancellable`, `queryForMapCancellable`) pass the raw SQL (the regex matches `read_parquet('https://...')` embedded in SQL too). Net effect: one worker round-trip saved per query on every presigned tab, not just at tab open.

  Secondary fixes kept from the same workstream:

  - `configureStorage` falls back to `resolveProviderEndpoint()` when the connection's `endpoint` field is empty and the provider is not plain S3. Covers GCS, DO Spaces, Wasabi, B2, Storj, Contabo, Hetzner, Linode, OVHcloud, so auto-detected `?url=` connections that omit the endpoint still route DuckDB to the correct host on the `s3://` fallback path.
  - `configureStorage` hardened against Svelte-proxied `connId` values, template-literal use of a proxied primitive could throw `TypeError: can't convert symbol to string` inside the swallowed catch. `connId` is normalized to a plain string at the top of the function.
  - In-app GCS CORS guidance (`CORS_HELP.gcs`) updated. The `cors.json` template now includes `Authorization`, `x-amz-content-sha256`, `x-amz-date`, plus `x-amz-*` and `x-goog-*` wildcards, and adds `Range` plus the conditional `If-Match` / `If-Modified-Since` / `If-None-Match` / `If-Unmodified-Since` headers so DuckDB httpfs partial reads pass the preflight. The accompanying note explains that `responseHeader` is dual-purpose and that missing entries cause silent preflight rejections.

  ### Credential prompt for private `?url=` buckets

  Auto-detected buckets opened via the `?url=` query param were always saved with `anonymous: true`. When the URL pointed at a private bucket, the first LIST request failed silently and no credential prompt opened, the only workaround was to manually edit the connection in the sidebar.

  Now `BrowserCloudAdapter.listPageS3`, `listPageGcs`, and `BrowserAzureAdapter.listPage` throw a typed `AuthRequiredError` on 401 / 403. The browser store catches it during the first LIST of an anonymous connection and surfaces it on a reactive `authRequired` field. `Sidebar.svelte` watches that field, flips the connection to `anonymous: false`, and calls `ensureCredentials()`, which opens the credential dialog so the user can paste HMAC keys or a SAS token. Public buckets keep the zero-click auto-open flow, the LIST returns 200 and `authRequired` is never triggered.

  ### Arrow DECIMAL values render correctly

  `query()` / `queryCancellable()` in `query/wasm.ts` derive column types from `String(field.type)` on the Arrow schema, which emits `Decimal[10e+2]` (precision `e` signed-scale), not the DuckDB `DESCRIBE` form `DECIMAL(10,2)`. The initial `decimalScale()` regex matched only the DESCRIBE shape, so `decimalCols` stayed empty and every DECIMAL column fell through to `.get(i)` and rendered as raw `Uint32Array` / `BigInt` (for example, `"12345,0,0,0"` for `123.45`). The regex now matches both shapes, so `formatDecimal()` actually runs and cells render as scaled decimal strings.

  ### Geometry column auto-detection no longer false-positives

  `findGeoColumn` matched its name hints (`geom`, `geo`, `wkb`, `shape`, ...) with `String.includes`, so a column like `n_geographic_entities` (INT) was detected as a geometry column because it contains `geo`. The fallback now tokenizes column names on snake_case / kebab-case / camelCase / numeric boundaries and requires an exact token match, eliminating the false positives. Earlier priorities (exact known names via `GEO_NAMES`, typed GEOMETRY / WKB_GEOMETRY columns) are unchanged.

  ### Invalid-TIFF surface message in `CogViewer`

  `@developmentseed/geotiff` throws `Only tiff supported version:<n>` when the first four bytes of the file do not match a TIFF / BigTIFF signature (`II*\0`, `MM\0*`, `II+\0`, `MM\0+`). This fires on files that advertise `image/tiff` but are corrupt, encrypted, or a different format entirely (GDAL returns "not recognized as being in a supported file format" on the same bytes). `CogViewer` now traps that error during the pre-flight read and shows a clear, localized `map.cogInvalidTiff` message instead of letting `COGLayer` re-invoke the loader and crash uncaught.

  ### `@walkthru-earth/objex-utils` packaging and surface

  - `exports["."]` split into nested `import.types` → `./dist/index.d.ts` and `require.types` → `./dist/index.d.cts`, so CJS consumers resolve to the `.d.cts` emitted by `tsup`. `publint` now reports "All good!" on the package build.
  - New public re-exports: `QuerySource`, `AccessMode`, `AccessModeInput`, `getAccessMode`, `isPubliclyStreamable`, `resolveProviderEndpoint`, plus the previously-missed `exportToCsv` and `exportToJson`.
  - `docs/cog.md` trimmed to only the pure, peer-dep-free helpers actually re-exported. The render-pipeline helpers (`selectCogPipeline`, `createConfigurableGetTileData`, `normalizeCogGeotiff`, `createEpsgResolver`, `fitCogBounds`, `renderNonTiledBitmap`, ...) are now explicitly called out as "not re-exported here" so consumers know to depend on the full `@walkthru-earth/objex` package if they need them.
  - `docs/storage.md` documents `resolveProviderEndpoint` and the tightened GCS CORS guidance.

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
