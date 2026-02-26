# objex

Cloud storage explorer that runs entirely in the browser. Connect to S3, Azure, GCS, R2, MinIO — browse files, query data with SQL, and visualize geospatial formats on interactive maps. No backend required.

```mermaid
graph LR
    Cloud["Cloud Storage<br/>S3 / Azure / GCS / R2"] -->|HTTP range requests| App["objex<br/>(browser SPA)"]
    App --> Browse[File Tree]
    App --> Query["DuckDB-WASM<br/>SQL Engine"]
    App --> Map["MapLibre + deck.gl<br/>Geo Visualization"]
    App --> View["18+ Viewers<br/>Tables, Code, Notebooks, PDF, 3D, Point Cloud..."]
```

## Stack

| Layer | Tech |
|-------|------|
| Framework | SvelteKit 2 + Svelte 5 (static adapter, CSR-only) |
| Styling | Tailwind CSS 4 + bits-ui (headless Svelte primitives) |
| Query engine | DuckDB-WASM (in-browser SQL, cancellable via `conn.send()` / `cancelSent()`) |
| Maps | MapLibre GL 5 + deck.gl 9 |
| Storage auth | aws4fetch (SigV4) / Azure SAS |
| Code quality | Biome + svelte-check |
| Package manager | pnpm 10 |

## Architecture

```mermaid
graph TD
    subgraph UI["UI Layer"]
        Page["+page.svelte"]
        Sidebar["FileTreeSidebar"]
        Tabs["TabBar"]
        VR["ViewerRouter"]
    end

    subgraph Viewers["Viewers"]
        TV["TableViewer<br/>+ GeoParquetMapViewer<br/>+ StacMapViewer"]
        PMT["PmtilesViewer"]
        FGB["FlatGeobufViewer"]
        COG["CogViewer"]
        ZARR["ZarrViewer<br/>+ ZarrMapViewer"]
        COPC["CopcViewer"]
        DB["DatabaseViewer"]
        CODE["CodeViewer<br/>+ StyleEditorOverlay<br/>+ marimo detection"]
        NB["NotebookViewer"]
        PDF["PdfViewer"]
        IMG["ImageViewer"]
        MODEL["ModelViewer<br/>(3D)"]
        MD["MarkdownViewer"]
        MEDIA["MediaViewer"]
        ARCHIVE["ArchiveViewer"]
        RAW["RawViewer"]
    end

    subgraph Core["Core"]
        SA["StorageAdapter<br/>browser-cloud / browser-azure / url-adapter"]
        DDB["DuckDB-WASM<br/>+ httpfs + spatial<br/>+ cancellable queries"]
        WKB["WKB Parser<br/>→ GeoArrow"]
        FI["File Icons Registry<br/>(ext → viewer)"]
    end

    subgraph Stores["Stores (Svelte 5 runes)"]
        CS["connections"]
        BS["browser"]
        TS["tabs"]
        CRED["credentials"]
        QH["query-history"]
        SET["settings"]
    end

    Page --> Sidebar --> SA
    Page --> Tabs --> VR
    VR -->|by extension| Viewers
    TV --> DDB
    TV --> WKB
    DB --> DDB
    SA --> CS
    SA --> CRED
    Sidebar --> BS
    VR --> FI
    Tabs --> TS
```

## Supported Formats

