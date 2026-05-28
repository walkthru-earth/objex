---
'@walkthru-earth/objex': patch
'@walkthru-earth/objex-utils': patch
---

Relocate framework-agnostic utilities into `packages/objex-utils/src/`. The source for `wkb`, `hex`, `format`, `column-types`, `file-sort`, `error`, `lru`, `connection-identity`, `storage-smoketest`, `stac-storage-extension`, `cog-info`, `cog-asset`, `channel-composite`, `stac`, `stac-source`, `parquet-metadata`, `geoarrow`, `geometry-type`, `storage-url`, `cloud-url`, `host-detection`, `stac-facets`, `stac-pushdown`, `stac-geoparquet`, `markdown-sql` now lives inside the `objex-utils` package. The `src/lib/utils/<name>.ts` source files were removed. Consumers import these utilities from `@walkthru-earth/objex-utils` directly.

Added a build-time guardrail (`scripts/verify-objex-utils-bundle.mjs`, wired into `pnpm --filter @walkthru-earth/objex-utils run build`) that fails the build if any top-level import of `@developmentseed/*`, `proj4`, `wkt-parser`, `maplibre-gl`, `@luma.gl/*`, `@deck.gl/*`, `deck.gl`, `pdfjs-dist`, `shiki`, `@babylonjs/*`, `zarrita`, `@zarrita/*`, `pmtiles`, `flatgeobuf`, `@zip.js/*`, `@cogeotiff/*`, `@carbonplan/*`, `chart.js`, `marked`, `mermaid`, `@milkdown/*`, `@codemirror/*`, `ansi_up`, `@mapbox/*`, `@chunkd/*`, `aws4fetch`, `sql-formatter`, `lz-string`, `pbf`, or `@duckdb/*` reaches the `dist/` output. This locks in the lesson from walkthru-earth/objex#11 (the `cog-info.ts` split pattern), so future re-exports cannot regress consumer Vite pre-bundling.
