// Core types

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
// Channel composite presets + URL round-trip (unified RGB picker)
export type { PresetDef } from './utils/channel-composite.js';
export {
	applyPreset,
	availablePresets,
	compositeFromUrl,
	compositeToUrl,
	PRESETS,
	presetMatchesComposite
} from './utils/channel-composite.js';
// Clipboard
export { copyToClipboard, wireCodeCopyButtons } from './utils/clipboard.js';
// Cloud URL resolution
export { getNativeScheme, resolveCloudUrl, safeDecodeURIComponent } from './utils/cloud-url.js';
// COG utilities
export type { CogInfo, GeoBounds } from './utils/cog.js';
export { buildDataTypeLabel, clampBounds, SF_LABELS, safeClamp } from './utils/cog.js';
// COG asset enumeration (unified RGB picker)
export type { ChannelComposite, ChannelRef, CogAsset } from './utils/cog-asset.js';
export {
	allChannelsBand0,
	extractCogAssets,
	isSingleAssetComposite,
	pickNaturalColorComposite,
	syntheticSelfAsset
} from './utils/cog-asset.js';
export type { TypeCategory } from './utils/column-types.js';
export { classifyType, typeBadgeClass, typeColor, typeLabel } from './utils/column-types.js';
// Connection identity (dedup)
export type { ConnectionIdentityInput } from './utils/connection-identity.js';
export {
	connectionIdentityKey,
	isSameConnectionIdentity,
	normalizeEndpoint,
	normalizeProvider
} from './utils/connection-identity.js';
// Error handling
export { handleLoadError, isAbortError } from './utils/error.js';
// Data export / serialization
export { escapeCsvField, serializeToCsv, serializeToJson } from './utils/export.js';
// File sorting
export type { SortConfig, SortDirection, SortField } from './utils/file-sort.js';
export { sortFileEntries, toggleSortField } from './utils/file-sort.js';
export {
	formatDate,
	formatFileSize,
	formatValue,
	getFileExtension,
	jsonReplacerBigInt
} from './utils/format.js';
export type { GeoArrowGeomType, GeoArrowResult } from './utils/geoarrow.js';
export { buildGeoArrowTables, normalizeGeomType } from './utils/geoarrow.js';
export type { HexRow } from './utils/hex.js';
export { generateHexDump } from './utils/hex.js';
// localStorage helpers
export { loadFromStorage, persistToStorage } from './utils/local-storage.js';
// Markdown / SQL parsing
export type { ParsedMarkdownDocument, SqlBlock } from './utils/markdown-sql.js';
export {
	interpolateTemplates,
	markSqlBlocks,
	parseMarkdownDocument
} from './utils/markdown-sql.js';
export type {
	GeoColumnMeta,
	GeoParquetMeta,
	ParquetFileMetadata
} from './utils/parquet-metadata.js';
export {
	extractBounds,
	extractEpsgFromGeoMeta,
	extractGeometryTypes,
	readParquetMetadata
} from './utils/parquet-metadata.js';
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
} from './utils/stac-facets.js';
export {
	applyFacets,
	buildFacets,
	DATETIME_HISTOGRAM_BINS,
	emptyFacetState,
	extractItemView,
	hasActiveFilters,
	sortViews
} from './utils/stac-facets.js';
export type {
	StacBboxStruct,
	StacGeoparquetRow,
	StacGeoparquetSchemaColumn,
	StacRowToItemOptions
} from './utils/stac-geoparquet.js';
export {
	flattenStacBbox,
	isStacGeoparquetSchema,
	pickStacPrimaryAsset,
	resolveStacAssetHref,
	STAC_GEOPARQUET_REQUIRED_COLUMNS,
	stacRowToItem
} from './utils/stac-geoparquet.js';
// STAC API filter push-down (CQL2 + native query params)
export type {
	StacApiCapabilities,
	StacNativeQuery,
	ToNativeQueryOptions
} from './utils/stac-pushdown.js';
export {
	residualState,
	sniffApiCapabilities,
	toCql2Filter,
	toNativeQuery
} from './utils/stac-pushdown.js';
// StacSource contract (unified ingestion: api, parquet, static)
export type {
	StacSource,
	StacSourceBatch,
	StacSourceCapabilities,
	StacSourceKind,
	StacSourceRequest
} from './utils/stac-source.js';
export { emptyPushdown } from './utils/stac-source.js';
export type { Defaults, ParsedStorageUrl, StorageProvider } from './utils/storage-url.js';
export { describeParseResult, looksLikeUrl, parseStorageUrl } from './utils/storage-url.js';
export type { GeoType, ParsedGeometry } from './utils/wkb.js';
// Utilities
export { findGeoColumn, findGeoColumnFromRows, parseWKB, toBinary } from './utils/wkb.js';
