// Constants
export {
	COPY_FEEDBACK_MS,
	DEFAULT_TARGET_CRS,
	DUCKDB_INIT_TIMEOUT_MS,
	LAYER_HUE_MULTIPLIER,
	MAX_QUERY_HISTORY_ENTRIES,
	SQL_PREVIEW_LENGTH,
	STORAGE_KEYS,
	VIEWER_DIR_EXTENSIONS,
	WGS84_CODES
} from '../../../src/lib/constants.js';
// File icons registry
export type {
	DuckDbReadFn,
	FileCategory,
	FileTypeInfo,
	ViewerKind
} from '../../../src/lib/file-icons/index.js';
export {
	buildDuckDbSource,
	getDuckDbReadFn,
	getFileTypeInfo,
	getMimeType,
	getViewerKind,
	isCloudNativeFormat,
	isQueryable
} from '../../../src/lib/file-icons/index.js';
// Query engine types
export type {
	MapQueryHandle,
	MapQueryResult,
	QueryEngine,
	QueryHandle,
	QueryResult,
	QuerySource,
	SchemaField
} from '../../../src/lib/query/engine.js';
export { QueryCancelledError } from '../../../src/lib/query/engine.js';
// Storage adapters
export type { ListPage, StorageAdapter } from '../../../src/lib/storage/adapter.js';
// Provider registry
export type {
	AccessMode,
	AccessModeInput,
	ProviderDef,
	ProviderId,
	ProviderRegion
} from '../../../src/lib/storage/providers.js';
export {
	buildEndpointFromTemplate,
	buildProviderBaseUrl,
	getAccessMode,
	getProvider,
	isGcsProvider,
	isPubliclyStreamable,
	PROVIDER_IDS,
	PROVIDERS,
	resolveProviderEndpoint
} from '../../../src/lib/storage/providers.js';
export { UrlAdapter } from '../../../src/lib/storage/url-adapter.js';
// Core types
export type {
	Connection,
	ConnectionConfig,
	FileEntry,
	Tab,
	Theme,
	WriteResult
} from '../../../src/lib/types.js';

// ====================================================================
// Utilities physically located in packages/objex-utils/src/
// (alphabetical by file basename)
// ====================================================================

// Channel composite presets + URL round-trip (unified RGB picker)
export type { PresetDef } from './channel-composite.js';
export {
	applyPreset,
	availablePresets,
	compositeFromUrl,
	compositeToUrl,
	PRESETS,
	presetMatchesComposite
} from './channel-composite.js';
// Cloud URL resolution
export { getNativeScheme, resolveCloudUrl, safeDecodeURIComponent } from './cloud-url.js';
// COG utilities (pure helpers only, no maplibre/geotiff/epsg/proj dependency).
// MUST import from `cog-pure.ts` and NOT `cog.ts`. `cog.ts` has top-level
// imports for `@developmentseed/epsg/all`, `@developmentseed/geotiff`,
// `@developmentseed/proj`, `maplibre-gl`, and `proj4`, which tsup preserves
// as bare side-effect imports in the bundled output even when all named
// bindings are tree-shaken away. That breaks consumer Vite pre-bundles on
// `@developmentseed/epsg/all.csv.gz?url` (Vite loader query) and would force
// every downstream project to install the full COG stack just to use the
// pure TS utilities. See walkthru-earth/objex#11.
export type { CogInfo, GeoBounds } from './cog-pure.js';
export { buildDataTypeLabel, clampBounds, SF_LABELS, safeClamp } from './cog-pure.js';
// Column type classification
export type { TypeCategory } from './column-types.js';
export { classifyType, typeBadgeClass, typeColor, typeLabel } from './column-types.js';
// Connection identity (canonical key for dedup across auto-detect/manual add/edit)
export type { ConnectionIdentityInput } from './connection-identity.js';
export {
	connectionIdentityKey,
	isSameConnectionIdentity,
	normalizeEndpoint,
	normalizeProvider
} from './connection-identity.js';
// Error handling
export { handleLoadError, isAbortError } from './error.js';
// File sorting
export type { SortConfig, SortDirection, SortField } from './file-sort.js';
export { sortFileEntries, toggleSortField } from './file-sort.js';
// Formatting
export {
	formatDate,
	formatFileSize,
	formatValue,
	getFileExtension,
	jsonReplacerBigInt
} from './format.js';
// GeoArrow
export type { GeoArrowGeomType, GeoArrowResult } from './geoarrow.js';
export { buildGeoArrowTables, normalizeGeomType } from './geoarrow.js';
// Geometry type (DuckDB v1.5 parameterized GEOMETRY parsing)
export type { GeometryTypeInfo } from './geometry-type.js';
export {
	buildTransformExpr,
	isWgs84Crs,
	parseGeometryTypeCrs,
	wrapWkbWithCrs
} from './geometry-type.js';
// Hex dump
export type { HexRow } from './hex.js';
export { generateHexDump } from './hex.js';
// LRU cache
export type { LruCacheOptions } from './lru.js';
export { LruCache } from './lru.js';
// Parquet metadata
export type {
	GeoColumnMeta,
	GeoParquetMeta,
	ParquetFileMetadata
} from './parquet-metadata.js';
export {
	extractBounds,
	extractEpsgFromGeoMeta,
	extractGeometryTypes,
	readParquetMetadata
} from './parquet-metadata.js';
// STAC Storage Extension (region / endpoint hints from STAC Items)
export type { StorageExtensionVersion, StorageHints } from './stac-storage-extension.js';
export {
	applyStorageHintsToConnection,
	detectStorageExtensionVersion,
	emptyStorageHints,
	extractStorageHints
} from './stac-storage-extension.js';
// Storage open-time smoke test (ranged GET probe)
export type { SmokeTestResult } from './storage-smoketest.js';
export { smokeTestHref } from './storage-smoketest.js';
// Storage URL parsing
export type {
	Defaults,
	ParsedStorageUrl,
	StorageProvider,
	UrlClassification
} from './storage-url.js';
export {
	classifyUrl,
	describeParseResult,
	isKnownBucketHost,
	looksLikeUrl,
	parseStorageUrl,
	STAC_API_PATH_RE
} from './storage-url.js';
// WKB parsing
export type { GeoType, ParsedGeometry } from './wkb.js';
export { findGeoColumn, findGeoColumnFromRows, parseWKB, toBinary } from './wkb.js';

