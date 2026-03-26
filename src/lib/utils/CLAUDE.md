# utils/

Pure utility modules. No Svelte dependency except `url-state.ts` and `url.ts` (store-dependent).
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
        CB[clipboard.ts<br/>copyToClipboard, wireCodeCopyButtons]
        ERR[error.ts<br/>handleLoadError]
        CU[cloud-url.ts<br/>resolveCloudUrl, getNativeScheme]
        FS[file-sort.ts<br/>sortFileEntries, toggleSortField]
        EXP[export.ts<br/>serializeToCsv, serializeToJson]
        LS[local-storage.ts<br/>loadFromStorage, persistToStorage]
        MSQL[markdown-sql.ts<br/>parseMarkdownDocument]
        COG[cog.ts<br/>safeClamp, clampBounds, renderNonTiledBitmap]
    end
    subgraph "Internal only"
        DECK[deck.ts<br/>createDeckOverlay, createGeoArrowOverlay]
        URL[url.ts<br/>buildHttpsUrl, buildDuckDbUrl — re-exports cloud-url]
        US[url-state.ts<br/>syncUrlParam — uses $app]
        ARC[archive.ts<br/>streamZip/Tar]
        PMT[pmtiles.ts<br/>loadPmtiles]
        PMTT[pmtiles-tile.ts<br/>decodeMvtTile]
        SHIKI[shiki.ts<br/>highlightCode]
        NB[notebook.ts<br/>renderNotebook]
        ZARR[zarr.ts<br/>detectZarrMarkers, extractZarrStoreUrl]
        ZTAB[zarr-tab.ts<br/>openZarrTab]
    end
    WKB --> GA
    PM --> GA
    GA --> DECK
    CU --> URL
    FMT --> EXP
    LS --> stores
