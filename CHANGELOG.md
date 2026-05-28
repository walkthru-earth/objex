# @walkthru-earth/objex

## 1.4.0

### Minor Changes

- [#15](https://github.com/walkthru-earth/objex/pull/15) [`73efc55`](https://github.com/walkthru-earth/objex/commit/73efc555bc7e0f4a742bc6d62f36f70647ed1e44) Thanks [@yharby](https://github.com/yharby)! - Wire config-driven basemaps and default connections into the live app.

  - Hosts can now set the basemap list, the default basemap per theme, and the preloaded buckets from `config.json` or `?config=<url>` without a rebuild. A basemap picker in the Settings panel lets the user override the basemap, with an Auto option that follows the theme.
  - `MapContainer` resolves its basemap through the new pure `resolveBasemap()` selector and falls back to the hardcoded CartoDB styles when no basemaps are configured, so a failed config never blanks the map. Raster basemaps are supported via a generated MapLibre style.
  - The connection rail seeds its rows from `config.json` connections on first run, auto-opening the first anonymous bucket and saving private buckets as rows that prompt for credentials on click. When no connections are configured it falls back to the Source Cooperative demo bucket.

- [#15](https://github.com/walkthru-earth/objex/pull/15) [`7f2cf89`](https://github.com/walkthru-earth/objex/commit/7f2cf89b6e763a81527c9d076c00a7dd71031b6b) Thanks [@yharby](https://github.com/yharby)! - Add a runtime config and an in-app settings panel.

  - A bundled `static/config.json` (or a remote `?config=<url>` file) now seeds defaults for theme, locale, row and STAC item limits, chrome visibility, basemaps, and connection seeds, so hosts can customize objex without a rebuild. Malformed config falls back to safe defaults and the app still boots.
  - New pure helpers in `@walkthru-earth/objex-utils` (`AppConfig`, `mergeAppConfig`, `resolveSetting`, `parseVisibilityParam`, and value coercers) provide a field-by-field merge of untrusted JSON and a first-match-wins precedence resolver. Covered by unit tests.
  - The settings store resolves each value through query parameter, then localStorage, then config, then a hardcoded fallback. Only keys the user explicitly changes are persisted, so config edits still reach untouched keys.
  - A new settings panel (gear icon in the sidebar) edits appearance, language, data limits, and interface visibility, with copy config JSON and reset to defaults. Per-link overrides via `?sidebar=`, `?tree=`, `?panel=`, and `?config=` are supported, and toggles locked by a link parameter are shown as read-only.

### Patch Changes

- [#15](https://github.com/walkthru-earth/objex/pull/15) [`c600e58`](https://github.com/walkthru-earth/objex/commit/c600e5845f58ad54ed8d99cdf84b0f8963543fa1) Thanks [@yharby](https://github.com/yharby)! - Improve generic S3-compatible support and connection URL handling.

  - Relabel the `minio` provider to "MinIO / RustFS / Custom" so self-hosted and S3-compatible stores (MinIO, RustFS, Ceph RGW, and other custom endpoints) are a first-class choice. No `id` change, so existing connections and host detection keep working.
  - Fix the file tree "Copy HTTP URL" action emitting an AWS URL for non-AWS connections. It now routes through a shared, provider-aware `buildHttpsUrlForConnection` helper that resolves GCS, R2, Wasabi, and the rest correctly, including connections with an empty endpoint.
  - Replace the silent, misleading "Empty bucket" state when a bucket listing is blocked. The file tree now detects a CORS/network failure and explains it, with guidance that the bucket needs a CORS policy or proxy access.

- [#15](https://github.com/walkthru-earth/objex/pull/15) [`1df37d5`](https://github.com/walkthru-earth/objex/commit/1df37d56e9b3291b835c993945dba0192124aeaf) Thanks [@yharby](https://github.com/yharby)! - Clarify the two-layer utility split. Rename `cog-pure` to `cog-info` and the app-side `url` to `signed-url`, move the markdown SQL execution context into `@walkthru-earth/objex-utils` as `MarkdownSqlContext` (engine injected by the host), add a two-layer utility map to the root guide, and fix stale documentation paths. No runtime behavior changes.

- [#15](https://github.com/walkthru-earth/objex/pull/15) [`f2b86fb`](https://github.com/walkthru-earth/objex/commit/f2b86fb918b7a76f6144bfc1545691ac13956eb0) Thanks [@yharby](https://github.com/yharby)! - Harden the pure utilities against polynomial ReDoS (CodeQL `js/polynomial-redos`). No public API or behavior change, the same inputs produce the same outputs, but worst-case inputs now run in linear time instead of O(n^2).

  - `connection-identity` and `storage-url`: replace the `/\/+$/` and `/^\/+|\/+$/g` slash-trim regexes with linear character-scan helpers.
  - `cloud-url`: rewrite the `s3://` and `gcs://` matchers from `([^/]+)\/?(.*)` to `([^/]+)(?:\/(.*))?` to remove the `[^/]+` / `.*` backtracking ambiguity.
  - `markdown-sql`: match the sql-fence name with `[ \t]` instead of `\s` so the trailing newline is an unambiguous boundary.
  - `column-types`: strip the parenthesized type span via `indexOf`/`lastIndexOf` slicing instead of `/\(.*\)/`.

- [#15](https://github.com/walkthru-earth/objex/pull/15) [`0f213aa`](https://github.com/walkthru-earth/objex/commit/0f213aa1c8d0ac7b25561e4d02b5ad9c4bdae61d) Thanks [@yharby](https://github.com/yharby)! - Upgrade the `@developmentseed/deck.gl-{raster,geotiff,zarr,epsg,proj,geotiff}` stack from 0.6.1 to 0.7.0 and slim the pnpm patch set.

  - 0.7.0 forwards `onTileLoad` / `onTileError` / `onTileUnload` / `onViewportLoad` through `RasterTileLayer` natively (deck.gl-raster PR [#546](https://github.com/walkthru-earth/objex/issues/546)), so the entire `deck.gl-raster` pnpm patch was removed.
  - `MosaicLayer` now forwards `debounceTime` natively and renamed its tile callbacks to source-level props (`onSourceLoad` / `onSourceError` / `onSourceUnload` / `onViewportLoad`). `StacMosaicViewer` migrated from `onTileUnload` to `onSourceUnload`, and that hunk was dropped from the geotiff patch.
  - The remaining geotiff patch keeps only three hunks that upstream still does not ship by default. The proj4 `+over` antimeridian fix, the `inferRenderPipeline` re-export, and the `r16unorm` to `r32float` Firefox/macOS texture fallback.
  - `MinimalTileData` now imports from `@developmentseed/deck.gl-raster` (it is no longer re-exported by `deck.gl-geotiff`).

- [#15](https://github.com/walkthru-earth/objex/pull/15) [`3da79e0`](https://github.com/walkthru-earth/objex/commit/3da79e0c4b50e343886259d9b678e24cdefdfd08) Thanks [@yharby](https://github.com/yharby)! - Relocate framework-agnostic utilities into `packages/objex-utils/src/`. The source for `wkb`, `hex`, `format`, `column-types`, `file-sort`, `error`, `lru`, `connection-identity`, `storage-smoketest`, `stac-storage-extension`, `cog-info`, `cog-asset`, `channel-composite`, `stac`, `stac-source`, `parquet-metadata`, `geoarrow`, `geometry-type`, `storage-url`, `cloud-url`, `host-detection`, `stac-facets`, `stac-pushdown`, `stac-geoparquet`, `markdown-sql` now lives inside the `objex-utils` package. The `src/lib/utils/<name>.ts` source files were removed. Consumers import these utilities from `@walkthru-earth/objex-utils` directly.

  Added a build-time guardrail (`scripts/verify-objex-utils-bundle.mjs`, wired into `pnpm --filter @walkthru-earth/objex-utils run build`) that fails the build if any top-level import of `@developmentseed/*`, `proj4`, `wkt-parser`, `maplibre-gl`, `@luma.gl/*`, `@deck.gl/*`, `deck.gl`, `pdfjs-dist`, `shiki`, `@babylonjs/*`, `zarrita`, `@zarrita/*`, `pmtiles`, `flatgeobuf`, `@zip.js/*`, `@cogeotiff/*`, `@carbonplan/*`, `chart.js`, `marked`, `mermaid`, `@milkdown/*`, `@codemirror/*`, `ansi_up`, `@mapbox/*`, `@chunkd/*`, `aws4fetch`, `sql-formatter`, `lz-string`, `pbf`, or `@duckdb/*` reaches the `dist/` output. This locks in the lesson from walkthru-earth/objex#11 (the `cog-info.ts` split pattern), so future re-exports cannot regress consumer Vite pre-bundling.

- Updated dependencies [[`73efc55`](https://github.com/walkthru-earth/objex/commit/73efc555bc7e0f4a742bc6d62f36f70647ed1e44), [`c600e58`](https://github.com/walkthru-earth/objex/commit/c600e5845f58ad54ed8d99cdf84b0f8963543fa1), [`1df37d5`](https://github.com/walkthru-earth/objex/commit/1df37d56e9b3291b835c993945dba0192124aeaf), [`f2b86fb`](https://github.com/walkthru-earth/objex/commit/f2b86fb918b7a76f6144bfc1545691ac13956eb0), [`7f2cf89`](https://github.com/walkthru-earth/objex/commit/7f2cf89b6e763a81527c9d076c00a7dd71031b6b), [`0f213aa`](https://github.com/walkthru-earth/objex/commit/0f213aa1c8d0ac7b25561e4d02b5ad9c4bdae61d), [`3da79e0`](https://github.com/walkthru-earth/objex/commit/3da79e0c4b50e343886259d9b678e24cdefdfd08)]:
  - @walkthru-earth/objex-utils@1.4.0

## 1.3.1

### Patch Changes

- [`4c3bb6a`](https://github.com/walkthru-earth/objex/commit/4c3bb6af81acc9cdfd5d94496c3467dae64e1609) Thanks [@yharby](https://github.com/yharby)! - fix(objex-utils): stop leaking `@developmentseed/epsg/all`, `@developmentseed/geotiff`, `@developmentseed/proj`, `proj4`, and `maplibre-gl` into the published bundle.

  Splits the dependency-free COG helpers (`SF_LABELS`, `safeClamp`, `clampBounds`, `buildDataTypeLabel`, `CogInfo`, `GeoBounds`) into `src/lib/utils/cog-pure.ts`. `objex-utils` now re-exports from the pure module, so the bundle no longer carries bare side-effect imports for the heavy COG stack. Unblocks consumer Vite dev servers that were throwing `Failed to resolve import "@developmentseed/epsg/all"` on every version past 1.1.0. `cog.ts` re-exports the same bindings, so every in-repo caller and the `@walkthru-earth/objex` public API are unchanged.

  Fixes #11.

## 1.3.0

### Minor Changes

- [`07e1570`](https://github.com/walkthru-earth/objex/commit/07e15707580ed26512ff1905848a3ef3853d99ff) Thanks [@yharby](https://github.com/yharby)! - Canonical connection identity and deduplication across every write path.

  - New `utils/connection-identity.ts` (exported from `src/lib/index.ts`): `connectionIdentityKey`, `isSameConnectionIdentity`, `normalizeEndpoint`, `normalizeProvider`, `ConnectionIdentityInput`. Identity is provider-aware: `azure` → `provider|endpoint|bucket`, `gcs` → `provider|bucket` (global namespace), `s3` with empty endpoint → `s3|bucket|region` (region is load-bearing for signing), all other S3-compatible providers → `provider|normalizedEndpoint|bucket`. `normalizeEndpoint` lowercases host, strips default ports (`:443`/`:80`) and trailing slashes, and preserves explicit non-default ports and pathnames so `http` vs `https`, `:443` vs empty, and trailing-slash drift collapse to one key.
  - `connections` store: removed `findByBucketEndpoint` (bucket+endpoint string match, which produced silent duplicates for AWS same-bucket-different-region and custom S3-compat scheme/port drift, and was bypassed entirely by the manual Add Connection dialog). Every write path now dedups through `connectionIdentityKey`:
    - `save(config)` returns `{ id, existed }`. On `existed: true`, the row is reused and credentials from the new config overwrite the old ones.
    - `update(id, config)` throws the new `DuplicateConnectionError` when the new identity would collide with a different saved row, so edits can't silently produce phantom duplicates.
    - `saveHostConnection(detected)` continues to be the auto-detect entry and returns the final id, either reused or newly inserted.
    - New public `findByIdentity(input)` exposes the same key for callers that need to check without writing.
  - `ConnectionDialog` surfaces both outcomes: amber "merged into existing" notice on dedup and destructive "already used by X" block on edit collision, with the offending connection's name.
  - Build: svelte-check 0 errors, publint clean, no `$lib/` leaks in `dist/`.

- [`676c792`](https://github.com/walkthru-earth/objex/commit/676c79298b3171333be8e0752002c434404dde43) Thanks [@yharby](https://github.com/yharby)! - Bump the `@developmentseed/deck.gl-geotiff` family to `0.6.0-alpha.1` and add two new viewers plus a dual-path Zarr renderer. No breaking changes to existing tabs, and CogViewer behavior is unchanged.

  ### What's new

  - **StacMosaicViewer** (renamed from SentinelMosaicViewer, wrapped in a new `StacTabViewer`). `ViewerRouter` now detects STAC Items / FeatureCollections / Collections / Catalogs via a 256 KB adapter peek (`utils/stac.ts::classifyStac`) and mounts a tab wrapper with `Map` / `STAC Browser` / `JSON` buttons (URL hash `#map` / `#stac-browser` / `#code`, shareable). The user can always toggle back to the third-party stac-browser iframe. For Collection / Catalog inputs, `utils/stac-hydrate.ts::hydrateStacItems` walks `links[rel=item|child|next]` with a 12-way concurrency pool and a 2000-item cap, emitting progressive batches so the MosaicLayer starts rendering after ~1–2s. Each inner COG still runs through `selectCogPipeline`, so palette-indexed short-circuits, non-uint custom pipelines, LinearRescale, and `normalizeCogGeotiff` (overview strip + polar bbox clamp) all apply per scene. Shared `DecoderPool` and `createEpsgResolver` across every inner source.
  - **MultiCogViewer.** STAC Item JSON routes here when `eo:bands.common_name` or MPC/Element 84/AWS asset-key heuristics identify at least the red/green/blue Sentinel-2 bands. Preset dropdown (True Color / False-Color IR / SWIR / Vegetation / Agriculture) drives the v0.6 `MultiCOGLayer.composite` prop, and a `FilterNoDataVal` + `LinearRescale` pipeline (0..0.3 default for L2A reflectance) mask scene edges and stretch contrast.
  - **Zarr dual path.** `utils/zarr.ts::detectGeoZarr` inspects hierarchy attributes for the GeoZarr convention (`multiscales` + spatial + CRS). Matching stores render via `@developmentseed/deck.gl-zarr` `ZarrLayer` on `MapboxOverlay`; anything else falls through to the existing `@carbonplan/zarr-layer` path with its 10 k-tile guard and numcodecs codec aliases.
  - **New utilities.** `utils/stac.ts` (STAC item/FeatureCollection shape checks, Sentinel band extraction, bbox helper). `utils/cog.ts` gains `buildMosaicSourceMeta`, `buildBandRenderPipeline` (composes `FilterNoDataVal` + `LinearRescale` in GPU-correct order). `utils/zarr.ts` gains `detectGeoZarr` and `zarrTileToImageData`.
  - **CogControls `mode` prop.** Accepts `'single'` (default, full band + color-ramp UI) or `'multi'` (rescale slider only). MultiCogViewer uses the new mode; existing CogViewer is unchanged.

  ### Package bumps

  `@developmentseed/deck.gl-geotiff`, `deck.gl-raster`, `geotiff`, `proj`, `epsg`: `^0.5.0 → ^0.6.0-alpha.1`. New deps: `@developmentseed/deck.gl-zarr@^0.6.0-alpha.1` (pulls in `@developmentseed/geozarr` transitively). `zarrita` bumped `^0.6.2 → ^0.7.1`, forced across the tree via `pnpm.overrides` so `@carbonplan/zarr-layer@^0.4.3` runs on the same major.

  ### Patches

  `patches/@developmentseed__deck.gl-geotiff@0.5.0.patch` renamed and re-attached as `@0.6.0-alpha.1.patch`. Both hunks (proj4 `+over` antimeridian fix, `inferRenderPipeline` re-export) still apply unchanged, upstream tickets [#366](https://github.com/developmentseed/deck.gl-raster/issues/366) and [PR #374](https://github.com/developmentseed/deck.gl-raster/pull/374) remain open.

  New patch `patches/@carbonplan__zarr-layer@0.4.3.patch` replaces two calls to `zarr.tryWithConsolidated()` with `Promise.resolve(baseStore)`. The helper was removed in zarrita 0.7, and the override above forces 0.7 across the tree, which otherwise surfaced as a runtime `(void 0) is not a function` inside `_onAddAsync` when mounting the legacy ZarrLayer. Consolidated metadata (`.zmetadata`) is still fetched manually by the library's own `_loadV2`, so skipping the helper is behavior-preserving.

  ### Vite config

  `optimizeDeps.include` extended with `@developmentseed/deck.gl-zarr` and its `geozarr` + `raster-reproject` leaves, plus `zarrita` itself.

- [`4cf01c5`](https://github.com/walkthru-earth/objex/commit/4cf01c5d40f165e0273da4cffe197edd767734bf) Thanks [@yharby](https://github.com/yharby)! - GPU colormap sprite, histogram slider, and 4-band COG fix.

  ### GPU `Colormap` sprite with 107 ramps

  Single-band COGs and mosaics now render through the v0.6 `Colormap` shader module sampling `@developmentseed/deck.gl-raster/gpu-modules/colormaps.png` (256x107 RGBA, matplotlib + rio-tiler + cmocean). Switching ramps is a uniform update on `colormapIndex`, no tile re-decode. The CPU baker normalizes band N into `color.r` with `r = 1 + round(t * 254)` and reserves `r = 0` as a nodata sentinel so `FilterNoDataVal({ value: 0 })` discards those fragments before the ramp sample.

  New helper module `utils/colormap-sprite.ts` decodes the sprite once per session and caches the uploaded `sampler2DArray` texture per luma.gl `Device` via a `WeakMap`. Exports `COLORMAP_INDEX` (all 107 names), `COLORMAP_NAMES` (sorted), `loadColormapSprite()`, `getColormapTexture(device)`, and `spriteBackgroundStyle(name, heightPx)` for CSS previews.

  `CogControls.svelte` previews every ramp by slicing the sprite as a CSS background-image. Curated 10-ramp "pinned" grid (gray, terrain, viridis, magma, turbo, spectral, inferno, plasma, cividis, rdylgn), plus a search field and a scrollable full list of all 107.

  ### Histogram behind the rescale slider

  `selectCogPipeline` now accepts an `onHistogram?: (bins: Uint32Array) => void` callback. The CPU baker emits a 64-bin histogram (`HISTOGRAM_BIN_COUNT`) built over the tile's valid samples, stored in `CogViewer` / `StacMosaicViewer` as `$state.raw<Uint32Array>` and rendered by `CogControls` as an SVG bar chart behind the rescale sliders. The active `[min, max]` window draws as a translucent band so the slider visualizes what it is actually clipping.

  `rescaleApplicable` now returns `true` when `bandConfig.mode === 'single'` in addition to the legacy uint-RGB case. The single-band path builds its pipeline as `[Sampler2DArrayPrecision, FilterNoDataVal, LinearRescale?, Colormap]`, so the slider stretches `color.r` before the ramp lookup.

  ### NAIP 4-band opacity fix + dynamic band detection

  `needsCustomPipelineForConfig` now forces the CPU path for `geotiff.count === 4` in RGB mode, so the 4th NAIP band is no longer silently interpreted as alpha by the library-default RGBA pipeline.

  `StacMosaicViewer` detects band count + `SampleFormat` dynamically on the first COG that `MosaicLayer.getSource` resolves (via `geotiff.count` and `cachedTags.sampleFormat`), reseeds `bandConfig` via `defaultBandConfig(count, sf)`, and updates `<CogControls bandCount=...>` so 4-band imagery exposes all four bands in the picker. Previously the mosaic hard-coded 3 bands.

  ### `Sampler2DArrayPrecision` shim

  `@developmentseed/deck.gl-raster@0.6.0-alpha.1`'s `Colormap` module injects `uniform sampler2DArray colormapTexture;` without a precision qualifier, which the Apple-GPU path of luma.gl's WebGL2 backend rejects with `ERROR: 'sampler2DArray' : No precision specified`. Local shim `Sampler2DArrayPrecision` (in `utils/cog.ts`) injects `precision highp sampler2DArray;` at `fs:#decl` and is chained immediately before `Colormap` in `buildCustomRenderTile`. Remove once upstream fixes.

  ### Dead code removed

  Retired `COLOR_RAMP_STOPS`, `ColorRampId`, `interpolateRamp`, `rampToGradientCss`, and `customRenderTile` from `utils/cog.ts`. All superseded by the sprite path. `ColorRampId` is now a type alias for `ColormapName` (all 107 entries).

  ### `objex-utils`

  Bump coordinated with the main package via the `fixed` changeset config. No new re-exports, `colormap-sprite.ts` is not published because it depends on luma.gl `Device` / WebGL2. Consumers who want GPU colormap rendering should depend on the full `@walkthru-earth/objex` package.

- [`439dfd7`](https://github.com/walkthru-earth/objex/commit/439dfd7049ad602a3871e9da6a5612e92c2e51cc) Thanks [@yharby](https://github.com/yharby)! - Add stac-geoparquet support.

  - `objex-utils`: new `stac-geoparquet` module with pure transforms that any consumer can use: `isStacGeoparquetSchema`, `stacRowToItem`, `flattenStacBbox`, `resolveStacAssetHref`, `pickStacPrimaryAsset`, plus `StacGeoparquetRow` / `StacBboxStruct` / `StacGeoparquetSchemaColumn` / `StacRowToItemOptions` types.
  - `objex` Svelte lib: `ViewerRouter` detects stac-geoparquet via hyparquet schema sniff and routes matching `.parquet` / `.geoparquet` files to `StacTabViewer`. A new `query/stac-geoparquet.ts` helper uses the existing DuckDB engine (presigned URL, single worker, cancellable) to materialize a STAC FeatureCollection in one shot; `StacMosaicViewer` consumes it through the same `buildMosaicSourceMeta` + MosaicLayer path as JSON catalogs. `StacTabViewer` now shows a "Parquet" badge, relabels the last tab as "Table" (mounting `TableViewer`), and disables the `STAC Browser` iframe button with a tooltip since Radiant Earth stac-browser is JSON-only. The `stac-map` DevSeed iframe handles parquet on its own, so its button is unchanged.

- [`4cf01c5`](https://github.com/walkthru-earth/objex/commit/4cf01c5d40f165e0273da4cffe197edd767734bf) Thanks [@yharby](https://github.com/yharby)! - STAC mosaic pixel inspection and stricter STAC JSON routing.

  ### Mosaic pixel inspection + info panel

  `StacMosaicViewer` now exposes the same `Info` button and pixel-inspection overlay that `CogViewer` has. Clicking a pixel inside a STAC Catalog / Collection / ItemCollection / stac-geoparquet tab surfaces the sampled band values plus the matching source id, and the info panel lists source count, detected band count, data type (captured as `buildDataTypeLabel(sampleFormat, bitsPerSample)` on the first resolved COG), and union bounds.

  A `geotiffCache: Map<string, Promise<GeoTIFF>>` is populated inside `getSource` and reused both for `MosaicLayer` rebuilds and for the map-click handler, so clicks do not trigger a second HTTP fetch. The click handler reverse-iterates `itemsRef` to match mosaic z-order, finds the topmost source whose bbox contains the click, and calls `readPixelAtLngLat(...)` against that source's cached `GeoTIFF`.

  New translations `stac.mosaicInfo` and `stac.mosaicSourcesLabel` for English and Arabic.

  ### Stop routing plain JSON through StacTabViewer

  `ViewerRouter::detectStac` now propagates `classifyStac(parsed)`'s `{ kind: 'none' }` result in both the 256 KB peek branch and the full-read fallback. Previously any JSON that parsed returned `{ kind: 'stac', classified: { kind: 'none' } }`, which still mounted `StacTabViewer` and exposed the `stac-map` and `STAC Browser` buttons on files that were not STAC at all (including GeoJSON FeatureCollections that fail the STAC shape checks). Plain JSON now falls through to `CodeViewer` as intended.

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
