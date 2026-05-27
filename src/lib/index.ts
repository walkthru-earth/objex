// Core types

// Channel composite presets + URL round-trip (unified RGB picker)
// COG utilities (pure subset only; full cog.ts stack stays viewer-only)
// COG asset enumeration (unified RGB picker)
// Connection identity (dedup)
// File sorting
// Markdown / SQL parsing
// STAC facets (auto-detected filters, sorts, slim views)
// STAC API filter push-down (CQL2 + native query params)
// StacSource contract (unified ingestion: api, parquet, static)
// STAC Storage Extension (region/requester-pays/custom-s3 endpoint hints)
export type {
	ChannelComposite,
	ChannelRef,
	CogAsset,
	CogInfo,
	ConnectionIdentityInput,
	DatetimeFacet,
	Defaults,
	EnumFacet,
	EnumFacetField,
	Facet,
	FacetSet,
	FacetSort,
	FacetState,
	GeoArrowGeomType,
	GeoArrowResult,
	GeoBounds,
	GeoColumnMeta,
	GeoParquetMeta,
	GeoType,
	HexRow,
	NumericFacet,
	NumericFacetField,
	ParquetFileMetadata,
	ParsedGeometry,
	ParsedMarkdownDocument,
	ParsedStorageUrl,
	PresetDef,
	SortConfig,
	SortDirection,
	SortField,
	SqlBlock,
	StacApiCapabilities,
	StacBboxStruct,
	StacGeoparquetRow,
	StacGeoparquetSchemaColumn,
	StacItemView,
	StacNativeQuery,
	StacRowToItemOptions,
	StacSource,
	StacSourceBatch,
	StacSourceCapabilities,
	StacSourceKind,
	StacSourceRequest,
	StorageExtensionVersion,
	StorageHints,
	StorageProvider,
	ToNativeQueryOptions,
	TypeCategory
} from '@walkthru-earth/objex-utils';
// Clipboard
// Cloud URL resolution
// Error handling
// Data export / serialization
// localStorage helpers
// Utilities
export {
	allChannelsBand0,
	applyFacets,
	applyPreset,
	applyStorageHintsToConnection,
	availablePresets,
	buildDataTypeLabel,
	buildFacets,
	buildGeoArrowTables,
	clampBounds,
	classifyType,
	compositeFromUrl,
	compositeToUrl,
	connectionIdentityKey,
	copyToClipboard,
	DATETIME_HISTOGRAM_BINS,
	describeParseResult,
	detectStorageExtensionVersion,
	emptyFacetState,
	emptyPushdown,
	emptyStorageHints,
	escapeCsvField,
	extractBounds,
	extractCogAssets,
	extractEpsgFromGeoMeta,
	extractGeometryTypes,
	extractItemView,
	extractStorageHints,
	findGeoColumn,
	findGeoColumnFromRows,
	flattenStacBbox,
	formatDate,
	formatFileSize,
	formatValue,
	generateHexDump,
	getFileExtension,
	getNativeScheme,
	handleLoadError,
	hasActiveFilters,
	interpolateTemplates,
	isAbortError,
	isSameConnectionIdentity,
	isSingleAssetComposite,
	isStacGeoparquetSchema,
	jsonReplacerBigInt,
	loadFromStorage,
	looksLikeUrl,
	markSqlBlocks,
	normalizeEndpoint,
	normalizeGeomType,
	normalizeProvider,
	PRESETS,
	parseMarkdownDocument,
	parseStorageUrl,
	parseWKB,
	persistToStorage,
	pickNaturalColorComposite,
	pickStacPrimaryAsset,
	presetMatchesComposite,
	readParquetMetadata,
	residualState,
	resolveCloudUrl,
	resolveStacAssetHref,
	SF_LABELS,
	STAC_GEOPARQUET_REQUIRED_COLUMNS,
	safeClamp,
	safeDecodeURIComponent,
	serializeToCsv,
	serializeToJson,
	sniffApiCapabilities,
	sortFileEntries,
	sortViews,
	stacRowToItem,
	syntheticSelfAsset,
	toBinary,
	toCql2Filter,
	toggleSortField,
	toNativeQuery,
	typeBadgeClass,
	typeColor,
	typeLabel,
	wireCodeCopyButtons
} from '@walkthru-earth/objex-utils';
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
} from './constants.js';
export type {
	DuckDbReadFn,
	FileCategory,
	FileTypeInfo,
	ViewerKind
} from './file-icons/index.js';
// File icons registry
export {
	buildDuckDbSource,
	getDuckDbReadFn,
	getFileTypeInfo,
	getMimeType,
	getViewerKind,
	isCloudNativeFormat,
	isQueryable
} from './file-icons/index.js';
// Query engine types
export type {
	MapQueryHandle,
	MapQueryResult,
	QueryEngine,
	QueryHandle,
	QueryResult,
	SchemaField
} from './query/engine.js';
export { QueryCancelledError } from './query/engine.js';
// Storage
export type { ListPage, StorageAdapter } from './storage/adapter.js';
export type {
	ProviderDef,
	ProviderId,
	ProviderRegion
} from './storage/providers.js';
export {
	buildEndpointFromTemplate,
	buildProviderBaseUrl,
	getProvider,
	isGcsProvider,
	PROVIDER_IDS,
	PROVIDERS
} from './storage/providers.js';
export { UrlAdapter } from './storage/url-adapter.js';
export type { Connection, ConnectionConfig, FileEntry, Tab, Theme, WriteResult } from './types.js';