```

| File | Key Exports | Used by |
|------|-------------|---------|
| `wkb.ts` | `parseWKB()`, `toBinary()`, `findGeoColumn()`, `findGeoColumnFromRows()` | TableViewer, GeoParquetMapViewer, lib/index.ts |
| `geoarrow.ts` | `buildGeoArrowTables()`, `normalizeGeomType()` | TableViewer, GeoParquetMapViewer, lib/index.ts |
| `storage-url.ts` | `parseStorageUrl()`, `looksLikeUrl()`, `Defaults` | ConnectionDialog, Sidebar, lib/index.ts |
| `parquet-metadata.ts` | `readParquetMetadata()`, `extractEpsgFromGeoMeta()`, `extractBounds()` | TableViewer, lib/index.ts |
| `format.ts` | `formatFileSize()`, `formatDate()`, `getFileExtension()`, `formatValue()`, `jsonReplacerBigInt()` | StatusBar, FileRow, ArchiveViewer, RawViewer, PmtilesTileInspector, PmtilesArchiveView, AttributeTable, TableGrid, export.ts, lib/index.ts |
| `hex.ts` | `generateHexDump()` | RawViewer, lib/index.ts |
| `column-types.ts` | `classifyType()`, `typeColor()`, `typeLabel()` | TableGrid, lib/index.ts |
| `cloud-url.ts` | `resolveCloudUrl()`, `getNativeScheme()`, `safeDecodeURIComponent()` | url.ts, FileTreeSidebar, +page.svelte, lib/index.ts |
| `file-sort.ts` | `sortFileEntries()`, `toggleSortField()`, `SortConfig`, `SortField`, `SortDirection` | files.svelte.ts, lib/index.ts |
| `export.ts` | `serializeToCsv()`, `serializeToJson()`, `escapeCsvField()`, `exportToCsv()`, `exportToJson()` | TableStatusBar, lib/index.ts |
| `local-storage.ts` | `loadFromStorage()`, `persistToStorage()` | connections.svelte.ts, settings.svelte.ts, query-history.svelte.ts, lib/index.ts |
| `markdown-sql.ts` | `parseMarkdownDocument()`, `interpolateTemplates()`, `markSqlBlocks()` | MarkdownViewer, lib/index.ts |
| `deck.ts` | `createDeckOverlay()`, `createGeoArrowOverlay()`, `createGeoArrowLayers()` | FlatGeobufViewer, GeoParquetMapViewer |
| `url.ts` | `buildHttpsUrl()`, `buildDuckDbUrl()`, `buildStorageUrl()`, `canStreamDirectly()` | TabBar, CogViewer, TableViewer, FlatGeobufViewer, ArchiveViewer, MediaViewer, CopcViewer, PdfViewer, ZarrMapViewer, StacMapViewer, ZarrViewer, CodeViewer, ImageViewer, PmtilesViewer, PmtilesMapView, TableToolbar |
| `archive.ts` | `streamZipEntriesFromUrl()`, `streamTarEntriesFromUrl()`, `listContents()` | ArchiveViewer |
| `pmtiles.ts` | `getPmtilesProtocol()`, `loadPmtiles()`, `buildPmtilesLayers()`, `TILE_TYPE_LABELS`, `COMPRESSION_LABELS`, `VectorLayerInfo`, `PmtilesMetadata` | PmtilesMapView, PmtilesArchiveView, PmtilesViewer |
| `pmtiles-tile.ts` | `decodeMvtTile()`, `tileToImageUrl()`, `tileMimeType()`, `layerHue()`, `DecodedTile`, `DecodedLayer`, `DecodedFeature` | PmtilesTileInspector |
| `shiki.ts` | `highlightCode()`, `highlightCodeReversed()`, `extensionToShikiLang()`, `getTheme()`, `getReversedTheme()` | PmtilesArchiveView, NotebookViewer, CodeViewer, MarkdownViewer |
| `notebook.ts` | `renderNotebook()` | NotebookViewer |
| `zarr.ts` | `ZARR_MARKER_FILES`, `detectZarrMarkers()`, `extractZarrStoreUrl()`, `fetchHierarchy()`, `probeHierarchy()`, `buildV3Tree()`, `buildV2Tree()`, `discoverV3Children()` (internal), `listS3Children()` (internal), `ensureCodecsRegistered()`, `ZarrNode`, `ZarrHierarchy`, `DIM_LIKE_NAMES`, `findNodeByPath()`, `formatCodecs()`, `formatChunkKeys()`, `computeChunkCount()`, `computeChunkSize()`, `computeUncompressed()`, `dtypeByteSize()`, `inferDims()`, `formatShape()` | ZarrViewer, ZarrMapViewer, FileBrowser, +page.svelte |
| `zarr-tab.ts` | `openZarrTab()` | FileBrowser, FileTreeSidebar, +page.svelte |
| `url-state.ts` | `syncUrlParam()`, `updateUrlView()` | Sidebar, FileTreeSidebar, TableViewer, ZarrViewer, CodeViewer, PmtilesViewer, +page.svelte |
| `pdf.ts` | `loadPdfDocument()` | PdfViewer |
| `model3d.ts` | `createModelScene()`, `loadModel()` | ModelViewer |
| `markdown.ts` | `renderMarkdown()`, `detectRTL()` | MarkdownViewer |
| `map-selection.ts` | `setupSelectionLayer()`, `updateSelection()` | PmtilesMapView, MapViewer |
| `host-detection.ts` | `detectHostBucket()` | stores/connections, Sidebar |
| `evidence-context.ts` | `EvidenceContext` | MarkdownViewer |
| `clipboard.ts` | `copyToClipboard()`, `wireCodeCopyButtons()` | TabBar, CodeViewer, NotebookViewer, MarkdownViewer, lib/index.ts |
| `cog.ts` | `safeClamp()`, `clampBounds()`, `buildDataTypeLabel()`, `fitCogBounds()`, `getMaxTextureSize()`, `cleanupNativeBitmap()`, `renderNonTiledBitmap()`, `SF_LABELS`, `CogInfo`, `GeoBounds`, `BandConfig`, `PixelValue`, `ColorRampId`, `COLOR_RAMP_STOPS`, `interpolateRamp()`, `rampToGradientCss()`, `defaultBandConfig()`, `isDefaultBandConfig()`, `needsCustomPipelineForConfig()`, `createConfigurableGetTileData()`, `readPixelAtLngLat()`, `resolveProj4Def()` | CogViewer, CogControls, lib/index.ts |
| `error.ts` | `handleLoadError()` | ImageViewer, MediaViewer, RawViewer, CodeViewer, PdfViewer, ModelViewer, MarkdownViewer, NotebookViewer, lib/index.ts |
