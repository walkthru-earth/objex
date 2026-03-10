# utils/

Pure utility modules. No Svelte dependency except `url-state.ts`.
Shared constants live in `src/lib/constants.ts` (imported by stores, query, and utils).

```mermaid
graph TD
    subgraph "Published (npm)"
        WKB[wkb.ts<br/>parseWKB, findGeoColumn]
        GA[geoarrow.ts<br/>buildGeoArrowTables]
        SU[storage-url.ts<br/>parseStorageUrl]
        PM[parquet-metadata.ts<br/>readParquetMetadata]
        FMT[format.ts<br/>formatFileSize, formatDate]
        HEX[hex.ts<br/>generateHexDump]
        CT[column-types.ts<br/>classifyType]
    end
    subgraph "Internal only"
        DECK[deck.ts<br/>createDeckOverlay, createGeoArrowOverlay]
        URL[url.ts<br/>buildHttpsUrl, buildDuckDbUrl, resolveCloudUrl]
        US[url-state.ts<br/>syncUrlParam — uses $app]
        ARC[archive.ts<br/>streamZip/Tar]
        PMT[pmtiles.ts<br/>loadPmtiles]
        PMTT[pmtiles-tile.ts<br/>decodeMvtTile]
        SHIKI[shiki.ts<br/>highlightCode]
        NB[notebook.ts<br/>renderNotebook]
        ZARR[zarr.ts<br/>detectZarrMarkers, extractZarrStoreUrl, fetchHierarchy, ZarrNode, ZarrHierarchy]
    end
    subgraph "Published (npm) — new"
        CB[clipboard.ts<br/>copyToClipboard, wireCodeCopyButtons]
        ERR[error.ts<br/>handleLoadError]
    end
    WKB --> GA
    PM --> GA
    GA --> DECK
```

| File | Key Exports | Used by |
|------|-------------|---------|
| `wkb.ts` | `parseWKB()`, `toBinary()`, `findGeoColumn()`, `findGeoColumnFromRows()` | TableViewer, GeoParquetMapViewer, lib/index.ts |
| `geoarrow.ts` | `buildGeoArrowTables()`, `normalizeGeomType()` | TableViewer, GeoParquetMapViewer, lib/index.ts |
| `storage-url.ts` | `parseStorageUrl()`, `looksLikeUrl()`, `Defaults` | ConnectionDialog, Sidebar, lib/index.ts |
| `parquet-metadata.ts` | `readParquetMetadata()`, `extractEpsgFromGeoMeta()`, `extractBounds()` | TableViewer, lib/index.ts |
| `format.ts` | `formatFileSize()`, `formatDate()`, `getFileExtension()`, `formatValue()`, `jsonReplacerBigInt()` | StatusBar, FileRow, ArchiveViewer, RawViewer, PmtilesTileInspector, PmtilesArchiveView, AttributeTable, TableGrid, lib/index.ts |
| `hex.ts` | `generateHexDump()` | RawViewer, lib/index.ts |
| `column-types.ts` | `classifyType()`, `typeColor()`, `typeLabel()` | TableGrid, lib/index.ts |
| `deck.ts` | `createDeckOverlay()`, `createGeoArrowOverlay()`, `createGeoArrowLayers()` | FlatGeobufViewer, GeoParquetMapViewer |
| `url.ts` | `buildHttpsUrl()`, `buildDuckDbUrl()`, `canStreamDirectly()`, `resolveCloudUrl()` | TabBar, FileTreeSidebar, CogViewer, TableViewer, FlatGeobufViewer, ArchiveViewer, MediaViewer, CopcViewer, PdfViewer, ZarrMapViewer, StacMapViewer, ZarrViewer, CodeViewer, ImageViewer, PmtilesViewer, TableToolbar, +page.svelte |
| `archive.ts` | `streamZipEntriesFromUrl()`, `streamTarEntriesFromUrl()`, `listContents()` | ArchiveViewer |
| `pmtiles.ts` | `getPmtilesProtocol()`, `loadPmtiles()`, `buildPmtilesLayers()`, `TILE_TYPE_LABELS`, `COMPRESSION_LABELS`, `VectorLayerInfo`, `PmtilesMetadata` | PmtilesMapView, PmtilesArchiveView, PmtilesViewer |
| `pmtiles-tile.ts` | `decodeMvtTile()`, `tileToImageUrl()`, `tileMimeType()`, `layerHue()`, `DecodedTile`, `DecodedLayer`, `DecodedFeature` | PmtilesTileInspector |
| `shiki.ts` | `highlightCode()`, `highlightCodeReversed()`, `extensionToShikiLang()`, `getTheme()`, `getReversedTheme()` | PmtilesArchiveView, NotebookViewer, CodeViewer, MarkdownViewer |
| `notebook.ts` | `renderNotebook()` | NotebookViewer |
| `zarr.ts` | `ZARR_MARKER_FILES`, `detectZarrMarkers()`, `extractZarrStoreUrl()`, `fetchHierarchy()`, `probeHierarchy()`, `buildV3Tree()`, `buildV2Tree()`, `ensureCodecsRegistered()`, `ZarrNode`, `ZarrHierarchy`, `DIM_LIKE_NAMES`, `findNodeByPath()`, `formatCodecs()`, `formatChunkKeys()`, `computeChunkCount()`, `computeChunkSize()`, `computeUncompressed()`, `dtypeByteSize()`, `inferDims()`, `formatShape()` | ZarrViewer, ZarrMapViewer, FileBrowser, +page.svelte |
| `url-state.ts` | `syncUrlParam()`, `updateUrlView()` | Sidebar, FileTreeSidebar, TableViewer, ZarrViewer, CodeViewer, PmtilesViewer, +page.svelte |
| `export.ts` | `exportToCsv()`, `exportToJson()` | TableStatusBar |
| `pdf.ts` | `loadPdfDocument()` | PdfViewer |
| `model3d.ts` | `createModelScene()`, `loadModel()` | ModelViewer |
| `markdown.ts` | `renderMarkdown()`, `detectRTL()` | MarkdownViewer |
| `map-selection.ts` | `setupSelectionLayer()`, `updateSelection()` | PmtilesMapView, MapViewer |
| `host-detection.ts` | `detectHostBucket()` | stores/connections, Sidebar |
| `markdown-sql.ts` | `parseMarkdownDocument()`, `interpolateTemplates()` | MarkdownViewer |
| `evidence-context.ts` | `EvidenceContext` | MarkdownViewer |
| `clipboard.ts` | `copyToClipboard()`, `wireCodeCopyButtons()` | TabBar, CodeViewer, NotebookViewer, MarkdownViewer, lib/index.ts |
| `error.ts` | `handleLoadError()` | ImageViewer, MediaViewer, RawViewer, CodeViewer, PdfViewer, ModelViewer, MarkdownViewer, NotebookViewer, lib/index.ts |
