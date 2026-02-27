// Core types

export type {
	DuckDbReadFn,
	FileCategory,
	FileTypeInfo,
	ViewerKind
} from '../../../src/lib/file-icons/index.js';
// File icons registry
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
	SchemaField
} from '../../../src/lib/query/engine.js';
export { QueryCancelledError } from '../../../src/lib/query/engine.js';
// Storage
export type { ListPage, StorageAdapter } from '../../../src/lib/storage/adapter.js';
export { UrlAdapter } from '../../../src/lib/storage/url-adapter.js';
export type {
	Connection,
	ConnectionConfig,
	FileEntry,
	Tab,
	Theme,
	WriteResult
} from '../../../src/lib/types.js';
export type { TypeCategory } from '../../../src/lib/utils/column-types.js';
export {
	classifyType,
	typeBadgeClass,
	typeColor,
	typeLabel
} from '../../../src/lib/utils/column-types.js';
export { formatDate, formatFileSize, getFileExtension } from '../../../src/lib/utils/format.js';
export type { GeoArrowGeomType, GeoArrowResult } from '../../../src/lib/utils/geoarrow.js';
export { buildGeoArrowTables, normalizeGeomType } from '../../../src/lib/utils/geoarrow.js';
export type { HexRow } from '../../../src/lib/utils/hex.js';
export { generateHexDump } from '../../../src/lib/utils/hex.js';
export type {
	GeoColumnMeta,
	GeoParquetMeta,
	ParquetFileMetadata
} from '../../../src/lib/utils/parquet-metadata.js';
export {
	extractBounds,
	extractEpsgFromGeoMeta,
	extractGeometryTypes,
	readParquetMetadata
} from '../../../src/lib/utils/parquet-metadata.js';
export type {
	Defaults,
	ParsedStorageUrl,
	StorageProvider
} from '../../../src/lib/utils/storage-url.js';
export {
	describeParseResult,
	looksLikeUrl,
	parseStorageUrl
} from '../../../src/lib/utils/storage-url.js';
export type { GeoType, ParsedGeometry } from '../../../src/lib/utils/wkb.js';
// Utilities
export {
	findGeoColumn,
	findGeoColumnFromRows,
	parseWKB,
	toBinary
} from '../../../src/lib/utils/wkb.js';