| Category | Formats | How |
|----------|---------|-----|
| **Tabular** | Parquet, CSV, TSV, JSONL, NDJSON | DuckDB SQL queries |
| **Geo vector** | GeoParquet, GeoJSON, Shapefile, GeoPackage, FlatGeobuf | DuckDB + MapLibre / deck.gl |
| **Geo raster** | Cloud Optimized GeoTIFF, PMTiles (vector + raster), Zarr v2/v3 | geotiff.js / MapLibre / deck.gl |
| **Point cloud** | COPC, LAZ, LAS | [viewer.copc.io](https://viewer.copc.io) (iframe) |
| **Notebooks** | Jupyter (.ipynb), marimo (.py) | notebookjs / marimo WASM playground |
| **Code** | 30+ languages (Python, TS, Rust, Go, SQL, etc.) | Shiki syntax highlighting |
| **Config** | JSON, XML, YAML, TOML, INI, .env | Shiki syntax highlighting |
| **Documents** | Markdown, PDF, plain text, logs | Milkdown / pdf.js |
| **Media** | PNG, JPEG, GIF, WebP, AVIF, SVG, BMP, ICO | Native `<img>` |
| **Video** | MP4, WebM, MOV, AVI, MKV | Native `<video>` |
| **Audio** | MP3, WAV, OGG, FLAC, AAC | Native `<audio>` |
| **3D** | GLB, glTF, OBJ, STL, FBX | Babylon.js |
| **Archives** | ZIP, TAR, GZ, TGZ, 7Z, RAR, BZ2 | zip.js (progressive streaming) |
| **Database** | DuckDB, SQLite | DuckDB-WASM |
| **Raw** | Any (fallback) | Hex dump |

## Viewers & Sources

### Data Viewers

| Viewer | Formats | Powered by | URL Hash |
|--------|---------|------------|----------|
| **TableViewer** | Parquet, CSV, TSV, JSONL, GeoJSON, Shapefile, GeoPackage | [DuckDB-WASM](https://github.com/duckdb/duckdb-wasm), [Apache Arrow](https://github.com/apache/arrow), [CodeMirror](https://codemirror.net) (SQL editor) | `#table` |
| **DatabaseViewer** | DuckDB, SQLite | [DuckDB-WASM](https://github.com/duckdb/duckdb-wasm) | — |

### Map Viewers

| Viewer | Formats | Powered by | URL Hash |
|--------|---------|------------|----------|
| **GeoParquetMapViewer** | GeoParquet, GeoJSON, Shapefile, GeoPackage (any geo-detected tabular format) | [deck.gl](https://deck.gl), [@geoarrow/deck.gl-layers](https://github.com/geoarrow/deck.gl-layers), [MapLibre GL](https://maplibre.org), custom WKB parser | `#map` |
| **PmtilesViewer** | PMTiles (vector + raster) | [pmtiles](https://github.com/protomaps/PMTiles), [MapLibre GL](https://maplibre.org) | — |
| **FlatGeobufViewer** | FlatGeobuf | [flatgeobuf](https://github.com/flatgeobuf/flatgeobuf), [deck.gl](https://deck.gl), [MapLibre GL](https://maplibre.org) | — |
| **CogViewer** | Cloud Optimized GeoTIFF | [geotiff.js](https://github.com/geotiffjs/geotiff.js) v3, [@developmentseed/deck.gl-geotiff](https://github.com/developmentseed/deck.gl-geotiff), [proj4js](https://github.com/proj4js/proj4js) | — |
| **ZarrViewer** | Zarr v2/v3 | [zarrita](https://github.com/manzt/zarrita.js), [@carbonplan/zarr-layer](https://github.com/carbonplan/maps), [MapLibre GL](https://maplibre.org) | `#map`, `#inspect` |
| **StacMapViewer** | STAC GeoParquet | [stac-map](https://developmentseed.org/stac-map) by Development Seed (iframe) | `#stac` |
| **CopcViewer** | COPC, LAZ, LAS | [viewer.copc.io](https://viewer.copc.io) (iframe) | — |

### Notebook Viewers

| Viewer | Formats | Powered by | URL Hash |
|--------|---------|------------|----------|
| **NotebookViewer** | Jupyter (.ipynb) | [notebookjs](https://github.com/jsvine/notebookjs), [Marked](https://github.com/markedjs/marked), [Shiki](https://github.com/shikijs/shiki), [ansi_up](https://github.com/drudru/ansi_up) | — |
| **CodeViewer** (marimo) | marimo notebooks (.py, .md) | [marimo WASM playground](https://marimo.app) (iframe), [lz-string](https://github.com/pieroxy/lz-string) | `#marimo` |

### Document & Code Viewers

| Viewer | Formats | Powered by | URL Hash |
|--------|---------|------------|----------|
| **CodeViewer** | 30+ languages (JSON, Python, TS, Rust, Go, SQL, etc.) | [Shiki](https://github.com/shikijs/shiki) | `#code` |
| **MarkdownViewer** | Markdown | [Marked](https://github.com/markedjs/marked), [Milkdown](https://milkdown.dev), [Mermaid](https://mermaid.js.org) | — |
| **PdfViewer** | PDF | [PDF.js](https://mozilla.github.io/pdf.js/) | — |

### Media Viewers

| Viewer | Formats | Powered by | URL Hash |
|--------|---------|------------|----------|
| **ImageViewer** | PNG, JPEG, GIF, WebP, AVIF, SVG, BMP, ICO | Native `<img>` with CSS transforms | — |
| **MediaViewer** | MP4, WebM, MOV, AVI, MKV, MP3, WAV, OGG, FLAC, AAC | Native `<video>` / `<audio>` | — |
| **ModelViewer** | GLB, glTF, OBJ, STL, FBX | [Babylon.js](https://www.babylonjs.com) | — |

### Other Viewers

| Viewer | Formats | Powered by | URL Hash |
|--------|---------|------------|----------|
| **ArchiveViewer** | ZIP, TAR, GZ, TGZ, 7Z, RAR, BZ2 | [zip.js](https://github.com/nicbarker/zip.js) (streaming + progressive chunking) | — |
| **RawViewer** | Any (fallback) | Custom hex dump | — |

### Smart Content Detection

The CodeViewer auto-detects special files by content and offers contextual actions:

| Kind | Detection | Action | URL Hash |
|------|-----------|--------|----------|
| **marimo Notebook** | `.py`: `import marimo` + `marimo.App` in first 512 bytes | "Playground" — opens [marimo WASM playground](https://marimo.app) (iframe) | `#marimo` |
| **marimo Markdown** | `.md`: `marimo-version:` in first 512 bytes | "Playground" — opens [marimo WASM playground](https://marimo.app) (iframe) | `#marimo` |
| **MapLibre Style** | `version === 8` + `sources` + `layers` | "Edit Style" — opens [Maputnik](https://maplibre.org/maputnik/) (iframe) | `#maputnik` |
| **TileJSON** | `tilejson` + `tiles` | Badge only | — |
| **STAC Catalog** | `type === "Catalog"` + `stac_version` | "Browse" — opens [STAC Browser](https://radiantearth.github.io/stac-browser/) (iframe) | `#stac-browser` |
| **STAC Collection** | `type === "Collection"` + `stac_version` | "Browse" — opens [STAC Browser](https://radiantearth.github.io/stac-browser/) (iframe) | `#stac-browser` |
| **STAC Item** | `type === "Feature"` + `stac_version` | "Browse" — opens [STAC Browser](https://radiantearth.github.io/stac-browser/) (iframe) | `#stac-browser` |
| **Kepler.gl** | `info.app === "kepler.gl"` + `config` | "Open Map" — opens [Kepler.gl](https://kepler.gl/demo) (iframe) | `#kepler` |

### Basemaps & External Services

| Service | Source | Used by |
|---------|--------|---------|
| Basemap (light) | [CARTO Positron](https://basemaps.cartocdn.com/gl/positron-gl-style/style.json) | All map viewers |
| Basemap (dark) | [CARTO Dark Matter](https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json) | All map viewers |
| RTL text plugin | [@mapbox/mapbox-gl-rtl-text](https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.3.0/) | MapLibre GL |
| STAC Map | [Development Seed stac-map](https://developmentseed.org/stac-map) | StacMapViewer |
| STAC Browser | [Radiant Earth STAC Browser](https://radiantearth.github.io/stac-browser/) | CodeViewer |
| Maputnik | [MapLibre Maputnik](https://maplibre.org/maputnik/) | CodeViewer |
| Kepler.gl | [Kepler.gl Demo](https://kepler.gl/demo) | CodeViewer |
| COPC Viewer | [viewer.copc.io](https://viewer.copc.io) | CopcViewer |
| marimo Playground | [marimo.app](https://marimo.app) | CodeViewer (marimo detection) |

## Geospatial Pipeline

The TableViewer + GeoParquetMapViewer share a unified query pipeline:

1. **Schema detection** — DuckDB reads Parquet metadata (cheap range requests, no full download)
2. **Geometry column detection** — scans schema for known geo types (GEOMETRY, WKB_BLOB, BLOB, JSON geo columns)
3. **CRS detection** — reads GeoParquet `"geo"` KV metadata → native Parquet 2.11 logical_type → fallback WGS84
4. **CRS reprojection** — `ST_Transform(..., always_xy := true)` for non-WGS84 sources
5. **WKB extraction** — `ST_AsWKB()` adds a `__wkb` column alongside table data
6. **GeoArrow rendering** — `buildGeoArrowTables()` splits mixed WKBs by geometry type → one deck.gl layer per type (Point, LineString, Polygon, Multi*)

### Query Cancellation

DuckDB-WASM runs all queries on a single Web Worker. Data queries use `conn.send()` (non-blocking, poll-based) instead of `conn.query()` (blocking) so they can be cancelled mid-execution:

- **Graceful cancel** — `conn.cancelSent()` interrupts the query between Arrow batches
- **Force cancel** — `db.terminate()` kills the worker entirely (last resort, auto-reinitializes on next query)
- **Tab close** — cleanup cancels any in-flight query handle to unblock the worker immediately

Metadata queries (`getSchema`, `getRowCount`, `detectCrs`) remain on `conn.query()` — they're fast and don't need cancellation.

### Near-Zero-Copy Extraction

Map attribute extraction uses type-aware bulk reads to minimize allocations:

- **Numeric columns** (Int, Float, Double, Decimal, BigInt) — Arrow's `.toArray()` returns a zero-copy typed array view over the buffer, then `Array.from()` for downstream compat
- **WKB geometry** — `Uint8Array` from Arrow column `.get(i)` is used directly (no copy when already a `Uint8Array`)
- **Binary columns** (BLOB, BYTEA, WKB_BLOB) — skipped during map attribute extraction (not useful for tooltips, expensive to serialize)
- **DuckDB version** — injected at build time from `package.json` via Vite `define` (never hardcoded)

## URL Sharing

URLs encode the full viewer state for shareable links:

```
https://walkthru.earth/objex/?url=<storage-url>#<view>
```

| Hash | View |
|------|------|
| `#table` | Table / SQL query |
| `#map` | Map visualization |
| `#query` | Custom SQL mode |
| `#stac` | STAC map viewer |
| `#inspect` | Zarr variable inspector |
| `#code` | Code / syntax view |
| `#maputnik` | Maputnik style editor |
| `#stac-browser` | STAC Browser |
| `#kepler` | Kepler.gl map |
| `#marimo` | marimo WASM playground |

## i18n

Supports **English** and **Arabic** with automatic RTL layout. Translation function: `t(key, params?)` with `{param}` placeholder interpolation.

## Quick Start

```bash
pnpm install
pnpm dev          # http://localhost:5173
```

## Build & Deploy

```bash
pnpm build                       # dev build (base = /)
BASE_PATH=/objex pnpm build      # production (base = /objex)
```

GitHub Actions deploys to GitHub Pages on push to `main`. The workflow sets `BASE_PATH=/objex` so the app is served at `https://walkthru.earth/objex/`.

## Project Structure

```
src/
├── routes/              # Single-page app (SPA)
├── lib/
│   ├── components/
│   │   ├── viewers/     # 18+ file-type viewers
│   │   ├── browser/     # File tree, breadcrumbs, upload
│   │   ├── layout/      # Sidebar, tabs, status bar
│   │   ├── editor/      # CodeMirror SQL editor
│   │   ├── map/         # Shared map components
│   │   └── ui/          # Headless primitives (bits-ui)
│   ├── stores/          # Svelte 5 rune stores
│   ├── storage/         # Cloud adapters (S3, Azure, URL)
│   ├── query/           # DuckDB-WASM engine (cancellable queries, type-aware extraction)
│   ├── utils/           # WKB parser, GeoArrow, URL state, archive streaming
│   ├── i18n/            # Translations (en, ar)
│   └── file-icons/      # Extension → viewer/icon registry
```

## Storage Providers

Works with any S3-compatible API: **AWS S3**, **Cloudflare R2**, **Google GCS**, **Azure Blob**, **MinIO**, **Wasabi**, **DigitalOcean Spaces**, **Storj**. Also supports direct HTTPS URLs (no auth).

Credentials stay in-memory (never persisted to disk). Connection configs (without secrets) saved to localStorage.

## Performance Guidelines

This app handles large cloud datasets entirely in the browser. Follow these rules to keep it fast.

### Do

- **Use `$state.raw` for large arrays** — table rows, GeoJSON features, file tree nodes. Regular `$state` wraps in deep Proxy which freezes the browser at 1000+ items
- **Register with `tabResources`** — every viewer holding heavy data must call `tabResources.register(tab.id, cleanup)` so the LRU eviction can free memory when tabs exceed the alive limit
- **Pass `AbortSignal` to `adapter.read()`** — all storage adapter read methods accept an optional `signal` parameter. Use it in viewer `$effect` cleanup to cancel in-flight downloads on tab switch
- **Use `$effect` return for cleanup** — return a cleanup function from `$effect` to cancel AbortControllers, revoke blob URLs, and disconnect observers
- **Use `$state.snapshot()` before passing state to external libraries** — deck.gl, MapLibre, DuckDB, Arrow all expect plain objects, not Svelte proxies
- **Use `listPage()` with `PAGE_SIZE` for large directory listings** — fetch 200 entries per API call, render immediately, load more on scroll via IntersectionObserver sentinel
- **Read dependencies synchronously in `$effect`** — any value read after `await` or inside `setTimeout` is NOT tracked by Svelte's reactivity
- **Use `engine.queryCancellable()` for data queries** — returns a `QueryHandle` with `cancel()` synchronously, so cancellation is available before results arrive. Store the handle and cancel it in cleanup. Use `engine.forceCancel()` only as a last resort (kills the worker)
- **Use type-aware bulk extraction for Arrow columns** — `extractColumnBulk()` / `appendColumnBulk()` use `.toArray()` for numeric types (zero-copy typed array) and per-element `.get(i)` only for complex types. Skip binary columns when extracting map attributes

### Don't

- **Don't use `$state` on arrays with 100+ items** — use `$state.raw` and update by reassignment
- **Don't skip `onDestroy`** — even with `tabResources`, add `onDestroy(cleanup)` as a safety net for component unmount
- **Don't hold module-level references to heavy objects** — if a module-level variable caches data (GeoTIFF, Arrow tables), null it in `cleanup()`
- **Don't call `mermaid.initialize()` on every render** — it's a global singleton, initialize once
- **Don't create `document.addEventListener` without removal** — track listeners and remove in cleanup; if added in a drag handler, guard against mid-drag component destruction
- **Don't use `async` as the `$effect` callback** — it returns a Promise, not a cleanup function. Use an inner async IIFE with a cancellation flag instead
- **Don't create deep `$derived` chains** (>2-3 levels) — known Svelte 5 bug causes exponential recomputation. Flatten into a single `$derived.by` block
- **Don't use `conn.query()` for long-running data queries** — it blocks the single DuckDB Web Worker synchronously, queuing all other tabs behind it. Use `conn.send()` via `queryCancellable()` instead
- **Don't forget to cancel query handles in cleanup** — an uncancelled query keeps the worker busy, blocking all other tabs until it finishes

### Viewer Checklist

When adding a new viewer component:

```
[ ] cleanup() function that nulls all heavy state
[ ] $effect with tabResources.register(tab.id, cleanup) + return unregister
[ ] onDestroy(cleanup) as safety net
[ ] AbortController in load $effect, signal passed to adapter.read()
[ ] $effect return aborts the controller
[ ] Large data arrays use $state.raw
[ ] Generation counter or abort check after every await
[ ] URL.revokeObjectURL() for any blob URLs created
[ ] WebGL/canvas resources explicitly disposed
[ ] No document.addEventListener without matching removal
[ ] Cancel query handles (activeHandle/mapQueryHandle) in cleanup
[ ] Clear any setTimeout timers (forceCancelTimer) in cleanup
```

See `docs/performance-audit.md` and `docs/svelte5-performance-guide.md` for full details.

## License

[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) — hi@walkthru.earth
