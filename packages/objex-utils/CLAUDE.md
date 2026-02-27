# objex-utils

Pure TypeScript sub-package. Zero Svelte dependency. Built with tsup (ESM + CJS + DTS).

```mermaid
graph LR
    IDX[src/index.ts] -->|re-exports| SRC["../../src/lib/*"]
    IDX --> TSUP[tsup] --> DIST["dist/index.js<br/>dist/index.cjs<br/>dist/index.d.ts"]
```

Re-exports from `src/lib/`: types, storage/adapter, storage/url-adapter, query/engine, utils/wkb, utils/geoarrow, utils/storage-url, utils/parquet-metadata, utils/format, utils/hex, utils/column-types, file-icons/index.

- External: `apache-arrow`, `hyparquet`, `hyparquet-compressors` (not bundled)
- `tsconfig.json` has `rootDir: "../.."` to allow DTS generation across monorepo

```bash
pnpm --filter @walkthru-earth/objex-utils run build
```
