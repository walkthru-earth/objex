---
'@walkthru-earth/objex': patch
'@walkthru-earth/objex-utils': patch
---

fix(objex-utils): stop leaking `@developmentseed/epsg/all`, `@developmentseed/geotiff`, `@developmentseed/proj`, `proj4`, and `maplibre-gl` into the published bundle.

Splits the dependency-free COG helpers (`SF_LABELS`, `safeClamp`, `clampBounds`, `buildDataTypeLabel`, `CogInfo`, `GeoBounds`) into `src/lib/utils/cog-pure.ts`. `objex-utils` now re-exports from the pure module, so the bundle no longer carries bare side-effect imports for the heavy COG stack. Unblocks consumer Vite dev servers that were throwing `Failed to resolve import "@developmentseed/epsg/all"` on every version past 1.1.0. `cog.ts` re-exports the same bindings, so every in-repo caller and the `@walkthru-earth/objex` public API are unchanged.

Fixes #11.