// ====================================================================
// Utilities still physically located in src/lib/utils/
// (will move into ./ in a subsequent batch)
// ====================================================================

// COG asset enumeration (unified RGB picker)
export type {
	ChannelComposite,
	ChannelRef,
	CogAsset
} from '../../../src/lib/utils/cog-asset.js';
export {
	allChannelsBand0,
	extractCogAssets,
	isSingleAssetComposite,
	pickNaturalColorComposite,
	syntheticSelfAsset
} from '../../../src/lib/utils/cog-asset.js';
// Data export / serialization
export {
	escapeCsvField,
	exportToCsv,
	exportToJson,
	serializeToCsv,
	serializeToJson
} from '../../../src/lib/utils/export.js';
// localStorage helpers
export { loadFromStorage, persistToStorage } from '../../../src/lib/utils/local-storage.js';
// Markdown / SQL parsing
export type {
	ParsedMarkdownDocument,
	SqlBlock
} from '../../../src/lib/utils/markdown-sql.js';
export {
	interpolateTemplates,
	markSqlBlocks,
	parseMarkdownDocument
} from '../../../src/lib/utils/markdown-sql.js';
// STAC facets (auto-detected filters, sorts, slim views)
export type {
	DatetimeFacet,
	EnumFacet,
	EnumFacetField,
	Facet,
	FacetSet,
	FacetSort,
	FacetState,
	NumericFacet,
	NumericFacetField,
	StacItemView
} from '../../../src/lib/utils/stac-facets.js';
export {
	applyFacets,
	buildFacets,
	DATETIME_HISTOGRAM_BINS,
	emptyFacetState,
	extractItemView,
	hasActiveFilters,
	sortViews
} from '../../../src/lib/utils/stac-facets.js';
// stac-geoparquet (detection + row → Item transform)
export type {
	StacBboxStruct,
	StacGeoparquetRow,
	StacGeoparquetSchemaColumn,
	StacRowToItemOptions
} from '../../../src/lib/utils/stac-geoparquet.js';
export {
	flattenStacBbox,
	isStacGeoparquetSchema,
	pickStacPrimaryAsset,
	resolveStacAssetHref,
	STAC_GEOPARQUET_REQUIRED_COLUMNS,
	stacRowToItem
} from '../../../src/lib/utils/stac-geoparquet.js';
// STAC API filter push-down (CQL2 + native query params)
export type {
	StacApiCapabilities,
	StacNativeQuery,
	ToNativeQueryOptions
} from '../../../src/lib/utils/stac-pushdown.js';
export {
	residualState,
	sniffApiCapabilities,
	toCql2Filter,
	toNativeQuery
} from '../../../src/lib/utils/stac-pushdown.js';
