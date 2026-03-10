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
export { UrlAdapter } from './storage/url-adapter.js';
export type { Connection, ConnectionConfig, FileEntry, Tab, Theme, WriteResult } from './types.js';
// Clipboard
export { copyToClipboard, wireCodeCopyButtons } from './utils/clipboard.js';
export type { TypeCategory } from './utils/column-types.js';
export { classifyType, typeBadgeClass, typeColor, typeLabel } from './utils/column-types.js';
// Error handling
export { handleLoadError } from './utils/error.js';
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
export type { Defaults, ParsedStorageUrl, StorageProvider } from './utils/storage-url.js';
export { describeParseResult, looksLikeUrl, parseStorageUrl } from './utils/storage-url.js';
export type { GeoType, ParsedGeometry } from './utils/wkb.js';
// Utilities
export { findGeoColumn, findGeoColumnFromRows, parseWKB, toBinary } from './utils/wkb.js';
