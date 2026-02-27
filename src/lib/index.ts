// Core types

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
export type { TypeCategory } from './utils/column-types.js';
export { classifyType, typeBadgeClass, typeColor, typeLabel } from './utils/column-types.js';
export { formatDate, formatFileSize, getFileExtension } from './utils/format.js';
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
