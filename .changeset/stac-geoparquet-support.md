---
'@walkthru-earth/objex': minor
'@walkthru-earth/objex-utils': minor
---

Add stac-geoparquet support.

- `objex-utils`: new `stac-geoparquet` module with pure transforms that any consumer can use: `isStacGeoparquetSchema`, `stacRowToItem`, `flattenStacBbox`, `resolveStacAssetHref`, `pickStacPrimaryAsset`, plus `StacGeoparquetRow` / `StacBboxStruct` / `StacGeoparquetSchemaColumn` / `StacRowToItemOptions` types.
- `objex` Svelte lib: `ViewerRouter` detects stac-geoparquet via hyparquet schema sniff and routes matching `.parquet` / `.geoparquet` files to `StacTabViewer`. A new `query/stac-geoparquet.ts` helper uses the existing DuckDB engine (presigned URL, single worker, cancellable) to materialize a STAC FeatureCollection in one shot; `StacMosaicViewer` consumes it through the same `buildMosaicSourceMeta` + MosaicLayer path as JSON catalogs. `StacTabViewer` now shows a "Parquet" badge, relabels the last tab as "Table" (mounting `TableViewer`), and disables the `STAC Browser` iframe button with a tooltip since Radiant Earth stac-browser is JSON-only. The `stac-map` DevSeed iframe handles parquet on its own, so its button is unchanged.
