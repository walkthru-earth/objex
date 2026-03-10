---
"@walkthru-earth/objex": major
"@walkthru-earth/objex-utils": major
---

First stable release.

- Svelte 5 component library for exploring geospatial object storage (S3, GCS, Azure, R2)
- 18+ file-format viewers (Parquet, GeoParquet, PMTiles, COG, Zarr, FlatGeobuf, 3D, PDF, and more)
- DuckDB-WASM query engine with cancellable queries
- Zero-copy WKB → GeoArrow pipeline for map rendering
- Pure TS utilities package (`objex-utils`) with WKB parser, GeoArrow builder, storage URL parser, Parquet metadata reader
- All `$lib/` imports replaced with relative paths for correct npm packaging
- Exports map includes `"import"` condition for non-Svelte consumers
